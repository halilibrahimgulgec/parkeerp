-- ================================================================
-- TEDARİKÇİ CARİLERİ VE MÜŞTERİ CARİ HESAP & BAKİYE ŞEMASI
-- ================================================================

-- 1. suppliers Tablosu (Tedarikçi ve Dış Fabrika Carileri)
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  contact_person text DEFAULT '',
  address text DEFAULT '',
  tax_number text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. customer_payments Tablosu (Müşteri Tahsilatları & Kasa/Banka Girişleri)
CREATE TABLE IF NOT EXISTS public.customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  payment_type text NOT NULL DEFAULT 'havale' CHECK (payment_type IN ('havale', 'nakit', 'cek', 'kredi_karti', 'diger')),
  amount numeric NOT NULL CHECK (amount > 0),
  document_no text DEFAULT '', -- Dekont No, Makbuz No, Çek No
  bank_name text DEFAULT '',
  due_date date, -- Çek vadesi
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. İndeksler
CREATE INDEX IF NOT EXISTS idx_suppliers_company ON public.suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers(name);
CREATE INDEX IF NOT EXISTS idx_customer_payments_company ON public.customer_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON public.customer_payments(date);

-- 4. RLS Güvenlik Politikaları
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view suppliers" ON public.suppliers;
CREATE POLICY "Authenticated users can view suppliers"
  ON public.suppliers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage suppliers" ON public.suppliers;
CREATE POLICY "Authenticated users can manage suppliers"
  ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view customer_payments" ON public.customer_payments;
CREATE POLICY "Authenticated users can view customer_payments"
  ON public.customer_payments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage customer_payments" ON public.customer_payments;
CREATE POLICY "Authenticated users can manage customer_payments"
  ON public.customer_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Otomatik Seeding: Önceden girilmiş olan tedarikçi isimlerini suppliers tablosuna aktarma
DO $$
BEGIN
  -- shipments tablosundaki tekil tedarikçi isimlerini aktar
  INSERT INTO public.suppliers (name, is_active)
  SELECT DISTINCT TRIM(s.supplier_name), true
  FROM public.shipments s
  WHERE s.supplier_name IS NOT NULL 
    AND TRIM(s.supplier_name) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.suppliers sup 
      WHERE LOWER(TRIM(sup.name)) = LOWER(TRIM(s.supplier_name))
    )
  ON CONFLICT DO NOTHING;

  -- external_purchases tablosundaki tekil tedarikçi isimlerini aktar
  INSERT INTO public.suppliers (name, is_active)
  SELECT DISTINCT TRIM(ep.supplier_name), true
  FROM public.external_purchases ep
  WHERE ep.supplier_name IS NOT NULL 
    AND TRIM(ep.supplier_name) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.suppliers sup 
      WHERE LOWER(TRIM(sup.name)) = LOWER(TRIM(ep.supplier_name))
    )
  ON CONFLICT DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    -- Eğer tablolar yoksa veya hata oluşursa devam et
    NULL;
END $$;

-- 6. v_customer_balances Görünümü (Müşteri Kümülatif Borç, Alacak ve Kalan Bakiye)
CREATE OR REPLACE VIEW public.v_customer_balances
WITH (security_invoker = true)
AS
WITH shipment_totals AS (
  SELECT 
    s.customer_id,
    COALESCE(SUM(
      COALESCE(
        (SELECT SUM(COALESCE(si.total_price, si.m2 * si.unit_price)) 
         FROM public.shipment_items si 
         WHERE si.shipment_id = s.id AND (si.total_price > 0 OR (si.m2 * si.unit_price) > 0)),
        s.total_m2 * COALESCE(s.sale_price_per_m2, 0)
      )
    ), 0) AS total_shipped_amount,
    MAX(s.shipment_date) AS last_shipment_date
  FROM public.shipments s
  WHERE s.status = 'completed'
  GROUP BY s.customer_id
),
payment_totals AS (
  SELECT 
    cp.customer_id,
    COALESCE(SUM(cp.amount), 0) AS total_paid_amount,
    MAX(cp.date) AS last_payment_date
  FROM public.customer_payments cp
  GROUP BY cp.customer_id
)
SELECT 
  c.id,
  c.company_id,
  c.name,
  c.phone,
  c.email,
  c.tax_number,
  c.address,
  c.is_active,
  c.created_at,
  COALESCE(st.total_shipped_amount, 0) AS total_debit, -- Borç (İrsaliyeler)
  COALESCE(pt.total_paid_amount, 0) AS total_credit,   -- Alacak (Tahsilatlar)
  COALESCE(st.total_shipped_amount, 0) - COALESCE(pt.total_paid_amount, 0) AS balance, -- Kalan Bakiye (>0 Borçlu)
  st.last_shipment_date,
  pt.last_payment_date
FROM public.customers c
LEFT JOIN shipment_totals st ON st.customer_id = c.id
LEFT JOIN payment_totals pt ON pt.customer_id = c.id;
