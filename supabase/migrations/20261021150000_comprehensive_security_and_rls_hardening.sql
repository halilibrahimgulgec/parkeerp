-- ================================================================
-- PARKE ERP: KAPSAMLI GÜVENLİK VE RLS SERTLEŞTİRME MİGRASYONU
-- Tarih: 21 Ekim 2026
-- Hedef:
-- 1. Kendi kendini Süper Yönetici yapabilme açığını (Privilege Escalation) kapatmak.
-- 2. Onaysız / pasif kullanıcıların RLS bypass yapmasını engellemek (Fail-Closed).
-- 3. Multi-Tenant izolasyonunu çalışanlar (employees, payroll, attendance),
--    tedarikçiler (suppliers), kalıplar (molds) ve tahsilatlara (customer_payments) eksiksiz uygulamak.
-- 4. Şirket silme ve profil manipülasyonlarını PostgreSQL Trigger ile garantiye almak.
-- ================================================================

-- 1. GÜVENLİK YARDIMCI FONKSİYONLARININ SERTLEŞTİRİLMESİ (FAIL-CLOSED)
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT company_id 
  FROM public.user_profiles 
  WHERE id = auth.uid() 
    AND is_approved = true 
    AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(is_super_admin, false) 
  FROM public.user_profiles 
  WHERE id = auth.uid() 
    AND is_approved = true 
    AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role 
  FROM public.user_profiles 
  WHERE id = auth.uid() 
    AND is_approved = true 
    AND is_active = true;
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
  
  -- Auth oturumu yoksa (arka plan görevi vb.) ilk aktif şirkete bağla
  IF NEW.company_id IS NULL THEN
    SELECT id INTO NEW.company_id 
    FROM public.companies 
    WHERE is_active = true 
    ORDER BY created_at ASC 
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. KULLANICI PROFİLLERİ YETKİ YÜKSELTME ENGELLEME TRİGGER'I (PRIVILEGE ESCALATION BLOCKER)
CREATE OR REPLACE FUNCTION public.protect_user_profile_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role text;
  v_caller_comp uuid;
BEGIN
  -- Service role veya mevcut süper yönetici serbesttir
  IF current_setting('role', true) = 'service_role' OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- A. INSERT (Yeni Kayıt) Durumu:
  IF TG_OP = 'INSERT' THEN
    -- Kullanıcı kendini süper yönetici veya onaylı olarak ekleyemez
    NEW.is_super_admin := false;
    NEW.is_approved := false;
    RETURN NEW;
  END IF;

  -- B. UPDATE Durumu:
  IF TG_OP = 'UPDATE' THEN
    -- is_super_admin yetkisi süper yönetici olmayan biri tarafından asla değiştirilemez!
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      RAISE EXCEPTION 'Yetkisiz işlem: Süper yönetici yetkisi yalnızca mevcut bir süper yönetici tarafından atanabilir.';
    END IF;

    -- company_id değiştirilemez (Cross-tenant migration engelleme)
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Yetkisiz işlem: Kullanıcı şirket aidiyeti doğrudan değiştirilemez.';
    END IF;

    -- Kullanıcı kendi profilini güncelliyorsa (auth.uid() = OLD.id):
    IF auth.uid() = OLD.id THEN
      -- Kendi rolünü değiştiremez!
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Yetkisiz işlem: Kendi kullanıcı rolünüzü değiştiremezsiniz.';
      END IF;
      -- Kendi onay durumunu değiştiremez!
      IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
        RAISE EXCEPTION 'Yetkisiz işlem: Kendi hesap onay durumunuzu değiştiremezsiniz.';
      END IF;
      -- Kendi aktiflik durumunu değiştiremez!
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'Yetkisiz işlem: Kendi aktiflik durumunuzu değiştiremezsiniz.';
      END IF;
      RETURN NEW;
    END IF;

    -- Başka bir kullanıcının profilini güncelleyen kişi:
    v_caller_role := public.get_user_role();
    v_caller_comp := public.get_user_company_id();

    -- Sadece aynı firmanın onaylı yöneticisi (admin) güncelleyebilir
    IF v_caller_role = 'admin' AND v_caller_comp = OLD.company_id THEN
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Yetkisiz işlem: Bu profili güncelleme yetkiniz bulunmamaktadır.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_profiles ON public.user_profiles;
CREATE TRIGGER trg_protect_user_profiles
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_profile_escalation();

