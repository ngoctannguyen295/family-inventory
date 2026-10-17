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
}: CheckoutModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [cashGivenInput, setCashGivenInput] = useState<string>('');
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus tìm kiếm khi mở modal
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
      .slice(0, 6);
  }, [searchTerm, allProducts]);

  // Sao chép hóa đơn gửi Zalo/tin nhắn
  const handleCopyReceipt = async () => {
    if (cartItems.length === 0) return;

    const receipt = formatReceiptText(cartItems, parsedCashGiven);

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
            <span className="checkout-title-icon" aria-hidden="true">🧮</span>
            <h2 id="checkout-modal-title" className="checkout-title">
              Máy tính tiền / Bán hàng
            </h2>
            {cartItems.length > 0 && (
              <span className="checkout-count-badge">
                {totalQuantity} món
              </span>
            )}
          </div>

          <div className="checkout-header-right">
            {cartItems.length > 0 && (
              <>
                {isConfirmingReset ? (
                  <button
                    type="button"
                    className="btn-clear-cart"
                    onClick={() => {
                      onClearCart();
                      setIsConfirmingReset(false);
                      onShowToast('Đã làm trống giỏ hàng.', 'info');
                    }}
                    title="Xác nhận xóa hết đơn hiện tại"
                  >
                    Chắc chắn xóa?
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-clear-cart"
                    onClick={() => setIsConfirmingReset(true)}
                    title="Xóa trắng giỏ tính tiền"
                  >
                    Xóa hết
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

        {/* Thanh tìm kiếm & chọn thêm sản phẩm nhanh ngay trong modal */}
        <div className="checkout-search-section">
          <div className="checkout-search-bar">
            <div className="checkout-search-input-wrap">
              <span className="checkout-search-icon" aria-hidden="true">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                className="checkout-search-input"
                placeholder="Tìm tên, mã hàng, danh mục để thêm nhanh..."
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
                <span>Quét mã</span>
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
                        <strong>{formatCurrency(prod.salePrice)}</strong> • Tồn: {prod.stock} {prod.unit}
                      </span>
                    </div>
                  </div>
                  <button type="button" className="suggestion-add-btn">
                    + Thêm
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Danh sách các sản phẩm đang có trong giỏ tính tiền */}
        <div className="checkout-modal-body">
          {cartItems.length === 0 ? (
            <div className="checkout-empty-state">
              <span className="empty-cart-icon" aria-hidden="true">🛒</span>
              <h3 className="empty-cart-title">Chưa có sản phẩm nào trong đơn</h3>
              <p className="empty-cart-desc">
                Nhập tên sản phẩm ở ô tìm kiếm phía trên hoặc bấm nút <strong>"+ Tính tiền"</strong> ở từng sản phẩm trong kho hàng để thêm vào đơn.
              </p>
            </div>
          ) : (
            <>
              {cartItems.map((item) => {
                const isOverStock = item.quantity > item.product.stock;
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
                          <span className="item-code-unit">
                            <code>{item.product.code}</code>
                            <span className="item-unit-badge">{item.product.unit}</span>
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn-remove-item"
                        onClick={() => onRemoveItem(item.productId)}
                        title="Xóa khỏi đơn"
                        aria-label={`Xóa ${item.product.name} khỏi đơn`}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Cảnh báo tồn kho nếu vượt quá */}
                    {isOverStock && (
                      <div className="item-stock-warning">
                        <span>⚠️ Vượt quá tồn kho (Kho còn {item.product.stock} {item.product.unit})</span>
                      </div>
                    )}

                    {/* Bộ chỉnh số lượng & Giá tiền */}
                    <div className="item-control-row">
                      <div className="quantity-control-group">
                        <button
                          type="button"
                          className="qty-step-btn"
                          onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}
                          title="Giảm 1"
                        >
                          −
                        </button>

                        <input
                          type="number"
                          min="1"
                          className="qty-number-input"
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            onUpdateQuantity(item.productId, isNaN(val) ? 1 : Math.max(1, val));
                          }}
                          aria-label={`Số lượng cho ${item.product.name}`}
                        />

                        <button
                          type="button"
                          className="qty-step-btn"
                          onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
                          title="Tăng 1"
                        >
                          +
                        </button>

                        {/* Phím tăng nhanh: +1, +5, +10 */}
                        <div className="quick-qty-chips">
                          <button
                            type="button"
                            className="quick-chip-btn"
                            onClick={() => onUpdateQuantity(item.productId, item.quantity + 5)}
                            title="Thêm 5 cái"
                          >
                            +5
                          </button>
                          <button
                            type="button"
                            className="quick-chip-btn"
                            onClick={() => onUpdateQuantity(item.productId, item.quantity + 10)}
                            title="Thêm 10 cái"
                          >
                            +10
                          </button>
                        </div>
                      </div>

                      <div className="item-subtotal-box">
                        <span className="item-unit-price">
                          Đơn giá: {formatCurrency(item.salePrice)}
                        </span>
                        <strong className="item-total-amount">
                          {formatCurrency(lineTotal)}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Thẻ tổng hợp tiền và tính tiền khách đưa */}
              <div className="checkout-summary-card">
                <div className="summary-row">
                  <span>Số lượng hàng:</span>
                  <strong>{totalQuantity} {cartItems.length > 1 ? `món (${cartItems.length} loại hàng)` : 'món'}</strong>
                </div>

                <div className="summary-row grand-total">
                  <span className="grand-total-label">TỔNG TIỀN:</span>
                  <span className="grand-total-value">
                    {formatCurrency(totalAmount)}
                  </span>
                </div>

                {/* Tính tiền thừa thối lại */}
                <div className="cash-input-box">
                  <div className="cash-input-label-row">
                    <span>💵 Tiền khách đưa:</span>
                    {parsedCashGiven > 0 && (
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: '#0284c7', fontSize: '12px', cursor: 'pointer' }}
                        onClick={() => setCashGivenInput('')}
                      >
                        Xóa
                      </button>
                    )}
                  </div>

                  <input
                    type="text"
                    inputMode="numeric"
                    className="cash-amount-input"
                    placeholder={`Nhập số tiền khách đưa (ví dụ: ${formatCurrency(totalAmount)})...`}
                    value={cashGivenInput}
                    onChange={(e) => {
                      const num = parseCurrencyInput(e.target.value);
                      setCashGivenInput(num > 0 ? formatCurrencyInput(num) : '');
                    }}
                  />

                  {/* Nút gợi ý tiền nhanh */}
                  <div className="cash-quick-chips">
                    <button
                      type="button"
                      className="cash-chip-btn"
                      onClick={() => setCashGivenInput(formatCurrencyInput(totalAmount))}
                    >
                      Đủ tiền ({formatCurrency(totalAmount)})
                    </button>
                    <button
                      type="button"
                      className="cash-chip-btn"
                      onClick={() => setCashGivenInput(formatCurrencyInput(Math.ceil(totalAmount / 50000) * 50000))}
                    >
                      +{formatCurrency(Math.ceil(totalAmount / 50000) * 50000)}
                    </button>
                    {totalAmount < 100000 && (
                      <button
                        type="button"
                        className="cash-chip-btn"
                        onClick={() => setCashGivenInput(formatCurrencyInput(100000))}
                      >
                        100.000 ₫
                      </button>
                    )}
                    {totalAmount < 200000 && (
                      <button
                        type="button"
                        className="cash-chip-btn"
                        onClick={() => setCashGivenInput(formatCurrencyInput(200000))}
                      >
                        200.000 ₫
                      </button>
                    )}
                    {totalAmount < 500000 && (
                      <button
                        type="button"
                        className="cash-chip-btn"
                        onClick={() => setCashGivenInput(formatCurrencyInput(500000))}
                      >
                        500.000 ₫
                      </button>
                    )}
                  </div>

                  {/* Tiền thừa thối lại */}
                  {parsedCashGiven >= totalAmount && totalAmount > 0 && (
                    <div className="change-row">
                      <span>Tiền thối lại cho khách:</span>
                      <span className="change-value">
                        {formatCurrency(changeToReturn)}
                      </span>
                    </div>
                  )}

                  {parsedCashGiven > 0 && parsedCashGiven < totalAmount && (
                    <div style={{ color: '#dc2626', fontSize: '13px', fontWeight: 600 }}>
                      Khách còn thiếu: {formatCurrency(totalAmount - parsedCashGiven)}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Nút hành động Footer */}
        {cartItems.length > 0 && (
          <div className="checkout-footer">
            <div className="checkout-action-row">
              <button
                type="button"
                className="btn-copy-receipt"
                onClick={handleCopyReceipt}
                title="Sao chép hóa đơn để gửi Zalo cho khách"
              >
                <span>📋</span>
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
                  <span>⏳ Đang xử lý trừ kho...</span>
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
