/**
 * Định dạng số tiền sang định dạng tiền tệ Việt Nam (ví dụ: 25.000 ₫)
 */
export function formatCurrency(amount: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
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
