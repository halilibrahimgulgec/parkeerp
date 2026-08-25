/*
  # Full ERP Schema Creation

  Creates all tables for parke_erp application:
  - user_profiles, raw_materials, products, bom_items
  - customers, sites, production_entries
  - shipments, shipment_items, cost_entries
  With RLS policies and indexes.
*/

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'field_manager'
    CHECK (role IN ('admin', 'field_manager', 'weighbridge')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'kg',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view raw materials" ON raw_materials;
CREATE POLICY "Authenticated users can view raw materials"
  ON raw_materials FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  product_type text NOT NULL DEFAULT 'Kilitli',
  thickness text NOT NULL DEFAULT '6cm',
  color text NOT NULL DEFAULT 'Gri',
  unit text NOT NULL DEFAULT 'm2' CHECK (unit IN ('m2', 'adet')),
  m2_per_pallet numeric NOT NULL DEFAULT 10,
  min_stock_alert numeric NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view products" ON products;
CREATE POLICY "Authenticated users can view products"
  ON products FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS bom_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity_per_m2 numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, raw_material_id)
);

ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view bom items" ON bom_items;
CREATE POLICY "Authenticated users can view bom items"
  ON bom_items FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  tax_number text DEFAULT '',
  address text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view customers" ON customers;
CREATE POLICY "Authenticated users can view customers"
  ON customers FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text DEFAULT '',
  contact_person text DEFAULT '',
  contact_phone text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view sites" ON sites;
CREATE POLICY "Authenticated users can view sites"
  ON sites FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS production_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  shift text NOT NULL DEFAULT 'Gündüz' CHECK (shift IN ('Gündüz', 'Gece')),
  machine_no text NOT NULL DEFAULT '1',
  product_id uuid NOT NULL REFERENCES products(id),
  total_pallets numeric NOT NULL DEFAULT 0,
  total_m2 numeric NOT NULL DEFAULT 0,
  waste_m2 numeric NOT NULL DEFAULT 0,
  net_m2 numeric GENERATED ALWAYS AS (total_m2 - waste_m2) STORED,
  lot_number text NOT NULL DEFAULT '',
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view production entries" ON production_entries;
CREATE POLICY "Authenticated users can view production entries"
  ON production_entries FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL DEFAULT '',
  customer_id uuid NOT NULL REFERENCES customers(id),
  site_id uuid REFERENCES sites(id),
  vehicle_plate text NOT NULL DEFAULT '',
  driver_name text DEFAULT '',
  driver_phone text DEFAULT '',
  gross_weight numeric DEFAULT 0,
  tare_weight numeric DEFAULT 0,
  net_weight numeric GENERATED ALWAYS AS (GREATEST(gross_weight - tare_weight, 0)) STORED,
  sale_price_per_m2 numeric DEFAULT 0,
  logistics_cost numeric DEFAULT 0,
  total_m2 numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
  shipment_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view shipments" ON shipments;
CREATE POLICY "Authenticated users can view shipments"
  ON shipments FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  pallets numeric NOT NULL DEFAULT 0,
  m2 numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE shipment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view shipment items" ON shipment_items;
CREATE POLICY "Authenticated users can view shipment items"
  ON shipment_items FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  period_month integer NOT NULL DEFAULT EXTRACT(MONTH FROM CURRENT_DATE)::integer,
  period_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::integer,
  cost_type text NOT NULL CHECK (cost_type IN ('hammadde', 'operasyonel', 'genel')),
  sub_type text NOT NULL DEFAULT '',
  description text DEFAULT '',
  quantity numeric DEFAULT 0,
  unit text DEFAULT '',
  unit_price numeric DEFAULT 0,
  transport_cost numeric DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cost_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view cost entries" ON cost_entries;
CREATE POLICY "Authenticated users can view cost entries"
  ON cost_entries FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "Admins can insert raw materials" ON raw_materials;
