// Service to invoke search-product-image Supabase Edge Function
import { supabase } from '../lib/supabase';
import type { AiSearchResponse } from '../types/aiSearch';

export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface FileValidationResult {
  valid: boolean;
  errorMessage?: string;
}

/**
 * Kiểm tra tính hợp lệ của file ảnh ở phía client trước khi gửi
 */
export function validateImageFileClient(file: File | null | undefined): FileValidationResult {
  if (!file) {
    return { valid: false, errorMessage: 'Vui lòng chọn một file ảnh.' };
  }

  if (file.size === 0) {
    return { valid: false, errorMessage: 'File ảnh được chọn rỗng (0 bytes).' };
  }

  if (file.size > MAX_IMAGE_FILE_SIZE) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      errorMessage: `Dung lượng ảnh (${sizeInMb} MB) vượt quá giới hạn cho phép tối đa là 5 MB.`,
    };
  }

  const normalizedType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  // Kiểm tra đuôi file HEIC/HEIF
  if (
    fileName.endsWith('.heic') ||
    fileName.endsWith('.heif') ||
    normalizedType === 'image/heic' ||
    normalizedType === 'image/heif'
  ) {
    return {
      valid: false,
      errorMessage:
        'Hệ thống chưa hỗ trợ định dạng HEIC/HEIF. Vui lòng đổi ảnh sang định dạng JPEG, PNG hoặc WebP trước khi chọn.',
    };
  }

  // Kiểm tra MIME type
  const isMimeAllowed = ALLOWED_IMAGE_TYPES.includes(normalizedType);
  const hasValidExtension =
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.webp');

  if (!isMimeAllowed && !hasValidExtension) {
    return {
      valid: false,
      errorMessage: 'Định dạng ảnh không được hỗ trợ. Vui lòng chỉ chọn ảnh JPEG, PNG hoặc WebP.',
    };
  }

  return { valid: true };
}

export interface AiSearchResult {
  success: boolean;
  data?: AiSearchResponse;
  error?: string;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
  clientDurationMs?: number;
}

/**
 * Gửi ảnh bao bì lên Supabase Edge Function `search-product-image`
 * Sử dụng phiên đăng nhập hiện tại và FormData thuần (không tự đặt Content-Type)
 */
export async function searchProductByImage(
  file: File,
  signal?: AbortSignal
): Promise<AiSearchResult> {
  const clientStartTime = performance.now();

  if (!supabase) {
    return {
      success: false,
      error: 'supabase_not_configured',
      message: 'Chưa cấu hình Supabase Client.',
      status: 500,
    };
  }

  // Kiểm tra file ở client trước
  const validation = validateImageFileClient(file);
  if (!validation.valid) {
    return {
      success: false,
      error: 'invalid_file',
      message: validation.errorMessage || 'File ảnh không hợp lệ.',
      status: 400,
    };
  }

  try {
    const formData = new FormData();
    formData.append('image', file);

    // Tuyệt đối không tự đặt Content-Type để trình duyệt tự thêm boundary
    const { data, error } = await supabase.functions.invoke<AiSearchResponse>(
      'search-product-image',
      {
        body: formData,
        signal,
      }
    );

    if (error) {
      // Xử lý FunctionsHttpError và đọc JSON chi tiết từ error.context
      let backendMessage: string | null = null;
      let backendError: string | null = null;
      let statusCode: number | undefined = undefined;
      let retryAfter: number | undefined = undefined;

      if (typeof error === 'object' && error !== null && 'context' in error) {
        const context = (error as { context?: unknown }).context;
        if (context instanceof Response) {
          statusCode = context.status;
          const retryHeader = context.headers.get('Retry-After');
          if (retryHeader) {
            const parsedRetry = parseInt(retryHeader, 10);
            if (!isNaN(parsedRetry)) {
              retryAfter = parsedRetry;
            }
          }

          try {
            const errorJson = (await context.clone().json()) as {
              message?: unknown;
              error?: unknown;
            };
            if (errorJson && typeof errorJson === 'object') {
              if (typeof errorJson.message === 'string') {
                backendMessage = errorJson.message;
              }
              if (typeof errorJson.error === 'string') {
                backendError = errorJson.error;
              }
            }
          } catch {
            // Không thể parse JSON từ body lỗi
          }
        }
      }

      // Xử lý thông báo theo mã trạng thái HTTP nếu backend chưa có thông điệp
      let displayMessage: string;
      if (backendMessage) {
        displayMessage = backendMessage;
      } else if (statusCode === 401) {
        displayMessage = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
      } else if (statusCode === 403) {
        displayMessage = 'Tài khoản chưa được cấp quyền tìm kiếm bằng AI hoặc bị khóa.';
      } else if (statusCode === 413) {
        displayMessage = 'Dung lượng ảnh tải lên vượt quá giới hạn máy chủ (5 MB).';
      } else if (statusCode === 429) {
        displayMessage =
          retryAfter && retryAfter > 0
            ? `Bạn đã đạt giới hạn lượt tìm kiếm. Vui lòng thử lại sau ${retryAfter} giây.`
            : 'Bạn đã đạt giới hạn lượt tìm kiếm bằng ảnh. Vui lòng thử lại sau giây lát.';
      } else if (error.message && !error.message.includes('non-2xx')) {
        displayMessage = error.message;
      } else {
        displayMessage = 'Không thể kết nối đến máy chủ AI. Vui lòng thử lại sau.';
      }

      return {
        success: false,
        error: backendError || 'ai_search_error',
        message: displayMessage,
        status: statusCode || 500,
        retryAfterSeconds: retryAfter,
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'empty_response',
        message: 'Dữ liệu phản hồi từ máy chủ trống.',
        status: 500,
      };
    }

    const clientDurationMs = Math.round(performance.now() - clientStartTime);

    return {
      success: data.success,
      data,
      message: data.message || 'Đã phân tích ảnh thành công.',
      status: 200,
      clientDurationMs,
    };
  } catch (err) {
    const isAbort =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.name === 'AbortError');

    if (isAbort) {
      return {
        success: false,
        error: 'aborted',
        message: 'Yêu cầu tìm kiếm đã được hủy bỏ.',
        status: 0,
        clientDurationMs: Math.round(performance.now() - clientStartTime),
      };
    }

    const errorMsg =
      err instanceof Error ? err.message : 'Đã xảy ra lỗi không mong muốn khi tìm kiếm ảnh.';
    return {
      success: false,
      error: 'network_error',
      message: errorMsg.includes('Failed to fetch')
        ? 'Lỗi kết nối mạng đến máy chủ. Vui lòng kiểm tra lại đường truyền internet.'
        : errorMsg,
      status: 500,
      clientDurationMs: Math.round(performance.now() - clientStartTime),
    };
  }
}
