import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';
import type { CartItem } from '../types/checkout';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput, removeVietnameseTones } from '../utils/formatters';
import { calculateCartTotals, calculateChange, formatReceiptText } from '../utils/checkoutHelper';
import { ProductImage } from './ProductImage';
import './CheckoutModal.css';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  allProducts: Product[];
  onAddToCart: (product: Product, quantity?: number) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onClearCart: () => void;
  onConfirmCheckout: (items: CartItem[]) => Promise<void>;
  isCheckingOut: boolean;
  canEdit: boolean;
  onOpenBarcodeScanner?: () => void;
  onShowToast: (message: string, type: 'success' | 'info' | 'warning') => void;
  onOpenQuantityInput?: (product: Product) => void;
}

export function CheckoutModal({
  isOpen,
  onClose,
  cartItems,
  allProducts,
  onAddToCart,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onConfirmCheckout,
  isCheckingOut,
  canEdit,
  onOpenBarcodeScanner,
  onShowToast,
  onOpenQuantityInput,
}: CheckoutModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [cashGivenInput, setCashGivenInput] = useState<string>('');
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [showCashCalc, setShowCashCalc] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset confirmation state when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsConfirmingReset(false);
    }
  }, [isOpen]);

  // Đóng modal bằng phím Escape
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  // Tính toán tổng số lượng món và tổng tiền
  const { totalQuantity, totalAmount, hasStockIssue } = useMemo(() => {
    return calculateCartTotals(cartItems);
  }, [cartItems]);

  // Tính tiền thối lại cho khách
  const parsedCashGiven = useMemo(() => {
    return parseCurrencyInput(cashGivenInput);
  }, [cashGivenInput]);

  const changeToReturn = useMemo(() => {
    return calculateChange(totalAmount, parsedCashGiven);
  }, [parsedCashGiven, totalAmount]);

  // Lọc sản phẩm tìm kiếm nhanh trong modal
  const searchSuggestions = useMemo(() => {
    const raw = searchTerm.trim();
    if (!raw) return [];

    const norm = removeVietnameseTones(raw.toLowerCase());
    return allProducts
      .filter((p) => {
        const matchName = removeVietnameseTones(p.name.toLowerCase()).includes(norm);
        const matchCode = p.code.toLowerCase().includes(norm);
        const matchBarcode = p.barcode ? p.barcode.toLowerCase().includes(norm) : false;
        const matchCategory = removeVietnameseTones(p.category.toLowerCase()).includes(norm);
        return matchName || matchCode || matchBarcode || matchCategory;
      })
      .slice(0, 8);
  }, [searchTerm, allProducts]);

  // Gợi ý sản phẩm còn hàng khi giỏ trống
  const suggestedProducts = useMemo(() => {
    return allProducts.filter((p) => p.stock > 0).slice(0, 6);
  }, [allProducts]);

  // Sao chép hóa đơn gửi Zalo/tin nhắn
  const handleCopyReceipt = async () => {
    if (cartItems.length === 0) return;

    const receipt = formatReceiptText(cartItems, parsedCashGiven > 0 ? parsedCashGiven : undefined);

    try {
      await navigator.clipboard.writeText(receipt);
      onShowToast('Đã sao chép hóa đơn để dán gửi Zalo/SMS!', 'success');
    } catch {
      // Fallback nếu trình duyệt chặn clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = receipt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      onShowToast('Đã sao chép hóa đơn thành công!', 'success');
    }
  };

  // Xác nhận thanh toán và trừ kho
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

  if (!isOpen) return null;

  return (
    <div
      className="checkout-modal-backdrop"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className="checkout-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="checkout-header">
          <div className="checkout-header-left">
            <span className="checkout-title-icon" aria-hidden="true">🧾</span>
            <h2 id="checkout-modal-title" className="checkout-title">
              Đơn bán hàng
            </h2>
            {cartItems.length > 0 && (
              <span className="checkout-count-badge">
                {totalQuantity} món ({cartItems.length} loại)
              </span>
            )}
          </div>

          <div className="checkout-header-right">
            {cartItems.length > 0 && (
              <>
                {isConfirmingReset ? (
                  <button
                    type="button"
                    className="btn-clear-cart confirming"
                    onClick={() => {
                      onClearCart();
                      setIsConfirmingReset(false);
                      onShowToast('Đã làm trống đơn hàng.', 'info');
                    }}
                    title="Bấm để xác nhận xóa sạch toàn bộ đơn"
                  >
                    Xác nhận xóa?
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-clear-cart"
                    onClick={() => setIsConfirmingReset(true)}
                    title="Xóa trắng giỏ tính tiền"
                  >
                    Xóa đơn
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              className="checkout-close-btn"
              onClick={onClose}
              aria-label="Đóng cửa sổ tính tiền"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Thanh tìm kiếm & thêm sản phẩm nhanh */}
        <div className="checkout-search-section">
          <div className="checkout-search-bar">
            <div className="checkout-search-input-wrap">
              <span className="checkout-search-icon" aria-hidden="true">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                className="checkout-search-input"
                placeholder="Tìm thêm sản phẩm vào đơn..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="checkout-search-clear"
                  onClick={() => setSearchTerm('')}
                  aria-label="Xóa nội dung tìm kiếm"
                >
                  ✕
                </button>
              )}
            </div>

            {onOpenBarcodeScanner && (
              <button
                type="button"
                className="btn-scan-barcode-cart"
                onClick={onOpenBarcodeScanner}
                title="Quét mã vạch thêm vào đơn"
              >
                <span>📷</span>
                <span className="btn-scan-text">Quét mã</span>
              </button>
            )}
          </div>

          {/* Gợi ý sản phẩm khi tìm kiếm */}
          {searchSuggestions.length > 0 && (
            <div className="checkout-suggestions-box">
              {searchSuggestions.map((prod) => (
                <div
                  key={prod.id}
                  className="checkout-suggestion-item"
                  onClick={() => {
                    onAddToCart(prod, 1);
                    setSearchTerm('');
                    onShowToast(`Đã thêm "${prod.name}" vào đơn.`, 'success');
                  }}
                >
                  <div className="suggestion-info">
                    <ProductImage
                      storagePath={prod.imageUrl}
                      alt={prod.name}
                      className="suggestion-thumb"
                    />
                    <div className="suggestion-text">
                      <span className="suggestion-name">{prod.name}</span>
                      <span className="suggestion-meta">
                        <strong className="suggestion-price">{formatCurrency(prod.salePrice)}</strong>
                        <span>• Tồn: {prod.stock} {prod.unit}</span>
                      </span>
                    </div>
                  </div>
                  <button type="button" className="suggestion-add-btn">
                    ＋ Bán
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Nội dung danh sách đơn hàng */}
        <div className="checkout-modal-body">
          {cartItems.length === 0 ? (
            <div className="checkout-empty-state">
              <span className="empty-cart-icon" aria-hidden="true">🛒</span>
              <h3 className="empty-cart-title">Đơn hàng đang trống</h3>
              <p className="empty-cart-desc">
                Chọn sản phẩm từ danh mục kho hàng hoặc tìm kiếm nhanh để bắt đầu tính tiền.
              </p>

              <button
                type="button"
                className="btn-back-to-catalog"
                onClick={onClose}
              >
                👈 Chọn hàng từ danh sách kho
              </button>

              {/* Gợi ý một số món có sẵn để thêm ngay */}
              {suggestedProducts.length > 0 && (
                <div className="suggested-products-section">
                  <span className="suggested-section-title">Hoặc bấm chọn nhanh các món có sẵn:</span>
                  <div className="suggested-products-grid">
                    {suggestedProducts.map((p) => (
                      <div
                        key={p.id}
                        className="suggested-product-chip"
                        onClick={() => {
                          onAddToCart(p, 1);
                          onShowToast(`Đã thêm "${p.name}" vào đơn.`, 'success');
                        }}
                      >
                        <ProductImage
                          storagePath={p.imageUrl}
                          alt={p.name}
                          className="suggested-chip-thumb"
                        />
                        <div className="suggested-chip-info">
                          <span className="suggested-chip-name">{p.name}</span>
                          <span className="suggested-chip-price">{formatCurrency(p.salePrice)}</span>
                        </div>
                        <button type="button" className="suggested-chip-add">
                          ＋
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Danh sách từng món hàng */}
              <div className="cart-items-container">
                {cartItems.map((item) => {
                  const isOverStock = item.product.stock > 0 && item.quantity > item.product.stock;
                  const lineTotal = item.quantity * item.salePrice;

                  return (
                    <div
                      key={item.productId}
                      className={`checkout-item-card ${isOverStock ? 'has-stock-warning' : ''}`}
                    >
                      <div className="item-main-row">
                        <div className="item-left">
                          <div className="item-thumb-box">
                            <ProductImage
                              storagePath={item.product.imageUrl}
                              alt={item.product.name}
                              className="suggestion-thumb"
                            />
                          </div>
                          <div className="item-details">
                            <span className="item-name" title={item.product.name}>
                              {item.product.name}
                            </span>
                            <div className="item-sub-info">
                              <span className="item-unit-price">
                                {formatCurrency(item.salePrice)} / {item.product.unit}
                              </span>
                              <span className="item-stock-hint">
                                (Kho: {item.product.stock})
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn-remove-item"
                          onClick={() => onRemoveItem(item.productId)}
                          title="Xóa món này khỏi đơn"
                          aria-label={`Xóa ${item.product.name} khỏi đơn`}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Cảnh báo tồn kho nếu vượt quá */}
                      {isOverStock && (
                        <div className="item-stock-warning">
                          ⚠️ Vượt quá tồn kho (Kho chỉ còn {item.product.stock} {item.product.unit})
                        </div>
                      )}

                      {/* Hàng bộ chỉnh số lượng & Thành tiền */}
                      <div className="item-control-row">
                        <div className="item-stepper-box">
                          <button
                            type="button"
                            className="item-stepper-btn minus"
                            onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}
                            title="Giảm 1"
                            aria-label="Giảm 1"
                          >
                            −
                          </button>

                          <button
                            type="button"
                            className="item-stepper-qty-display"
                            onClick={() => onOpenQuantityInput?.(item.product)}
                            title="Bấm để gõ số lượng cụ thể (ví dụ: 10, 20...)"
                            aria-label={`Số lượng hiện tại ${item.quantity} ${item.product.unit}. Bấm để nhập số khác`}
                          >
                            <span className="stepper-val">{item.quantity}</span>
                            <span className="stepper-unit-label">{item.product.unit}</span>
                            <span className="stepper-edit-hint" aria-hidden="true">✏️</span>
                          </button>

                          <button
                            type="button"
                            className="item-stepper-btn plus"
                            onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
                            disabled={item.product.stock > 0 && item.quantity >= item.product.stock}
                            title={
                              item.product.stock > 0 && item.quantity >= item.product.stock
                                ? 'Đã đạt giới hạn tồn kho'
                                : 'Tăng 1'
                            }
                            aria-label="Tăng 1"
                          >
                            +
                          </button>
                        </div>

                        <div className="item-subtotal-box">
                          <span className="subtotal-calc-hint">
                            {item.quantity} × {formatCurrency(item.salePrice)}
                          </span>
                          <strong className="item-total-amount">
                            {formatCurrency(lineTotal)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bảng tổng kết tiền */}
              <div className="checkout-summary-card">
                <div className="summary-row">
                  <span className="summary-label">Số lượng hàng hóa:</span>
                  <span className="summary-value">
                    <strong>{totalQuantity}</strong> {cartItems.length > 1 ? `món (${cartItems.length} loại)` : 'món'}
                  </span>
                </div>

                <div className="summary-row grand-total">
                  <span className="grand-total-label">TỔNG TIỀN:</span>
                  <span className="grand-total-value">
                    {formatCurrency(totalAmount)}
                  </span>
                </div>

                {/* Phần tính tiền thừa thối lại cho khách (Gọn gàng, thanh lịch) */}
                <div className="cash-section">
                  <div className="cash-section-header">
                    <button
                      type="button"
                      className="btn-toggle-cash"
                      onClick={() => setShowCashCalc((prev) => !prev)}
                    >
                      <span aria-hidden="true">💵</span>
                      <span>{showCashCalc ? 'Thu gọn tính tiền thối' : 'Tính tiền khách đưa & tiền thối'}</span>
                      <span className="toggle-arrow">{showCashCalc ? '▲' : '▼'}</span>
                    </button>

                    {parsedCashGiven > 0 && (
                      <button
                        type="button"
                        className="btn-clear-cash"
                        onClick={() => setCashGivenInput('')}
                      >
                        Xóa số tiền
                      </button>
                    )}
                  </div>

                  {showCashCalc && (
                    <div className="cash-calculator-panel">
                      <div className="cash-input-row">
                        <label htmlFor="cash-given-field" className="cash-field-label">
                          Khách đưa:
                        </label>
                        <input
                          id="cash-given-field"
                          type="text"
                          inputMode="numeric"
                          className="cash-amount-input"
                          placeholder={`Ví dụ: ${formatCurrency(totalAmount)}`}
                          value={cashGivenInput}
                          onChange={(e) => {
                            const num = parseCurrencyInput(e.target.value);
                            setCashGivenInput(num > 0 ? formatCurrencyInput(num) : '');
                          }}
                        />
                      </div>

                      {/* Các phím chọn nhanh số tiền */}
                      <div className="cash-quick-chips">
                        <button
                          type="button"
                          className="cash-chip-btn"
                          onClick={() => setCashGivenInput(formatCurrencyInput(totalAmount))}
                        >
                          Đủ tiền ({formatCurrency(totalAmount)})
                        </button>
                        {totalAmount < 100000 && (
                          <button
                            type="button"
                            className="cash-chip-btn"
                            onClick={() => setCashGivenInput(formatCurrencyInput(100000))}
                          >
                            100k
                          </button>
                        )}
                        {totalAmount < 200000 && (
                          <button
                            type="button"
                            className="cash-chip-btn"
                            onClick={() => setCashGivenInput(formatCurrencyInput(200000))}
                          >
                            200k
                          </button>
                        )}
                        {totalAmount < 500000 && (
                          <button
                            type="button"
                            className="cash-chip-btn"
                            onClick={() => setCashGivenInput(formatCurrencyInput(500000))}
                          >
                            500k
                          </button>
                        )}
                      </div>

                      {/* Tiền thừa thối lại */}
                      {parsedCashGiven >= totalAmount && totalAmount > 0 && (
                        <div className="change-result-row success">
                          <span>Tiền thối lại cho khách:</span>
                          <strong className="change-value">
                            {formatCurrency(changeToReturn)}
                          </strong>
                        </div>
                      )}

                      {parsedCashGiven > 0 && parsedCashGiven < totalAmount && (
                        <div className="change-result-row warning">
                          <span>Khách còn thiếu:</span>
                          <strong className="missing-value">
                            {formatCurrency(totalAmount - parsedCashGiven)}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Thanh nút hành động ghim cố định ở đáy */}
        {cartItems.length > 0 && (
          <div className="checkout-footer">
            <div className="checkout-action-row">
              <button
                type="button"
                className="btn-copy-receipt"
                onClick={handleCopyReceipt}
                title="Sao chép hóa đơn để dán gửi Zalo cho khách"
              >
                <span aria-hidden="true">📋</span>
                <span>Sao chép bill</span>
              </button>

              <button
                type="button"
                className="btn-checkout-confirm"
                onClick={handleSubmitCheckout}
                disabled={isCheckingOut || hasStockIssue || !canEdit}
                title={
                  !canEdit
                    ? 'Bạn chỉ có quyền xem, không thể trừ kho'
                    : hasStockIssue
                    ? 'Có sản phẩm vượt quá tồn kho'
                    : 'Hoàn tất đơn và tự động trừ số lượng tồn kho'
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
    </div>
  );
}

export default CheckoutModal;
