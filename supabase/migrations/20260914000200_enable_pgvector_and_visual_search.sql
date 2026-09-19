-- Migration: Kích hoạt pgvector và tạo các cột, chỉ mục, hàm phục vụ tìm kiếm hình ảnh (Visual Search)
-- File: supabase/migrations/20260914000200_enable_pgvector_and_visual_search.sql

BEGIN;

-- ============================================================================
-- 1. KÍCH HOẠT EXTENSION VECTOR
-- Supabase Postgres hỗ trợ sẵn extension vector (pgvector) cho toàn bộ các gói (bao gồm Free Tier).
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 2. BỔ SUNG CỘT CHO BẢNG public.products
-- - visual_description: Mô tả thị giác chi tiết (loại đồ vật, màu sắc, hình dáng, chất liệu) do AI tạo.
-- - image_embedding: Vector đặc trưng thị giác 768 chiều (tương thích text-embedding-004 của Google).
-- ============================================================================
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS visual_description TEXT;

ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS image_embedding vector(768);

-- ============================================================================
-- 3. CHỈ MỤC TÌM KIẾM VECTOR (IVFFlat)
-- Sử dụng khoảng cách Cosine (vector_cosine_ops) phù hợp cho việc so sánh góc tương đồng ảnh.
-- lists = 100 tối ưu cho quy mô hàng trăm đến hàng nghìn sản phẩm gia đình.
-- ============================================================================
CREATE INDEX IF NOT EXISTS products_image_embedding_idx 
ON public.products 
USING ivfflat (image_embedding vector_cosine_ops) 
WITH (lists = 100);

-- ============================================================================
-- 4. HÀM RPC public.match_products_by_visual_embedding
-- Nhận query_embedding, tính độ tương đồng Cosine (1 - (embedding <=> query_embedding)),
-- lọc bỏ các sản phẩm đã xóa mềm (deleted_at IS NOT NULL),
-- trả về danh sách sản phẩm kèm điểm similarity (0.0 đến 1.0).
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
SET search_path = public, pg_catalog
AS $$
BEGIN
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

-- Cấp quyền thực thi hàm RPC cho authenticated users
GRANT EXECUTE ON FUNCTION public.match_products_by_visual_embedding(vector(768), double precision, integer) TO authenticated;

COMMIT;
