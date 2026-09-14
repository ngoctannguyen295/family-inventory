import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';

interface ProductDeleteConfirmModalProps {
  isOpen: boolean;
  product: Product | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
  error?: string | null;
  isOnline?: boolean;
}

export function ProductDeleteConfirmModal({
  isOpen,
  product,
  onCancel,
  onConfirm,
  isDeleting,
  error,
  isOnline = true,
}: ProductDeleteConfirmModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Đặt tiêu điểm ban đầu vào nút "Hủy" theo đúng yêu cầu bảo đảm an toàn
  useEffect(() => {
    if (isOpen) {
      // Đợi modal render để focus
      const timer = setTimeout(() => {
        cancelBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Xử lý phím Escape để đóng hộp xác nhận và quay lại modal chi tiết
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !isDeleting) {
      e.stopPropagation();
      onCancel();
    }
  };

  if (!isOpen || !product) {
    return null;
  }

  return (
    <div
      className="modal-backdrop confirm-modal-backdrop"
      onClick={() => {
        if (!isDeleting) onCancel();
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="modal-content confirm-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-icon-wrapper" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="confirm-danger-icon"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </div>

        <h3 id="delete-confirm-title" className="confirm-modal-title">
          Xóa &ldquo;{product.name}&rdquo;?
        </h3>

        <div className="confirm-product-code-badge">
          <span>Mã hàng: <code>{product.code}</code></span>
        </div>

        <p id="delete-confirm-desc" className="confirm-modal-description">
          Sản phẩm sẽ được chuyển vào mục <strong>Đã xóa</strong>. Bạn có thể khôi phục nếu xóa nhầm.
        </p>

        {!isOnline && (
          <div className="modal-alert-error" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <p>Đang mất kết nối mạng. Bạn không thể thực hiện xóa sản phẩm lúc này.</p>
          </div>
        )}

        {error && isOnline && (
          <div className="modal-alert-error" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <p>{error}</p>
          </div>
        )}

        <div className="confirm-modal-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn-secondary btn-cancel-confirm"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Hủy
          </button>
          <button
            type="button"
            className="btn-danger btn-execute-delete"
            onClick={onConfirm}
            disabled={isDeleting || !isOnline}
          >
            {isDeleting ? (
              <span className="btn-loading-state">
                <span className="spinner-dot" aria-hidden="true"></span>
                Đang xóa...
              </span>
            ) : (
              'Xác nhận xóa'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
