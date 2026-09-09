export type ProductHistoryAction = 'create' | 'update';

export interface ProductSnapshot {
  code?: string;
  barcode?: string | null;
  name?: string;
  category?: string;
  unit?: string;
  image_url?: string | null;
  purchase_price?: number | string;
  sale_price?: number | string;
  stock?: number | string;
  notes?: string;
}

export interface ProductHistoryRow {
  id: string;
  product_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  changed_at: string;
  old_values: ProductSnapshot | null;
  new_values: ProductSnapshot;
  changed_fields: string[];
}

export interface ProductHistoryEntry {
  id: string;
  productId: string;
  action: ProductHistoryAction;
  actorId: string | null;
  actorName: string;
  changedAt: string;
  oldValues: ProductSnapshot | null;
  newValues: ProductSnapshot;
  changedFields: string[];
}

export function mapProductHistoryRow(row: ProductHistoryRow): ProductHistoryEntry {
  return {
    id: row.id,
    productId: row.product_id,
    action: row.action === 'create' ? 'create' : 'update',
    actorId: row.actor_id,
    actorName: row.actor_name,
    changedAt: row.changed_at,
    oldValues: row.old_values,
    newValues: row.new_values,
    changedFields: row.changed_fields || [],
  };
}
