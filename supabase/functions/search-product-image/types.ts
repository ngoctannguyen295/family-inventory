// Types for search-product-image Edge Function

export interface GeminiExtraction {
  product_name: string | null;
  brand: string | null;
  variant: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  visible_text: string[];
  readable: boolean;
}

export interface ProductRecord {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  image_url: string | null;
  purchase_price: number;
  sale_price: number;
  stock: number;
  notes: string;
}

export interface ProductMatchResult {
  product: ProductRecord;
  match_score: number;
  match_reasons: string[];
}

export interface QuotaCheckResult {
  allowed: boolean;
  status: number;
  error: string | null;
  message: string;
  remaining_minute?: number;
  remaining_day?: number;
  retry_after_seconds?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  message?: string;
  recognized?: boolean;
  ai_extraction?: GeminiExtraction | null;
  matches?: ProductMatchResult[];
  total_inventory_scanned?: number;
  inventory_limit_exceeded?: boolean;
  quota?: {
    remaining_minute: number;
    remaining_day: number;
  };
  data?: T;
}
