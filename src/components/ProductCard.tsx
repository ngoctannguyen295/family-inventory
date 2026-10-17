import { useRef } from 'react';
import type { Product } from '../types/product';
import { formatCurrency } from '../utils/formatters';
import { ProductImage } from './ProductImage';

interface ProductCardProps {
  product: Product;
  onClick: (product: Product, triggerEl: HTMLElement) => void;
  cartQuantity?: number;
  onAddToCart?: (product: Product) => void;
  onUpdateQuantity?: (productId: string, quantity: number) => void;
  onOpenQuantityInput?: (product: Product) => void;
}

export function ProductCard({
  product,
  onClick,
  cartQuantity = 0,
  onAddToCart,
  onUpdateQuantity,
  onOpenQuantityInput,
}: ProductCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const isOutOfStock = product.stock <= 0;

  const handleClick = () => {
    if (cardRef.current) {
      onClick(product, cardRef.current);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <article
      ref={cardRef}
      className={`product-card ${isOutOfStock ? 'out-of-stock-card' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Xem chi tiết ${product.name}, giá bán ${formatCurrency(product.salePrice)}, tồn kho ${product.stock} ${product.unit}`}
    >
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
        {/* Tên sản phẩm tối đa 2 dòng */}
        <h3 className="product-name" title={product.name}>
          {product.name}
        </h3>

        <div className="product-codes">
          <span className="code-item">
            <code>{product.code}</code>
          </span>
        </div>

        <div className="product-pricing">
          <div className="price-item sale-price">
            <span className="price-label">Giá bán:</span>
            <strong className="price-amount highlight">
              {formatCurrency(product.salePrice)}
            </strong>
          </div>
          <div className="price-item purchase-price">
            <span className="price-label">Giá nhập:</span>
            <span className="price-amount">
              {formatCurrency(product.purchasePrice)}
            </span>
          </div>
        </div>

        <div className="product-stock-bar">
          <span className="stock-label">Tồn:</span>
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

        {onAddToCart && (
          <div className="product-card-actions" onClick={(e) => e.stopPropagation()}>
            {cartQuantity > 0 ? (
              <div className="card-stepper">
                <button
                  type="button"
                  className="card-stepper-btn minus"
                  onClick={() => onUpdateQuantity?.(product.id, cartQuantity - 1)}
                  title="Giảm 1"
                  aria-label={`Giảm số lượng ${product.name}`}
                >
                  −
                </button>
                <button
                  type="button"
                  className="card-stepper-qty-btn"
                  onClick={() => onOpenQuantityInput?.(product)}
                  title="Bấm để gõ số lượng cụ thể"
                  aria-label={`Số lượng hiện tại ${cartQuantity}. Bấm để nhập số khác`}
                >
                  <span className="stepper-num">{cartQuantity}</span>
                  <span className="stepper-unit">{product.unit}</span>
                </button>
                <button
                  type="button"
                  className="card-stepper-btn plus"
                  onClick={() => onUpdateQuantity?.(product.id, cartQuantity + 1)}
                  disabled={product.stock > 0 && cartQuantity >= product.stock}
                  title={
                    product.stock > 0 && cartQuantity >= product.stock
                      ? 'Đã đạt giới hạn tồn kho'
                      : 'Tăng 1'
                  }
                  aria-label={`Tăng số lượng ${product.name}`}
                >
                  +
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-add-to-cart"
                onClick={() => onAddToCart(product)}
                disabled={isOutOfStock}
                title={isOutOfStock ? 'Sản phẩm đã hết hàng' : 'Chọn bán mặt hàng này'}
                aria-label={`Thêm ${product.name} vào đơn tính tiền`}
              >
                <span>＋</span>
                <span>{isOutOfStock ? 'Hết hàng' : 'Bán hàng'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default ProductCard;
