import { supabase } from '../lib/supabase';
import { ActionDraftPayload, ShipmentItemDraft } from '../types/aiActionTypes';
import { FactorySnapshot, normalizeTurkish } from './aiFactoryBrain';

/**
 * 1. PARSE ACTION INTENT FROM OPERATOR QUERY
 * Analyzes natural language commands to detect actionable intents and builds draft previews.
 */
export async function parseActionIntentFromQuery(
  query: string,
  factoryData: FactorySnapshot
): Promise<ActionDraftPayload | null> {
  const qNorm = normalizeTurkish(query);
  if (!qNorm) return null;

  // -------------------------------------------------------------------------
  // A. INTENT: SHIPMENT & WEIGHBRIDGE SLIP (Kantar & Sevkiyat Fişi Hazırlama)
  // -------------------------------------------------------------------------
  const isShipmentIntent =
    qNorm.includes('kantar fisi') ||
    qNorm.includes('kantar fisi hazirla') ||
    qNorm.includes('sevkiyat olustur') ||
    qNorm.includes('sevk et') ||
    qNorm.includes('kamyona yukle') ||
    qNorm.includes('araca yukle') ||
    qNorm.includes('irsaliye kes') ||
    qNorm.includes('irsaliye hazirla') ||
    qNorm.includes('fisi hazirla') ||
    qNorm.includes('cikis yap') ||
    (qNorm.includes('palet') && qNorm.includes('yukle')) ||
    (qNorm.includes('kamyon') && qNorm.includes('yukle'));

  if (isShipmentIntent) {
    // 1. Extract Vehicle Plate (e.g. 46 K 1234, 46AFB273, 46 AFB 273)
    let detectedPlate: string | undefined = undefined;
    const plateMatch = query.match(/\b(\d{2})\s*([A-Z]{1,3})\s*(\d{2,4})\b/i);
    if (plateMatch) {
      detectedPlate = `${plateMatch[1]} ${plateMatch[2].toUpperCase()} ${plateMatch[3]}`;
    }

    // 2. Match Customer
    let matchedCustomer: { id: string; name: string } | null = null;
    try {
      const { data: custList } = await supabase.from('customers').select('id, name').eq('is_active', true);
      if (custList && custList.length > 0) {
        for (const c of custList) {
          const cNorm = normalizeTurkish(c.name);
          if (cNorm.length >= 3 && qNorm.includes(cNorm)) {
            matchedCustomer = c;
            break;
          }
        }
      }
    } catch {}

    // Fallback match from factory data debtors/shipments if offline
    if (!matchedCustomer) {
      const debtor = factoryData.palletDebtors.find(d => {
        const dNorm = normalizeTurkish(d.customer);
        return dNorm.length >= 3 && qNorm.includes(dNorm);
      });
      if (debtor) {
        matchedCustomer = { id: '', name: debtor.customer };
      }
    }

    // Default customer if none matched
    const customerName = matchedCustomer?.name || 'Ahmet Yılmaz (Müşteri)';

    // 3. Match Site (e.g. Altınova, Hacı Kel, Mustafa Kaya, Merkez)
    let siteName: string | undefined = undefined;
    const knownSites = ['Altınova', 'Hacı Kel', 'Mustafa Kaya', 'Mustafa Yılmaz', 'Merkez'];
    for (const s of knownSites) {
      if (qNorm.includes(normalizeTurkish(s))) {
        siteName = s;
        break;
      }
    }

    // 4. Extract Pallet or M2 quantity
    let pallets = 0;
    const palletMatch = query.match(/(\d+)\s*(?:adet)?\s*palet/i);
    if (palletMatch) {
      pallets = parseInt(palletMatch[1], 10);
    }

    let m2 = 0;
    const m2Match = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:m2|metrekare|m²)/i);
    if (m2Match) {
      m2 = parseFloat(m2Match[1].replace(',', '.'));
    }

    // 5. Match Product (e.g. 8'lik Kilit Parke, 10'luk Parke, 20x10 Prizma, 50x25 Bordür)
    let productName = "8'lik Kilit Parke Gri";
    let productId = '';
    let unit = 'm²';
    let m2PerPallet = 10.66;

    if (qNorm.includes('10 luk') || qNorm.includes('10\'luk') || qNorm.includes('10luk')) {
      productName = "10'luk Naturel Parke Taşı";
      m2PerPallet = 8.5;
    } else if (qNorm.includes('prizma') || qNorm.includes('20x10')) {
      productName = "20x10x6 Prizma Parke Gri";
      m2PerPallet = 10.0;
    } else if (qNorm.includes('bordur') || qNorm.includes('50x25') || qNorm.includes('ankara')) {
      productName = "50x25x20 Ankara Bordürü";
      unit = 'Metre';
      m2PerPallet = 15.0;
    }

    // Try finding exact product from snapshot
    if (factoryData.allProductsStock && factoryData.allProductsStock.length > 0) {
      const foundProd = factoryData.allProductsStock.find(p => {
        const pNorm = normalizeTurkish(p.name);
        return pNorm.length >= 4 && qNorm.includes(pNorm);
      });
      if (foundProd) {
        productName = foundProd.name;
        productId = foundProd.id;
        unit = foundProd.unit.toLowerCase() === 'm2' ? 'm²' : foundProd.unit;
      }
    }

    // Calculate totals
    if (pallets > 0 && m2 === 0) {
      m2 = Math.round(pallets * m2PerPallet);
    } else if (m2 > 0 && pallets === 0) {
      pallets = Math.ceil(m2 / m2PerPallet);
    } else if (pallets === 0 && m2 === 0) {
      pallets = 15;
      m2 = Math.round(15 * m2PerPallet);
    }

    // Estimated weight (1 m2 parke ~ 180 kg)
    const estimatedTonnage = Number(((m2 * 180) / 1000).toFixed(2));

    const itemDraft: ShipmentItemDraft = {
      product_id: productId || 'prod-auto-match',
      product_name: productName,
      pallets,
      pallet_type: 'sevkiyat',
      m2,
      unit,
    };

    return {
      id: `draft-ship-${Date.now()}`,
      type: 'create_shipment',
      status: 'draft',
      title: 'Taslak Kantar & Sevkiyat Fişi',
      description: `${customerName} için ${pallets} palet (${m2} ${unit}) sevkiyat taslağı hazırlandı.`,
      createdAt: new Date().toISOString(),
      shipmentData: {
        customer_id: matchedCustomer?.id || '',
        customer_name: customerName,
        site_name: siteName || 'Ana Şantiye / Merkez',
        vehicle_plate: detectedPlate || '46 K 1234',
        driver_name: 'Kayıtlı Sürücü',
        items: [itemDraft],
        total_m2: m2,
        total_pallets: pallets,
        estimated_tonnage: estimatedTonnage,
        notes: `AI Saha Asistanı ile sesli/hızlı komutla oluşturuldu.`,
      },
    };
  }

  // -------------------------------------------------------------------------
  // B. INTENT: PRODUCTION ENTRY (Vardiya İmalat Girişi)
  // -------------------------------------------------------------------------
  const isProductionIntent =
    qNorm.includes('uretim girisi') ||
    qNorm.includes('uretim kaydet') ||
    qNorm.includes('baski yapildi') ||
    qNorm.includes('makinede basildi') ||
    (qNorm.includes('makine') && qNorm.includes('basil')) ||
    (qNorm.includes('vardiya') && qNorm.includes('uret'));

  if (isProductionIntent) {
    let machineNo = '1';
    let machineName = '1 Nolu Parke Pres Makinesi';
    if (qNorm.includes('2 nolu') || qNorm.includes('makine 2') || qNorm.includes('bordur')) {
      machineNo = '2';
      machineName = '2 Nolu Bordür Pres Makinesi';
    }

    let pallets = 0;
    const palletMatch = query.match(/(\d+)\s*(?:adet)?\s*palet/i);
    if (palletMatch) pallets = parseInt(palletMatch[1], 10);

    let m2 = 0;
    const m2Match = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:m2|metrekare|m²)/i);
    if (m2Match) m2 = parseFloat(m2Match[1].replace(',', '.'));

    let wasteM2 = 0;
    const wasteMatch = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:m2|metrekare)?\s*(?:fire|iskarta)/i);
    if (wasteMatch) wasteM2 = parseFloat(wasteMatch[1].replace(',', '.'));

    let productName = machineNo === '1' ? "8'lik Kilit Parke Gri" : "50x25x20 Ankara Bordürü";
    if (m2 === 0 && pallets > 0) m2 = pallets * 10.66;
    if (m2 === 0) m2 = 500;
    if (pallets === 0) pallets = Math.ceil(m2 / 10.66);

    const netM2 = Math.max(0, m2 - wasteM2);

    return {
      id: `draft-prod-${Date.now()}`,
      type: 'create_production',
      status: 'draft',
      title: 'Taslak Vardiya Üretim Girişi',
      description: `${machineName} için ${netM2} m² net üretim kaydı hazırlandı.`,
      createdAt: new Date().toISOString(),
      productionData: {
        product_id: '',
        product_name: productName,
        machine_id: machineNo,
        machine_name: machineName,
        date: factoryData.todayDate,
        shift: 'Gündüz',
        total_pallets: pallets,
        total_m2: m2,
        waste_m2: wasteM2,
        net_m2: netM2,
        notes: 'AI Saha Asistanı ile hızlı üretim girişi.',
      },
    };
  }

  // -------------------------------------------------------------------------
  // C. INTENT: PALLET RETURN (Palet İadesi Alma)
  // -------------------------------------------------------------------------
  const isPalletReturnIntent =
    qNorm.includes('palet iade') ||
    qNorm.includes('iade geldi') ||
    qNorm.includes('bos palet geldi') ||
    qNorm.includes('iade alindi') ||
    qNorm.includes('palet getirdi');

  if (isPalletReturnIntent) {
    let qty = 0;
    const qtyMatch = query.match(/(\d+)\s*(?:adet)?\s*(?:palet|tahta|uretim)/i);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
    if (qty === 0) qty = 40;

    let palletType: 'tahta' | 'uretim' | 'sevkiyat' = 'tahta';
    if (qNorm.includes('uretim') || qNorm.includes('celik')) {
      palletType = 'uretim';
    } else if (qNorm.includes('sevkiyat')) {
      palletType = 'sevkiyat';
    }

    let customerName = 'MEDİKENT';
    const debtor = factoryData.palletDebtors.find(d => {
      const dNorm = normalizeTurkish(d.customer);
      return dNorm.length >= 3 && qNorm.includes(dNorm);
    });
    if (debtor) customerName = debtor.customer;

    return {
      id: `draft-pallet-${Date.now()}`,
      type: 'return_pallet',
      status: 'draft',
      title: 'Taslak Boş Palet İade Girişi',
      description: `${customerName} şantiyesinden ${qty} adet ${palletType === 'uretim' ? 'Üretim' : 'Tahta'} Palet iadesi alındı.`,
      createdAt: new Date().toISOString(),
      palletReturnData: {
        customer_id: '',
        customer_name: customerName,
        date: factoryData.todayDate,
        pallet_type: palletType,
        quantity: qty,
        notes: 'AI Saha Asistanı ile oluşturulan boş palet iade kabulü.',
      },
    };
  }

  return null;
}

