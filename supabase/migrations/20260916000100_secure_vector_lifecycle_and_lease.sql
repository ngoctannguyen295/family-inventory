-- Migration: Củng cố toàn diện vòng đời vector, Token Lease chống Stale Write, Trigger Server-side Invalidation và Phân quyền Cột CSDL
-- File: supabase/migrations/20260916000100_secure_vector_lifecycle_and_lease.sql

BEGIN;

-- ============================================================================
-- 1. BỔ SUNG CÁC CỘT QUẢN LÝ LEASE, VERSION VÀ MODEL VÀO public.products
-- ============================================================================
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS claim_token UUID DEFAULT NULL;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS source_version INT NOT NULL DEFAULT 1;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'gemini-embedding-001';

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS embedding_model_version TEXT DEFAULT 'v1';

-- Khởi tạo giá trị mặc định cho dữ liệu hiện có (KHÔNG reset vector đã đồng bộ trước đó)
UPDATE public.products
SET embedding_model = COALESCE(embedding_model, 'gemini-embedding-001'),
    embedding_model_version = COALESCE(embedding_model_version, 'v1'),
    source_version = COALESCE(source_version, 1)
WHERE deleted_at IS NULL;

-- ============================================================================
-- 2. THAY THẾ CHỈ MỤC VECTOR: TỪ BỎ IVFFLAT, SỬ DỤNG HNSW CÓ ĐIỀU KIỆN
-- IVFFlat không hiệu quả và có thể trả về 0 kết quả khi tập dữ liệu nhỏ hoặc vừa tạo.
-- HNSW hoạt động chính xác từ 1 dòng dữ liệu đến hàng triệu dòng mà không cần clustering trước.
-- ============================================================================
DROP INDEX IF EXISTS public.products_image_embedding_idx;

CREATE INDEX IF NOT EXISTS products_image_embedding_hnsw_idx
ON public.products
USING hnsw (image_embedding vector_cosine_ops)
WHERE deleted_at IS NULL AND embedding_status = 'synced';

