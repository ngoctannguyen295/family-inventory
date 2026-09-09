import { useState, useMemo } from 'react';
import { MOCK_PRODUCTS } from './data/mockProducts';
import { removeVietnameseTones } from './utils/formatters';
import { Header } from './components/Header';
import { SearchAndFilter } from './components/SearchAndFilter';
import { ProductList } from './components/ProductList';
import './App.css';

export function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Danh sách các danh mục duy nhất từ dữ liệu sản phẩm
  const categories = useMemo(() => {
    return Array.from(new Set(MOCK_PRODUCTS.map((item) => item.category)));
  }, []);

  // Lọc sản phẩm theo danh mục và từ khóa tìm kiếm (tên bỏ dấu, mã hàng, mã vạch)
  const filteredProducts = useMemo(() => {
    const rawSearch = searchTerm.trim();
    const normalizedQuery = removeVietnameseTones(rawSearch);

    return MOCK_PRODUCTS.filter((product) => {
      // 1. Kiểm tra danh mục
      if (selectedCategory !== 'ALL' && product.category !== selectedCategory) {
        return false;
      }

      // 2. Kiểm tra từ khóa tìm kiếm
      if (!rawSearch) {
        return true;
      }

      // Khớp theo tên (không phân biệt hoa/thường và dấu tiếng Việt)
      const normalizedName = removeVietnameseTones(product.name);
      if (normalizedName.includes(normalizedQuery)) {
        return true;
      }

      // Khớp theo mã hàng (chuỗi có thể có số 0 ở đầu)
      if (product.code.toLowerCase().includes(rawSearch.toLowerCase())) {
        return true;
      }

      // Khớp theo mã vạch
      if (product.barcode.includes(rawSearch)) {
        return true;
      }

      return false;
    });
  }, [searchTerm, selectedCategory]);

  const hasFiltersApplied = searchTerm.trim() !== '' || selectedCategory !== 'ALL';

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedCategory('ALL');
  };

  return (
    <div className="app-container">
      <div className="app-content">
        <Header totalCount={MOCK_PRODUCTS.length} />

        <main className="app-main">
          <SearchAndFilter
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            categories={categories}
            displayedCount={filteredProducts.length}
            totalCount={MOCK_PRODUCTS.length}
          />

          <ProductList
            products={filteredProducts}
            onResetFilters={handleResetFilters}
            hasFiltersApplied={hasFiltersApplied}
          />
        </main>

        <footer className="app-footer">
          <p>Family Inventory • Ứng dụng nội bộ gia đình</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
