-- Migration: Quản lý định mức sử dụng AI theo cửa sổ phút cố định và ngày UTC (Rate Limiting / Quota)
-- File: supabase/migrations/20260911000100_create_ai_usage_quota.sql

BEGIN;

-- ============================================================================
-- 1. BẢNG public.ai_usage_quotas
-- Lưu trữ số lượt sử dụng AI theo từng người dùng (theo cửa sổ phút cố định và theo ngày UTC).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_usage_quotas (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  minute_bucket TIMESTAMPTZ NOT NULL,
  minute_count INT NOT NULL DEFAULT 0,
  day_bucket DATE NOT NULL,
  day_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_quotas_minute_count_positive CHECK (minute_count >= 0),
  CONSTRAINT ai_usage_quotas_day_count_positive CHECK (day_count >= 0)
);

-- Bật Row Level Security để bảo vệ bảng
ALTER TABLE public.ai_usage_quotas ENABLE ROW LEVEL SECURITY;

-- Thu hồi toàn bộ quyền trực tiếp trên bảng từ PUBLIC, anon và authenticated
-- Client tuyệt đối không được tự ý SELECT, INSERT, UPDATE, DELETE trực tiếp trên bảng này
REVOKE ALL ON TABLE public.ai_usage_quotas FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. HÀM RPC KIỂM TRA VÀ TĂNG ĐỊNH MỨC NGUYÊN TỬ (ATOMIC RATE LIMITING)
-- Giới hạn: Tối đa 5 lượt / phút (cửa sổ phút cố định) và 50 lượt / ngày (UTC) cho mỗi thành viên active.
-- Tự động lấy user_id qua auth.uid(), không nhận user_id tùy ý từ client.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_and_increment_ai_quota()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_is_active BOOLEAN;
  v_now TIMESTAMPTZ;
  v_current_minute TIMESTAMPTZ;
  v_current_day DATE;
  v_next_midnight TIMESTAMPTZ;
  v_minute_limit CONSTANT INT := 5;
  v_day_limit CONSTANT INT := 50;
  v_record public.ai_usage_quotas%ROWTYPE;
  v_new_minute_count INT;
  v_new_day_count INT;
  v_retry_after_seconds INT;
