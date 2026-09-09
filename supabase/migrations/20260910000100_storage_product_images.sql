-- Migration: Cấu hình Storage Bucket và Chính sách Phân quyền RLS cho Ảnh Sản phẩm (product-images)
-- File: supabase/migrations/20260910000100_storage_product_images.sql

BEGIN;

-- ============================================================================
-- 1. CẤU HÌNH BUCKET storage.buckets
-- Tạo bucket product-images nếu chưa tồn tại, hoặc cập nhật đúng cấu hình
-- nếu bucket đã được tạo trước trên Supabase Dashboard.
-- Không tác động đến các bucket khác trong hệ thống.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2. CHÍNH SÁCH RLS (POLICIES) TRÊN storage.objects
-- Chỉ áp dụng cho bucket_id = 'product-images'.
-- Tuyệt đối không thay đổi GRANT/REVOKE toàn cục trên các bảng hệ thống storage.
-- ============================================================================

-- 2.1 Chính sách SELECT (Xem ảnh):
-- - Áp dụng cho: Tài khoản đã đăng nhập (TO authenticated)
-- - Thuộc bucket: 'product-images'
-- - Điều kiện: Người dùng phải là thành viên trong public.family_members đang hoạt động (is_active = true)
-- - Cho phép xem ảnh của tất cả thành viên khác tải lên
DROP POLICY IF EXISTS product_images_select_active_member ON storage.objects;
CREATE POLICY product_images_select_active_member
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND EXISTS (
      SELECT 1
      FROM public.family_members AS fm
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.is_active = TRUE
    )
  );

-- 2.2 Chính sách INSERT (Tải ảnh lên):
-- - Áp dụng cho: Tài khoản đã đăng nhập (TO authenticated)
-- - Thuộc bucket: 'product-images'
-- - Điều kiện 1: Người dùng phải là thành viên đang hoạt động (is_active = true) và có quyền chỉnh sửa (can_edit = true)
-- - Điều kiện 2: Thư mục đầu tiên trong đường dẫn ảnh bắt buộc phải là UID của chính người đang đăng nhập
DROP POLICY IF EXISTS product_images_insert_active_editor ON storage.objects;
CREATE POLICY product_images_insert_active_editor
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.family_members AS fm
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.is_active = TRUE
        AND fm.can_edit = TRUE
    )
  );

-- Lưu ý: Bước này KHÔNG cấp policy UPDATE hoặc DELETE cho storage.objects.
-- Khi cập nhật ảnh, ứng dụng sẽ tải ảnh mới với tên UUID và upsert = false.

COMMIT;
