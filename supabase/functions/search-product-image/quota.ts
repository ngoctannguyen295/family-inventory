// Quota & Rate limiting module for search-product-image
import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.49.1';
import type { QuotaCheckResult } from './types.ts';

/**
 * Kiểm tra và tăng định mức sử dụng AI nguyên tử qua hàm RPC check_and_increment_ai_quota.
 * Nếu hệ thống cơ sở dữ liệu gặp lỗi, hàm sẽ chủ động chặn và không cho phép gọi tiếp AI.
 */
export async function checkAndConsumeQuota(
  userClient: SupabaseClient
): Promise<QuotaCheckResult> {
  try {
    const { data, error } = await userClient.rpc('check_and_increment_ai_quota');

    if (error) {
      return {
        allowed: false,
        status: 500,
        error: 'quota_db_error',
        message:
          'Lỗi kết nối cơ sở dữ liệu khi kiểm tra định mức sử dụng. Quá trình xử lý AI bị dừng để đảm bảo an toàn.',
      };
    }

    // Kết quả trả về từ hàm PostgreSQL RPC
    const result = typeof data === 'string' ? JSON.parse(data) : data;

    if (!result || typeof result !== 'object') {
      return {
        allowed: false,
        status: 500,
        error: 'invalid_quota_response',
        message: 'Dữ liệu phản hồi kiểm tra định mức không hợp lệ.',
      };
    }

    if (!result.allowed) {
      return {
        allowed: false,
        status: result.status || 429,
        error: result.error || 'rate_limit_exceeded',
        message: result.message || 'Đã vượt quá hạn mức tìm kiếm bằng ảnh.',
        remaining_minute: result.remaining_minute ?? 0,
        remaining_day: result.remaining_day ?? 0,
        retry_after_seconds: result.retry_after_seconds ?? 60,
      };
    }

    return {
      allowed: true,
      status: 200,
      error: null,
      message: result.message || 'Hạn mức hợp lệ.',
      remaining_minute: result.remaining_minute ?? 0,
      remaining_day: result.remaining_day ?? 0,
    };
  } catch {
    return {
      allowed: false,
      status: 500,
      error: 'quota_exception',
      message: 'Đã xảy ra lỗi khi kiểm tra định mức sử dụng. Quá trình xử lý AI bị dừng để đảm bảo an toàn.',
    };
  }
}
