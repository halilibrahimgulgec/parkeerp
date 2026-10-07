-- ================================================================
-- PARKE ERP ÇOK FİRMALI (MULTI-TENANT SAAS) MİMARİ MİGRASYONU
-- ================================================================

-- 1. COMPANIES (FİRMALAR) TABLOSU
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                                -- Firma Ticari Ünvanı
  slug text UNIQUE NOT NULL,                         -- Firma Kod / URL Takısı (örn: kaya-beton)
  tax_number text DEFAULT '',                        -- Vergi No
  phone text DEFAULT '',                             -- Telefon
  email text DEFAULT '',                             -- E-posta
  address text DEFAULT '',                           -- Adres
  logo_url text DEFAULT '',                          -- Firma Logosu
  is_active boolean NOT NULL DEFAULT true,           -- Abonelik/Lisans Durumu
  subscription_plan text NOT NULL DEFAULT 'pro',     -- 'starter', 'pro', 'enterprise'
  valid_until timestamptz DEFAULT (now() + interval '1 year'), -- Lisans Bitiş Tarihi
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: Companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- 2. İLK VARSAYILAN FİRMAYI OLUŞTURMA (Mevcut Veriler İçin)
DO $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies LIMIT 1) THEN
    INSERT INTO public.companies (name, slug, subscription_plan, is_active)
    VALUES ('Parke ERP Merkez Fabrika', 'merkez', 'enterprise', true)
    RETURNING id INTO v_company_id;
  END IF;
END $$;

-- 3. USER_PROFILES GÜNCELLEMESİ (company_id ve is_super_admin)
ALTER TABLE public.user_profiles 
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false;

-- Mevcut profilleri ilk firmaya bağla
UPDATE public.user_profiles 
SET company_id = (SELECT id FROM public.companies ORDER BY created_at ASC LIMIT 1)
WHERE company_id IS NULL;

-- Mevcut tüm adminleri süper admin yap
UPDATE public.user_profiles
SET is_super_admin = true
WHERE role = 'admin';

-- 4. YARDIMCI GÜVENLİK FONKSİYONLARI (RLS Hızlandırma İçin)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(is_super_admin, false) FROM public.user_profiles WHERE id = auth.uid();
$$;

-- 5. MEVCUT TÜM TABLOLARA company_id EKLEME VE ESKİ VERİLERİ BAĞLAMA
DO $$
DECLARE
  v_default_company_id uuid;
  t text;
  tables text[] := ARRAY[
    'raw_materials',
    'products',
    'bom_items',
    'customers',
    'sites',
    'production_entries',
    'shipments',
    'shipment_items',
    'cost_entries',
    'customer_quotas',
    'pallet_transactions',
    'machine_definitions',
    'machine_product_capacities',
    'production_plans',
    'production_plan_items',
    'external_purchases',
    'supplier_pallet_balances',
    'supplier_pallet_transactions',
    'labor_records',
    'payroll_records',
    'shifts'
  ];
BEGIN
  SELECT id INTO v_default_company_id FROM public.companies ORDER BY created_at ASC LIMIT 1;

  FOREACH t IN ARRAY tables LOOP
    -- Tablo mevcutsa company_id sütununu ekle
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE', t);
      EXECUTE format('UPDATE public.%I SET company_id = %L WHERE company_id IS NULL', t, v_default_company_id);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_company_id ON public.%I(company_id)', t, t);
    END IF;
  END LOOP;
END $$;

-- 6. OTOMATİK company_id DOLDURMA TRİGGER'I (Frontend göndermese bile otomatik ekler)
CREATE OR REPLACE FUNCTION public.set_tenant_company_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.get_user_company_id();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'raw_materials',
    'products',
    'bom_items',
    'customers',
    'sites',
    'production_entries',
    'shipments',
    'shipment_items',
    'cost_entries',
    'customer_quotas',
    'pallet_transactions',
    'machine_definitions',
    'machine_product_capacities',
    'production_plans',
    'production_plan_items',
    'external_purchases',
    'supplier_pallet_transactions',
    'labor_records',
    'payroll_records',
    'shifts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_company_id ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_set_company_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_company_id()', t);
    END IF;
  END LOOP;
