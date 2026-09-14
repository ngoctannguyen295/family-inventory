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
  imageUrl?: string | null;
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
    message: error.message || 'Đã xảy ra lỗi không xác định khi thao tác dữ liệu.',
  };
}

/**
 * Kiểm tra xem mã hàng hoặc mã vạch có đang thuộc về một sản phẩm trong mục "Đã xóa" không
 */
export async function checkExistingDeletedDuplicate(
  code: string,
  barcode?: string | null
): Promise<{ inTrash: boolean; field?: 'code' | 'barcode'; productName?: string }> {
  if (!supabase) return { inTrash: false };

  try {
    // 1. Kiểm tra trùng code trong mục Đã xóa
    const trimmedCode = code.trim();
    if (trimmedCode) {
      const { data: codeMatch } = await supabase
        .from('products')
        .select('name, code')
        .eq('code', trimmedCode)
        .not('deleted_at', 'is', null)
        .maybeSingle();

      if (codeMatch) {
        return {
          inTrash: true,
          field: 'code',
          productName: codeMatch.name,
        };
      }
    }

    // 2. Kiểm tra trùng barcode trong mục Đã xóa
    const trimmedBarcode = barcode?.trim();
    if (trimmedBarcode) {
      const { data: barcodeMatch } = await supabase
        .from('products')
        .select('name, barcode')
        .eq('barcode', trimmedBarcode)
        .not('deleted_at', 'is', null)
        .maybeSingle();

      if (barcodeMatch) {
        return {
          inTrash: true,
          field: 'barcode',
          productName: barcodeMatch.name,
        };
      }
    }
  } catch {
    // Bỏ qua lỗi truy vấn phụ trợ
  }

  return { inTrash: false };
}

/**
 * Lấy danh sách sản phẩm đang sử dụng (deleted_at IS NULL)
 */
export async function fetchActiveProducts(): Promise<ServiceResult<Product[]>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      const parsed = parseSupabaseError(error);
      return { data: null, error: parsed.message };
    }

    const products = ((data as ProductRow[]) ?? []).map(mapProductRow);
    return { data: products, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi tải danh sách sản phẩm.';
    return { data: null, error: message };
  }
}

/**
 * Lấy danh sách sản phẩm đã xóa mềm (deleted_at IS NOT NULL)
 * Chỉ tài khoản có quyền can_edit mới được phép đọc theo chính sách RLS
 */
export async function fetchDeletedProducts(): Promise<ServiceResult<Product[]>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });

    if (error) {
      const parsed = parseSupabaseError(error);
      return { data: null, error: parsed.message };
    }

    const products = ((data as ProductRow[]) ?? []).map(mapProductRow);
    return { data: products, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi tải danh sách sản phẩm đã xóa.';
    return { data: null, error: message };
  }
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
    image_url: input.imageUrl && input.imageUrl.trim() !== '' ? input.imageUrl.trim() : null,
    purchase_price: input.purchasePrice,
    sale_price: input.salePrice,
    stock: input.stock,
    notes: input.notes ? input.notes.trim() : '',
    deleted_at: null,
  };

  try {
    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select()
      .single();

    if (error) {
      const parsed = parseSupabaseError(error);

      // Nếu vi phạm unique constraint, kiểm tra xem có đang trùng với sản phẩm trong mục Đã xóa không
      if (parsed.duplicateField) {
        const trashCheck = await checkExistingDeletedDuplicate(payload.code, payload.barcode);
        if (trashCheck.inTrash) {
          const fieldName = trashCheck.field === 'code' ? 'Mã hàng' : 'Mã vạch';
          return {
            data: null,
            error: `${fieldName} này đang thuộc về sản phẩm "${trashCheck.productName}" trong mục Đã xóa. Bạn có thể vào mục Đã xóa để khôi phục hoặc sử dụng mã khác.`,
            duplicateField: trashCheck.field,
          };
        }
      }

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
 */
export async function updateProduct(
  id: string,
  input: UpdateProductInput
): Promise<ServiceResult<Product>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

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
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      const parsed = parseSupabaseError(error);

      if (parsed.duplicateField) {
        const trashCheck = await checkExistingDeletedDuplicate(
          String(payload.code),
          payload.barcode ? String(payload.barcode) : null
        );
        if (trashCheck.inTrash) {
          const fieldName = trashCheck.field === 'code' ? 'Mã hàng' : 'Mã vạch';
          return {
            data: null,
            error: `${fieldName} này đang thuộc về sản phẩm "${trashCheck.productName}" trong mục Đã xóa. Bạn có thể vào mục Đã xóa để khôi phục hoặc sử dụng mã khác.`,
            duplicateField: trashCheck.field,
          };
        }
      }

      return { data: null, error: parsed.message, duplicateField: parsed.duplicateField };
    }

    if (!data) {
      return {
        data: null,
        error: 'Cập nhật không thành công. Sản phẩm không tồn tại, đã bị xóa hoặc bạn không có quyền chỉnh sửa.',
      };
    }

    return { data: mapProductRow(data as ProductRow), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi cập nhật sản phẩm.';
    return { data: null, error: message };
  }
}

