import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent, RefObject } from 'react';
import type { Product } from '../types/product';
import type { AiSearchResponse, ProductMatchResult } from '../types/aiSearch';
import { mapProductRecordToProduct } from '../types/aiSearch';
import {
  searchProductByImage,
  validateImageFileClient,
} from '../services/aiSearchService';
import { formatCurrency } from '../utils/formatters';
import { ProductImage } from './ProductImage';

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct?: (product: Product) => void;
  triggerElementRef?: RefObject<HTMLElement | null>;
}

export function ImageSearchModal({
  isOpen,
  onClose,
  onSelectProduct,
  triggerElementRef,
}: ImageSearchModalProps) {
  // Trạng thái file ảnh được chọn
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Trạng thái tìm kiếm API
  const [isSearching, setIsSearching] = useState(false);
  const [searchResponse, setSearchResponse] = useState<AiSearchResponse | null>(null);
  const [searchError, setSearchError] = useState<{
    message: string;
    status?: number;
    retryAfterSeconds?: number;
  } | null>(null);

  // Sản phẩm đang được xem chi tiết trong modal
  const [inspectedProduct, setInspectedProduct] = useState<Product | null>(null);

  // Refs quản lý vòng đời và chống phản hồi cũ khi đóng modal
  const isMountedRef = useRef(true);
  const activeRequestIdRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Giữ đồng bộ previewUrlRef để dọn dẹp an toàn
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // Thu hồi Object URL của preview
  const cleanupPreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Reset toàn bộ trạng thái của modal
  const resetState = useCallback(() => {
    cleanupPreviewUrl();
    setSelectedFile(null);
    setPreviewUrl(null);
    setFileError(null);
    setIsSearching(false);
    setSearchResponse(null);
    setSearchError(null);
    setInspectedProduct(null);
    setIsDragOver(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [cleanupPreviewUrl]);

  // Xử lý khi đóng modal
  const handleClose = useCallback(() => {
    // Tăng requestId để bỏ qua bất kỳ phản hồi async nào đang bay
    activeRequestIdRef.current++;
    resetState();
    onClose();

    // Trả focus về trigger element
    if (triggerElementRef?.current) {
      setTimeout(() => {
        triggerElementRef.current?.focus();
      }, 50);
    }
  }, [onClose, resetState, triggerElementRef]);

  // Quản lý đóng mở modal và phím Escape
  useEffect(() => {
    isMountedRef.current = true;

    if (isOpen) {
      // Focus vào nút đóng hoặc input file khi mở
      setTimeout(() => {
        closeBtnRef.current?.focus();
      }, 50);
    } else {
      // Khi modal đóng từ bên ngoài
      activeRequestIdRef.current++;
      cleanupPreviewUrl();
    }

    return () => {
      isMountedRef.current = false;
      cleanupPreviewUrl();
    };
  }, [isOpen, cleanupPreviewUrl]);

  // Bắt phím Escape và Tab-trap
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !isSearching) {
      e.preventDefault();
      handleClose();
      return;
    }

    // Tab trapping đơn giản
    if (e.key === 'Tab' && modalRef.current) {
      const focusableEls = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusableEls.length === 0) return;

      const firstEl = focusableEls[0];
      const lastEl = focusableEls[focusableEls.length - 1];

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  };

  // Xử lý khi chọn file mới
  const handleSelectFile = (file: File) => {
    setFileError(null);
    setSearchError(null);
    setSearchResponse(null);
    setInspectedProduct(null);

    const validation = validateImageFileClient(file);
    if (!validation.valid) {
      setFileError(validation.errorMessage || 'File ảnh không hợp lệ.');
      return;
    }

    // Dọn dẹp URL preview cũ nếu có
    cleanupPreviewUrl();

    // Tạo preview mới
    const newUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(newUrl);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleSelectFile(files[0]);
    }
  };

  // Xử lý kéo thả file
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isSearching) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isSearching) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleSelectFile(files[0]);
    }
  };

  // Thực hiện gọi Edge Function tìm kiếm sản phẩm bằng ảnh
  const handleSearch = async () => {
    if (!selectedFile || isSearching) return;

    setIsSearching(true);
    setSearchError(null);
    setSearchResponse(null);
    setInspectedProduct(null);

    const currentRequestId = ++activeRequestIdRef.current;

    const result = await searchProductByImage(selectedFile);

    // Nếu người dùng đã đóng modal hoặc có request mới hơn, bỏ qua kết quả
    if (!isMountedRef.current || currentRequestId !== activeRequestIdRef.current) {
      return;
    }

    setIsSearching(false);

    if (!result.success || !result.data) {
      setSearchError({
        message: result.message,
        status: result.status,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return;
    }

    setSearchResponse(result.data);
  };

  // Xem chi tiết một sản phẩm trong danh sách gợi ý
  const handleInspectMatch = (match: ProductMatchResult) => {
    const product = mapProductRecordToProduct(match.product);
    setInspectedProduct(product);
  };

  // Chọn sản phẩm và điều hướng ra danh sách chính
  const handleSelectAndClose = (product: Product) => {
    if (onSelectProduct) {
      onSelectProduct(product);
    }
    handleClose();
  };

  if (!isOpen) {
    return null;
  }

  const hasResultView = Boolean(searchResponse || searchError);

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        // Đóng modal khi click ra ngoài backdrop (khi không đang tìm)
        if (e.target === e.currentTarget && !isSearching) {
          handleClose();
        }
      }}
    >
      <div
        className="modal-container image-search-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-search-title"
        onKeyDown={handleKeyDown}
        ref={modalRef}
      >
        {/* MODAL HEADER */}
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-title-icon" aria-hidden="true">
              ✨
            </span>
            <h2 id="image-search-title" className="modal-title">
              Tìm sản phẩm bằng ảnh bao bì
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            disabled={isSearching}
            aria-label="Đóng cửa sổ tìm bằng ảnh"
            ref={closeBtnRef}
          >
            ✕
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="modal-body image-search-body">
          {/* TRƯỜNG HỢP 1: ĐANG XEM CHI TIẾT SẢN PHẨM GỢI Ý */}
          {inspectedProduct ? (
            <div className="inspected-product-view">
              <div className="inspected-header">
                <button
                  type="button"
                  className="btn-back-to-matches"
                  onClick={() => setInspectedProduct(null)}
                >
                  ← Quay lại danh sách gợi ý
                </button>
                <span className="inspected-badge">Thông tin sản phẩm trong kho</span>
              </div>

              <div className="inspected-card">
                <div className="inspected-image-box">
                  <ProductImage
                    storagePath={inspectedProduct.imageUrl}
                    alt={inspectedProduct.name}
                    className="inspected-img"
                  />
                  {inspectedProduct.stock <= 0 && (
                    <span className="out-of-stock-badge">Hết hàng</span>
                  )}
                </div>

                <div className="inspected-details">
                  <span className="inspected-category">{inspectedProduct.category}</span>
                  <h3 className="inspected-name">{inspectedProduct.name}</h3>

                  <div className="inspected-meta-grid">
                    <div className="meta-item">
                      <span className="meta-label">Mã hàng:</span>
                      <code className="meta-code">{inspectedProduct.code}</code>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Mã vạch:</span>
                      <span className="meta-barcode">
                        {inspectedProduct.barcode || 'Chưa có'}
                      </span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Đơn vị:</span>
                      <span>{inspectedProduct.unit}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Tồn kho:</span>
                      <strong
                        className={`stock-badge ${
                          inspectedProduct.stock <= 0 ? 'stock-empty' : 'stock-available'
                        }`}
                      >
                        {inspectedProduct.stock} {inspectedProduct.unit}
                      </strong>
                    </div>
                  </div>

                  <div className="inspected-prices">
                    <div className="price-box">
                      <span className="price-label">Giá nhập:</span>
                      <span className="price-val">
                        {formatCurrency(inspectedProduct.purchasePrice)}
                      </span>
                    </div>
                    <div className="price-box">
                      <span className="price-label">Giá bán:</span>
                      <strong className="price-val highlight">
                        {formatCurrency(inspectedProduct.salePrice)}
                      </strong>
                    </div>
                  </div>

                  {inspectedProduct.notes && (
                    <div className="inspected-notes">
                      <span className="notes-label">Ghi chú:</span>
                      <p className="notes-text">{inspectedProduct.notes}</p>
                    </div>
                  )}

                  <div className="inspected-actions">
                    {onSelectProduct && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleSelectAndClose(inspectedProduct)}
                      >
                        Xem trong danh sách kho
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setInspectedProduct(null)}
                    >
                      Đóng chi tiết
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : hasResultView ? (
            /* TRƯỜNG HỢP 2: HIỂN THỊ KẾT QUẢ TÌM KIẾM (GỢI Ý HOẶC LỖI) */
            <div className="search-results-view">
              {/* Ảnh gốc đã chọn (thu nhỏ) */}
              <div className="query-preview-banner">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Ảnh bao bì đã chụp"
                    className="query-thumbnail"
                  />
                )}
                <div className="query-info">
                  <span className="query-filename">{selectedFile?.name}</span>
                  {searchResponse?.ai_extraction && (
                    <div className="ai-tags-row">
                      {searchResponse.ai_extraction.brand && (
                        <span className="ai-tag brand-tag">
                          Hiệu: <strong>{searchResponse.ai_extraction.brand}</strong>
                        </span>
                      )}
                      {searchResponse.ai_extraction.product_name && (
                        <span className="ai-tag name-tag">
                          Tên: {searchResponse.ai_extraction.product_name}
                        </span>
                      )}
                      {searchResponse.ai_extraction.quantity_value && (
                        <span className="ai-tag qty-tag">
                          {searchResponse.ai_extraction.quantity_value}{' '}
                          {searchResponse.ai_extraction.quantity_unit}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-change-image-small"
                  onClick={resetState}
                  title="Chọn ảnh khác để tìm"
                >
                  Đổi ảnh
                </button>
              </div>

              {/* THÔNG BÁO LỖI NẾU CÓ */}
              {searchError && (
                <div
                  className={`search-status-box ${
                    searchError.status === 429 ? 'status-quota-box' : 'status-error-box'
                  }`}
                  role="alert"
                >
                  <div className="status-icon-large" aria-hidden="true">
                    {searchError.status === 429 ? '⏳' : '⚠️'}
                  </div>
                  <div className="status-content">
                    <h3 className="status-title">
                      {searchError.status === 429
                        ? 'Đã đạt giới hạn lượt tìm kiếm'
                        : 'Không thể tìm kiếm sản phẩm'}
                    </h3>
                    <p className="status-message">{searchError.message}</p>
                    {searchError.retryAfterSeconds && searchError.retryAfterSeconds > 0 && (
                      <p className="retry-hint">
                        Thời gian chờ: khoảng <strong>{searchError.retryAfterSeconds}</strong> giây.
                      </p>
                    )}
                  </div>
                  <div className="status-actions">
                    <button type="button" className="btn-primary" onClick={handleSearch}>
                      Thử lại
                    </button>
                    <button type="button" className="btn-secondary" onClick={resetState}>
                      Chọn ảnh khác
                    </button>
                  </div>
                </div>
              )}

              {/* KẾT QUẢ TỪ BACKEND */}
              {searchResponse && (
                <>
                  {/* Trạng thái không đọc được / không nhận diện được */}
                  {searchResponse.recognized === false ? (
                    <div className="search-status-box status-unrecognized-box">
                      <div className="status-icon-large" aria-hidden="true">
                        🔍
                      </div>
                      <div className="status-content">
                        <h3 className="status-title">Chưa nhận diện rõ bao bì</h3>
                        <p className="status-message">
                          {searchResponse.message ||
                            'Không thể nhận diện rõ tên sản phẩm từ ảnh này. Vui lòng chụp rõ nét hơn phần tên hoặc mặt trước bao bì.'}
                        </p>
                      </div>
                      <div className="status-actions">
                        <button type="button" className="btn-primary" onClick={resetState}>
                          Chọn ảnh khác rõ hơn
                        </button>
                      </div>
                    </div>
                  ) : !searchResponse.matches || searchResponse.matches.length === 0 ? (
                    /* Trạng thái nhận diện được nhưng không có hàng trong kho */
                    <div className="search-status-box status-no-matches-box">
                      <div className="status-icon-large" aria-hidden="true">
                        📦
                      </div>
                      <div className="status-content">
                        <h3 className="status-title">Không tìm thấy sản phẩm trong kho</h3>
                        <p className="status-message">
                          {searchResponse.message ||
                            'Đã nhận diện được thông tin bao bì nhưng không có sản phẩm nào phù hợp trong danh mục kho hàng của bạn.'}
                        </p>
                      </div>
                      <div className="status-actions">
                        <button type="button" className="btn-primary" onClick={resetState}>
                          Tìm với ảnh khác
                        </button>
                        <button type="button" className="btn-secondary" onClick={handleClose}>
                          Đóng
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* DANH SÁCH GỢI Ý KHỚP (Tối đa 5 sản phẩm) */
                    <div className="matches-container">
                      <div className="matches-header">
                        <h3 className="matches-count-title">
                          Gợi ý phù hợp ({searchResponse.matches.length} sản phẩm)
                        </h3>
                        <span className="matches-hint">
                          Xếp theo điểm đối chiếu từ ảnh bao bì
                        </span>
                      </div>

                      <div className="matches-list">
                        {searchResponse.matches.map((item, idx) => (
                          <div
                            key={item.product.id}
                            className="match-card"
                            onClick={() => handleInspectMatch(item)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleInspectMatch(item);
                              }
                            }}
                          >
                            <div className="match-card-image-box">
                              <ProductImage
                                storagePath={item.product.image_url}
                                alt={item.product.name}
                                className="match-product-img"
                              />
                              {item.product.stock <= 0 && (
                                <span className="out-of-stock-badge">Hết</span>
                              )}
                            </div>

                            <div className="match-card-info">
                              <div className="match-title-row">
                                <span className="match-rank">#{idx + 1}</span>
                                <h4 className="match-name" title={item.product.name}>
                                  {item.product.name}
                                </h4>
                              </div>

                              <div className="match-meta-row">
                                <span className="match-category">{item.product.category}</span>
                                <span className="match-code">
                                  Mã: <code>{item.product.code}</code>
                                </span>
                              </div>

                              <div className="match-pricing-row">
                                <span className="match-price">
                                  Giá bán: <strong>{formatCurrency(item.product.sale_price)}</strong>
                                </span>
                                <span className="match-stock">
                                  Kho: <strong>{item.product.stock} {item.product.unit}</strong>
                                </span>
                              </div>

                              {/* LÝ DO ĐỐI CHIẾU */}
                              {item.match_reasons && item.match_reasons.length > 0 && (
                                <div className="match-reasons-tags">
                                  {item.match_reasons.map((reason, rIdx) => (
                                    <span key={rIdx} className="match-reason-pill">
                                      ✓ {reason}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* CỘT ĐIỂM ĐỐI CHIẾU & NÚT CHỌN */}
                            <div className="match-card-actions-col">
                              <div
                                className={`score-badge ${
                                  item.match_score >= 70
                                    ? 'score-high'
                                    : item.match_score >= 50
                                    ? 'score-med'
                                    : 'score-low'
                                }`}
                                title="Điểm đối chiếu chuỗi và thuộc tính dựa trên tập luật (0-100)"
                              >
                                <span className="score-label">Điểm đối chiếu</span>
                                <span className="score-number">{item.match_score}/100</span>
                              </div>

                              <div className="match-buttons-row">
                                <button
                                  type="button"
                                  className="btn-match-detail"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleInspectMatch(item);
                                  }}
                                >
                                  Chi tiết
                                </button>
                                {onSelectProduct && (
                                  <button
                                    type="button"
                                    className="btn-match-select"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectAndClose(mapProductRecordToProduct(item.product));
                                    }}
                                  >
                                    Xem ở kho
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="matches-footer-actions">
                        <button type="button" className="btn-secondary" onClick={resetState}>
                          📷 Tìm ảnh khác
                        </button>
                        <button type="button" className="btn-secondary" onClick={handleClose}>
                          Đóng
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* TRƯỜNG HỢP 3: CHƯA TÌM - FORM CHỌN ẢNH VÀ XEM TRƯỚC */
            <div className="image-picker-flow">
              {/* KHU VỰC KÉO THẢ HOẶC CHỌN FILE */}
              {!selectedFile ? (
                <div
                  className={`image-dropzone ${isDragOver ? 'is-drag-over' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  aria-label="Chọn hoặc kéo thả ảnh bao bì sản phẩm"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="file-input-hidden"
                    onChange={handleFileInputChange}
                    aria-hidden="true"
                  />
                  <div className="dropzone-icon" aria-hidden="true">
                    📷
                  </div>
                  <h3 className="dropzone-title">Chọn hoặc kéo thả ảnh bao bì vào đây</h3>
                  <p className="dropzone-subtitle">
                    Hỗ trợ <strong>JPEG, PNG hoặc WebP</strong> (tối đa 5 MB)
                  </p>
                  <button
                    type="button"
                    className="btn-select-file"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Duyệt ảnh từ thiết bị
                  </button>
                </div>
              ) : (
                /* ĐÃ CHỌN ẢNH - XEM TRƯỚC VÀ XÁC NHẬN */
                <div className="image-preview-panel">
                  <div className="preview-media-box">
                    {previewUrl && (
                      <img
                        src={previewUrl}
                        alt="Ảnh bao bì sản phẩm đã chọn"
                        className="preview-img-large"
                      />
                    )}
                    <button
                      type="button"
                      className="btn-change-image"
                      onClick={resetState}
                      disabled={isSearching}
                    >
                      🔄 Đổi ảnh khác
                    </button>
                  </div>

                  <div className="preview-meta-box">
                    <div className="file-info-row">
                      <span className="file-name">{selectedFile.name}</span>
                      <span className="file-size">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>

                    {/* LƯU Ý MINH BẠCH VỀ GOOGLE GEMINI */}
                    <div className="gemini-notice-card">
                      <div className="gemini-notice-icon" aria-hidden="true">
                        🤖
                      </div>
                      <div className="gemini-notice-text">
                        <strong>Công nghệ nhận diện bao bì:</strong>
                        <p>
                          Ảnh của bạn sẽ được gửi đến mô hình <strong>Google Gemini 3.6 Flash</strong>{' '}
                          để trích xuất tên sản phẩm, thương hiệu và dung tích, sau đó đối chiếu với
                          kho hàng gia đình. Dữ liệu kho không gửi ra bên ngoài.
                        </p>
                      </div>
                    </div>

                    {/* TRẠNG THÁI ĐANG TÌM KIẾM */}
                    {isSearching ? (
                      <div className="searching-progress-card">
                        <div className="loading-spinner" aria-hidden="true"></div>
                        <div className="progress-texts">
                          <strong>Đang phân tích hình ảnh...</strong>
                          <span>Đang gửi đến Gemini và đối chiếu với danh mục kho</span>
                        </div>
                      </div>
                    ) : (
                      <div className="search-confirm-actions">
                        <button
                          type="button"
                          className="btn-primary btn-start-search"
                          onClick={handleSearch}
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
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                          <span>Tìm sản phẩm</span>
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleClose}
                        >
                          Hủy
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* BÁO LỖI CHỌN FILE */}
              {fileError && (
                <div className="file-error-alert" role="alert">
                  <span>⚠️ {fileError}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
