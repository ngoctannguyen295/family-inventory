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
 * Tạo constraints cấu hình camera ưu tiên camera sau và độ phân giải 1280x720 ideal
 */
export function createCameraConstraints(
  cameraIdOverride?: string,
  selectedCameraId?: string
): { primary: MediaTrackConstraints; fallback: MediaTrackConstraints } {
  const deviceId = cameraIdOverride || selectedCameraId;

  if (deviceId) {
    return {
      primary: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      fallback: {
        deviceId: { exact: deviceId },
      },
    };
  }

  return {
    primary: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    fallback: {
      facingMode: 'environment',
    },
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
