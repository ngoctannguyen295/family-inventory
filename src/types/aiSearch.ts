// Type definitions for AI Image Search feature
import type { Product } from './product';

export interface GeminiExtraction {
  product_name: string | null;
  brand: string | null;
  variant: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  visible_text: string[];
  readable: boolean;
  object_type?: string | null;
  visual_features?: string | null;
  visual_signature?: string | null;
  category_hint?: string | null;
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
  visual_description?: string | null;
}

export interface ProductMatchResult {
  product: ProductRecord;
  match_score: number;
  match_reasons: string[];
  matched_name?: boolean;
  matched_brand?: boolean;
  matched_variant?: boolean;
  matched_quantity?: boolean;
  matched_visual?: boolean;
  vector_similarity?: number;
}

export interface TimingMetadata {
  server_total_ms: number;
  gemini_ms: number;
  auth_ms?: number;
  db_ms?: number;
  quota_ms?: number;
  matching_ms?: number;
}

export interface AiSearchResponse {
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
  timing?: TimingMetadata;
}

export function mapProductRecordToProduct(record: ProductRecord): Product {
  return {
    id: record.id,
    code: record.code,
    barcode: record.barcode,
    name: record.name,
    category: record.category,
    unit: record.unit,
    imageUrl: record.image_url,
    purchasePrice: Number(record.purchase_price),
    salePrice: Number(record.sale_price),
    stock: Number(record.stock),
    notes: record.notes,
  };
}
