import { supabase } from '../lib/supabase';
import type { Product } from '../types/product';
import type { ProductRow } from '../types/database';
import { mapProductRow } from '../types/database';

export interface CreateProductInput {
  code: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  notes?: string;
}

export interface UpdateProductInput {
  code: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  notes?: string;
  imageUrl?: string | null;
}

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
  duplicateField?: 'code' | 'barcode';
}

/**
 * Xử lý lỗi từ Supabase PostgreSQL để hiển thị thông báo tiếng Việt chính xác
 */
function parseSupabaseError(error: { code?: string; message: string; details?: string }): {
  message: string;
  duplicateField?: 'code' | 'barcode';
} {
  const combined = `${error.code || ''} ${error.message || ''} ${error.details || ''}`.toLowerCase();

  // 1. Trùng lặp khóa duy nhất (Unique constraint violation - 23505)
  if (error.code === '23505' || combined.includes('duplicate key') || combined.includes('unique constraint')) {
    if (combined.includes('products_code_key') || combined.includes('(code)')) {
      return {
        message: 'Mã hàng này đã tồn tại trên hệ thống. Vui lòng kiểm tra hoặc đổi mã khác.',
        duplicateField: 'code',
      };
    }
    if (combined.includes('products_barcode_key') || combined.includes('(barcode)')) {
      return {
        message: 'Mã vạch này đã được gán cho một sản phẩm khác.',
        duplicateField: 'barcode',
      };
    }
    return {
      message: 'Mã hàng hoặc mã vạch đã tồn tại trên hệ thống. Vui lòng kiểm tra lại.',
    };
  }

  // 2. Vi phạm quyền hạn RLS (Permission denied - 42501)
  if (error.code === '42501' || combined.includes('row-level security') || combined.includes('permission denied')) {
    return {
      message: 'Bạn không có quyền thực hiện thao tác này trên máy chủ.',
    };
  }

  // 3. Lỗi kiểm tra ràng buộc (Check constraint violation - 23514)
  if (error.code === '23514' || combined.includes('check constraint')) {
    if (combined.includes('products_purchase_price_positive')) {
      return { message: 'Giá nhập không được nhỏ hơn 0.' };
    }
    if (combined.includes('products_sale_price_positive')) {
      return { message: 'Giá bán không được nhỏ hơn 0.' };
    }
    if (combined.includes('products_stock_positive')) {
      return { message: 'Số lượng tồn kho không được nhỏ hơn 0.' };
    }
    return { message: 'Dữ liệu không thỏa mãn ràng buộc hợp lệ của hệ thống.' };
  }

  // 4. Lỗi kết nối mạng
  if (combined.includes('fetch') || combined.includes('network') || combined.includes('failed to fetch')) {
    return {
      message: 'Không thể kết nối đến máy chủ Supabase. Vui lòng kiểm tra mạng và thử lại.',
    };
  }

  return {
    message: error.message || 'Đã xảy ra lỗi không xác định khi lưu sản phẩm.',
  };
}

/**
 * Thêm mới một sản phẩm vào public.products bằng lệnh INSERT
 */
export async function createProduct(input: CreateProductInput): Promise<ServiceResult<Product>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

  const payload = {
    code: input.code.trim(),
    barcode: input.barcode && input.barcode.trim() !== '' ? input.barcode.trim() : null,
    name: input.name.trim(),
    category: input.category.trim(),
    unit: input.unit.trim(),
    image_url: null, // Chưa hỗ trợ upload ảnh, mặc định null
    purchase_price: input.purchasePrice,
    sale_price: input.salePrice,
    stock: input.stock,
    notes: input.notes ? input.notes.trim() : '',
  };

  try {
    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select()
      .single();

    if (error) {
      const parsed = parseSupabaseError(error);
      return { data: null, error: parsed.message, duplicateField: parsed.duplicateField };
    }

    if (!data) {
      return { data: null, error: 'Không nhận được dữ liệu phản hồi sau khi tạo.' };
    }

    return { data: mapProductRow(data as ProductRow), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi thêm sản phẩm.';
    return { data: null, error: message };
  }
}

/**
 * Cập nhật sản phẩm bằng lệnh UPDATE theo ID
 * Tuyệt đối không gửi id, created_at, updated_at trong payload
 */
export async function updateProduct(
  id: string,
  input: UpdateProductInput
): Promise<ServiceResult<Product>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

  // Chỉ gửi các trường nghiệp vụ được phép sửa; giữ nguyên image_url đang có
  const payload: Record<string, unknown> = {
    code: input.code.trim(),
    barcode: input.barcode && input.barcode.trim() !== '' ? input.barcode.trim() : null,
    name: input.name.trim(),
    category: input.category.trim(),
    unit: input.unit.trim(),
    purchase_price: input.purchasePrice,
    sale_price: input.salePrice,
    stock: input.stock,
    notes: input.notes ? input.notes.trim() : '',
  };

  if (input.imageUrl !== undefined) {
    payload.image_url = input.imageUrl;
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      const parsed = parseSupabaseError(error);
      return { data: null, error: parsed.message, duplicateField: parsed.duplicateField };
    }

    // UPDATE không trả về dòng phải coi là chưa lưu thành công (ví dụ bị RLS chặn hoặc ID không tồn tại)
    if (!data) {
      return {
        data: null,
        error: 'Cập nhật không thành công. Sản phẩm không tồn tại hoặc bạn không có quyền chỉnh sửa.',
      };
    }

    return { data: mapProductRow(data as ProductRow), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi cập nhật sản phẩm.';
    return { data: null, error: message };
  }
}
