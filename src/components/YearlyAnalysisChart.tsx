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
      <div id="analiz" className="bg-white border border-[#D6E4DC] rounded-2xl p-6 lg:p-8 text-center text-[#556B62] h-full flex flex-col items-center justify-center shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC] flex items-center justify-center mb-3 text-[#247A63]">
          <BarChart3 className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-[#1E332B] mb-1.5">Yıllık Dağılım Oluşturulamadı</h3>
        {hasRecordsWithoutDates ? (
          <p className="text-xs leading-relaxed max-w-md text-[#6E4716]">
            GBIF arşivinde <strong>{totalRecords.toLocaleString('tr-TR')}</strong> adet kayıt bulundu; ancak{' '}
            {typeof missingYearCount === 'number' && missingYearCount > 0
              ? `${missingYearCount.toLocaleString('tr-TR')} kaydın yıl/tarih bilgisi eksik`
              : 'geçerli yıl/tarih bilgisi bulunmadığı'}{' '}
            {invalidYearCount > 0 ? `(${invalidYearCount} geçersiz tarih) ` : ''}
            olduğundan kronolojik grafik çizilemedi.
          </p>
        ) : (
          <p className="text-xs text-[#556B62]">
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
    <div id="analiz" className="bg-white border border-[#D6E4DC] rounded-2xl p-6 lg:p-8 shadow-sm h-full flex flex-col justify-between">
      <div>
        {/* Header and Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#E6EFEA]">
          <div>
            <h3 className="text-xl font-bold text-[#1E332B] flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#247A63]" />
              <span>Yıllara Göre Gözlem Dağılımı</span>
            </h3>
            <p className="text-xs text-[#556B62] mt-1">
              {isArchiveFacetCalculated
                ? 'GBIF tüm arşiv YEAR fasetinden alınan gerçek tarihli kayıtların kronolojik grafiği'
                : 'Tarih bilgisi bulunan gözlemlerin kronolojik grafiği'}
            </p>
          </div>

          {/* Time Window Buttons */}
          <div className="flex items-center gap-1 p-1 bg-[#F5F9F4] rounded-xl border border-[#D6E4DC] shrink-0">
            <button
              type="button"
              onClick={() => {
                setHoveredYear(null);
                setTimeFilter('all');
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                timeFilter === 'all'
                  ? 'bg-[#247A63] text-white shadow-xs'
                  : 'text-[#556B62] hover:text-[#1E332B]'
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
                  ? 'bg-[#247A63] text-white shadow-xs'
                  : 'text-[#556B62] hover:text-[#1E332B]'
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
                  ? 'bg-[#247A63] text-white shadow-xs'
                  : 'text-[#556B62] hover:text-[#1E332B]'
              }`}
            >
              Son 10 Yıl
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {/* Peak Year */}
          <div className="bg-[#F5F9F4] p-4 rounded-xl border border-[#D6E4DC] flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#DDEFE3] text-[#247A63] flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block">
                Zirve Yıl (En Çok)
              </span>
              <div className="text-xl font-bold font-mono text-[#1E332B] tabular-nums">
                {peakYear ? `${peakYear.year}` : '—'}
                <span className="text-xs font-normal text-[#556B62] ml-2">
                  ({peakYear ? `${peakYear.count.toLocaleString('tr-TR')} kayıt` : ''})
                </span>
              </div>
            </div>
          </div>

          {/* Earliest Year & Lowest Year */}
          <div className="bg-[#FDF6EC] p-4 rounded-xl border border-[#F3D9B5] flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#F3D9B5]/60 text-[#9A631A] flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#9A631A] font-semibold block">
                İlk Kayıt Yılı
              </span>
              <div className="text-xl font-bold font-mono text-[#1E332B] tabular-nums">
                {resolvedEarliest ? `${resolvedEarliest.year}` : '—'}
                <span className="text-xs font-normal text-[#6E4716] ml-2">
                  ({resolvedEarliest ? `${resolvedEarliest.count.toLocaleString('tr-TR')} kayıt` : ''})
                </span>
              </div>
              {lowestYear && (
                <span className="text-[10px] font-mono text-[#6E4716]/80 block truncate">
                  En az kayıt: {lowestYear.year} ({lowestYear.count.toLocaleString('tr-TR')})
                </span>
              )}
            </div>
          </div>

          {/* Active Inspection Total */}
          <div className="bg-[#ECF6FA] p-4 rounded-xl border border-[#B9DDEB] flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#B9DDEB]/60 text-[#1B6884] flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#1B6884] font-semibold block">
                Tarihli Kayıt (Dönem)
              </span>
              <div className="text-xl font-bold font-mono text-[#1E332B] tabular-nums">
                {totalObsInView.toLocaleString('tr-TR')}
                <span className="text-xs font-normal text-[#556B62] ml-2">
                  kayıt
                </span>
              </div>
              {typeof totalRecords === 'number' && totalRecords > 0 && (
                <span className="text-[10px] font-mono text-[#556B62] block truncate">
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
          <div className="py-14 px-6 rounded-xl bg-[#F5F9F4] border border-[#D6E4DC] text-center">
            <Calendar className="w-8 h-8 mx-auto mb-2.5 text-[#9A631A]" />
            <p className="text-sm font-semibold text-[#1E332B] mb-1">
              {filterLabel} aralığında kayıtlı gözlem bulunamadı
            </p>
            <p className="text-xs text-[#556B62] mb-4">
              Bu tür için GBIF arşivindeki en güncel kayıt yılı {yearlyStats[yearlyStats.length - 1]?.year} olarak görünmektedir ({allDatedTotal.toLocaleString('tr-TR')} tarihli kayıt).
            </p>
            <button
              type="button"
              onClick={() => setTimeFilter('all')}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-[#247A63] hover:bg-[#1D6350] text-white transition-colors cursor-pointer"
            >
              Tüm Arşiv Yıllarını Göster ({yearlyStats.length} yıl)
            </button>
          </div>
        ) : (
          <div className="relative pt-4 pb-2">
            {/* Active Hover Monospace Tooltip HUD */}
            <div className="h-8 mb-2 flex items-center justify-between text-xs font-mono gap-2">
              {hoveredYear ? (
                <div className="text-[#1E332B] font-semibold bg-[#DDEFE3] border border-[#8CCFB0] px-3 py-1 rounded-md">
                  Yıl: <span className="text-[#247A63] font-bold">{hoveredYear.year}</span> — Gözlem Kaydı:{' '}
                  <span className="text-[#1E332B] font-bold tabular-nums">{hoveredYear.count.toLocaleString('tr-TR')} adet</span> (
                  {totalObsInView > 0 ? `%${((hoveredYear.count / totalObsInView) * 100).toFixed(1)}` : '%0'})
                </div>
              ) : (
                <div className="text-[#556B62] text-[11px]">
                  Sütunların üzerine gelerek 4 haneli yıl ve kayıt sayısını inceleyin
                </div>
              )}
              <span className="text-[#556B62] text-[11px] shrink-0">
                Maksimum: {maxCount.toLocaleString('tr-TR')} kayıt
              </span>
            </div>

            {/* The Bars Container */}
            <div className="relative h-56 w-full flex items-end gap-[2px] sm:gap-1 px-1 pt-4 border-b border-[#D6E4DC]">
              {/* Subtle horizontal grid lines */}
              <div className="absolute inset-x-0 top-4 border-t border-dashed border-[#D6E4DC] pointer-events-none" />
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#E6EFEA] pointer-events-none" />

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
                          ? 'bg-gradient-to-t from-[#247A63] to-[#D97706] shadow-xs ring-1 ring-[#D97706]/40'
                          : isHovered
                          ? 'bg-[#247A63] ring-2 ring-[#8CCFB0]'
                          : 'bg-[#8CCFB0] group-hover:bg-[#247A63]'
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            {/* Çakışmasız 4 Haneli Yıl Etiketleri Satırı */}
            <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] font-mono text-[#556B62] tabular-nums">
              {xTicks.map((tick) => (
                <span
                  key={tick.year}
                  className={peakYear && tick.year === peakYear.year ? 'text-[#9A631A] font-bold' : ''}
                >
                  {tick.year}
                </span>
              ))}
            </div>

            {/* X-axis Caption */}
            <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-[#556B62]">
              <span>{displayedStats[0].year} – {displayedStats[displayedStats.length - 1].year}</span>
              <span>{displayedStats.length} farklı yıl ({filterLabel})</span>
            </div>
          </div>
        )}
      </div>

      {/* Tarihsiz Kayıt & Faset Sınırı Açıklama Kutusu */}
      {(isYearFacetTruncated || invalidYearCount > 0 || typeof missingYearCount === 'number' || missingYearCount === null) && (
        <div className="mt-5 pt-4 border-t border-[#E6EFEA] flex flex-col gap-1.5 text-[11px] text-[#556B62]">
          {typeof missingYearCount === 'number' && missingYearCount > 0 && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#F5F9F4] border border-[#D6E4DC]">
              <span className="flex items-center gap-2 text-[#1E332B]">
                <AlertCircle className="w-3.5 h-3.5 text-[#9A631A] shrink-0" />
                <span>Tarih / yıl bilgisi bulunmayan kayıtlar (grafiğe sahte yıl olarak eklenmedi)</span>
              </span>
              <strong className="font-mono text-[#9A631A] tabular-nums shrink-0">
                {missingYearCount.toLocaleString('tr-TR')} kayıt
              </strong>
            </div>
          )}
          {missingYearCount === null && (
            <div className="px-3 py-2 rounded-lg bg-[#FDF6EC] border border-[#F3D9B5] text-[#6E4716]">
              Faset sınırı veya örneklem farkı nedeniyle tarihsiz kayıt sayısı toplam arşivden kesin olarak izole edilemedi.
            </div>
          )}
          {invalidYearCount > 0 && (
            <div className="px-3 py-2 rounded-lg bg-[#FDF6EC] border border-[#F3D9B5] text-[#6E4716]">
              {invalidYearCount.toLocaleString('tr-TR')} kayıt geçersiz/aralık dışı tarih (1500 öncesi veya gelecek yıl) içerdiği için grafik dışı bırakıldı.
            </div>
          )}
          {isYearFacetTruncated && (
            <div className="px-3 py-2 rounded-lg bg-[#FDF6EC] border border-[#F3D9B5] text-[#6E4716]">
              Uyarı: GBIF YEAR faseti sorgu limitine ulaştığı için dönemsel verinin bir kısmı kesilmiş olabilir.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