-- 4. TÜM İŞ VE VERİ TABLOLARININ RLS VE company_id İZOLASYONUNUN KESİNLEŞTİRİLMESİ
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
  -- Boşta kalan kayıtlar için ilk aktif firmayı al
  SELECT id INTO v_default_company_id FROM public.companies WHERE is_active = true ORDER BY created_at ASC LIMIT 1;

  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      
      -- A. company_id sütununu ekle (yoksa)
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE', t);
      
      -- B. İlişkili alt tablolarda company_id'yi üst tablodan doldur
      IF t = 'attendance_records' OR t = 'payroll_transactions' OR t = 'payroll_payments' THEN
        EXECUTE format('
          UPDATE public.%I c
          SET company_id = e.company_id
          FROM public.employees e
          WHERE c.employee_id = e.id AND c.company_id IS NULL AND e.company_id IS NOT NULL
        ', t);
      ELSIF t = 'shipment_items' THEN
        EXECUTE '
          UPDATE public.shipment_items si
          SET company_id = s.company_id
          FROM public.shipments s
          WHERE si.shipment_id = s.id AND si.company_id IS NULL AND s.company_id IS NOT NULL
        ';
      ELSIF t = 'mold_products' OR t = 'mold_maintenance_logs' THEN
        EXECUTE format('
          UPDATE public.%I mp
          SET company_id = m.company_id
          FROM public.molds m
          WHERE mp.mold_id = m.id AND mp.company_id IS NULL AND m.company_id IS NOT NULL
        ', t);
      END IF;

      -- C. Hâlâ Null kalan kayıtları varsayılan firmaya bağla
      IF v_default_company_id IS NOT NULL THEN
        EXECUTE format('UPDATE public.%I SET company_id = %L WHERE company_id IS NULL', t, v_default_company_id);
      END IF;

      -- D. Performans için company_id indeksini oluştur
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_company_id ON public.%I(company_id)', t, t);

      -- E. Otomatik company_id atama trigger'ını kur
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_company_id ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_set_company_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_company_id()', t);

      -- F. RLS'yi kesin olarak etkinleştir
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- G. Tablo üzerindeki eski TÜM gevşek/geçici politikaları temizle
      FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
      END LOOP;

      -- H. Yeni katı şirket izolasyonu politikasını uygula (Fail-Closed)
      EXECUTE format('
        CREATE POLICY "tenant_isolation_%I" ON public.%I
        FOR ALL TO authenticated
        USING (
          public.is_super_admin() = true 
          OR (public.get_user_company_id() IS NOT NULL AND company_id = public.get_user_company_id())
        )
        WITH CHECK (
          public.is_super_admin() = true 
          OR (public.get_user_company_id() IS NOT NULL AND company_id = public.get_user_company_id())
        )
      ', t, t);

    END IF;
  END LOOP;
END $$;

-- 5. USER_PROFILES RLS POLİTİKALARININ SERTLEŞTİRİLMESİ
DO $$
DECLARE
  pol record;
BEGIN
  ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

  FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "tenant_user_profiles_select"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid() 
    OR public.is_super_admin() = true
    OR (
      public.get_user_company_id() IS NOT NULL 
      AND company_id = public.get_user_company_id()
    )
  );

CREATE POLICY "tenant_user_profiles_insert"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid() 
    OR public.is_super_admin() = true
    OR (
      public.get_user_company_id() IS NOT NULL 
      AND company_id = public.get_user_company_id() 
      AND public.get_user_role() = 'admin'
    )
  );

CREATE POLICY "tenant_user_profiles_update"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (
    id = auth.uid() 
    OR public.is_super_admin() = true
    OR (
      public.get_user_company_id() IS NOT NULL 
      AND company_id = public.get_user_company_id() 
      AND public.get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    id = auth.uid() 
    OR public.is_super_admin() = true
    OR (
      public.get_user_company_id() IS NOT NULL 
      AND company_id = public.get_user_company_id() 
      AND public.get_user_role() = 'admin'
    )
  );

CREATE POLICY "tenant_user_profiles_delete"
  ON public.user_profiles FOR DELETE TO authenticated
  USING (
    public.is_super_admin() = true
    OR (
      public.get_user_company_id() IS NOT NULL 
      AND company_id = public.get_user_company_id() 
      AND public.get_user_role() = 'admin'
      AND id <> auth.uid()
    )
  );

-- 6. COMPANIES TABLOSU RLS POLİTİKALARININ SERTLEŞTİRİLMESİ
DO $$
DECLARE
  pol record;
BEGIN
  ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

  FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'companies') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.companies', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "tenant_companies_select"
  ON public.companies FOR SELECT TO authenticated
  USING (
    public.is_super_admin() = true
    OR (public.get_user_company_id() IS NOT NULL AND id = public.get_user_company_id())
  );

CREATE POLICY "tenant_companies_insert"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() = true
  );

CREATE POLICY "tenant_companies_update"
  ON public.companies FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() = true
    OR (public.get_user_company_id() IS NOT NULL AND id = public.get_user_company_id() AND public.get_user_role() = 'admin')
  )
  WITH CHECK (
    public.is_super_admin() = true
    OR (public.get_user_company_id() IS NOT NULL AND id = public.get_user_company_id() AND public.get_user_role() = 'admin')
  );

CREATE POLICY "tenant_companies_delete"
  ON public.companies FOR DELETE TO authenticated
  USING (
    public.is_super_admin() = true
  );

-- 7. GÖRÜNÜMLERDE (VIEWS) SECURITY INVOKER VE RLS GARANTİSİ
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
  (
    COALESCE((SELECT SUM(pe.net_m2) FROM public.production_entries pe WHERE pe.product_id = p.id), 0) +
    COALESCE((SELECT SUM(ep.quantity) FROM public.external_purchases ep WHERE ep.product_id = p.id AND (ep.is_direct_shipment IS NOT TRUE)), 0) -
    COALESCE((
      SELECT SUM(si.m2) 
      FROM public.shipment_items si 
      JOIN public.shipments s ON si.shipment_id = s.id 
      WHERE si.product_id = p.id 
        AND s.status = 'completed' 
        AND (s.supplier_name IS NULL OR TRIM(s.supplier_name) = '')
        AND (s.notes IS NULL OR (s.notes NOT ILIKE '%transit%' AND s.notes NOT ILIKE '%dış alım%' AND s.notes NOT ILIKE '%dis alim%'))
    ), 0)
  ) AS current_stock
FROM public.products p
WHERE p.is_active = true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_customer_balances') THEN
    ALTER VIEW public.v_customer_balances SET (security_invoker = true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_mold_summary') THEN
    ALTER VIEW public.v_mold_summary SET (security_invoker = true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_pallet_balances') THEN
    ALTER VIEW public.v_pallet_balances SET (security_invoker = true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_supplier_pallet_balances') THEN
    ALTER VIEW public.v_supplier_pallet_balances SET (security_invoker = true);
  END IF;
END $$;