DROP POLICY IF EXISTS "Admins can update raw materials" ON raw_materials;
CREATE POLICY "Admins can insert raw materials" ON raw_materials FOR INSERT TO authenticated WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Admins can update raw materials" ON raw_materials FOR UPDATE TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can insert products" ON products;
DROP POLICY IF EXISTS "Admins can update products" ON products;
CREATE POLICY "Admins can insert products" ON products FOR INSERT TO authenticated WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Admins can update products" ON products FOR UPDATE TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can insert bom items" ON bom_items;
DROP POLICY IF EXISTS "Admins can update bom items" ON bom_items;
DROP POLICY IF EXISTS "Admins can delete bom items" ON bom_items;
CREATE POLICY "Admins can insert bom items" ON bom_items FOR INSERT TO authenticated WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Admins can update bom items" ON bom_items FOR UPDATE TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Admins can delete bom items" ON bom_items FOR DELETE TO authenticated USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins and field managers can insert customers" ON customers;
DROP POLICY IF EXISTS "Admins can update customers" ON customers;
CREATE POLICY "Admins and field managers can insert customers" ON customers FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('admin', 'field_manager'));
CREATE POLICY "Admins can update customers" ON customers FOR UPDATE TO authenticated USING (get_user_role() IN ('admin', 'field_manager')) WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

DROP POLICY IF EXISTS "Admins and field managers can insert sites" ON sites;
DROP POLICY IF EXISTS "Admins can update sites" ON sites;
CREATE POLICY "Admins and field managers can insert sites" ON sites FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('admin', 'field_manager'));
CREATE POLICY "Admins can update sites" ON sites FOR UPDATE TO authenticated USING (get_user_role() IN ('admin', 'field_manager')) WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

DROP POLICY IF EXISTS "Field managers and admins can insert production" ON production_entries;
DROP POLICY IF EXISTS "Admins can update production entries" ON production_entries;
CREATE POLICY "Field managers and admins can insert production" ON production_entries FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('admin', 'field_manager'));
CREATE POLICY "Admins can update production entries" ON production_entries FOR UPDATE TO authenticated USING (get_user_role() IN ('admin', 'field_manager')) WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

DROP POLICY IF EXISTS "Weighbridge and admins can insert shipments" ON shipments;
DROP POLICY IF EXISTS "Weighbridge and admins can update shipments" ON shipments;
CREATE POLICY "Weighbridge and admins can insert shipments" ON shipments FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('admin', 'weighbridge'));
CREATE POLICY "Weighbridge and admins can update shipments" ON shipments FOR UPDATE TO authenticated USING (get_user_role() IN ('admin', 'weighbridge')) WITH CHECK (get_user_role() IN ('admin', 'weighbridge'));

DROP POLICY IF EXISTS "Weighbridge and admins can insert shipment items" ON shipment_items;
DROP POLICY IF EXISTS "Weighbridge and admins can delete shipment items" ON shipment_items;
CREATE POLICY "Weighbridge and admins can insert shipment items" ON shipment_items FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('admin', 'weighbridge'));
CREATE POLICY "Weighbridge and admins can delete shipment items" ON shipment_items FOR DELETE TO authenticated USING (get_user_role() IN ('admin', 'weighbridge'));

DROP POLICY IF EXISTS "Admins can insert cost entries" ON cost_entries;
DROP POLICY IF EXISTS "Admins can update cost entries" ON cost_entries;
DROP POLICY IF EXISTS "Admins can delete cost entries" ON cost_entries;
CREATE POLICY "Admins can insert cost entries" ON cost_entries FOR INSERT TO authenticated WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Admins can update cost entries" ON cost_entries FOR UPDATE TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Admins can delete cost entries" ON cost_entries FOR DELETE TO authenticated USING (get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_production_entries_date ON production_entries(date);
CREATE INDEX IF NOT EXISTS idx_production_entries_product ON production_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(shipment_date);
CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_cost_entries_period ON cost_entries(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_product ON bom_items(product_id);

INSERT INTO raw_materials (name, unit) VALUES
  ('Çimento', 'kg'),
  ('Agrega / Kum', 'kg'),
  ('Boya', 'gr'),
  ('Su', 'litre'),
  ('Katkı Maddesi', 'kg')
ON CONFLICT DO NOTHING;
