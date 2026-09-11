-- ================================================================
-- 2 MAKİNELİ ÜRETİM PLANLAMA, SİPARİŞLER VE İŞ EMİRLERİ ŞEMASI
-- ================================================================

-- 1. machine_definitions Tablosu (Tesisimizdeki 2 Makine)
CREATE TABLE IF NOT EXISTS public.machine_definitions (
  machine_no text PRIMARY KEY,
  name text NOT NULL,
  daily_capacity_m2 numeric NOT NULL DEFAULT 1000,
  shift_count integer NOT NULL DEFAULT 2 CHECK (shift_count IN (1, 2, 3)),
  specialized_types text[] DEFAULT '{}',
  notes text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Varsayılan 2 Makine Kaydı
INSERT INTO public.machine_definitions (machine_no, name, daily_capacity_m2, shift_count, specialized_types, notes)
VALUES 
  ('1', '1 Nolu Parke Baskı Makinesi', 1000, 2, ARRAY['Kilitli', 'Aşık', 'Prizma', 'Küp Taşı'], 'Ana parke hattı'),
  ('2', '2 Nolu Parke & Bordür Makinesi', 1000, 2, ARRAY['Bordür', 'Oluk', 'Kilitli', 'Begonit', 'Tretuar'], 'Bordür ve ikincil parke hattı')
ON CONFLICT (machine_no) DO NOTHING;

-- 2. production_orders Tablosu (Müşteri Sipariş & Talep Havuzu)
CREATE TABLE IF NOT EXISTS public.production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'm2' CHECK (unit IN ('m2', 'metre', 'adet')),
  due_date date,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'planned', 'in_production', 'completed', 'cancelled')),
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. production_plans Tablosu (Üretim Planları / Takvim Blokları)
CREATE TABLE IF NOT EXISTS public.production_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  ai_summary jsonb DEFAULT '{}'::jsonb,
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. production_plan_items Tablosu (Makine 1 & 2 Günlük İş Emirleri)
CREATE TABLE IF NOT EXISTS public.production_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.production_plans(id) ON DELETE CASCADE,
  machine_no text NOT NULL REFERENCES public.machine_definitions(machine_no) ON DELETE RESTRICT,
  planned_date date NOT NULL,
  shift text NOT NULL DEFAULT 'Gündüz' CHECK (shift IN ('Gündüz', 'Gece')),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  quota_id uuid REFERENCES public.customer_quotas(id) ON DELETE SET NULL,
  planned_m2 numeric NOT NULL CHECK (planned_m2 > 0),
  planned_pallets numeric DEFAULT 0,
  produced_m2 numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  sequence_order integer DEFAULT 1,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 5. production_entries tablosuna plan_item_id ilişkisi ekleme
ALTER TABLE public.production_entries ADD COLUMN IF NOT EXISTS plan_item_id uuid REFERENCES public.production_plan_items(id) ON DELETE SET NULL;

-- RLS Güvenlik Politikaları
ALTER TABLE public.machine_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_items ENABLE ROW LEVEL SECURITY;

-- Okuma Politikaları
DROP POLICY IF EXISTS "Authenticated users can view machines" ON public.machine_definitions;
CREATE POLICY "Authenticated users can view machines" ON public.machine_definitions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view orders" ON public.production_orders;
CREATE POLICY "Authenticated users can view orders" ON public.production_orders FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view plans" ON public.production_plans;
CREATE POLICY "Authenticated users can view plans" ON public.production_plans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view plan items" ON public.production_plan_items;
CREATE POLICY "Authenticated users can view plan items" ON public.production_plan_items FOR SELECT TO authenticated USING (true);

-- Yönetim Politikaları
DROP POLICY IF EXISTS "Authenticated users can manage machines" ON public.machine_definitions;
CREATE POLICY "Authenticated users can manage machines" ON public.machine_definitions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can manage orders" ON public.production_orders;
CREATE POLICY "Authenticated users can manage orders" ON public.production_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can manage plans" ON public.production_plans;
CREATE POLICY "Authenticated users can manage plans" ON public.production_plans FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can manage plan items" ON public.production_plan_items;
CREATE POLICY "Authenticated users can manage plan items" ON public.production_plan_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_plan_items_date_machine ON public.production_plan_items(planned_date, machine_no);
CREATE INDEX IF NOT EXISTS idx_plan_items_product ON public.production_plan_items(product_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_status ON public.production_plan_items(status);
CREATE INDEX IF NOT EXISTS idx_orders_status_due ON public.production_orders(status, due_date);
CREATE INDEX IF NOT EXISTS idx_production_entries_plan_item ON public.production_entries(plan_item_id);
