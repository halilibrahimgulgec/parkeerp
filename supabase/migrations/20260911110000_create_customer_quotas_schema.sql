-- Create Customer Quotas and Commitments Schema

CREATE TABLE IF NOT EXISTS public.customer_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  target_quantity numeric NOT NULL CHECK (target_quantity > 0),
  unit text NOT NULL DEFAULT 'm2' CHECK (unit IN ('m2', 'metre', 'adet')),
  alert_threshold_pct numeric NOT NULL DEFAULT 85 CHECK (alert_threshold_pct > 0 AND alert_threshold_pct <= 100),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  notes text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customer_quotas ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Authenticated users can view customer quotas" ON public.customer_quotas;
CREATE POLICY "Authenticated users can view customer quotas"
  ON public.customer_quotas FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage customer quotas" ON public.customer_quotas;
CREATE POLICY "Authenticated users can manage customer quotas"
  ON public.customer_quotas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_quotas_customer ON public.customer_quotas(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_quotas_dates ON public.customer_quotas(start_date, end_date);