BEGIN
  -- 1. Lấy user_id từ token người dùng hiện tại
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', FALSE,
      'status', 401,
      'error', 'unauthorized',
      'message', 'Yêu cầu không hợp lệ. Vui lòng đăng nhập để sử dụng tính năng này.'
    );
  END IF;

  -- 2. Kiểm tra thành viên gia đình đang hoạt động trong public.family_members
  SELECT is_active INTO v_is_active
  FROM public.family_members
  WHERE user_id = v_user_id;

  IF v_is_active IS NULL OR v_is_active IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', FALSE,
      'status', 403,
      'error', 'forbidden',
      'message', 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.'
    );
  END IF;

  -- 3. Đảm bảo bản ghi tồn tại trước khi khóa dòng (khởi tạo mốc ban đầu)
  INSERT INTO public.ai_usage_quotas (
    user_id,
    minute_bucket,
    minute_count,
    day_bucket,
    day_count,
    updated_at
  )
  VALUES (
    v_user_id,
    pg_catalog.date_trunc('minute', pg_catalog.now()),
    0,
    (pg_catalog.now() AT TIME ZONE 'UTC')::DATE,
    0,
    pg_catalog.now()
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- 4. Khóa dòng của người dùng để cập nhật nguyên tử chống race-condition
  SELECT * INTO v_record
  FROM public.ai_usage_quotas
  WHERE user_id = v_user_id
  FOR UPDATE;

  -- 5. LẤY MỐC THỜI GIAN THỰC SAU KHI ĐÃ CÓ KHÓA DÒNG (clock_timestamp)
  -- Sử dụng clock_timestamp() thay cho now() để đảm bảo lấy đúng thời điểm hiện tại thực tế
  -- sau khi hoàn tất chờ khóa dòng (now() chỉ trả về thời điểm bắt đầu transaction).
  v_now := pg_catalog.clock_timestamp();
  v_current_minute := pg_catalog.date_trunc('minute', v_now);
  v_current_day := (v_now AT TIME ZONE 'UTC')::DATE;

  -- 6. Tính toán bộ đếm theo cửa sổ phút cố định
  IF v_record.minute_bucket < v_current_minute THEN
    -- Đã sang phút mới, reset bộ đếm phút
    v_new_minute_count := 0;
  ELSE
    v_new_minute_count := v_record.minute_count;
  END IF;

  -- 7. Tính toán bộ đếm theo ngày UTC tường minh
  IF v_record.day_bucket < v_current_day THEN
    -- Đã sang ngày mới theo chuẩn UTC, reset bộ đếm ngày
    v_new_day_count := 0;
  ELSE
    v_new_day_count := v_record.day_count;
  END IF;

  -- 8. ƯU TIÊN KIỂM TRA QUOTA NGÀY TRƯỚC (Tối đa 50 lượt/ngày UTC)
  IF v_new_day_count >= v_day_limit THEN
    -- Tính số giây còn lại cho đến nửa đêm UTC tiếp theo
    v_next_midnight := ((v_current_day + 1)::TEXT || ' 00:00:00+00')::TIMESTAMPTZ;
    v_retry_after_seconds := GREATEST(1, EXTRACT(EPOCH FROM (v_next_midnight - v_now))::INT);

    RETURN pg_catalog.jsonb_build_object(
      'allowed', FALSE,
      'status', 429,
      'error', 'daily_quota_exceeded',
      'message', 'Bạn đã sử dụng hết định mức 50 lượt tìm kiếm bằng ảnh trong ngày hôm nay (tính theo giờ UTC). Vui lòng quay lại vào ngày mai.',
      'retry_after_seconds', v_retry_after_seconds,
      'remaining_minute', 0,
      'remaining_day', 0
    );
  END IF;

  -- 9. KIỂM TRA QUOTA PHÚT (Tối đa 5 lượt trong cửa sổ phút cố định)
  IF v_new_minute_count >= v_minute_limit THEN
    -- Tính số giây còn lại cho đến hết phút hiện tại
    v_retry_after_seconds := GREATEST(1, 60 - EXTRACT(SECOND FROM v_now)::INT);

    RETURN pg_catalog.jsonb_build_object(
      'allowed', FALSE,
      'status', 429,
      'error', 'rate_limit_minute_exceeded',
      'message', 'Bạn đã thực hiện quá 5 lượt tìm kiếm bằng ảnh trong một phút. Vui lòng thử lại sau giây lát.',
      'retry_after_seconds', v_retry_after_seconds,
      'remaining_minute', 0,
      'remaining_day', GREATEST(0, v_day_limit - v_new_day_count)
    );
  END IF;

  -- 10. Tăng bộ đếm nguyên tử và lưu vào cơ sở dữ liệu
  v_new_minute_count := v_new_minute_count + 1;
  v_new_day_count := v_new_day_count + 1;

  UPDATE public.ai_usage_quotas
  SET
    minute_bucket = v_current_minute,
    minute_count = v_new_minute_count,
    day_bucket = v_current_day,
    day_count = v_new_day_count,
    updated_at = v_now
  WHERE user_id = v_user_id;

  -- 11. Trả về thông tin hạn mức còn lại
  RETURN pg_catalog.jsonb_build_object(
    'allowed', TRUE,
    'status', 200,
    'error', NULL,
    'message', 'Hạn mức hợp lệ.',
    'remaining_minute', v_minute_limit - v_new_minute_count,
    'remaining_day', v_day_limit - v_new_day_count
  );
END;
$$;

-- Thu hồi quyền mặc định và chỉ cấp EXECUTE cho người dùng đã đăng nhập (authenticated)
REVOKE ALL ON FUNCTION public.check_and_increment_ai_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_and_increment_ai_quota() TO authenticated;

COMMIT;
