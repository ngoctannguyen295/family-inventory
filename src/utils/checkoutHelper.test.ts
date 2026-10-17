import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateCartTotals, calculateChange, formatReceiptText } from './checkoutHelper.ts';
import type { CartItem } from '../types/checkout.ts';
import type { Product } from '../types/product.ts';

const mockProduct1: Product = {
  id: 'prod-1',
  code: 'SP01',
  barcode: '893000000001',
  name: 'Củ sạc nhanh 20W',
  category: 'Điện tử',
  imageUrl: null,
  purchasePrice: 60000,
  salePrice: 120000,
  stock: 20,
  unit: 'cái',
};

const mockProduct2: Product = {
  id: 'prod-2',
  code: 'SP02',
  barcode: '893000000002',
  name: 'Cáp sạc Type-C',
  category: 'Điện tử',
  imageUrl: null,
  purchasePrice: 25000,
  salePrice: 50000,
  stock: 10,
  unit: 'dây',
};

describe('checkoutHelper - calculateCartTotals', () => {
  it('tính chính xác ví dụ người dùng: 10 cái sp1 + 5 cái sp2', () => {
    const items: CartItem[] = [
      { productId: mockProduct1.id, product: mockProduct1, quantity: 10, salePrice: mockProduct1.salePrice },
      { productId: mockProduct2.id, product: mockProduct2, quantity: 5, salePrice: mockProduct2.salePrice },
    ];

    const result = calculateCartTotals(items);
    // 10 * 120000 + 5 * 50000 = 1200000 + 250000 = 1450000
    assert.strictEqual(result.totalQuantity, 15);
    assert.strictEqual(result.totalAmount, 1450000);
    assert.strictEqual(result.hasStockIssue, false);
  });

  it('phát hiện khi số lượng trong giỏ vượt quá tồn kho', () => {
    const items: CartItem[] = [
      { productId: mockProduct2.id, product: mockProduct2, quantity: 15, salePrice: mockProduct2.salePrice }, // stock is 10
    ];

    const result = calculateCartTotals(items);
    assert.strictEqual(result.totalQuantity, 15);
    assert.strictEqual(result.hasStockIssue, true);
  });

  it('xử lý giỏ hàng trống an toàn', () => {
    const result = calculateCartTotals([]);
    assert.strictEqual(result.totalQuantity, 0);
    assert.strictEqual(result.totalAmount, 0);
    assert.strictEqual(result.hasStockIssue, false);
  });
});

describe('checkoutHelper - calculateChange', () => {
  it('tính tiền thối lại khi khách đưa nhiều hơn tổng tiền', () => {
    const change = calculateChange(1450000, 1500000);
    assert.strictEqual(change, 50000);
  });

  it('trả về 0 khi khách đưa đúng số tiền hoặc thiếu tiền', () => {
    assert.strictEqual(calculateChange(1450000, 1450000), 0);
    assert.strictEqual(calculateChange(1450000, 1000000), 0);
    assert.strictEqual(calculateChange(1450000, 0), 0);
  });
});

describe('checkoutHelper - formatReceiptText', () => {
  it('tạo hóa đơn dạng text đầy đủ thông tin để gửi Zalo', () => {
    const items: CartItem[] = [
      { productId: mockProduct1.id, product: mockProduct1, quantity: 10, salePrice: 120000 },
      { productId: mockProduct2.id, product: mockProduct2, quantity: 5, salePrice: 50000 },
    ];

    const text = formatReceiptText(items, 1500000, '18/10/2026 01:25');
    assert.ok(text.includes('HÓA ĐƠN BÁN HÀNG - KHO GIA ĐÌNH'));
    assert.ok(text.includes('18/10/2026 01:25'));
    assert.ok(text.includes('10 cái x 120.000 ₫ = 1.200.000 ₫'));
    assert.ok(text.includes('5 dây x 50.000 ₫ = 250.000 ₫'));
    assert.ok(text.includes('TỔNG CỘNG (15 món): 1.450.000 ₫'));
    assert.ok(text.includes('Khách đưa: 1.500.000 ₫'));
    assert.ok(text.includes('Tiền thối lại: 50.000 ₫'));
  });
});