END $$;

-- 7. GÖRÜNÜMLERİN (VIEWS) company_id İLE GÜNCELLENMESİ

-- v_product_stock
CREATE OR REPLACE VIEW public.v_product_stock
WITH (security_invoker = true)
AS
SELECT 
  p.id AS product_id,
  p.company_id,
  p.name AS product_name,
  p.thickness,
  p.color,
  p.unit,
  p.min_stock_alert,
  COALESCE((SELECT SUM(pe.net_m2) FROM public.production_entries pe WHERE pe.product_id = p.id), 0) -
  COALESCE((SELECT SUM(si.m2) FROM public.shipment_items si JOIN public.shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id AND s.status = 'completed'), 0) AS current_stock
FROM public.products p
WHERE p.is_active = true;

-- v_pallet_balances
CREATE OR REPLACE VIEW public.v_pallet_balances AS
WITH sent_counts AS (
  SELECT 
    customer_id,
    site_id,
    pallet_type,
    SUM(quantity) AS total_sent
  FROM public.pallet_transactions
  WHERE transaction_type = 'sent'
  GROUP BY customer_id, site_id, pallet_type
),
returned_counts AS (
  SELECT 
    customer_id,
    site_id,
    pallet_type,
    SUM(quantity) AS total_returned
  FROM public.pallet_transactions
  WHERE transaction_type = 'returned'
  GROUP BY customer_id, site_id, pallet_type
)
SELECT 
  c.id AS customer_id,
  c.company_id,
  c.name AS customer_name,
  s.id AS site_id,
  s.name AS site_name,
  p.pallet_type,
  COALESCE(sc.total_sent, 0) AS total_sent,
  COALESCE(rc.total_returned, 0) AS total_returned,
  COALESCE(sc.total_sent, 0) - COALESCE(rc.total_returned, 0) AS balance
FROM (
  SELECT DISTINCT customer_id, site_id, pallet_type FROM public.pallet_transactions
) p
JOIN public.customers c ON p.customer_id = c.id
LEFT JOIN public.sites s ON p.site_id = s.id
LEFT JOIN sent_counts sc ON p.customer_id = sc.customer_id 
  AND (p.site_id = sc.site_id OR (p.site_id IS NULL AND sc.site_id IS NULL))
  AND p.pallet_type = sc.pallet_type
LEFT JOIN returned_counts rc ON p.customer_id = rc.customer_id 
  AND (p.site_id = rc.site_id OR (p.site_id IS NULL AND rc.site_id IS NULL))
  AND p.pallet_type = rc.pallet_type;

-- v_supplier_pallet_balances
CREATE OR REPLACE VIEW public.v_supplier_pallet_balances AS
WITH received_counts AS (
  SELECT 
    company_id,
    supplier_name,
    pallet_type,
    SUM(quantity) AS total_received
  FROM public.supplier_pallet_transactions
  WHERE transaction_type = 'received'
  GROUP BY company_id, supplier_name, pallet_type
),
returned_counts AS (
  SELECT 
    company_id,
    supplier_name,
    pallet_type,
    SUM(quantity) AS total_returned
  FROM public.supplier_pallet_transactions
  WHERE transaction_type = 'returned'
  GROUP BY company_id, supplier_name, pallet_type
)
SELECT 
  p.company_id,
  p.supplier_name,
  p.pallet_type,
  COALESCE(rc.total_received, 0) AS total_received,
  COALESCE(rtc.total_returned, 0) AS total_returned,
  COALESCE(rc.total_received, 0) - COALESCE(rtc.total_returned, 0) AS balance
