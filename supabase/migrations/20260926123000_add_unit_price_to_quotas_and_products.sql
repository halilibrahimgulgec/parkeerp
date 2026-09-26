-- Migration: Add unit_price to customer_quotas and products for Smart Pricing Engine
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;
ALTER TABLE public.customer_quotas ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;

COMMENT ON COLUMN public.products.unit_price IS 'Fabrika standart liste birim satış fiyatı (TL)';
COMMENT ON COLUMN public.customer_quotas.unit_price IS 'Müşteri sözleşme/taahhüt özel birim fiyatı (TL)';
