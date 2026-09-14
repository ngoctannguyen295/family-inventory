-- Migration: Thêm chức năng xóa mềm (soft delete), phân quyền RLS và cập nhật trigger lịch sử sản phẩm
-- File: supabase/migrations/20260914000100_add_soft_delete_and_history.sql

BEGIN;

-- ============================================================================
-- 1. THÊM CỘT deleted_at VÀO BẢNG public.products
-- - NULL: Sản phẩm đang hoạt động bình thường.
-- - TIMESTAMPTZ: Thời điểm sản phẩm được đưa vào mục "Đã xóa" (xóa mềm).
-- ============================================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Chỉ mục tối ưu truy vấn lọc sản phẩm chưa xóa và sản phẩm đã xóa
CREATE INDEX IF NOT EXISTS products_deleted_at_idx
  ON public.products (deleted_at);

-- ============================================================================
-- 2. CẬP NHẬT CHÍNH SÁCH RLS (ROW LEVEL SECURITY) TRÊN BẢNG public.products
-- Phân cấp quyền xem dữ liệu:
-- a) Thành viên chỉ xem (can_edit = false): CHỈ XEM ĐƯỢC các sản phẩm đang dùng (deleted_at IS NULL).
-- b) Thành viên có quyền sửa (can_edit = true): XEM ĐƯỢC cả sản phẩm đang dùng và sản phẩm đã xóa
--    (để phục vụ giao diện mục "Đã xóa" và khôi phục).
-- ============================================================================
DROP POLICY IF EXISTS products_select_active_member ON public.products;

CREATE POLICY products_select_active_member
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.family_members AS fm
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.is_active = TRUE
        AND (
          -- Thành viên có quyền sửa được xem tất cả (kể cả đã xóa)
          fm.can_edit = TRUE
          -- Thành viên chỉ xem chỉ được xem sản phẩm chưa xóa
          OR (fm.can_edit = FALSE AND products.deleted_at IS NULL)
        )
    )
  );

-- Đảm bảo quyền DELETE vật lý bị thu hồi tuyệt đối
REVOKE DELETE ON TABLE public.products FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. MỞ RỘNG RÀNG BUỘC CHECK TRÊN BẢNG public.product_history
-- Mở rộng action để hỗ trợ thêm 'delete' (xóa mềm) và 'restore' (khôi phục).
-- ============================================================================
ALTER TABLE public.product_history
  DROP CONSTRAINT IF EXISTS product_history_action_check;

ALTER TABLE public.product_history
  ADD CONSTRAINT product_history_action_check
  CHECK (action IN ('create', 'update', 'delete', 'restore'));

