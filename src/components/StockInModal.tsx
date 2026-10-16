import { useState, useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';
import { updateProduct } from '../services/productService';
import {
  formatCurrency,
  formatCurrencyInput,
  parseCurrencyInput,
  removeVietnameseTones,
} from '../utils/formatters';
import { ProductImage } from './ProductImage';
import './StockInModal.css';

interface StockInModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  initialProduct?: Product | null;
  onStockInSuccess: (savedProduct: Product, oldStock: number, newStock: number) => void;
  isOnline?: boolean;
}

interface StockInDialogProps {
  onClose: () => void;
  products: Product[];
  initialProduct?: Product | null;
  onStockInSuccess: (savedProduct: Product, oldStock: number, newStock: number) => void;
  isOnline?: boolean;
}

function StockInDialog({
  onClose,
  products,
  initialProduct = null,
  onStockInSuccess,
  isOnline = true,
}: StockInDialogProps) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(initialProduct);
  const [searchTerm, setSearchTerm] = useState('');
  const [quantityMode, setQuantityMode] = useState<'add' | 'set'>('add');
  const [quantityInput, setQuantityInput] = useState<string>('1');
  const [purchasePriceInput, setPurchasePriceInput] = useState<string>(() =>
    initialProduct ? formatCurrencyInput(initialProduct.purchasePrice) : ''
  );
  const [salePriceInput, setSalePriceInput] = useState<string>(() =>
    initialProduct ? formatCurrencyInput(initialProduct.salePrice) : ''
  );
  const [notesInput, setNotesInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // Focus ô tìm kiếm khi chưa chọn sản phẩm, hoặc focus ô số lượng khi đã có sản phẩm
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedProduct) {
        searchInputRef.current?.focus();
      } else {
        qtyInputRef.current?.focus();
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [selectedProduct]);

  // Xử lý chọn một sản phẩm từ danh sách tìm kiếm
  const handleSelectProduct = (prod: Product) => {
    setSelectedProduct(prod);
    setPurchasePriceInput(formatCurrencyInput(prod.purchasePrice));
    setSalePriceInput(formatCurrencyInput(prod.salePrice));
    setQuantityInput('1');
    setQuantityMode('add');
    setErrorMessage(null);
  };

  // Đổi sản phẩm khác
  const handleClearSelection = () => {
    setSelectedProduct(null);
    setSearchTerm('');
    setErrorMessage(null);
  };

  // Lọc danh sách sản phẩm theo từ khóa tìm kiếm
  const filteredProducts = useMemo(() => {
    const rawKeyword = searchTerm.trim();
    if (!rawKeyword) return products;

    const normalizedKeyword = removeVietnameseTones(rawKeyword.toLowerCase());

    return products.filter((p) => {
      const matchName = removeVietnameseTones(p.name.toLowerCase()).includes(normalizedKeyword);
      const matchCode = p.code.toLowerCase().includes(rawKeyword.toLowerCase());
      const matchBarcode = p.barcode ? p.barcode.toLowerCase().includes(rawKeyword.toLowerCase()) : false;
      const matchCategory = removeVietnameseTones(p.category.toLowerCase()).includes(normalizedKeyword);
      return matchName || matchCode || matchBarcode || matchCategory;
    });
  }, [products, searchTerm]);

  // Tính toán tồn kho mới
  const currentStock = selectedProduct ? selectedProduct.stock : 0;
  const parsedQty = parseFloat(quantityInput) || 0;
  const calculatedNewStock = quantityMode === 'add' ? currentStock + parsedQty : parsedQty;

  // Tính toán giá và tỷ suất lợi nhuận
  const parsedPurchasePrice = parseCurrencyInput(purchasePriceInput);
  const parsedSalePrice = parseCurrencyInput(salePriceInput);
  const profitMargin = parsedSalePrice - parsedPurchasePrice;

  // Xử lý thay đổi ô nhập tiền tệ và giữ vị trí con trỏ hợp lý
  const handlePriceChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const inputEl = e.target;
    const rawVal = inputEl.value;
    const cursorEnd = inputEl.selectionEnd ?? rawVal.length;
    const digitsBeforeCursor = rawVal.slice(0, cursorEnd).replace(/\D/g, '').length;

    const formatted = formatCurrencyInput(rawVal);
    setter(formatted);

    requestAnimationFrame(() => {
      if (!inputEl) return;
      let targetPos = 0;
      let countedDigits = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) {
          countedDigits++;
        }
        if (countedDigits === digitsBeforeCursor) {
          targetPos = i + 1;
          break;
        }
      }
      if (countedDigits < digitsBeforeCursor) {
        targetPos = formatted.length;
      }
      try {
        inputEl.setSelectionRange(targetPos, targetPos);
      } catch {
        /* ignore */
      }
    });
  };

  // Xử lý phím Backspace khi đứng ngay sau dấu chấm phân cách hàng nghìn
  const handlePriceKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentValue: string,
    setter: (val: string) => void
  ) => {
    if (e.key === 'Backspace') {
      const inputEl = e.currentTarget;
      const { selectionStart, selectionEnd } = inputEl;
      if (selectionStart !== null && selectionStart === selectionEnd && selectionStart > 0) {
        if (currentValue[selectionStart - 1] === '.') {
          e.preventDefault();
          const before = currentValue.slice(0, selectionStart - 2);
          const after = currentValue.slice(selectionStart);
          const newRaw = before + after;
          const formatted = formatCurrencyInput(newRaw);
          setter(formatted);
          requestAnimationFrame(() => {
            const newPos = Math.max(0, selectionStart - 2);
            try {
              inputEl.setSelectionRange(newPos, newPos);
            } catch {
              /* ignore */
            }
          });
        }
      }
    }
  };

  // Xử lý tăng / giảm nhanh số lượng
  const handleAdjustQty = (delta: number) => {
    const currentVal = parseFloat(quantityInput) || 0;
    const nextVal = Math.max(0, currentVal + delta);
    setQuantityInput(String(nextVal));
  };

  const handleQuickAdd = (amount: number) => {
    if (quantityMode === 'add') {
      const currentVal = parseFloat(quantityInput) || 0;
      setQuantityInput(String(currentVal + amount));
    } else {
      setQuantityInput(String(amount));
    }
  };

  // Xử lý phím Escape
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !isSubmitting) {
      e.stopPropagation();
      onClose();
    }
  };

  // Submit cập nhật nhập kho
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      setErrorMessage('Vui lòng chọn một mặt hàng để nhập kho.');
      return;
    }

    if (!isOnline) {
      setErrorMessage('Không thể nhập kho khi đang mất kết nối mạng.');
      return;
    }

    if (isNaN(parsedQty) || parsedQty < 0) {
      setErrorMessage('Số lượng nhập không hợp lệ (phải lớn hơn hoặc bằng 0).');
      return;
    }

    if (quantityMode === 'add' && parsedQty <= 0) {
      setErrorMessage('Vui lòng nhập số lượng cần cộng thêm (lớn hơn 0).');
      return;
    }

    if (calculatedNewStock < 0) {
      setErrorMessage('Số lượng tồn sau khi cập nhật không được nhỏ hơn 0.');
      return;
    }

    if (isNaN(parsedPurchasePrice) || parsedPurchasePrice < 0) {
      setErrorMessage('Giá nhập không hợp lệ (không được nhỏ hơn 0).');
      return;
    }

    if (isNaN(parsedSalePrice) || parsedSalePrice < 0) {
      setErrorMessage('Giá bán không hợp lệ (không được nhỏ hơn 0).');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // Xây dựng ghi chú mới nếu có
      let updatedNotes = selectedProduct.notes || '';
      if (notesInput.trim()) {
        const todayStr = new Date().toLocaleDateString('vi-VN');
        const appendNote = `[Nhập kho ${todayStr}]: ${notesInput.trim()}`;
        updatedNotes = updatedNotes ? `${updatedNotes}\n${appendNote}` : appendNote;
      }

      const res = await updateProduct(selectedProduct.id, {
        code: selectedProduct.code,
        barcode: selectedProduct.barcode,
        name: selectedProduct.name,
        category: selectedProduct.category,
        unit: selectedProduct.unit,
        imageUrl: selectedProduct.imageUrl,
        stock: calculatedNewStock,
        purchasePrice: parsedPurchasePrice,
        salePrice: parsedSalePrice,
        notes: updatedNotes,
      });

      if (res.error) {
        setErrorMessage(res.error);
        setIsSubmitting(false);
        return;
      }

      if (res.data) {
        onStockInSuccess(res.data, currentStock, calculatedNewStock);
        onClose();
      }
    } catch {
      setErrorMessage('Đã xảy ra lỗi không xác định khi lưu thông tin nhập kho.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="si-modal-backdrop"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className="si-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="si-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="si-modal-header">
          <div className="si-header-title-box">
            <div className="si-header-icon" aria-hidden="true">
              📥
            </div>
            <div>
              <h2 id="si-modal-title" className="si-modal-title">
                Nhập kho hàng hóa
              </h2>
              <p className="si-modal-subtitle">
                Điều chỉnh số lượng tồn và cập nhật giá cho mặt hàng đã có sẵn
              </p>
            </div>
          </div>
          <button
            type="button"
            className="si-close-btn"
            onClick={onClose}
            aria-label="Đóng cửa sổ nhập kho"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>

        {/* Body Modal */}
        <form onSubmit={handleSubmit} className="si-modal-body">
          {/* BƯỚC 1: NẾU CHƯA CHỌN SẢN PHẨM -> HIỂN THỊ TÌM KIẾM CHỌN MẶT HÀNG */}
          {!selectedProduct ? (
            <div className="si-picker-section">
              <label htmlFor="si-search-input" className="si-field-label">
                <span>Chọn mặt hàng cần nhập kho ({products.length} sản phẩm có sẵn):</span>
              </label>

              <div className="si-search-input-box">
                <span className="si-search-icon" aria-hidden="true">
                  🔍
                </span>
                <input
                  ref={searchInputRef}
                  id="si-search-input"
                  type="text"
                  className="si-search-input"
                  placeholder="Gõ tên sản phẩm, mã hàng (SKU) hoặc mã vạch..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoComplete="off"
                />
              </div>

              {/* Danh sách cuộn các sản phẩm */}
              <div className="si-products-scroll-list">
                {filteredProducts.length === 0 ? (
                  <div className="si-empty-results">
                    Không tìm thấy sản phẩm nào phù hợp với từ khóa &ldquo;{searchTerm}&rdquo;.
                  </div>
                ) : (
                  filteredProducts.map((prod) => {
                    const isOutOfStock = prod.stock <= 0;
                    return (
                      <button
                        key={prod.id}
                        type="button"
                        className="si-product-pick-item"
                        onClick={() => handleSelectProduct(prod)}
                        title={`Chọn nhập kho cho ${prod.name}`}
                      >
                        <div className="si-pick-item-left">
                          <ProductImage
                            storagePath={prod.imageUrl}
                            alt={prod.name}
                            className="si-pick-item-thumb"
                          />
                          <div className="si-pick-item-meta">
                            <span className="si-pick-item-name">{prod.name}</span>
                            <div className="si-pick-item-sub">
                              <span className="si-pick-item-code">{prod.code}</span>
                              <span>•</span>
                              <span>{prod.category}</span>
                            </div>
                          </div>
                        </div>

                        <div className="si-pick-item-right">
                          <span className={`si-pick-stock-badge ${isOutOfStock ? 'empty' : ''}`}>
                            Tồn: {prod.stock} {prod.unit}
                          </span>
                          <span className="si-pick-price">
                            Bán: {formatCurrency(prod.salePrice)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* BƯỚC 2: ĐÃ CHỌN SẢN PHẨM -> HIỂN THỊ THẺ SẢN PHẨM VÀ CÁC TRƯỜNG NHẬP KHO */
            <>
              {/* Thẻ sản phẩm đã chọn */}
              <div className="si-selected-product-card">
                <div className="si-selected-info-group">
                  <ProductImage
                    storagePath={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="si-selected-thumb"
                  />
                  <div className="si-selected-details">
                    <span className="si-selected-name" title={selectedProduct.name}>
                      {selectedProduct.name}
                    </span>
                    <div className="si-selected-badges">
                      <span className="si-selected-code">{selectedProduct.code}</span>
                      <span className="si-selected-cat">{selectedProduct.category}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="si-change-product-btn"
                  onClick={handleClearSelection}
                  title="Chọn một sản phẩm khác để nhập kho"
                >
                  Đổi sản phẩm
                </button>
              </div>

              {/* 3 ô tóm tắt thông số hiện tại */}
              <div className="si-current-stats-grid">
                <div className="si-stat-box">
                  <span className="si-stat-label">Tồn hiện tại</span>
                  <span className="si-stat-value highlight-stock">
                    {selectedProduct.stock} {selectedProduct.unit}
                  </span>
                </div>
                <div className="si-stat-box">
                  <span className="si-stat-label">Giá nhập cũ</span>
                  <span className="si-stat-value">
                    {formatCurrency(selectedProduct.purchasePrice)}
                  </span>
                </div>
                <div className="si-stat-box">
                  <span className="si-stat-label">Giá bán cũ</span>
                  <span className="si-stat-value">
                    {formatCurrency(selectedProduct.salePrice)}
                  </span>
                </div>
              </div>

              {/* PHẦN 1: ĐIỀU CHỈNH SỐ LƯỢNG */}
              <div className="si-section-box">
                <div className="si-section-header">
                  <h3 className="si-section-title">
                    <span>📦 Số lượng nhập kho</span>
                  </h3>

                  <div className="si-mode-toggle" role="radiogroup" aria-label="Phương thức nhập số lượng">
                    <button
                      type="button"
                      className={`si-mode-btn ${quantityMode === 'add' ? 'active' : ''}`}
                      onClick={() => setQuantityMode('add')}
                      role="radio"
                      aria-checked={quantityMode === 'add'}
                    >
                      ＋ Cộng thêm vào tồn
                    </button>
                    <button
                      type="button"
                      className={`si-mode-btn ${quantityMode === 'set' ? 'active' : ''}`}
                      onClick={() => setQuantityMode('set')}
                      role="radio"
                      aria-checked={quantityMode === 'set'}
                    >
                      ＝ Đặt lại tồn mới
                    </button>
                  </div>
                </div>

                {/* Khung nhập số lượng với Stepper */}
                <div className="si-quantity-control-row">
                  <button
                    type="button"
                    className="si-stepper-btn"
                    onClick={() => handleAdjustQty(-1)}
                    aria-label="Giảm 1"
                  >
                    −
                  </button>
                  <div className="si-quantity-input-wrapper">
                    <input
                      ref={qtyInputRef}
                      type="number"
                      step="any"
                      min="0"
                      className="si-quantity-input"
                      value={quantityInput}
                      onChange={(e) => setQuantityInput(e.target.value)}
                      placeholder="0"
                      required
                    />
                    <span className="si-quantity-unit-tag">{selectedProduct.unit}</span>
                  </div>
                  <button
                    type="button"
                    className="si-stepper-btn"
                    onClick={() => handleAdjustQty(1)}
                    aria-label="Tăng 1"
                  >
                    ＋
                  </button>
                </div>

                {/* Nút bấm nhanh số lượng */}
                <div className="si-quick-qty-list">
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Thêm nhanh:</span>
                  {[5, 10, 20, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      className="si-quick-qty-btn"
                      onClick={() => handleQuickAdd(num)}
                    >
                      +{num}
                    </button>
                  ))}
                </div>

                {/* Banner xem trước kết quả tồn mới */}
                <div className="si-preview-stock-banner">
                  <div className="si-preview-calc-formula">
                    <span>Tồn cũ: <strong>{selectedProduct.stock}</strong></span>
                    <span>➜</span>
                    <span>
                      {quantityMode === 'add'
                        ? `Cộng thêm: +${parsedQty}`
                        : `Đặt lại: ${parsedQty}`} {selectedProduct.unit}
                    </span>
                  </div>
                  <div className="si-preview-new-result">
                    ➜ Tồn mới: {calculatedNewStock} {selectedProduct.unit}
                  </div>
                </div>
              </div>

              {/* PHẦN 2: ĐIỀU CHỈNH GIÁ NHẬP & GIÁ BÁN */}
              <div className="si-section-box">
                <h3 className="si-section-title">
                  <span>💰 Cập nhật giá sản phẩm</span>
                </h3>

                <div className="si-prices-grid">
                  {/* Ô nhập Giá nhập mới */}
                  <div className="si-price-field-group">
                    <label htmlFor="si-purchase-price" className="si-field-label">
                      <span>Giá nhập mới (Giá vốn)</span>
                      <span className="si-old-price-hint">
                        Cũ: {formatCurrency(selectedProduct.purchasePrice)}
                      </span>
                    </label>
                    <div className="si-price-input-box">
                      <input
                        id="si-purchase-price"
                        type="text"
                        inputMode="numeric"
                        className="si-price-input"
                        value={purchasePriceInput}
                        onChange={(e) => handlePriceChange(e, setPurchasePriceInput)}
                        onKeyDown={(e) => handlePriceKeyDown(e, purchasePriceInput, setPurchasePriceInput)}
                        placeholder="Ví dụ: 25.000"
                        required
                      />
                      <span className="si-currency-symbol">₫</span>
                    </div>
                    <span className="si-price-formatted-preview">
                      🏷️ Hiển thị: <strong>{formatCurrency(parsedPurchasePrice)}</strong>
                    </span>
                  </div>

                  {/* Ô nhập Giá bán mới */}
                  <div className="si-price-field-group">
                    <label htmlFor="si-sale-price" className="si-field-label">
                      <span>Giá bán mới (Niêm yết)</span>
                      <span className="si-old-price-hint">
                        Cũ: {formatCurrency(selectedProduct.salePrice)}
                      </span>
                    </label>
                    <div className="si-price-input-box">
                      <input
                        id="si-sale-price"
                        type="text"
                        inputMode="numeric"
                        className="si-price-input"
                        value={salePriceInput}
                        onChange={(e) => handlePriceChange(e, setSalePriceInput)}
                        onKeyDown={(e) => handlePriceKeyDown(e, salePriceInput, setSalePriceInput)}
                        placeholder="Ví dụ: 30.000"
                        required
                      />
                      <span className="si-currency-symbol">₫</span>
                    </div>
                    <span className="si-price-formatted-preview">
                      🏷️ Hiển thị: <strong>{formatCurrency(parsedSalePrice)}</strong>
                    </span>
                  </div>
                </div>

                {/* Tóm tắt lợi nhuận dự kiến */}
                <div className="si-margin-banner">
                  <span>Chênh lệch lợi nhuận dự kiến mỗi đơn vị:</span>
                  <span className={profitMargin >= 0 ? 'si-margin-positive' : 'si-margin-negative'}>
                    {profitMargin >= 0 ? '+' : ''}
                    {formatCurrency(profitMargin)} / {selectedProduct.unit}
                  </span>
                </div>
              </div>

              {/* PHẦN 3: GHI CHÚ NHẬP KHO */}
              <div className="si-price-field-group">
                <label htmlFor="si-notes" className="si-field-label">
                  <span>Ghi chú nhập kho (Tùy chọn)</span>
                </label>
                <textarea
                  id="si-notes"
                  className="si-notes-input"
                  rows={2}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Ví dụ: Nhập lô hàng tháng 10, nhà cung cấp ABC..."
                />
              </div>

              {/* Thông báo lỗi nếu có */}
              {errorMessage && (
                <div className="si-error-banner" role="alert">
                  ⚠️ {errorMessage}
                </div>
              )}
            </>
          )}

          {/* Footer nút hành động */}
          <div className="si-modal-footer">
            <button
              type="button"
              className="si-btn-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Hủy bỏ
            </button>
            {selectedProduct && (
              <button
                type="submit"
                className="si-btn-submit"
                disabled={isSubmitting || !isOnline}
              >
                {isSubmitting ? (
                  <>
                    <span className="loading-spinner small" aria-hidden="true"></span>
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <span>📥 Xác nhận nhập kho</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export function StockInModal(props: StockInModalProps) {
  if (!props.isOpen) return null;

  // Sử dụng key để reset hoàn toàn form state khi đổi sản phẩm hoặc mở modal
  const dialogKey = props.initialProduct ? props.initialProduct.id : 'search-mode';

  return <StockInDialog key={dialogKey} {...props} />;
}

export default StockInModal;
