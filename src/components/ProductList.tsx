import type { Product } from '../types/product';
import { ProductCard } from './ProductCard';

interface ProductListProps {
  products: Product[];
  totalInDatabase: number;
  onResetFilters: () => void;
  hasFiltersApplied: boolean;
  canEdit?: boolean;
  onSelectProduct: (product: Product, triggerEl: HTMLElement) => void;
  onOpenBarcodeScanner?: (triggerEl: HTMLElement) => void;
  onOpenImageSearch?: (triggerEl: HTMLElement) => void;
  onOpenAddModal?: () => void;
}

export function ProductList({
  products,
  totalInDatabase,
  onResetFilters,
  hasFiltersApplied,
  canEdit,
  onSelectProduct,
  onOpenBarcodeScanner,
  onOpenImageSearch,
  onOpenAddModal,
}: ProductListProps) {
  // Trường hợp cơ sở dữ liệu hoàn toàn chưa có sản phẩm nào
  if (totalInDatabase === 0) {
    return (
      <section className="empty-state" aria-label="Chưa có sản phẩm">
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
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" y1="22.08" x2="12" y2="12"></line>
          </svg>
        </div>
        <h3 className="empty-title">Chưa có sản phẩm</h3>
        <p className="empty-description">
          Kho hàng gia đình hiện chưa có mặt hàng nào. Các sản phẩm được tạo trong hệ thống sẽ xuất hiện tại đây.
        </p>
        <div className="empty-actions-row">
          {canEdit && onOpenAddModal && (
            <button
              type="button"
              className="btn-primary-action"
              onClick={onOpenAddModal}
            >
              <span aria-hidden="true">＋</span> Thêm sản phẩm đầu tiên
            </button>
          )}
          {onOpenBarcodeScanner && (
            <button
              type="button"
              className="btn-secondary-action"
              onClick={(e) => onOpenBarcodeScanner(e.currentTarget)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
              </svg>
              <span>Quét mã vạch</span>
            </button>
          )}
          {onOpenImageSearch && (
            <button
              type="button"
              className="btn-secondary-action"
              onClick={(e) => onOpenImageSearch(e.currentTarget)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>Tìm bằng ảnh</span>
            </button>
          )}
        </div>
      </section>
    );
  }

  // Trường hợp có sản phẩm trong DB nhưng bộ lọc / tìm kiếm không khớp
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
        <div className="empty-actions-row">
          {hasFiltersApplied && (
            <button
              type="button"
              className="reset-filter-btn"
              onClick={onResetFilters}
            >
              Xóa bộ lọc & xem tất cả
            </button>
          )}
          {onOpenBarcodeScanner && (
            <button
              type="button"
              className="btn-secondary-action"
              onClick={(e) => onOpenBarcodeScanner(e.currentTarget)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
              </svg>
              <span>Quét mã vạch</span>
            </button>
          )}
          {onOpenImageSearch && (
            <button
              type="button"
              className="btn-secondary-action"
              onClick={(e) => onOpenImageSearch(e.currentTarget)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>Tìm bằng ảnh</span>
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="product-grid" role="region" aria-label="Danh sách sản phẩm">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onClick={onSelectProduct}
        />
      ))}
    </div>
  );
}

export default ProductList;
