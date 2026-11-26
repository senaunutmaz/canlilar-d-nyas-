import React, { useEffect, useState } from 'react';
import { GBIFOccurrence } from '../types/biodiversity';
import { parseValidCoordinates } from '../services/gbif';
import { Database, Search, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';

interface RecordDetailTableProps {
  occurrences: GBIFOccurrence[];
  totalCount: number;
}

export const RecordDetailTable: React.FC<RecordDetailTableProps> = ({ occurrences, totalCount }) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  useEffect(() => {
    setCurrentPage(1);
  }, [occurrences]);

  const filtered = occurrences.filter((occ) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLocaleLowerCase('tr-TR');
    return (
      (occ.stateProvince && occ.stateProvince.toLocaleLowerCase('tr-TR').includes(q)) ||
      (occ.locality && occ.locality.toLocaleLowerCase('tr-TR').includes(q)) ||
      (occ.basisOfRecord && occ.basisOfRecord.toLocaleLowerCase('tr-TR').includes(q)) ||
      (occ.year !== undefined && String(occ.year).includes(q))
    );
  });

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div id="kayitlar" className="bg-white border border-[#D6E4DC] rounded-2xl p-6 lg:p-8 shadow-sm my-8">
      {/* Header and Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#E6EFEA]">
        <div>
          <h3 className="text-xl font-bold text-[#1E332B] flex items-center gap-2">
            <Database className="w-5 h-5 text-[#247A63]" />
            <span>Bilimsel Gözlem Kayıtları Arşivi</span>
          </h3>
          <p className="text-xs text-[#556B62] mt-1">
            GBIF veri tabanında taranan gerçek gözlem numuneleri ve saha kayıtları
          </p>
        </div>

        {/* Filter input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-[#247A63] absolute left-3 top-2.5" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="İl, yıl veya gözlem türü ara..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#F5F9F4] text-xs text-[#1E332B] rounded-xl border border-[#D6E4DC] focus:outline-none focus:border-[#247A63] placeholder-[#556B62]/65 font-medium"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-[#D6E4DC] bg-[#F5F9F4] text-[#247A63] uppercase font-mono tracking-wider text-[10px]">
              <th className="py-3 px-3 rounded-tl-lg">Tarih / Yıl</th>
              <th className="py-3 px-3">Bölge / Konum</th>
              <th className="py-3 px-3">Koordinatlar (GPS)</th>
              <th className="py-3 px-3">Kayıt Türü</th>
              <th className="py-3 px-3">Katalog / Kaynak</th>
              <th className="py-3 px-3 text-right rounded-tr-lg">GBIF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6EFEA] font-mono">
            {paginated.length > 0 ? (
              paginated.map((occ) => {
                const coords = parseValidCoordinates(occ.decimalLatitude, occ.decimalLongitude);
                return (
                  <tr key={occ.key} className="hover:bg-[#F5F9F4] transition-colors">
                    <td className="py-3 px-3 text-[#1E332B] font-semibold whitespace-nowrap">
                      {occ.year ?? (occ.eventDate ? occ.eventDate.slice(0, 10) : 'Tarih Yok')}
                    </td>
                    <td className="py-3 px-3 font-sans text-[#1E332B]">
                      <span className="font-semibold block">{occ.stateProvince || 'Konum Belirtilmemiş'}</span>
                      {occ.locality && (
                        <span className="text-[11px] text-[#556B62] truncate block max-w-xs">{occ.locality}</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-[#247A63] font-medium tabular-nums whitespace-nowrap">
                      {coords ? (
                        <span>
                          {coords.lat.toFixed(4)}°K, {coords.lon.toFixed(4)}°D
                        </span>
                      ) : (
                        <span className="text-[#9A631A] text-[11px]">Koordinat yok</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-sans text-[#1E332B]">
                      <span className="bg-[#ECF6FA] border border-[#B9DDEB] text-[#1B576E] px-2 py-0.5 rounded text-[11px] font-medium">
                        {occ.basisOfRecord || 'Gözlem Kaydı'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[#556B62] text-[11px] truncate max-w-[160px]">
                      {occ.datasetName || occ.institutionCode || 'GBIF Node'}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <a
                        href={`https://www.gbif.org/occurrence/${occ.key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#247A63] hover:text-[#1D6350] font-semibold inline-flex items-center gap-1 transition-colors"
                        title="GBIF Kayıt Sayfası"
                      >
                        <span className="text-[10px]">İncele</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[#556B62] font-sans">
                  Aramanıza uygun kayıt bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-[#E6EFEA] text-xs">
        <span className="text-[#556B62] font-mono">
          Listelenen: <strong className="text-[#1E332B]">{filtered.length}</strong> / {occurrences.length} örneklem
          {totalCount > occurrences.length ? ` (Arşiv: ${totalCount.toLocaleString('tr-TR')})` : ''}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safePage === 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            className="p-1.5 rounded-lg bg-[#F5F9F4] hover:bg-[#DDEFE3] text-[#247A63] disabled:opacity-35 disabled:cursor-not-allowed border border-[#D6E4DC] cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-[#1E332B] font-semibold px-2">
            Sayfa {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            className="p-1.5 rounded-lg bg-[#F5F9F4] hover:bg-[#DDEFE3] text-[#247A63] disabled:opacity-35 disabled:cursor-not-allowed border border-[#D6E4DC] cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
