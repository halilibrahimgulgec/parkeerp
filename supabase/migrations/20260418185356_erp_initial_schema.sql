/*
  # Parke Taşı Fabrikası ERP - Ana Veritabanı Şeması

  ## Genel Açıklama
  Parke taşı üretim tesisi için tam kapsamlı ERP sistemi şeması.
  Üretim, stok, sevkiyat ve maliyet modüllerini kapsar.

  ## Yeni Tablolar
  
  ### 1. user_profiles
  - Kullanıcı rolleri: admin, field_manager (saha sorumlusu), weighbridge (kantar görevlisi)
  
  ### 2. raw_materials (Hammaddeler)
  - Çimento, Agrega, Boya ve diğer hammadde tanımları
  
  ### 3. products (Ürün Kartları)
  - Ürün adı, kalınlık, renk, birim, palet başına m2 bilgisi
  
  ### 4. bom_items (Reçete / BOM)
  - Ürün başına m2 bazında hammadde miktarları
  
  ### 5. customers (Müşteriler)
  - Müşteri bilgileri ve vergi numarası
  
  ### 6. sites (Şantiyeler)
  - Müşteriye bağlı birden fazla şantiye adresi
  
  ### 7. production_entries (Üretim Girişleri)
  - Tarih, vardiya, makine, ürün, palet, fire, lot numarası
  
  ### 8. shipments (Sevkiyatlar / İrsaliyeler)
  - İrsaliye, müşteri, araç, kantar bilgileri, satış fiyatı
  
  ### 9. shipment_items (Sevkiyat Kalemleri)
  - Her sevkiyattaki ürün detayları
  
  ### 10. cost_entries (Maliyet Girdileri)
  - Hammadde, operasyonel ve genel giderler
  
  ## Güvenlik
  - Tüm tablolarda RLS aktif
  - Kullanıcı rollerine göre erişim politikaları
*/

-- =============================================
-- USER PROFILES
-- =============================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'field_manager'
    CHECK (role IN ('admin', 'field_manager', 'weighbridge')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- =============================================
-- RAW MATERIALS (Hammaddeler)
-- =============================================
CREATE TABLE IF NOT EXISTS raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'kg',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view raw materials"
  ON raw_materials FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert raw materials"
  ON raw_materials FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update raw materials"
  ON raw_materials FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- PRODUCTS (Ürün Kartları)
-- =============================================
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

CREATE POLICY "Authenticated users can view products"
  ON products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update products"
  ON products FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- BOM ITEMS (Reçete)
-- =============================================
CREATE TABLE IF NOT EXISTS bom_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity_per_m2 numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, raw_material_id)
);

ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bom items"
  ON bom_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert bom items"
  ON bom_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update bom items"
  ON bom_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete bom items"
  ON bom_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- CUSTOMERS (Müşteriler)
-- =============================================
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

CREATE POLICY "Authenticated users can view customers"
  ON customers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and field managers can insert customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'field_manager'))
  );

CREATE POLICY "Admins can update customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- SITES (Şantiyeler)
-- =============================================
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

CREATE POLICY "Authenticated users can view sites"
  ON sites FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and field managers can insert sites"
  ON sites FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'field_manager'))
  );

CREATE POLICY "Admins can update sites"
  ON sites FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- PRODUCTION ENTRIES (Üretim Girişleri)
-- =============================================
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

CREATE POLICY "Authenticated users can view production entries"
  ON production_entries FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Field managers and admins can insert production"
  ON production_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'field_manager'))
  );

CREATE POLICY "Admins can update production entries"
  ON production_entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- SHIPMENTS (Sevkiyatlar)
-- =============================================
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

CREATE POLICY "Authenticated users can view shipments"
  ON shipments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Weighbridge and admins can insert shipments"
  ON shipments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'weighbridge'))
  );

CREATE POLICY "Weighbridge and admins can update shipments"
  ON shipments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'weighbridge'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'weighbridge'))
  );

-- =============================================
-- SHIPMENT ITEMS (Sevkiyat Kalemleri)
-- =============================================
CREATE TABLE IF NOT EXISTS shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  pallets numeric NOT NULL DEFAULT 0,
  m2 numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE shipment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view shipment items"
  ON shipment_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Weighbridge and admins can insert shipment items"
  ON shipment_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'weighbridge'))
  );

CREATE POLICY "Weighbridge and admins can delete shipment items"
  ON shipment_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'weighbridge'))
  );

-- =============================================
-- COST ENTRIES (Maliyet Girdileri)
-- =============================================
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

CREATE POLICY "Authenticated users can view cost entries"
  ON cost_entries FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert cost entries"
  ON cost_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update cost entries"
  ON cost_entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete cost entries"
  ON cost_entries FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_production_entries_date ON production_entries(date);
CREATE INDEX IF NOT EXISTS idx_production_entries_product ON production_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(shipment_date);
CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_cost_entries_period ON cost_entries(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_product ON bom_items(product_id);

-- =============================================
-- SEED DEFAULT DATA
-- =============================================
INSERT INTO raw_materials (name, unit) VALUES
  ('Çimento', 'kg'),
  ('Agrega / Kum', 'kg'),
  ('Boya', 'gr'),
  ('Su', 'litre'),
  ('Katkı Maddesi', 'kg')
ON CONFLICT DO NOTHING;
