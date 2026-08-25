-- Create pallet_transactions table and view for tracking wood, shipment, and production pallets
CREATE TABLE IF NOT EXISTS public.pallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('sent', 'returned')),
  pallet_type text NOT NULL CHECK (pallet_type IN ('tahta', 'sevkiyat', 'uretim')),
  quantity integer NOT NULL CHECK (quantity >= 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pallet_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Authenticated users can view pallet transactions" ON public.pallet_transactions;
CREATE POLICY "Authenticated users can view pallet transactions"
  ON public.pallet_transactions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert pallet transactions" ON public.pallet_transactions;
CREATE POLICY "Authenticated users can insert pallet transactions"
  ON public.pallet_transactions FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can update or delete pallet transactions" ON public.pallet_transactions;
CREATE POLICY "Admins can update or delete pallet transactions"
  ON public.pallet_transactions FOR ALL TO authenticated USING (get_user_role() = 'admin');

-- Create a view to easily query customer and site pallet balances
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
  c.name AS customer_name,
  s.id AS site_id,
  s.name AS site_name,
  p.pallet_type,
  COALESCE(sc.total_sent, 0) AS total_sent,
  COALESCE(rc.total_returned, 0) AS total_returned,
  (COALESCE(sc.total_sent, 0) - COALESCE(rc.total_returned, 0)) AS balance
FROM (
  SELECT DISTINCT customer_id, site_id, pallet_type FROM public.pallet_transactions
) p
JOIN public.customers c ON p.customer_id = c.id
LEFT JOIN public.sites s ON p.site_id = s.id
LEFT JOIN sent_counts sc ON p.customer_id = sc.customer_id AND (p.site_id = sc.site_id OR (p.site_id IS NULL AND sc.site_id IS NULL)) AND p.pallet_type = sc.pallet_type
LEFT JOIN returned_counts rc ON p.customer_id = rc.customer_id AND (p.site_id = rc.site_id OR (p.site_id IS NULL AND rc.site_id IS NULL)) AND p.pallet_type = rc.pallet_type;