-- ============================================================================
-- 4. CẬP NHẬT HÀM TRIGGER TỰ ĐỘNG GHI LỊCH SỬ (public.log_product_history)
-- - Nhận diện sự kiện 'delete' khi deleted_at chuyển từ NULL sang TIMESTAMPTZ.
-- - Nhận diện sự kiện 'restore' khi deleted_at chuyển từ TIMESTAMPTZ sang NULL.
-- - Nhận diện sự kiện 'update' cho các cập nhật nghiệp vụ thông thường.
-- - Xử lý trường hợp cả trường nghiệp vụ và trạng thái xóa cùng đổi trong một thao tác.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_product_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT;
  v_action TEXT;
  v_old_values JSONB;
  v_new_values JSONB;
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_member_name TEXT;
BEGIN
  -- 1. Xác định danh tính người thực hiện thay đổi (actor)
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL THEN
    v_actor_name := 'Hệ thống / thao tác quản trị';
  ELSE
    SELECT fm.display_name INTO v_member_name
    FROM public.family_members AS fm
    WHERE fm.user_id = v_actor_id;

    IF v_member_name IS NOT NULL AND pg_catalog.btrim(v_member_name) <> '' THEN
      v_actor_name := pg_catalog.btrim(v_member_name);
    ELSE
      v_actor_name := 'Người dùng không xác định';
    END IF;
  END IF;

  -- 2. Đóng gói new_values từ các trường nghiệp vụ và deleted_at
  v_new_values := pg_catalog.jsonb_build_object(
    'code', new.code,
    'barcode', new.barcode,
    'name', new.name,
    'category', new.category,
    'unit', new.unit,
    'image_url', new.image_url,
    'purchase_price', new.purchase_price,
    'sale_price', new.sale_price,
    'stock', new.stock,
    'notes', new.notes,
    'deleted_at', new.deleted_at
  );

  -- 3. Xử lý phân loại theo thao tác (INSERT hoặc UPDATE)
  IF (TG_OP = 'INSERT') THEN
    v_action := 'create';
    v_old_values := NULL;
    v_changed_fields := ARRAY[
      'code',
      'barcode',
      'name',
      'category',
      'unit',
      'image_url',
      'purchase_price',
      'sale_price',
      'stock',
      'notes'
    ]::TEXT[];

  ELSIF (TG_OP = 'UPDATE') THEN
    -- Đóng gói old_values từ các trường nghiệp vụ cũ và deleted_at cũ
    v_old_values := pg_catalog.jsonb_build_object(
      'code', old.code,
      'barcode', old.barcode,
      'name', old.name,
      'category', old.category,
      'unit', old.unit,
      'image_url', old.image_url,
      'purchase_price', old.purchase_price,
      'sale_price', old.sale_price,
      'stock', old.stock,
      'notes', old.notes,
      'deleted_at', old.deleted_at
    );

    -- Xác định loại thao tác nghiệp vụ:
    -- Nếu deleted_at chuyển từ NULL sang có giá trị: Đây là thao tác XÓA MỀM
    IF (old.deleted_at IS NULL AND new.deleted_at IS NOT NULL) THEN
      v_action := 'delete';
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'deleted_at');
    -- Nếu deleted_at chuyển từ có giá trị sang NULL: Đây là thao tác KHÔI PHỤC
    ELSIF (old.deleted_at IS NOT NULL AND new.deleted_at IS NULL) THEN
      v_action := 'restore';
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'deleted_at');
    ELSE
      v_action := 'update';
    END IF;

    -- So sánh từng trường nghiệp vụ bằng IS DISTINCT FROM (xử lý chính xác cả NULL)
    IF (old.code IS DISTINCT FROM new.code) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'code');
    END IF;
    IF (old.barcode IS DISTINCT FROM new.barcode) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'barcode');
    END IF;
    IF (old.name IS DISTINCT FROM new.name) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'name');
    END IF;
    IF (old.category IS DISTINCT FROM new.category) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'category');
    END IF;
    IF (old.unit IS DISTINCT FROM new.unit) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'unit');
    END IF;
    IF (old.image_url IS DISTINCT FROM new.image_url) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'image_url');
    END IF;
    IF (old.purchase_price IS DISTINCT FROM new.purchase_price) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'purchase_price');
    END IF;
    IF (old.sale_price IS DISTINCT FROM new.sale_price) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'sale_price');
    END IF;
    IF (old.stock IS DISTINCT FROM new.stock) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'stock');
    END IF;
    IF (old.notes IS DISTINCT FROM new.notes) THEN
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'notes');
    END IF;

    -- Nếu không có trường nghiệp vụ nào thay đổi (chỉ đổi updated_at hoặc update rỗng)
    IF (pg_catalog.array_length(v_changed_fields, 1) IS NULL) THEN
      RETURN new;
    END IF;

  ELSE
    RETURN new;
  END IF;

  -- 4. Ghi bản ghi vào bảng public.product_history trong cùng giao dịch
  INSERT INTO public.product_history (
    product_id,
    action,
    actor_id,
    actor_name,
    changed_at,
    old_values,
    new_values,
    changed_fields
  ) VALUES (
    new.id,
    v_action,
    v_actor_id,
    v_actor_name,
    pg_catalog.now(),
    v_old_values,
    v_new_values,
    v_changed_fields
  );

  RETURN new;
END;
$$;

-- Bảo vệ hàm trigger: Thu hồi quyền thực thi trực tiếp từ PUBLIC, anon và authenticated
REVOKE EXECUTE ON FUNCTION public.log_product_history() FROM PUBLIC, anon, authenticated;

COMMIT;
