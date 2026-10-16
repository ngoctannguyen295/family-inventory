-- Migration: Thêm cột phone và RPC an toàn để người dùng tự cập nhật thông tin cá nhân (display_name, phone)
-- File: supabase/migrations/20261016000100_add_user_profile_and_phone.sql

BEGIN;

-- 1. Thêm cột phone vào bảng public.family_members nếu chưa có
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Ràng buộc định dạng số điện thoại nếu có giá trị: từ 8 đến 20 ký tự (chữ số, dấu +, khoảng trắng, gạch ngang)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'family_members_phone_check'
  ) THEN
    ALTER TABLE public.family_members
      ADD CONSTRAINT family_members_phone_check
      CHECK (
        phone IS NULL OR (
          trim(phone) <> '' AND
          length(trim(phone)) BETWEEN 8 AND 20 AND
          trim(phone) ~ '^[+0-9][0-9\s.-]{7,19}$'
        )
      );
  END IF;
END $$;

-- 2. Hàm RPC an toàn để người dùng tự cập nhật thông tin của chính mình
-- Chạy với SECURITY DEFINER để bảo đảm người dùng không thể tự cấp quyền can_edit hay đổi user_id của người khác
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_display_name TEXT,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_trimmed_name TEXT;
  v_trimmed_phone TEXT;
  v_updated_record RECORD;
BEGIN
  -- Lấy user_id của người đang đăng nhập
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập hoặc phiên làm việc không hợp lệ' USING ERRCODE = '28000';
  END IF;

  -- Kiểm tra và chuẩn hóa tên hiển thị
  v_trimmed_name := trim(COALESCE(p_display_name, ''));
  IF length(v_trimmed_name) < 2 OR length(v_trimmed_name) > 60 THEN
    RAISE EXCEPTION 'Tên hiển thị phải có độ dài từ 2 đến 60 ký tự' USING ERRCODE = '22000';
  END IF;

  -- Chuẩn hóa số điện thoại
  v_trimmed_phone := NULLIF(trim(COALESCE(p_phone, '')), '');
  IF v_trimmed_phone IS NOT NULL THEN
    IF length(v_trimmed_phone) < 8 OR length(v_trimmed_phone) > 20 OR NOT (v_trimmed_phone ~ '^[+0-9][0-9\s.-]{7,19}$') THEN
      RAISE EXCEPTION 'Số điện thoại không đúng định dạng (8-20 ký tự số)' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Cập nhật thông tin trong family_members
  UPDATE public.family_members
  SET
    display_name = v_trimmed_name,
    phone = v_trimmed_phone
  WHERE user_id = v_user_id AND is_active = TRUE
  RETURNING user_id, display_name, phone, can_edit, is_active, created_at
  INTO v_updated_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản thành viên hoặc tài khoản đã bị khóa' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_updated_record.user_id,
    'display_name', v_updated_record.display_name,
    'phone', v_updated_record.phone,
    'can_edit', v_updated_record.can_edit,
    'is_active', v_updated_record.is_active,
    'created_at', v_updated_record.created_at
  );
END;
$$;

-- 3. Phân quyền thực thi hàm RPC cho tài khoản đã đăng nhập
REVOKE ALL ON FUNCTION public.update_own_profile(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_own_profile(TEXT, TEXT) TO authenticated;

COMMIT;