/**
 * Xóa mềm sản phẩm (chuyển vào mục "Đã xóa")
 * Đặt deleted_at = now(). Chỉ áp dụng với sản phẩm đang sử dụng (deleted_at IS NULL).
 */
export async function softDeleteProduct(id: string): Promise<ServiceResult<Product>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('products')
      .update({ deleted_at: nowIso })
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      const parsed = parseSupabaseError(error);
      return { data: null, error: parsed.message };
    }

    // Nếu không có dòng nào được cập nhật:
    if (!data) {
      return {
        data: null,
        error: 'Không thể xóa sản phẩm. Sản phẩm không tồn tại, đã được chuyển vào mục Đã xóa trước đó hoặc bạn không có quyền thực hiện.',
      };
    }

    return { data: mapProductRow(data as ProductRow), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi xóa sản phẩm.';
    return { data: null, error: message };
  }
}

/**
 * Khôi phục sản phẩm từ mục "Đã xóa"
 * Đặt deleted_at = null. Chỉ áp dụng với sản phẩm đã bị xóa (deleted_at IS NOT NULL).
 */
export async function restoreProduct(id: string): Promise<ServiceResult<Product>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .update({ deleted_at: null })
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select()
      .maybeSingle();

    if (error) {
      const parsed = parseSupabaseError(error);
      return { data: null, error: parsed.message };
    }

    if (!data) {
      return {
        data: null,
        error: 'Không thể khôi phục sản phẩm. Sản phẩm không tồn tại, chưa từng bị xóa hoặc bạn không có quyền thực hiện.',
      };
    }

    return { data: mapProductRow(data as ProductRow), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối khi khôi phục sản phẩm.';
    return { data: null, error: message };
  }
}

/**
 * Tìm kiếm sản phẩm theo mã vạch khớp chính xác từ Supabase public.products
 * Chỉ tìm kiếm trong các sản phẩm đang sử dụng (deleted_at IS NULL).
 */
export async function findProductByBarcode(
  rawBarcode: string
): Promise<ServiceResult<Product>> {
  if (!supabase) {
    return { data: null, error: 'Chưa cấu hình kết nối Supabase.' };
  }

  const barcode = rawBarcode.trim();
  if (!barcode) {
    return { data: null, error: 'Mã vạch không được để trống.' };
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', barcode)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      const parsed = parseSupabaseError(error);
      return { data: null, error: parsed.message };
    }

    if (!data) {
      return { data: null, error: null };
    }

    return { data: mapProductRow(data as ProductRow), error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Lỗi kết nối khi tìm sản phẩm theo mã vạch.';
    return { data: null, error: message };
  }
}
