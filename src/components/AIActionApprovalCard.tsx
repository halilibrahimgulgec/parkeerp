import React, { useState } from 'react';
import { ActionDraftPayload } from '../types/aiActionTypes';
import { executeApprovedAction } from '../utils/aiActionEngine';
import { Truck, Factory, Boxes, CheckCircle2, XCircle, Loader2, FileText, AlertTriangle, Receipt } from 'lucide-react';

interface Props {
  draft: ActionDraftPayload;
  currentUser?: any;
  onUpdateDraft?: (updated: ActionDraftPayload) => void;
}

export const AIActionApprovalCard: React.FC<Props> = ({ draft, currentUser, onUpdateDraft }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<ActionDraftPayload>(draft);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      const res = await executeApprovedAction(currentDraft, currentUser);
      const updated: ActionDraftPayload = {
        ...currentDraft,
        status: res.success ? 'confirmed' : 'error',
        resultMessage: res.message,
        errorMessage: res.success ? undefined : res.message,
        createdRecordId: res.recordId,
      };
      setCurrentDraft(updated);
      onUpdateDraft?.(updated);
    } catch (err: any) {
      const updated: ActionDraftPayload = {
        ...currentDraft,
        status: 'error',
        errorMessage: err.message || 'Kayıt işlemi başarısız oldu.',
      };
      setCurrentDraft(updated);
      onUpdateDraft?.(updated);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    const updated: ActionDraftPayload = {
      ...currentDraft,
      status: 'cancelled',
      resultMessage: 'İşlem operatör tarafından iptal edildi.',
    };
    setCurrentDraft(updated);
    onUpdateDraft?.(updated);
  };

  const s = currentDraft.shipmentData;
  const p = currentDraft.productionData;
  const pal = currentDraft.palletReturnData;
  const pur = currentDraft.purchaseData;

  return (
    <div className="mt-3 w-full max-w-full bg-gradient-to-b from-slate-900 to-slate-950 text-white rounded-xl border border-slate-700 shadow-xl overflow-hidden select-none">
      {/* 1. Header with Badge */}
      <div className="px-3.5 py-2.5 bg-slate-800/80 border-b border-slate-700/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {currentDraft.type === 'create_shipment' && (
            <span className="p-1 bg-amber-500/20 text-amber-400 rounded-md">
              <Truck size={16} />
            </span>
          )}
          {currentDraft.type === 'create_production' && (
            <span className="p-1 bg-blue-500/20 text-blue-400 rounded-md">
              <Factory size={16} />
            </span>
          )}
          {currentDraft.type === 'return_pallet' && (
            <span className="p-1 bg-emerald-500/20 text-emerald-400 rounded-md">
              <Boxes size={16} />
            </span>
          )}
          {currentDraft.type === 'create_purchase' && (
            <span className="p-1 bg-purple-500/20 text-purple-400 rounded-md">
              <Receipt size={16} />
            </span>
          )}
          <span className="text-xs font-bold tracking-wide uppercase text-slate-200">
            {currentDraft.title}
          </span>
        </div>

        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            currentDraft.status === 'draft'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
              : currentDraft.status === 'confirmed'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : currentDraft.status === 'cancelled'
              ? 'bg-slate-700 text-slate-400 border-slate-600'
              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
          }`}
        >
          {currentDraft.status === 'draft' && '⏳ ONAY BEKLİYOR'}
          {currentDraft.status === 'confirmed' && '✅ KAYDEDİLDİ'}
          {currentDraft.status === 'cancelled' && '❌ İPTAL EDİLDİ'}
          {currentDraft.status === 'error' && '⚠️ HATA'}
        </span>
      </div>

      {/* 2. Body Details */}
      <div className="p-3.5 space-y-2.5 text-xs">
        {/* CASE A: SHIPMENT DRAFT */}
        {currentDraft.type === 'create_shipment' && s && (
          <>
            <div className="grid grid-cols-2 gap-2 bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50">
              <div>
                <span className="text-slate-400 text-[10px] block">Müşteri / Cari:</span>
                <span className="font-bold text-white text-xs truncate block">{s.customer_name}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Teslim Şantiyesi:</span>
                <span className="font-medium text-slate-200 text-xs truncate block">{s.site_name || 'Ana Şantiye'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Araç / Plaka:</span>
                <span className="font-mono font-bold text-amber-400 text-xs">{s.vehicle_plate || '-'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Şoför:</span>
                <span className="text-slate-300 text-xs">{s.driver_name || '-'}</span>
              </div>
              {s.invoice_no && (
                <div className="col-span-2 pt-1 border-t border-slate-700/50 flex items-center justify-between">
                  <span className="text-slate-400 text-[10px]">İrsaliye / Form No:</span>
                  <span className="font-mono font-bold text-amber-300 text-xs">#{s.invoice_no}</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 text-[10px] block font-medium">Yüklenen Malzemeler:</span>
              {s.items.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between bg-slate-800/60 px-2.5 py-1.5 rounded text-slate-200">
                  <span className="truncate pr-2 font-medium">{it.product_name}</span>
                  <span className="font-bold whitespace-nowrap text-amber-300">
                    {it.pallets > 0 ? `${it.pallets} Palet / ` : ''}{it.m2} {it.unit}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-[11px] bg-slate-800/30 px-2.5 py-1.5 rounded border border-slate-700/40">
              <span className="text-slate-400">Tahmini Net Kantar Tonajı:</span>
              <span className="font-bold text-emerald-400">{s.estimated_tonnage} Ton (~{(s.estimated_tonnage * 1000).toLocaleString('tr-TR')} kg)</span>
            </div>
          </>
        )}

        {/* CASE B: PRODUCTION DRAFT */}
        {currentDraft.type === 'create_production' && p && (
          <div className="space-y-2 bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Makine / Hat:</span>
              <span className="font-bold text-blue-400">{p.machine_name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Üretilen Ürün:</span>
              <span className="font-bold text-white">{p.product_name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Brüt Baskı Metrajı:</span>
              <span className="font-bold text-slate-200">{p.total_m2} m² ({p.total_pallets} Palet)</span>
            </div>
            {p.waste_m2 > 0 && (
              <div className="flex justify-between items-center text-rose-400">
                <span>Fire / Iskarta:</span>
                <span className="font-bold">-{p.waste_m2} m²</span>
              </div>
            )}
            <div className="flex justify-between items-center border-t border-slate-700 pt-1.5 text-emerald-400 font-bold">
              <span>Net Depoya Giren:</span>
              <span className="text-sm">{p.net_m2} m²</span>
            </div>
          </div>
        )}

        {/* CASE C: PALLET RETURN DRAFT */}
        {currentDraft.type === 'return_pallet' && pal && (
          <div className="space-y-2 bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">İade Eden Cari:</span>
              <span className="font-bold text-white">{pal.customer_name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Palet Türü:</span>
              <span className="font-bold text-amber-400 capitalize">{pal.pallet_type === 'uretim' ? 'Üretim Paleti' : 'Tahta Palet'}</span>
            </div>
            <div className="flex justify-between items-center border-t border-slate-700 pt-1.5 text-emerald-400 font-bold">
              <span>Teslim Alınan Adet:</span>
              <span className="text-sm">+{pal.quantity} Adet</span>
            </div>
          </div>
        )}

        {/* CASE D: PURCHASE & RAW MATERIAL DRAFT */}
        {currentDraft.type === 'create_purchase' && pur && (
          <div className="space-y-2 bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-400 text-[10px] block">Tedarikçi / Ocak:</span>
                <span className="font-bold text-white text-xs truncate block">{pur.supplier_name}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">İrsaliye / Fiş No:</span>
                <span className="font-mono font-bold text-amber-400 text-xs truncate block">{pur.invoice_no || 'Girilmedi'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Malzeme Cinsi:</span>
                <span className="font-bold text-purple-300 text-xs truncate block">{pur.material_name}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">Taşıyıcı Plaka:</span>
                <span className="font-mono font-bold text-slate-200 text-xs">{pur.vehicle_plate || '-'}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-700 pt-1.5 text-emerald-400 font-bold">
              <span>Kantar Net Miktarı:</span>
              <span className="text-sm">
                {pur.net_quantity.toLocaleString('tr-TR')} {pur.unit}
              </span>
            </div>

            {pur.total_amount && pur.total_amount > 0 ? (
              <div className="flex items-center justify-between text-[11px] bg-slate-800/30 px-2 py-1 rounded border border-slate-700/40 text-slate-300">
                <span>Fatura / Fiş Tutarı:</span>
                <span className="font-bold text-amber-300">{pur.total_amount.toLocaleString('tr-TR')} {pur.currency || 'TL'}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* RESULT / ERROR BANNERS */}
        {currentDraft.status === 'confirmed' && (
          <div className="p-2.5 bg-emerald-950/60 border border-emerald-500/40 rounded-lg text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span className="text-[11px] leading-tight font-medium">{currentDraft.resultMessage}</span>
          </div>
        )}

        {currentDraft.status === 'cancelled' && (
          <div className="p-2.5 bg-slate-800/60 border border-slate-600/40 rounded-lg text-slate-400 flex items-center gap-2">
            <XCircle size={16} className="shrink-0" />
            <span className="text-[11px] leading-tight font-medium">Taslak iptal edildi. Veritabanına kayıt yapılmadı.</span>
          </div>
        )}

        {currentDraft.status === 'error' && (
          <div className="p-2.5 bg-rose-950/60 border border-rose-500/40 rounded-lg text-rose-300 flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-400 shrink-0" />
            <span className="text-[11px] leading-tight font-medium">{currentDraft.errorMessage}</span>
          </div>
        )}
      </div>

      {/* 3. Action Buttons (Only when in 'draft' status) */}
      {currentDraft.status === 'draft' && (
        <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
          <button
            onClick={handleConfirm}
            disabled={isProcessing}
            className="flex-1 py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-lg text-xs shadow-md shadow-emerald-900/30 flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Kaydediliyor...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                <span>{currentDraft.type === 'create_purchase' ? 'ONAYLA VE STOĞA EKLE' : 'ONAYLA VE KAYDET'}</span>
              </>
            )}
          </button>

          <button
            onClick={handleCancel}
            disabled={isProcessing}
            className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium rounded-lg text-xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            İptal
          </button>
        </div>
      )}
    </div>
  );
};
