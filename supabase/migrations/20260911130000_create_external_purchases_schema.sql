-- ================================================================
-- DIŞ ALIM (SATIN ALMA) & TRANSİT SEVKIYAT ŞEMASI
-- ================================================================

-- 1. external_purchases Tablosu Oluşturma
CREATE TABLE IF NOT EXISTS public.external_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_name text NOT NULL,
  supplier_invoice_no text DEFAULT '',
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'm2' CHECK (unit IN ('m2', 'metre', 'adet')),
  pallets numeric DEFAULT 0,
  pallet_type text DEFAULT 'sevkiyat',
  unit_price numeric DEFAULT 0,
  total_price numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  vehicle_plate text DEFAULT '',
  driver_name text DEFAULT '',
  is_direct_shipment boolean NOT NULL DEFAULT false,
  linked_shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS Güvenlik Politikaları
ALTER TABLE public.external_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view external purchases" ON public.external_purchases;
CREATE POLICY "Authenticated users can view external purchases"
  ON public.external_purchases FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage external purchases" ON public.external_purchases;
CREATE POLICY "Authenticated users can manage external purchases"
  ON public.external_purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_external_purchases_product ON public.external_purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_external_purchases_date ON public.external_purchases(date);
CREATE INDEX IF NOT EXISTS idx_external_purchases_supplier ON public.external_purchases(supplier_name);

-- 2. v_product_stock Görünümünü Güncelleme (Fabrika Üretimi + Dış Alımlar - Sevkiyatlar)
CREATE OR REPLACE VIEW public.v_product_stock AS
SELECT 
  p.id AS product_id,
  p.name AS product_name,
  p.thickness,
  p.color,
  p.unit,
  p.min_stock_alert,
  (
    COALESCE((SELECT SUM(pe.net_m2) FROM public.production_entries pe WHERE pe.product_id = p.id), 0) +
    COALESCE((SELECT SUM(ep.quantity) FROM public.external_purchases ep WHERE ep.product_id = p.id), 0) -
    COALESCE((SELECT SUM(si.m2) FROM public.shipment_items si JOIN public.shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id AND s.status = 'completed'), 0)
  ) AS current_stock
FROM public.products p
WHERE p.is_active = true;

-- 3. Geçmiş Lot 111111 Kayıtlarını Üretimden Dış Alıma Taşıma (Geçmiş Temizliği)
INSERT INTO public.external_purchases (
  date,
  supplier_name,
  supplier_invoice_no,
  product_id,
  quantity,
  unit,
  pallets,
  notes,
  created_by,
  created_at
)
SELECT 
  pe.date,
  'Dış Fabrika (Eski Lot 111111)',
  pe.lot_number,
  pe.product_id,
  pe.net_m2,
  COALESCE(p.unit, 'm2'),
  pe.total_pallets,
  'Eski Lot 111111 üretim kaydından aktarıldı: ' || COALESCE(pe.notes, ''),
  pe.created_by,
  pe.created_at
FROM public.production_entries pe
JOIN public.products p ON pe.product_id = p.id
WHERE pe.lot_number ILIKE '%111111%';

-- Üretim tablosundan bu sahte kayıtları silerek gerçek fabrika üretimini temizleme
DELETE FROM public.production_entries 
WHERE lot_number ILIKE '%111111%';
