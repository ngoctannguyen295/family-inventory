import type { Product } from './product';

export interface FamilyMember {
  user_id: string;
  display_name: string;
  can_edit: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ProductRow {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  image_url: string | null;
  purchase_price: number | string;
  sale_price: number | string;
  stock: number | string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    code: row.code,
    barcode: row.barcode,
    name: row.name,
    category: row.category,
    unit: row.unit,
    imageUrl: row.image_url,
    purchasePrice: Number(row.purchase_price),
    salePrice: Number(row.sale_price),
    stock: Number(row.stock),
    notes: row.notes,
  };
}
