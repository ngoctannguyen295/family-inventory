-- Migration: Thắt chặt quyền INSERT cột, Trigger khởi tạo an toàn và Xác minh nguồn gốc vector
-- File: supabase/migrations/20260916000300_secure_insert_privileges_and_vector_provenance.sql

BEGIN;

-- ============================================================================
-- 1. THẮT CHẶT QUYỀN INSERT TRÊN BẢNG public.products (COLUMN PRIVILEGES)
-- Thu hồi quyền INSERT chung trên toàn bảng;
-- Chỉ cấp quyền INSERT trên các cột thông tin nghiệp vụ hàng hóa cơ bản.
-- Client authenticated KHÔNG THỂ tự ý điền các cột vector/status/token/version/lease.
-- ============================================================================
REVOKE INSERT ON public.products FROM authenticated;

GRANT INSERT (
  code,
  barcode,
  name,
  category,
  unit,
  image_url,
  purchase_price,
  sale_price,
  stock,
  notes
) ON public.products TO authenticated;

-- ============================================================================
-- 2. TRIGGER BEFORE INSERT: KHỞI TẠO AN TOÀN TUYỆT ĐỐI (DEFENSE IN DEPTH)
-- Bất kể dữ liệu INSERT gửi lên là gì, luôn ép các trường vector/sync về giá trị an toàn:
-- status = 'pending', vector = NULL, claim_token = NULL, model = NULL
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_products_insert_sanitize()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.embedding_status := 'pending';
  NEW.image_embedding := NULL;
  NEW.visual_description := NULL;
  NEW.claim_token := NULL;
  NEW.lease_expires_at := NULL;
  NEW.embedding_error := NULL;
  NEW.embedding_retry_count := 0;
  NEW.source_version := 1;
  NEW.embedding_model := NULL;
  NEW.embedding_model_version := NULL;
  NEW.embedding_updated_at := NULL;
  NEW.deleted_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_insert_sanitize ON public.products;
CREATE TRIGGER trg_products_insert_sanitize
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_products_insert_sanitize();

-- ============================================================================
-- 3. XÁC MINH NGUỒN GỐC VECTOR CŨ & LOẠI BỎ GÁN NHÃN MODEL TỰ ĐỘNG
-- Không được gắn model/version mặc định mới cho vector chưa xác minh.
-- Chỉ đánh dấu cần tạo lại những vector không tương thích (dims != 768 hoặc mô tả trống).
-- ============================================================================

-- 3a. Đánh dấu tạo lại các vector không tương thích
UPDATE public.products
SET embedding_status = 'pending',
    image_embedding = NULL,
    visual_description = NULL,
    embedding_model = NULL,
    embedding_model_version = NULL,
    embedding_updated_at = clock_timestamp()
WHERE image_embedding IS NOT NULL
  AND (
    vector_dims(image_embedding) <> 768 
    OR visual_description IS NULL 
    OR pg_catalog.btrim(visual_description) = ''
  );

-- 3b. Xóa model/version giả định cho mọi sản phẩm chưa có vector hoặc chưa synced
UPDATE public.products
SET embedding_model = NULL,
    embedding_model_version = NULL
WHERE image_embedding IS NULL OR embedding_status <> 'synced';

COMMIT;
