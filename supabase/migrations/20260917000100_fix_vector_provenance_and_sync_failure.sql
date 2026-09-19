-- Migration: Phân biệt nguồn gốc vector, khắc phục fallback metadata và hoàn thiện complete sync
-- File: supabase/migrations/20260917000100_fix_vector_provenance_and_sync_failure.sql

BEGIN;

-- ============================================================================
-- 1. BỔ SUNG CỘT embedding_source ĐỂ PHÂN BIỆT RÕ NGUỒN GỐC VECTOR
-- 'image_description': Vector sinh ra từ ảnh thật qua Gemini Vision + Embedding
-- 'text_metadata': Vector sinh ra từ tên/danh mục/ghi chú (chỉ dùng cho tìm kiếm văn bản)
-- ============================================================================
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS embedding_source TEXT CHECK (embedding_source IN ('image_description', 'text_metadata')) DEFAULT NULL;

-- Thu hồi quyền sửa embedding_source từ client authenticated (chỉ RPC/server được ghi)
REVOKE UPDATE (embedding_source) ON public.products FROM authenticated;

-- ============================================================================
-- 2. XÁC MINH & BẢO TOÀN DỮ LIỆU HIỆN CÓ TRONG CƠ SỞ DỮ LIỆU
-- - Sản phẩm '08' (Chuột Gaming) đã xác minh tạo từ ảnh thật -> gán 'image_description'
-- - Các sản phẩm '02', '03', '04', '05', '06', '07' tạo từ metadata -> reset về pending
-- ============================================================================

-- Gán nguồn gốc cho sản phẩm 08
UPDATE public.products
SET embedding_source = 'image_description'
WHERE code = '08'
  AND embedding_status = 'synced'
  AND visual_description LIKE 'vật thể:%';

-- Đánh dấu tạo lại cho các sản phẩm 02-07 có mô tả text metadata
UPDATE public.products
SET embedding_status = 'pending',
    image_embedding = NULL,
    visual_description = NULL,
    embedding_source = NULL,
    embedding_model = NULL,
    embedding_model_version = NULL,
    embedding_updated_at = clock_timestamp()
WHERE code IN ('02', '03', '04', '05', '06', '07')
   OR (visual_description LIKE 'sản phẩm:%' AND visual_description NOT LIKE 'vật thể:%');

-- ============================================================================
-- 3. CẬP NHẬT RPC public.complete_product_embedding_sync
-- Hỗ trợ tham số p_source TEXT DEFAULT 'image_description'
-- Khi p_success = false:
--   - Ghi nhận embedding_status = 'failed'
--   - image_embedding = NULL, visual_description = NULL, embedding_source = NULL
--   - Lưu rõ lý do lỗi trong embedding_error
--   - Hủy claim_token và lease_expires_at
--   - TUYỆT ĐỐI KHÔNG GHI NHẬN 'synced' KHI VISION LỖI
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
  p_error TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'image_description'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_version INT;
  v_current_token UUID;
  v_current_status TEXT;
  v_deleted_at TIMESTAMPTZ;
  v_affected INT;
