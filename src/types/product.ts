export interface Product {
  id: string;
  code: string;
  barcode: string;
  name: string;
  category: string;
  imageUrl: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  unit: string;
}

export type CategoryOption = string;
