export interface Product {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  category: string;
  imageUrl: string | null;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  unit: string;
  notes?: string;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type CategoryOption = string;

export type SortOption =
  | 'newest'
  | 'updated'
  | 'name_asc'
  | 'name_desc'
  | 'stock_asc'
  | 'stock_desc'
  | 'price_asc'
  | 'price_desc'
  | 'code_asc';

