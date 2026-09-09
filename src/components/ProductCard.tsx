import type { Product } from '../types/product';
import { formatCurrency } from '../utils/formatters';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const isOutOfStock = product.stock <= 0;
  const imageSource = product.imageUrl && product.imageUrl.trim() !== ''
    ? product.imageUrl
    : '/products/default-placeholder.svg';

  return (
    <article className={`product-card ${isOutOfStock ? 'out-of-stock-card' : ''}`}>
      <div className="product-image-container">
        <img
          src={imageSource}
          alt={product.name}
          className="product-image"
          loading="lazy"
          onError={(e) => {
            // Nếu ảnh lỗi mạng, đổi sang ảnh placeholder nội bộ
            (e.currentTarget as HTMLImageElement).src = '/products/default-placeholder.svg';
          }}
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
      </div>
    </article>
  );
}
