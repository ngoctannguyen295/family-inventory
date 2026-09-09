import { supabase } from '../lib/supabase';
import type { ProductHistoryEntry, ProductHistoryRow } from '../types/history';
import { mapProductHistoryRow } from '../types/history';

export const HISTORY_PAGE_SIZE = 20;

export interface HistoryFetchResult {
  data: ProductHistoryEntry[];
  hasMore: boolean;
  error: string | null;
}

/**
 * Tải danh sách lịch sử thay đổi của một sản phẩm từ Supabase
 * Sắp xếp theo thời gian mới nhất (changed_at DESC, id DESC)
 * Phân trang 20 bản ghi mỗi lần
 */
export async function getProductHistory(
  productId: string,
  page: number = 0,
  pageSize: number = HISTORY_PAGE_SIZE
): Promise<HistoryFetchResult> {
  if (!supabase) {
    return { data: [], hasMore: false, error: 'Chưa kết nối Supabase.' };
  }

  const trimmedId = productId.trim();
  if (!trimmedId) {
    return { data: [], hasMore: false, error: 'Mã định danh sản phẩm không hợp lệ.' };
  }

  const offset = page * pageSize;

  try {
    // Lấy pageSize + 1 phần tử để xác định chính xác có còn trang tiếp theo hay không
    const { data, error } = await supabase
      .from('product_history')
      .select('*')
      .eq('product_id', trimmedId)
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize);

    if (error) {
      return {
        data: [],
        hasMore: false,
        error: `Không thể tải lịch sử sản phẩm: ${error.message}`,
      };
    }

    const rows = (data as ProductHistoryRow[]) || [];
    const hasMore = rows.length > pageSize;
    const paginatedRows = hasMore ? rows.slice(0, pageSize) : rows;

    const mapped = paginatedRows.map(mapProductHistoryRow);

    return {
      data: mapped,
      hasMore,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lỗi kết nối khi tải lịch sử sản phẩm.';
    return {
      data: [],
      hasMore: false,
      error: msg,
    };
  }
}
