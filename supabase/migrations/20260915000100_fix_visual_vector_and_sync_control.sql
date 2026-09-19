-- Migration: Hoàn thiện cấu trúc vòng đời vector, RPC đồng bộ có kiểm soát và thắt chặt bảo mật RPC tìm kiếm
-- File: supabase/migrations/20260915000100_fix_visual_vector_and_sync_control.sql

BEGIN;

-- ============================================================================
-- 1. BỔ SUNG CỘT QUẢN LÝ TRẠNG THÁI VÀ VÒNG ĐỜI VECTOR VÀO public.products
-- ============================================================================
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS embedding_status TEXT DEFAULT 'pending'
CHECK (embedding_status IN ('pending', 'processing', 'synced', 'failed'));

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS embedding_error TEXT DEFAULT NULL;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS embedding_retry_count INT DEFAULT 0;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ DEFAULT NULL;

-- Đặt lại toàn bộ vector cũ về NULL và status = 'pending' cho các sản phẩm đang hoạt động
-- để tạo lại đồng bộ chuẩn xác với model gemini-embedding-001 (768 chiều), tránh trộn lẫn model
UPDATE public.products
SET image_embedding = NULL,
    visual_description = NULL,
    embedding_status = 'pending',
    embedding_error = NULL,
    embedding_retry_count = 0,
    embedding_updated_at = NOW()
WHERE deleted_at IS NULL;

-- Chỉ mục tối ưu cho việc truy vấn lấy batch cần đồng bộ
CREATE INDEX IF NOT EXISTS products_embedding_sync_idx
ON public.products (embedding_status, embedding_retry_count)
WHERE deleted_at IS NULL;

-- ============================================================================
-- 2. HÀM RPC public.claim_products_for_embedding_sync
-- Lấy batch sản phẩm cần tạo vector embedding với khóa FOR UPDATE SKIP LOCKED
-- ngăn chặn xung đột đồng thời (race condition) và chỉ cho phép thành viên active can_edit
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_products_for_embedding_sync(batch_size INT DEFAULT 5)
RETURNS TABLE (
  id UUID,
  name TEXT,
  category TEXT,
  notes TEXT,
  image_url TEXT,
  embedding_retry_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- 1. Kiểm tra quyền hạn người gọi: Bắt buộc là thành viên gia đình đang active và có quyền chỉnh sửa
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = auth.uid()
      AND fm.is_active = TRUE
      AND fm.can_edit = TRUE
  ) THEN
    RAISE EXCEPTION 'permission_denied: Bạn không có quyền thực hiện thao tác đồng bộ vector.' USING ERRCODE = '42501';
  END IF;

  -- 2. Giới hạn batch_size tối đa 10 sản phẩm mỗi lần gọi
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 10 THEN
    batch_size := 5;
  END IF;

  -- 3. Atomic update với FOR UPDATE SKIP LOCKED
  RETURN QUERY
  WITH candidate_rows AS (
    SELECT p.id
    FROM public.products p
    WHERE p.deleted_at IS NULL
      AND (
        p.embedding_status = 'pending'
        OR (p.embedding_status = 'failed' AND p.embedding_retry_count < 3)
      )
    ORDER BY p.created_at DESC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.products p
  SET embedding_status = 'processing',
      embedding_updated_at = NOW()
  FROM candidate_rows c
  WHERE p.id = c.id
  RETURNING p.id, p.name, p.category, p.notes, p.image_url, p.embedding_retry_count;
END;
$$;

-- ============================================================================
-- 3. HÀM RPC public.complete_product_embedding_sync
-- Cập nhật kết quả đồng bộ cho một sản phẩm (thành công hoặc thất bại)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_product_embedding_sync(
  p_id UUID,
  p_success BOOLEAN,
  p_embedding vector(768) DEFAULT NULL,
  p_visual_description TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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

  -- 2. Cập nhật trạng thái
  IF p_success THEN
    UPDATE public.products
    SET embedding_status = 'synced',
        image_embedding = p_embedding,
        visual_description = p_visual_description,
        embedding_error = NULL,
        embedding_updated_at = NOW()
    WHERE id = p_id;
  ELSE
    UPDATE public.products
    SET embedding_status = 'failed',
        embedding_error = p_error,
        embedding_retry_count = embedding_retry_count + 1,
        embedding_updated_at = NOW()
    WHERE id = p_id;
  END IF;
END;
$$;

-- ============================================================================
-- 4. CẬP NHẬT HÀM RPC public.match_products_by_visual_embedding
-- Thắt chặt kiểm tra quyền thành viên gia đình active, lọc nghiêm ngặt deleted_at IS NULL,
-- bảo vệ với SECURITY DEFINER và SET search_path an toàn
-- ============================================================================
CREATE OR REPLACE FUNCTION public.match_products_by_visual_embedding(
  query_embedding vector(768),
  match_threshold double precision DEFAULT 0.45,
  match_count integer DEFAULT 8
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
  -- 1. Kiểm tra quyền người gọi: Bắt buộc là thành viên gia đình đang active
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = auth.uid()
      AND fm.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'permission_denied: Bạn không có quyền truy vấn kho hàng.' USING ERRCODE = '42501';
  END IF;

  -- 2. Lọc sản phẩm chưa xóa, có embedding hợp lệ và thỏa mãn ngưỡng tương đồng
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
    AND p.image_embedding IS NOT NULL
    AND (1 - (p.image_embedding <=> query_embedding)) >= match_threshold
  ORDER BY (p.image_embedding <=> query_embedding) ASC
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- 5. PHÂN QUYỀN THỰC THI (GRANT & REVOKE)
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.claim_products_for_embedding_sync(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_product_embedding_sync(UUID, BOOLEAN, vector(768), TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_products_by_visual_embedding(vector(768), double precision, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_products_for_embedding_sync(INT) FROM anon, public;
REVOKE ALL ON FUNCTION public.complete_product_embedding_sync(UUID, BOOLEAN, vector(768), TEXT, TEXT) FROM anon, public;
REVOKE ALL ON FUNCTION public.match_products_by_visual_embedding(vector(768), double precision, integer) FROM anon, public;

COMMIT;
