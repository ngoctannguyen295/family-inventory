import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, RefObject } from 'react';
import type { Product } from '../types/product';
import { findProductByBarcode } from '../services/productService';
import { formatCurrency } from '../utils/formatters';
import { ProductImage } from './ProductImage';

type ScannerTab = 'camera' | 'file' | 'manual';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct?: (product: Product) => void;
  triggerElementRef?: RefObject<HTMLElement | null>;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SCANNER_CONTAINER_ID = 'barcode-reader-viewport';

export function BarcodeScannerModal({
  isOpen,
  onClose,
  onSelectProduct,
  triggerElementRef,
}: BarcodeScannerModalProps) {
  // Tab hiện tại
  const [activeTab, setActiveTab] = useState<ScannerTab>('camera');

  // Trạng thái Camera
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [availableCameras, setAvailableCameras] = useState<{ id: string; label: string }[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  // Trạng thái File ảnh
  const [fileError, setFileError] = useState<string | null>(null);
  const [isScanningFile, setIsScanningFile] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // Trạng thái Nhập mã thủ công
  const [manualCode, setManualCode] = useState('');

  // Trạng thái Kết quả tìm kiếm sản phẩm
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isProductNotFound, setIsProductNotFound] = useState(false);

  // Refs quản lý vòng đời camera và component
  const isMountedRef = useRef(true);
  const isStartingRef = useRef(false);
  const isProcessedRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerInstanceRef = useRef<any>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Lazy-load lớp Html5Qrcode và các định dạng hỗ trợ
  const loadScannerModule = useCallback(async () => {
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
    const formatsToSupport = [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
    ];
    return { Html5Qrcode, formatsToSupport };
  }, []);

  // Dừng camera an toàn tuyệt đối
  const stopCamera = useCallback(async () => {
    const scanner = scannerInstanceRef.current;
    if (!scanner) return;

    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      scanner.clear();
    } catch {
      // Bỏ qua lỗi dọn dẹp nếu camera đã tự đóng
    } finally {
      scannerInstanceRef.current = null;
      if (isMountedRef.current) {
        setIsCameraActive(false);
        setIsCameraLoading(false);
      }
    }
  }, []);

  // Thực hiện tìm kiếm sản phẩm theo mã vạch từ Supabase
  const handleBarcodeDetected = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    // Đánh dấu đã nhận mã vạch để không xử lý nhiều lần
    isProcessedRef.current = true;
    setScannedBarcode(code);
    setIsSearchingProduct(true);
    setSearchError(null);
    setIsProductNotFound(false);
    setFoundProduct(null);

    // Tự động tắt camera sau khi đọc mã thành công
    await stopCamera();

    try {
      const res = await findProductByBarcode(code);

      if (!isMountedRef.current) return;

      if (res.error) {
        setSearchError(res.error);
      } else if (res.data) {
        setFoundProduct(res.data);
      } else {
        // Không tìm thấy sản phẩm trong DB
        setIsProductNotFound(true);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setSearchError(err instanceof Error ? err.message : 'Lỗi kết nối khi tra cứu sản phẩm.');
    } finally {
      if (isMountedRef.current) {
        setIsSearchingProduct(false);
      }
    }
  }, [stopCamera]);

  // Khởi động Camera khi người dùng yêu cầu
  const startCamera = useCallback(async (cameraIdOverride?: string) => {
    // 1. Kiểm tra môi trường hỗ trợ
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Trình duyệt hoặc môi trường hiện tại không hỗ trợ camera (cần kết nối an toàn HTTPS hoặc localhost). Vui lòng chọn ảnh có mã vạch hoặc nhập thủ công.'
      );
      return;
    }

    // 2. Dừng scanner cũ nếu đang chạy
    await stopCamera();

    setCameraError(null);
    setIsCameraLoading(true);
    isStartingRef.current = true;
    isProcessedRef.current = false;

    try {
      const { Html5Qrcode, formatsToSupport } = await loadScannerModule();

      if (!isMountedRef.current) {
        isStartingRef.current = false;
        return;
      }

      // Lấy danh sách camera nếu chưa có
      try {
        const devices = await Html5Qrcode.getCameras();
        if (isMountedRef.current && devices && devices.length > 0) {
          setAvailableCameras(
            devices.map((d, index) => ({
              id: d.id,
              label: d.label || `Camera ${index + 1}`,
            }))
          );
        }
      } catch {
        // Nếu không lấy được danh sách, vẫn có thể dùng facingMode
      }

      // Tạo instance mới cho khung ngắm
      const scanner = new Html5Qrcode(SCANNER_CONTAINER_ID, {
        formatsToSupport,
        verbose: false,
      });
      scannerInstanceRef.current = scanner;

      // Ưu tiên camera được chọn hoặc camera sau
      const targetCam = cameraIdOverride || selectedCameraId || { facingMode: 'environment' };

      const qrConfig = {
        fps: 10,
        qrbox: { width: 280, height: 160 },
        aspectRatio: 1.333333,
      };

      await scanner.start(
        targetCam,
        qrConfig,
        (decodedText) => {
          // Chỉ xử lý 1 lần cho lượt quét hiện tại
          if (!isProcessedRef.current) {
            handleBarcodeDetected(decodedText);
          }
        },
        // Bỏ qua lỗi từng khung hình để không hiển thị lỗi spam
        () => {}
      );

      isStartingRef.current = false;

      // Nếu modal đã đóng hoặc component đã unmount trong lúc start() đang chạy
      if (!isMountedRef.current) {
        await stopCamera();
        return;
      }

      setIsCameraActive(true);
      setIsCameraLoading(false);
    } catch (err: unknown) {
      isStartingRef.current = false;
      setIsCameraLoading(false);
      setIsCameraActive(false);

      const errorName = err instanceof Error ? err.name : '';
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (
        errorName === 'NotAllowedError' ||
        errorName === 'PermissionDeniedError' ||
        errorMessage.includes('Permission')
      ) {
        setCameraError(
          'Quyền truy cập camera bị từ chối. Vui lòng cho phép quyền truy cập camera trong cài đặt trình duyệt để tiếp tục.'
        );
      } else if (
        errorName === 'NotFoundError' ||
        errorName === 'DevicesNotFoundError' ||
        errorMessage.includes('not found')
      ) {
        setCameraError('Không tìm thấy thiết bị camera trên máy của bạn.');
      } else if (
        errorName === 'NotReadableError' ||
        errorName === 'TrackStartError' ||
        errorMessage.includes('in use')
      ) {
        setCameraError('Camera đang được sử dụng bởi một ứng dụng khác.');
      } else {
        setCameraError(
          'Không thể khởi động camera. Vui lòng thử lại hoặc chọn cách đọc mã vạch từ ảnh.'
        );
      }
    }
  }, [handleBarcodeDetected, loadScannerModule, selectedCameraId, stopCamera]);

  // Xử lý đổi camera
  const handleCameraChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedCameraId(newId);
    if (isCameraActive) {
      startCamera(newId);
    }
  };

  // Xử lý chuyển tab
  const handleTabChange = async (tab: ScannerTab) => {
    if (tab === activeTab) return;

    // Dừng camera nếu đang ở tab camera và chuyển sang tab khác
    if (activeTab === 'camera') {
      await stopCamera();
    }

    setActiveTab(tab);
    setCameraError(null);
    setFileError(null);

    // Focus input thủ công nếu chuyển sang tab manual
    if (tab === 'manual') {
      setTimeout(() => {
        manualInputRef.current?.focus();
      }, 100);
    }
  };

  // Xử lý đọc mã vạch từ file ảnh (Client-side 100%, không upload Storage)
  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setSelectedFileName(file.name);

    // 1. Kiểm tra định dạng
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setFileError('Chỉ chấp nhận file ảnh định dạng JPEG, PNG hoặc WebP.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // 2. Kiểm tra dung lượng
    if (file.size > MAX_IMAGE_SIZE) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      setFileError(`Dung lượng ảnh (${sizeMb} MB) vượt quá giới hạn cho phép là 5 MB.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Dừng camera nếu có
    await stopCamera();

    setIsScanningFile(true);

    try {
      const { Html5Qrcode, formatsToSupport } = await loadScannerModule();

      // Tạo instance tạm thời để scan file
      const tempScanner = new Html5Qrcode('barcode-file-temp', {
        formatsToSupport,
        verbose: false,
      });

      const decodedText = await tempScanner.scanFile(file, true);
      tempScanner.clear();

      if (!isMountedRef.current) return;

      setIsScanningFile(false);
      handleBarcodeDetected(decodedText);
    } catch {
      if (!isMountedRef.current) return;
      setIsScanningFile(false);
      setFileError(
        'Không tìm thấy mã vạch hợp lệ trong ảnh này. Vui lòng chọn ảnh chụp rõ nét, đủ ánh sáng hoặc nhập mã thủ công.'
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Xử lý nhập mã vạch thủ công
  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    handleBarcodeDetected(code);
  };

  // Quét lại / Nhập mã khác
  const handleResetScan = () => {
    setScannedBarcode(null);
    setFoundProduct(null);
    setSearchError(null);
    setIsProductNotFound(false);
    setSelectedFileName(null);
    setManualCode('');
    isProcessedRef.current = false;

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Nếu đang ở tab camera, có thể tự động bật lại camera
    if (activeTab === 'camera') {
      startCamera();
    }
  };

  // Đóng modal an toàn
  const handleClose = useCallback(async () => {
    await stopCamera();
    onClose();
    if (triggerElementRef?.current) {
      triggerElementRef.current.focus();
    }
  }, [onClose, stopCamera, triggerElementRef]);

  // Phím Escape
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  };

  // Quản lý unmount và đóng modal
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  // Focus nút đóng khi mở modal
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  if (!isOpen) {
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
        className="modal-content barcode-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="modal-header">
          <div>
            <h2 id="barcode-modal-title" className="modal-title">
              Quét mã vạch sản phẩm
            </h2>
            <p className="modal-subtitle">
              Tra cứu nhanh sản phẩm qua camera, ảnh chụp hoặc nhập mã
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Đóng cửa sổ quét mã"
          >
            ✕
          </button>
        </div>

        {/* Khung ẩn tạm thời để Html5Qrcode quét file ảnh */}
        <div id="barcode-file-temp" style={{ display: 'none' }} aria-hidden="true"></div>

        {/* KẾT QUẢ QUÉT / TÌM KIẾM */}
        {scannedBarcode ? (
          <div className="scanner-result-section">
            <div className="scanner-result-header">
              <span className="scanner-result-label">Mã vạch đã đọc:</span>
              <code className="scanner-barcode-badge">{scannedBarcode}</code>
            </div>

            {/* Trạng thái đang tra cứu */}
            {isSearchingProduct && (
              <div className="state-panel loading-panel">
                <div className="loading-spinner small" aria-hidden="true"></div>
                <span>Đang tra cứu thông tin sản phẩm trong kho...</span>
              </div>
            )}

            {/* Lỗi tra cứu */}
            {searchError && !isSearchingProduct && (
              <div className="state-panel error-panel">
                <p>{searchError}</p>
                <div className="scanner-action-row">
                  <button
                    type="button"
                    className="btn-retry"
                    onClick={() => handleBarcodeDetected(scannedBarcode)}
                  >
                    Thử lại
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleResetScan}
                  >
                    Quét mã khác
                  </button>
                </div>
              </div>
            )}

            {/* Không tìm thấy sản phẩm */}
            {isProductNotFound && !isSearchingProduct && !searchError && (
              <div className="scanner-not-found-card">
                <div className="scanner-not-found-icon" aria-hidden="true">
                  📦
                </div>
                <h3 className="scanner-not-found-title">
                  Chưa có sản phẩm mang mã {scannedBarcode}
                </h3>
                <p className="scanner-not-found-desc">
                  Mã vạch này chưa được gán cho mặt hàng nào trong danh mục kho gia đình.
                </p>
                <div className="scanner-action-row">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleResetScan}
                  >
                    Quét lại hoặc nhập mã khác
                  </button>
                </div>
              </div>
            )}

            {/* Tìm thấy sản phẩm */}
            {foundProduct && !isSearchingProduct && (
              <div className="scanner-found-card">
                <div className="scanner-product-preview">
                  <div className="scanner-product-image-container">
                    <ProductImage
                      storagePath={foundProduct.imageUrl}
                      alt={foundProduct.name}
                      className="scanner-product-img"
                    />
                    {foundProduct.stock <= 0 && (
                      <span className="out-of-stock-badge">Hết hàng</span>
                    )}
                  </div>
                  <div className="scanner-product-info">
                    <span className="scanner-product-category">{foundProduct.category}</span>
                    <h3 className="scanner-product-name">{foundProduct.name}</h3>
                    <div className="scanner-product-codes">
                      <span>Mã hàng: <code>{foundProduct.code}</code></span>
                    </div>

                    <div className="scanner-product-prices">
                      <div className="price-item">
                        <span className="price-label">Giá nhập:</span>
                        <span>{formatCurrency(foundProduct.purchasePrice)}</span>
                      </div>
                      <div className="price-item">
                        <span className="price-label">Giá bán:</span>
                        <strong className="price-amount highlight">
                          {formatCurrency(foundProduct.salePrice)}
                        </strong>
                      </div>
                    </div>

                    <div className="scanner-product-stock">
                      <span className="stock-label">Tồn kho:</span>
                      <span
                        className={`stock-badge ${
                          foundProduct.stock <= 0 ? 'stock-empty' : 'stock-available'
                        }`}
                      >
                        <span className="stock-dot" aria-hidden="true"></span>
                        {foundProduct.stock} {foundProduct.unit}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="scanner-action-row">
                  {onSelectProduct && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        onSelectProduct(foundProduct);
                        handleClose();
                      }}
                    >
                      Xem trong danh sách
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleResetScan}
                  >
                    Quét mã khác
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* NỘI DUNG 3 TAB KHI CHƯA CÓ KẾT QUẢ QUÉT */
          <div className="scanner-body">
            {/* Tabs Điều hướng */}
            <div className="scanner-tab-bar" role="tablist" aria-label="Chế độ quét mã vạch">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'camera'}
                className={`scanner-tab-btn ${activeTab === 'camera' ? 'is-active' : ''}`}
                onClick={() => handleTabChange('camera')}
              >
                📷 Dùng camera
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'file'}
                className={`scanner-tab-btn ${activeTab === 'file' ? 'is-active' : ''}`}
                onClick={() => handleTabChange('file')}
              >
                🖼️ Chọn ảnh có mã vạch
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'manual'}
                className={`scanner-tab-btn ${activeTab === 'manual' ? 'is-active' : ''}`}
                onClick={() => handleTabChange('manual')}
              >
                ⌨️ Nhập mã thủ công
              </button>
            </div>

            {/* TAB 1: DÙNG CAMERA */}
            {activeTab === 'camera' && (
              <div className="scanner-tab-content">
                {/* Lựa chọn đổi Camera nếu có nhiều camera */}
                {availableCameras.length > 1 && isCameraActive && (
                  <div className="camera-select-wrapper">
                    <label htmlFor="camera-select" className="camera-select-label">
                      Đổi camera:
                    </label>
                    <select
                      id="camera-select"
                      className="camera-select"
                      value={selectedCameraId}
                      onChange={handleCameraChange}
                    >
                      {availableCameras.map((cam) => (
                        <option key={cam.id} value={cam.id}>
                          {cam.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Khung ngắm Camera */}
                <div className="scanner-viewport-wrapper">
                  <div id={SCANNER_CONTAINER_ID} className="scanner-viewport"></div>

                  {!isCameraActive && !isCameraLoading && !cameraError && (
                    <div className="camera-idle-placeholder">
                      <div className="camera-idle-icon" aria-hidden="true">
                        📷
                      </div>
                      <p className="camera-idle-text">
                        Camera chưa bật. Bấm nút bên dưới để cấp quyền và bắt đầu quét mã vạch.
                      </p>
                      <button
                        type="button"
                        className="btn-primary camera-start-btn"
                        onClick={() => startCamera()}
                      >
                        Bắt đầu quét bằng camera
                      </button>
                    </div>
                  )}

                  {isCameraLoading && (
                    <div className="camera-loading-overlay">
                      <div className="loading-spinner small" aria-hidden="true"></div>
                      <span>Đang khởi động camera...</span>
                    </div>
                  )}

                  {isCameraActive && (
                    <div className="scanner-guide-overlay" aria-hidden="true">
                      <div className="scanner-target-box">
                        <div className="scanner-laser-line"></div>
                      </div>
                      <p className="scanner-guide-text">
                        Đặt mã vạch (EAN/UPC/Code-128) vào giữa khung hình
                      </p>
                    </div>
                  )}
                </div>

                {/* Thông báo lỗi Camera */}
                {cameraError && (
                  <div className="modal-alert-error" role="alert">
                    <span className="alert-icon" aria-hidden="true">⚠️</span>
                    <div className="alert-content">
                      <p>{cameraError}</p>
                      <button
                        type="button"
                        className="btn-text-action"
                        onClick={() => startCamera()}
                      >
                        Thử lại
                      </button>
                    </div>
                  </div>
                )}

                {isCameraActive && (
                  <div className="scanner-control-bar">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={stopCamera}
                    >
                      Tạm dừng camera
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: CHỌN ẢNH CÓ MÃ VẠCH */}
            {activeTab === 'file' && (
              <div className="scanner-tab-content">
                <div className="file-scan-card">
                  <div className="file-scan-icon" aria-hidden="true">
                    🖼️
                  </div>
                  <h3 className="file-scan-title">Đọc mã từ ảnh trên thiết bị</h3>
                  <p className="file-scan-desc">
                    Chọn ảnh có chứa mã vạch (hỗ trợ JPEG, PNG, WebP, tối đa 5 MB). Ảnh được xử lý trực tiếp trên máy của bạn, không tải lên mạng.
                  </p>

                  <input
                    ref={fileInputRef}
                    id="barcode-image-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="file-input-hidden"
                    onChange={handleFileSelect}
                    disabled={isScanningFile}
                  />

                  <label
                    htmlFor="barcode-image-file-input"
                    className={`btn-primary file-picker-label ${
                      isScanningFile ? 'is-loading' : ''
                    }`}
                  >
                    {isScanningFile ? (
                      <span className="btn-loading-state">
                        <span className="spinner-dot" aria-hidden="true"></span>
                        Đang quét mã từ ảnh...
                      </span>
                    ) : selectedFileName ? (
                      `Đổi ảnh khác (${selectedFileName})`
                    ) : (
                      'Chọn ảnh có mã vạch'
                    )}
                  </label>

                  {fileError && (
                    <div className="modal-alert-error" role="alert">
                      <span className="alert-icon" aria-hidden="true">⚠️</span>
                      <p>{fileError}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: NHẬP MÃ THỦ CÔNG */}
            {activeTab === 'manual' && (
              <div className="scanner-tab-content">
                <form className="manual-barcode-form" onSubmit={handleManualSubmit}>
                  <div className="form-group">
                    <label htmlFor="manual-barcode-input" className="form-label">
                      Mã vạch sản phẩm
                    </label>
                    <input
                      ref={manualInputRef}
                      id="manual-barcode-input"
                      type="text"
                      className="text-input"
                      placeholder="Ví dụ: 8935001234567"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      autoComplete="off"
                    />
                    <span className="form-help-text">
                      Nhập đúng các chữ số trên mã vạch của sản phẩm (bao gồm cả số 0 ở đầu).
                    </span>
                  </div>

                  <button
                    type="submit"
                    className="btn-primary manual-submit-btn"
                    disabled={!manualCode.trim()}
                  >
                    Tìm sản phẩm
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BarcodeScannerModal;
