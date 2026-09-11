-- ================================================================
-- SEVKİYATLAR TABLOSUNA TEDARİKÇİ (DIŞ FABRİKA) ALANI EKLEME
-- ================================================================

-- 1. shipments tablosuna supplier_name sütununu ekleme
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS supplier_name text DEFAULT NULL;

-- 2. external_purchases tablosuyla ilişkili mevcut sevkiyatları otomatik doldurma
UPDATE public.shipments s
SET supplier_name = ep.supplier_name
FROM public.external_purchases ep
WHERE ep.linked_shipment_id = s.id;

-- 3. Not alanında 'Tedarikçi: ...' geçen geçmiş transit kayıtlarını doldurma
UPDATE public.shipments
SET supplier_name = trim(substring(notes from 'Tedarikçi:\s*([^)\—\-]+)'))
WHERE supplier_name IS NULL AND notes ILIKE '%Tedarikçi:%';

-- İndeks
CREATE INDEX IF NOT EXISTS idx_shipments_supplier_name ON public.shipments(supplier_name);
