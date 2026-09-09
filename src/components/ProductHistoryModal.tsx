import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';
import type { ProductHistoryEntry, ProductSnapshot } from '../types/history';
import { getProductHistory } from '../services/historyService';
import {
  formatCurrency,
  formatStockQuantity,
  formatVietnamDateTime,
} from '../utils/formatters';

interface ProductHistoryModalProps {
  isOpen: boolean;
  product: Product | null;
  onClose: () => void;
  triggerElementRef?: React.RefObject<HTMLElement | null>;
}

// Bảng ánh xạ nhãn tiếng Việt cho 10 trường nghiệp vụ
const FIELD_LABELS: Record<string, string> = {
  code: 'Mã hàng',
  barcode: 'Mã vạch',
  name: 'Tên sản phẩm',
  category: 'Danh mục',
  unit: 'Đơn vị tính',
  image_url: 'Ảnh sản phẩm',
  purchase_price: 'Giá nhập',
  sale_price: 'Giá bán',
  stock: 'Số lượng tồn',
  notes: 'Ghi chú',
};

// Thứ tự hiển thị ưu tiên các trường khi tạo mới
const CREATED_FIELD_ORDER = [
  'code',
  'barcode',
  'name',
  'category',
  'unit',
  'purchase_price',
  'sale_price',
  'stock',
  'image_url',
  'notes',
];

/**
 * Định dạng giá trị hiển thị thân thiện, bảo mật và chuẩn xác theo từng trường
 */
function formatFieldValue(
  field: string,
  val: unknown,
  unit?: string,
  isNewImageReplacement?: boolean
): string {
  if (field === 'image_url') {
    if (isNewImageReplacement) {
      return 'Đã thay ảnh';
    }
    return val && String(val).trim() !== '' ? 'Có ảnh' : 'Chưa có ảnh';
  }

  if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
    return 'Chưa có';
  }

  if (field === 'purchase_price' || field === 'sale_price') {
    const num = Number(val);
    return isNaN(num) ? String(val) : formatCurrency(num);
  }

  if (field === 'stock') {
    const formattedNum = formatStockQuantity(val as number | string);
    return unit && unit.trim() !== '' ? `${formattedNum} ${unit.trim()}` : formattedNum;
  }

  return String(val);
}

