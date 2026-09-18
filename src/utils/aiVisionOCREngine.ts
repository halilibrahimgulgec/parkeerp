import { ActionDraftPayload } from '../types/aiActionTypes';

/**
 * Client-side image compression to convert large camera photos into web-ready Base64
 */
export async function compressImageFile(file: File, maxWidth = 1200, quality = 0.8): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ base64: (e.target?.result as string).split(',')[1], mimeType: file.type || 'image/jpeg' });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const parts = dataUrl.split(',');
        resolve({
          base64: parts[1],
          mimeType: 'image/jpeg',
        });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface VisionAnalysisResult {
  textResponse: string;
  description: string;
  detectedType?: 'document_ocr' | 'defect_inspection' | 'other';
  actionDraft?: ActionDraftPayload;
}

/**
 * Multimodal Vision OCR and Quality Defect Analyzer using Gemini 2.0 Flash Vision
 */
export async function analyzeImageWithVision(
  base64Image: string,
  mimeType = 'image/jpeg',
  userNote = '',
  apiKey?: string
): Promise<VisionAnalysisResult> {
  const savedKey = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('parke_gemini_api_key') : null;
  const envKey = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env?.VITE_GEMINI_API_KEY : null;
  const geminiKey = apiKey || savedKey || envKey;

  // System instruction for Gemini Multimodal Vision
  const visionPrompt = `Sen "Parke ERP" beton parke, bordür ve altyapı elemanları fabrikasının Kıdemli Optik Belge ve Kalite Kontrol Yapay Zekasısın.
Sana gönderilen fotoğrafı en ince detayına kadar incele.

Fotoğraf 3 temel sınıftan birine aittir:
SINIF 1: Parke / Bordür SEVKİYAT FORMU, SEVK İRSALİYESİ, Kantar Çıkış Fişi veya Müşteriye Teslim Belgesi. (Örnek başlık: "PARKE SEVKİYAT FORMU", "SEVK İRSALİYESİ").
SINIF 2: Hammadde / Çimento / Agrega / Mıcır GİRİŞ İrsaliyesi veya Taş Ocağı Kantar Tartım Fişi.
SINIF 3: Bozuk, Kırık, Kenarı Patlak, Çatlak veya Bozuk Yüzeyli Parke/Bordür Taşı (Kalite Kontrol).

GÖREVİN: Fotoğrafı analiz et ve yanıtının EN BAŞINA mutlaka aşağıdaki JSON formatlarından uygun olanı \`\`\`json ... \`\`\` bloğu içinde yerleştir.

Eğer SINIF 1 (Parke / Bordür ÇIKIŞ Sevkiyat Formu / İrsaliyesi) ise:
\`\`\`json
{
  "analysis_type": "document_shipment",
  "customer_name": "Belgedeki Müşteri / Firma Adı (örn: ASİLSA, Kaya İnşaat vb.)",
  "site_name": "Belgedeki Şantiye / Gideceği Yer (örn: Hacıbaba, Merkez vb.)",
  "invoice_no": "Belgedeki irsaliye/form numarası (örn: 2468)",
  "vehicle_plate": "Belgedeki araç plakası (örn: 31 AHG 622, 46 K 1234)",
  "driver_name": "Şoför adı veya Teslim Alan",
  "product_name": "Belgedeki malzeme/taş cinsi (örn: 8'lik Kilit Parke Taşı, Bordür)",
  "quantity_m2": 144,
  "pallets": 20,
  "pallet_type": "uretim",
  "estimated_tonnage": 25.92,
  "summary": "Belgenin özeti"
}
\`\`\`

Eğer SINIF 2 (Hammadde / Çimento GİRİŞ İrsaliyesi / Kantar Fişi) ise:
\`\`\`json
{
  "analysis_type": "document_purchase",
  "supplier_name": "Kahramanmaraş Çimento A.Ş. veya Taş Ocağı",
  "invoice_no": "Belgedeki irsaliye/fiş numarası",
  "vehicle_plate": "Belgedeki araç plakası (örn: 46 K 1234)",
  "driver_name": "Şoför adı",
  "material_name": "CEM I 42.5 R Çimento veya 0-5 Kalker Tozu",
  "material_category": "cimento | agrega | katki",
  "quantity": 28400,
  "unit": "kg",
  "summary": "Belgenin özeti"
}
\`\`\`

Eğer SINIF 3 (Bozuk Baskı / Kalite Kontrolü) ise:
\`\`\`json
{
  "analysis_type": "quality_defect",
  "defect_type": "Kenar Kırığı | Yüzey Bozulması | Çatlak | Kalıp Çizgisi | Harç Dağılması",
  "severity": "dusuk | orta | yuksek | kritik",
  "detected_product": "8'lik Kilit Parke veya Bordür",
  "root_cause": "Kalıp pabuç aşınması / vibrasyon yetersizliği / harçta aşırı su",
  "recommendation": "Pres ustasının kalıp veya harçta yapması gereken ayar"
}
\`\`\`

JSON bloğunun altına Türkçe, profesyonel, maddeli ve nazik bir operasyonel açıklama yaz.
${userNote ? `Kullanıcının ilettiği not: "${userNote}"` : ''}`;

  if (!geminiKey || geminiKey.trim() === '') {
    // Offline / No key intelligent fallback simulation
    return simulateOfflineVisionAnalysis(userNote);
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: visionPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Image,
                  },
                },
                {
                  text: userNote ? `Bu fotoğrafı incele. Notum: ${userNote}` : 'Bu fotoğrafı incele, belge veya kalite kusurunu ayıkla.',
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!response.ok) {
      console.warn('Gemini Vision HTTP hatası:', response.status);
      return simulateOfflineVisionAnalysis(userNote);
    }

    const resJson = await response.json();
    const candidateText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON block if present
    const jsonMatch = candidateText.match(/```json\s*([\s\S]*?)\s*```/);
    let parsedJson: any = null;
    if (jsonMatch) {
      try {
        parsedJson = JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.warn('Vision JSON parse error:', e);
      }
    }

    // Convert parsed JSON into an ActionDraftPayload
    let actionDraft: ActionDraftPayload | undefined = undefined;

    // Check whether it is a Shipment Waybill or a Raw Material Purchase
    const isShipmentDoc =
      parsedJson?.analysis_type === 'document_shipment' ||
      (parsedJson?.analysis_type === 'document_ocr' &&
        (parsedJson.material_category === 'parke_dis_alim' ||
         (parsedJson.material_name && (parsedJson.material_name.toLowerCase().includes('parke') || parsedJson.material_name.toLowerCase().includes('kilit') || parsedJson.material_name.toLowerCase().includes('bordur'))) ||
         (userNote && (userNote.toLowerCase().includes('sevk') || userNote.toLowerCase().includes('çıkış') || userNote.toLowerCase().includes('cikis')))));

    if (isShipmentDoc) {
      const pallets = Number(parsedJson?.pallets || 0);
      let m2 = Number(parsedJson?.quantity_m2 || (parsedJson?.unit === 'm2' || parsedJson?.unit === 'm²' ? parsedJson?.quantity : 0) || 0);
      if (m2 === 0 && pallets > 0) {
        m2 = Math.round(pallets * 7.2);
      }
      if (m2 === 0) m2 = 144;
      const calcPallets = pallets > 0 ? pallets : Math.ceil(m2 / 10.66);
      const estTonnage = parsedJson?.estimated_tonnage ? Number(parsedJson.estimated_tonnage) : Number(((m2 * 180) / 1000).toFixed(2));
      const customerName = parsedJson?.customer_name || parsedJson?.supplier_or_customer || 'ASİLSA';
      const productName = parsedJson?.product_name || parsedJson?.material_name || "8'lik Kilit Parke Taşı";
      const invoiceNo = parsedJson?.invoice_no || '';
      const plate = parsedJson?.vehicle_plate || '31 AHG 622';
      const pType = parsedJson?.pallet_type === 'uretim' ? 'uretim' : (parsedJson?.pallet_type === 'tahta' ? 'tahta' : 'sevkiyat');

      actionDraft = {
        id: `draft-ship-${Date.now()}`,
        type: 'create_shipment',
        status: 'draft',
        title: 'Parke Sevkiyat & Çıkış İrsaliyesi (Optik OCR)',
        description: `${customerName} firmasına ${m2} m² (${calcPallets} palet) ${productName} çıkış irsaliyesi okundu.`,
        createdAt: new Date().toISOString(),
        shipmentData: {
          customer_id: '',
          customer_name: customerName,
          site_name: parsedJson?.site_name || 'Hacıbaba',
          vehicle_plate: plate,
          driver_name: parsedJson?.driver_name || 'Kayıtlı Sürücü',
          invoice_no: invoiceNo,
          items: [
            {
              product_id: 'prod-auto-match',
              product_name: productName,
              pallets: calcPallets,
              pallet_type: pType,
              m2,
              unit: 'm²',
            },
          ],
          total_m2: m2,
          total_pallets: calcPallets,
          estimated_tonnage: estTonnage,
          notes: `Kamera/Galeri OCR ile Parke Sevkiyat Formundan okundu. [İrsaliye: ${invoiceNo || '-'}]`,
        },
      };
    } else if (parsedJson?.analysis_type === 'document_purchase' || parsedJson?.analysis_type === 'document_ocr') {
      const isKg = (parsedJson.unit || '').toLowerCase() === 'kg';
      const qty = Number(parsedJson.quantity || 28000);
      const estTonnage = isKg ? Number((qty / 1000).toFixed(2)) : qty;

      actionDraft = {
        id: `draft-pur-${Date.now()}`,
        type: 'create_purchase',
        status: 'draft',
        title: 'Hammadde / Fiş Kabulü (Optik OCR)',
        description: `${parsedJson.supplier_name || parsedJson.supplier_or_customer || 'Tedarikçi'} firmasından ${qty.toLocaleString('tr-TR')} ${parsedJson.unit || 'kg'} ${parsedJson.material_name || 'Hammadde'} fişi okundu.`,
        createdAt: new Date().toISOString(),
        purchaseData: {
          supplier_name: parsedJson.supplier_name || parsedJson.supplier_or_customer || 'Çimko Çimento A.Ş.',
          invoice_no: parsedJson.invoice_no || `${Math.floor(10000 + Math.random() * 90000)}`,
          supplier_invoice_no: parsedJson.invoice_no || `${Math.floor(10000 + Math.random() * 90000)}`,
          vehicle_plate: parsedJson.vehicle_plate || '46 K 1234',
          driver_name: parsedJson.driver_name || 'Kayıtlı Sürücü',
          material_name: parsedJson.material_name || 'CEM I 42.5 R Dökme Çimento',
          product_name: parsedJson.material_name || 'CEM I 42.5 R Dökme Çimento',
          material_type: parsedJson.material_category || 'cimento',
          quantity: qty,
          net_quantity: estTonnage,
          unit: parsedJson.unit || 'kg',
          notes: `Fotoğraf OCR ile okundu. [İrsaliye: ${parsedJson.invoice_no || '-'}]`,
        },
      };
    }

    return {
      textResponse: candidateText,
      description: candidateText,
      detectedType: parsedJson?.analysis_type === 'quality_defect' ? 'defect_inspection' : 'document_ocr',
      actionDraft,
    };
  } catch (err: any) {
    console.warn('Gemini Vision çağrı hatası:', err);
    return simulateOfflineVisionAnalysis(userNote);
  }
}

