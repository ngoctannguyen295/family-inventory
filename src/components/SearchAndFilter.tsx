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
}: SearchAndFilterProps) {
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  };

  const handleClearSearch = () => {
    onSearchChange('');
  };

  return (
    <section className="search-filter-section" aria-label="Bộ lọc và tìm kiếm sản phẩm">
      <div className="search-filter-grid">
        {/* Search Input & Barcode Button */}
        <div className="form-group search-group">
          <label htmlFor="search-input" className="form-label">
            Tìm kiếm theo tên, mã hàng, mã vạch
          </label>
          <div className="search-input-actions-row">
            <div className="input-with-icon search-input-container">
              <svg
                className="search-icon"
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
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
                className="text-input"
                placeholder="Ví dụ: gạo, 00101, 8935..."
                value={searchTerm}
                onChange={handleInputChange}
                autoComplete="off"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="clear-button"
                  onClick={handleClearSearch}
                  aria-label="Xóa từ khóa tìm kiếm"
                  title="Xóa từ khóa"
                >
                  ✕
                </button>
              )}
            </div>

            {onOpenBarcodeScanner && (
              <button
                type="button"
                className="btn-scan-barcode"
                onClick={(e) => onOpenBarcodeScanner(e.currentTarget)}
                title="Quét mã vạch bằng camera hoặc ảnh"
                aria-label="Mở cửa sổ quét mã vạch"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
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
                <span>Quét mã</span>
              </button>
            )}
          </div>
        </div>

        {/* Category Select Filter */}
        <div className="form-group category-group">
          <label htmlFor="category-select" className="form-label">
            Lọc theo danh mục
          </label>
          <div className="select-wrapper">
            <select
              id="category-select"
              className="select-input"
              value={selectedCategory}
              onChange={(e) => onCategoryChange(e.target.value)}
            >
              <option value="ALL">Tất cả danh mục ({totalCount})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <svg
              className="select-chevron"
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
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
      </div>

      {/* Results Count Bar */}
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
