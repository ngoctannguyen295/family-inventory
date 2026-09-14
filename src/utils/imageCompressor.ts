/**
 * Client-side Image Optimization Utility
 * Thu nhỏ và nén ảnh bao bì sản phẩm trước khi gửi lên Supabase Edge Function
 * - Giới hạn cạnh dài tối đa trong khoảng 1280px - 1600px
 * - Nén định dạng JPEG chất lượng 0.85
 * - Không phóng to ảnh nhỏ hơn ngưỡng
 * - Tôn trọng chiều xoay ảnh chụp (Orientation)
 * - Đo đạc thời gian nén máy khách và dung lượng trước/sau
 */

export interface CompressionResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  durationMs: number;
  wasResized: boolean;
  width: number;
  height: number;
}

export const MAX_TARGET_DIMENSION = 1600; // Cạnh dài tối đa (px) phù hợp cho OCR bao bì
export const COMPRESSION_QUALITY = 0.85; // Chất lượng nén JPEG tối ưu độ sắc nét chữ

/**
 * Tải ảnh từ file thành Image element an toàn với Promise
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không thể tải dữ liệu ảnh từ file.'));
    };

    img.src = objectUrl;
  });
}

/**
 * Nén và thu nhỏ ảnh trên máy khách (Client-side Image Compression)
 */
export async function compressImageClient(
  file: File,
  maxDimension = MAX_TARGET_DIMENSION,
  quality = COMPRESSION_QUALITY
): Promise<CompressionResult> {
  const startTime = performance.now();
  const originalBytes = file.size;

  try {
    let sourceWidth = 0;
    let sourceHeight = 0;
    let drawableSource: ImageBitmap | HTMLImageElement;

    // 1. Thử dùng createImageBitmap (hỗ trợ tự động xoay theo EXIF orientation)
    if (typeof window.createImageBitmap === 'function') {
      try {
        const bitmap = await window.createImageBitmap(file, {
          imageOrientation: 'from-image',
        });
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
        drawableSource = bitmap;
      } catch {
        // Fallback sang HTMLImageElement thông thường
        const img = await loadImageFromFile(file);
        sourceWidth = img.naturalWidth || img.width;
        sourceHeight = img.naturalHeight || img.height;
        drawableSource = img;
      }
    } else {
      const img = await loadImageFromFile(file);
      sourceWidth = img.naturalWidth || img.width;
      sourceHeight = img.naturalHeight || img.height;
      drawableSource = img;
    }

    const longestSide = Math.max(sourceWidth, sourceHeight);

    // 2. Nếu ảnh gốc đã nhỏ hơn hoặc bằng kích thước mục tiêu và dung lượng < 1.5 MB,
    // giữ nguyên không nén lại để tiết kiệm tài nguyên máy khách
    if (longestSide <= maxDimension && originalBytes <= 1.5 * 1024 * 1024) {
      const durationMs = Math.round(performance.now() - startTime);
      if ('close' in drawableSource && typeof drawableSource.close === 'function') {
        drawableSource.close();
      }
      return {
        file,
        originalBytes,
        compressedBytes: originalBytes,
        durationMs,
        wasResized: false,
        width: sourceWidth,
        height: sourceHeight,
      };
    }

    // 3. Tính toán kích thước mới (giữ nguyên tỷ lệ, tuyệt đối không phóng to)
    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;

    if (longestSide > maxDimension) {
      const scale = maxDimension / longestSide;
      targetWidth = Math.round(sourceWidth * scale);
      targetHeight = Math.round(sourceHeight * scale);
    }

    // 4. Vẽ ảnh lên Canvas để thu nhỏ
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Không thể khởi tạo Canvas 2D context để xử lý ảnh.');
    }

    // Tinh chỉnh làm mượt ảnh khi scale down
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(drawableSource, 0, 0, targetWidth, targetHeight);

    if ('close' in drawableSource && typeof drawableSource.close === 'function') {
      drawableSource.close();
    }

    // 5. Xuất ra Blob JPEG
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        'image/jpeg',
        quality
      );
    });

    if (!compressedBlob) {
      throw new Error('Canvas toBlob không tạo được dữ liệu ảnh.');
    }

    // Tạo File mới với tên gọn
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const compressedFile = new File([compressedBlob], `${baseName}-optimized.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });

    const durationMs = Math.round(performance.now() - startTime);
    const compressedBytes = compressedFile.size;

    console.log(
      `[IMAGE_CLIENT_RESIZE] ${sourceWidth}x${sourceHeight} -> ${targetWidth}x${targetHeight} | ` +
      `${(originalBytes / 1024).toFixed(1)}KB -> ${(compressedBytes / 1024).toFixed(1)}KB ` +
      `(${Math.round((1 - compressedBytes / originalBytes) * 100)}% giảm) in ${durationMs}ms`
    );

    return {
      file: compressedFile,
      originalBytes,
      compressedBytes,
      durationMs,
      wasResized: true,
      width: targetWidth,
      height: targetHeight,
    };
  } catch (error) {
    // Nếu có bất kỳ lỗi nào trong quá trình nén trên máy khách, an toàn sử dụng file gốc
    const durationMs = Math.round(performance.now() - startTime);
    console.warn('[IMAGE_CLIENT_RESIZE_FALLBACK] Sử dụng file gốc do lỗi:', error);
    return {
      file,
      originalBytes,
      compressedBytes: originalBytes,
      durationMs,
      wasResized: false,
      width: 0,
      height: 0,
    };
  }
}
