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
  plan_item_id?: string | null;
  created_by: string;
  created_at: string;
  products?: Product;
}

export interface ShipmentItem {
  id: string;
  shipment_id: string;
  product_id: string;
  pallets: number;
  pallet_type?: string;
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
  supplier_name?: string | null;
  created_at: string;
  customers?: Customer;
  sites?: Site;
  shipment_items?: ShipmentItem[];
  external_purchases?: ExternalPurchase[] | ExternalPurchase | null;
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

export interface Employee {
  id: string;
  full_name: string;
  role_title: string;
  phone: string;
  tc_no: string;
  start_date: string;
  wage_type: 'monthly' | 'daily';
  base_wage: number;
  overtime_multiplier: number;
  monthly_hours_divisor: number;
  iban: string;
  default_shift?: 'Gündüz' | 'Gece';
  is_active: boolean;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  status: 'full_day' | 'half_day' | 'leave' | 'absent' | 'holiday';
  shift?: 'Gündüz' | 'Gece';
  overtime_hours: number;
  overtime_multiplier: number;
  notes: string;
  created_at: string;
  employees?: Employee;
}

export interface PayrollTransaction {
  id: string;
  employee_id: string;
  date: string;
  type: 'advance' | 'bonus' | 'deduction';
  amount: number;
  description: string;
  period_month: number;
  period_year: number;
  created_at: string;
  employees?: Employee;
}

export interface PayrollPayment {
  id: string;
  employee_id: string;
  period_month: number;
  period_year: number;
  base_salary: number;
  days_worked: number;
  earned_base_wage: number;
  overtime_hours: number;
  overtime_amount: number;
  bonus_amount: number;
  deduction_amount: number;
  advance_amount: number;
  net_salary: number;
  is_paid: boolean;
  payment_date?: string | null;
  notes?: string;
  created_at: string;
  employees?: Employee;
}

export interface CustomerQuota {
  id: string;
  customer_id: string;
  site_id?: string | null;
  product_id?: string | null;
  target_quantity: number;
  unit: 'm2' | 'metre' | 'adet';
  alert_threshold_pct: number;
  start_date: string;
  end_date?: string | null;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  customers?: Customer;
  sites?: Site;
  products?: Product;
  // Computed fields for UI
  shipped_quantity?: number;
  remaining_quantity?: number;
  completion_pct?: number;
}

export interface ExternalPurchase {
  id: string;
  date: string;
  supplier_name: string;
  supplier_invoice_no?: string;
  product_id: string;
  quantity: number;
  unit: 'm2' | 'metre' | 'adet';
  pallets: number;
  pallet_type: string;
  unit_price: number;
  total_price?: number;
  vehicle_plate?: string;
  driver_name?: string;
  is_direct_shipment: boolean;
  linked_shipment_id?: string | null;
  notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  products?: Product;
  shipments?: Shipment;
}

export interface SupplierPalletTransaction {
  id: string;
  date: string;
  supplier_name: string;
  purchase_id?: string | null;
  transaction_type: 'received' | 'returned';
  pallet_type: 'tahta' | 'sevkiyat' | 'uretim' | 'dokme';
  quantity: number;
  vehicle_plate?: string;
  driver_name?: string;
  notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  external_purchases?: ExternalPurchase;
}

export interface SupplierPalletBalance {
  supplier_name: string;
  pallet_type: 'tahta' | 'sevkiyat' | 'uretim' | 'dokme';
  total_received: number;
  total_returned: number;
  balance: number;
}

export interface MachineDefinition {
  machine_no: string;
  name: string;
  daily_capacity_m2: number;
  shift_count: number;
  specialized_types?: string[];
  product_capacities?: Record<string, number>;
  notes?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProductionOrder {
  id: string;
  order_no: string;
  customer_id?: string | null;
  site_id?: string | null;
  product_id: string;
  quantity: number;
  unit: 'm2' | 'metre' | 'adet';
  due_date?: string | null;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'pending' | 'planned' | 'in_production' | 'completed' | 'cancelled';
  notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  customers?: Customer;
  sites?: Site;
  products?: Product;
}

export interface ProductionPlan {
  id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  ai_summary?: {
    total_planned_m2?: number;
    machine1_m2?: number;
    machine2_m2?: number;
    mold_changes_saved?: number;
    reasoning?: string[];
    critical_alerts?: string[];
  };
  notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  items?: ProductionPlanItem[];
}

export interface ProductionPlanItem {
  id: string;
  plan_id: string;
  machine_no: string;
  planned_date: string;
  shift: 'Gündüz' | 'Gece';
  product_id: string;
  order_id?: string | null;
  quota_id?: string | null;
  planned_m2: number;
  planned_pallets: number;
  produced_m2: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  sequence_order: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  products?: Product;
  production_orders?: ProductionOrder;
  customer_quotas?: CustomerQuota;
}

