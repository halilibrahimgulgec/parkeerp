/**
 * Supabase PostgREST 1000-Satır Sınırını Aşan Otomatik Sayfalama (Pagination) Yardımcısı
 * 
 * Supabase PostgREST sunucu yapılandırmasında varsayılan "max_rows" 1000 olarak ayarlıdır.
 * İstemci ".limit(50000)" gönderse dahi yanıt 1000 satırda kesilir.
 * Bu yardımcı, ".range(from, to)" kullanarak tüm kayıtları 1000'lik bloklar halinde
 * eksiksiz ve kayıpsız çeker.
 */

export async function fetchAllPaged<T = any>(
  fetchChunk: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const chunkSize = 1000;
  let from = 0;
  const allRows: T[] = [];

  while (true) {
    const to = from + chunkSize - 1;
    const { data, error } = await fetchChunk(from, to);

    if (error) {
      console.warn('Sayfalama sırasında hata:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...data);

    // Eğer gelen satır sayısı chunkSize'tan az ise son sayfaya ulaşılmıştır
    if (data.length < chunkSize) {
      break;
    }

    from += chunkSize;
  }

  return allRows;
}
