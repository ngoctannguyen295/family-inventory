-- Migration: Tạo schema cơ sở dữ liệu và chính sách phân quyền (RLS) cho Family Inventory
-- File: supabase/migrations/20260909000100_create_inventory.sql

BEGIN;

-- ============================================================================
-- 1. BẢNG public.family_members
-- Quản lý thông tin và quyền hạn của các thành viên gia đình được cấp quyền truy cập.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.family_members (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT family_members_display_name_check CHECK (trim(display_name) <> '')
);

-- ============================================================================
-- 2. BẢNG public.products
-- Quản lý danh mục hàng hóa, giá cả, mã định danh và số lượng tồn kho.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  image_url TEXT,
  purchase_price NUMERIC(14, 2) NOT NULL,
  sale_price NUMERIC(14, 2) NOT NULL,
  stock NUMERIC(14, 3) NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_code_not_empty CHECK (trim(code) <> ''),
  CONSTRAINT products_barcode_not_empty CHECK (barcode IS NULL OR trim(barcode) <> ''),
  CONSTRAINT products_name_not_empty CHECK (trim(name) <> ''),
  CONSTRAINT products_category_not_empty CHECK (trim(category) <> ''),
  CONSTRAINT products_unit_not_empty CHECK (trim(unit) <> ''),
  CONSTRAINT products_image_url_not_empty CHECK (image_url IS NULL OR trim(image_url) <> ''),
  CONSTRAINT products_purchase_price_positive CHECK (purchase_price >= 0),
  CONSTRAINT products_sale_price_positive CHECK (sale_price >= 0),
  CONSTRAINT products_stock_positive CHECK (stock >= 0)
);

-- Chỉ mục hỗ trợ tìm kiếm và lọc danh mục
CREATE INDEX IF NOT EXISTS products_category_idx ON public.products (category);
CREATE INDEX IF NOT EXISTS products_name_idx ON public.products (name);

-- ============================================================================
-- 3. HÀM VÀ TRIGGER TỰ ĐỘNG CẬP NHẬT updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  new.updated_at = pg_catalog.now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 4. BẬT ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. THU HỒI VÀ CẤP LẠI QUYỀN TRUY CẬP (PRIVILEGES)
-- Thu hồi toàn bộ quyền mặc định từ anon và authenticated, chỉ cấp lại các quyền cần thiết.
-- ============================================================================
REVOKE ALL ON TABLE public.family_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.products FROM anon, authenticated;

-- authenticated chỉ được SELECT trên family_members
GRANT SELECT ON TABLE public.family_members TO authenticated;

-- authenticated được SELECT, INSERT, UPDATE trên products (không cấp DELETE)
GRANT SELECT, INSERT, UPDATE ON TABLE public.products TO authenticated;

-- ============================================================================
-- 6. CHÍNH SÁCH RLS (POLICIES)
-- ============================================================================

-- 6.1 Chính sách cho bảng public.family_members:
-- Tài khoản đã đăng nhập chỉ được xem thông tin của chính mình.
-- Không cấp quyền INSERT, UPDATE, DELETE cho client để bảo đảm việc phân quyền
-- hoàn toàn do quản trị viên thao tác trực tiếp qua Dashboard / SQL Editor.
DROP POLICY IF EXISTS family_members_select_own ON public.family_members;
CREATE POLICY family_members_select_own
  ON public.family_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
  );

-- 6.2 Chính sách cho bảng public.products:
-- a) SELECT: Chỉ thành viên có bản ghi trong family_members và is_active = true mới được xem sản phẩm.
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
    )
  );

-- b) INSERT: Chỉ thành viên đang hoạt động (is_active = true) và có quyền chỉnh sửa (can_edit = true) mới được thêm mới sản phẩm.
DROP POLICY IF EXISTS products_insert_active_editor ON public.products;
CREATE POLICY products_insert_active_editor
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.family_members AS fm
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.is_active = TRUE
        AND fm.can_edit = TRUE
    )
  );

-- c) UPDATE: Chỉ thành viên đang hoạt động (is_active = true) và có quyền chỉnh sửa (can_edit = true) mới được sửa sản phẩm.
-- Bắt buộc khai báo cả USING (điều kiện lọc dòng cần sửa) và WITH CHECK (điều kiện kiểm tra dữ liệu sau sửa).
DROP POLICY IF EXISTS products_update_active_editor ON public.products;
CREATE POLICY products_update_active_editor
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.family_members AS fm
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.is_active = TRUE
        AND fm.can_edit = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.family_members AS fm
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.is_active = TRUE
        AND fm.can_edit = TRUE
    )
  );

-- (Ghi chú: Tuyệt đối không tạo policy DELETE cho bảng products theo đúng yêu cầu bảo toàn dữ liệu hàng hóa)

COMMIT;
