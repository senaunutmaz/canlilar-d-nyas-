import React, { useEffect, useState } from 'react';
import { YearlyStat } from '../types/biodiversity';
import { TrendingUp, Award, Calendar, BarChart3, AlertCircle } from 'lucide-react';

interface YearlyAnalysisChartProps {
  yearlyStats: YearlyStat[];
  peakYear: { year: number; count: number } | null;
  lowestYear: { year: number; count: number } | null;
  earliestYear?: { year: number; count: number } | null;
  scientificName: string;
  totalRecords?: number;
  missingYearCount?: number | null;
  invalidYearCount?: number;
  isYearFacetTruncated?: boolean;
  isArchiveFacetCalculated?: boolean;
}

export const YearlyAnalysisChart: React.FC<YearlyAnalysisChartProps> = ({
  yearlyStats,
  peakYear,
  lowestYear,
  earliestYear,
  scientificName,
  totalRecords,
  missingYearCount,
  invalidYearCount = 0,
  isYearFacetTruncated = false,
  isArchiveFacetCalculated = true,
}) => {
  const [hoveredYear, setHoveredYear] = useState<YearlyStat | null>(null);
  const [timeFilter, setTimeFilter] = useState<'all' | 'recent20' | 'recent10'>('all');

  useEffect(() => {
    setHoveredYear(null);
    setTimeFilter('all');
  }, [scientificName, yearlyStats]);

  if (!yearlyStats || yearlyStats.length === 0) {
    const hasRecordsWithoutDates = typeof totalRecords === 'number' && totalRecords > 0;
    return (
      <div id="analiz" className="bg-[#111e17] border border-emerald-900/60 rounded-2xl p-6 lg:p-8 text-center text-emerald-300/75 h-full flex flex-col items-center justify-center">
        <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-50 text-emerald-400" />
        <h3 className="text-base font-bold text-white mb-1.5">Yıllık Dağılım Oluşturulamadı</h3>
        {hasRecordsWithoutDates ? (
          <p className="text-xs leading-relaxed max-w-md text-amber-200/90">
            GBIF arşivinde <strong>{totalRecords.toLocaleString('tr-TR')}</strong> adet kayıt bulundu; ancak{' '}
            {typeof missingYearCount === 'number' && missingYearCount > 0
              ? `${missingYearCount.toLocaleString('tr-TR')} kaydın yıl/tarih bilgisi eksik`
              : 'geçerli yıl/tarih bilgisi bulunmadığı'}{' '}
            {invalidYearCount > 0 ? `(${invalidYearCount} geçersiz tarih) ` : ''}
            olduğundan kronolojik grafik çizilemedi.
          </p>
        ) : (
          <p className="text-xs text-emerald-300/60">
            Bu türe ait seçili kapsamda yıllara göre arşivlenmiş gözlem verisi bulunamadı.
          </p>
        )}
      </div>
    );
  }

  // Filter according to selection
  const currentYear = new Date().getFullYear();
  let displayedStats = [...yearlyStats];
  if (timeFilter === 'recent20') {
    displayedStats = yearlyStats.filter(s => s.year >= currentYear - 20);
  } else if (timeFilter === 'recent10') {
    displayedStats = yearlyStats.filter(s => s.year >= currentYear - 10);
  }

  const hasDisplayedData = displayedStats.length > 0;
  const maxCount = hasDisplayedData ? Math.max(...displayedStats.map(s => s.count)) : 0;
  const totalObsInView = displayedStats.reduce((acc, curr) => acc + curr.count, 0);
  const allDatedTotal = yearlyStats.reduce((acc, curr) => acc + curr.count, 0);

  const resolvedEarliest = earliestYear || (yearlyStats.length > 0 ? yearlyStats[0] : null);

  // Uzun serilerde (100+ yıl dahil) 4 haneli yıl etiketlerinin çakışmaması için kontrollü örnekleme
  const xTicks: YearlyStat[] = (() => {
    if (!hasDisplayedData) return [];
    if (displayedStats.length <= 10) return displayedStats;
    const maxTicks = 7;
    const ticks: YearlyStat[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < maxTicks; i++) {
      const idx = Math.round((i / (maxTicks - 1)) * (displayedStats.length - 1));
      const item = displayedStats[idx];
      if (item && !seen.has(item.year)) {
        seen.add(item.year);
        ticks.push(item);
      }
    }
    return ticks;
  })();

  const filterLabel =
    timeFilter === 'recent10'
      ? `Son 10 Yıl (${currentYear - 10}–${currentYear})`
      : timeFilter === 'recent20'
        ? `Son 20 Yıl (${currentYear - 20}–${currentYear})`
        : 'Tüm Arşiv Yılları';

  return (
    <div id="analiz" className="bg-[#111e17] border border-emerald-900/60 rounded-2xl p-6 lg:p-8 shadow-xl h-full flex flex-col justify-between">
      <div>
        {/* Header and Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-emerald-900/40">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-400" />
              <span>Yıllara Göre Gözlem Dağılımı</span>
            </h3>
            <p className="text-xs text-emerald-300/70 mt-1">
              {isArchiveFacetCalculated
                ? 'GBIF tüm arşiv YEAR fasetinden alınan gerçek tarihli kayıtların kronolojik grafiği'
                : 'Tarih bilgisi bulunan gözlemlerin kronolojik grafiği'}
            </p>
          </div>

          {/* Time Window Buttons */}
          <div className="flex items-center gap-1 p-1 bg-[#0b1510] rounded-xl border border-emerald-800/40 shrink-0">
            <button
              type="button"
              onClick={() => {
                setHoveredYear(null);
                setTimeFilter('all');
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                timeFilter === 'all'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-300/70 hover:text-white'
              }`}
            >
              Tüm Yıllar ({yearlyStats.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setHoveredYear(null);
                setTimeFilter('recent20');
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                timeFilter === 'recent20'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-300/70 hover:text-white'
              }`}
            >
              Son 20 Yıl
            </button>
            <button
              type="button"
              onClick={() => {
                setHoveredYear(null);
                setTimeFilter('recent10');
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                timeFilter === 'recent10'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-300/70 hover:text-white'
              }`}
            >
              Son 10 Yıl
            </button>
          </div>
        </div>

        {/* KPI Cards: Peak Year, Earliest vs Lowest Year, Total Dated vs Archive */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {/* Peak Year */}
          <div className="bg-[#0b1510]/80 p-4 rounded-xl border border-emerald-800/30 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400/80 block">
                Zirve Yıl (En Çok)
              </span>
              <div className="text-xl font-bold font-mono text-white tabular-nums">
                {peakYear ? `${peakYear.year}` : '—'}
                <span className="text-xs font-normal text-emerald-300/80 ml-2">
                  ({peakYear ? `${peakYear.count.toLocaleString('tr-TR')} kayıt` : ''})
                </span>
              </div>
            </div>
          </div>

          {/* Earliest Year & Lowest Year cleanly separated */}
          <div className="bg-[#0b1510]/80 p-4 rounded-xl border border-emerald-800/30 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400/80 block">
                İlk Kayıt Yılı
              </span>
              <div className="text-xl font-bold font-mono text-white tabular-nums">
                {resolvedEarliest ? `${resolvedEarliest.year}` : '—'}
                <span className="text-xs font-normal text-amber-300/80 ml-2">
                  ({resolvedEarliest ? `${resolvedEarliest.count.toLocaleString('tr-TR')} kayıt` : ''})
                </span>
              </div>
              {lowestYear && (
                <span className="text-[10px] font-mono text-emerald-300/60 block truncate">
                  En az kayıt: {lowestYear.year} ({lowestYear.count.toLocaleString('tr-TR')})
                </span>
              )}
            </div>
          </div>

          {/* Active Inspection Total */}
          <div className="bg-[#0b1510]/80 p-4 rounded-xl border border-emerald-800/30 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-teal-400/80 block">
                Tarihli Kayıt (Dönem)
              </span>
              <div className="text-xl font-bold font-mono text-white tabular-nums">
                {totalObsInView.toLocaleString('tr-TR')}
                <span className="text-xs font-normal text-teal-300/80 ml-2">
                  kayıt
                </span>
              </div>
              {typeof totalRecords === 'number' && totalRecords > 0 && (
                <span className="text-[10px] font-mono text-emerald-300/60 block truncate">
                  Toplam arşiv: {totalRecords.toLocaleString('tr-TR')}
                  {typeof missingYearCount === 'number' && missingYearCount > 0
                    ? ` · Tarihsiz: ${missingYearCount.toLocaleString('tr-TR')}`
                    : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Interactive Bar Chart Stage OR Safe Empty Time-Window State */}
        {!hasDisplayedData ? (
          <div className="py-14 px-6 rounded-xl bg-[#0b1510]/60 border border-emerald-900/40 text-center">
            <Calendar className="w-8 h-8 mx-auto mb-2.5 text-amber-400/70" />
            <p className="text-sm font-semibold text-white mb-1">
              {filterLabel} aralığında kayıtlı gözlem bulunamadı
            </p>
            <p className="text-xs text-emerald-300/70 mb-4">
              Bu tür için GBIF arşivindeki en güncel kayıt yılı {yearlyStats[yearlyStats.length - 1]?.year} olarak görünmektedir ({allDatedTotal.toLocaleString('tr-TR')} tarihli kayıt).
            </p>
            <button
              type="button"
              onClick={() => setTimeFilter('all')}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
            >
              Tüm Arşiv Yıllarını Göster ({yearlyStats.length} yıl)
            </button>
          </div>
        ) : (
          <div className="relative pt-4 pb-2">
            {/* Active Hover Monospace Tooltip HUD */}
            <div className="h-8 mb-2 flex items-center justify-between text-xs font-mono gap-2">
              {hoveredYear ? (
                <div className="text-emerald-300 font-semibold bg-emerald-950/80 border border-emerald-700/60 px-3 py-1 rounded-md">
                  Yıl: <span className="text-white">{hoveredYear.year}</span> — Gözlem Kaydı:{' '}
                  <span className="text-white tabular-nums">{hoveredYear.count.toLocaleString('tr-TR')} adet</span> (
                  {totalObsInView > 0 ? `%${((hoveredYear.count / totalObsInView) * 100).toFixed(1)}` : '%0'})
                </div>
              ) : (
                <div className="text-emerald-400/60 text-[11px]">
                  Sütunların üzerine gelerek 4 haneli yıl ve kayıt sayısını inceleyin
                </div>
              )}
              <span className="text-emerald-400/60 text-[11px] shrink-0">
                Maksimum: {maxCount.toLocaleString('tr-TR')} kayıt
              </span>
            </div>

            {/* The Bars Container */}
            <div className="relative h-56 w-full flex items-end gap-[2px] sm:gap-1 px-1 pt-4 border-b border-emerald-800/40">
              {/* Subtle horizontal grid lines */}
              <div className="absolute inset-x-0 top-4 border-t border-dashed border-emerald-900/40 pointer-events-none" />
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-emerald-900/30 pointer-events-none" />

              {displayedStats.map((item) => {
                const heightPercent =
                  maxCount > 0 && item.count > 0
                    ? Math.max(4, Math.round((item.count / maxCount) * 100))
                    : 0;
                const isPeak = peakYear && item.year === peakYear.year;
                const isHovered = hoveredYear?.year === item.year;

                return (
                  <div
                    key={item.year}
                    title={`${item.year}: ${item.count.toLocaleString('tr-TR')} kayıt`}
                    className="relative flex-1 min-w-0 h-full flex flex-col justify-end items-center group cursor-pointer"
                    onMouseEnter={() => setHoveredYear(item)}
                    onMouseLeave={() => setHoveredYear(null)}
                  >
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full max-w-[28px] rounded-t-sm transition-all duration-150 ${
                        isPeak
                          ? 'bg-gradient-to-t from-emerald-600 to-amber-400 shadow-md shadow-amber-500/20 ring-1 ring-amber-300/50'
                          : isHovered
                          ? 'bg-emerald-400 ring-2 ring-emerald-300'
                          : 'bg-emerald-600/70 group-hover:bg-emerald-500'
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            {/* Çakışmasız 4 Haneli Yıl Etiketleri Satırı */}
            <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] font-mono text-emerald-300/75 tabular-nums">
              {xTicks.map((tick) => (
                <span
                  key={tick.year}
                  className={peakYear && tick.year === peakYear.year ? 'text-amber-300 font-bold' : ''}
                >
                  {tick.year}
                </span>
              ))}
            </div>

            {/* X-axis Caption */}
            <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-emerald-400/60">
              <span>{displayedStats[0].year} – {displayedStats[displayedStats.length - 1].year}</span>
              <span>{displayedStats.length} farklı yıl ({filterLabel})</span>
            </div>
          </div>
        )}
      </div>

      {/* Tarihsiz Kayıt & Faset Sınırı Açıklama Kutusu */}
      {(isYearFacetTruncated || invalidYearCount > 0 || typeof missingYearCount === 'number' || missingYearCount === null) && (
        <div className="mt-5 pt-4 border-t border-emerald-900/40 flex flex-col gap-1.5 text-[11px] text-emerald-200/75">
          {typeof missingYearCount === 'number' && missingYearCount > 0 && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0b1510]/80 border border-emerald-800/30">
              <span className="flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Tarih / yıl bilgisi bulunmayan kayıtlar (grafiğe sahte yıl olarak eklenmedi)</span>
              </span>
              <strong className="font-mono text-amber-300 tabular-nums shrink-0">
                {missingYearCount.toLocaleString('tr-TR')} kayıt
              </strong>
            </div>
          )}
          {missingYearCount === null && (
            <div className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-700/40 text-amber-200">
              Faset sınırı veya örneklem farkı nedeniyle tarihsiz kayıt sayısı toplam arşivden kesin olarak izole edilemedi.
            </div>
          )}
          {invalidYearCount > 0 && (
            <div className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-700/40 text-amber-200">
              {invalidYearCount.toLocaleString('tr-TR')} kayıt geçersiz/aralık dışı tarih (1500 öncesi veya gelecek yıl) içerdiği için grafik dışı bırakıldı.
            </div>
          )}
          {isYearFacetTruncated && (
            <div className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-700/40 text-amber-200">
              Uyarı: GBIF YEAR faseti sorgu limitine ulaştığı için dönemsel verinin bir kısmı kesilmiş olabilir.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
