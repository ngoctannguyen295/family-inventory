import type { Product } from '../types/product';
import { formatCurrency } from '../utils/formatters';
import { ProductImage } from './ProductImage';

interface ProductCardProps {
  product: Product;
  canEdit?: boolean;
  onEdit?: (product: Product, triggerEl: HTMLElement) => void;
  onViewHistory?: (product: Product, triggerEl: HTMLElement) => void;
}

export function ProductCard({ product, canEdit, onEdit, onViewHistory }: ProductCardProps) {
  const isOutOfStock = product.stock <= 0;

  return (
    <article className={`product-card ${isOutOfStock ? 'out-of-stock-card' : ''}`}>
      <div className="product-image-container">
        <ProductImage
          storagePath={product.imageUrl}
          alt={product.name}
          className="product-image"
          loading="lazy"
        />
        <span className="product-category-tag">{product.category}</span>
        {isOutOfStock && (
          <div className="out-of-stock-badge" aria-label="Sản phẩm hết hàng">
            Hết hàng
          </div>
        )}
      </div>

      <div className="product-details">
        <h2 className="product-name" title={product.name}>
          {product.name}
        </h2>

        <div className="product-codes">
          <div className="code-item">
            <span className="code-label">Mã hàng:</span>
            <code className="code-value">{product.code}</code>
          </div>
          <div className="code-item">
            <span className="code-label">Mã vạch:</span>
            {product.barcode ? (
              <span className="barcode-value">{product.barcode}</span>
            ) : (
              <span className="barcode-none">Chưa có</span>
            )}
          </div>
        </div>

        <div className="product-pricing">
          <div className="price-item purchase-price">
            <span className="price-label">Giá nhập</span>
            <span className="price-amount">{formatCurrency(product.purchasePrice)}</span>
          </div>
          <div className="price-divider" aria-hidden="true"></div>
          <div className="price-item sale-price">
            <span className="price-label">Giá bán</span>
            <strong className="price-amount highlight">{formatCurrency(product.salePrice)}</strong>
          </div>
        </div>

        <div className="product-stock-bar">
          <span className="stock-label">Tồn kho:</span>
          <span className={`stock-badge ${isOutOfStock ? 'stock-empty' : 'stock-available'}`}>
            <span className="stock-dot" aria-hidden="true"></span>
            {isOutOfStock ? (
              <strong>0 {product.unit} (Hết hàng)</strong>
            ) : (
              <strong>
                {product.stock} {product.unit}
              </strong>
            )}
          </span>
        </div>

        {/* Nút thao tác: Lịch sử cho mọi thành viên; Chỉnh sửa khi có quyền can_edit */}
        <div className="product-card-actions">
          {onViewHistory && (
            <button
              type="button"
              className="btn-card-history"
              onClick={(e) => onViewHistory(product, e.currentTarget)}
              aria-label={`Xem lịch sử thay đổi của ${product.name}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
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
              Lịch sử
            </button>
          )}

          {canEdit && onEdit && (
            <button
              type="button"
              className="btn-card-edit"
              onClick={(e) => onEdit(product, e.currentTarget)}
              aria-label={`Chỉnh sửa ${product.name}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
              </svg>
              Chỉnh sửa
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
