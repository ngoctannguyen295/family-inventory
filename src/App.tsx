import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import type { Product, SortOption } from './types/product';
import type { FamilyMember } from './types/database';
import { formatCurrency, removeVietnameseTones } from './utils/formatters';
import { Header } from './components/Header';
import { Login } from './components/Login';
import { SearchAndFilter } from './components/SearchAndFilter';
import { ProductList } from './components/ProductList';
import { ProductDetailModal } from './components/ProductDetailModal';
import { ProductDeleteConfirmModal } from './components/ProductDeleteConfirmModal';
import { ProductFormModal } from './components/ProductFormModal';
import { StockInModal } from './components/StockInModal';

// Tải trễ (lazy loading) các modal lớn để tối ưu dung lượng tải lần đầu cho điện thoại
const DeletedProductsModal = lazy(() =>
  import('./components/DeletedProductsModal').then((m) => ({ default: m.DeletedProductsModal }))
);
const ProductHistoryModal = lazy(() =>
  import('./components/ProductHistoryModal').then((m) => ({ default: m.ProductHistoryModal }))
);
const BarcodeScannerModal = lazy(() =>
  import('./components/BarcodeScannerModal').then((m) => ({ default: m.BarcodeScannerModal }))
);
const ImageSearchModal = lazy(() =>
  import('./components/ImageSearchModal').then((m) => ({ default: m.ImageSearchModal }))
);
const VisualSearchTestModal = lazy(() =>
  import('./components/VisualSearchTestModal').then((m) => ({ default: m.VisualSearchTestModal }))
);
import { CheckoutPage } from './components/CheckoutPage';
import { QuantityInputModal } from './components/QuantityInputModal';
import type { CartItem } from './types/checkout';
import { UserProfilePage } from './components/UserProfilePage';
import { Sidebar } from './components/Sidebar';
import { OfflineBanner } from './components/OfflineBanner';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { clearProductImageCache } from './services/storageService';
// Tự động đồng bộ vector ảnh ngầm khi thêm/sửa sản phẩm
import {
  fetchActiveProducts,
  fetchDeletedProducts,
  softDeleteProduct,
  restoreProduct,
  checkoutProducts,
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

  // 4. Quản lý bộ lọc, tìm kiếm & sắp xếp
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [isCartOnlyFilter, setIsCartOnlyFilter] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    try {
      const saved = localStorage.getItem('family_inventory_sort_by');
      if (saved) return saved as SortOption;
    } catch {
      // Bỏ qua lỗi truy cập localStorage
    }
    return 'newest';
  });
  const [retryCounter, setRetryCounter] = useState(0);

  const handleSortChange = useCallback((newSort: SortOption) => {
    setSortBy(newSort);
    try {
      localStorage.setItem('family_inventory_sort_by', newSort);
    } catch {
      // Bỏ qua lỗi ghi localStorage
    }
  }, []);

  // 5. Quản lý modal Chi tiết sản phẩm
  const [selectedDetailProduct, setSelectedDetailProduct] = useState<Product | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  // 5.1 Quản lý modal Xác nhận xóa mềm
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 5.2 Quản lý modal Thêm sản phẩm mới / Sửa thông tin sản phẩm
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);

  // 5.2.1 Quản lý modal Nhập kho (chỉnh số lượng và giá sản phẩm đã có sẵn)
  const [isStockInModalOpen, setIsStockInModalOpen] = useState(false);
  const [stockInTargetProduct, setStockInTargetProduct] = useState<Product | null>(null);

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

  // 5.7 Quản lý modal Kiểm thử 7 kịch bản Visual Search
  const [isAiTestModalOpen, setIsAiTestModalOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('testModal') === 'true' || params.has('autoRun');
    }
    return false;
  });

  // 5.8 Quản lý điều hướng màn hình (Kho hàng vs Hồ sơ cá nhân vs Máy tính tiền riêng)
  const [currentView, setCurrentView] = useState<'inventory' | 'profile' | 'pos'>('inventory');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 5.9 Quản lý đơn tính tiền / giỏ hàng
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('family_inventory_cart');
      if (saved) {
        return JSON.parse(saved) as CartItem[];
      }
    } catch {
      // Bỏ qua lỗi truy cập localStorage
    }
    return [];
  });
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const isCheckoutScanningRef = useRef(false);
  const [selectedQtyProduct, setSelectedQtyProduct] = useState<Product | null>(null);

  // Tự động lưu giỏ hàng vào localStorage và reset filter nếu giỏ trống
  useEffect(() => {
    try {
      localStorage.setItem('family_inventory_cart', JSON.stringify(cartItems));
    } catch {
      // Bỏ qua lỗi ghi localStorage
    }
    if (cartItems.length === 0 && isCartOnlyFilter) {
      setIsCartOnlyFilter(false);
    }
  }, [cartItems, isCartOnlyFilter]);

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
        setIsStockInModalOpen(false);
        setStockInTargetProduct(null);
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

        // 3. Tự động kiểm tra và đồng bộ vector ngầm cho các sản phẩm còn pending
        if (activeMember.can_edit) {
          import('./services/aiSearchService')
            .then(({ triggerAutoSyncPendingEmbeddings }) => triggerAutoSyncPendingEmbeddings())
            .catch((err) => console.warn('[AUTO_SYNC_VECTOR_INIT_WARN]', err));
        }
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
    setIsStockInModalOpen(false);
    setStockInTargetProduct(null);
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

  // Mở modal Nhập kho (chỉnh số lượng và giá của sản phẩm đã có sẵn)
  const handleOpenStockIn = useCallback((targetProduct?: Product | null) => {
    setStockInTargetProduct(targetProduct || null);
    setSelectedDetailProduct(null);
    setIsStockInModalOpen(true);
  }, []);

  // Đóng modal Nhập kho
  const handleCloseStockIn = useCallback(() => {
    setIsStockInModalOpen(false);
    setStockInTargetProduct(null);
  }, []);

  // Xử lý khi Nhập kho thành công
  const handleStockInSuccess = useCallback(
    (updatedProduct: Product, oldStock: number, newStock: number) => {
      // Cập nhật ngay trong state products để phản hồi mượt mà không cần đợi reload
      setProducts((prev) =>
        prev.map((p) => (p.id === updatedProduct.id ? updatedProduct : p))
      );

      // Tải lại toàn bộ dữ liệu từ server để đồng bộ
      if (member?.can_edit) {
        reloadProducts(true);
      }

      showToast({
        text: `Đã nhập kho thành công cho "${updatedProduct.name}"! Tồn kho mới: ${newStock} ${updatedProduct.unit} (Trước: ${oldStock}). Giá bán: ${formatCurrency(updatedProduct.salePrice)}.`,
        type: 'success',
      });
    },
    [member?.can_edit, reloadProducts, showToast]
  );

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

      if (productToRestore.imageUrl) {
        import('./services/aiSearchService')
          .then(({ triggerAutoSyncPendingEmbeddings }) => triggerAutoSyncPendingEmbeddings())
          .catch((err) => console.warn('[AUTO_SYNC_VECTOR_RESTORE_WARN]', err));
      }

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

  // Thao tác với Đơn tính tiền / Giỏ hàng
  const handleAddToCart = useCallback((product: Product, quantity = 1) => {
    setCartItems((prev) => {
      const idx = prev.findIndex((i) => i.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      return [
        ...prev,
        {
          productId: product.id,
          product,
          quantity,
          salePrice: product.salePrice,
        },
      ];
    });

    showToast({
      text: `Đã thêm "${product.name}" vào đơn tính tiền.`,
      type: 'success',
      actionLabel: 'Xem đơn',
      onAction: () => {
        setCurrentView('pos');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });
  }, [showToast]);

  const handleUpdateCartQuantity = useCallback((productId: string, quantity: number) => {
    setCartItems((prev) => {
      if (quantity <= 0) {
        return prev.filter((i) => i.productId !== productId);
      }
      return prev.map((i) => (i.productId === productId ? { ...i, quantity } : i));
    });
  }, []);

  const handleOpenQuantityInput = useCallback((product: Product) => {
    setSelectedQtyProduct(product);
  }, []);

  const handleRemoveFromCart = useCallback((productId: string) => {
    setCartItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const handleClearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const handleConfirmCheckout = useCallback(async (items: CartItem[]) => {
    if (items.length === 0) return;
    setIsCheckingOut(true);

    try {
      const payload = items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      }));

      const res = await checkoutProducts(payload);

      if (res.error) {
        showToast({
          text: `Thanh toán thất bại: ${res.error}`,
          type: 'warning',
        });
        return;
      }

      if (res.data && res.data.length > 0) {
        const updatedMap = new Map(res.data.map((p) => [p.id, p]));
        setProducts((prev) => prev.map((p) => updatedMap.get(p.id) || p));
      }

      const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
      const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.salePrice, 0);

      setCartItems([]);

      showToast({
        text: `✅ Đã bán ${totalQty} sản phẩm (Tổng: ${formatCurrency(totalAmount)}) và trừ kho thành công!`,
        type: 'success',
      });
    } catch (err) {
      showToast({
        text: `Lỗi kết nối khi thanh toán: ${err instanceof Error ? err.message : 'Vui lòng thử lại.'}`,
        type: 'warning',
      });
    } finally {
      setIsCheckingOut(false);
    }
  }, [showToast]);

  const cartCount = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.quantity, 0);
  }, [cartItems]);

  const cartTotalAmount = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.quantity * item.salePrice, 0);
  }, [cartItems]);

  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of cartItems) {
      map[item.productId] = item.quantity;
    }
    return map;
  }, [cartItems]);

  // Xử lý khi chọn sản phẩm từ kết quả quét mã vạch
  const handleSelectProductFromBarcode = useCallback((scannedProduct: Product) => {
    if (isCheckoutScanningRef.current) {
      isCheckoutScanningRef.current = false;
      handleAddToCart(scannedProduct, 1);
      return;
    }
    setSearchTerm(scannedProduct.barcode || scannedProduct.code);
    setSelectedCategory('ALL');
  }, [handleAddToCart]);

  // Mở modal Tìm bằng ảnh (tự động đóng Quét mã vạch để tránh xung đột camera)
  const handleOpenImageSearch = useCallback((triggerEl: HTMLElement) => {
    setIsBarcodeScannerOpen(false);
    imageSearchTriggerRef.current = triggerEl;
    setIsImageSearchOpen(true);
    // Tự động kích hoạt đồng bộ vector ngầm cho các sản phẩm còn pending trong kho
    import('./services/aiSearchService')
      .then(({ triggerAutoSyncPendingEmbeddings }) => triggerAutoSyncPendingEmbeddings())
      .catch((err) => console.warn('[AUTO_SYNC_VECTOR_OPEN_WARN]', err));
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

  // Chuyển sang trang Chỉnh sửa hồ sơ người dùng
  const handleOpenProfile = useCallback(() => {
    setCurrentView('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Quay lại trang danh mục kho hàng
  const handleBackToInventory = useCallback(() => {
    setCurrentView('inventory');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Chuyển sang trang Bán hàng & Tính tiền riêng biệt
  const handleOpenPos = useCallback(() => {
    setCurrentView('pos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Cập nhật thông tin thành viên sau khi lưu hồ sơ
  const handleProfileUpdated = useCallback((updatedMember: FamilyMember) => {
    setMember(updatedMember);
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

      // Tự động kích hoạt đồng bộ vector ngầm cho sản phẩm có ảnh vừa thêm/sửa mà không cần nhấn thủ công
      if (savedProduct.imageUrl) {
        import('./services/aiSearchService')
          .then(({ triggerAutoSyncPendingEmbeddings }) => triggerAutoSyncPendingEmbeddings())
          .catch((err) => console.warn('[AUTO_SYNC_VECTOR_SAVE_WARN]', err));
      }
    },
    [searchTerm, selectedCategory, showToast]
  );

  // Danh sách các danh mục duy nhất từ sản phẩm đang sử dụng
  const categories = useMemo(() => {
    return Array.from(new Set(products.map((item) => item.category)));
  }, [products]);

  // Lọc và sắp xếp sản phẩm theo danh mục, từ khóa và tiêu chí sort
  const filteredProducts = useMemo(() => {
    const rawSearch = searchTerm.trim();
    const normalizedQuery = removeVietnameseTones(rawSearch);

    const filtered = products.filter((product) => {
      // 0. Nếu đang lọc xem các món đang bán trong đơn
      if (isCartOnlyFilter && !cartQuantities[product.id]) {
        return false;
      }

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

    // 3. Sắp xếp danh sách đã lọc theo tiêu chí người dùng chọn
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'newest': {
          const timeA = new Date(a.createdAt || 0).getTime();
          const timeB = new Date(b.createdAt || 0).getTime();
          return timeB - timeA;
        }
        case 'updated': {
          const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return timeB - timeA;
        }
        case 'name_asc': {
          return a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
        }
        case 'name_desc': {
          return b.name.localeCompare(a.name, 'vi', { sensitivity: 'base' });
        }
        case 'stock_asc': {
          return a.stock - b.stock;
        }
        case 'stock_desc': {
          return b.stock - a.stock;
        }
        case 'price_asc': {
          return a.salePrice - b.salePrice;
        }
        case 'price_desc': {
          return b.salePrice - a.salePrice;
        }
        case 'code_asc': {
          return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [products, searchTerm, selectedCategory, isCartOnlyFilter, cartQuantities, sortBy]);

  const hasFiltersApplied = searchTerm.trim() !== '' || selectedCategory !== 'ALL' || isCartOnlyFilter;

  const handleResetFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedCategory('ALL');
    setIsCartOnlyFilter(false);
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

  // MÀN HÌNH 7: Thành viên hợp lệ -> Hiển thị ứng dụng với thanh Menu bên trái (Sidebar)
  return (
    <div className="app-layout-wrapper">
      {/* Thanh menu bên trái (Sidebar) */}
      <Sidebar
        currentView={currentView}
        totalProducts={products.length}
        deletedCount={deletedProducts.length}
        member={member}
        canEdit={canEdit}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        onNavigateInventory={handleBackToInventory}
        onNavigateProfile={handleOpenProfile}
        onOpenStockIn={() => handleOpenStockIn(null)}
        onOpenAddNewProduct={handleOpenAddModal}
        onOpenImageSearch={() => handleOpenImageSearch(addBtnRef.current || document.body)}
        onOpenBarcodeScanner={() => handleOpenBarcodeScanner(addBtnRef.current || document.body)}
        onOpenTrash={() => setIsDeletedModalOpen(true)}
        onOpenCheckout={handleOpenPos}
        cartCount={cartCount}
        onSignOut={handleSignOut}
        isSigningOut={isSigningOut}
      />

      <div className="app-main-content-column">
        {/* Thanh App Bar cố định trên di động (chỉ hiển thị khi màn hình <= 900px) */}
        <div className="mobile-app-bar">
          <button
            type="button"
            className="mobile-app-bar-menu-btn"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Mở thanh menu bên trái"
            title="Mở menu quản lý kho"
          >
            <span className="mobile-bar-menu-icon" aria-hidden="true">☰</span>
            <span className="mobile-bar-menu-label">Menu</span>
          </button>

          <div className="mobile-app-bar-center">
            <span className="mobile-bar-logo" aria-hidden="true">📦</span>
            <span className="mobile-bar-title">Kho Gia Đình</span>
          </div>

          <div className="mobile-app-bar-right">
            {/* Nút Tính tiền nhanh trên thanh di động */}
            <button
              type="button"
              className="mobile-bar-action-btn"
              onClick={handleOpenPos}
              title="Máy tính tiền / Bán hàng"
              aria-label={`Mở máy tính tiền, ${cartCount} sản phẩm`}
              style={{ position: 'relative' }}
            >
              <span>🧮</span>
              {cartCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '-3px',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    borderRadius: '9999px',
                    padding: '1px 5px',
                    lineHeight: 1.2,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }}
                >
                  {cartCount}
                </span>
              )}
            </button>

            {canEdit && (
              <button
                type="button"
                className="mobile-bar-action-btn"
                onClick={() => handleOpenStockIn(null)}
                title="Nhập kho nhanh"
                aria-label="Nhập kho nhanh"
              >
                📥
              </button>
            )}
            {member && (
              <button
                type="button"
                className="mobile-bar-avatar-btn"
                onClick={handleOpenProfile}
                title={`Hồ sơ của ${member.display_name}`}
                aria-label="Xem hồ sơ cá nhân"
              >
                {member.display_name ? member.display_name.charAt(0).toUpperCase() : '👤'}
              </button>
            )}
          </div>
        </div>

        {currentView === 'profile' && member ? (
          <UserProfilePage
            member={member}
            userEmail={session?.user?.email}
            onBackToHome={handleBackToInventory}
            onProfileUpdated={handleProfileUpdated}
            onSignOut={handleSignOut}
            isSigningOut={isSigningOut}
            onShowToast={showToast}
          />
        ) : currentView === 'pos' ? (
          <CheckoutPage
            products={products}
            categories={categories}
            cartItems={cartItems}
            onAddToCart={handleAddToCart}
            onUpdateQuantity={handleUpdateCartQuantity}
            onRemoveItem={handleRemoveFromCart}
            onClearCart={handleClearCart}
            onConfirmCheckout={handleConfirmCheckout}
            isCheckingOut={isCheckingOut}
            canEdit={canEdit}
            onBackToInventory={handleBackToInventory}
            onOpenBarcodeScanner={() => {
              isCheckoutScanningRef.current = true;
              setIsBarcodeScannerOpen(true);
            }}
            onOpenQuantityInput={handleOpenQuantityInput}
            onShowToast={(msg, type) => showToast({ text: msg, type })}
          />
        ) : (
          <div className="app-content">
            <Header
              totalCount={products.length}
              member={member}
              onSignOut={handleSignOut}
              isSigningOut={isSigningOut}
              onOpenAddModal={handleOpenAddModal}
              addBtnRef={addBtnRef}
              onOpenProfile={handleOpenProfile}
              onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
              cartCount={cartCount}
              onOpenCheckout={handleOpenPos}
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
                  sortBy={sortBy}
                  onSortChange={handleSortChange}
                  onOpenBarcodeScanner={handleOpenBarcodeScanner}
                  onOpenImageSearch={handleOpenImageSearch}
                  canEdit={canEdit}
                  deletedCount={deletedProducts.length}
                  onOpenDeletedProducts={handleOpenDeletedProductsModal}
                  cartCount={cartCount}
                  isCartOnly={isCartOnlyFilter}
                  onToggleCartOnly={() => setIsCartOnlyFilter((prev) => !prev)}
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
                cartQuantities={cartQuantities}
                onAddToCart={handleAddToCart}
                onUpdateQuantity={handleUpdateCartQuantity}
                onOpenQuantityInput={handleOpenQuantityInput}
              />
            </>
          )}
        </main>

        <footer className="app-footer">
          <p>Kho gia đình • Quản lý hàng hóa và kho nội bộ gia đình</p>
          {canEdit && (
            <div style={{ marginTop: '8px' }}>
              <button
                type="button"
                id="btn-admin-visual-test"
                onClick={() => setIsAiTestModalOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: '4px 8px',
                }}
                title="Khu vực kiểm định kỹ thuật dành riêng cho Biên tập viên"
              >
                ⚙️ Công cụ kiểm thử Visual Search (Admin)
              </button>
            </div>
          )}
        </footer>
          </div>
        )}
      </div>

      {/* Modal Chi tiết sản phẩm (khi bấm vào bất kỳ thẻ sản phẩm nào) */}
      {selectedDetailProduct && (
        <ProductDetailModal
          isOpen={Boolean(selectedDetailProduct)}
          product={selectedDetailProduct}
          canEdit={canEdit}
          onClose={handleCloseDetailModal}
          onEdit={(prod, triggerEl) => handleOpenEditModal(prod, triggerEl)}
          onStockIn={(prod) => handleOpenStockIn(prod)}
          onViewHistory={(prod, triggerEl) => handleOpenHistoryModal(prod, triggerEl)}
          onOpenDeleteConfirm={handleOpenDeleteConfirm}
          triggerElementRef={detailTriggerRef}
          cartQuantity={selectedDetailProduct ? cartQuantities[selectedDetailProduct.id] || 0 : 0}
          onAddToCart={handleAddToCart}
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
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {/* Modal Thêm / Chỉnh sửa sản phẩm */}
      <ProductFormModal
        isOpen={isModalOpen}
        productToEdit={productToEdit}
        existingCategories={categories}
        existingProducts={products}
        userId={userId}
        onClose={handleCloseModal}
        onSaveSuccess={handleSaveSuccess}
        triggerElementRef={activeTriggerRef}
        isOnline={isOnline}
        onDirtyChange={setIsFormDirty}
      />

      {/* Modal Nhập kho (chỉnh số lượng và giá của sản phẩm đã có sẵn) */}
      <StockInModal
        isOpen={isStockInModalOpen}
        onClose={handleCloseStockIn}
        products={products}
        initialProduct={stockInTargetProduct}
        onStockInSuccess={handleStockInSuccess}
        isOnline={isOnline}
      />

      {/* Modal Lịch sử thay đổi sản phẩm */}
      {isHistoryModalOpen && selectedHistoryProduct && (
        <Suspense fallback={null}>
          <ProductHistoryModal
            isOpen={isHistoryModalOpen}
            product={selectedHistoryProduct}
            onClose={handleCloseHistoryModal}
            triggerElementRef={historyTriggerRef}
          />
        </Suspense>
      )}

      {/* Modal Quét mã vạch sản phẩm */}
      {isBarcodeScannerOpen && (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            isOpen={isBarcodeScannerOpen}
            onClose={handleCloseBarcodeScanner}
            onSelectProduct={handleSelectProductFromBarcode}
            triggerElementRef={barcodeScannerTriggerRef}
          />
        </Suspense>
      )}

      {/* Modal Tìm kiếm sản phẩm bằng ảnh bao bì qua AI */}
      {isImageSearchOpen && (
        <Suspense fallback={null}>
          <ImageSearchModal
            isOpen={isImageSearchOpen}
            onClose={handleCloseImageSearch}
            onSelectProduct={handleSelectProductFromImageSearch}
            triggerElementRef={imageSearchTriggerRef}
            isOnline={isOnline}
          />
        </Suspense>
      )}

      {/* Modal Kiểm thử 6 kịch bản Visual Search */}
      {isAiTestModalOpen && (
        <Suspense fallback={null}>
          <VisualSearchTestModal
            isOpen={isAiTestModalOpen}
            onClose={() => setIsAiTestModalOpen(false)}
            onSuccessReload={reloadProducts}
          />
        </Suspense>
      )}

      {/* Thanh Giỏ hàng nổi dưới màn hình khi đang ở trang Kho hàng và có sản phẩm được chọn */}
      {cartItems.length > 0 && currentView === 'inventory' && (
        <div
          className="floating-cart-bar"
          onClick={handleOpenPos}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOpenPos();
            }
          }}
          aria-label={`Mở trang tính tiền gồm ${cartCount} sản phẩm, tổng ${formatCurrency(cartTotalAmount)}`}
        >
          <div className="floating-cart-left">
            <div className="floating-cart-icon-box">
              <span aria-hidden="true">🛒</span>
              <span className="floating-cart-badge">{cartCount}</span>
            </div>
            <div className="floating-cart-info">
              <span className="floating-cart-count">
                {cartItems.length} mặt hàng ({cartCount} món)
              </span>
              <span className="floating-cart-total">{formatCurrency(cartTotalAmount)}</span>
            </div>
          </div>
          <div className="floating-cart-right">
            <span>Tính tiền ❯</span>
          </div>
        </div>
      )}

      {/* Modal nhập trực tiếp số lượng cụ thể (1, 5, 10, 20... hoặc gõ tự do) */}
      {selectedQtyProduct && (
        <QuantityInputModal
          isOpen={Boolean(selectedQtyProduct)}
          product={selectedQtyProduct}
          currentQuantity={cartQuantities[selectedQtyProduct.id] || 0}
          onClose={() => setSelectedQtyProduct(null)}
          onConfirm={(productId, newQty) => {
            handleUpdateCartQuantity(productId, newQty);
            setSelectedQtyProduct(null);
          }}
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
