-- Update v_product_stock to exclude external transit shipments from depleting factory production inventory
DROP VIEW IF EXISTS public.v_product_stock CASCADE;

CREATE VIEW public.v_product_stock
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
    COALESCE((SELECT SUM(ep.quantity) FROM public.external_purchases ep WHERE ep.product_id = p.id), 0) -
    COALESCE((
      SELECT SUM(si.m2) 
      FROM public.shipment_items si 
      JOIN public.shipments s ON si.shipment_id = s.id 
      WHERE si.product_id = p.id 
        AND s.status = 'completed' 
        AND s.supplier_name IS NULL
    ), 0)
  ) AS current_stock
FROM public.products p
WHERE p.is_active = true;
