import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import type { Product } from '../types/product';
import { supabase } from '../lib/supabase';
import {
  createProduct,
  updateProduct,
  type CreateProductInput,
  type UpdateProductInput,
} from '../services/productService';
import { validateImageFile, uploadProductImage } from '../services/storageService';
import { ProductImage } from './ProductImage';

interface ProductFormModalProps {
  isOpen: boolean;
  productToEdit?: Product | null;
  existingCategories: string[];
  userId?: string | null;
  onClose: () => void;
  onSaveSuccess: (savedProduct: Product, isEdit: boolean) => void;
  triggerElementRef?: React.RefObject<HTMLElement | null>;
}

// Gợi ý các đơn vị tính thông dụng trong tạp hóa
const COMMON_UNITS = ['gói', 'chai', 'lon', 'hộp', 'kg', 'túi', 'lọ', 'thùng', 'bịch', 'cây'];

interface FormDialogProps {
  productToEdit?: Product | null;
  existingCategories: string[];
  userId?: string | null;
  onClose: () => void;
  onSaveSuccess: (savedProduct: Product, isEdit: boolean) => void;
  triggerElementRef?: React.RefObject<HTMLElement | null>;
}

const DRAFT_KEY = 'family_inventory_new_product_draft';

function ProductFormDialog({
  productToEdit,
  existingCategories,
  onClose,
  onSaveSuccess,
  triggerElementRef,
}: FormDialogProps) {
  const isEdit = Boolean(productToEdit);

  // Khởi tạo trạng thái form từ productToEdit hoặc bản nháp lưu trong sessionStorage
  const [code, setCode] = useState(() => {
    if (productToEdit) return productToEdit.code;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).code ?? '';
    } catch { /* ignore */ }
    return '';
  });

  const [name, setName] = useState(() => {
    if (productToEdit) return productToEdit.name;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).name ?? '';
    } catch { /* ignore */ }
    return '';
  });

  const [category, setCategory] = useState(() => {
    if (productToEdit) return productToEdit.category;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).category ?? '';
    } catch { /* ignore */ }
    return '';
  });

  const [unit, setUnit] = useState(() => {
    if (productToEdit) return productToEdit.unit;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).unit ?? '';
    } catch { /* ignore */ }
    return '';
  });

  const [barcode, setBarcode] = useState(() => {
    if (productToEdit) return productToEdit.barcode ?? '';
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).barcode ?? '';
    } catch { /* ignore */ }
    return '';
  });

  const [purchasePrice, setPurchasePrice] = useState(() => {
    if (productToEdit) return String(productToEdit.purchasePrice);
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).purchasePrice ?? '';
    } catch { /* ignore */ }
    return '';
  });

  const [salePrice, setSalePrice] = useState(() => {
    if (productToEdit) return String(productToEdit.salePrice);
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).salePrice ?? '';
    } catch { /* ignore */ }
    return '';
  });

  const [stock, setStock] = useState(() => {
    if (productToEdit) return String(productToEdit.stock);
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).stock ?? '0';
    } catch { /* ignore */ }
    return '0';
  });

  const [notes, setNotes] = useState(() => {
    if (productToEdit) return productToEdit.notes ?? '';
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).notes ?? '';
    } catch { /* ignore */ }
    return '';
  });

  // Tự động lưu bản nháp vào sessionStorage khi đang nhập mới
  useEffect(() => {
    if (!isEdit) {
      try {
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            code,
            name,
            category,
            unit,
            barcode,
            purchasePrice,
            salePrice,
            stock,
            notes,
          })
        );
      } catch {
        /* ignore */
      }
    }
  }, [isEdit, code, name, category, unit, barcode, purchasePrice, salePrice, stock, notes]);

  // Trạng thái xử lý và thông báo lỗi
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Trạng thái xử lý ảnh sản phẩm
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadStepText, setUploadStepText] = useState<string | null>(null);
  const uploadedStoragePathRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Thu hồi Object URL của preview khi previewUrl thay đổi hoặc unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch {
          /* ignore */
        }
      }
    };
  }, [previewUrl]);

  // Tham chiếu focus
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus ô đầu tiên khi mở modal
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Xử lý khi người dùng chọn file ảnh từ máy
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = await validateImageFile(file);
    if (!validation.isValid) {
      setImageError(validation.error);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const newUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(newUrl);
    uploadedStoragePathRef.current = null;
  };

  // Nút Bỏ ảnh vừa chọn: quay về ảnh ban đầu
  const handleClearSelectedFile = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setImageError(null);
    uploadedStoragePathRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Hoàn trả focus về nút mở khi modal đóng
  const handleClose = () => {
    if (isSubmitting) return;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    onClose();
    if (triggerElementRef?.current) {
      triggerElementRef.current.focus();
    }
  };

  // Nút Hủy rõ ràng: xóa bản nháp và đóng modal
  const handleExplicitCancel = () => {
    if (!isEdit) {
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    handleClose();
  };

  // Bảo vệ click backdrop: chỉ đóng nếu chưa nhập dữ liệu
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      const hasEnteredData =
        code.trim() !== '' ||
        name.trim() !== '' ||
        purchasePrice.trim() !== '' ||
        salePrice.trim() !== '' ||
        selectedFile !== null;

      if (!hasEnteredData) {
        handleClose();
      }
    }
  };

  // Quản lý phím Escape để đóng modal
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !isSubmitting) {
      e.stopPropagation();
      handleClose();
    }
  };

  // Kiểm tra tính hợp lệ của số thập phân
  const validateNumeric = (
    val: string,
    fieldName: string,
    maxDecimals: number,
    maxDigitsBeforeDecimal: number
  ): { num: number; error: string | null } => {
    const trimmed = val.trim();
    if (!trimmed) {
      return { num: 0, error: `Vui lòng nhập ${fieldName.toLowerCase()}.` };
    }

    // Không cho phép số âm hoặc ký tự lạ, dùng dấu chấm cho thập phân
    const numRegex = /^\d+(\.\d+)?$/;
    if (!numRegex.test(trimmed)) {
      return {
        num: 0,
        error: `${fieldName} không hợp lệ. Vui lòng chỉ nhập số dương và dùng dấu chấm (.) cho phần thập phân.`,
      };
    }

    const parts = trimmed.split('.');
    const integerPart = parts[0];
    const decimalPart = parts[1] || '';

    if (integerPart.length > maxDigitsBeforeDecimal) {
      return {
        num: 0,
        error: `${fieldName} vượt quá số lượng chữ số cho phép (tối đa ${maxDigitsBeforeDecimal} số nguyên).`,
      };
    }

    if (decimalPart.length > maxDecimals) {
      return {
        num: 0,
        error: `${fieldName} chỉ được có tối đa ${maxDecimals} chữ số thập phân.`,
      };
    }

    const num = Number(trimmed);
    if (!Number.isFinite(num) || isNaN(num) || num < 0) {
      return { num: 0, error: `${fieldName} không phải là số hợp lệ.` };
    }

    return { num, error: null };
  };

  // Cảnh báo bán lỗ (chỉ cảnh báo, vẫn cho lưu)
  const numPurchase = Number(purchasePrice.trim());
  const numSale = Number(salePrice.trim());
  const isSellingAtLoss =
    !isNaN(numPurchase) &&
    !isNaN(numSale) &&
    purchasePrice.trim() !== '' &&
    salePrice.trim() !== '' &&
    numSale < numPurchase;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const errors: Record<string, string> = {};

    // 1. Kiểm tra các trường văn bản
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      errors.code = 'Mã hàng không được để trống hoặc chỉ chứa khoảng trắng.';
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      errors.name = 'Tên sản phẩm không được để trống hoặc chỉ chứa khoảng trắng.';
    }

    const trimmedCategory = category.trim();
    if (!trimmedCategory) {
      errors.category = 'Vui lòng chọn hoặc nhập danh mục cho sản phẩm.';
    }

    const trimmedUnit = unit.trim();
    if (!trimmedUnit) {
      errors.unit = 'Vui lòng nhập đơn vị tính (ví dụ: chai, gói, kg).';
    }

    // 2. Kiểm tra giá nhập (numeric 14,2)
    const validPurchase = validateNumeric(purchasePrice, 'Giá nhập', 2, 12);
    if (validPurchase.error) {
      errors.purchasePrice = validPurchase.error;
    }

    // 3. Kiểm tra giá bán (numeric 14,2)
    const validSale = validateNumeric(salePrice, 'Giá bán', 2, 12);
    if (validSale.error) {
      errors.salePrice = validSale.error;
    }

    // 4. Kiểm tra số lượng tồn (numeric 14,3)
    const validStock = validateNumeric(stock, 'Số lượng tồn', 3, 11);
    if (validStock.error) {
      errors.stock = validStock.error;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Vui lòng kiểm tra lại các trường thông tin báo lỗi bên dưới.');
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    setUploadStepText(null);

    try {
      // 1. Kiểm tra phiên đăng nhập người dùng trước khi upload và ghi dữ liệu
      if (!supabase) {
        setFormError('Chưa cấu hình kết nối Supabase.');
        setIsSubmitting(false);
        return;
      }

      const { data: authData } = await supabase.auth.getSession();
      const currentSession = authData.session;
      if (!currentSession || !currentSession.user) {
        setFormError('Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.');
        setIsSubmitting(false);
        return;
      }
      const activeUserId = currentSession.user.id;

      // 2. Upload ảnh nếu có file mới được chọn và chưa upload thành công ở lần thử trước
      if (selectedFile) {
        if (!uploadedStoragePathRef.current) {
          setUploadStepText('Đang tải ảnh lên...');
          const uploadRes = await uploadProductImage(selectedFile, activeUserId);
          if (uploadRes.error || !uploadRes.path) {
            setFormError(uploadRes.error || 'Tải ảnh lên thất bại. Vui lòng thử lại.');
            setIsSubmitting(false);
            setUploadStepText(null);
            return; // Dừng lại, không lưu sản phẩm vào DB
          }
          uploadedStoragePathRef.current = uploadRes.path;
        }
      }

      // Xác định đường dẫn ảnh lưu trữ trong bucket (chỉ lưu storage path, không lưu URL hiển thị)
      const finalImagePath =
        uploadedStoragePathRef.current ?? (isEdit && productToEdit ? productToEdit.imageUrl : null);

      setUploadStepText('Đang lưu sản phẩm...');

      if (isEdit && productToEdit) {
        // Cập nhật sản phẩm hiện có
        const updatePayload: UpdateProductInput = {
          code: trimmedCode,
          barcode: barcode.trim() !== '' ? barcode.trim() : null,
          name: trimmedName,
          category: trimmedCategory,
          unit: trimmedUnit,
          purchasePrice: validPurchase.num,
          salePrice: validSale.num,
          stock: validStock.num,
          notes: notes.trim(),
          imageUrl: finalImagePath,
        };

        const res = await updateProduct(productToEdit.id, updatePayload);
        if (res.error || !res.data) {
          setFormError(res.error || 'Cập nhật thất bại.');
          if (res.duplicateField) {
            setFieldErrors({ [res.duplicateField]: res.error || 'Dữ liệu bị trùng lặp.' });
          }
          setIsSubmitting(false);
          setUploadStepText(null);
          return;
        }

        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
        uploadedStoragePathRef.current = null;
        onSaveSuccess(res.data, true);
        handleClose();
      } else {
        // Thêm mới sản phẩm
        const createPayload: CreateProductInput = {
          code: trimmedCode,
          barcode: barcode.trim() !== '' ? barcode.trim() : null,
          name: trimmedName,
          category: trimmedCategory,
          unit: trimmedUnit,
          purchasePrice: validPurchase.num,
          salePrice: validSale.num,
          stock: validStock.num,
          notes: notes.trim(),
          imageUrl: finalImagePath,
        };

        const res = await createProduct(createPayload);
        if (res.error || !res.data) {
          setFormError(res.error || 'Thêm mới thất bại.');
          if (res.duplicateField) {
            setFieldErrors({ [res.duplicateField]: res.error || 'Dữ liệu bị trùng lặp.' });
          }
          setIsSubmitting(false);
          setUploadStepText(null);
          return;
        }

        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
        uploadedStoragePathRef.current = null;
        onSaveSuccess(res.data, false);
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        handleClose();
      }
    } catch {
      setFormError('Đã xảy ra lỗi không xác định khi lưu. Dữ liệu form được giữ nguyên để bạn thử lại.');
    } finally {
      setIsSubmitting(false);
      setUploadStepText(null);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="modal-title" className="modal-title">
              {isEdit ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm mới'}
            </h2>
            <p className="modal-subtitle">
              {isEdit
                ? 'Cập nhật thông tin chi tiết và số lượng tồn kho'
                : 'Nhập thông tin mặt hàng mới vào cơ sở dữ liệu gia đình'}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        {formError && (
          <div className="modal-alert-error" role="alert">
            <svg
              className="alert-icon"
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
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{formError}</span>
          </div>
        )}

        {isSellingAtLoss && (
          <div className="modal-alert-warning" role="alert">
            <svg
              className="alert-icon"
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
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <span>
              <strong>Lưu ý:</strong> Giá bán đang thấp hơn giá nhập (bán lỗ). Bạn vẫn có thể lưu nếu đây là chủ đích.
            </span>
          </div>
        )}

        <form className="modal-form" onSubmit={handleSubmit} noValidate>
          {/* Ảnh sản phẩm */}
          <div className="form-group image-upload-group">
            <label className="form-label">
              Ảnh sản phẩm (không bắt buộc)
            </label>
            <div className="image-upload-box">
              <div className="image-preview-container">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Xem trước ảnh sản phẩm mới"
                    className="image-preview-thumbnail"
                  />
                ) : isEdit && productToEdit?.imageUrl ? (
                  <ProductImage
                    storagePath={productToEdit.imageUrl}
                    alt={productToEdit.name}
                    className="image-preview-thumbnail"
                  />
                ) : (
                  <img
                    src="/products/default-placeholder.svg"
                    alt="Chưa có ảnh sản phẩm"
                    className="image-preview-thumbnail"
                  />
                )}
              </div>

              <div className="image-upload-content">
                <input
                  ref={fileInputRef}
                  id="product-image-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  disabled={isSubmitting}
                  style={{ display: 'none' }}
                />

                <div className="image-upload-buttons">
                  <button
                    type="button"
                    className="btn-upload-trigger"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    {selectedFile
                      ? 'Đổi ảnh khác'
                      : isEdit && productToEdit?.imageUrl
                      ? 'Thay ảnh mới'
                      : 'Chọn ảnh từ máy'}
                  </button>

                  {selectedFile && (
                    <button
                      type="button"
                      className="btn-clear-image"
                      onClick={handleClearSelectedFile}
                      disabled={isSubmitting}
                    >
                      ✕ Bỏ ảnh vừa chọn
                    </button>
                  )}
                </div>

                {selectedFile ? (
                  <span className="image-file-details" title={selectedFile.name}>
                    Đã chọn: <strong>{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(0)} KB)
                  </span>
                ) : (
                  <span className="image-format-hint">
                    Hỗ trợ JPG, PNG, WebP (tối đa 5 MB). {isEdit && productToEdit?.imageUrl ? 'Để nguyên nếu muốn giữ ảnh cũ.' : ''}
                  </span>
                )}

                {imageError && <span className="field-error-text">{imageError}</span>}
              </div>
            </div>
          </div>

          <div className="form-grid-2">
            {/* Mã hàng */}
            <div className="form-group">
              <label htmlFor="product-code" className="form-label required">
                Mã hàng
              </label>
              <input
                ref={firstInputRef}
                id="product-code"
                type="text"
                className={`text-input ${fieldErrors.code ? 'input-error' : ''}`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Ví dụ: 00101"
                required
                disabled={isSubmitting}
                autoComplete="off"
              />
              {fieldErrors.code && <span className="field-error-text">{fieldErrors.code}</span>}
            </div>

            {/* Mã vạch */}
            <div className="form-group">
              <label htmlFor="product-barcode" className="form-label">
                Mã vạch (không bắt buộc)
              </label>
              <input
                id="product-barcode"
                type="text"
                className={`text-input ${fieldErrors.barcode ? 'input-error' : ''}`}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Ví dụ: 8935001201015"
                disabled={isSubmitting}
                autoComplete="off"
              />
              {fieldErrors.barcode && <span className="field-error-text">{fieldErrors.barcode}</span>}
            </div>
          </div>

          {/* Tên sản phẩm */}
          <div className="form-group">
            <label htmlFor="product-name" className="form-label required">
              Tên sản phẩm
            </label>
            <input
              id="product-name"
              type="text"
              className={`text-input ${fieldErrors.name ? 'input-error' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ví dụ: Gạo ST25 Thượng Hạng Ông Cua Túi 5kg"
              required
              disabled={isSubmitting}
            />
            {fieldErrors.name && <span className="field-error-text">{fieldErrors.name}</span>}
          </div>

          <div className="form-grid-2">
            {/* Danh mục */}
            <div className="form-group">
              <label htmlFor="product-category" className="form-label required">
                Danh mục
              </label>
              <input
                id="product-category"
                type="text"
                list="category-suggestions"
                className={`text-input ${fieldErrors.category ? 'input-error' : ''}`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Chọn hoặc gõ danh mục mới"
                required
                disabled={isSubmitting}
              />
              <datalist id="category-suggestions">
                {existingCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
              {fieldErrors.category && (
                <span className="field-error-text">{fieldErrors.category}</span>
              )}
            </div>

            {/* Đơn vị tính */}
            <div className="form-group">
              <label htmlFor="product-unit" className="form-label required">
                Đơn vị tính
              </label>
              <input
                id="product-unit"
                type="text"
                list="unit-suggestions"
                className={`text-input ${fieldErrors.unit ? 'input-error' : ''}`}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Ví dụ: gói, chai, kg, túi..."
                required
                disabled={isSubmitting}
              />
              <datalist id="unit-suggestions">
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              {fieldErrors.unit && <span className="field-error-text">{fieldErrors.unit}</span>}
            </div>
          </div>

          <div className="form-grid-3">
            {/* Giá nhập */}
            <div className="form-group">
              <label htmlFor="product-purchase-price" className="form-label required">
                Giá nhập (₫)
              </label>
              <input
                id="product-purchase-price"
                type="text"
                inputMode="decimal"
                className={`text-input ${fieldErrors.purchasePrice ? 'input-error' : ''}`}
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="Ví dụ: 25000"
                required
                disabled={isSubmitting}
              />
              {fieldErrors.purchasePrice && (
                <span className="field-error-text">{fieldErrors.purchasePrice}</span>
              )}
            </div>

            {/* Giá bán */}
            <div className="form-group">
              <label htmlFor="product-sale-price" className="form-label required">
                Giá bán (₫)
              </label>
              <input
                id="product-sale-price"
                type="text"
                inputMode="decimal"
                className={`text-input ${fieldErrors.salePrice ? 'input-error' : ''}`}
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="Ví dụ: 30000"
                required
                disabled={isSubmitting}
              />
              {fieldErrors.salePrice && (
                <span className="field-error-text">{fieldErrors.salePrice}</span>
              )}
            </div>

            {/* Số lượng tồn kho */}
            <div className="form-group">
              <label htmlFor="product-stock" className="form-label required">
                Số lượng tồn
              </label>
              <input
                id="product-stock"
                type="text"
                inputMode="decimal"
                className={`text-input ${fieldErrors.stock ? 'input-error' : ''}`}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="Ví dụ: 10 hoặc 2.5"
                required
                disabled={isSubmitting}
              />
              {fieldErrors.stock && <span className="field-error-text">{fieldErrors.stock}</span>}
            </div>
          </div>

          <p className="form-hint">
            💡 Dùng dấu chấm (.) cho phần thập phân (ví dụ: <code>2.5</code> kg hoặc <code>12500.50</code> ₫).
          </p>

          {/* Ghi chú */}
          <div className="form-group">
            <label htmlFor="product-notes" className="form-label">
              Ghi chú thêm (không bắt buộc)
            </label>
            <textarea
              id="product-notes"
              className="text-input textarea-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Vị trí để hàng trong tủ, lưu ý bảo quản..."
              rows={2}
              disabled={isSubmitting}
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={handleExplicitCancel}
              disabled={isSubmitting}
            >
              Hủy
            </button>
            <button type="submit" className="btn-save" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="btn-loading-state">
                  <span className="spinner-dot" aria-hidden="true"></span>
                  {uploadStepText || 'Đang lưu...'}
                </span>
              ) : isEdit ? (
                'Lưu thay đổi'
              ) : (
                'Thêm sản phẩm'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProductFormModal(props: ProductFormModalProps) {
  if (!props.isOpen) return null;

  // Sử dụng key để reset hoàn toàn form state theo productToEdit mà không cần setState trong effect
  const dialogKey = props.productToEdit ? props.productToEdit.id : 'new-product';

  return <ProductFormDialog key={dialogKey} {...props} />;
}
