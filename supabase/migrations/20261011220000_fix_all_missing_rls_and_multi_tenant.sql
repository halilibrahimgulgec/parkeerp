-- ================================================================
-- PARKE ERP EKSİKSİZ RLS (ROW LEVEL SECURITY) VE ÇOK FİRMALI İZOLASYON GÜNCELLEMESİ
-- ================================================================
-- Bu migrasyon:
-- 1. Tüm tablolarda eksik olan RLS politikalarını kapatır.
-- 2. Sonradan eklenen (molds, suppliers, customer_payments, employees vb.) tablolardaki
--    geçici "USING (true)" serbest kurallarını temizler.
-- 3. Eksik company_id sütunlarını ekler ve otomatik atama trigger'larını kurar.
-- 4. Tüm tablolar için "company_id = public.get_user_company_id() OR public.is_super_admin() = true"
--    kuralını zorunlu kılar.
-- ================================================================

-- 1. GÜVENLİK YARDIMCI FONKSİYONLARI
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

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- 2. OTOMATİK company_id ATAMA TRİGGER FONKSİYONU
CREATE OR REPLACE FUNCTION public.set_tenant_company_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.get_user_company_id();
  END IF;
  
  -- Eğer auth oturumu olmadan çalıştırılırsa ilk aktif firmaya ata (boş kalmaması için)
  IF NEW.company_id IS NULL THEN
    SELECT id INTO NEW.company_id FROM public.companies WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. TÜM İŞ VE VERİ TABLOLARININ RLS VE company_id İZOLASYONU
DO $$
DECLARE
  v_default_company_id uuid;
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
    'production_orders',
    'production_plans',
    'production_plan_items',
    'external_purchases',
    'supplier_pallet_balances',
    'supplier_pallet_transactions',
    'employees',
    'attendance_records',
    'payroll_transactions',
    'payroll_payments',
    'molds',
    'mold_products',
    'mold_maintenance_logs',
    'suppliers',
    'customer_payments'
  ];
BEGIN
  -- Boşta kalan kayıtlar için ilk varsayılan firmayı al
  SELECT id INTO v_default_company_id FROM public.companies ORDER BY created_at ASC LIMIT 1;

  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      
      -- A. company_id sütununu ekle (yoksa)
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE', t);
      
      -- B. Null olan eski kayıtları varsayılan firmaya bağla
      IF v_default_company_id IS NOT NULL THEN
        EXECUTE format('UPDATE public.%I SET company_id = %L WHERE company_id IS NULL', t, v_default_company_id);
      END IF;

      -- C. Performans için company_id indeksini oluştur
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_company_id ON public.%I(company_id)', t, t);

      -- D. Otomatik company_id doldurma trigger'ını kur
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_company_id ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_set_company_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_company_id()', t);

      -- E. RLS'yi kesin olarak etkinleştir
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- F. Eski tüm geçici/gevşek politikaları temizle (USING true politikaları dahil)
      FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
      END LOOP;

      -- G. Yeni katı şirket izolasyonu politikasını uygula
      EXECUTE format('
        CREATE POLICY "tenant_isolation_%I" ON public.%I
        FOR ALL TO authenticated
        USING (company_id = public.get_user_company_id() OR public.is_super_admin() = true)
        WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin() = true)
      ', t, t);

    END IF;
  END LOOP;
END $$;

-- 4. COMPANIES (FİRMALAR) TABLOSU RLS GÜNCELLEMESİ
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own company" ON public.companies;
DROP POLICY IF EXISTS "Company admins can update own company" ON public.companies;
DROP POLICY IF EXISTS "Super admins can manage all companies" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_select" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_insert" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_update" ON public.companies;
DROP POLICY IF EXISTS "allow_all_companies_delete" ON public.companies;
DROP POLICY IF EXISTS "tenant_isolation_companies_select" ON public.companies;
DROP POLICY IF EXISTS "tenant_isolation_companies_insert" ON public.companies;
DROP POLICY IF EXISTS "tenant_isolation_companies_update" ON public.companies;
DROP POLICY IF EXISTS "tenant_isolation_companies_delete" ON public.companies;

CREATE POLICY "tenant_isolation_companies_select"
  ON public.companies FOR SELECT TO authenticated
  USING (
    id = public.get_user_company_id() 
    OR public.is_super_admin() = true
  );

CREATE POLICY "tenant_isolation_companies_insert"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() = true
  );

CREATE POLICY "tenant_isolation_companies_update"
  ON public.companies FOR UPDATE TO authenticated
  USING (
    (id = public.get_user_company_id() AND public.get_user_role() = 'admin') 
    OR public.is_super_admin() = true
  )
  WITH CHECK (
    (id = public.get_user_company_id() AND public.get_user_role() = 'admin') 
    OR public.is_super_admin() = true
  );

CREATE POLICY "tenant_isolation_companies_delete"
  ON public.companies FOR DELETE TO authenticated
  USING (
    public.is_super_admin() = true
  );

-- 5. USER_PROFILES (KULLANICI PROFİLLERİ) TABLOSU RLS GÜNCELLEMESİ
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for user_profiles select" ON public.user_profiles;
DROP POLICY IF EXISTS "Tenant isolation for user_profiles update" ON public.user_profiles;
DROP POLICY IF EXISTS "Tenant isolation for user_profiles insert" ON public.user_profiles;
DROP POLICY IF EXISTS "Tenant isolation for user_profiles delete" ON public.user_profiles;
DROP POLICY IF EXISTS "tenant_isolation_user_profiles_select" ON public.user_profiles;
DROP POLICY IF EXISTS "tenant_isolation_user_profiles_insert" ON public.user_profiles;
DROP POLICY IF EXISTS "tenant_isolation_user_profiles_update" ON public.user_profiles;
DROP POLICY IF EXISTS "tenant_isolation_user_profiles_delete" ON public.user_profiles;

CREATE POLICY "tenant_isolation_user_profiles_select"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid() 
    OR company_id = public.get_user_company_id() 
    OR public.is_super_admin() = true
  );

CREATE POLICY "tenant_isolation_user_profiles_insert"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid() 
    OR public.is_super_admin() = true 
    OR (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
  );

CREATE POLICY "tenant_isolation_user_profiles_update"
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

CREATE POLICY "tenant_isolation_user_profiles_delete"
  ON public.user_profiles FOR DELETE TO authenticated
  USING (
    (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
    OR public.is_super_admin() = true
  );

-- 6. GÖRÜNÜMLERİN (VIEWS) SECURITY INVOKER VE company_id KONTROLÜ
-- security_invoker = true tanımlandığında görünümü çağıran kullanıcının RLS hakları işletilir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_customer_balances') THEN
    ALTER VIEW public.v_customer_balances SET (security_invoker = true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_mold_summary') THEN
    ALTER VIEW public.v_mold_summary SET (security_invoker = true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_product_stock') THEN
    ALTER VIEW public.v_product_stock SET (security_invoker = true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_pallet_balances') THEN
    ALTER VIEW public.v_pallet_balances SET (security_invoker = true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_supplier_pallet_balances') THEN
    ALTER VIEW public.v_supplier_pallet_balances SET (security_invoker = true);
  END IF;
END $$;

-- 7. KONTROL / DOĞRULAMA SORGUSU (RLS Açık Olan Tabloların Özeti)
-- Bu sorgu migrasyon çalıştıktan sonra tabloların ve RLS durumunun listesini döner:
SELECT 
  tablename, 
  rowsecurity AS rls_aktif 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename ASC;
