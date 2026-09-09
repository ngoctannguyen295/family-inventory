import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import type { Product } from './types/product';
import type { FamilyMember, ProductRow } from './types/database';
import { mapProductRow } from './types/database';
import { removeVietnameseTones } from './utils/formatters';
import { Header } from './components/Header';
import { Login } from './components/Login';
import { SearchAndFilter } from './components/SearchAndFilter';
import { ProductList } from './components/ProductList';
import { ProductFormModal } from './components/ProductFormModal';
import { clearProductImageCache } from './services/storageService';
import './App.css';

interface ToastNotification {
  text: string;
  type: 'success' | 'info' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
}

export function App() {
  // 1. Quản lý trạng thái phiên đăng nhập
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(() => isSupabaseConfigured);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // 2. Quản lý trạng thái thành viên gia đình
  const [member, setMember] = useState<FamilyMember | null>(null);
  const [isMemberLoading, setIsMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  // 3. Quản lý trạng thái sản phẩm
  const [products, setProducts] = useState<Product[]>([]);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  // 4. Quản lý bộ lọc & tìm kiếm
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [retryCounter, setRetryCounter] = useState(0);

  // 5. Quản lý modal Thêm / Sửa sản phẩm
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);

  // 6. Thông báo Toast
  const [toast, setToast] = useState<ToastNotification | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((notification: ToastNotification) => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast(notification);
    // Tự động đóng toast sau 7 giây
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
    }, 7000);
  }, []);

  // Kiểm tra phiên đăng nhập và theo dõi onAuthStateChange
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      return;
    }

    let isMounted = true;

    // Lấy phiên ban đầu
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!isMounted) return;
      setSession(initialSession);
      setIsAuthChecking(false);
    });

    // Lắng nghe thay đổi auth (QUY TẮC: Chỉ cập nhật state, không await async query trong callback)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setIsAuthChecking(false);

      if (!currentSession) {
        // Đăng xuất hoặc đổi tài khoản: đóng modal và xóa toàn bộ dữ liệu, thu hồi cache ảnh
        clearProductImageCache();
        setSession(null);
        setIsModalOpen(false);
        setProductToEdit(null);
        setMember(null);
        setProducts([]);
        setIsUnauthorized(false);
        setMemberError(null);
        setProductsError(null);
        setSearchTerm('');
        setSelectedCategory('ALL');
        setToast(null);
        return;
      }

      setSession((prev) => {
        // Nếu đổi sang tài khoản người dùng khác, dọn dẹp cache ảnh của tài khoản cũ
        if (prev?.user?.id && prev.user.id !== currentSession.user.id) {
          clearProductImageCache();
        }

        // Nếu user id và token không đổi, giữ nguyên reference để tránh trigger effect thừa
        if (
          prev?.user?.id === currentSession.user.id &&
          prev?.access_token === currentSession.access_token
        ) {
          return prev;
        }
        return currentSession;
      });
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      clearProductImageCache();
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const userId = session?.user?.id;

  // Tải thông tin thành viên và danh mục sản phẩm từ Supabase
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !userId) {
      return;
    }

    let isMounted = true;

    async function loadData() {
      setIsMemberLoading(true);
      setMemberError(null);
      setIsUnauthorized(false);

      try {
        // 1. Kiểm tra thành viên trong public.family_members
        const { data: memberData, error: memberErr } = await supabase!
          .from('family_members')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (!isMounted) return;

        if (memberErr) {
          setMemberError('Không thể kết nối để kiểm tra quyền thành viên. Vui lòng thử lại.');
          setIsMemberLoading(false);
          return;
        }

        // Không có bản ghi hoặc đã bị vô hiệu hóa
        if (!memberData || !memberData.is_active) {
          setIsUnauthorized(true);
          setMember(null);
          setProducts([]);
          setIsMemberLoading(false);
          return;
        }

        // Thành viên hợp lệ
        setMember(memberData as FamilyMember);
        setIsMemberLoading(false);

        // 2. Tải danh sách sản phẩm từ public.products
        setIsProductsLoading(true);
        setProductsError(null);

        const { data: productsData, error: productsErr } = await supabase!
          .from('products')
          .select('*')
          .order('created_at', { ascending: false });

        if (!isMounted) return;

        if (productsErr) {
          setProductsError('Không thể tải danh sách hàng hóa từ máy chủ. Vui lòng thử lại.');
          setIsProductsLoading(false);
          return;
        }

        const mapped = ((productsData as ProductRow[]) ?? []).map(mapProductRow);
        setProducts(mapped);
        setIsProductsLoading(false);
      } catch {
        if (!isMounted) return;
        setMemberError('Đã xảy ra lỗi không xác định khi tải dữ liệu.');
        setIsMemberLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [userId, retryCounter]);

  // Xử lý đăng xuất an toàn (kiểm tra cả error của Supabase)
  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    setIsSigningOut(true);
    setSignOutError(null);

    // Đóng form nếu đang mở
    setIsModalOpen(false);
    setProductToEdit(null);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSignOutError(`Đăng xuất thất bại: ${error.message}. Vui lòng thử lại.`);
        setIsSigningOut(false);
        return;
      }

      // Đăng xuất thành công: xóa ngay state và dọn dẹp cache ảnh
      clearProductImageCache();
      setMember(null);
      setProducts([]);
      setIsUnauthorized(false);
      setMemberError(null);
      setProductsError(null);
      setSearchTerm('');
      setSelectedCategory('ALL');
      setToast(null);
    } catch {
      setSignOutError('Lỗi kết nối mạng khi đăng xuất. Vui lòng thử lại.');
    } finally {
      setIsSigningOut(false);
    }
  }, []);

  // Thử lại khi có lỗi tải thành viên hoặc sản phẩm
  const handleRetry = useCallback(() => {
    setRetryCounter((prev) => prev + 1);
  }, []);

  // Mở modal Thêm mới
  const handleOpenAddModal = useCallback(() => {
    setProductToEdit(null);
    activeTriggerRef.current = addBtnRef.current;
    setIsModalOpen(true);
  }, []);

  // Mở modal Sửa
  const handleOpenEditModal = useCallback((prod: Product, triggerEl: HTMLElement) => {
    setProductToEdit(prod);
    activeTriggerRef.current = triggerEl;
    setIsModalOpen(true);
  }, []);

  // Đóng modal
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setProductToEdit(null);
  }, []);

  // Xử lý sau khi lưu sản phẩm thành công
  const handleSaveSuccess = useCallback(
    (savedProduct: Product, isEdit: boolean) => {
      // 1. Cập nhật state danh sách sản phẩm
      if (isEdit) {
        setProducts((prev) =>
          prev.map((p) => (p.id === savedProduct.id ? savedProduct : p))
        );
      } else {
        setProducts((prev) => [savedProduct, ...prev]);
      }

      // 2. Kiểm tra xem sản phẩm có bị ẩn bởi bộ lọc hoặc từ khóa tìm kiếm hiện tại không
      const rawSearch = searchTerm.trim();
      const normalizedQuery = removeVietnameseTones(rawSearch);
      const matchesCategory =
        selectedCategory === 'ALL' || savedProduct.category === selectedCategory;
      const normalizedName = removeVietnameseTones(savedProduct.name);
      const matchesSearch =
        !rawSearch ||
        normalizedName.includes(normalizedQuery) ||
        savedProduct.code.toLowerCase().includes(rawSearch.toLowerCase()) ||
        Boolean(savedProduct.barcode && savedProduct.barcode.includes(rawSearch));

      const isVisibleInList = matchesCategory && matchesSearch;

      if (!isVisibleInList) {
        showToast({
          text: `Đã ${isEdit ? 'cập nhật' : 'thêm'} "${savedProduct.name}" thành công, nhưng sản phẩm đang bị ẩn bởi bộ lọc hiện tại.`,
          type: 'info',
          actionLabel: 'Xóa bộ lọc để xem',
          onAction: () => {
            setSearchTerm('');
            setSelectedCategory('ALL');
            setToast(null);
          },
        });
      } else {
        showToast({
          text: `Đã ${isEdit ? 'cập nhật' : 'thêm'} "${savedProduct.name}" thành công.`,
          type: 'success',
        });
      }
    },
    [searchTerm, selectedCategory, showToast]
  );

  // Danh sách các danh mục duy nhất từ sản phẩm thực tế
  const categories = useMemo(() => {
    return Array.from(new Set(products.map((item) => item.category)));
  }, [products]);

  // Lọc sản phẩm theo danh mục và từ khóa tìm kiếm tiếng Việt không dấu
  const filteredProducts = useMemo(() => {
    const rawSearch = searchTerm.trim();
    const normalizedQuery = removeVietnameseTones(rawSearch);

    return products.filter((product) => {
      // 1. Kiểm tra danh mục
      if (selectedCategory !== 'ALL' && product.category !== selectedCategory) {
        return false;
      }

      // 2. Kiểm tra từ khóa tìm kiếm
      if (!rawSearch) {
        return true;
      }

      // Khớp theo tên
      const normalizedName = removeVietnameseTones(product.name);
      if (normalizedName.includes(normalizedQuery)) {
        return true;
      }

      // Khớp theo mã hàng
      if (product.code.toLowerCase().includes(rawSearch.toLowerCase())) {
        return true;
      }

      // Khớp theo mã vạch (nếu có)
      if (product.barcode && product.barcode.includes(rawSearch)) {
        return true;
      }

      return false;
    });
  }, [products, searchTerm, selectedCategory]);

  const hasFiltersApplied = searchTerm.trim() !== '' || selectedCategory !== 'ALL';

  const handleResetFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedCategory('ALL');
  }, []);

  // Quyền chỉnh sửa của người dùng
  const canEdit = Boolean(member?.is_active && member?.can_edit);

  // MÀN HÌNH 1: Thiếu cấu hình Supabase
  if (!isSupabaseConfigured) {
    return (
      <div className="status-screen-container">
        <div className="status-screen-card error-card">
          <div className="status-icon" aria-hidden="true">⚙️</div>
          <h2 className="status-title">Chưa cấu hình Supabase</h2>
          <p className="status-desc">
            Ứng dụng cần thông tin kết nối Supabase để hoạt động. Vui lòng tạo file{' '}
            <code>.env.local</code> dựa trên <code>.env.example</code> và điền đầy đủ hai biến{' '}
            <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
          </p>
        </div>
      </div>
    );
  }

  // MÀN HÌNH 2: Đang kiểm tra phiên đăng nhập ban đầu
  if (isAuthChecking) {
    return (
      <div className="status-screen-container">
        <div className="status-screen-card">
          <div className="loading-spinner" aria-hidden="true"></div>
          <h2 className="status-title">Đang kiểm tra phiên đăng nhập...</h2>
        </div>
      </div>
    );
  }

  // MÀN HÌNH 3: Chưa đăng nhập -> Hiển thị form đăng nhập
  if (!session) {
    return <Login />;
  }

  // MÀN HÌNH 4: Đang kiểm tra quyền thành viên gia đình (chỉ hiện khi chưa có thông tin member)
  if (isMemberLoading && !member) {
    return (
      <div className="status-screen-container">
        <div className="status-screen-card">
          <div className="loading-spinner" aria-hidden="true"></div>
          <h2 className="status-title">Đang xác thực quyền thành viên...</h2>
        </div>
      </div>
    );
  }

  // MÀN HÌNH 5: Lỗi kết nối khi kiểm tra thành viên (chỉ hiện khi chưa có thông tin member)
  if (memberError && !member) {
    return (
      <div className="status-screen-container">
        <div className="status-screen-card error-card">
          <div className="status-icon" aria-hidden="true">⚠️</div>
          <h2 className="status-title">Lỗi kết nối máy chủ</h2>
          <p className="status-desc">{memberError}</p>
          <div className="status-actions">
            <button type="button" className="btn-primary" onClick={handleRetry}>
              Thử lại
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? 'Đang xuất...' : 'Đăng xuất'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MÀN HÌNH 6: Tài khoản chưa được cấp quyền hoặc bị khóa
  if (isUnauthorized) {
    return (
      <div className="status-screen-container">
        <div className="status-screen-card warning-card">
          <div className="status-icon" aria-hidden="true">🔒</div>
          <h2 className="status-title">Tài khoản chưa được cấp quyền hoặc đã bị khóa</h2>
          <p className="status-desc">
            Tài khoản này chưa có trong danh sách thành viên gia đình hoặc đang ở trạng thái ngừng hoạt động.
            Vui lòng liên hệ người quản lý gia đình để được kích hoạt quyền truy cập.
          </p>
          <div className="status-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? 'Đang xuất...' : 'Đăng xuất'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MÀN HÌNH 7: Thành viên hợp lệ -> Hiển thị danh mục hàng hóa
  return (
    <div className="app-container">
      <div className="app-content">
        <Header
          totalCount={products.length}
          member={member}
          onSignOut={handleSignOut}
          isSigningOut={isSigningOut}
          onOpenAddModal={handleOpenAddModal}
          addBtnRef={addBtnRef}
        />

        {/* Thông báo lỗi khi đăng xuất thất bại */}
        {signOutError && (
          <div className="app-alert app-alert-danger" role="alert">
            <span>{signOutError}</span>
            <button
              type="button"
              className="btn-alert-action"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              Thử lại
            </button>
            <button
              type="button"
              className="btn-alert-close"
              onClick={() => setSignOutError(null)}
              aria-label="Đóng thông báo"
            >
              ✕
            </button>
          </div>
        )}

        {/* Thông báo Toast sau khi lưu */}
        {toast && (
          <div className={`app-toast toast-${toast.type}`} role="status" aria-live="polite">
            <span className="toast-text">{toast.text}</span>
            {toast.actionLabel && toast.onAction && (
              <button
                type="button"
                className="toast-action-btn"
                onClick={toast.onAction}
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => setToast(null)}
              aria-label="Đóng thông báo"
            >
              ✕
            </button>
          </div>
        )}

        <main className="app-main">
          {/* Trạng thái đang tải sản phẩm (chỉ hiện panel to khi danh sách đang rỗng) */}
          {isProductsLoading && products.length === 0 && (
            <div className="state-panel loading-panel">
              <div className="loading-spinner small" aria-hidden="true"></div>
              <span>Đang tải danh sách hàng hóa từ Supabase...</span>
            </div>
          )}

          {/* Trạng thái lỗi tải sản phẩm (chỉ chặn khi danh sách rỗng) */}
          {productsError && products.length === 0 && (
            <div className="state-panel error-panel">
              <p>{productsError}</p>
              <button type="button" className="btn-retry" onClick={handleRetry}>
                Thử lại
              </button>
            </div>
          )}

          {/* Khi đã có sản phẩm hoặc khi hoàn tất tải mà không có lỗi */}
          {(products.length > 0 || (!isProductsLoading && !productsError)) && (
            <>
              {/* Chỉ hiển thị thanh tìm kiếm & lọc nếu cơ sở dữ liệu đã có ít nhất 1 sản phẩm */}
              {products.length > 0 && (
                <SearchAndFilter
                  searchTerm={searchTerm}
                  onSearchChange={setSearchTerm}
                  selectedCategory={selectedCategory}
                  onCategoryChange={setSelectedCategory}
                  categories={categories}
                  displayedCount={filteredProducts.length}
                  totalCount={products.length}
                />
              )}

              <ProductList
                products={filteredProducts}
                totalInDatabase={products.length}
                onResetFilters={handleResetFilters}
                hasFiltersApplied={hasFiltersApplied}
                canEdit={canEdit}
                onEdit={handleOpenEditModal}
                onOpenAddModal={handleOpenAddModal}
              />
            </>
          )}
        </main>

        <footer className="app-footer">
          <p>Family Inventory • Ứng dụng nội bộ gia đình</p>
        </footer>
      </div>

      {/* Modal Thêm / Chỉnh sửa sản phẩm */}
      <ProductFormModal
        isOpen={isModalOpen}
        productToEdit={productToEdit}
        existingCategories={categories}
        userId={userId}
        onClose={handleCloseModal}
        onSaveSuccess={handleSaveSuccess}
        triggerElementRef={activeTriggerRef}
      />
    </div>
  );
}

export default App;
