export type AIActionType = 'create_shipment' | 'create_production' | 'return_pallet' | 'create_purchase';

export type AIActionStatus = 'draft' | 'confirming' | 'confirmed' | 'cancelled' | 'error';

export interface ShipmentItemDraft {
  product_id: string;
  product_name: string;
  pallets: number;
  pallet_type: 'tahta' | 'uretim' | 'sevkiyat' | 'dokme';
  m2: number;
  unit: string;
}

export interface ActionDraftPayload {
  id: string;
  type: AIActionType;
  status: AIActionStatus;
  title: string;
  description: string;
  createdAt: string;

  // 1. Shipment draft
  shipmentData?: {
    customer_id: string;
    customer_name: string;
    site_id?: string;
    site_name?: string;
    vehicle_plate?: string;
    driver_name?: string;
    driver_phone?: string;
    items: ShipmentItemDraft[];
    total_m2: number;
    total_pallets: number;
    estimated_tonnage: number;
    gross_weight?: number;
    tare_weight?: number;
    net_weight?: number;
    notes?: string;
    is_external?: boolean;
    supplier_name?: string;
  };

  // 2. Production draft
  productionData?: {
    product_id: string;
    product_name: string;
    machine_id?: string;
    machine_name?: string;
    date: string;
    shift: 'Gündüz' | 'Gece';
    total_pallets: number;
    total_m2: number;
    waste_m2: number;
    net_m2: number;
    notes?: string;
  };

  // 3. Pallet return draft
  palletReturnData?: {
    customer_id: string;
    customer_name: string;
    site_id?: string;
    site_name?: string;
    date: string;
    pallet_type: 'tahta' | 'uretim' | 'sevkiyat';
    quantity: number;
    vehicle_plate?: string;
    driver_name?: string;
    notes?: string;
  };

  // 4. Raw Material / Purchase draft (from Photo OCR)
  purchaseData?: {
    supplier_name: string;
    invoice_no?: string;
    supplier_invoice_no?: string;
    vehicle_plate?: string;
    driver_name?: string;
    material_name?: string;
    product_name?: string;
    product_id?: string;
    material_type: 'cimento' | 'agrega' | 'katki' | 'parke_dis_alim' | 'diger';
    quantity: number;
    net_quantity?: number;
    unit: string;
    unit_price?: number;
    total_amount?: number;
    currency?: string;
    notes?: string;
  };

  // 5. Quality inspection diagnosis (from Defect Photo)
  qualityInspectionData?: {
    defect_type: string;
    severity: 'dusuk' | 'orta' | 'yuksek' | 'kritik';
    detected_product?: string;
    root_cause_analysis: string;
    recommended_action: string;
  };

  resultMessage?: string;
  errorMessage?: string;
  createdRecordId?: string;
}
