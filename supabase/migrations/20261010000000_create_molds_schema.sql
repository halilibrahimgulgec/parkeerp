-- ================================================================
-- KALIP BASKI METRAJI VE ÖMÜR TAKİP SİSTEMİ ŞEMASI
-- ================================================================

-- 1. molds Tablosu (Kalıp Tanımları & Demirbaş Kartları)
CREATE TABLE IF NOT EXISTS public.molds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  machine_no text DEFAULT '1', -- '1', '2' veya 'hepsi'
  m2_per_stroke numeric DEFAULT 1.0, -- 1 baskıdaki / vuruştaki üretim metrajı
  initial_m2 numeric DEFAULT 0, -- Sisteme girmeden önceki devir metrajı
  target_lifespan_m2 numeric DEFAULT 100000, -- Hedef ömür metrajı (m²)
  maintenance_interval_m2 numeric DEFAULT 25000, -- Kaç m²'de bir periyodik bakım yapılmalı
  status text DEFAULT 'active' CHECK (status IN ('active', 'mounted', 'maintenance', 'retired')),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. mold_products Tablosu (1 Kalıba Birden Fazla Ürün Bağlama: Örn. 20x10 Beyaz, Gri, Kırmızı)
CREATE TABLE IF NOT EXISTS public.mold_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  mold_id uuid NOT NULL REFERENCES public.molds(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(mold_id, product_id)
);

-- 3. mold_maintenance_logs Tablosu (Kalıp Taşlama, Bakım ve Revizyon Fişleri)
CREATE TABLE IF NOT EXISTS public.mold_maintenance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  mold_id uuid NOT NULL REFERENCES public.molds(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  action_type text NOT NULL DEFAULT 'taslama' CHECK (action_type IN ('taslama', 'temizlik', 'plaka_degisimi', 'kaynak', 'diger')),
  service_provider text DEFAULT '',
  cost numeric DEFAULT 0,
  footage_at_maintenance numeric DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- 4. production_entries Tablosuna mold_id Eklenmesi
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'production_entries' 
      AND column_name = 'mold_id'
  ) THEN
    ALTER TABLE public.production_entries 
    ADD COLUMN mold_id uuid REFERENCES public.molds(id) ON DELETE SET NULL;
  END IF;
END $$;

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_molds_company ON public.molds(company_id);
CREATE INDEX IF NOT EXISTS idx_molds_status ON public.molds(status);
CREATE INDEX IF NOT EXISTS idx_mold_products_mold ON public.mold_products(mold_id);
CREATE INDEX IF NOT EXISTS idx_mold_products_prod ON public.mold_products(product_id);
CREATE INDEX IF NOT EXISTS idx_mold_maint_mold ON public.mold_maintenance_logs(mold_id);
CREATE INDEX IF NOT EXISTS idx_prod_entries_mold ON public.production_entries(mold_id);

-- RLS Güvenlik Politikaları
ALTER TABLE public.molds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mold_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mold_maintenance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view molds" ON public.molds;
CREATE POLICY "Authenticated users can view molds"
  ON public.molds FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage molds" ON public.molds;
CREATE POLICY "Authenticated users can manage molds"
  ON public.molds FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view mold_products" ON public.mold_products;
CREATE POLICY "Authenticated users can view mold_products"
  ON public.mold_products FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage mold_products" ON public.mold_products;
CREATE POLICY "Authenticated users can manage mold_products"
  ON public.mold_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view mold_maintenance_logs" ON public.mold_maintenance_logs;
CREATE POLICY "Authenticated users can view mold_maintenance_logs"
  ON public.mold_maintenance_logs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage mold_maintenance_logs" ON public.mold_maintenance_logs;
CREATE POLICY "Authenticated users can manage mold_maintenance_logs"
  ON public.mold_maintenance_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. v_mold_summary Görünümü (Kalıp Kümülatif Metrajı, Vuruş Sayısı ve Aşınma Röntgeni)
CREATE OR REPLACE VIEW public.v_mold_summary
WITH (security_invoker = true)
AS
SELECT 
  m.id,
  m.company_id,
  m.code,
  m.name,
  m.machine_no,
  m.m2_per_stroke,
  m.initial_m2,
  m.target_lifespan_m2,
  m.maintenance_interval_m2,
  m.status,
  m.notes,
  m.created_at,
  m.updated_at,
  COALESCE(m.initial_m2, 0) + COALESCE((
    SELECT SUM(pe.net_m2) 
    FROM public.production_entries pe 
    WHERE pe.mold_id = m.id
  ), 0) AS total_produced_m2,
  CASE 
    WHEN COALESCE(m.m2_per_stroke, 0) > 0 THEN
      ROUND((COALESCE(m.initial_m2, 0) + COALESCE((
        SELECT SUM(pe.net_m2) 
        FROM public.production_entries pe 
        WHERE pe.mold_id = m.id
      ), 0)) / m.m2_per_stroke)
    ELSE 0
  END AS total_strokes,
  CASE
    WHEN COALESCE(m.target_lifespan_m2, 0) > 0 THEN
      ROUND(((COALESCE(m.initial_m2, 0) + COALESCE((
        SELECT SUM(pe.net_m2) 
        FROM public.production_entries pe 
        WHERE pe.mold_id = m.id
      ), 0)) / m.target_lifespan_m2) * 100, 1)
    ELSE 0
  END AS wear_percentage,
  (
    SELECT MAX(pe.date) 
    FROM public.production_entries pe 
    WHERE pe.mold_id = m.id
  ) AS last_production_date,
  (
    SELECT COUNT(*) 
    FROM public.mold_maintenance_logs mml 
    WHERE mml.mold_id = m.id
  ) AS maintenance_count,
  (
    SELECT MAX(mml.date) 
    FROM public.mold_maintenance_logs mml 
    WHERE mml.mold_id = m.id
  ) AS last_maintenance_date
FROM public.molds m;