export function ProductHistoryModal({
  isOpen,
  product,
  onClose,
  triggerElementRef,
}: ProductHistoryModalProps) {
  const [entries, setEntries] = useState<ProductHistoryEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const productId = product?.id;

  // Tải dữ liệu từ đầu khi modal mở (dựa trên productId)
  useEffect(() => {
    if (!productId) return;

    let isMounted = true;

    getProductHistory(productId, 0)
      .then((res) => {
        if (!isMounted) return;

        if (res.error) {
          setFetchError(res.error);
        } else {
          setEntries(res.data);
          setHasMore(res.hasMore);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setFetchError(err instanceof Error ? err.message : 'Lỗi khi tải lịch sử sản phẩm.');
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [productId]);

  // Focus nút đóng khi mở modal
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  const handleClose = () => {
    onClose();
    if (triggerElementRef?.current) {
      triggerElementRef.current.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  };

  const handleLoadMore = async () => {
    if (!product || isLoadingMore || !hasMore) return;

    const nextPage = page + 1;
    setIsLoadingMore(true);

    try {
      const res = await getProductHistory(product.id, nextPage);
      if (!res.error) {
        setEntries((prev) => [...prev, ...res.data]);
        setHasMore(res.hasMore);
        setPage(nextPage);
      }
    } catch {
      /* ignore */
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleRetry = () => {
    if (!product) return;
    setIsLoading(true);
    setFetchError(null);
    setPage(0);

    getProductHistory(product.id, 0)
      .then((res) => {
        if (res.error) {
          setFetchError(res.error);
        } else {
          setEntries(res.data);
          setHasMore(res.hasMore);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : 'Lỗi khi tải lại lịch sử.');
        setIsLoading(false);
      });
  };

  if (!isOpen || !product) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onClick={handleClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="modal-content history-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="history-modal-title" className="modal-title">
              Lịch sử thay đổi sản phẩm
            </h2>
            <div className="history-product-badge">
              <span className="history-product-code">{product.code}</span>
              <strong>{product.name}</strong>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Đóng cửa sổ lịch sử"
          >
            ✕
          </button>
        </div>

        {/* Trạng thái đang tải lần đầu */}
        {isLoading && (
          <div className="state-panel loading-panel">
            <div className="loading-spinner small" aria-hidden="true"></div>
            <span>Đang tải lịch sử thay đổi từ máy chủ...</span>
          </div>
        )}

        {/* Trạng thái lỗi tải */}
        {fetchError && !isLoading && (
          <div className="state-panel error-panel">
            <p>{fetchError}</p>
            <button type="button" className="btn-retry" onClick={handleRetry}>
              Thử lại
            </button>
          </div>
        )}

        {/* Danh sách lịch sử khi tải xong */}
        {!isLoading && !fetchError && (
          <>
            {entries.length === 0 ? (
              <div className="history-empty-panel">
                <div className="history-empty-icon" aria-hidden="true">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <p>
                  <strong>Chưa có lịch sử thay đổi</strong>
                </p>
                <span className="image-format-hint">
                  Lịch sử chỉ ghi nhận các lần cập nhật từ khi tính năng được bật trên hệ thống.
                </span>
              </div>
            ) : (
              <div className="history-timeline" role="feed" aria-label="Dòng thời gian thay đổi">
                {entries.map((entry) => {
                  const isCreate = entry.action === 'create';
                  const changedFields = entry.changedFields || [];

                  return (
                    <article key={entry.id} className="history-card">
                      <div className="history-card-header">
                        <div className="history-header-left">
                          <span
                            className={`history-action-tag ${
                              isCreate ? 'action-create' : 'action-update'
                            }`}
                          >
                            {isCreate ? 'Tạo sản phẩm' : 'Cập nhật sản phẩm'}
                          </span>
                          <span className="history-actor-name">
                            {entry.actorName}
                          </span>
                        </div>
                        <time className="history-timestamp" dateTime={entry.changedAt}>
                          {formatVietnamDateTime(entry.changedAt)}
                        </time>
                      </div>

                      <div className="history-card-body">
                        {isCreate ? (
                          // Khi tạo mới: hiển thị giá trị khởi tạo
                          <div className="history-created-details">
                            {CREATED_FIELD_ORDER.map((field) => {
                              const val = entry.newValues[field as keyof ProductSnapshot];
                              if (val === undefined) return null;

                              const unit = entry.newValues.unit;
                              return (
                                <div key={field} className="created-detail-item">
                                  <span className="created-detail-label">
                                    {FIELD_LABELS[field] || field}:
                                  </span>
                                  <strong className="created-detail-value">
                                    {formatFieldValue(field, val, unit)}
                                  </strong>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          // Khi cập nhật: chỉ hiển thị các trường thay đổi
                          <div className="history-changes-list">
                            {changedFields.map((field) => {
                              const oldVal = entry.oldValues?.[field as keyof ProductSnapshot];
                              const newVal = entry.newValues?.[field as keyof ProductSnapshot];

                              // Đơn vị tính lấy chính xác từ snapshot tương ứng
                              const oldUnit = entry.oldValues?.unit;
                              const newUnit = entry.newValues?.unit;

                              // Kiểm tra nếu là thay ảnh từ ảnh cũ sang ảnh mới
                              const isImageReplacement =
                                field === 'image_url' &&
                                Boolean(oldVal && String(oldVal).trim() !== '') &&
                                Boolean(newVal && String(newVal).trim() !== '');

                              return (
                                <div key={field} className="history-change-row">
                                  <span className="history-field-name">
                                    {FIELD_LABELS[field] || field}
                                  </span>
                                  <div className="history-diff-container">
                                    <span className="diff-old-val">
                                      {formatFieldValue(field, oldVal, oldUnit)}
                                    </span>
                                    <span className="diff-arrow" aria-hidden="true">
                                      ➔
                                    </span>
                                    <span className="diff-new-val">
                                      {formatFieldValue(field, newVal, newUnit, isImageReplacement)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}

                {/* Nút Tải thêm khi còn dữ liệu */}
                {hasMore && (
                  <div className="history-load-more-container">
                    <button
                      type="button"
                      className="btn-history-load-more"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? (
                        <>
                          <span className="spinner-dot small" aria-hidden="true"></span>
                          Đang tải thêm...
                        </>
                      ) : (
                        'Tải thêm lịch sử'
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="history-footer-note">
              Lịch sử chỉ ghi nhận từ khi tính năng được bật • Giờ Việt Nam (Asia/Ho_Chi_Minh)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
