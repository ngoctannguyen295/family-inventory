interface OfflineBannerProps {
  isOnline: boolean;
  hasDisplayedData: boolean;
}

/**
 * Banner cảnh báo khi mất kết nối mạng, đảm bảo thông tin minh bạch
 * rằng dữ liệu kho cần kết nối mạng để tải/lưu, không gây hiểu nhầm app hoạt động offline.
 */
export function OfflineBanner({ isOnline, hasDisplayedData }: OfflineBannerProps) {
  if (isOnline) {
    return null;
  }

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <div className="offline-banner-content">
        <span className="offline-banner-icon" aria-hidden="true">
          ⚡
        </span>
        <div className="offline-banner-texts">
          <strong className="offline-banner-title">
            Đang mất kết nối. Kết nối mạng để tải hoặc lưu dữ liệu.
          </strong>
          {hasDisplayedData && (
            <p className="offline-banner-subtitle">
              Dữ liệu trên màn hình chưa được làm mới do đang mất kết nối.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
