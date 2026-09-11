-- ================================================================
-- TEDARİKÇİ (DIŞ FABRİKA) PALET BORCU & HAREKET TAKİBİ ŞEMASI
-- ================================================================

-- 1. supplier_pallet_transactions Tablosu
CREATE TABLE IF NOT EXISTS public.supplier_pallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_name text NOT NULL,
  purchase_id uuid REFERENCES public.external_purchases(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('received', 'returned')),
  pallet_type text NOT NULL CHECK (pallet_type IN ('tahta', 'sevkiyat', 'uretim', 'dokme')),
  quantity integer NOT NULL CHECK (quantity > 0),
  vehicle_plate text DEFAULT '',
  driver_name text DEFAULT '',
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS Güvenlik Politikaları
ALTER TABLE public.supplier_pallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view supplier pallet transactions" ON public.supplier_pallet_transactions;
CREATE POLICY "Authenticated users can view supplier pallet transactions"
  ON public.supplier_pallet_transactions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert supplier pallet transactions" ON public.supplier_pallet_transactions;
CREATE POLICY "Authenticated users can insert supplier pallet transactions"
  ON public.supplier_pallet_transactions FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update supplier pallet transactions" ON public.supplier_pallet_transactions;
CREATE POLICY "Authenticated users can update supplier pallet transactions"
  ON public.supplier_pallet_transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete supplier pallet transactions" ON public.supplier_pallet_transactions;
CREATE POLICY "Authenticated users can delete supplier pallet transactions"
  ON public.supplier_pallet_transactions FOR DELETE TO authenticated USING (true);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_supplier_pallet_name ON public.supplier_pallet_transactions(supplier_name);
CREATE INDEX IF NOT EXISTS idx_supplier_pallet_date ON public.supplier_pallet_transactions(date);
CREATE INDEX IF NOT EXISTS idx_supplier_pallet_purchase ON public.supplier_pallet_transactions(purchase_id);

-- 2. v_supplier_pallet_balances Görünümü
CREATE OR REPLACE VIEW public.v_supplier_pallet_balances AS
WITH received_counts AS (
  SELECT 
    supplier_name,
    pallet_type,
    SUM(quantity) AS total_received
  FROM public.supplier_pallet_transactions
  WHERE transaction_type = 'received'
  GROUP BY supplier_name, pallet_type
),
returned_counts AS (
  SELECT 
    supplier_name,
    pallet_type,
    SUM(quantity) AS total_returned
  FROM public.supplier_pallet_transactions
  WHERE transaction_type = 'returned'
  GROUP BY supplier_name, pallet_type
)
SELECT 
  p.supplier_name,
  p.pallet_type,
  COALESCE(rc.total_received, 0) AS total_received,
  COALESCE(tc.total_returned, 0) AS total_returned,
  (COALESCE(rc.total_received, 0) - COALESCE(tc.total_returned, 0)) AS balance
FROM (
  SELECT DISTINCT supplier_name, pallet_type FROM public.supplier_pallet_transactions
) p
LEFT JOIN received_counts rc ON p.supplier_name = rc.supplier_name AND p.pallet_type = rc.pallet_type
LEFT JOIN returned_counts tc ON p.supplier_name = tc.supplier_name AND p.pallet_type = tc.pallet_type;

-- 3. Mevcut external_purchases kayıtlarından palet hareketlerini başlatma
INSERT INTO public.supplier_pallet_transactions (
  date,
  supplier_name,
  purchase_id,
  transaction_type,
  pallet_type,
  quantity,
  vehicle_plate,
  driver_name,
  notes,
  created_by,
  created_at
)
SELECT 
  ep.date,
  ep.supplier_name,
  ep.id,
  'received',
  ep.pallet_type,
  ep.pallets,
  ep.vehicle_plate,
  ep.driver_name,
  'Dış Alım kaydından aktarıldı (İrsaliye: ' || COALESCE(ep.supplier_invoice_no, '-') || ')',
  ep.created_by,
  ep.created_at
FROM public.external_purchases ep
WHERE ep.pallets > 0 AND ep.pallet_type != 'dokme'
ON CONFLICT DO NOTHING;
