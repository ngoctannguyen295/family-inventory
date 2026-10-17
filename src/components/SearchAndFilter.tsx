import type { ChangeEvent } from 'react';
import type { SortOption } from '../types/product';

interface SearchAndFilterProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  categories: string[];
  displayedCount: number;
  totalCount: number;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  onOpenBarcodeScanner?: (triggerEl: HTMLElement) => void;
  onOpenImageSearch?: (triggerEl: HTMLElement) => void;
  canEdit?: boolean;
  deletedCount?: number;
  onOpenDeletedProducts?: () => void;
  onSyncAi?: () => void;
  isSyncingAi?: boolean;
  cartCount?: number;
  isCartOnly?: boolean;
  onToggleCartOnly?: () => void;
}

export function SearchAndFilter({
  searchTerm,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categories,
  displayedCount,
  totalCount,
  sortBy,
  onSortChange,
  onOpenBarcodeScanner,
  onOpenImageSearch,
  canEdit,
  deletedCount = 0,
  onOpenDeletedProducts,
  onSyncAi,
  isSyncingAi = false,
  cartCount = 0,
  isCartOnly = false,
  onToggleCartOnly,
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
              <path d="M3 5v4" />
              <path d="M21 5v4" />
              <path d="M3 19v-4" />
              <path d="M21 19v-4" />
              <line x1="7" x2="7" y1="9" y2="15" />
              <line x1="12" x2="12" y1="9" y2="15" />
              <line x1="17" x2="17" y1="9" y2="15" />
            </svg>
            <span className="btn-label-text">Quét mã vạch</span>
          </button>
        )}

        {onOpenImageSearch && (
          <button
            type="button"
            className="btn-large-scanner btn-imagesearch-large"
            onClick={(e) => onOpenImageSearch(e.currentTarget)}
            title="Tìm kiếm bằng ảnh chụp"
            aria-label="Mở tìm kiếm bằng ảnh camera hoặc thư viện"
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
            className={`category-pill ${selectedCategory === 'ALL' && !isCartOnly ? 'is-active' : ''}`}
            onClick={() => {
              if (isCartOnly && onToggleCartOnly) onToggleCartOnly();
              onCategoryChange('ALL');
            }}
          >
            Tất cả ({totalCount})
          </button>

          {cartCount > 0 && onToggleCartOnly && (
            <button
              type="button"
              className={`category-pill cart-filter-pill ${isCartOnly ? 'is-active' : ''}`}
              onClick={onToggleCartOnly}
              title="Chỉ hiển thị các mặt hàng đang có trong đơn tính tiền"
              style={{
                background: isCartOnly ? '#16a34a' : '#ecfdf5',
                color: isCartOnly ? '#ffffff' : '#065f46',
                borderColor: '#86efac',
                fontWeight: 700,
              }}
            >
              🛒 Đang chọn ({cartCount})
            </button>
          )}

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

          {/* Nút đồng bộ vector có kiểm soát dành cho người có quyền can_edit */}
          {canEdit && onSyncAi && (
            <button
              type="button"
              id="btn-sync-ai"
              className={`category-pill sync-ai-pill ${isSyncingAi ? 'is-syncing' : ''}`}
              onClick={onSyncAi}
              disabled={isSyncingAi}
              title="Đồng bộ đặc trưng hình ảnh cho sản phẩm trong kho"
            >
              {isSyncingAi ? '⏳ Đang đồng bộ...' : '🔄 Đồng bộ đặc trưng ảnh'}
            </button>
          )}
        </div>
      </div>

      {/* 4. Dòng trạng thái tóm tắt kết quả & Dropdown chọn thứ tự sắp xếp */}
      <div className="results-summary" role="status" aria-live="polite">
        <div className="results-summary-left">
          <span className="results-text">
            Hiển thị <strong>{displayedCount}</strong> / <strong>{totalCount}</strong> sản phẩm
          </span>
          {(searchTerm || selectedCategory !== 'ALL') && (
            <span className="active-filter-indicator">
              (Đang lọc)
            </span>
          )}
        </div>

        <div className="sort-control-container">
          <label htmlFor="product-sort-select" className="sort-control-label">
            <span className="sort-icon" aria-hidden="true">⇅</span>
            <span className="sort-label-text">Sắp xếp:</span>
          </label>
          <div className="sort-select-wrapper">
            <select
              id="product-sort-select"
              className="sort-dropdown-select"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              aria-label="Chọn thứ tự sắp xếp sản phẩm"
            >
              <option value="newest">🕒 Mới nhất</option>
              <option value="updated">⚡ Vừa cập nhật / Nhập kho</option>
              <option value="name_asc">🔤 Tên: A ➔ Z</option>
              <option value="name_desc">🔤 Tên: Z ➔ A</option>
              <option value="stock_asc">📉 Tồn kho: Ít ➔ Nhiều (Sắp hết)</option>
              <option value="stock_desc">📈 Tồn kho: Nhiều ➔ Ít</option>
              <option value="price_asc">💵 Giá bán: Thấp ➔ Cao</option>
              <option value="price_desc">💵 Giá bán: Cao ➔ Thấp</option>
              <option value="code_asc">🔢 Mã hàng: A ➔ Z</option>
            </select>
            <span className="sort-dropdown-arrow" aria-hidden="true">▾</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SearchAndFilter;
