/**
 * Module điều phối và hỗ trợ quét mã vạch BarcodeScannerModal
 * Cung cấp:
 * 1. Tính toán vùng quét responsive cho mã vạch 1D (EAN-13, Code-128, UPC-A)
 * 2. Quản lý phiên quét (Session / Generation ID) chống race condition khi start/stop/đổi camera/đổi tab
 * 3. Cấu hình constraints camera (ưu tiên 720p, continuous autofocus) có fallback an toàn
 * 4. Chuẩn hóa chuỗi mã vạch, bảo toàn số 0 ở đầu
 */

export interface ScanRegionDimensions {
  width: number;
  height: number;
}

/**
 * Tính toán vùng quét responsive tối ưu cho mã vạch 1D
 * Đảm bảo:
 * - Vùng quét đủ rộng ngang (khoảng 80% chiều rộng khung ngắm) để không cắt mất 2 đầu mã vạch và khoảng trắng lề (quiet zones).
 * - Chiều cao tỷ lệ khoảng 35% - 45% chiều rộng (vừa vặn với dạng dải chữ nhật của mã vạch).
 * - Không bao giờ vượt quá kích thước thực tế của viewfinder/video.
 */
export function calculateScanRegion(
  viewfinderWidth: number,
  viewfinderHeight: number
): ScanRegionDimensions {
  const safeWidth = Math.max(1, Math.floor(viewfinderWidth));
  const safeHeight = Math.max(1, Math.floor(viewfinderHeight));

  // Chiều rộng quét ưu tiên 82% chiều rộng khung ngắm, chừa lề tối thiểu 16px mỗi bên
  const maxWidth = Math.max(safeWidth - 32, Math.floor(safeWidth * 0.9));
  let width = Math.floor(safeWidth * 0.82);

  // Giới hạn trong khoảng khả thi của khung ngắm
  width = Math.min(width, maxWidth);
  width = Math.max(width, Math.min(200, safeWidth - 16));
  // Đảm bảo không vượt quá safeWidth
  width = Math.min(width, safeWidth);

  // Chiều cao quét cho mã vạch 1D: tỷ lệ khoảng 40% chiều rộng, tối thiểu 80px, tối đa 160px
  let height = Math.floor(width * 0.42);
  const maxHeight = Math.max(safeHeight - 32, Math.floor(safeHeight * 0.7));
  height = Math.min(height, maxHeight, 160);
  height = Math.max(height, Math.min(80, safeHeight - 16));
  // Đảm bảo không vượt quá safeHeight
  height = Math.min(height, safeHeight);

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

/**
 * Chuẩn hóa mã vạch: giữ nguyên kiểu chuỗi (string), bảo toàn các số 0 ở đầu
 * Tuyệt đối không parse sang Number
 */
export function normalizeBarcode(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return '';
  }
  return String(raw).trim();
}

/**
 * Loại lỗi camera đã được phân loại
 */
export type CameraErrorType =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'BUSY_OR_IN_USE'
  | 'OVERCONSTRAINED'
  | 'PLAYBACK_ERROR'
  | 'UNKNOWN';

export interface ParsedCameraErrorInfo {
  type: CameraErrorType;
  friendlyMessage: string;
  rawName: string;
  rawMessage: string;
}

/**
 * Phân tích và trích xuất chi tiết lỗi khi khởi động camera
 * Xử lý cả instance Error/DOMException và chuỗi từ chối từ html5-qrcode
 */
