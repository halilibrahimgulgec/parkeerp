-- Migration: Add unit_price and total_price to shipment_items for per-product pricing
ALTER TABLE public.shipment_items ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;
ALTER TABLE public.shipment_items ADD COLUMN IF NOT EXISTS total_price numeric DEFAULT 0;

COMMENT ON COLUMN public.shipment_items.unit_price IS 'Sevkiyattaki her bir ürün kaleminin birim satış fiyatı (TL)';
COMMENT ON COLUMN public.shipment_items.total_price IS 'Miktar x Birim Satış Fiyatı toplam satır tutarı (TL)';
