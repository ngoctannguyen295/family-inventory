import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface PwaUpdatePromptProps {
  isFormDirty: boolean;
  onBlockedByDirtyForm: () => void;
}

/**
 * Hộp thoại thông báo khi có phiên bản mới của ứng dụng (registerType: 'prompt')
 * Đảm bảo chỉ tải lại khi người dùng chọn "Cập nhật" và kiểm tra an toàn dữ liệu chưa lưu.
 */
export function PwaUpdatePrompt({
  isFormDirty,
  onBlockedByDirtyForm,
}: PwaUpdatePromptProps) {
  const [showDirtyWarning, setShowDirtyWarning] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (r) {
        // Kiểm tra cập nhật định kỳ mỗi 60 phút
        setInterval(() => {
          r.update();
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('Lỗi đăng ký Service Worker:', error);
    },
  });

  if (!needRefresh) {
    return null;
  }

  const handleUpdate = async () => {
    // Nếu có thay đổi chưa lưu trong biểu mẫu sản phẩm, yêu cầu xử lý trước
    if (isFormDirty) {
      setShowDirtyWarning(true);
      onBlockedByDirtyForm();
      return;
    }

    setShowDirtyWarning(false);
    await updateServiceWorker(true);
  };

  const handleDismiss = () => {
    setShowDirtyWarning(false);
    setNeedRefresh(false);
  };

  return (
    <div className="pwa-update-prompt" role="alert" aria-live="assertive">
      <div className="pwa-update-card">
        <div className="pwa-update-header">
          <span className="pwa-update-icon" aria-hidden="true">
            ✨
          </span>
          <div className="pwa-update-texts">
            <h4 className="pwa-update-title">Có phiên bản mới</h4>
            <p className="pwa-update-desc">
              Ứng dụng đã có bản cập nhật giao diện mới nhất.
            </p>
          </div>
        </div>

        {showDirtyWarning && (
          <div className="pwa-dirty-warning" role="alert">
            <span>
              ⚠️ Bạn có thay đổi chưa lưu trong biểu mẫu sản phẩm. Vui lòng lưu
              hoặc hủy thay đổi trước khi tải lại.
            </span>
          </div>
        )}

        <div className="pwa-update-actions">
          <button
            type="button"
            className="btn-primary btn-pwa-update"
            onClick={handleUpdate}
          >
            Cập nhật
          </button>
          <button
            type="button"
            className="btn-secondary btn-pwa-dismiss"
            onClick={handleDismiss}
          >
            Để sau
          </button>
        </div>
      </div>
    </div>
  );
}
