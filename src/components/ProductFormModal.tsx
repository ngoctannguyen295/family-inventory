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
import './ProductFormModal.css';

interface ProductFormModalProps {
  isOpen: boolean;
  productToEdit?: Product | null;
  existingCategories: string[];
  existingProducts?: Product[];
  userId?: string | null;
  onClose: () => void;
  onSaveSuccess: (savedProduct: Product, isEdit: boolean) => void;
  triggerElementRef?: React.RefObject<HTMLElement | null>;
  isOnline?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}

// Gợi ý các đơn vị tính thông dụng theo thứ tự ưu tiên
const COMMON_UNITS = ['chai', 'gói', 'hộp', 'kg', 'lon', 'túi', 'thùng', 'bịch', 'cây', 'lọ', 'cái'];

const DRAFT_KEY = 'family_inventory_new_product_draft';
const LAST_CATEGORY_KEY = 'family_inventory_last_category';
const LAST_UNIT_KEY = 'family_inventory_last_unit';

/**
 * Tự động sinh mã hàng mới (SKU) kế tiếp không trùng lặp
 */
function generateNextProductCode(existingProducts: Product[] = []): string {
  const existingCodes = new Set(
    existingProducts
      .filter((p) => p && p.code)
      .map((p) => p.code.trim().toUpperCase())
  );

  let maxSpNumber = 0;
  const spRegex = /^SP0*(\d+)$/i;

  for (const p of existingProducts) {
    if (!p.code) continue;
    const match = p.code.trim().match(spRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSpNumber) {
        maxSpNumber = num;
      }
    }
  }

  let nextNum = maxSpNumber > 0 ? maxSpNumber + 1 : 1;
  let candidate = `SP${String(nextNum).padStart(3, '0')}`;

  while (existingCodes.has(candidate.toUpperCase())) {
    nextNum++;
    candidate = `SP${String(nextNum).padStart(3, '0')}`;
  }

  return candidate;
}

interface FormDialogProps {
  productToEdit?: Product | null;
  existingCategories: string[];
  existingProducts?: Product[];
  userId?: string | null;
  onClose: () => void;
  onSaveSuccess: (savedProduct: Product, isEdit: boolean) => void;
  triggerElementRef?: React.RefObject<HTMLElement | null>;
  isOnline?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}

