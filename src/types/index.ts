export type UserRole = 'admin' | 'field_manager' | 'weighbridge';

export interface UserProfile {
  id: string;
  full_name: string;
  role: UserRole;
  is_approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

export interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  product_type: string;
  thickness: string;
  color: string;
  unit: string;
  m2_per_pallet: number;
  min_stock_alert: number;
  is_active: boolean;
  created_at: string;
}

export interface BOMItem {
  id: string;
  product_id: string;
  raw_material_id: string;
  quantity_per_m2: number;
  raw_materials?: RawMaterial;
  products?: Product;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  tax_number: string;
  address: string;
  is_active: boolean;
  created_at: string;
}

export interface Site {
  id: string;
  customer_id: string;
  name: string;
  address: string;
  contact_person: string;
  contact_phone: string;
  is_active: boolean;
  customers?: Customer;
}

export interface ProductionEntry {
  id: string;
  date: string;
  shift: 'Gündüz' | 'Gece';
  machine_no: string;
  product_id: string;
  total_pallets: number;
  total_m2: number;
  waste_m2: number;
  net_m2: number;
  lot_number: string;
  notes: string;
  created_by: string;
  created_at: string;
  products?: Product;
}

export interface ShipmentItem {
  id: string;
  shipment_id: string;
  product_id: string;
  pallets: number;
  m2: number;
  unit: string;
  products?: Product;
}

export interface Shipment {
  id: string;
  invoice_no: string;
  customer_id: string;
  site_id: string | null;
  vehicle_plate: string;
  driver_name: string;
  driver_phone: string;
  gross_weight: number;
  tare_weight: number;
  net_weight: number;
  sale_price_per_m2: number;
  logistics_cost: number;
  total_m2: number;
  status: 'pending' | 'completed' | 'cancelled';
  shipment_date: string;
  notes: string;
  created_at: string;
  customers?: Customer;
  sites?: Site;
  shipment_items?: ShipmentItem[];
}

export interface CostEntry {
  id: string;
  date: string;
  period_month: number;
  period_year: number;
  cost_type: 'hammadde' | 'operasyonel' | 'genel';
  sub_type: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  transport_cost: number;
  total_amount: number;
  created_at: string;
}

export interface StockSummary {
  product_id: string;
  product_name: string;
  product_type: string;
  thickness: string;
  color: string;
  total_produced: number;
  total_waste: number;
  total_shipped: number;
  current_stock: number;
  min_stock_alert: number;
}
