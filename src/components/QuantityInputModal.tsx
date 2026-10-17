import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { Product } from '../types/product';
import { formatCurrency } from '../utils/formatters';

interface QuantityInputModalProps {
  isOpen: boolean;
  product: Product | null;
  currentQuantity: number;
  onClose: () => void;
  onConfirm: (productId: string, newQuantity: number) => void;
}

export function QuantityInputModal({
  isOpen,
  product,
  currentQuantity,
  onClose,
  onConfirm,
}: QuantityInputModalProps) {
  const [val, setVal] = useState<string>(String(currentQuantity || 1));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setVal(String(currentQuantity > 0 ? currentQuantity : 1));
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, currentQuantity]);

  if (!isOpen || !product) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      onConfirm(product.id, parsed);
    }
    onClose();
  };

  const handlePreset = (num: number) => {
    setVal(String(num));
    onConfirm(product.id, num);
    onClose();
  };

  const handleAddPreset = (delta: number) => {
    const cur = parseInt(val, 10) || 0;
    const next = Math.max(1, cur + delta);
    setVal(String(next));
  };

  return (
    <div
      className="qty-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(8, 47, 73, 0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'checkoutFadeIn 0.15s ease-out',
      }}
    >
      <div
        className="qty-modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '360px',
          padding: '20px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#082f49', margin: 0 }}>
              Nhập số lượng bán
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '3px 0 0' }}>
              {product.name} ({product.unit})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '18px',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', color: '#475569' }}>
          <span>Tồn kho hiện có: </span>
          <strong style={{ color: product.stock > 0 ? '#16a34a' : '#dc2626' }}>
            {product.stock} {product.unit}
          </strong>
          <span> • Đơn giá: </span>
          <strong style={{ color: '#0284c7' }}>{formatCurrency(product.salePrice)}</strong>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => {
                const cur = parseInt(val, 10) || 1;
                if (cur > 1) setVal(String(cur - 1));
              }}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '10px',
                border: '1.5px solid #cbd5e1',
                background: '#f1f5f9',
                fontSize: '20px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              −
            </button>

            <input
              ref={inputRef}
              type="number"
              min="0"
              max={product.stock > 0 ? product.stock : 9999}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              style={{
                width: '120px',
                height: '44px',
                fontSize: '22px',
                fontWeight: 800,
                textAlign: 'center',
                border: '2px solid #0284c7',
                borderRadius: '10px',
                color: '#082f49',
                outline: 'none',
              }}
            />

            <button
              type="button"
              onClick={() => {
                const cur = parseInt(val, 10) || 0;
                setVal(String(cur + 1));
              }}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '10px',
                border: '1.5px solid #cbd5e1',
                background: '#f1f5f9',
                fontSize: '20px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              +
            </button>
          </div>

          {/* Các phím chọn nhanh số lượng */}
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handlePreset(1)}
              style={{ padding: '6px 12px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
            >
              1
            </button>
            <button
              type="button"
              onClick={() => handlePreset(5)}
              style={{ padding: '6px 12px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
            >
              5
            </button>
            <button
              type="button"
              onClick={() => handlePreset(10)}
              style={{ padding: '6px 12px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
            >
              10
            </button>
            <button
              type="button"
              onClick={() => handlePreset(20)}
              style={{ padding: '6px 12px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
            >
              20
            </button>
            <button
              type="button"
              onClick={() => handleAddPreset(5)}
              style={{ padding: '6px 10px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              title="Cộng thêm 5 vào số hiện tại"
            >
              +5
            </button>
            <button
              type="button"
              onClick={() => handleAddPreset(10)}
              style={{ padding: '6px 10px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              title="Cộng thêm 10 vào số hiện tại"
            >
              +10
            </button>
            {product.stock > 0 && (
              <button
                type="button"
                onClick={() => handlePreset(product.stock)}
                style={{ padding: '6px 12px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '6px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              >
                Hết ({product.stock})
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                height: '42px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontWeight: 600,
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Hủy
            </button>
            <button
              type="submit"
              style={{
                flex: 2,
                height: '42px',
                background: '#16a34a',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                color: '#ffffff',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)',
              }}
            >
              Xác nhận
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
