import { useState, useMemo, useRef, type ChangeEvent } from 'react';
import type { Product } from '../types/product';
import type { CartItem } from '../types/checkout';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput, removeVietnameseTones } from '../utils/formatters';
import { calculateCartTotals, calculateChange, formatReceiptText } from '../utils/checkoutHelper';
import { ProductImage } from './ProductImage';
import './CheckoutPage.css';

interface CheckoutPageProps {
  products: Product[];
  categories: string[];
  cartItems: CartItem[];
  onAddToCart: (product: Product, quantity?: number) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onClearCart: () => void;
  onConfirmCheckout: (items: CartItem[]) => Promise<void>;
  isCheckingOut: boolean;
  canEdit: boolean;
  onBackToInventory: () => void;
  onOpenBarcodeScanner?: () => void;
  onOpenQuantityInput?: (product: Product) => void;
  onShowToast: (message: string, type: 'success' | 'info' | 'warning') => void;
  initialTab?: 'catalog' | 'receipt';
}

export function CheckoutPage({
  products,
  categories,
  cartItems,
  onAddToCart,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onConfirmCheckout,
  isCheckingOut,
  canEdit,
  onBackToInventory,
  onOpenBarcodeScanner,
  onOpenQuantityInput,
  onShowToast,
  initialTab,
}: CheckoutPageProps) {
  // Mobile tab state: 'catalog' (chọn hàng) vs 'receipt' (hóa đơn)
  const [mobileTab, setMobileTab] = useState<'catalog' | 'receipt'>(
    initialTab || (cartItems.length > 0 ? 'receipt' : 'catalog')
  );

  // Search & Filter state for product selection
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Payment calculator state
  const [cashGivenInput, setCashGivenInput] = useState<string>('');
  const [showCashCalc, setShowCashCalc] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Map quantity in cart for fast lookup on product cards
  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of cartItems) {
      map[item.productId] = item.quantity;
    }
    return map;
  }, [cartItems]);

  // Calculate cart totals
  const { totalQuantity, totalAmount, hasStockIssue } = useMemo(() => {
    return calculateCartTotals(cartItems);
  }, [cartItems]);

  // Calculate change to return to customer
  const parsedCashGiven = useMemo(() => {
    return parseCurrencyInput(cashGivenInput);
  }, [cashGivenInput]);

  const changeToReturn = useMemo(() => {
    return calculateChange(totalAmount, parsedCashGiven);
  }, [parsedCashGiven, totalAmount]);

  // Filter catalog products for fast selection
  const filteredProducts = useMemo(() => {
    const raw = searchTerm.trim();
    const norm = removeVietnameseTones(raw.toLowerCase());

    return products.filter((p) => {
      // Category filter
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) {
        return false;
      }

      // Search keyword filter
      if (!raw) return true;

      const matchName = removeVietnameseTones(p.name.toLowerCase()).includes(norm);
      const matchCode = p.code.toLowerCase().includes(norm);
      const matchBarcode = p.barcode ? p.barcode.toLowerCase().includes(norm) : false;
      return matchName || matchCode || matchBarcode;
    });
  }, [products, searchTerm, selectedCategory]);

  // Copy receipt text to clipboard for Zalo / SMS
  const handleCopyReceipt = async () => {
    if (cartItems.length === 0) return;

    const receipt = formatReceiptText(cartItems, parsedCashGiven > 0 ? parsedCashGiven : undefined);

    try {
      await navigator.clipboard.writeText(receipt);
      onShowToast('Đã sao chép hóa đơn để dán gửi Zalo/SMS!', 'success');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = receipt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      onShowToast('Đã sao chép hóa đơn thành công!', 'success');
    }
  };

  // Submit checkout and deduct stock
  const handleSubmitCheckout = async () => {
    if (cartItems.length === 0) return;

    if (!canEdit) {
      onShowToast('Tài khoản của bạn chỉ có quyền xem, không thể trừ kho.', 'warning');
      return;
    }

    if (hasStockIssue) {
      onShowToast('Có sản phẩm vượt quá tồn kho. Vui lòng điều chỉnh lại số lượng.', 'warning');
      return;
    }

    await onConfirmCheckout(cartItems);
  };

  return (
    <div className="pos-page-container">
      {/* 1. Header Trang Bán Hàng */}
      <header className="pos-page-header">
        <div className="pos-header-left">
          <button
            type="button"
            className="pos-back-btn"
            onClick={onBackToInventory}
            title="Quay lại danh mục kho hàng"
            aria-label="Quay lại danh mục kho hàng"
          >
            ← Kho hàng
          </button>
          <div className="pos-title-group">
            <h1 className="pos-page-title">
              <span className="pos-title-icon" aria-hidden="true">🧮</span>
              <span>Bán hàng & Tính tiền</span>
            </h1>
            {totalQuantity > 0 && (
              <span className="pos-total-badge">
                {totalQuantity} món ({cartItems.length} loại)
              </span>
            )}
          </div>
        </div>

        <div className="pos-header-right">
          {cartItems.length > 0 && (
            <>
              {isConfirmingReset ? (
                <button
                  type="button"
                  className="btn-pos-clear confirming"
                  onClick={() => {
                    onClearCart();
                    setIsConfirmingReset(false);
                    onShowToast('Đã làm trống đơn hàng.', 'info');
                  }}
                  title="Xác nhận xóa trắng toàn bộ đơn"
                >
                  Xác nhận xóa?
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-pos-clear"
                  onClick={() => setIsConfirmingReset(true)}
                  title="Xóa trắng giỏ tính tiền"
                >
                  Xóa đơn
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* 2. Thanh chuyển Tab trên Di động (Chọn hàng vs Hóa đơn) */}
      <div className="pos-mobile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'catalog'}
          className={`pos-tab-btn ${mobileTab === 'catalog' ? 'is-active' : ''}`}
          onClick={() => setMobileTab('catalog')}
        >
          <span aria-hidden="true">🛍️</span>
          <span>Chọn hàng</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'receipt'}
          className={`pos-tab-btn ${mobileTab === 'receipt' ? 'is-active' : ''}`}
          onClick={() => setMobileTab('receipt')}
        >
          <span aria-hidden="true">🧾</span>
          <span>Hóa đơn</span>
          {totalQuantity > 0 && (
            <span className="pos-tab-counter">{totalQuantity}</span>
          )}
        </button>
      </div>

      {/* 3. Thân trang: Responsive 2 cột trên Desktop / Tab trên Mobile */}
      <div className="pos-main-layout">
        {/* CỘT 1: KHU VỰC CHỌN HÀNG HÓA */}
        <section
          className={`pos-catalog-column ${mobileTab === 'catalog' ? 'mobile-visible' : 'mobile-hidden'}`}
          aria-label="Khu vực chọn hàng hóa"
        >
          {/* Thanh tìm kiếm & Quét mã */}
          <div className="pos-search-bar">
            <div className="pos-search-input-wrap">
              <span className="pos-search-icon" aria-hidden="true">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                className="pos-search-input"
                placeholder="Tìm tên, mã hàng, mã vạch..."
                value={searchTerm}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="pos-search-clear-btn"
                  onClick={() => setSearchTerm('')}
                  aria-label="Xóa từ khóa tìm kiếm"
                >
                  ✕
                </button>
              )}
            </div>

            {onOpenBarcodeScanner && (
              <button
                type="button"
                className="pos-barcode-btn"
                onClick={onOpenBarcodeScanner}
                title="Quét mã vạch thêm vào đơn"
              >
                <span>📷</span>
                <span className="pos-barcode-text">Quét mã</span>
              </button>
            )}
          </div>

          {/* Thanh danh mục dạng cuộn ngang */}
          <div className="pos-category-scroll">
            <button
              type="button"
              className={`pos-cat-pill ${selectedCategory === 'ALL' ? 'is-active' : ''}`}
              onClick={() => setSelectedCategory('ALL')}
            >
              Tất cả ({products.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`pos-cat-pill ${selectedCategory === cat ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Lưới sản phẩm để bán hàng nhanh */}
          <div className="pos-product-grid">
            {filteredProducts.length === 0 ? (
              <div className="pos-no-products">
                <span className="pos-no-icon" aria-hidden="true">🔍</span>
                <p>Không tìm thấy sản phẩm nào khớp với tìm kiếm.</p>
                {(searchTerm || selectedCategory !== 'ALL') && (
                  <button
                    type="button"
                    className="btn-pos-reset-filters"
                    onClick={() => {
                      setSearchTerm('');
                      setSelectedCategory('ALL');
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                )}
              </div>
            ) : (
              filteredProducts.map((p) => {
                const qtyInCart = cartQuantities[p.id] || 0;
                const isOutOfStock = p.stock <= 0;

                return (
                  <article
                    key={p.id}
                    className={`pos-product-card ${qtyInCart > 0 ? 'in-cart' : ''} ${isOutOfStock ? 'is-out-of-stock' : ''}`}
                  >
                    <div className="pos-card-media">
                      <ProductImage
                        storagePath={p.imageUrl}
                        alt={p.name}
                        className="pos-card-thumb"
                      />
                      {isOutOfStock && (
                        <span className="pos-out-badge">Hết hàng</span>
                      )}
                    </div>

                    <div className="pos-card-info">
                      <h3 className="pos-card-name" title={p.name}>
                        {p.name}
                      </h3>
                      <div className="pos-card-meta">
                        <span className="pos-card-price">{formatCurrency(p.salePrice)}</span>
                        <span className="pos-card-stock">
                          Tồn: <strong>{p.stock}</strong> {p.unit}
                        </span>
                      </div>

                      {/* Bộ điều khiển số lượng trực tiếp trên thẻ */}
                      <div className="pos-card-actions">
                        {qtyInCart > 0 ? (
                          <div className="pos-stepper">
                            <button
                              type="button"
                              className="pos-stepper-btn minus"
                              onClick={() => onUpdateQuantity(p.id, qtyInCart - 1)}
                              title="Giảm 1"
                              aria-label={`Giảm số lượng ${p.name}`}
                            >
                              −
                            </button>

                            <button
                              type="button"
                              className="pos-stepper-qty-btn"
                              onClick={() => onOpenQuantityInput?.(p)}
                              title="Bấm để gõ số lượng cụ thể"
                              aria-label={`Đang chọn ${qtyInCart} ${p.unit}. Bấm để nhập số khác`}
                            >
                              <span className="pos-stepper-num">{qtyInCart}</span>
                              <span className="pos-stepper-unit">{p.unit}</span>
                            </button>

                            <button
                              type="button"
                              className="pos-stepper-btn plus"
                              onClick={() => onUpdateQuantity(p.id, qtyInCart + 1)}
                              disabled={p.stock > 0 && qtyInCart >= p.stock}
                              title={
                                p.stock > 0 && qtyInCart >= p.stock
                                  ? 'Đã đạt giới hạn tồn kho'
                                  : 'Tăng 1'
                              }
                              aria-label={`Tăng số lượng ${p.name}`}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-pos-add"
                            onClick={() => onAddToCart(p, 1)}
                            disabled={isOutOfStock}
                            title={isOutOfStock ? 'Hết hàng' : 'Thêm vào đơn'}
                          >
                            <span>＋</span>
                            <span>{isOutOfStock ? 'Hết hàng' : 'Bán hàng'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Thanh nổi dưới cùng trên Mobile khi đang ở Tab Chọn hàng */}
          {totalQuantity > 0 && (
            <div
              className="pos-floating-summary-bar"
              onClick={() => setMobileTab('receipt')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setMobileTab('receipt');
                }
              }}
              aria-label={`Xem hóa đơn gồm ${totalQuantity} món, tổng ${formatCurrency(totalAmount)}`}
            >
              <div className="pos-floating-left">
                <span className="pos-floating-icon" aria-hidden="true">🛒</span>
                <div className="pos-floating-text">
                  <span className="pos-floating-count">{totalQuantity} món ({cartItems.length} loại)</span>
                  <strong className="pos-floating-total">{formatCurrency(totalAmount)}</strong>
                </div>
              </div>
              <div className="pos-floating-right">
                <span>Xem hóa đơn ❯</span>
              </div>
            </div>
          )}
        </section>

        {/* CỘT 2: KHU VỰC HÓA ĐƠN & THANH TOÁN */}
        <section
          className={`pos-receipt-column ${mobileTab === 'receipt' ? 'mobile-visible' : 'mobile-hidden'}`}
          aria-label="Khu vực hóa đơn bán hàng"
        >
          <div className="pos-receipt-card">
            <div className="pos-receipt-header">
              <div className="receipt-header-left">
                <span className="receipt-icon" aria-hidden="true">🧾</span>
                <h2 className="receipt-title">Hóa đơn bán hàng</h2>
              </div>
              {cartItems.length > 0 && (
                <button
                  type="button"
                  className="btn-pos-add-more"
                  onClick={() => setMobileTab('catalog')}
                  title="Chọn thêm mặt hàng khác vào đơn"
                >
                  ＋ Thêm món
                </button>
              )}
            </div>

            {/* Danh sách món hàng trong đơn */}
            <div className="pos-receipt-body">
              {cartItems.length === 0 ? (
                <div className="pos-empty-receipt">
                  <span className="empty-cart-icon" aria-hidden="true">🛒</span>
                  <h3 className="empty-title">Đơn hàng đang trống</h3>
                  <p className="empty-desc">
                    Chưa có món hàng nào được chọn. Hãy bấm nút bên dưới để chọn các mặt hàng cần bán.
                  </p>
                  <button
                    type="button"
                    className="btn-go-to-catalog"
                    onClick={() => setMobileTab('catalog')}
                  >
                    👉 Bấm để chọn hàng từ kho
                  </button>
                </div>
              ) : (
                <div className="pos-cart-list">
                  {cartItems.map((item) => {
                    const isOverStock = item.product.stock > 0 && item.quantity > item.product.stock;
                    const lineTotal = item.quantity * item.salePrice;

                    return (
                      <div
                        key={item.productId}
                        className={`pos-cart-item ${isOverStock ? 'has-stock-warning' : ''}`}
                      >
                        <div className="cart-item-main">
                          <div className="cart-item-thumb-box">
                            <ProductImage
                              storagePath={item.product.imageUrl}
                              alt={item.product.name}
                              className="cart-item-thumb"
                            />
                          </div>

                          <div className="cart-item-details">
                            <span className="cart-item-name" title={item.product.name}>
                              {item.product.name}
                            </span>
                            <div className="cart-item-sub">
                              <span className="cart-item-unit-price">
                                {formatCurrency(item.salePrice)} / {item.product.unit}
                              </span>
                              <span className="cart-item-stock-hint">
                                (Kho: {item.product.stock})
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="btn-cart-remove"
                            onClick={() => onRemoveItem(item.productId)}
                            title="Xóa món này khỏi đơn"
                            aria-label={`Xóa ${item.product.name} khỏi đơn`}
                          >
                            ✕
                          </button>
                        </div>

                        {/* Cảnh báo vượt tồn kho */}
                        {isOverStock && (
                          <div className="cart-stock-warning">
                            ⚠️ Vượt quá tồn kho (Kho còn {item.product.stock} {item.product.unit})
                          </div>
                        )}

                        {/* Hàng bộ chỉnh số lượng & Thành tiền */}
                        <div className="cart-item-bottom">
                          <div className="pos-item-stepper">
                            <button
                              type="button"
                              className="pos-stepper-btn minus"
                              onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}
                              title="Giảm 1"
                            >
                              −
                            </button>

                            <button
                              type="button"
                              className="pos-item-qty-btn"
                              onClick={() => onOpenQuantityInput?.(item.product)}
                              title="Bấm để gõ số lượng cụ thể"
                            >
                              <span className="pos-item-qty-val">{item.quantity}</span>
                              <span className="pos-item-unit-val">{item.product.unit}</span>
                              <span className="pos-item-edit-icon" aria-hidden="true">✏️</span>
                            </button>

                            <button
                              type="button"
                              className="pos-stepper-btn plus"
                              onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
                              disabled={item.product.stock > 0 && item.quantity >= item.product.stock}
                              title="Tăng 1"
                            >
                              +
                            </button>
                          </div>

                          <div className="cart-item-subtotal">
                            <span className="subtotal-formula">
                              {item.quantity} × {formatCurrency(item.salePrice)}
                            </span>
                            <strong className="subtotal-amount">
                              {formatCurrency(lineTotal)}
                            </strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bảng tổng tiền & Thanh toán */}
            {cartItems.length > 0 && (
              <div className="pos-receipt-summary">
                <div className="summary-line">
                  <span className="summary-label">Số lượng mặt hàng:</span>
                  <span className="summary-val">
                    <strong>{totalQuantity}</strong> món ({cartItems.length} loại)
                  </span>
                </div>

                <div className="summary-line grand-total-line">
                  <span className="grand-label">TỔNG TIỀN:</span>
                  <strong className="grand-val">{formatCurrency(totalAmount)}</strong>
                </div>

                {/* Phần tính tiền khách đưa & tiền thối lại (Gọn gàng) */}
                <div className="pos-cash-calc-box">
                  <div className="cash-toggle-row">
                    <button
                      type="button"
                      className="btn-pos-toggle-cash"
                      onClick={() => setShowCashCalc((prev) => !prev)}
                    >
                      <span aria-hidden="true">💵</span>
                      <span>{showCashCalc ? 'Thu gọn tính tiền thối' : 'Tính tiền khách đưa & tiền thối'}</span>
                      <span className="pos-arrow">{showCashCalc ? '▲' : '▼'}</span>
                    </button>

                    {parsedCashGiven > 0 && (
                      <button
                        type="button"
                        className="btn-pos-clear-cash"
                        onClick={() => setCashGivenInput('')}
                      >
                        Xóa
                      </button>
                    )}
                  </div>

                  {showCashCalc && (
                    <div className="pos-cash-fields">
                      <div className="cash-input-wrap">
                        <label htmlFor="pos-cash-input" className="cash-label">Khách đưa:</label>
                        <input
                          id="pos-cash-input"
                          type="text"
                          inputMode="numeric"
                          className="pos-cash-input"
                          placeholder={`Ví dụ: ${formatCurrency(totalAmount)}`}
                          value={cashGivenInput}
                          onChange={(e) => {
                            const num = parseCurrencyInput(e.target.value);
                            setCashGivenInput(num > 0 ? formatCurrencyInput(num) : '');
                          }}
                        />
                      </div>

                      {/* Phím gợi ý tiền nhanh */}
                      <div className="cash-preset-chips">
                        <button
                          type="button"
                          className="pos-cash-chip"
                          onClick={() => setCashGivenInput(formatCurrencyInput(totalAmount))}
                        >
                          Đủ tiền ({formatCurrency(totalAmount)})
                        </button>
                        {totalAmount < 100000 && (
                          <button
                            type="button"
                            className="pos-cash-chip"
                            onClick={() => setCashGivenInput(formatCurrencyInput(100000))}
                          >
                            100k
                          </button>
                        )}
                        {totalAmount < 200000 && (
                          <button
                            type="button"
                            className="pos-cash-chip"
                            onClick={() => setCashGivenInput(formatCurrencyInput(200000))}
                          >
                            200k
                          </button>
                        )}
                        {totalAmount < 500000 && (
                          <button
                            type="button"
                            className="pos-cash-chip"
                            onClick={() => setCashGivenInput(formatCurrencyInput(500000))}
                          >
                            500k
                          </button>
                        )}
                      </div>

                      {/* Tiền thừa trả lại */}
                      {parsedCashGiven >= totalAmount && totalAmount > 0 && (
                        <div className="change-box success">
                          <span>Tiền thối lại cho khách:</span>
                          <strong className="change-num">{formatCurrency(changeToReturn)}</strong>
                        </div>
                      )}

                      {parsedCashGiven > 0 && parsedCashGiven < totalAmount && (
                        <div className="change-box warning">
                          <span>Khách còn thiếu:</span>
                          <strong className="missing-num">
                            {formatCurrency(totalAmount - parsedCashGiven)}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Các nút hành động chính */}
                <div className="pos-action-buttons">
                  <button
                    type="button"
                    className="btn-pos-copy-receipt"
                    onClick={handleCopyReceipt}
                    title="Sao chép hóa đơn để dán gửi Zalo cho khách"
                  >
                    <span aria-hidden="true">📋</span>
                    <span>Sao chép bill</span>
                  </button>

                  <button
                    type="button"
                    className="btn-pos-checkout-confirm"
                    onClick={handleSubmitCheckout}
                    disabled={isCheckingOut || hasStockIssue || !canEdit}
                    title={
                      !canEdit
                        ? 'Bạn chỉ có quyền xem, không thể trừ kho'
                        : hasStockIssue
                        ? 'Có sản phẩm vượt quá tồn kho'
                        : 'Hoàn tất đơn và tự động trừ tồn kho'
                    }
                  >
                    {isCheckingOut ? (
                      <span>⏳ Đang trừ kho...</span>
                    ) : (
                      <span>✅ Bán & Trừ kho ({formatCurrency(totalAmount)})</span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default CheckoutPage;