-- ============================================================================
-- 3. HÀM RPC public.claim_products_for_embedding_sync
-- Cấp claim_token, source_version và lease_expires_at;
-- Cho phép thu hồi dòng 'processing' đã quá hạn lease (worker chết / timeout)
-- Khóa dòng FOR UPDATE SKIP LOCKED chống race condition giữa các worker
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_products_for_embedding_sync(
  batch_size INT DEFAULT 5,
  lease_seconds INT DEFAULT 120
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  category TEXT,
  notes TEXT,
  image_url TEXT,
  claim_token UUID,
  source_version INT,
  lease_expires_at TIMESTAMPTZ,
  embedding_retry_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- 1. Kiểm tra quyền hạn người gọi: Bắt buộc là thành viên gia đình active có can_edit = true
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = auth.uid()
      AND fm.is_active = TRUE
      AND fm.can_edit = TRUE
  ) THEN
    RAISE EXCEPTION 'permission_denied: Bạn không có quyền thực hiện thao tác claim vector.' USING ERRCODE = '42501';
  END IF;

  -- 2. Giới hạn tham số hợp lệ
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 10 THEN
    batch_size := 5;
  END IF;

  IF lease_seconds IS NULL OR lease_seconds < 15 OR lease_seconds > 600 THEN
    lease_seconds := 120;
  END IF;

  -- 3. Khóa và cấp lease với FOR UPDATE SKIP LOCKED
  RETURN QUERY
  WITH candidate_rows AS (
    SELECT p.id,
           CASE
             -- Nếu dòng đang processing nhưng đã quá hạn lease, tính là 1 lần retry thất bại của worker trước
             WHEN p.embedding_status = 'processing' AND p.lease_expires_at IS NOT NULL AND p.lease_expires_at < clock_timestamp()
             THEN p.embedding_retry_count + 1
             ELSE p.embedding_retry_count
           END AS new_retry_count
    FROM public.products p
    WHERE p.deleted_at IS NULL
      AND (
        (p.embedding_status = 'pending' AND p.embedding_retry_count < 3)
        OR (p.embedding_status = 'failed' AND p.embedding_retry_count < 3)
        OR (
          p.embedding_status = 'processing'
          AND p.lease_expires_at IS NOT NULL
          AND p.lease_expires_at < clock_timestamp()
          AND p.embedding_retry_count < 3
        )
      )
    ORDER BY p.created_at DESC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.products p
  SET embedding_status = 'processing',
      claim_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + (lease_seconds || ' seconds')::INTERVAL,
      embedding_retry_count = c.new_retry_count,
      embedding_updated_at = clock_timestamp()
  FROM candidate_rows c
  WHERE p.id = c.id
  RETURNING p.id, p.name, p.category, p.notes, p.image_url, p.claim_token, p.source_version, p.lease_expires_at, p.embedding_retry_count;
END;
$$;

-- ============================================================================
-- 4. HÀM RPC public.complete_product_embedding_sync
-- Kiểm tra nguyên tử id, claim_token, source_version và processing;
-- Lọc nghiêm ngặt deleted_at IS NULL;
-- Kiểm tra hợp lệ vector (768 chiều) và mô tả trước khi ghi synced;
-- Trả về JSONB chi tiết, không bao giờ báo thành công giả khi không cập nhật dòng nào.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_product_embedding_sync(
  p_id UUID,
  p_claim_token UUID,
  p_source_version INT,
  p_success BOOLEAN,
  p_embedding vector(768) DEFAULT NULL,
  p_visual_description TEXT DEFAULT NULL,
  p_model TEXT DEFAULT 'gemini-embedding-001',
  p_model_version TEXT DEFAULT 'v1',
  p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_status TEXT;
  v_current_token UUID;
  v_current_source_version INT;
  v_current_deleted_at TIMESTAMPTZ;
  v_dims INT;
BEGIN
  -- 1. Kiểm tra quyền hạn người gọi
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = auth.uid()
      AND fm.is_active = TRUE
      AND fm.can_edit = TRUE
  ) THEN
    RAISE EXCEPTION 'permission_denied: Bạn không có quyền cập nhật vector sản phẩm.' USING ERRCODE = '42501';
  END IF;

  -- 2. Kiểm tra tham số cơ bản
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_argument', 'message', 'Mã sản phẩm không được để trống.');
  END IF;

  IF p_claim_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_argument', 'message', 'Claim token không được để trống.');
  END IF;

  -- 3. Khóa dòng kiểm tra trạng thái hiện thời
  SELECT p.embedding_status, p.claim_token, p.source_version, p.deleted_at
  INTO v_current_status, v_current_token, v_current_source_version, v_current_deleted_at
  FROM public.products p
  WHERE p.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Sản phẩm không tồn tại trong cơ sở dữ liệu.');
  END IF;

  -- 4. Kiểm tra các điều kiện loại trừ (Stale Task Protection)
  IF v_current_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_deleted', 'message', 'Tác vụ bị hủy: Sản phẩm đã bị xóa mềm trong khi đang xử lý.');
  END IF;

  IF v_current_status <> 'processing' THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_not_processing', 'message', 'Tác vụ bị hủy: Sản phẩm không còn ở trạng thái processing.');
  END IF;

  IF v_current_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_token_mismatch', 'message', 'Tác vụ bị hủy: Claim token không khớp (đã bị claim lại do quá hạn lease hoặc hủy).');
  END IF;

  IF v_current_source_version IS DISTINCT FROM p_source_version THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_version_mismatch', 'message', 'Tác vụ bị hủy: Dữ liệu ảnh/thông tin sản phẩm đã bị thay đổi trong khi đang xử lý (version lệch).');
  END IF;

  -- 5. Thực hiện cập nhật tương ứng theo p_success
  IF p_success IS TRUE THEN
    -- Kiểm tra nghiêm ngặt tính hợp lệ của vector và mô tả
    IF p_embedding IS NULL THEN
      UPDATE public.products
      SET embedding_status = 'failed',
          embedding_error = 'Vector embedding là NULL khi báo thành công',
          embedding_retry_count = embedding_retry_count + 1,
          claim_token = NULL,
          lease_expires_at = NULL,
          embedding_updated_at = clock_timestamp()
      WHERE id = p_id;

      RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'Vector embedding không được để NULL.');
    END IF;

    v_dims := vector_dims(p_embedding);
    IF v_dims <> 768 THEN
      UPDATE public.products
      SET embedding_status = 'failed',
          embedding_error = 'Số chiều vector không đúng: ' || COALESCE(v_dims::TEXT, 'null') || ' (yêu cầu đúng 768 chiều)',
          embedding_retry_count = embedding_retry_count + 1,
          claim_token = NULL,
          lease_expires_at = NULL,
          embedding_updated_at = clock_timestamp()
      WHERE id = p_id;

      RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'Số chiều vector không hợp lệ (phải đúng 768 chiều).');
    END IF;

    IF p_visual_description IS NULL OR pg_catalog.btrim(p_visual_description) = '' THEN
      UPDATE public.products
      SET embedding_status = 'failed',
          embedding_error = 'Mô tả thị giác trống khi báo thành công',
          embedding_retry_count = embedding_retry_count + 1,
          claim_token = NULL,
          lease_expires_at = NULL,
          embedding_updated_at = clock_timestamp()
      WHERE id = p_id;

      RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'Mô tả thị giác không được để trống khi lưu trạng thái synced.');
    END IF;

    -- Dữ liệu hoàn toàn hợp lệ -> Ghi trạng thái synced
    UPDATE public.products
    SET embedding_status = 'synced',
        image_embedding = p_embedding,
        visual_description = pg_catalog.btrim(p_visual_description),
        embedding_model = COALESCE(NULLIF(pg_catalog.btrim(p_model), ''), 'gemini-embedding-001'),
        embedding_model_version = COALESCE(NULLIF(pg_catalog.btrim(p_model_version), ''), 'v1'),
        embedding_error = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        embedding_updated_at = clock_timestamp()
    WHERE id = p_id;

    RETURN jsonb_build_object('success', true, 'status', 'updated_synced', 'message', 'Đã lưu vector thị giác thành công.');
  ELSE
    -- Ghi nhận trạng thái failed và tăng số lần thử lại
    UPDATE public.products
    SET embedding_status = 'failed',
        embedding_error = COALESCE(p_error, 'Lỗi không xác định khi đồng bộ vector'),
        embedding_retry_count = embedding_retry_count + 1,
        claim_token = NULL,
        lease_expires_at = NULL,
        embedding_updated_at = clock_timestamp()
    WHERE id = p_id;

    RETURN jsonb_build_object('success', true, 'status', 'updated_failed', 'message', 'Đã ghi nhận trạng thái đồng bộ thất bại.');
  END IF;
