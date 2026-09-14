import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import type { Product } from './types/product';
import type { FamilyMember } from './types/database';
import { removeVietnameseTones } from './utils/formatters';
import { Header } from './components/Header';
import { Login } from './components/Login';
import { SearchAndFilter } from './components/SearchAndFilter';
import { ProductList } from './components/ProductList';
import { ProductDetailModal } from './components/ProductDetailModal';
import { ProductDeleteConfirmModal } from './components/ProductDeleteConfirmModal';
import { DeletedProductsModal } from './components/DeletedProductsModal';
import { ProductFormModal } from './components/ProductFormModal';
import { ProductHistoryModal } from './components/ProductHistoryModal';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { ImageSearchModal } from './components/ImageSearchModal';
import { OfflineBanner } from './components/OfflineBanner';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { clearProductImageCache } from './services/storageService';
import {
  fetchActiveProducts,
  fetchDeletedProducts,
  softDeleteProduct,
  restoreProduct,
} from './services/productService';
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

  // 3. Quản lý trạng thái sản phẩm đang sử dụng (deleted_at IS NULL)
  const [products, setProducts] = useState<Product[]>([]);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  // 3.1 Quản lý danh sách sản phẩm đã xóa mềm (deleted_at IS NOT NULL)
  const [deletedProducts, setDeletedProducts] = useState<Product[]>([]);
  const [isDeletedLoading, setIsDeletedLoading] = useState(false);
  const [deletedError, setDeletedError] = useState<string | null>(null);
  const [isDeletedModalOpen, setIsDeletedModalOpen] = useState(false);

  // 4. Quản lý bộ lọc & tìm kiếm
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [retryCounter, setRetryCounter] = useState(0);

  // 5. Quản lý modal Chi tiết sản phẩm
  const [selectedDetailProduct, setSelectedDetailProduct] = useState<Product | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  // 5.1 Quản lý modal Xác nhận xóa mềm
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 5.2 Quản lý modal Thêm / Sửa sản phẩm
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);

  // 5.3 Quản lý trạng thái mạng trực tuyến
  const isOnline = useOnlineStatus();

  // 5.4 Quản lý modal Lịch sử sản phẩm
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedHistoryProduct, setSelectedHistoryProduct] = useState<Product | null>(null);
  const historyTriggerRef = useRef<HTMLElement | null>(null);

  // 5.5 Quản lý modal Quét mã vạch
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
  const barcodeScannerTriggerRef = useRef<HTMLElement | null>(null);

  // 5.6 Quản lý modal Tìm kiếm bằng ảnh bao bì qua AI
  const [isImageSearchOpen, setIsImageSearchOpen] = useState(false);
  const imageSearchTriggerRef = useRef<HTMLElement | null>(null);

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

    // Lắng nghe thay đổi auth
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setIsAuthChecking(false);

      if (!currentSession) {
        // Đăng xuất hoặc đổi tài khoản: đóng modal và xóa toàn bộ dữ liệu
        clearProductImageCache();
        setSession(null);
        setSelectedDetailProduct(null);
        setIsDeleteConfirmOpen(false);
        setIsDeletedModalOpen(false);
        setIsModalOpen(false);
        setProductToEdit(null);
        setIsHistoryModalOpen(false);
        setSelectedHistoryProduct(null);
        setIsBarcodeScannerOpen(false);
        setIsImageSearchOpen(false);
        setMember(null);
        setProducts([]);
        setDeletedProducts([]);
        setIsUnauthorized(false);
        setMemberError(null);
        setProductsError(null);
        setSearchTerm('');
        setSelectedCategory('ALL');
        setToast(null);
        return;
      }

      setSession((prev) => {
        if (prev?.user?.id && prev.user.id !== currentSession.user.id) {
          clearProductImageCache();
        }

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

  // Hàm tải danh sách sản phẩm đang sử dụng và sản phẩm đã xóa
  const reloadProducts = useCallback(async (canEditUser?: boolean) => {
    setIsProductsLoading(true);
    setProductsError(null);

    const res = await fetchActiveProducts();
    if (res.error) {
      setProductsError(res.error);
      setIsProductsLoading(false);
      return;
    }

    setProducts(res.data ?? []);
    setIsProductsLoading(false);

    // Nếu người dùng có quyền chỉnh sửa, tải thêm số lượng và danh sách đã xóa
    if (canEditUser) {
      const delRes = await fetchDeletedProducts();
      if (!delRes.error && delRes.data) {
        setDeletedProducts(delRes.data);
      }
    }
  }, []);

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
          setDeletedProducts([]);
          setIsMemberLoading(false);
          return;
        }

        // Thành viên hợp lệ
        const activeMember = memberData as FamilyMember;
        setMember(activeMember);
        setIsMemberLoading(false);

        // 2. Tải danh mục hàng hóa
        await reloadProducts(activeMember.can_edit);
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
  }, [userId, retryCounter, reloadProducts]);

  // Xử lý đăng xuất an toàn
  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    setIsSigningOut(true);
    setSignOutError(null);

    // Đóng toàn bộ các modal
    setSelectedDetailProduct(null);
    setIsDeleteConfirmOpen(false);
    setIsDeletedModalOpen(false);
    setIsModalOpen(false);
    setProductToEdit(null);
    setIsHistoryModalOpen(false);
    setSelectedHistoryProduct(null);
    setIsBarcodeScannerOpen(false);
    setIsImageSearchOpen(false);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSignOutError(`Đăng xuất thất bại: ${error.message}. Vui lòng thử lại.`);
        setIsSigningOut(false);
        return;
      }

      clearProductImageCache();
      setMember(null);
      setProducts([]);
      setDeletedProducts([]);
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

  // Mở modal Chi tiết sản phẩm khi bấm vào thẻ sản phẩm
  const handleSelectProduct = useCallback((prod: Product, triggerEl: HTMLElement) => {
    setSelectedDetailProduct(prod);
    detailTriggerRef.current = triggerEl;
  }, []);

  // Đóng modal Chi tiết sản phẩm
  const handleCloseDetailModal = useCallback(() => {
    setSelectedDetailProduct(null);
    setIsDeleteConfirmOpen(false);
    setDeleteError(null);
  }, []);

  // Mở modal Thêm mới
  const handleOpenAddModal = useCallback(() => {
    setProductToEdit(null);
    activeTriggerRef.current = addBtnRef.current;
    setIsModalOpen(true);
  }, []);

  // Mở modal Sửa
  const handleOpenEditModal = useCallback((prod: Product, triggerEl: HTMLElement) => {
    setSelectedDetailProduct(null);
    setProductToEdit(prod);
    activeTriggerRef.current = triggerEl;
    setIsModalOpen(true);
  }, []);

  // Đóng modal Thêm / Sửa
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setProductToEdit(null);
    setIsFormDirty(false);
  }, []);

  // Mở modal Xác nhận xóa mềm
  const handleOpenDeleteConfirm = useCallback(() => {
    setDeleteError(null);
    setIsDeleteConfirmOpen(true);
  }, []);

  // Hủy modal Xác nhận xóa (quay về modal chi tiết)
  const handleCancelDeleteConfirm = useCallback(() => {
    setIsDeleteConfirmOpen(false);
    setDeleteError(null);
  }, []);

  // Thực hiện Xóa mềm sản phẩm
  const handleExecuteSoftDelete = useCallback(async () => {
    if (!selectedDetailProduct || isDeleting) return;

    if (!isOnline) {
      setDeleteError('Đang mất kết nối mạng. Không thể thực hiện xóa sản phẩm lúc này.');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await softDeleteProduct(selectedDetailProduct.id);

      if (res.error) {
        setDeleteError(res.error);
        setIsDeleting(false);
        return;
      }

      // Xóa mềm thành công: đóng cả modal xác nhận và modal chi tiết
      setIsDeleting(false);
      setIsDeleteConfirmOpen(false);
      setSelectedDetailProduct(null);

      // Làm mới danh sách sản phẩm và danh sách đã xóa
      await reloadProducts(Boolean(member?.can_edit));

      showToast({
        text: `Đã chuyển sản phẩm "${selectedDetailProduct.name}" vào mục Đã xóa.`,
        type: 'info',
      });
    } catch (err) {
      setIsDeleting(false);
      setDeleteError(
        err instanceof Error ? err.message : 'Lỗi kết nối khi xóa sản phẩm. Vui lòng thử lại.'
      );
    }
  }, [selectedDetailProduct, isDeleting, isOnline, member, reloadProducts, showToast]);

  // Mở modal danh sách sản phẩm Đã xóa
  const handleOpenDeletedProductsModal = useCallback(async () => {
    setIsDeletedModalOpen(true);
    setIsDeletedLoading(true);
    setDeletedError(null);

    const res = await fetchDeletedProducts();
    if (res.error) {
      setDeletedError(res.error);
    } else {
      setDeletedProducts(res.data ?? []);
    }
    setIsDeletedLoading(false);
  }, []);

  // Đóng modal danh sách sản phẩm Đã xóa
  const handleCloseDeletedProductsModal = useCallback(() => {
    setIsDeletedModalOpen(false);
  }, []);

  // Khôi phục sản phẩm từ mục Đã xóa
  const handleRestoreProduct = useCallback(
    async (productToRestore: Product) => {
      if (!isOnline) {
        showToast({
          text: 'Đang mất kết nối mạng. Không thể khôi phục sản phẩm lúc này.',
          type: 'warning',
        });
        return;
      }

      const res = await restoreProduct(productToRestore.id);
      if (res.error) {
        showToast({
          text: res.error,
          type: 'warning',
        });
        return;
      }

      // Khôi phục thành công: làm mới cả 2 danh sách
      await reloadProducts(true);

      showToast({
        text: `Đã khôi phục sản phẩm "${productToRestore.name}" thành công.`,
        type: 'success',
      });
    },
    [isOnline, reloadProducts, showToast]
  );

  // Mở modal Lịch sử sản phẩm
  const handleOpenHistoryModal = useCallback((prod: Product, triggerEl: HTMLElement) => {
    setSelectedHistoryProduct(prod);
    historyTriggerRef.current = triggerEl;
    setIsHistoryModalOpen(true);
  }, []);

  // Đóng modal Lịch sử sản phẩm
  const handleCloseHistoryModal = useCallback(() => {
    setIsHistoryModalOpen(false);
    setSelectedHistoryProduct(null);
  }, []);

  // Mở modal Quét mã vạch (tự động đóng Tìm bằng ảnh để tránh xung đột camera)
  const handleOpenBarcodeScanner = useCallback((triggerEl: HTMLElement) => {
    setIsImageSearchOpen(false);
    barcodeScannerTriggerRef.current = triggerEl;
    setIsBarcodeScannerOpen(true);
  }, []);

  // Đóng modal Quét mã vạch
  const handleCloseBarcodeScanner = useCallback(() => {
    setIsBarcodeScannerOpen(false);
  }, []);

  // Xử lý khi chọn sản phẩm từ kết quả quét mã vạch
  const handleSelectProductFromBarcode = useCallback((scannedProduct: Product) => {
    setSearchTerm(scannedProduct.barcode || scannedProduct.code);
    setSelectedCategory('ALL');
  }, []);

  // Mở modal Tìm bằng ảnh (tự động đóng Quét mã vạch để tránh xung đột camera)
  const handleOpenImageSearch = useCallback((triggerEl: HTMLElement) => {
    setIsBarcodeScannerOpen(false);
    imageSearchTriggerRef.current = triggerEl;
    setIsImageSearchOpen(true);
  }, []);

  // Đóng modal Tìm bằng ảnh
  const handleCloseImageSearch = useCallback(() => {
    setIsImageSearchOpen(false);
  }, []);

  // Xử lý khi chọn sản phẩm từ kết quả tìm bằng ảnh
  const handleSelectProductFromImageSearch = useCallback((matchedProduct: Product) => {
    setSearchTerm(matchedProduct.barcode || matchedProduct.code);
    setSelectedCategory('ALL');
    setSelectedDetailProduct(matchedProduct);
  }, []);

  // Xử lý sau khi lưu sản phẩm thành công
  const handleSaveSuccess = useCallback(
    (savedProduct: Product, isEdit: boolean) => {
      if (isEdit) {
        setProducts((prev) =>
          prev.map((p) => (p.id === savedProduct.id ? savedProduct : p))
        );
      } else {
        setProducts((prev) => [savedProduct, ...prev]);
      }

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

  // Danh sách các danh mục duy nhất từ sản phẩm đang sử dụng
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

  // MÀN HÌNH 4: Đang kiểm tra quyền thành viên gia đình
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

  // MÀN HÌNH 5: Lỗi kết nối khi kiểm tra thành viên
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

  // MÀN HÌNH 7: Thành viên hợp lệ -> Hiển thị ứng dụng Kho gia đình
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

        {/* Thông báo Toast sau khi lưu / xóa / khôi phục */}
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
          {/* Cảnh báo mất kết nối mạng */}
          <OfflineBanner
            isOnline={isOnline}
            hasDisplayedData={products.length > 0}
          />

          {/* Trạng thái đang tải sản phẩm */}
          {isProductsLoading && products.length === 0 && (
            <div className="state-panel loading-panel">
              <div className="loading-spinner small" aria-hidden="true"></div>
              <span>Đang tải danh sách hàng hóa từ Supabase...</span>
            </div>
          )}

          {/* Trạng thái lỗi tải sản phẩm */}
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
              {/* Thanh tìm kiếm & Lọc danh mục dạng cuộn ngang */}
              {products.length > 0 && (
                <SearchAndFilter
                  searchTerm={searchTerm}
                  onSearchChange={setSearchTerm}
                  selectedCategory={selectedCategory}
                  onCategoryChange={setSelectedCategory}
                  categories={categories}
                  displayedCount={filteredProducts.length}
                  totalCount={products.length}
                  onOpenBarcodeScanner={handleOpenBarcodeScanner}
                  onOpenImageSearch={handleOpenImageSearch}
                  canEdit={canEdit}
                  deletedCount={deletedProducts.length}
                  onOpenDeletedProducts={handleOpenDeletedProductsModal}
                />
              )}

              {/* Lưới sản phẩm kiểu Shopee/Lazada 2 cột trên di động */}
              <ProductList
                products={filteredProducts}
                totalInDatabase={products.length}
                onResetFilters={handleResetFilters}
                hasFiltersApplied={hasFiltersApplied}
                canEdit={canEdit}
                onSelectProduct={handleSelectProduct}
                onOpenBarcodeScanner={handleOpenBarcodeScanner}
                onOpenImageSearch={handleOpenImageSearch}
                onOpenAddModal={handleOpenAddModal}
              />
            </>
          )}
        </main>

        <footer className="app-footer">
          <p>Kho gia đình • Quản lý hàng hóa và kho nội bộ gia đình</p>
        </footer>
      </div>

      {/* Modal Chi tiết sản phẩm (khi bấm vào bất kỳ thẻ sản phẩm nào) */}
      {selectedDetailProduct && (
        <ProductDetailModal
          isOpen={Boolean(selectedDetailProduct)}
          product={selectedDetailProduct}
          canEdit={canEdit}
          onClose={handleCloseDetailModal}
          onEdit={(prod, triggerEl) => handleOpenEditModal(prod, triggerEl)}
          onViewHistory={(prod, triggerEl) => handleOpenHistoryModal(prod, triggerEl)}
          onOpenDeleteConfirm={handleOpenDeleteConfirm}
          triggerElementRef={detailTriggerRef}
        />
      )}

      {/* Modal Hộp thoại xác nhận Xóa mềm sản phẩm */}
      {isDeleteConfirmOpen && selectedDetailProduct && (
        <ProductDeleteConfirmModal
          isOpen={isDeleteConfirmOpen}
          product={selectedDetailProduct}
          onCancel={handleCancelDeleteConfirm}
          onConfirm={handleExecuteSoftDelete}
          isDeleting={isDeleting}
          error={deleteError}
          isOnline={isOnline}
        />
      )}

      {/* Modal Quản lý mục "Đã xóa" dành cho thành viên có quyền can_edit */}
      {isDeletedModalOpen && (
        <DeletedProductsModal
          isOpen={isDeletedModalOpen}
          onClose={handleCloseDeletedProductsModal}
          deletedProducts={deletedProducts}
          isLoading={isDeletedLoading}
          error={deletedError}
          onRestore={handleRestoreProduct}
          onRetry={handleOpenDeletedProductsModal}
          isOnline={isOnline}
        />
      )}

      {/* Modal Thêm / Chỉnh sửa sản phẩm */}
      <ProductFormModal
        isOpen={isModalOpen}
        productToEdit={productToEdit}
        existingCategories={categories}
        userId={userId}
        onClose={handleCloseModal}
        onSaveSuccess={handleSaveSuccess}
        triggerElementRef={activeTriggerRef}
        isOnline={isOnline}
        onDirtyChange={setIsFormDirty}
      />

      {/* Modal Lịch sử thay đổi sản phẩm */}
      {isHistoryModalOpen && selectedHistoryProduct && (
        <ProductHistoryModal
          isOpen={isHistoryModalOpen}
          product={selectedHistoryProduct}
          onClose={handleCloseHistoryModal}
          triggerElementRef={historyTriggerRef}
        />
      )}

      {/* Modal Quét mã vạch sản phẩm */}
      {isBarcodeScannerOpen && (
        <BarcodeScannerModal
          isOpen={isBarcodeScannerOpen}
          onClose={handleCloseBarcodeScanner}
          onSelectProduct={handleSelectProductFromBarcode}
          triggerElementRef={barcodeScannerTriggerRef}
        />
      )}

      {/* Modal Tìm kiếm sản phẩm bằng ảnh bao bì qua AI */}
      {isImageSearchOpen && (
        <ImageSearchModal
          isOpen={isImageSearchOpen}
          onClose={handleCloseImageSearch}
          onSelectProduct={handleSelectProductFromImageSearch}
          triggerElementRef={imageSearchTriggerRef}
          isOnline={isOnline}
        />
      )}

      {/* Hộp thoại thông báo cập nhật phiên bản mới PWA (registerType: 'prompt') */}
      <PwaUpdatePrompt
        isFormDirty={isModalOpen && isFormDirty}
        onBlockedByDirtyForm={() => {
          showToast({
            text: 'Bạn có thay đổi chưa lưu trong biểu mẫu sản phẩm. Vui lòng lưu hoặc hủy thay đổi trước khi cập nhật.',
            type: 'warning',
          });
        }}
      />
    </div>
  );
}

export default App;
