-- Migration: Tạo bảng product_history, trigger ghi vết thay đổi và chính sách phân quyền RLS
-- File: supabase/migrations/20260910031500_create_product_history.sql

BEGIN;

-- ============================================================================
-- 1. BẢNG public.product_history
-- Lưu trữ toàn bộ nhật ký tạo mới và cập nhật sản phẩm theo thời gian thực.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_values JSONB,
  new_values JSONB NOT NULL,
  changed_fields TEXT[] NOT NULL,
  CONSTRAINT product_history_action_check CHECK (action IN ('create', 'update')),
  CONSTRAINT product_history_actor_name_check CHECK (trim(actor_name) <> '')
);

-- Chỉ mục phục vụ truy vấn lịch sử theo sản phẩm, sắp xếp theo thời gian mới nhất
CREATE INDEX IF NOT EXISTS product_history_product_id_changed_at_idx
  ON public.product_history (product_id, changed_at DESC, id DESC);

-- ============================================================================
-- 2. HÀM TRIGGER TỰ ĐỘNG GHI VẾT LỊCH SỬ (log_product_history)
-- - SECURITY DEFINER: Ghi trực tiếp vào bảng product_history với quyền chủ sở hữu.
-- - SET search_path = '': Ngăn chặn triệt để tấn công thay đổi search_path.
-- - Chỉ ghi khi có thay đổi thực sự ở 10 trường nghiệp vụ, bỏ qua thay đổi updated_at.
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

  -- 2. Đóng gói new_values từ 10 trường nghiệp vụ được theo dõi
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
    'notes', new.notes
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
    v_action := 'update';

    -- Đóng gói old_values từ 10 trường nghiệp vụ cũ
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
      'notes', old.notes
    );

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

    -- Nếu không có trường nghiệp vụ nào thay đổi (ví dụ chỉ thay đổi updated_at hoặc update rỗng)
    -- thì không ghi lịch sử
    IF (pg_catalog.array_length(v_changed_fields, 1) IS NULL) THEN
      RETURN new;
    END IF;

  ELSE
    RETURN new;
  END IF;

  -- 4. Ghi bản ghi vào bảng public.product_history trong cùng giao dịch
  -- Không dùng khối EXCEPTION để nếu có lỗi, toàn bộ giao dịch cập nhật sản phẩm sẽ rollback (không nuốt lỗi)
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

-- ============================================================================
-- 3. GẮN TRIGGER VÀO BẢNG public.products
-- Trigger AFTER INSERT OR UPDATE thực thi sau khi dữ liệu sản phẩm đã hợp lệ.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_products_history ON public.products;
CREATE TRIGGER trg_products_history
  AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.log_product_history();

-- ============================================================================
-- 4. BẬT RLS VÀ PHÂN QUYỀN TRÊN public.product_history
-- ============================================================================
ALTER TABLE public.product_history ENABLE ROW LEVEL SECURITY;

-- Thu hồi toàn bộ quyền mặc định trên bảng product_history
REVOKE ALL ON TABLE public.product_history FROM PUBLIC, anon, authenticated;

-- Chỉ cấp quyền SELECT cho authenticated
GRANT SELECT ON TABLE public.product_history TO authenticated;

-- Chính sách SELECT: Tất cả thành viên gia đình đang hoạt động (is_active = true)
-- đều có quyền xem lịch sử thay đổi (kể cả thành viên chỉ xem can_edit = false).
DROP POLICY IF EXISTS product_history_select_active_member ON public.product_history;
CREATE POLICY product_history_select_active_member
  ON public.product_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.family_members AS fm
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.is_active = TRUE
    )
  );

-- (Không tạo policy INSERT, UPDATE, DELETE cho client; việc ghi lịch sử hoàn toàn do trigger đảm nhiệm)

COMMIT;
