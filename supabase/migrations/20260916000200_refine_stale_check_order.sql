-- Migration: Tinh chỉnh thứ tự ưu tiên kiểm tra stale task trong complete_product_embedding_sync
-- File: supabase/migrations/20260916000200_refine_stale_check_order.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_product_embedding_sync(
  p_id UUID,
  p_claim_token UUID,
  p_source_version INT,
  p_success BOOLEAN,
  p_embedding vector(768) DEFAULT NULL,
  p_visual_description TEXT DEFAULT NULL,
  p_model TEXT DEFAULT 'gemini-embedding-001',
  p_model_version TEXT DEFAULT 'v1',
  p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_status TEXT;
  v_current_token UUID;
  v_current_source_version INT;
  v_current_deleted_at TIMESTAMPTZ;
  v_dims INT;
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

  -- 2. Kiểm tra tham số cơ bản
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_argument', 'message', 'Mã sản phẩm không được để trống.');
  END IF;

  IF p_claim_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_argument', 'message', 'Claim token không được để trống.');
  END IF;

  -- 3. Khóa dòng kiểm tra trạng thái hiện thời
  SELECT p.embedding_status, p.claim_token, p.source_version, p.deleted_at
  INTO v_current_status, v_current_token, v_current_source_version, v_current_deleted_at
  FROM public.products p
  WHERE p.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Sản phẩm không tồn tại trong cơ sở dữ liệu.');
  END IF;

  -- 4. Kiểm tra các điều kiện loại trừ (Stale Task Protection theo thứ tự ưu tiên nguyên nhân gốc rễ)
  -- 4a. Sản phẩm đã bị xóa
  IF v_current_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_deleted', 'message', 'Tác vụ bị hủy: Sản phẩm đã bị xóa mềm trong khi đang xử lý.');
  END IF;

  -- 4b. Phiên bản dữ liệu/ảnh đã bị thay đổi (source_version lệch)
  IF v_current_source_version IS DISTINCT FROM p_source_version THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_version_mismatch', 'message', 'Tác vụ bị hủy: Dữ liệu ảnh/thông tin sản phẩm đã bị thay đổi trong khi đang xử lý (version lệch).');
  END IF;

  -- 4c. Claim token không khớp (đã bị claim lại do quá hạn lease hoặc bị hủy)
  IF v_current_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_token_mismatch', 'message', 'Tác vụ bị hủy: Claim token không khớp (đã bị claim lại do quá hạn lease hoặc hủy).');
  END IF;

  -- 4d. Trạng thái không còn là processing (đã complete trước đó)
  IF v_current_status <> 'processing' THEN
    RETURN jsonb_build_object('success', false, 'status', 'stale_not_processing', 'message', 'Tác vụ bị hủy: Sản phẩm không còn ở trạng thái processing.');
  END IF;

  -- 5. Thực hiện cập nhật tương ứng theo p_success
  IF p_success IS TRUE THEN
    -- Kiểm tra nghiêm ngặt tính hợp lệ của vector và mô tả
    IF p_embedding IS NULL THEN
      UPDATE public.products
      SET embedding_status = 'failed',
          embedding_error = 'Vector embedding là NULL khi báo thành công',
          embedding_retry_count = embedding_retry_count + 1,
          claim_token = NULL,
          lease_expires_at = NULL,
          embedding_updated_at = clock_timestamp()
      WHERE id = p_id;

      RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'Vector embedding không được để NULL.');
    END IF;

    v_dims := vector_dims(p_embedding);
    IF v_dims <> 768 THEN
      UPDATE public.products
      SET embedding_status = 'failed',
          embedding_error = 'Số chiều vector không đúng: ' || COALESCE(v_dims::TEXT, 'null') || ' (yêu cầu đúng 768 chiều)',
          embedding_retry_count = embedding_retry_count + 1,
          claim_token = NULL,
          lease_expires_at = NULL,
          embedding_updated_at = clock_timestamp()
      WHERE id = p_id;

      RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'Số chiều vector không hợp lệ (phải đúng 768 chiều).');
    END IF;

    IF p_visual_description IS NULL OR pg_catalog.btrim(p_visual_description) = '' THEN
      UPDATE public.products
      SET embedding_status = 'failed',
          embedding_error = 'Mô tả thị giác trống khi báo thành công',
          embedding_retry_count = embedding_retry_count + 1,
          claim_token = NULL,
          lease_expires_at = NULL,
          embedding_updated_at = clock_timestamp()
      WHERE id = p_id;

      RETURN jsonb_build_object('success', false, 'status', 'invalid_payload', 'message', 'Mô tả thị giác không được để trống khi lưu trạng thái synced.');
    END IF;

    -- Dữ liệu hoàn toàn hợp lệ -> Ghi trạng thái synced
    UPDATE public.products
    SET embedding_status = 'synced',
        image_embedding = p_embedding,
        visual_description = pg_catalog.btrim(p_visual_description),
        embedding_model = COALESCE(NULLIF(pg_catalog.btrim(p_model), ''), 'gemini-embedding-001'),
        embedding_model_version = COALESCE(NULLIF(pg_catalog.btrim(p_model_version), ''), 'v1'),
        embedding_error = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        embedding_updated_at = clock_timestamp()
    WHERE id = p_id;

    RETURN jsonb_build_object('success', true, 'status', 'updated_synced', 'message', 'Đã lưu vector thị giác thành công.');
  ELSE
    -- Ghi nhận trạng thái failed và tăng số lần thử lại
    UPDATE public.products
    SET embedding_status = 'failed',
        embedding_error = COALESCE(p_error, 'Lỗi không xác định khi đồng bộ vector'),
        embedding_retry_count = embedding_retry_count + 1,
        claim_token = NULL,
        lease_expires_at = NULL,
        embedding_updated_at = clock_timestamp()
    WHERE id = p_id;

    RETURN jsonb_build_object('success', true, 'status', 'updated_failed', 'message', 'Đã ghi nhận trạng thái đồng bộ thất bại.');
  END IF;
END;
$$;

COMMIT;
