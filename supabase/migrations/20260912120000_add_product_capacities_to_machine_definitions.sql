-- ================================================================
-- Makine Tanımları Tablosuna Ürün Bazlı Kapasiteler (product_capacities JSONB)
-- ================================================================

ALTER TABLE public.machine_definitions
ADD COLUMN IF NOT EXISTS product_capacities jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.machine_definitions.product_capacities IS 'Makinede üretilen ürünlerin ürün ID bazlı 10 saatlik günlük baskı kapasiteleri: { [product_id]: capacity }';
