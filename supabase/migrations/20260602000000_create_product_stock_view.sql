-- Create v_product_stock view to query current product stock levels efficiently
CREATE OR REPLACE VIEW v_product_stock AS
SELECT 
  p.id AS product_id,
  p.name AS product_name,
  p.thickness,
  p.color,
  p.unit,
  p.min_stock_alert,
  COALESCE((SELECT SUM(pe.net_m2) FROM production_entries pe WHERE pe.product_id = p.id), 0) -
  COALESCE((SELECT SUM(si.m2) FROM shipment_items si JOIN shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id AND s.status = 'completed'), 0) AS current_stock
FROM products p
WHERE p.is_active = true;
