-- Migration: Dọn dẹp dứt điểm các overload RPC cũ tránh xung đột PostgREST
-- File: supabase/migrations/20260917000200_drop_stale_rpc_overloads.sql

BEGIN;

-- 1. Xóa overload cũ của claim_products_for_embedding_sync (1 tham số)
DROP FUNCTION IF EXISTS public.claim_products_for_embedding_sync(integer);

-- 2. Xóa các overload cũ của complete_product_embedding_sync (5 tham số và 9 tham số)
DROP FUNCTION IF EXISTS public.complete_product_embedding_sync(uuid, boolean, vector, text, text);
DROP FUNCTION IF EXISTS public.complete_product_embedding_sync(uuid, uuid, integer, boolean, vector, text, text, text, text);

COMMIT;