FROM (
  SELECT DISTINCT company_id, supplier_name, pallet_type FROM public.supplier_pallet_transactions
) p
LEFT JOIN received_counts rc ON p.company_id = rc.company_id 
  AND p.supplier_name = rc.supplier_name 
  AND p.pallet_type = rc.pallet_type
LEFT JOIN returned_counts rtc ON p.company_id = rtc.company_id 
  AND p.supplier_name = rtc.supplier_name 
  AND p.pallet_type = rtc.pallet_type;

-- 8. ROW LEVEL SECURITY (RLS) POLİTİKALARININ UYGULANMASI

-- A. Companies RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own company" ON public.companies;
DROP POLICY IF EXISTS "Company admins can update own company" ON public.companies;
DROP POLICY IF EXISTS "Super admins can manage all companies" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_select" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_insert" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_update" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_delete" ON public.companies;

CREATE POLICY "allow_all_companies_select"
  ON public.companies FOR SELECT TO authenticated
  USING (id = public.get_user_company_id() OR public.is_super_admin() = true OR public.get_user_role() = 'admin');

CREATE POLICY "allow_all_companies_insert"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() = true OR public.get_user_role() = 'admin');

CREATE POLICY "allow_all_companies_update"
  ON public.companies FOR UPDATE TO authenticated
  USING (id = public.get_user_company_id() OR public.is_super_admin() = true OR public.get_user_role() = 'admin')
  WITH CHECK (id = public.get_user_company_id() OR public.is_super_admin() = true OR public.get_user_role() = 'admin');

CREATE POLICY "allow_all_companies_delete"
  ON public.companies FOR DELETE TO authenticated
  USING (public.is_super_admin() = true OR public.get_user_role() = 'admin');

-- B. user_profiles RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for user_profiles select" ON public.user_profiles;
DROP POLICY IF EXISTS "Tenant isolation for user_profiles update" ON public.user_profiles;
DROP POLICY IF EXISTS "Tenant isolation for user_profiles insert" ON public.user_profiles;
DROP POLICY IF EXISTS "Tenant isolation for user_profiles delete" ON public.user_profiles;

CREATE POLICY "Tenant isolation for user_profiles select"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid() 
    OR company_id = public.get_user_company_id() 
    OR public.is_super_admin() = true 
    OR public.get_user_role() = 'admin'
  );

CREATE POLICY "Tenant isolation for user_profiles insert"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid() 
    OR public.is_super_admin() = true 
    OR public.get_user_role() = 'admin'
  );

CREATE POLICY "Tenant isolation for user_profiles update"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (
    id = auth.uid() 
    OR (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
    OR public.is_super_admin() = true
  )
  WITH CHECK (
    id = auth.uid() 
    OR (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
    OR public.is_super_admin() = true
  );

CREATE POLICY "Tenant isolation for user_profiles delete"
  ON public.user_profiles FOR DELETE TO authenticated
  USING (
    (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
    OR public.is_super_admin() = true
  );

-- C. Standart Tenant Tabloları RLS Fonksiyonu
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY[
    'raw_materials',
    'products',
    'bom_items',
    'customers',
    'sites',
    'production_entries',
    'shipments',
    'shipment_items',
    'cost_entries',
    'customer_quotas',
    'pallet_transactions',
    'machine_definitions',
    'machine_product_capacities',
    'production_plans',
    'production_plan_items',
    'external_purchases',
    'supplier_pallet_balances',
    'supplier_pallet_transactions',
    'labor_records',
    'payroll_records',
    'shifts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- Tablodaki TÜM eski politikaları sil (eski serbest USING (true) politikaları temizlensin)
      FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
      END LOOP;

      -- Yeni katı Şirket İzolasyonu Politikasını uygula
      EXECUTE format('
        CREATE POLICY "tenant_isolation_%I" ON public.%I
        FOR ALL TO authenticated
        USING (company_id = public.get_user_company_id() OR public.is_super_admin() = true)
        WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin() = true)
      ', t, t);
    END IF;
  END LOOP;
END $$;
