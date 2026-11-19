import React, { useEffect, useState } from 'react';
import { RegionStat } from '../types/biodiversity';
import { MapPin, HelpCircle, AlertTriangle } from 'lucide-react';

interface RegionalDistributionProps {
  regionalStats: RegionStat[];
  unlocatedCount: number;
  totalRecords: number;
  isRegionFacetTruncated?: boolean;
  filteredRegionCodeCount?: number;
  regionFacetTotalCount?: number;
  onSelectRegion?: (regionName: string) => void;
}

function formatRegionPercent(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0';
  if (pct < 0.01) return '< 0,01';
  if (pct < 1) return pct.toFixed(2).replace('.', ',');
  return pct.toFixed(1).replace('.', ',');
}

export const RegionalDistribution: React.FC<RegionalDistributionProps> = ({
  regionalStats,
  unlocatedCount,
  totalRecords,
  isRegionFacetTruncated = false,
  filteredRegionCodeCount = 0,
  regionFacetTotalCount = 0,
  onSelectRegion
}) => {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setShowAll(false);
  }, [regionalStats]);

  if (!regionalStats || regionalStats.length === 0) {
    return (
      <div className="bg-[#111e17] border border-emerald-900/60 rounded-2xl p-6 lg:p-8 text-center text-emerald-300/75 h-full flex flex-col items-center justify-center">
        <MapPin className="w-10 h-10 mx-auto mb-3 opacity-50 text-emerald-400" />
        <h3 className="text-base font-bold text-white mb-1.5">Bölgesel Dağılım Oluşturulamadı</h3>
        {totalRecords > 0 ? (
          <p className="text-xs leading-relaxed max-w-md text-amber-200/90">
            GBIF arşivinde <strong>{totalRecords.toLocaleString('tr-TR')}</strong> adet kayıt mevcut; ancak bu kayıtlarda ayrıştırılabilir il/bölge adı (stateProvince) bulunmadığı için bölgesel grafik çizilemedi
            {filteredRegionCodeCount > 0
              ? ` (${filteredRegionCodeCount.toLocaleString('tr-TR')} kayıt yalnızca kısa kod içeriyor)`
              : ''}
            .
          </p>
        ) : (
          <p className="text-xs text-emerald-300/60">
            Bu türe ait seçili kapsamda il veya bölge bazında ayrıştırılmış kayıt bulunamadı.
          </p>
        )}
      </div>
    );
  }

  const maxCount = Math.max(...regionalStats.map(r => r.count), 1);
  const displayedRegions = showAll ? regionalStats : regionalStats.slice(0, 8);
  const topRegion = regionalStats[0];
  const topRegionShare =
    topRegion
      ? (Number.isFinite(topRegion.percentage)
          ? topRegion.percentage
          : totalRecords > 0
            ? (topRegion.count / totalRecords) * 100
            : 0)
      : 0;
  const outsideFacetCount = Math.max(0, totalRecords - regionFacetTotalCount);

  return (
    <div className="bg-[#111e17] border border-emerald-900/60 rounded-2xl p-6 lg:p-8 shadow-xl h-full flex flex-col justify-between">
      <div>
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-emerald-900/40">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-400" />
              <span>Bölgelere Göre Dağılım</span>
            </h3>
            <p className="text-xs text-emerald-300/70 mt-1">
              GBIF arşiv STATE_PROVINCE fasetlerinden hesaplanan il ve bölge yoğunluğu
            </p>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-xs font-mono text-emerald-400/80 uppercase block">
              Tespit Edilen Bölge
            </span>
            <span className="text-lg font-bold font-mono text-white tabular-nums">
              {regionalStats.length.toLocaleString('tr-TR')} {isRegionFacetTruncated ? '+ ' : ''}Bölge
            </span>
            <span className="text-[10px] text-emerald-300/60 font-mono block">
              ({totalRecords.toLocaleString('tr-TR')} arşiv kaydı)
            </span>
          </div>
        </div>

        {/* Top Region Highlight Banner */}
        {topRegion && (
          <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-emerald-950/90 to-[#13241b] border border-emerald-700/40 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold font-mono text-sm shrink-0">
                #1
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400/80 block">
                  En Yüksek Gözlem Yoğunluğu
                </span>
                <h4 className="text-base font-bold text-white truncate">
                  {topRegion.region}
                </h4>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-extrabold font-mono text-emerald-300 tabular-nums">
                {topRegion.count.toLocaleString('tr-TR')}
                <span className="text-xs font-normal text-emerald-400/80 ml-1">kayıt</span>
              </div>
              <span className="text-[11px] text-emerald-300/60 font-mono">
                Toplamın %{formatRegionPercent(topRegionShare)}'i
              </span>
            </div>
          </div>
        )}

        {/* Region Bars List */}
        <div className="space-y-3">
          {displayedRegions.map((item, idx) => {
            const barWidthPercent = Math.max(5, Math.round((item.count / maxCount) * 100));
            const shareOfTotal = Number.isFinite(item.percentage)
              ? item.percentage
              : totalRecords > 0
                ? (item.count / totalRecords) * 100
                : 0;

            return (
              <div
                key={item.region}
                onClick={() => onSelectRegion && onSelectRegion(item.region)}
                className="group p-2 rounded-lg hover:bg-[#0b1510]/60 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-emerald-400/60 w-5 text-right tabular-nums shrink-0">
                      {idx + 1}.
                    </span>
                    <span className="font-semibold text-emerald-100 group-hover:text-emerald-300 transition-colors truncate">
                      {item.region}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono shrink-0">
                    <span className="font-bold text-white tabular-nums">
                      {item.count.toLocaleString('tr-TR')}
                    </span>
                    <span className="text-[11px] text-emerald-400/75 tabular-nums">
                      (%{formatRegionPercent(shareOfTotal)})
                    </span>
                  </div>
                </div>

                {/* Progress Meter Bar */}
                <div className="h-2 w-full bg-[#0b1510] rounded-full overflow-hidden p-0.5 border border-emerald-900/40">
                  <div
                    style={{ width: `${barWidthPercent}%` }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      idx === 0
                        ? 'bg-gradient-to-r from-emerald-500 to-amber-400'
                        : idx < 3
                        ? 'bg-emerald-400'
                        : 'bg-emerald-600/70'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Expand / Collapse Button if more than 8 regions */}
        {regionalStats.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="mt-4 w-full py-2.5 text-xs font-semibold text-emerald-300 hover:text-white bg-[#0b1510]/80 hover:bg-[#0b1510] border border-emerald-800/40 rounded-xl transition-colors cursor-pointer"
          >
            {showAll ? 'Daha Az Bölge Göster' : `Tüm Bölgeleri Listele (${regionalStats.length} Bölge)`}
          </button>
        )}
      </div>

      {/* Unlocated, Short-Code & Truncated Facet Separation Notices */}
      <div className="mt-6 pt-4 border-t border-emerald-900/40 space-y-2">
        {isRegionFacetTruncated ? (
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-700/50 text-xs text-amber-200 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-amber-100">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Bölgesel Faset Sınırı Bildirimi</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              GBIF arşivinde çok fazla alt bölge bulunduğu için ilk 3.000 faset işlendi ({regionFacetTotalCount.toLocaleString('tr-TR')} kayıt). Faset sınırı dışında kalan {outsideFacetCount.toLocaleString('tr-TR')} kayıt il adı eksik kayıt olarak sayılmamıştır; uzun kuyruk bölgeleri ve il bilgisi boş kayıtları birlikte içerir.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 p-3.5 rounded-xl bg-[#0b1510]/80 border border-emerald-800/30 text-xs">
            <div className="flex items-center gap-2.5 text-emerald-300/80">
              <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>İl / Bölge Adı Belirtilmemiş Kayıtlar</span>
            </div>
            <div className="font-mono font-bold text-amber-300 tabular-nums shrink-0">
              {unlocatedCount.toLocaleString('tr-TR')} Kayıt
              <span className="text-[10px] font-normal text-emerald-400/60 ml-1.5">
                (Analizde korundu)
              </span>
            </div>
          </div>
        )}

        {filteredRegionCodeCount > 0 && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#0b1510]/60 border border-emerald-900/40 text-[11px] text-emerald-200/75">
            <span>Kısa Bölge Kodları / Tanımsız Alanlar (örn. Zh, Gr, Be — il listesine alınmadı)</span>
            <strong className="font-mono text-emerald-300 tabular-nums shrink-0">
              {filteredRegionCodeCount.toLocaleString('tr-TR')} Kayıt
            </strong>
          </div>
        )}
      </div>
    </div>
  );
};