export function parseCameraError(err: unknown): ParsedCameraErrorInfo {
  let rawName = '';
  let rawMessage: string;

  if (err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err)) {
    rawName = String((err as { name?: unknown }).name || '');
    rawMessage = String((err as { message?: unknown }).message || '');
  } else if (typeof err === 'string') {
    rawMessage = err;
    const match = err.match(
      /(NotAllowedError|PermissionDeniedError|NotFoundError|DevicesNotFoundError|NotReadableError|TrackStartError|OverconstrainedError|ConstraintNotSatisfiedError|AbortError)/i
    );
    if (match) {
      rawName = match[1];
    }
  } else {
    rawMessage = String(err);
  }

  const lowerName = rawName.toLowerCase();
  const lowerMsg = rawMessage.toLowerCase();

  // 1. Phân biệt quyền truy cập bị từ chối
  if (
    lowerName === 'notallowederror' ||
    lowerName === 'permissiondeniederror' ||
    lowerMsg.includes('permission') ||
    lowerMsg.includes('not allowed') ||
    lowerMsg.includes('denied')
  ) {
    return {
      type: 'PERMISSION_DENIED',
      friendlyMessage:
        'Quyền truy cập camera bị từ chối. Vui lòng cho phép quyền camera trong cài đặt trình duyệt (hoặc Cài đặt > Safari trên iPhone) và thử lại.',
      rawName: rawName || 'NotAllowedError',
      rawMessage,
    };
  }

  // 2. Không tìm thấy thiết bị camera
  if (
    lowerName === 'notfounderror' ||
    lowerName === 'devicesnotfounderror' ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('no camera')
  ) {
    return {
      type: 'NOT_FOUND',
      friendlyMessage: 'Không tìm thấy thiết bị camera trên máy của bạn.',
      rawName: rawName || 'NotFoundError',
      rawMessage,
    };
  }

  // 3. Camera đang bận hoặc bị ứng dụng khác chiếm giữ
  if (
    lowerName === 'notreadableerror' ||
    lowerName === 'trackstarterror' ||
    lowerMsg.includes('notreadable') ||
    lowerMsg.includes('in use') ||
    lowerMsg.includes('could not start video source') ||
    lowerMsg.includes('busy')
  ) {
    return {
      type: 'BUSY_OR_IN_USE',
      friendlyMessage:
        'Camera đang bận hoặc đang được sử dụng bởi một ứng dụng khác (hoặc luồng camera trước chưa giải phóng). Vui lòng đóng ứng dụng khác hoặc bấm Thử lại.',
      rawName: rawName || 'NotReadableError',
      rawMessage,
    };
  }

  // 4. Cấu hình không được thiết bị hỗ trợ
  if (
    lowerName === 'overconstrainederror' ||
    lowerName === 'constraintnotsatisfiederror' ||
    lowerMsg.includes('overconstrained') ||
    lowerMsg.includes('constraint')
  ) {
    return {
      type: 'OVERCONSTRAINED',
      friendlyMessage: 'Cấu hình camera không được thiết bị hỗ trợ.',
      rawName: rawName || 'OverconstrainedError',
      rawMessage,
    };
  }

  // 5. Lỗi phát luồng video (playsinline / autoplay)
  if (
    lowerName === 'aborterror' ||
    lowerMsg.includes('play()') ||
    lowerMsg.includes('video surface') ||
    lowerMsg.includes('streaming not supported')
  ) {
    return {
      type: 'PLAYBACK_ERROR',
      friendlyMessage: 'Lỗi khi phát video từ camera trên màn hình (autoplay hoặc playsinline).',
      rawName: rawName || 'PlaybackError',
      rawMessage,
    };
  }

  // 6. Lỗi không xác định
  return {
    type: 'UNKNOWN',
    friendlyMessage:
      'Không thể khởi động camera. Vui lòng thử lại hoặc chọn cách đọc mã vạch từ ảnh.',
    rawName: rawName || 'CameraInitError',
    rawMessage,
  };
}

/**
 * Tạo constraints cấu hình camera tương thích 100% với hàm createVideoConstraints của html5-qrcode
 * html5-qrcode yêu cầu object truyền vào phải có DUY NHẤT 1 key: 'facingMode' hoặc 'deviceId'
 */
export function createCameraConstraints(
  cameraIdOverride?: string,
  selectedCameraId?: string
): { primary: MediaTrackConstraints | string; fallback: MediaTrackConstraints | string } {
  const deviceId = cameraIdOverride || selectedCameraId;

  if (deviceId) {
    return {
      primary: { deviceId: { exact: deviceId } },
      fallback: { facingMode: 'environment' },
    };
  }

  return {
    primary: { facingMode: 'environment' },
    fallback: { facingMode: 'user' },
  };
}

/**
 * Áp dụng Continuous Autofocus sau khi camera đã chạy nếu thiết bị thực sự hỗ trợ
 * Tuyệt đối không ép buộc trong getUserMedia để tránh OverconstrainedError
 */
