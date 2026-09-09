import type { Product } from '../types/product';
import { ProductCard } from './ProductCard';

interface ProductListProps {
  products: Product[];
  onResetFilters: () => void;
  hasFiltersApplied: boolean;
}

export function ProductList({ products, onResetFilters, hasFiltersApplied }: ProductListProps) {
  if (products.length === 0) {
    return (
      <section className="empty-state" aria-label="Không có kết quả">
        <div className="empty-icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
        </div>
        <h3 className="empty-title">Không tìm thấy sản phẩm phù hợp</h3>
        <p className="empty-description">
          Không có sản phẩm nào khớp với từ khóa tìm kiếm hoặc danh mục đang chọn.
        </p>
        {hasFiltersApplied && (
          <button
            type="button"
            className="reset-filter-btn"
            onClick={onResetFilters}
          >
            Xóa bộ lọc & xem tất cả
          </button>
        )}
      </section>
    );
  }

  return (
    <div className="product-grid" role="region" aria-label="Danh sách sản phẩm">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
