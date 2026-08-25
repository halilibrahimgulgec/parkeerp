-- Add pallet_type column to shipment_items
ALTER TABLE public.shipment_items ADD COLUMN IF NOT EXISTS pallet_type text CHECK (pallet_type IN ('tahta', 'sevkiyat', 'uretim', 'dokme')) DEFAULT 'sevkiyat';