/**
 * 2. EXECUTE APPROVED ACTION
 * Writes the operator-approved draft to the Supabase database.
 */
export async function executeApprovedAction(
  draft: ActionDraftPayload,
  currentUser: any
): Promise<{ success: boolean; message: string; recordId?: string; invoiceNo?: string }> {
  try {
    // -----------------------------------------------------------------------
    // 1. SHIPMENT EXECUTION
    // -----------------------------------------------------------------------
    if (draft.type === 'create_shipment' && draft.shipmentData) {
      const d = draft.shipmentData;

      // Find or resolve customer ID
      let customerId = d.customer_id;
      if (!customerId) {
        const { data: custs } = await supabase
          .from('customers')
          .select('id, name')
          .ilike('name', `%${d.customer_name}%`)
          .limit(1);
        customerId = custs?.[0]?.id || '';
      }

      if (!customerId) {
        // Find any active customer or create/fallback
        const { data: anyCust } = await supabase.from('customers').select('id').limit(1);
        customerId = anyCust?.[0]?.id || '';
      }

      // Generate invoice number (Find latest invoice and increment)
      const { data: lastShipment } = await supabase
        .from('shipments')
        .select('invoice_no')
        .order('created_at', { ascending: false })
        .limit(1);

      let nextInvNo = '2458';
      if (lastShipment && lastShipment[0]?.invoice_no) {
        const parsed = parseInt(lastShipment[0].invoice_no, 10);
        if (!isNaN(parsed) && parsed > 0) {
          nextInvNo = String(parsed + 1);
        }
      }

      const gross = (d.estimated_tonnage * 1000) + 14000;
      const tare = 14000;
      const net = d.estimated_tonnage * 1000;

      // A. Insert Shipment
      const { data: newShipment, error: shipErr } = await supabase
        .from('shipments')
        .insert({
          invoice_no: nextInvNo,
          customer_id: customerId,
          site_id: d.site_id || null,
          vehicle_plate: d.vehicle_plate || '46 K 1234',
          driver_name: d.driver_name || 'Kayıtlı Şoför',
          gross_weight: gross,
          tare_weight: tare,
          net_weight: net,
          total_m2: d.total_m2,
          status: 'completed',
          shipment_date: new Date().toISOString().split('T')[0],
          notes: `${d.notes || ''} [İrsaliye No: ${nextInvNo}]`,
          created_by: currentUser?.id,
        })
        .select()
        .single();

      if (shipErr || !newShipment) {
        throw new Error(shipErr?.message || 'Sevkiyat kaydı oluşturulamadı.');
      }

      // B. Insert Shipment Items
      if (d.items && d.items.length > 0) {
        // Resolve a valid product_id
        let validProductId = d.items[0].product_id;
        if (!validProductId || validProductId.includes('auto')) {
          const { data: prods } = await supabase.from('products').select('id').limit(1);
          validProductId = prods?.[0]?.id || '';
        }

        const itemsToInsert = d.items.map(it => ({
          shipment_id: newShipment.id,
          product_id: validProductId,
          pallets: it.pallets,
          pallet_type: it.pallet_type || 'sevkiyat',
          m2: it.m2,
          unit: it.unit || 'm2',
        }));

        await supabase.from('shipment_items').insert(itemsToInsert);

        // C. Record Sent Pallets
        if (d.total_pallets > 0) {
          await supabase.from('pallet_transactions').insert({
            date: new Date().toISOString().split('T')[0],
            customer_id: customerId,
            site_id: d.site_id || null,
            shipment_id: newShipment.id,
            transaction_type: 'sent',
            pallet_type: 'sevkiyat',
            quantity: d.total_pallets,
            notes: `${nextInvNo} no'lu sevkiyat ile şantiyeye sevk edildi.`,
            created_by: currentUser?.id,
          });
        }
      }

      return {
        success: true,
        message: `İrsaliye No: ${nextInvNo} ile kantar sevkiyatı başarıyla kaydedildi!`,
        recordId: newShipment.id,
        invoiceNo: nextInvNo,
      };
    }

    // -----------------------------------------------------------------------
    // 2. PRODUCTION ENTRY EXECUTION
    // -----------------------------------------------------------------------
    if (draft.type === 'create_production' && draft.productionData) {
      const p = draft.productionData;

      let validProdId = p.product_id;
      if (!validProdId) {
        const { data: prods } = await supabase.from('products').select('id').limit(1);
        validProdId = prods?.[0]?.id || '';
      }

      const { data: newProd, error: prodErr } = await supabase
        .from('production_entries')
        .insert({
          date: p.date,
          shift: p.shift,
          machine_no: p.machine_id || '1',
          product_id: validProdId,
          total_pallets: p.total_pallets,
          total_m2: p.total_m2,
          waste_m2: p.waste_m2,
          net_m2: p.net_m2,
          lot_number: `LOT-${Date.now().toString().slice(-6)}`,
          notes: p.notes || 'AI Saha Asistanı Vardiya Girişi',
          created_by: currentUser?.id,
        })
        .select()
        .single();

      if (prodErr || !newProd) {
        throw new Error(prodErr?.message || 'Üretim kaydı oluşturulamadı.');
      }

      return {
        success: true,
        message: `${p.machine_name} için ${p.net_m2} m² net üretim başarıyla kaydedildi!`,
        recordId: newProd.id,
      };
    }

    // -----------------------------------------------------------------------
    // 3. PALLET RETURN EXECUTION
    // -----------------------------------------------------------------------
    if (draft.type === 'return_pallet' && draft.palletReturnData) {
      const pal = draft.palletReturnData;

      let customerId = pal.customer_id;
      if (!customerId) {
        const { data: custs } = await supabase
          .from('customers')
          .select('id, name')
          .ilike('name', `%${pal.customer_name}%`)
          .limit(1);
        customerId = custs?.[0]?.id || '';
      }

      if (!customerId) {
        const { data: anyCust } = await supabase.from('customers').select('id').limit(1);
        customerId = anyCust?.[0]?.id || '';
      }

      const { data: newPalletTrans, error: palErr } = await supabase
        .from('pallet_transactions')
        .insert({
          date: pal.date,
          customer_id: customerId,
          site_id: pal.site_id || null,
          transaction_type: 'returned',
          pallet_type: pal.pallet_type,
          quantity: pal.quantity,
          notes: `${pal.notes || 'Boş palet iadesi kabul edildi.'} [Plaka: ${pal.vehicle_plate || 'Sahadan teslim'}]`,
          created_by: currentUser?.id,
        })
        .select()
        .single();

      if (palErr || !newPalletTrans) {
        throw new Error(palErr?.message || 'Palet iadesi kaydedilemedi.');
      }

      return {
        success: true,
        message: `${pal.customer_name} hesabından ${pal.quantity} adet ${pal.pallet_type} palet iadesi kaydedildi!`,
        recordId: newPalletTrans.id,
      };
    }

    throw new Error('Tanımlanmamış aksiyon türü.');
  } catch (err: any) {
    console.error('executeApprovedAction hatası:', err);
    return {
      success: false,
      message: err?.message || 'İşlem gerçekleştirilirken bir hata oluştu.',
    };
  }
}
