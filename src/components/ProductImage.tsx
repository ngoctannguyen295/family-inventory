import { useState, useEffect } from 'react';
import { loadProductImageObjectUrl } from '../services/storageService';

interface ProductImageProps {
  storagePath: string | null | undefined;
  alt: string;
  className?: string;
  placeholderSrc?: string;
  loading?: 'lazy' | 'eager';
}

const DEFAULT_PLACEHOLDER = '/products/default-placeholder.svg';

export function ProductImage({
  storagePath,
  alt,
  className = '',
  placeholderSrc = DEFAULT_PLACEHOLDER,
  loading = 'lazy',
}: ProductImageProps) {
  const trimmedPath = storagePath ? storagePath.trim() : '';

  // Quản lý state đồng bộ theo prop storagePath (React pattern: adjusting state during render)
  const [prevPath, setPrevPath] = useState(trimmedPath);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(trimmedPath));
  const [hasError, setHasError] = useState<boolean>(false);

  if (prevPath !== trimmedPath) {
    setPrevPath(trimmedPath);
    setImageUrl(null);
    setIsLoading(Boolean(trimmedPath));
    setHasError(false);
  }

  useEffect(() => {
    if (!trimmedPath) return;

    let isMounted = true;

    loadProductImageObjectUrl(trimmedPath)
      .then((url) => {
        if (!isMounted) return;

        if (url) {
          setImageUrl(url);
          setHasError(false);
        } else {
          setImageUrl(null);
          setHasError(true);
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setImageUrl(null);
        setHasError(true);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [trimmedPath]);

  // Nếu không có path, hoặc đang lỗi, hoặc chưa có imageUrl -> Dùng ảnh placeholder
  const displaySrc = !trimmedPath || hasError || !imageUrl ? placeholderSrc : imageUrl;
  const showLoading = Boolean(trimmedPath && isLoading && !imageUrl && !hasError);

  return (
    <div className={`product-image-wrapper ${showLoading ? 'is-loading' : ''}`}>
      {showLoading && (
        <div className="product-image-skeleton" aria-hidden="true">
          <span className="spinner-dot small" aria-hidden="true"></span>
        </div>
      )}
      <img
        src={displaySrc}
        alt={alt}
        className={`${className} ${showLoading ? 'image-hidden' : 'image-visible'}`}
        loading={loading}
        onError={() => {
          setHasError(true);
        }}
      />
    </div>
  );
}
