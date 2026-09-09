/**
 * Định dạng số tiền sang định dạng tiền tệ Việt Nam (ví dụ: 25.000 ₫)
 */
export function formatCurrency(amount: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
}

/**
 * Định dạng số lượng tồn kho: giữ tối đa 3 chữ số thập phân có nghĩa
 * Ví dụ: 2.500 -> 2.5, 10 -> 10, 0.125 -> 0.125
 */
export function formatStockQuantity(quantity: number | string): string {
  const num = Number(quantity);
  if (isNaN(num)) return String(quantity);
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 3,
  }).format(num);
}

/**
 * Định dạng ngày giờ chuẩn Việt Nam (múi giờ Asia/Ho_Chi_Minh)
 * Ví dụ: 15:30:45 10/09/2026
 */
export function formatVietnamDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Loại bỏ dấu tiếng Việt và chuyển chuỗi về chữ thường không dấu
 * Giúp tìm kiếm không phân biệt hoa thường và dấu tiếng Việt (ví dụ: "mi" tìm được "Mì", "sua" tìm được "Sữa")
 */
export function removeVietnameseTones(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