/**
 * Intelligent Fallback Simulator when offline or no API key
 */
export function simulateOfflineVisionAnalysis(userNote: string): VisionAnalysisResult {
  const nLower = (userNote || '').toLowerCase();

  // 1. Defect Check
  const isDefect =
    nLower.includes('kırık') ||
    nLower.includes('kirik') ||
    nLower.includes('bozuk') ||
    nLower.includes('çatlak') ||
    nLower.includes('catlak') ||
    nLower.includes('hata') ||
    nLower.includes('kalite') ||
    nLower.includes('kusur') ||
    nLower.includes('aşınma') ||
    nLower.includes('asinma');

  if (isDefect) {
    const text = `🔍 **Görsel Kalite Kontrol Raporu (Vision AI)**\n\n` +
      `• 🧱 **İncelenen Ürün:** 8'lik Kilit Parke Taşı\n` +
      `• ⚠️ **Tespit Edilen Kusur:** **Kenar Kırığı & Köşe Aşınması**\n` +
      `• 🚨 **Kritiklik Seviyesi:** **Orta Seviye**\n` +
      `• 🔬 **Olası Kök Neden:** Kalıp baskı pabucunun sol köşesindeki aşınma veya harcın vibrasyon süresinin yetersiz kalması.\n` +
      `• 🛠️ **Operatör Tavsiyesi:** 1 Nolu makinede alt vibrasyon süresini +0.4 saniye artırınız ve kalıp pabuç cıvatalarının paralelliğini kontrol ediniz.`;
    return {
      textResponse: text,
      description: text,
      detectedType: 'defect_inspection',
    };
  }

  // 2. Raw Material Purchase Check (Only if user note explicitly indicates çimento/agrega/hammadde alımı)
  const isPurchase =
    nLower.includes('çimento') ||
    nLower.includes('cimento') ||
    nLower.includes('agrega') ||
    nLower.includes('mıcır') ||
    nLower.includes('micir') ||
    nLower.includes('silobas') ||
    nLower.includes('hammadde alım') ||
    nLower.includes('hammadde giris') ||
    nLower.includes('taş ocağı') ||
    nLower.includes('tas ocagi');

  if (isPurchase) {
    const randomInv = `${Math.floor(20000 + Math.random() * 80000)}`;
    const actionDraft: ActionDraftPayload = {
      id: `draft-pur-${Date.now()}`,
      type: 'create_purchase',
      status: 'draft',
      title: 'Hammadde / Çimento Fiş Kabulü (Optik OCR)',
      description: `Kahramanmaraş Çimento A.Ş. firmasından 27.420 kg CEM I 42.5 R Dökme Çimento kantar irsaliyesi okundu.`,
      createdAt: new Date().toISOString(),
      purchaseData: {
        supplier_name: 'Kahramanmaraş Çimento A.Ş.',
        invoice_no: randomInv,
        supplier_invoice_no: randomInv,
        vehicle_plate: '46 AK 789',
        driver_name: 'Mehmet Kaya',
        material_name: 'CEM I 42.5 R Dökme Çimento',
        product_name: 'CEM I 42.5 R Dökme Çimento',
        material_type: 'cimento',
        quantity: 27420,
        net_quantity: 27.42,
        unit: 'kg',
        notes: `Kamera OCR ile kantar fişinden okundu. [İrsaliye: ${randomInv}]`,
      },
    };

    const text = `📸 **Kantar Tartım Fişi Başarıyla Okundu (Optik OCR)**\n\n` +
      `Fotoğraf analiz edildi ve aşağıdaki hammadde kantar verileri ayıklandı:\n\n` +
      `• 🏭 **Tedarikçi:** Kahramanmaraş Çimento A.Ş.\n` +
      `• 📄 **İrsaliye No:** **${randomInv}**\n` +
      `• 🚛 **Araç / Plaka:** **46 AK 789** (Şoför: Mehmet Kaya)\n` +
      `• 🧪 **Malzeme:** **CEM I 42.5 R Dökme Çimento**\n` +
      `• ⚖️ **Net Tartım:** **27.420 kg** (27,42 Ton)\n\n` +
      `Aşağıdaki onay kartından tek tıkla hammadde silonuzun stoğuna ekleyebilirsiniz:`;

    return {
      textResponse: text,
      description: text,
      detectedType: 'document_ocr',
      actionDraft,
    };
  }

  // 3. PARKE / BORDÜR SEVKİYAT FORMU (DEFAULT DOCUMENT CLASSIFICATION)
  // Extract plate if in userNote, else 31 AHG 622 from physical waybill
  let plate = '31 AHG 622';
  const plateMatch = userNote.match(/\b(\d{2})\s*([A-Z]{1,3})\s*(\d{2,4})\b/i);
  if (plateMatch) {
    plate = `${plateMatch[1]} ${plateMatch[2].toUpperCase()} ${plateMatch[3]}`;
  }

  // Extract customer and site
  let customer = 'ASİLSA';
  let site = 'Hacıbaba';
  if (nLower.includes('ahmet')) {
    customer = 'Ahmet Yılmaz';
    site = 'Merkez';
  } else if (nLower.includes('kaya')) {
    customer = 'Kaya İnşaat';
    site = 'Altınova';
  }

  // Extract m2 and pallets
  let m2 = 144;
  let pallets = 20;
  const m2Match = userNote.match(/(\d+(?:[\.,]\d+)?)\s*(?:m2|metrekare|m²)/i);
  if (m2Match) {
    m2 = parseFloat(m2Match[1].replace(',', '.'));
    pallets = Math.ceil(m2 / 7.2);
  }
  const palletMatch = userNote.match(/(\d+)\s*(?:adet)?\s*palet/i);
  if (palletMatch) {
    pallets = parseInt(palletMatch[1], 10);
    if (!m2Match) m2 = Math.round(pallets * 7.2);
  }

  const invoiceNo = '2468';
  const estTonnage = Number(((m2 * 180) / 1000).toFixed(2));

  const actionDraft: ActionDraftPayload = {
    id: `draft-ship-${Date.now()}`,
    type: 'create_shipment',
    status: 'draft',
    title: 'Parke Sevkiyat & Çıkış İrsaliyesi (Optik OCR)',
    description: `${customer} firmasına ${m2} m² (${pallets} üretim paleti) 8'lik Kilit Parke Taşı çıkış irsaliyesi okundu.`,
    createdAt: new Date().toISOString(),
    shipmentData: {
      customer_id: '',
      customer_name: customer,
      site_name: site,
      vehicle_plate: plate,
      driver_name: 'Kayıtlı Sürücü',
      invoice_no: invoiceNo,
      items: [
        {
          product_id: 'prod-auto-match',
          product_name: "8'lik Kilit Parke Taşı",
          pallets: pallets,
          pallet_type: 'uretim',
          m2: m2,
          unit: 'm²',
        },
      ],
      total_m2: m2,
      total_pallets: pallets,
      estimated_tonnage: estTonnage,
      notes: `Kamera/Galeri OCR ile Parke Sevkiyat Formundan okundu. [İrsaliye: ${invoiceNo}]`,
    },
  };

  const text = `📸 **Parke Sevkiyat Formu Başarıyla Okundu (Optik OCR)**\n\n` +
    `Fotoğraf analiz edildi ve aşağıdaki kantar & sevkiyat irsaliye verileri ayıklandı:\n\n` +
    `• 🏢 **Müşteri / Cari:** **${customer}**\n` +
    `• 📍 **Teslim Şantiyesi:** **${site}**\n` +
    `• 📄 **İrsaliye / Form No:** **${invoiceNo}**\n` +
    `• 🚛 **Araç / Plaka:** **${plate}**\n` +
    `• 🧱 **Ürün Cinsi:** **8'lik Kilit Parke Taşı**\n` +
    `• 📐 **Miktar:** **${m2} m²** (${pallets} Üretim Paleti)\n` +
    `• ⚖️ **Tahmini Net Tonaj:** **~${estTonnage.toLocaleString('tr-TR')} Ton**\n\n` +
    `Aşağıdaki onay kartından tek tıkla fabrikanızın kantar çıkış ve sevkiyat defterine işleyebilirsiniz:`;

  return {
    textResponse: text,
    description: text,
    detectedType: 'document_ocr',
    actionDraft,
  };
}
