/**
 * Camera Coordinator
 * Điều phối tài nguyên camera toàn cục giữa các tính năng (Quét mã vạch và Tìm bằng ảnh)
 * Đảm bảo trên iOS Safari (chỉ cho phép 1 camera stream hoạt động) không xảy ra xung đột NotReadableError
 */

export type CameraFeatureOwner = 'barcode' | 'image-search';

let currentCameraOwner: CameraFeatureOwner | null = null;

/**
 * Lấy tính năng hiện đang giữ camera
 */
export function getActiveCameraOwner(): CameraFeatureOwner | null {
  return currentCameraOwner;
}

/**
 * Dừng toàn bộ MediaStreamTrack trên mọi video element và stream trong tài liệu
 */
export function stopAllMediaTracks(): void {
  try {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach((video) => {
      const stream = video.srcObject as MediaStream | null;
      if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => {
          try {
            track.enabled = false;
            track.stop();
          } catch {
            // Bỏ qua lỗi dừng track
          }
        });
      }
      try {
        video.srcObject = null;
      } catch {
        // Bỏ qua lỗi ngắt kết nối srcObject
      }
    });
  } catch {
    // Phòng ngừa lỗi truy cập DOM
  }
}

/**
 * Yêu cầu quyền sở hữu camera cho một tính năng.
 * Tự động dừng mọi stream của tính năng khác trước đó và chờ một khoảng thời gian nhỏ (100ms)
 * để phần cứng iOS Safari kịp giải phóng hoàn toàn thiết bị trước khi stream mới được tạo.
 */
export async function requestCameraLock(owner: CameraFeatureOwner): Promise<void> {
  if (currentCameraOwner && currentCameraOwner !== owner) {
    stopAllMediaTracks();
    // Chờ 100ms để WebKit/iOS giải phóng camera session ở mức phần cứng
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  currentCameraOwner = owner;
}

/**
 * Giải phóng quyền sở hữu camera khi một tính năng đóng lại
 */
export function releaseCameraLock(owner: CameraFeatureOwner): void {
  if (currentCameraOwner === owner) {
    currentCameraOwner = null;
    stopAllMediaTracks();
  }
}