export async function applyContinuousFocusIfSupported(
  videoElement: HTMLVideoElement | null
): Promise<boolean> {
  if (!videoElement) return false;

  try {
    const stream = videoElement.srcObject as MediaStream | null;
    if (!stream) return false;

    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capabilities = track.getCapabilities() as any;
    if (!capabilities) return false;

    // Kiểm tra focusMode continuous
    if (
      Array.isArray(capabilities.focusMode) &&
      capabilities.focusMode.includes('continuous') &&
      typeof track.applyConstraints === 'function'
    ) {
      try {
        await track.applyConstraints({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          advanced: [{ focusMode: 'continuous' } as any],
        });
        return true;
      } catch {
        // Thiết bị từ chối áp dụng constraint, không làm gián đoạn luồng
        return false;
      }
    }
  } catch {
    // Tránh bất kỳ lỗi nào làm gãy luồng quét
  }

  return false;
}

/**
 * Interface cho scanner instance tối thiểu của Html5Qrcode
 */
export interface MinimalHtml5QrcodeInstance {
  isScanning?: boolean;
  getState?: () => number;
  stop: () => Promise<void>;
  clear: () => void;
}

/**
 * Quản lý phiên quét và tuần tự hóa start/stop (Session / Generation Manager)
 * Ngăn chặn race condition khi:
 * - Người dùng bấm đóng modal trong khi start() đang chạy dở
 * - Người dùng đổi camera hoặc đổi tab liên tục
 * - Nhận kết quả quét muộn từ phiên đã kết thúc
 */
export class BarcodeScannerSessionManager {
  private currentSessionId = 0;
  private actionQueue: Promise<void> = Promise.resolve();
  private activeScanner: MinimalHtml5QrcodeInstance | null = null;
  private isDestroyed = false;

  /**
   * Tạo phiên quét mới và hủy bỏ phiên quét cũ
   */
  startNewSession(): number {
    this.currentSessionId += 1;
    this.isDestroyed = false;
    return this.currentSessionId;
  }

  /**
   * Lấy ID của phiên hiện tại
   */
  getCurrentSessionId(): number {
    return this.currentSessionId;
  }

  /**
   * Kiểm tra xem một session ID có còn là phiên đang hoạt động không
   */
  isSessionActive(sessionId: number): boolean {
    return !this.isDestroyed && sessionId === this.currentSessionId;
  }

  /**
   * Hủy phiên quét hiện tại (ví dụ khi đóng modal hoặc chuyển tab)
   */
  invalidateSession(): void {
    this.currentSessionId += 1;
    this.isDestroyed = true;
  }

  /**
   * Đăng ký scanner instance đang hoạt động
   */
  setActiveScanner(scanner: MinimalHtml5QrcodeInstance | null): void {
    this.activeScanner = scanner;
  }

  /**
   * Lấy scanner instance đang hoạt động
   */
  getActiveScanner(): MinimalHtml5QrcodeInstance | null {
    return this.activeScanner;
  }

  /**
   * Tuần tự hóa một tác vụ async vào hàng đợi để ngăn các cuộc gọi start/stop chồng chéo
   */
  enqueueAction<T>(action: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.actionQueue = this.actionQueue
        .then(async () => {
          try {
            const result = await action();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * Dừng an toàn một scanner instance:
   * - Đợi stop() hoàn tất trước khi gọi clear()
   * - Bỏ qua lỗi stop() nếu camera đã tự đóng, nhưng vẫn gọi clear()
   */
  async safeStopAndClear(scanner: MinimalHtml5QrcodeInstance | null): Promise<void> {
    if (!scanner) return;

    try {
      // Html5QrcodeScannerState: SCANNING = 2, PAUSED = 3
      const isScanning =
        scanner.isScanning ??
        (typeof scanner.getState === 'function' ? scanner.getState() === 2 : false);

      if (isScanning) {
        await scanner.stop();
      }
    } catch {
      // Bỏ qua lỗi stop nếu media stream đã ngắt trước đó
    } finally {
      try {
        scanner.clear();
      } catch {
        // Bỏ qua lỗi clear
      }
      if (this.activeScanner === scanner) {
        this.activeScanner = null;
      }
    }
  }

  /**
   * Dọn dẹp toàn bộ tài nguyên khi component unmount
   */
  async cleanup(): Promise<void> {
    this.invalidateSession();
    const scanner = this.activeScanner;
    this.activeScanner = null;
    await this.safeStopAndClear(scanner);
  }
}
