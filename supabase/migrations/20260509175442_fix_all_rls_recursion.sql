/*
  # Fix infinite recursion in all RLS policies
*/

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

-- products
DROP POLICY IF EXISTS "Admins can insert products" ON products;
DROP POLICY IF EXISTS "Admins can update products" ON products;

CREATE POLICY "Admins can insert products"
  ON products FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Admins can update products"
  ON products FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- raw_materials
DROP POLICY IF EXISTS "Admins can insert raw materials" ON raw_materials;
DROP POLICY IF EXISTS "Admins can update raw materials" ON raw_materials;

CREATE POLICY "Admins can insert raw materials"
  ON raw_materials FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Admins can update raw materials"
  ON raw_materials FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- bom_items
DROP POLICY IF EXISTS "Admins can insert bom items" ON bom_items;
DROP POLICY IF EXISTS "Admins can update bom items" ON bom_items;
DROP POLICY IF EXISTS "Admins can delete bom items" ON bom_items;

CREATE POLICY "Admins can insert bom items"
  ON bom_items FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Admins can update bom items"
  ON bom_items FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Admins can delete bom items"
  ON bom_items FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');

-- customers
DROP POLICY IF EXISTS "Admins and field managers can insert customers" ON customers;
DROP POLICY IF EXISTS "Admins can update customers" ON customers;

CREATE POLICY "Admins and field managers can insert customers"
  ON customers FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

CREATE POLICY "Admins can update customers"
  ON customers FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'field_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

-- sites
DROP POLICY IF EXISTS "Admins and field managers can insert sites" ON sites;
DROP POLICY IF EXISTS "Admins can update sites" ON sites;

CREATE POLICY "Admins and field managers can insert sites"
  ON sites FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

CREATE POLICY "Admins can update sites"
  ON sites FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'field_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

-- production_entries
DROP POLICY IF EXISTS "Field managers and admins can insert production" ON production_entries;
DROP POLICY IF EXISTS "Admins can update production entries" ON production_entries;

CREATE POLICY "Field managers and admins can insert production"
  ON production_entries FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

CREATE POLICY "Admins can update production entries"
  ON production_entries FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'field_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

-- shipments
DROP POLICY IF EXISTS "Weighbridge and admins can insert shipments" ON shipments;
DROP POLICY IF EXISTS "Weighbridge and admins can update shipments" ON shipments;

CREATE POLICY "Weighbridge and admins can insert shipments"
  ON shipments FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'weighbridge'));

CREATE POLICY "Weighbridge and admins can update shipments"
  ON shipments FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'weighbridge'))
  WITH CHECK (get_user_role() IN ('admin', 'weighbridge'));

-- shipment_items
DROP POLICY IF EXISTS "Weighbridge and admins can insert shipment items" ON shipment_items;
DROP POLICY IF EXISTS "Weighbridge and admins can delete shipment items" ON shipment_items;

CREATE POLICY "Weighbridge and admins can insert shipment items"
  ON shipment_items FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'weighbridge'));

CREATE POLICY "Weighbridge and admins can delete shipment items"
  ON shipment_items FOR DELETE TO authenticated
  USING (get_user_role() IN ('admin', 'weighbridge'));

-- cost_entries
DROP POLICY IF EXISTS "Admins can insert cost entries" ON cost_entries;
DROP POLICY IF EXISTS "Admins can update cost entries" ON cost_entries;
DROP POLICY IF EXISTS "Admins can delete cost entries" ON cost_entries;

CREATE POLICY "Admins can insert cost entries"
  ON cost_entries FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Admins can update cost entries"
  ON cost_entries FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Admins can delete cost entries"
  ON cost_entries FOR DELETE TO authenticated
  USING (get_user_role() = 'admin');
