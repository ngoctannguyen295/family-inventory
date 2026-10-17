import type { CartItem } from '../types/checkout';
import { formatCurrency } from './formatters.ts';

export interface CartTotals {
  totalQuantity: number;
  totalAmount: number;
  hasStockIssue: boolean;
}

/**
 * Tính toán tổng số lượng, tổng tiền và kiểm tra tính hợp lệ về tồn kho
 */
export function calculateCartTotals(items: CartItem[]): CartTotals {
  let totalQuantity = 0;
  let totalAmount = 0;
  let hasStockIssue = false;

  for (const item of items) {
    totalQuantity += item.quantity;
    totalAmount += item.quantity * item.salePrice;
    if (item.quantity > item.product.stock) {
      hasStockIssue = true;
    }
  }

  return { totalQuantity, totalAmount, hasStockIssue };
}

/**
 * Tính tiền thối lại cho khách hàng
 */
export function calculateChange(totalAmount: number, cashGiven: number): number {
  if (cashGiven <= 0 || cashGiven < totalAmount) {
    return 0;
  }
  return cashGiven - totalAmount;
}

/**
 * Tạo nội dung hóa đơn định dạng văn bản đẹp để gửi Zalo / SMS
 */
export function formatReceiptText(
  items: CartItem[],
  cashGiven: number = 0,
  dateStr?: string
): string {
  if (items.length === 0) return '';

  const timestamp =
    dateStr ||
    new Date().toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const { totalQuantity, totalAmount } = calculateCartTotals(items);
  const change = calculateChange(totalAmount, cashGiven);

  let receipt = `🧾 HÓA ĐƠN BÁN HÀNG - KHO GIA ĐÌNH\n`;
  receipt += `Thời gian: ${timestamp}\n`;
  receipt += `--------------------------------\n`;

  items.forEach((item, index) => {
    const lineSubtotal = item.quantity * item.salePrice;
    receipt += `${index + 1}. ${item.product.name}\n`;
    receipt += `   ${item.quantity} ${item.product.unit} x ${formatCurrency(item.salePrice)} = ${formatCurrency(lineSubtotal)}\n`;
  });

  receipt += `--------------------------------\n`;
  receipt += `TỔNG CỘNG (${totalQuantity} món): ${formatCurrency(totalAmount)}\n`;

  if (cashGiven > 0) {
    receipt += `Khách đưa: ${formatCurrency(cashGiven)}\n`;
    if (change > 0) {
      receipt += `Tiền thối lại: ${formatCurrency(change)}\n`;
    }
  }

  receipt += `--------------------------------\n`;
  receipt += `Cảm ơn quý khách và hẹn gặp lại! 🙏`;

  return receipt;
}