END;
$$;

-- ============================================================================
-- 5. HÀM RPC public.match_products_by_visual_embedding
-- Kiểm tra đầu vào nghiêm ngặt (dims, threshold, count);
-- Chỉ so sánh các sản phẩm đã 'synced' đúng target_model và target_model_version;
-- ============================================================================
CREATE OR REPLACE FUNCTION public.match_products_by_visual_embedding(
  query_embedding vector(768),
  match_threshold double precision DEFAULT 0.45,
  match_count integer DEFAULT 8,
  target_model TEXT DEFAULT 'gemini-embedding-001',
  target_model_version TEXT DEFAULT 'v1'
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  barcode TEXT,
  name TEXT,
  category TEXT,
  unit TEXT,
  image_url TEXT,
  purchase_price NUMERIC,
  sale_price NUMERIC,
  stock NUMERIC,
  notes TEXT,
  visual_description TEXT,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- 1. Kiểm tra quyền người gọi: Bắt buộc là thành viên gia đình active
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = auth.uid()
      AND fm.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'permission_denied: Bạn không có quyền truy vấn kho hàng.' USING ERRCODE = '42501';
  END IF;

  -- 2. Kiểm tra tính hợp lệ của tham số đầu vào
  IF query_embedding IS NULL THEN
    RAISE EXCEPTION 'invalid_argument: query_embedding không được để NULL' USING ERRCODE = '22023';
  END IF;

  IF vector_dims(query_embedding) <> 768 THEN
    RAISE EXCEPTION 'invalid_argument: query_embedding phải có đúng 768 chiều' USING ERRCODE = '22023';
  END IF;

  IF match_threshold IS NULL OR match_threshold < 0.0 OR match_threshold > 1.0 THEN
    match_threshold := 0.45;
  END IF;

  IF match_count IS NULL OR match_count < 1 OR match_count > 50 THEN
    match_count := 8;
  END IF;

  IF target_model IS NULL OR pg_catalog.btrim(target_model) = '' THEN
    target_model := 'gemini-embedding-001';
  END IF;

  -- 3. Lọc sản phẩm chưa xóa, trạng thái synced, đúng model và vượt ngưỡng similarity
  RETURN QUERY
  SELECT
    p.id,
    p.code,
    p.barcode,
    p.name,
    p.category,
    p.unit,
    p.image_url,
    p.purchase_price,
    p.sale_price,
    p.stock,
    p.notes,
    p.visual_description,
    (1 - (p.image_embedding <=> query_embedding)) AS similarity
  FROM public.products p
  WHERE p.deleted_at IS NULL
    AND p.embedding_status = 'synced'
    AND p.image_embedding IS NOT NULL
    AND p.embedding_model = target_model
    AND (target_model_version IS NULL OR p.embedding_model_version = target_model_version)
    AND (1 - (p.image_embedding <=> query_embedding)) >= match_threshold
  ORDER BY (p.image_embedding <=> query_embedding) ASC
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- 6. TRIGGER SERVER-SIDE: LÀM CŨ VECTOR KHI ĐỔI ẢNH VÀ KHÔI PHỤC SẢN PHẨM
-- Tự động tăng source_version, hủy vector cũ, đưa trạng thái về pending
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_products_vector_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- 1. Khi ảnh thay đổi: Luôn làm cũ vector, tăng version và đưa về pending
  IF (TG_OP = 'UPDATE') AND (OLD.image_url IS DISTINCT FROM NEW.image_url) THEN
    NEW.source_version := OLD.source_version + 1;
    NEW.embedding_status := 'pending';
    NEW.image_embedding := NULL;
    NEW.visual_description := NULL;
    NEW.claim_token := NULL;
    NEW.lease_expires_at := NULL;
    NEW.embedding_error := NULL;
    NEW.embedding_retry_count := 0;
    NEW.embedding_updated_at := clock_timestamp();
  END IF;

  -- 2. Khi khôi phục sản phẩm đã xóa (deleted_at chuyển từ NOT NULL về NULL):
  -- Không được tái sử dụng vector model cũ nếu model không khớp hoặc chưa synced
  IF (TG_OP = 'UPDATE') AND (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
    IF NEW.embedding_model IS DISTINCT FROM 'gemini-embedding-001' OR NEW.embedding_status <> 'synced' THEN
      NEW.source_version := OLD.source_version + 1;
      NEW.embedding_status := 'pending';
      NEW.image_embedding := NULL;
      NEW.visual_description := NULL;
      NEW.claim_token := NULL;
      NEW.lease_expires_at := NULL;
      NEW.embedding_error := NULL;
      NEW.embedding_retry_count := 0;
      NEW.embedding_updated_at := clock_timestamp();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_vector_lifecycle ON public.products;
CREATE TRIGGER trg_products_vector_lifecycle
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_products_vector_lifecycle();

-- ============================================================================
-- 7. THẮT CHẶT BẢO MẬT PHÂN QUYỀN CỘT (COLUMN-LEVEL PRIVILEGES)
-- Thu hồi quyền UPDATE chung trên bảng;
-- Chỉ cấp phép UPDATE trên các cột nghiệp vụ thông thường.
-- Client authenticated KHÔNG THỂ tự ý sửa trực tiếp các cột trạng thái/vector/token.
-- ============================================================================
REVOKE UPDATE ON public.products FROM authenticated;

GRANT UPDATE (
  code,
  barcode,
  name,
  category,
  unit,
  image_url,
  purchase_price,
  sale_price,
  stock,
  notes,
  deleted_at
) ON public.products TO authenticated;

-- ============================================================================
-- 8. CẤP QUYỀN THỰC THI HÀM RPC (GRANT & REVOKE)
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.claim_products_for_embedding_sync(INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_product_embedding_sync(UUID, UUID, INT, BOOLEAN, vector(768), TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_products_by_visual_embedding(vector(768), double precision, integer, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_products_for_embedding_sync(INT, INT) FROM anon, public;
REVOKE ALL ON FUNCTION public.complete_product_embedding_sync(UUID, UUID, INT, BOOLEAN, vector(768), TEXT, TEXT, TEXT, TEXT) FROM anon, public;
REVOKE ALL ON FUNCTION public.match_products_by_visual_embedding(vector(768), double precision, integer, TEXT, TEXT) FROM anon, public;

COMMIT;
