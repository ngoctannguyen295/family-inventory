import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';
import { formatVietnamDateTime } from '../utils/formatters';
import { ProductImage } from './ProductImage';

interface DeletedProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  deletedProducts: Product[];
  isLoading: boolean;
  error?: string | null;
  onRestore: (product: Product) => Promise<void>;
  onRetry: () => void;
  isOnline?: boolean;
}

export function DeletedProductsModal({
  isOpen,
  onClose,
  deletedProducts,
  isLoading,
  error,
  onRestore,
  onRetry,
  isOnline = true,
}: DeletedProductsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      closeBtnRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !restoringId) {
      e.stopPropagation();
      onClose();
    }
  };

  const handleRestoreClick = async (product: Product) => {
    if (restoringId || !isOnline) return;
    setRestoringId(product.id);
    try {
      await onRestore(product);
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!restoringId) onClose();
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="modal-content deleted-products-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deleted-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="deleted-modal-title" className="modal-title">
              Sản phẩm đã xóa ({deletedProducts.length})
            </h2>
            <p className="modal-subtitle">
              Danh sách các mặt hàng đã xóa mềm. Bạn có thể khôi phục lại bất kỳ lúc nào.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={Boolean(restoringId)}
            aria-label="Đóng cửa sổ sản phẩm đã xóa"
          >
            ✕
          </button>
        </div>

        <div className="deleted-modal-body">
          {!isOnline && (
            <div className="modal-alert-error" role="alert">
              <span className="alert-icon" aria-hidden="true">⚠️</span>
              <p>Đang mất kết nối mạng. Bạn không thể thực hiện thao tác khôi phục lúc này.</p>
            </div>
          )}

          {isLoading && (
            <div className="state-panel loading-panel">
              <div className="loading-spinner small" aria-hidden="true"></div>
              <span>Đang tải danh sách sản phẩm đã xóa...</span>
            </div>
          )}

          {error && !isLoading && (
            <div className="state-panel error-panel">
              <p>{error}</p>
              <button type="button" className="btn-retry" onClick={onRetry}>
                Thử lại
              </button>
            </div>
          )}

          {!isLoading && !error && deletedProducts.length === 0 && (
            <div className="deleted-empty-state">
              <div className="deleted-empty-icon" aria-hidden="true">
                🗑️
              </div>
              <h3 className="deleted-empty-title">Mục Đã xóa đang trống</h3>
              <p className="deleted-empty-desc">
                Chưa có sản phẩm nào bị xóa trong kho gia đình.
              </p>
            </div>
          )}

          {!isLoading && !error && deletedProducts.length > 0 && (
            <div className="deleted-products-list">
              {deletedProducts.map((product) => {
                const isThisRestoring = restoringId === product.id;

                return (
                  <div key={product.id} className="deleted-product-item">
                    <div className="deleted-item-img-box">
                      <ProductImage
                        storagePath={product.imageUrl}
                        alt={product.name}
                        className="deleted-item-img"
                      />
                    </div>

                    <div className="deleted-item-info">
                      <span className="deleted-item-category">{product.category}</span>
                      <h4 className="deleted-item-name">{product.name}</h4>
                      <div className="deleted-item-meta">
                        <span>Mã hàng: <code>{product.code}</code></span>
                        {product.deletedAt && (
                          <span className="deleted-timestamp">
                            Đã xóa: {formatVietnamDateTime(product.deletedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="deleted-item-actions">
                      <button
                        type="button"
                        className="btn-restore-product"
                        onClick={() => handleRestoreClick(product)}
                        disabled={Boolean(restoringId) || !isOnline}
                        title="Khôi phục sản phẩm này trở lại danh mục đang dùng"
                      >
                        {isThisRestoring ? (
                          <span className="btn-loading-state">
                            <span className="spinner-dot" aria-hidden="true"></span>
                            Đang khôi phục...
                          </span>
                        ) : (
                          <>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                            <span>Khôi phục</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={Boolean(restoringId)}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeletedProductsModal;
