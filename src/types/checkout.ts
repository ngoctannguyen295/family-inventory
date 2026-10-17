import type { Product } from './product';

export interface CartItem {
  productId: string;
  product: Product;
  quantity: number;
  salePrice: number;
}

export interface CheckoutResult {
  success: boolean;
  updatedProducts: Product[];
  totalAmount: number;
  totalQuantity: number;
  error?: string;
}
