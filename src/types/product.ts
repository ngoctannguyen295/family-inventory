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
}

export type CategoryOption = string;