BEGIN
  -- 1. Quyền gọi hàm: Yêu cầu thành viên có quyền can_edit
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = auth.uid()
      AND fm.is_active = TRUE
      AND fm.can_edit = TRUE
  ) THEN
    RAISE EXCEPTION 'permission_denied: Bạn không có quyền hoàn tất đồng bộ vector.' USING ERRCODE = '42501';
  END IF;

  -- 2. Kiểm tra các tham số bắt buộc
  IF p_id IS NULL OR p_claim_token IS NULL OR p_source_version IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'invalid_argument',
      'message', 'Thiếu tham số p_id, p_claim_token hoặc p_source_version'
    );
  END IF;

  -- 3. Đọc dữ liệu hiện tại của sản phẩm để chẩn đoán nguyên nhân nếu không khớp
  SELECT p.source_version, p.claim_token, p.embedding_status, p.deleted_at
  INTO v_current_version, v_current_token, v_current_status, v_deleted_at
  FROM public.products p
  WHERE p.id = p_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Sản phẩm không tồn tại trong CSDL.');
  END IF;

  -- 3a. Kiểm tra sản phẩm đã bị xóa mềm vào thùng rác chưa
  IF v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_deleted', 'message', 'Sản phẩm đã bị xóa mềm vào thùng rác.');
  END IF;

  -- 3b. Kiểm tra version dữ liệu: Người dùng đổi ảnh giữa chừng làm tăng version
  IF v_current_version <> p_source_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'stale_version_mismatch',
      'message', format('Phiên bản dữ liệu không khớp (DB: %s, Worker: %s).', v_current_version, p_source_version)
    );
  END IF;

  -- 3c. Kiểm tra trạng thái dòng: Phải còn đang ở trạng thái 'processing'
  IF v_current_status <> 'processing' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'stale_not_processing',
      'message', format('Trạng thái sản phẩm hiện tại là %s, không phải processing.', v_current_status)
    );
  END IF;

  -- 3d. Kiểm tra token sở hữu tác vụ (claim_token lease)
  IF v_current_token IS NULL OR v_current_token <> p_claim_token THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'stale_token_mismatch',
      'message', 'Token nhiệm vụ không khớp hoặc đã bị thu hồi do hết hạn lease.'
    );
  END IF;

  -- 4. Ghi nhận kết quả
  IF p_success IS TRUE THEN
    -- Khi thành công: Bắt buộc phải có vector đúng 768 chiều và mô tả không rỗng
    IF p_embedding IS NULL OR vector_dims(p_embedding) <> 768 THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'invalid_embedding',
        'message', 'Vector embedding không hợp lệ hoặc không đủ 768 chiều.'
      );
    END IF;

    IF p_visual_description IS NULL OR pg_catalog.btrim(p_visual_description) = '' THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'missing_description',
        'message', 'Mô tả đặc trưng thị giác không được để trống khi đồng bộ thành công.'
      );
    END IF;

    IF p_source IS NULL OR p_source NOT IN ('image_description', 'text_metadata') THEN
      p_source := 'image_description';
    END IF;

    UPDATE public.products
    SET embedding_status = 'synced',
        embedding_source = p_source,
        image_embedding = p_embedding,
        visual_description = p_visual_description,
        embedding_model = COALESCE(p_model, 'gemini-embedding-001'),
        embedding_model_version = COALESCE(p_model_version, 'v1'),
        embedding_error = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        embedding_updated_at = clock_timestamp()
    WHERE id = p_id
      AND claim_token = p_claim_token
      AND source_version = p_source_version
      AND embedding_status = 'processing'
      AND deleted_at IS NULL;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN
      RETURN jsonb_build_object('success', false, 'status', 'concurrency_failure', 'message', 'Không có dòng nào được cập nhật.');
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'updated_synced', 'message', 'Đã lưu vector thành công.');

  ELSE
    -- Khi thất bại (Vision lỗi, ảnh hỏng, timeout): Ghi nhận 'failed' và lưu thông báo lỗi
    UPDATE public.products
    SET embedding_status = 'failed',
        embedding_source = NULL,
        image_embedding = NULL,
        visual_description = NULL,
        embedding_error = COALESCE(p_error, 'Lỗi không xác định khi tạo embedding'),
        claim_token = NULL,
        lease_expires_at = NULL,
        embedding_updated_at = clock_timestamp()
    WHERE id = p_id
      AND claim_token = p_claim_token
      AND source_version = p_source_version
      AND embedding_status = 'processing'
      AND deleted_at IS NULL;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN
      RETURN jsonb_build_object('success', false, 'status', 'concurrency_failure', 'message', 'Không có dòng nào được cập nhật.');
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'updated_failed', 'message', 'Đã ghi nhận trạng thái đồng bộ thất bại.');
  END IF;
END;
$$;

-- Cấp quyền execute cho authenticated
GRANT EXECUTE ON FUNCTION public.complete_product_embedding_sync(
  UUID, UUID, INT, BOOLEAN, vector(768), TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- ============================================================================
-- 4. DỌN DẸP OVERLOAD CŨ VÀ NÂNG CẤP RPC match_products_by_visual_embedding
-- Chỉ cho phép so khớp các sản phẩm có embedding_source = 'image_description'
-- ============================================================================
DROP FUNCTION IF EXISTS public.match_products_by_visual_embedding(vector, double precision, integer);

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

  -- 3. Lọc sản phẩm:
  -- - Chưa xóa (deleted_at IS NULL)
  -- - Trạng thái đã đồng bộ (embedding_status = 'synced')
  -- - BẮT BUỘC vector tạo từ ảnh thật (embedding_source = 'image_description')
  -- - Đúng model và phiên bản model
  -- - Vượt ngưỡng tương đồng match_threshold
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
    AND p.embedding_source = 'image_description'
    AND p.image_embedding IS NOT NULL
    AND p.embedding_model = target_model
    AND (target_model_version IS NULL OR p.embedding_model_version = target_model_version)
    AND (1 - (p.image_embedding <=> query_embedding)) >= match_threshold
  ORDER BY (p.image_embedding <=> query_embedding) ASC
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_products_by_visual_embedding(
  vector(768), double precision, integer, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.match_products_by_visual_embedding(
  vector(768), double precision, integer, TEXT, TEXT
) FROM anon, public;

COMMIT;
