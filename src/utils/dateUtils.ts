/**
 * Yerel Saat Dilimi (Timezone) ve Tarih Yardımcıları
 * 
 * Türkiye (UTC+3) gibi yerel saat dilimlerinde gece 00:00 - 03:00 saatleri arasındaki 
 * vardiyalarda "new Date().toISOString().split('T')[0]" ifadesi UTC saati 21:00 - 23:59 
 * kaldığı için bir önceki günün tarihini döndürür.
 * 
 * Bu yardımcı fonksiyonlar tarayıcının ve cihazın yerel takvim gününü esas alarak 
 * vardiya kayıtlarının yanlış güne kaymasını kesin olarak engeller.
 */

export function getLocalDateString(dateInput: Date | string | number = new Date()): string {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLocalDateTr(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return dateStr;
}
