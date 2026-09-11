// Image validation module: streaming body limiter, multipart verification, and magic bytes detection

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB cho file ảnh
export const MAX_REQUEST_OVERHEAD = 64 * 1024; // 64 KiB cho multipart headers và boundary
export const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + MAX_REQUEST_OVERHEAD;

export interface ImageValidationResult {
  valid: boolean;
  status: number;
  error?: string;
  message?: string;
  bytes?: Uint8Array;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  base64?: string;
}

/**
 * Nhận dạng chữ ký định dạng nhị phân ở đầu file (Magic Bytes / File Signatures).
 * Lưu ý: Chữ ký này chỉ dùng để nhận dạng định dạng file, không chứng minh
 * toàn bộ nội dung file là ảnh hợp lệ hoặc không bị hỏng cấu trúc bên trong.
 */
export function detectImageMimeType(
  bytes: Uint8Array
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length < 12) {
    return null;
  }

  // 1. JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // 3. WebP: RIFF (bytes 0..3) .... WEBP (bytes 8..11)
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Chuyển đổi Uint8Array sang chuỗi Base64
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Đọc stream body từ Request kèm bộ đếm byte giới hạn.
 * Nếu vượt quá maxBytes, hủy stream (reader.cancel()) ngay lập tức để chống DoS và cạn kiệt RAM.
 */
export async function readBodyWithLimit(
  req: Request,
  maxBytes: number
): Promise<{ success: boolean; data?: Uint8Array; status?: number; error?: string; message?: string }> {
  if (!req.body) {
    return {
      success: false,
      status: 400,
      error: 'empty_request_body',
      message: 'Yêu cầu không chứa nội dung (empty body).',
    };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          // Hủy stream ngay lập tức để không nhận thêm dữ liệu
          await reader.cancel();
          return {
            success: false,
            status: 413,
            error: 'request_payload_too_large',
            message: `Dung lượng toàn bộ yêu cầu vượt quá giới hạn tối đa cho phép (${(maxBytes / (1024 * 1024)).toFixed(1)} MiB).`,
          };
        }
        chunks.push(value);
      }
    }
  } catch {
    return {
      success: false,
      status: 400,
      error: 'stream_read_error',
      message: 'Đã xảy ra lỗi khi đọc luồng dữ liệu yêu cầu.',
    };
  }

  // Ghép các chunks thành một Uint8Array hoàn chỉnh
  const accumulated = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    accumulated.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    success: true,
    data: accumulated,
  };
}

/**
 * Kiểm tra và trích xuất file ảnh từ Request:
 * 1. Giới hạn stream body toàn request ở 5 MiB + 64 KiB overhead (trả 413 nếu vượt).
 * 2. Parse multipart từ body đã giới hạn an toàn.
 * 3. Chỉ chấp nhận duy nhất một trường "image", từ chối nhiều trường hoặc trường lạ.
 * 4. Giữ giới hạn file ảnh ở 5 MiB.
 * 5. Xác định chữ ký nhị phân Magic Bytes JPEG/PNG/WebP.
 */
export async function validateImageRequest(req: Request): Promise<ImageValidationResult> {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return {
      valid: false,
      status: 400,
      error: 'invalid_content_type',
      message: 'Yêu cầu phải ở định dạng multipart/form-data với trường "image".',
    };
  }

  // 1. Đọc stream có giới hạn (chặn request quá lớn kể cả khi thiếu hoặc giả mạo Content-Length)
  const bodyRead = await readBodyWithLimit(req, MAX_REQUEST_BYTES);
  if (!bodyRead.success || !bodyRead.data) {
    return {
      valid: false,
      status: bodyRead.status || 400,
      error: bodyRead.error || 'read_error',
      message: bodyRead.message || 'Không thể đọc dữ liệu yêu cầu.',
    };
  }

  // 2. Tái tạo Request nội bộ từ buffer đã giới hạn an toàn để parse FormData
  const boundedRequest = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: bodyRead.data as unknown as BodyInit,
  });

  let formData: FormData;
  try {
    formData = await boundedRequest.formData();
  } catch {
    return {
      valid: false,
      status: 400,
      error: 'form_parse_error',
      message: 'Không thể giải mã cấu trúc multipart/form-data từ request.',
    };
  }

  // 3. Kiểm tra các trường trong FormData: Chỉ cho phép duy nhất 1 trường "image"
  let imageBlob: Blob | null = null;
  let imageFieldCount = 0;

  for (const [fieldName, fieldValue] of formData.entries()) {
    if (fieldName !== 'image') {
      return {
        valid: false,
        status: 400,
        error: 'unexpected_form_field',
        message: `Phát hiện trường dữ liệu không mong muốn "${fieldName}". Yêu cầu chỉ được phép chứa duy nhất trường "image".`,
      };
    }

    imageFieldCount++;
    if (imageFieldCount > 1) {
      return {
        valid: false,
        status: 400,
        error: 'multiple_image_fields',
        message: 'Chỉ được gửi duy nhất một file ảnh trong trường "image".',
      };
    }

    if (fieldValue instanceof Blob) {
      imageBlob = fieldValue;
    }
  }

  if (!imageBlob) {
    return {
      valid: false,
      status: 400,
      error: 'missing_image_field',
      message: 'Thiếu file ảnh trong trường "image".',
    };
  }

  // 4. Kiểm tra kích thước file ảnh thực tế (Giới hạn tối đa 5 MiB)
  const actualSize = imageBlob.size;
  if (actualSize === 0) {
    return {
      valid: false,
      status: 400,
      error: 'empty_file',
      message: 'File ảnh tải lên rỗng (0 bytes).',
    };
  }

  if (actualSize > MAX_IMAGE_BYTES) {
    const sizeInMb = (actualSize / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      status: 413,
      error: 'file_too_large',
      message: `Dung lượng file ảnh thực tế (${sizeInMb} MiB) vượt quá giới hạn cho phép là 5 MiB.`,
    };
  }

  // 5. Đọc byte dữ liệu file để nhận dạng chữ ký
  const arrayBuffer = await imageBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // 6. Nhận dạng chữ ký nhị phân định dạng (Magic Bytes)
  const detectedMime = detectImageMimeType(bytes);
  if (!detectedMime) {
    return {
      valid: false,
      status: 400,
      error: 'unsupported_image_signature',
      message:
        'Chữ ký định dạng file không khớp với các định dạng được hỗ trợ. Hệ thống chỉ chấp nhận ảnh định dạng JPEG, PNG hoặc WebP.',
    };
  }

  const base64 = uint8ArrayToBase64(bytes);

  return {
    valid: true,
    status: 200,
    bytes,
    mimeType: detectedMime,
    base64,
  };
}
