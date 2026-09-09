import { supabase } from '../lib/supabase';

export const STORAGE_BUCKET = 'product-images';
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB = 5,242,880 bytes

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Kiểm tra tính hợp lệ của file ảnh trước khi xử lý hoặc tải lên
 */
export async function validateImageFile(file: File): Promise<{ isValid: boolean; error: string | null }> {
  // 1. Kiểm tra file rỗng
  if (!file || file.size <= 0) {
    return { isValid: false, error: 'File ảnh được chọn bị rỗng hoặc không có dữ liệu.' };
  }

  // 2. Kiểm tra dung lượng tối đa 5 MB
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      isValid: false,
      error: `Dung lượng file ảnh (${sizeInMB} MB) vượt quá giới hạn tối đa cho phép là 5 MB.`,
    };
  }

  // 3. Kiểm tra các định dạng đặc thù không hỗ trợ (ví dụ HEIC/HEIF của iOS)
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();
  if (
    lowerName.endsWith('.heic') ||
    lowerName.endsWith('.heif') ||
    lowerType === 'image/heic' ||
    lowerType === 'image/heif'
  ) {
    return {
      isValid: false,
      error:
        'Định dạng ảnh HEIC/HEIF chưa được hỗ trợ trực tiếp trên trình duyệt. Vui lòng chuyển đổi ảnh sang định dạng JPEG, PNG hoặc WebP trước khi tải lên (không tự ý đổi đuôi file).',
    };
  }

  // 4. Kiểm tra loại MIME cho phép
  if (!ALLOWED_MIME_TYPES[lowerType]) {
    return {
      isValid: false,
      error: 'Loại file không được hỗ trợ. Ứng dụng chỉ chấp nhận các định dạng: JPEG, PNG hoặc WebP.',
    };
  }

  // 5. Kiểm tra khả năng giải mã ảnh của trình duyệt (tránh file hỏng hoặc giả mạo đuôi)
  const canDecode = await verifyImageDecodable(file);
  if (!canDecode) {
    return {
      isValid: false,
      error: 'Trình duyệt không thể giải mã được nội dung ảnh. Vui lòng kiểm tra lại file của bạn.',
    };
  }

  return { isValid: true, error: null };
}

/**
 * Xác minh trình duyệt có thể giải mã file thành hình ảnh hay không
 */
function verifyImageDecodable(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    // Ưu tiên sử dụng createImageBitmap nếu trình duyệt hỗ trợ
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file)
        .then((bitmap) => {
          bitmap.close();
          resolve(true);
        })
        .catch(() => {
          resolve(false);
        });
      return;
    }

    // Dự phòng qua thẻ Image và Object URL
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(false);
    };
    img.src = objectUrl;
  });
}

/**
 * Tải ảnh sản phẩm lên Supabase Storage
 * Đường dẫn quy ước: <user-id>/<crypto.randomUUID()>.<ext>
 * Không dùng tên file gốc, tham số upsert = false
 */
export async function uploadProductImage(
  file: File,
  userId: string
): Promise<{ path: string | null; error: string | null }> {
  if (!supabase) {
    return { path: null, error: 'Chưa kết nối hoặc cấu hình Supabase.' };
  }

  if (!userId || userId.trim() === '') {
    return { path: null, error: 'Không xác định được danh tính người dùng để tải ảnh lên.' };
  }

  const validation = await validateImageFile(file);
  if (!validation.isValid) {
    return { path: null, error: validation.error };
  }

  const extension = ALLOWED_MIME_TYPES[file.type.toLowerCase()] || 'jpg';
  const randomUuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storagePath = `${userId}/${randomUuid}.${extension}`;

  try {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, {
        upsert: false,
        contentType: file.type,
      });

    if (error) {
      // Bắt các thông báo lỗi phân quyền hoặc dung lượng từ Supabase Storage
      const msg = error.message.toLowerCase();
      if (msg.includes('row-level security') || msg.includes('permission denied') || msg.includes('policy')) {
        return {
          path: null,
          error: 'Bạn không có quyền tải ảnh lên hệ thống lưu trữ gia đình.',
        };
      }
      if (msg.includes('file size') || msg.includes('exceeded')) {
        return {
          path: null,
          error: 'Dung lượng file vượt quá giới hạn cho phép của hệ thống lưu trữ (tối đa 5 MB).',
        };
      }
      return { path: null, error: `Tải ảnh lên thất bại: ${error.message}` };
    }

    return { path: storagePath, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi tải ảnh lên máy chủ.';
    return { path: null, error: message };
  }
}

// ============================================================================
// BỘ NHỚ ĐỆM ẢNH TRONG BỘ NHỚ TRÌNH DUYỆT (IN-MEMORY OBJECT URL CACHE)
// Giúp tránh tải lại toàn bộ ảnh mỗi khi tìm kiếm, lọc danh sách hoặc render lại
// ============================================================================

interface CacheEntry {
  objectUrl: string | null;
  status: 'loading' | 'loaded' | 'error';
  promise?: Promise<string | null>;
}

const imageMemoryCache = new Map<string, CacheEntry>();

/**
 * Tải ảnh riêng tư từ Supabase Storage qua phiên đăng nhập, tạo Object URL và cache lại
 */
export async function loadProductImageObjectUrl(storagePath: string): Promise<string | null> {
  const trimmedPath = storagePath.trim();
  if (!trimmedPath) return null;

  // 1. Nếu đã có trong cache và đã tải xong
  const cached = imageMemoryCache.get(trimmedPath);
  if (cached) {
    if (cached.status === 'loaded') {
      return cached.objectUrl;
    }
    if (cached.status === 'error') {
      return null;
    }
    if (cached.status === 'loading' && cached.promise) {
      return cached.promise;
    }
  }

  if (!supabase) {
    return null;
  }

  // 2. Bắt đầu tải file Blob từ private bucket
  const fetchPromise = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(trimmedPath);

      if (error || !data) {
        imageMemoryCache.set(trimmedPath, {
          objectUrl: null,
          status: 'error',
        });
        return null;
      }

      // Tạo Object URL từ Blob tải về
      const objectUrl = URL.createObjectURL(data);
      imageMemoryCache.set(trimmedPath, {
        objectUrl,
        status: 'loaded',
      });
      return objectUrl;
    } catch {
      imageMemoryCache.set(trimmedPath, {
        objectUrl: null,
        status: 'error',
      });
      return null;
    }
  })();

  imageMemoryCache.set(trimmedPath, {
    objectUrl: null,
    status: 'loading',
    promise: fetchPromise,
  });

  return fetchPromise;
}

/**
 * Thu hồi toàn bộ Object URLs và dọn dẹp bộ nhớ đệm
 * Gọi khi người dùng đăng xuất, đổi tài khoản hoặc đóng ứng dụng
 */
export function clearProductImageCache(): void {
  for (const entry of imageMemoryCache.values()) {
    if (entry.objectUrl) {
      try {
        URL.revokeObjectURL(entry.objectUrl);
      } catch {
        /* ignore */
      }
    }
  }
  imageMemoryCache.clear();
}
