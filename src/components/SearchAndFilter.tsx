import type { ChangeEvent } from 'react';

interface SearchAndFilterProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  categories: string[];
  displayedCount: number;
  totalCount: number;
  onOpenBarcodeScanner?: (triggerEl: HTMLElement) => void;
  onOpenImageSearch?: (triggerEl: HTMLElement) => void;
  canEdit?: boolean;
  deletedCount?: number;
  onOpenDeletedProducts?: () => void;
}

export function SearchAndFilter({
  searchTerm,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categories,
  displayedCount,
  totalCount,
  onOpenBarcodeScanner,
  onOpenImageSearch,
  canEdit,
  deletedCount = 0,
  onOpenDeletedProducts,
}: SearchAndFilterProps) {
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  };

  const handleClearSearch = () => {
    onSearchChange('');
  };

  return (
    <section className="search-filter-section" aria-label="Bộ lọc và tìm kiếm sản phẩm">
      {/* 1. Ô tìm kiếm full-width */}
      <div className="search-input-fullwidth-container">
        <div className="input-with-icon search-input-box">
          <svg
            className="search-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            id="search-input"
            type="search"
            className="text-input modern-search-input"
            placeholder="Tìm theo tên sản phẩm, mã hàng, mã vạch..."
            value={searchTerm}
            onChange={handleInputChange}
            autoComplete="off"
            aria-label="Tìm kiếm sản phẩm"
          />
          {searchTerm && (
            <button
              type="button"
              className="clear-button search-clear-btn"
              onClick={handleClearSearch}
              aria-label="Xóa từ khóa tìm kiếm"
              title="Xóa từ khóa"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 2. Hai nút lớn Quét mã và Tìm bằng ảnh (chiều cao >= 44px, trải đều) */}
      <div className="search-quick-actions-bar">
        {onOpenBarcodeScanner && (
          <button
            type="button"
            className="btn-large-scanner btn-barcode-large"
            onClick={(e) => onOpenBarcodeScanner(e.currentTarget)}
            title="Quét mã vạch bao bì"
            aria-label="Mở máy quét mã vạch bằng camera"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
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
            <span className="btn-label-text">Quét mã vạch</span>
          </button>
        )}

        {onOpenImageSearch && (
          <button
            type="button"
            className="btn-large-scanner btn-ai-image-large"
            onClick={(e) => onOpenImageSearch(e.currentTarget)}
            title="Tìm sản phẩm bằng ảnh chụp bao bì qua AI"
            aria-label="Tìm sản phẩm bằng ảnh chụp bao bì qua AI"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
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
            <span className="btn-label-text">Tìm bằng ảnh AI</span>
          </button>
        )}
      </div>

      {/* 3. Thanh danh mục dạng nút cuộn ngang (Horizontal scrollable pills) */}
      <div className="category-scroll-wrapper" role="region" aria-label="Lọc theo danh mục">
        <div className="category-pills-container">
          <button
            type="button"
            className={`category-pill ${selectedCategory === 'ALL' ? 'is-active' : ''}`}
            onClick={() => onCategoryChange('ALL')}
          >
            Tất cả ({totalCount})
          </button>

          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`category-pill ${selectedCategory === cat ? 'is-active' : ''}`}
              onClick={() => onCategoryChange(cat)}
            >
              {cat}
            </button>
          ))}

          {/* Nút vào mục Đã xóa dành cho người có quyền can_edit */}
          {canEdit && onOpenDeletedProducts && (
            <button
              type="button"
              className="category-pill trash-pill"
              onClick={onOpenDeletedProducts}
              title="Xem danh sách các sản phẩm đã xóa mềm"
            >
              🗑️ Đã xóa ({deletedCount})
            </button>
          )}
        </div>
      </div>

      {/* 4. Dòng trạng thái tóm tắt kết quả */}
      <div className="results-summary" role="status" aria-live="polite">
        <span className="results-text">
          Hiển thị <strong>{displayedCount}</strong> / <strong>{totalCount}</strong> sản phẩm
        </span>
        {(searchTerm || selectedCategory !== 'ALL') && (
          <span className="active-filter-indicator">
            (Đang áp dụng bộ lọc)
          </span>
        )}
      </div>
    </section>
  );
}

export default SearchAndFilter;