function ProductFormDialog({
  productToEdit,
  existingCategories,
  existingProducts = [],
  onClose,
  onSaveSuccess,
  triggerElementRef,
  isOnline = true,
  onDirtyChange,
}: FormDialogProps) {
  const isEdit = Boolean(productToEdit);

  // Khởi tạo mã hàng: nếu sửa thì lấy của sản phẩm, nếu có nháp thì lấy nháp, nếu mới thì tự sinh mã
  const [code, setCode] = useState(() => {
    if (productToEdit) return productToEdit.code;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.code) return parsed.code;
      }
    } catch { /* ignore */ }
    return generateNextProductCode(existingProducts);
  });

  const [name, setName] = useState(() => {
    if (productToEdit) return productToEdit.name;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft).name ?? '';
    } catch { /* ignore */ }
    return '';
  });

  // Tồn kho: mặc định là '1' khi thêm mới
  const [stock, setStock] = useState(() => {
    if (productToEdit) return String(productToEdit.stock);
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.stock !== undefined && parsed.stock !== '') return String(parsed.stock);
      }
    } catch { /* ignore */ }
    return '1';
  });

  // Đơn vị tính: nhớ đơn vị vừa dùng
  const [unit, setUnit] = useState(() => {
    if (productToEdit) return productToEdit.unit;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.unit) return parsed.unit;
      }
      const lastUnit = localStorage.getItem(LAST_UNIT_KEY);
      if (lastUnit) return lastUnit;
    } catch { /* ignore */ }
    return 'chai';
  });

  // Danh mục: nhớ danh mục vừa dùng
  const [category, setCategory] = useState(() => {
    if (productToEdit) return productToEdit.category;
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.category) return parsed.category;
      }
      const lastCat = localStorage.getItem(LAST_CATEGORY_KEY);
      if (lastCat) return lastCat;
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  // Trạng thái xử lý ảnh sản phẩm
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadStepText, setUploadStepText] = useState<string | null>(null);
  const uploadedStoragePathRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Kiểm tra biểu mẫu có thay đổi chưa lưu (dirty state)
  const isDirty = isEdit
    ? Boolean(
        productToEdit &&
          (code !== productToEdit.code ||
            name !== productToEdit.name ||
            category !== productToEdit.category ||
            unit !== productToEdit.unit ||
            (barcode || '') !== (productToEdit.barcode || '') ||
            purchasePrice !== String(productToEdit.purchasePrice) ||
            salePrice !== String(productToEdit.salePrice) ||
            stock !== String(productToEdit.stock) ||
            (notes || '') !== (productToEdit.notes || '') ||
            selectedFile !== null)
      )
    : Boolean(
        code.trim() !== '' ||
          name.trim() !== '' ||
          category.trim() !== '' ||
          unit.trim() !== '' ||
          barcode.trim() !== '' ||
          purchasePrice.trim() !== '' ||
          (salePrice.trim() !== '' && salePrice !== '0') ||
          (stock.trim() !== '' && stock !== '0') ||
          notes.trim() !== '' ||
          selectedFile !== null
      );

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => {
      onDirtyChange?.(false);
    };
  }, [isDirty, onDirtyChange]);

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

  // Tham chiếu modal dialog
  const modalRef = useRef<HTMLDivElement>(null);

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

  // Sinh mã hàng ngẫu nhiên khác
  const handleRegenerateCode = () => {
    const existingCodes = new Set(
      (existingProducts || []).map((p) => p.code.trim().toUpperCase())
    );
    let randNum = Math.floor(Math.random() * 900) + 100;
    let candidate = `SP${randNum}`;
    while (existingCodes.has(candidate.toUpperCase())) {
      randNum = Math.floor(Math.random() * 900) + 100;
      candidate = `SP${randNum}`;
    }
    setCode(candidate);
    setFieldErrors((prev) => ({ ...prev, code: undefined }));
  };

  // Chọn nhanh đơn vị tính bằng nút
  const handleSelectUnit = (selectedUnit: string) => {
    setUnit(selectedUnit);
    setFieldErrors((prev) => ({ ...prev, unit: undefined }));
    try {
      localStorage.setItem(LAST_UNIT_KEY, selectedUnit);
    } catch {
      /* ignore */
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

    // Chặn lưu dữ liệu khi đang mất kết nối mạng
    if (isOnline === false) {
      setFormError('Đang mất kết nối mạng. Không thể lưu dữ liệu trong lúc mất kết nối.');
      return;
    }

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
        try {
          if (trimmedCategory) {
            localStorage.setItem(LAST_CATEGORY_KEY, trimmedCategory);
          }
          if (trimmedUnit) {
            localStorage.setItem(LAST_UNIT_KEY, trimmedUnit);
          }
        } catch {
          /* ignore */
        }
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
        try {
          sessionStorage.removeItem(DRAFT_KEY);
          if (trimmedCategory) {
            localStorage.setItem(LAST_CATEGORY_KEY, trimmedCategory);
          }
          if (trimmedUnit) {
            localStorage.setItem(LAST_UNIT_KEY, trimmedUnit);
          }
        } catch {
          /* ignore */
        }
        onSaveSuccess(res.data, false);
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
      className="pf-modal-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="pf-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header modal */}
        <div className="pf-modal-header">
          <div className="pf-modal-title-group">
            <h2 id="modal-title" className="pf-modal-title">
              {isEdit ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm mới'}
            </h2>
            <p className="pf-modal-subtitle">
              {isEdit
                ? 'Cập nhật thông tin chi tiết và số lượng tồn kho'
                : 'Nhập thông tin mặt hàng mới vào cơ sở dữ liệu gia đình'}
            </p>
          </div>
          <button
            type="button"
            className="pf-modal-close-btn"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        {/* Nội dung form cuộn dọc mượt mà */}
        <form className="pf-modal-body" onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="pf-alert pf-alert-error" role="alert">
              <svg
                className="pf-alert-icon"
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
            <div className="pf-alert pf-alert-warning" role="alert">
              <svg
                className="pf-alert-icon"
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

          {/* NHÓM 1: THÔNG TIN CƠ BẢN (ĐẶT Ở PHẦN ĐẦU) */}
          <div className="pf-section">
            <div className="pf-section-header">
              <span className="pf-section-badge" aria-hidden="true"></span>
              <h3 className="pf-section-title">📌 Thông tin cơ bản</h3>
            </div>

            {/* 1. Tên sản phẩm (Đặt ngay đầu, full-width) */}
            <div className="pf-field">
              <label htmlFor="product-name" className="pf-label">
                Tên sản phẩm <span className="pf-required-star">*</span>
              </label>
              <input
                id="product-name"
                name="name"
                type="text"
                className={`pf-input ${fieldErrors.name ? 'pf-input-error' : ''}`}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                }}
                placeholder="Ví dụ: Nước mắm Nam Ngư Đệ Nhị 900ml, Gạo ST25..."
                required
                disabled={isSubmitting}
                autoComplete="off"
                autoFocus={!isEdit}
              />
              {fieldErrors.name && <span className="pf-field-error">{fieldErrors.name}</span>}
            </div>

            {/* 2. Hàng 2 cột: Số lượng tồn & Đơn vị tính */}
            <div className="pf-grid-2">
              {/* Số lượng tồn */}
              <div className="pf-field">
                <label htmlFor="product-stock" className="pf-label">
                  Số lượng tồn {isEdit ? '' : 'ban đầu'} <span className="pf-required-star">*</span>
                </label>
                <input
                  id="product-stock"
                  name="stock"
                  type="text"
                  inputMode="decimal"
                  className={`pf-input ${fieldErrors.stock ? 'pf-input-error' : ''}`}
                  value={stock}
                  onChange={(e) => {
                    setStock(e.target.value);
                    if (fieldErrors.stock) setFieldErrors((prev) => ({ ...prev, stock: undefined }));
                  }}
                  placeholder="Ví dụ: 10 hoặc 2.5"
                  required
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                {fieldErrors.stock ? (
                  <span className="pf-field-error">{fieldErrors.stock}</span>
                ) : (
                  <p className="pf-hint-text">
                    💡 Nhập số lượng trong kho (hỗ trợ số lẻ như <code>2.5</code>).
                  </p>
                )}
              </div>

              {/* Đơn vị tính */}
              <div className="pf-field">
                <label htmlFor="product-unit" className="pf-label">
                  Đơn vị tính <span className="pf-required-star">*</span>
                  {!isEdit && localStorage.getItem(LAST_UNIT_KEY) && (
                    <span className="pf-remember-badge">Đã nhớ</span>
                  )}
                </label>
                <input
                  id="product-unit"
                  name="unit"
                  type="text"
                  list="unit-suggestions"
                  className={`pf-input ${fieldErrors.unit ? 'pf-input-error' : ''}`}
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value);
                    if (fieldErrors.unit) setFieldErrors((prev) => ({ ...prev, unit: undefined }));
                    try {
                      localStorage.setItem(LAST_UNIT_KEY, e.target.value);
                    } catch { /* ignore */ }
                  }}
                  placeholder="chai, gói, hộp, kg..."
                  required
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                <datalist id="unit-suggestions">
                  {COMMON_UNITS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
                {fieldErrors.unit && <span className="pf-field-error">{fieldErrors.unit}</span>}
              </div>
            </div>

            {/* 3. Dãy nút bấm chọn nhanh đơn vị tính */}
            <div className="pf-unit-chips-wrapper">
              <span className="pf-unit-chips-label">
                <span>Chọn nhanh đơn vị:</span>
              </span>
              <div className="pf-unit-chips-container" role="group" aria-label="Chọn nhanh đơn vị tính">
                {COMMON_UNITS.map((u) => {
                  const isSelected = unit.trim().toLowerCase() === u.toLowerCase();
                  return (
                    <button
                      key={u}
                      type="button"
                      className={`pf-unit-chip-btn ${isSelected ? 'active' : ''}`}
                      onClick={() => handleSelectUnit(u)}
                      disabled={isSubmitting}
                      title={`Chọn đơn vị ${u}`}
                    >
                      {isSelected && <span aria-hidden="true">✓ </span>}
                      <span>{u}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* NHÓM 2: PHÂN LOẠI & MÃ HÀNG HÓA */}
          <div className="pf-section">
            <div className="pf-section-header">
              <span className="pf-section-badge" aria-hidden="true"></span>
              <h3 className="pf-section-title">🏷️ Phân loại & Mã hàng</h3>
            </div>

            <div className="pf-grid-2">
              {/* Danh mục */}
              <div className="pf-field">
                <label htmlFor="product-category" className="pf-label">
                  Danh mục <span className="pf-required-star">*</span>
                  {!isEdit && localStorage.getItem(LAST_CATEGORY_KEY) && (
                    <span className="pf-remember-badge">Đã nhớ</span>
                  )}
                </label>
                <input
                  id="product-category"
                  name="category"
                  type="text"
                  list="category-suggestions"
                  className={`pf-input ${fieldErrors.category ? 'pf-input-error' : ''}`}
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    if (fieldErrors.category) setFieldErrors((prev) => ({ ...prev, category: undefined }));
                    try {
                      localStorage.setItem(LAST_CATEGORY_KEY, e.target.value);
                    } catch { /* ignore */ }
                  }}
                  placeholder="Chọn hoặc gõ danh mục mới"
                  required
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                <datalist id="category-suggestions">
                  {existingCategories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
                {fieldErrors.category && (
                  <span className="pf-field-error">{fieldErrors.category}</span>
                )}
              </div>

              {/* Mã hàng (SKU) với chức năng tự sinh mã */}
              <div className="pf-field">
                <label htmlFor="product-code" className="pf-label">
                  Mã hàng (SKU) <span className="pf-required-star">*</span>
                </label>
                <div className="pf-code-input-wrapper">
                  <input
                    id="product-code"
                    name="code"
                    type="text"
                    inputMode="text"
                    className={`pf-input ${fieldErrors.code ? 'pf-input-error' : ''}`}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      if (fieldErrors.code) setFieldErrors((prev) => ({ ...prev, code: undefined }));
                    }}
                    placeholder="Ví dụ: SP001"
                    required
                    disabled={isSubmitting}
                    autoComplete="off"
                  />
                  {!isEdit && (
                    <button
                      type="button"
                      className="pf-code-refresh-btn"
                      onClick={handleRegenerateCode}
                      disabled={isSubmitting}
                      title="Sinh mã hàng khác"
                      aria-label="Tự sinh mã hàng khác"
                    >
                      🔄
                    </button>
                  )}
                </div>
                {fieldErrors.code ? (
                  <span className="pf-field-error">{fieldErrors.code}</span>
                ) : (
                  <p className="pf-hint-text">
                    ✨ Tự sinh mã hàng (bấm 🔄 để đổi mã hoặc chỉnh sửa tùy ý).
                  </p>
                )}
              </div>
            </div>

            {/* Mã vạch */}
            <div className="pf-field">
              <label htmlFor="product-barcode" className="pf-label">
                Mã vạch <span className="pf-optional-tag">(không bắt buộc)</span>
              </label>
              <input
                id="product-barcode"
                name="barcode"
                type="text"
                inputMode="text"
                className={`pf-input ${fieldErrors.barcode ? 'pf-input-error' : ''}`}
                value={barcode}
                onChange={(e) => {
                  setBarcode(e.target.value);
                  if (fieldErrors.barcode) setFieldErrors((prev) => ({ ...prev, barcode: undefined }));
                }}
                placeholder="Ví dụ: 8935001201015"
                disabled={isSubmitting}
                autoComplete="off"
              />
              {fieldErrors.barcode && <span className="pf-field-error">{fieldErrors.barcode}</span>}
            </div>
          </div>

          {/* NHÓM 3: GIÁ VÀ CHI PHÍ */}
          <div className="pf-section">
            <div className="pf-section-header">
              <span className="pf-section-badge" aria-hidden="true"></span>
              <h3 className="pf-section-title">💰 Giá sản phẩm</h3>
            </div>

            <div className="pf-grid-2">
              {/* Giá nhập */}
              <div className="pf-field">
                <label htmlFor="product-purchase-price" className="pf-label">
                  Giá nhập (₫) <span className="pf-required-star">*</span>
                </label>
                <input
                  id="product-purchase-price"
                  name="purchasePrice"
                  type="text"
                  inputMode="decimal"
                  className={`pf-input ${fieldErrors.purchasePrice ? 'pf-input-error' : ''}`}
                  value={purchasePrice}
                  onChange={(e) => {
                    setPurchasePrice(e.target.value);
                    if (fieldErrors.purchasePrice) setFieldErrors((prev) => ({ ...prev, purchasePrice: undefined }));
                  }}
                  placeholder="Ví dụ: 25000"
                  required
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                {fieldErrors.purchasePrice && (
                  <span className="pf-field-error">{fieldErrors.purchasePrice}</span>
                )}
              </div>

              {/* Giá bán */}
              <div className="pf-field">
                <label htmlFor="product-sale-price" className="pf-label">
                  Giá bán (₫) <span className="pf-required-star">*</span>
                </label>
                <input
                  id="product-sale-price"
                  name="salePrice"
                  type="text"
                  inputMode="decimal"
                  className={`pf-input ${fieldErrors.salePrice ? 'pf-input-error' : ''}`}
                  value={salePrice}
                  onChange={(e) => {
                    setSalePrice(e.target.value);
                    if (fieldErrors.salePrice) setFieldErrors((prev) => ({ ...prev, salePrice: undefined }));
                  }}
                  placeholder="Ví dụ: 30000"
                  required
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                {fieldErrors.salePrice && (
                  <span className="pf-field-error">{fieldErrors.salePrice}</span>
                )}
              </div>
            </div>
          </div>

          {/* NHÓM 4: ẢNH & GHI CHÚ THÊM (TÙY CHỌN) */}
          <div className="pf-section">
            <div className="pf-section-header">
              <span className="pf-section-badge" aria-hidden="true"></span>
              <h3 className="pf-section-title">📷 Ảnh & Ghi chú (Tùy chọn)</h3>
            </div>

            {/* Vùng Ảnh sản phẩm */}
            <div className="pf-field">
              <label className="pf-label">
                Ảnh sản phẩm <span className="pf-optional-tag">(không bắt buộc)</span>
              </label>
              <div className="pf-image-card">
                <div className="pf-image-thumb-box">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Xem trước ảnh sản phẩm mới"
                      className="pf-image-thumb"
                    />
                  ) : isEdit && productToEdit?.imageUrl ? (
                    <ProductImage
                      storagePath={productToEdit.imageUrl}
                      alt={productToEdit.name}
                      className="pf-image-thumb"
                    />
                  ) : (
                    <img
                      src="/products/default-placeholder.svg"
                      alt="Chưa có ảnh sản phẩm"
                      className="pf-image-thumb"
                    />
                  )}
                </div>

                <div className="pf-image-info">
                  <input
                    ref={fileInputRef}
                    id="product-image-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileChange}
                    disabled={isSubmitting}
                    style={{ display: 'none' }}
                  />

                  <div className="pf-image-buttons">
                    <button
                      type="button"
                      className="pf-btn-upload-trigger"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
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
                        className="pf-btn-clear-image"
                        onClick={handleClearSelectedFile}
                        disabled={isSubmitting}
                      >
                        ✕ Bỏ ảnh vừa chọn
                      </button>
                    )}
                  </div>

                  {selectedFile ? (
                    <span className="pf-image-filename" title={selectedFile.name}>
                      Đã chọn: <strong>{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(0)} KB)
                    </span>
                  ) : (
                    <span className="pf-image-hint">
                      Hỗ trợ JPG, PNG, WebP (tối đa 5 MB). {isEdit && productToEdit?.imageUrl ? 'Để nguyên nếu muốn giữ ảnh cũ.' : ''}
                    </span>
                  )}

                  {imageError && <span className="pf-field-error">{imageError}</span>}
                </div>
              </div>
            </div>

            {/* Ghi chú thêm */}
            <div className="pf-field">
              <label htmlFor="product-notes" className="pf-label">
                Ghi chú lưu ý <span className="pf-optional-tag">(không bắt buộc)</span>
              </label>
              <textarea
                id="product-notes"
                name="notes"
                className="pf-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Vị trí để hàng trong tủ, lưu ý bảo quản..."
                rows={3}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {isOnline === false && (
            <div className="pf-alert pf-alert-warning" role="alert">
              <span>⚠️ Đang mất kết nối mạng. Không thể lưu dữ liệu lúc này.</span>
            </div>
          )}

          {/* Thanh nút Hủy & Lưu ở cuối form */}
          <div className="pf-actions-bar">
            <button
              type="button"
              className="pf-btn-cancel"
              onClick={handleExplicitCancel}
              disabled={isSubmitting}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="pf-btn-save"
              disabled={isSubmitting || isOnline === false}
              title={isOnline === false ? 'Không thể lưu khi mất kết nối mạng' : undefined}
            >
              {isSubmitting ? (
                <>
                  <span className="pf-loading-spinner" aria-hidden="true"></span>
                  {uploadStepText || 'Đang lưu...'}
                </>
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
