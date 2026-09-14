import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import type { Product } from '../types/product';
import type { AiSearchResponse, ProductMatchResult } from '../types/aiSearch';
import { mapProductRecordToProduct } from '../types/aiSearch';
import {
  searchProductByImage,
  validateImageFileClient,
} from '../services/aiSearchService';
import { compressImageClient } from '../utils/imageCompressor';
import { parseCameraError, type ParsedCameraErrorInfo } from '../utils/barcodeScannerController';
import { requestCameraLock, releaseCameraLock } from '../utils/cameraCoordinator';
import { formatCurrency } from '../utils/formatters';
import { ProductImage } from './ProductImage';

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct?: (product: Product) => void;
  triggerElementRef?: RefObject<HTMLElement | null>;
  isOnline?: boolean;
}

type ViewMode = 'camera' | 'preview' | 'results';

export function ImageSearchModal({
  isOpen,
  onClose,
  onSelectProduct,
  triggerElementRef,
  isOnline = true,
}: ImageSearchModalProps) {
  // Trạng thái màn hình hiện tại
  const [viewMode, setViewMode] = useState<ViewMode>('camera');

  // Trạng thái Camera
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<ParsedCameraErrorInfo | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [currentFacingMode, setCurrentFacingMode] = useState<'environment' | 'user'>('environment');
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);

  // Trạng thái file ảnh được chọn / chụp
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Trạng thái tìm kiếm API
  const [isSearching, setIsSearching] = useState(false);
  const [searchStep, setSearchStep] = useState<'idle' | 'optimizing' | 'analyzing' | 'matching'>('idle');
  const [searchResponse, setSearchResponse] = useState<AiSearchResponse | null>(null);
  const [searchError, setSearchError] = useState<{
    message: string;
    status?: number;
    retryAfterSeconds?: number;
  } | null>(null);

  // Refs quản lý vòng đời và camera
  const isMountedRef = useRef(true);
  const cameraSessionIdRef = useRef(0);
  const activeRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  // Giữ đồng bộ previewUrlRef để thu hồi an toàn
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

  // Dừng toàn bộ camera tracks và giải phóng cameraCoordinator
  const stopCamera = useCallback(() => {
    cameraSessionIdRef.current++;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.enabled = false;
          track.stop();
        } catch {
          // Bỏ qua lỗi dừng track
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsTorchOn(false);
    setSupportsTorch(false);
    releaseCameraLock('image-search');
  }, []);

  // Bật camera với quản lý phiên chặt chẽ
  const startCamera = useCallback(async (facing: 'environment' | 'user' = 'environment') => {
    stopCamera();
    const sessionId = ++cameraSessionIdRef.current;
    setIsCameraStarting(true);
    setCameraError(null);

    // Kiểm tra hỗ trợ getUserMedia
    if (!navigator?.mediaDevices?.getUserMedia) {
      setIsCameraStarting(false);
      setCameraError(parseCameraError(new Error('navigator.mediaDevices.getUserMedia is not supported')));
      return;
    }

    // Yêu cầu khóa camera toàn cục qua cameraCoordinator
    await requestCameraLock('image-search');

    if (cameraSessionIdRef.current !== sessionId || !isMountedRef.current) {
      releaseCameraLock('image-search');
      return;
    }

    try {
      // 1. Kiểm tra số lượng camera
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length > 1);
      } catch {
        // Bỏ qua lỗi enumerateDevices
      }

      // 2. Yêu cầu mở camera với facingMode ưu tiên
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch {
        // Thử lại với constraint cơ bản
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
      }

      // Nếu người dùng đã đóng modal hoặc đổi chế độ trong khi camera đang khởi động, dừng stream muộn ngay lập tức
      if (cameraSessionIdRef.current !== sessionId || !isMountedRef.current) {
        stream.getTracks().forEach((t) => {
          try {
            t.enabled = false;
            t.stop();
          } catch {
            // Bỏ qua lỗi dừng track khi unmount
          }
        });
        releaseCameraLock('image-search');
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.muted = true;
        videoRef.current.play().catch((playErr) => {
          console.warn('[IMAGE_SEARCH_VIDEO_PLAY_ERROR]', playErr);
        });
      }

      // Kiểm tra hỗ trợ đèn pin (torch)
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = (track as unknown as { getCapabilities?: () => { torch?: boolean } }).getCapabilities?.();
          if (capabilities && capabilities.torch) {
            setSupportsTorch(true);
          }
        } catch {
          // Bỏ qua lỗi kiểm tra torch
        }
      }

      setIsCameraStarting(false);
    } catch (err) {
      if (cameraSessionIdRef.current !== sessionId || !isMountedRef.current) {
        releaseCameraLock('image-search');
        return;
      }
      setIsCameraStarting(false);
      releaseCameraLock('image-search');

      const parsedError = parseCameraError(err);
      setCameraError(parsedError);
    }
  }, [stopCamera]);

  // Đổi camera trước / sau
  const handleSwitchCamera = useCallback(() => {
    const nextFacing = currentFacingMode === 'environment' ? 'user' : 'environment';
    setCurrentFacingMode(nextFacing);
    startCamera(nextFacing);
  }, [currentFacingMode, startCamera]);

  // Bật/tắt đèn pin (Flash)
  const handleToggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !supportsTorch) return;

    try {
      const nextState = !isTorchOn;
      await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setIsTorchOn(nextState);
    } catch {
      // Bỏ qua lỗi bật đèn pin
    }
  }, [isTorchOn, supportsTorch]);

  // Chụp ảnh từ khung hình video hiện tại
  const handleCapturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError(
        parseCameraError(new Error('Chưa nhận diện được khung hình camera. Vui lòng thử lại sau giây lát.'))
      );
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Nếu là camera trước thì lật ảnh cho đúng hướng mắt nhìn
      if (currentFacingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setCameraError(
              parseCameraError(new Error('Không thể tạo ảnh từ camera. Vui lòng chụp lại.'))
            );
            return;
          }

          const photoFile = new File([blob], `camera-scan-${Date.now()}.jpg`, {
            type: 'image/jpeg',
          });

          // Dọn preview cũ
          cleanupPreviewUrl();

          const url = URL.createObjectURL(photoFile);
          setSelectedFile(photoFile);
          setPreviewUrl(url);
          setFileError(null);
          setSearchError(null);
          setSearchResponse(null);

          // Dừng camera và chuyển sang màn hình xem trước
          stopCamera();
          setViewMode('preview');
        },
        'image/jpeg',
        0.92
      );
    } catch {
      setCameraError(
        parseCameraError(new Error('Lỗi trong quá trình chụp ảnh. Vui lòng thử lại.'))
      );
    }
  }, [cleanupPreviewUrl, currentFacingMode, stopCamera]);

  // Xử lý khi chọn file từ trình duyệt/thư viện hệ điều hành
  const handleSelectFile = useCallback(
    (file: File) => {
      setFileError(null);
      setSearchError(null);
      setSearchResponse(null);

      const validation = validateImageFileClient(file);
      if (!validation.valid) {
        setFileError(validation.errorMessage || 'File ảnh không hợp lệ.');
        return;
      }

      cleanupPreviewUrl();

      const newUrl = URL.createObjectURL(file);
      setSelectedFile(file);
      setPreviewUrl(newUrl);

      // Dừng camera và chuyển sang màn hình xem trước
      stopCamera();
      setViewMode('preview');
    },
    [cleanupPreviewUrl, stopCamera]
  );

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleSelectFile(files[0]);
    }
  };

  // Quay lại chế độ chụp ảnh
  const handleRetake = useCallback(() => {
    // Hủy request AI đang chạy nếu có
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSearching(false);
    setSearchStep('idle');
    cleanupPreviewUrl();
    setSelectedFile(null);
    setPreviewUrl(null);
    setFileError(null);
    setSearchError(null);
    setSearchResponse(null);
    setViewMode('camera');
    startCamera(currentFacingMode);
  }, [cleanupPreviewUrl, currentFacingMode, startCamera]);

  // Thực hiện tìm kiếm ảnh qua AI
  const handleExecuteSearch = useCallback(async () => {
    if (!selectedFile || isSearching) return;

    if (isOnline === false) {
      setSearchError({
        message: 'Đang mất kết nối mạng. Tính năng tìm kiếm bằng ảnh qua AI yêu cầu kết nối Internet.',
      });
      setViewMode('results');
      return;
    }

    // Hủy request trước đó nếu còn
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const searchStartTime = performance.now();
    setIsSearching(true);
    setSearchStep('optimizing');
    setSearchError(null);
    setSearchResponse(null);
    setViewMode('results');

    const currentRequestId = ++activeRequestIdRef.current;

    try {
      // 1. Bước 1: Nén và thu nhỏ ảnh trên máy khách (max 1600px, JPEG quality 0.85)
      const compressedResult = await compressImageClient(selectedFile);

      if (controller.signal.aborted || !isMountedRef.current || currentRequestId !== activeRequestIdRef.current) {
        return;
      }

      // 2. Bước 2: Gửi ảnh sang AI để nhận diện
      setSearchStep('analyzing');
      const result = await searchProductByImage(compressedResult.file, controller.signal);

      if (controller.signal.aborted || !isMountedRef.current || currentRequestId !== activeRequestIdRef.current) {
        return;
      }

      setIsSearching(false);
      setSearchStep('idle');

      const totalClientMs = Math.round(performance.now() - searchStartTime);

      if (!result.success || !result.data) {
        if (result.error === 'aborted') {
          return;
        }

        console.warn(
          `[CLIENT_AI_TIMING] FAILED reqId: ${currentRequestId} | compression: ${compressedResult.durationMs}ms | api_call: ${result.clientDurationMs}ms | total: ${totalClientMs}ms | error: ${result.message}`
        );

        setSearchError({
          message: result.message,
          status: result.status,
          retryAfterSeconds: result.retryAfterSeconds,
        });
        return;
      }

      console.log(
        `[CLIENT_AI_TIMING] reqId: ${currentRequestId} | compression: ${compressedResult.durationMs}ms | api_call: ${result.clientDurationMs}ms (server: ${result.data.timing?.server_total_ms}ms, gemini: ${result.data.timing?.gemini_ms}ms, auth: ${result.data.timing?.auth_ms}ms, db: ${result.data.timing?.db_ms}ms, quota: ${result.data.timing?.quota_ms}ms, matching: ${result.data.timing?.matching_ms}ms) | total: ${totalClientMs}ms`
      );

      setSearchResponse(result.data);
    } catch (err) {
      if (!isMountedRef.current || currentRequestId !== activeRequestIdRef.current) {
        return;
      }
      setIsSearching(false);
      setSearchStep('idle');
      const totalClientMs = Math.round(performance.now() - searchStartTime);
      const msg = err instanceof Error ? err.message : 'Đã xảy ra lỗi khi tìm kiếm.';
      console.warn(
        `[CLIENT_AI_TIMING] ERROR reqId: ${currentRequestId} after ${totalClientMs}ms: ${msg}`
      );
      setSearchError({ message: msg });
    }
  }, [isOnline, isSearching, selectedFile]);

  // Đóng modal hoàn toàn và giải phóng camera
  const handleClose = useCallback(() => {
    activeRequestIdRef.current++;
    cameraSessionIdRef.current++;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopCamera();
    releaseCameraLock('image-search');
    cleanupPreviewUrl();
    setSelectedFile(null);
    setPreviewUrl(null);
    setFileError(null);
    setIsSearching(false);
    setSearchStep('idle');
    setSearchResponse(null);
    setSearchError(null);
    setViewMode('camera');

    onClose();

    // Trả focus về trigger element
    if (triggerElementRef?.current) {
      setTimeout(() => {
        triggerElementRef.current?.focus();
      }, 50);
    }
  }, [cleanupPreviewUrl, onClose, stopCamera, triggerElementRef]);

  // Chọn sản phẩm mở modal chi tiết
  const handleProductCardClick = (product: Product) => {
    if (onSelectProduct) {
      onSelectProduct(product);
    }
  };

  // Quản lý đóng mở modal, scroll lock và khởi động camera
  useEffect(() => {
    isMountedRef.current = true;

    if (isOpen) {
      // Khóa cuộn trang chính để tránh cuộn nền trên điện thoại
      const scrollY = window.scrollY;
      const originalOverflow = document.body.style.overflow;
      const originalPosition = document.body.style.position;
      const originalTop = document.body.style.top;
      const originalWidth = document.body.style.width;

      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';

      // Khởi động camera không đồng bộ sau khi gắn kết màn hình
      const timerId = setTimeout(() => {
        if (isMountedRef.current) {
          void startCamera('environment');
        }
      }, 0);

      return () => {
        clearTimeout(timerId);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        isMountedRef.current = false;
        stopCamera();
        cleanupPreviewUrl();

        // Khôi phục cuộn trang
        document.body.style.overflow = originalOverflow;
        document.body.style.position = originalPosition;
        document.body.style.top = originalTop;
        document.body.style.width = originalWidth;
        window.scrollTo(0, scrollY);
      };
    }
  }, [cleanupPreviewUrl, isOpen, startCamera, stopCamera]);

  // Bắt phím Escape
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !isSearching) {
      e.preventDefault();
      handleClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={screenRef}
      className={`image-search-screen ${viewMode === 'camera' ? 'mode-camera' : 'mode-content'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Tìm sản phẩm bằng ảnh chụp bao bì"
      onKeyDown={handleKeyDown}
    >
      {/* Input file ẩn dùng trình chọn ảnh chuẩn của hệ điều hành */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        aria-hidden="true"
      />

      {/* =========================================================================
          MÀN HÌNH 1: CAMERA VIEWFINDER (Ảnh tham khảo 2)
          ========================================================================= */}
      {viewMode === 'camera' && (
        <div className="camera-screen-layout">
          {/* Thanh công cụ trên cùng */}
          <div className="camera-top-bar">
            <button
              type="button"
              className="camera-circle-btn btn-close-camera"
              onClick={handleClose}
              aria-label="Đóng máy ảnh"
              title="Đóng"
            >
              ✕
            </button>

            <div className="camera-top-actions">
              {/* Nút bật/tắt đèn pin nếu track hỗ trợ */}
              {supportsTorch && (
                <button
                  type="button"
                  className={`camera-circle-btn btn-torch ${isTorchOn ? 'is-active' : ''}`}
                  onClick={handleToggleTorch}
                  aria-label={isTorchOn ? 'Tắt đèn pin' : 'Bật đèn pin'}
                  title={isTorchOn ? 'Tắt đèn pin' : 'Bật đèn pin'}
                >
                  ⚡
                </button>
              )}

              {/* Nút đổi camera trước/sau nếu thiết bị có nhiều camera */}
              {hasMultipleCameras && (
                <button
                  type="button"
                  className="camera-circle-btn btn-switch-camera"
                  onClick={handleSwitchCamera}
                  aria-label="Đổi camera trước/sau"
                  title="Đổi camera"
                >
                  🔄
                </button>
              )}
            </div>
          </div>

          {/* Vùng xem trước Camera lớn */}
          <div className="camera-viewport-area">
            <video
              ref={videoRef}
              className={`camera-video-element ${currentFacingMode === 'user' ? 'mirror' : ''}`}
              autoPlay
              playsInline
              muted
            />

            {/* Trạng thái đang mở camera */}
            {isCameraStarting && (
              <div className="camera-state-overlay">
                <div className="loading-spinner" aria-hidden="true"></div>
                <span>Đang khởi động máy ảnh...</span>
              </div>
            )}

            {/* Trạng thái lỗi không mở được camera */}
            {cameraError && !isCameraStarting && (
              <div className="camera-error-overlay">
                <div className="camera-error-icon" aria-hidden="true">
                  📷
                </div>
                <h3 className="camera-error-title">Không thể truy cập máy ảnh</h3>
                <p className="camera-error-desc">{cameraError.friendlyMessage}</p>
                {cameraError.rawName && (
                  <small
                    className="camera-error-detail"
                    style={{
                      display: 'block',
                      marginBottom: '12px',
                      opacity: 0.85,
                      fontSize: '0.8rem',
                      color: 'rgba(255, 255, 255, 0.8)',
                    }}
                  >
                    Mã lỗi kỹ thuật: <code>{cameraError.rawName}</code>
                  </small>
                )}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn-select-library-large"
                    onClick={() => {
                      setCameraError(null);
                      void startCamera(currentFacingMode);
                    }}
                  >
                    🔄 Thử lại máy ảnh
                  </button>
                  <button
                    type="button"
                    className="btn-select-library-large"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📁 Chọn ảnh từ thư viện
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Thanh điều khiển chụp ảnh ở đáy */}
          <div className="camera-bottom-bar">
            {!cameraError && (
              <p className="camera-shutter-hint" aria-hidden="true">
                Nhấn vào nút để tìm kiếm
              </p>
            )}

            <div className="camera-shutter-row">
              {/* Nút chụp tròn lớn viền đôi màu trắng */}
              <button
                type="button"
                className="camera-shutter-btn"
                onClick={handleCapturePhoto}
                disabled={Boolean(cameraError) || isCameraStarting}
                aria-label="Chụp ảnh bao bì để tìm kiếm"
                title="Chụp ảnh"
              >
                <span className="shutter-inner-circle"></span>
              </button>
            </div>

            {/* Khu vực chọn ảnh từ thư viện thiết bị */}
            <div className="camera-library-row">
              <button
                type="button"
                className="btn-open-library"
                onClick={() => fileInputRef.current?.click()}
                title="Mở trình chọn ảnh của thiết bị"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
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
                <span>Tìm trong thư viện</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MÀN HÌNH 2: XEM LẠI ẢNH VỪA CHỤP / CHỌN TRƯỚC KHI TÌM
          ========================================================================= */}
      {viewMode === 'preview' && (
        <div className="preview-screen-layout">
          {/* Header */}
          <div className="screen-header">
            <button
              type="button"
              className="btn-header-back"
              onClick={handleRetake}
              aria-label="Quay lại chụp ảnh"
            >
              ← Quay lại
            </button>
            <h2 className="screen-title">Xem lại ảnh bao bì</h2>
            <button
              type="button"
              className="modal-close-btn"
              onClick={handleClose}
              aria-label="Đóng"
            >
              ✕
            </button>
          </div>

          <div className="screen-body preview-screen-body">
            {/* Ảnh xem trước lớn */}
            <div className="preview-image-box">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Ảnh bao bì đã chụp/chọn"
                  className="preview-photo"
                />
              )}
            </div>

            {fileError && (
              <div className="modal-alert-error" role="alert">
                <span className="alert-icon" aria-hidden="true">⚠️</span>
                <p>{fileError}</p>
              </div>
            )}

            {/* Thẻ minh bạch công nghệ Gemini */}
            <div className="gemini-transparency-card">
              <div className="gemini-icon" aria-hidden="true">
                ✨
              </div>
              <div className="gemini-content">
                <strong>Tìm kiếm bằng Google Gemini:</strong>
                <p>
                  Ảnh sẽ được gửi đến mô hình AI để nhận diện bao bì, trích xuất tên sản phẩm,
                  thương hiệu và dung tích, sau đó đối chiếu với các sản phẩm đang có trong kho gia đình.
                </p>
              </div>
            </div>

            {!isOnline && (
              <div className="modal-alert-warning" role="alert">
                <span className="alert-icon" aria-hidden="true">⚠️</span>
                <p>Đang mất kết nối mạng. Tính năng tìm ảnh qua AI yêu cầu kết nối Internet.</p>
              </div>
            )}

            {/* Các nút thao tác */}
            <div className="preview-actions-bar">
              <button
                type="button"
                className="btn-secondary btn-retake-action"
                onClick={handleRetake}
              >
                🔄 Chụp lại / Đổi ảnh
              </button>
              <button
                type="button"
                className="btn-primary btn-search-execute"
                onClick={handleExecuteSearch}
                disabled={!isOnline || isSearching}
              >
                {isSearching ? 'Đang tìm...' : '🔍 Tìm sản phẩm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MÀN HÌNH 3: KẾT QUẢ TÌM KIẾM THEO BỐ CỤC SHOPEE (Ảnh tham khảo 3)
          ========================================================================= */}
      {viewMode === 'results' && (
        <div className="results-screen-layout">
          {/* Thanh đầu Shopee-style: Nút quay lại, ảnh thumbnail, nút đổi ảnh, nút đóng */}
          <div className="shopee-results-header">
            <button
              type="button"
              className="btn-results-back"
              onClick={handleRetake}
              aria-label="Quay lại chụp ảnh mới"
              title="Quay lại chụp ảnh"
            >
              ←
            </button>

            {/* Thumbnail ảnh đã chụp/chọn */}
            <div className="results-query-thumb-box" onClick={handleRetake} title="Bấm để đổi ảnh khác">
              {previewUrl ? (
                <img src={previewUrl} alt="Ảnh truy vấn" className="results-query-thumb" />
              ) : (
                <span className="query-thumb-empty">📷</span>
              )}
            </div>

            {/* Thông tin trích xuất tóm tắt hoặc trạng thái */}
            <div className="results-query-meta">
              {isSearching ? (
                <span className="query-status-text">Đang nhận diện bao bì...</span>
              ) : searchResponse?.ai_extraction?.product_name ? (
                <div className="query-name-box">
                  <span className="query-product-name" title={searchResponse.ai_extraction.product_name}>
                    {searchResponse.ai_extraction.brand
                      ? `[${searchResponse.ai_extraction.brand}] `
                      : ''}
                    {searchResponse.ai_extraction.product_name}
                  </span>
                  {searchResponse.ai_extraction.quantity_value && (
                    <span className="query-product-qty">
                      {searchResponse.ai_extraction.quantity_value} {searchResponse.ai_extraction.quantity_unit}
                    </span>
                  )}
                </div>
              ) : (
                <span className="query-status-text">Kết quả tìm kiếm bao bì</span>
              )}
            </div>

            <button
              type="button"
              className="btn-change-photo-text"
              onClick={handleRetake}
            >
              Đổi ảnh
            </button>

            <button
              type="button"
              className="modal-close-btn"
              onClick={handleClose}
              aria-label="Đóng cửa sổ tìm kiếm"
            >
              ✕
            </button>
          </div>

          {/* Thân kết quả cuộn dọc được */}
          <div className="results-scroll-body">
            {/* TRẠNG THÁI ĐANG TÌM KIẾM THEO CÁC BƯỚC THỰC TẾ */}
            {isSearching && (
              <div className="search-loading-state">
                <div className="loading-spinner large" aria-hidden="true"></div>
                <h3 className="loading-title">
                  {searchStep === 'optimizing'
                    ? 'Đang chuẩn bị & tối ưu ảnh...'
                    : searchStep === 'analyzing'
                    ? 'Đang nhận diện bao bì qua AI...'
                    : 'Đang đối chiếu kho gia đình...'}
                </h3>
                <p className="loading-subtitle">
                  {searchStep === 'optimizing'
                    ? 'Tối ưu độ phân giải để mô hình AI đọc chữ rõ nhất và truyền tải nhanh nhất.'
                    : searchStep === 'analyzing'
                    ? 'Mô hình AI đang đọc tên thương mại, nhãn hiệu và thông số từ bao bì.'
                    : 'Đối chiếu thông tin bao bì với danh mục hàng hóa trong kho.'}
                </p>
              </div>
            )}

            {/* TRẠNG THÁI BÁO LỖI */}
            {searchError && !isSearching && (
              <div
                className={`search-error-card ${
                  searchError.status === 429 ? 'is-rate-limit' : ''
                }`}
                role="alert"
              >
                <div className="error-icon-box" aria-hidden="true">
                  {searchError.status === 429 ? '⏳' : '⚠️'}
                </div>
                <h3 className="error-title">
                  {searchError.status === 429
                    ? 'Đạt giới hạn lượt tìm kiếm'
                    : 'Không thể tìm kiếm sản phẩm'}
                </h3>
                <p className="error-message">{searchError.message}</p>
                {searchError.retryAfterSeconds && searchError.retryAfterSeconds > 0 && (
                  <p className="error-retry-time">
                    Vui lòng chờ khoảng <strong>{searchError.retryAfterSeconds}</strong> giây.
                  </p>
                )}
                <div className="error-actions-row">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleExecuteSearch}
                  >
                    Thử lại
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleRetake}
                  >
                    Chọn ảnh khác
                  </button>
                </div>
              </div>
            )}

            {/* TRẠNG THÁI KHÔNG NHẬN DIỆN ĐƯỢC BAO BÌ */}
            {searchResponse && !isSearching && searchResponse.recognized === false && (
              <div className="search-empty-card">
                <div className="empty-icon-box" aria-hidden="true">
                  🔍
                </div>
                <h3 className="empty-title">Chưa nhận diện rõ bao bì</h3>
                <p className="empty-desc">
                  {searchResponse.message ||
                    'Ảnh bị mờ, chói sáng hoặc không thấy rõ tên sản phẩm. Bạn vui lòng chụp lại rõ nét hơn.'}
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleRetake}
                >
                  📷 Chụp lại ảnh rõ nét hơn
                </button>
              </div>
            )}

            {/* TRẠNG THÁI KHÔNG CÓ HÀNG TRONG KHO */}
            {searchResponse &&
              !isSearching &&
              searchResponse.recognized === true &&
              (!searchResponse.matches || searchResponse.matches.length === 0) && (
                <div className="search-empty-card">
                  <div className="empty-icon-box" aria-hidden="true">
                    📦
                  </div>
                  <h3 className="empty-title">Không tìm thấy sản phẩm trong kho</h3>
                  <p className="empty-desc">
                    {searchResponse.message ||
                      'Đã nhận diện được bao bì nhưng trong kho gia đình chưa có sản phẩm nào phù hợp.'}
                  </p>
                  <div className="empty-actions-row">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleRetake}
                    >
                      Tìm với ảnh khác
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleClose}
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              )}

            {/* DANH SÁCH SẢN PHẨM KHỚP: LƯỚI 2 CỘT SHOPEE STYLE */}
            {searchResponse &&
              !isSearching &&
              searchResponse.matches &&
              searchResponse.matches.length > 0 && (
                <div className="shopee-results-container">
                  <div className="results-count-bar">
                    <span>
                      Gợi ý <strong>{searchResponse.matches.length}</strong> sản phẩm phù hợp trong kho:
                    </span>
                  </div>

                  <div className="shopee-product-grid">
                    {searchResponse.matches.map((item: ProductMatchResult) => {
                      const product = mapProductRecordToProduct(item.product);
                      const isOutOfStock = product.stock <= 0;

                      return (
                        <article
                          key={product.id}
                          className={`shopee-result-card ${isOutOfStock ? 'is-out-of-stock' : ''}`}
                          onClick={() => handleProductCardClick(product)}
                          tabIndex={0}
                          role="button"
                          aria-label={`Xem chi tiết ${product.name}, giá bán ${formatCurrency(product.salePrice)}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleProductCardClick(product);
                            }
                          }}
                        >
                          {/* Ảnh vuông chuẩn mua sắm aspect-ratio 1:1 */}
                          <div className="card-image-square">
                            <ProductImage
                              storagePath={product.imageUrl}
                              alt={product.name}
                              className="card-img"
                              loading="lazy"
                            />
                            <span className="card-category-tag">{product.category}</span>
                            {isOutOfStock && (
                              <span className="card-out-of-stock-tag">Hết hàng</span>
                            )}
                          </div>

                          {/* Chi tiết sản phẩm */}
                          <div className="card-info-box">
                            <h4 className="card-product-name" title={product.name}>
                              {product.name}
                            </h4>

                            <div className="card-code-row">
                              <span>Mã: <code>{product.code}</code></span>
                            </div>

                            {/* Giá bán nổi bật */}
                            <div className="card-price-row">
                              <span className="card-sale-price">
                                {formatCurrency(product.salePrice)}
                              </span>
                            </div>

                            {/* Giá nhập & tồn kho gọn gàng */}
                            <div className="card-stock-row">
                              <span className="card-stock-text">
                                Kho: <strong>{product.stock} {product.unit}</strong>
                              </span>
                              {item.match_score >= 70 ? (
                                <span className="card-match-badge match-high" title="Đối chiếu điểm cao">
                                  Khớp cao
                                </span>
                              ) : (
                                <span
                                  className="card-match-badge match-medium"
                                  title="Gợi ý phù hợp dựa trên tên và bao bì, cần xác nhận trước khi chọn"
                                >
                                  Gợi ý - cần xác nhận
                                </span>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ImageSearchModal;
