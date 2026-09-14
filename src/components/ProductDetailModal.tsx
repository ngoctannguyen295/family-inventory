import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';
import { formatCurrency } from '../utils/formatters';
import { ProductImage } from './ProductImage';

interface ProductDetailModalProps {
  isOpen: boolean;
  product: Product | null;
  canEdit?: boolean;
  onClose: () => void;
  onEdit?: (product: Product, triggerEl: HTMLElement) => void;
  onViewHistory?: (product: Product, triggerEl: HTMLElement) => void;
  onOpenDeleteConfirm?: (product: Product) => void;
  triggerElementRef?: React.RefObject<HTMLElement | null>;
}

export function ProductDetailModal({
  isOpen,
  product,
  canEdit,
  onClose,
  onEdit,
  onViewHistory,
  onOpenDeleteConfirm,
  triggerElementRef,
}: ProductDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      closeBtnRef.current?.focus();
    }
  }, [isOpen]);

  const handleClose = () => {
    onClose();
    if (triggerElementRef?.current) {
      triggerElementRef.current.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  };

  if (!isOpen || !product) {
    return null;
  }

  const isOutOfStock = product.stock <= 0;

  return (
    <div
      className="modal-backdrop"
      onClick={handleClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="modal-content product-detail-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-name"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="modal-header">
          <div>
            <span className="detail-category-badge">{product.category}</span>
            <h2 id="product-detail-name" className="detail-modal-title">
              {product.name}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Đóng cửa sổ chi tiết sản phẩm"
          >
            ✕
          </button>
        </div>

        {/* Thân Modal */}
        <div className="detail-modal-body">
          {/* Khu vực ảnh sản phẩm lớn */}
          <div className="detail-image-wrapper">
            <ProductImage
              storagePath={product.imageUrl}
              alt={product.name}
              className="detail-product-img"
            />
            {isOutOfStock && (
              <span className="out-of-stock-badge detail-stock-badge">
                Hết hàng
              </span>
            )}
          </div>

          {/* Lưới thông tin chi tiết */}
          <div className="detail-info-grid">
            <div className="detail-info-item">
              <span className="detail-info-label">Mã hàng:</span>
              <code className="detail-code-badge">{product.code}</code>
            </div>

            <div className="detail-info-item">
              <span className="detail-info-label">Mã vạch:</span>
              <span className="detail-barcode-text">
                {product.barcode || <em className="text-muted">Chưa có mã vạch</em>}
              </span>
            </div>

            <div className="detail-info-item highlight-price-item">
              <span className="detail-info-label">Giá bán:</span>
              <strong className="detail-sale-price">
                {formatCurrency(product.salePrice)}
              </strong>
            </div>

            <div className="detail-info-item">
              <span className="detail-info-label">Giá nhập:</span>
              <span className="detail-purchase-price">
                {formatCurrency(product.purchasePrice)}
              </span>
            </div>

            <div className="detail-info-item">
              <span className="detail-info-label">Tồn kho:</span>
              <span
                className={`stock-badge ${
                  isOutOfStock ? 'stock-empty' : 'stock-available'
                }`}
              >
                <span className="stock-dot" aria-hidden="true"></span>
                <strong>
                  {product.stock} {product.unit}
                </strong>
              </span>
            </div>

            <div className="detail-info-item">
              <span className="detail-info-label">Đơn vị:</span>
              <span>{product.unit}</span>
            </div>

            {product.notes && product.notes.trim() !== '' && (
              <div className="detail-info-item full-width-item detail-notes-item">
                <span className="detail-info-label">Ghi chú:</span>
                <p className="detail-notes-text">{product.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Thanh công cụ hành động ở đáy modal */}
        <div className="detail-modal-footer">
          <div className="footer-left-actions">
            {onViewHistory && (
              <button
                type="button"
                className="btn-detail-history"
                onClick={(e) => onViewHistory(product, e.currentTarget)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>Xem lịch sử</span>
              </button>
            )}

            {canEdit && onOpenDeleteConfirm && (
              <button
                type="button"
                className="btn-detail-delete"
                onClick={() => onOpenDeleteConfirm(product)}
                title="Xóa mềm sản phẩm và đưa vào mục Đã xóa"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
                <span>Xóa sản phẩm</span>
              </button>
            )}
          </div>

          <div className="footer-right-actions">
            {canEdit && onEdit && (
              <button
                type="button"
                className="btn-primary btn-detail-edit"
                onClick={(e) => onEdit(product, e.currentTarget)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
                <span>Chỉnh sửa</span>
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClose}
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductDetailModal;
