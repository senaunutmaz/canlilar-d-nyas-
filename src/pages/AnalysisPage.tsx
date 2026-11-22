import React, { useState } from 'react';
import { SpeciesOverview } from '../components/SpeciesOverview';
import { YearlyAnalysisChart } from '../components/YearlyAnalysisChart';
import { RegionalDistribution } from '../components/RegionalDistribution';
import { RecordDetailTable } from '../components/RecordDetailTable';
import { SpeciesAnalysis } from '../types/biodiversity';
import { BarChart3, Search, AlertCircle, Compass } from 'lucide-react';

interface AnalysisPageProps {
  primaryAnalysis: SpeciesAnalysis | null;
  activeCountry: string;
  onSearch: (query: string, country: string) => void;
  isLoading: boolean;
  onCountryChange: (country: string) => void;
  errorMessage?: string | null;
}

export const AnalysisPage: React.FC<AnalysisPageProps> = ({
  primaryAnalysis,
  activeCountry,
  onSearch,
  isLoading,
  onCountryChange,
  errorMessage,
}) => {
  const [searchInput, setSearchInput] = useState<string>('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onSearch(searchInput.trim(), activeCountry);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header Bar */}
      <div className="bg-[#111e17] rounded-3xl p-6 sm:p-8 border border-emerald-800/50 shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-2 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-800/40">
            <BarChart3 className="w-3.5 h-3.5" />
            <span>GBIF Arşiv Fasetleri & Zamansal Dağılım</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Veri & Zaman Analizi
          </h1>
          <p className="text-sm text-emerald-100/75 mt-1 max-w-xl">
            {primaryAnalysis ? (
              <>İncelenen Tür: <strong className="text-emerald-300">{primaryAnalysis.species.turkishName || primaryAnalysis.species.canonicalName}</strong> (<em>{primaryAnalysis.species.scientificName}</em>) — {primaryAnalysis.countryName} kapsamı yıllık ve bölgesel istatistikleri.</>
            ) : (
              'GBIF açık bilim arşivinden hesaplanan yıllık trendler ve il dağılımı.'
            )}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          {/* Country Scope Toggle */}
          <div className="flex items-center gap-1.5 p-1 bg-[#0b1510] rounded-xl border border-emerald-800/60">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => onCountryChange('TR')}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                activeCountry === 'TR'
                  ? 'bg-emerald-500 text-[#0b1510] shadow-md'
                  : 'text-emerald-200/70 hover:text-white'
              }`}
            >
              Türkiye (TR)
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => onCountryChange('')}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                activeCountry === ''
                  ? 'bg-emerald-500 text-[#0b1510] shadow-md'
                  : 'text-emerald-200/70 hover:text-white'
              }`}
            >
              Tüm Dünya (Global)
            </button>
          </div>

          {/* Quick Search */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 bg-[#0b1510] p-2 rounded-2xl border border-emerald-700/50 shadow-md shrink-0">
            <div className="relative flex items-center flex-1">
              <Search className="w-4 h-4 text-emerald-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tür analizi yükle..."
                className="w-44 sm:w-56 pl-9 pr-3 py-2 bg-transparent text-white placeholder-emerald-100/40 text-xs focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !searchInput.trim()}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-[#0b1510] font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Analiz Et
            </button>
          </form>
        </div>
      </div>

      {/* Loading Indicator */}
      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-[#111e17] rounded-3xl border border-emerald-900/60 p-8">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-900/60 border-t-emerald-400 animate-spin" />
            <Compass className="w-8 h-8 text-emerald-400 absolute inset-0 m-auto" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">
            GBIF Açık Bilim Veri Tabanı Taranıyor
          </h3>
          <p className="text-xs text-emerald-300/70 max-w-sm">
            {activeCountry === 'TR' ? 'Türkiye (TR)' : 'Tüm Dünya (Global)'} kapsamı için gözlem kayıtları, yıllık istatistikler ve il dağılımı hesaplanıyor...
          </p>
        </div>
      ) : errorMessage ? (
        <div className="p-6 rounded-2xl bg-rose-950/40 border border-rose-700/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-rose-400 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-rose-200 mb-0.5">Tür Eşleşmesi Bulunamadı</h3>
              <p className="text-sm text-rose-200/90">{errorMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSearch('Ursus arctos', activeCountry)}
            className="px-4 py-2 bg-rose-900/60 hover:bg-rose-800/60 text-white rounded-xl text-xs font-semibold transition-colors shrink-0 cursor-pointer"
          >
            Bozayı Kaydını Yükle
          </button>
        </div>
      ) : primaryAnalysis ? (
        <div className="space-y-8">
          {/* Zero Record Notice for TR */}
          {primaryAnalysis.totalRecords === 0 && primaryAnalysis.countryCode === 'TR' && (
            <div className="p-5 rounded-2xl bg-amber-950/35 border border-amber-700/50 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                <p className="text-sm text-amber-100">
                  <strong>{primaryAnalysis.species.turkishName || primaryAnalysis.species.scientificName}</strong> için Türkiye (TR) sınırları içinde GBIF gözlem kaydı bulunamadı.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onCountryChange('')}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-[#0b1510] rounded-xl text-xs font-bold transition-colors shrink-0 cursor-pointer"
              >
                Tüm Dünya (Global) Kayıtlarını Göster
              </button>
            </div>
          )}

          {/* Overview Card */}
          <SpeciesOverview analysis={primaryAnalysis} />

          {/* Yearly Chart + Regional Distribution Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            <div className="lg:col-span-7">
              <YearlyAnalysisChart
                yearlyStats={primaryAnalysis.yearlyStats}
                peakYear={primaryAnalysis.peakYear}
                lowestYear={primaryAnalysis.lowestYear}
                earliestYear={primaryAnalysis.earliestYear}
                scientificName={primaryAnalysis.species.scientificName}
                totalRecords={primaryAnalysis.totalRecords}
                missingYearCount={primaryAnalysis.missingYearCount}
                invalidYearCount={primaryAnalysis.invalidYearCount}
                isYearFacetTruncated={primaryAnalysis.isYearFacetTruncated}
                isArchiveFacetCalculated={primaryAnalysis.isArchiveFacetCalculated}
              />
            </div>

            <div className="lg:col-span-5">
              <RegionalDistribution
                regionalStats={primaryAnalysis.regionalStats}
                unlocatedCount={primaryAnalysis.unlocatedCount}
                totalRecords={primaryAnalysis.totalRecords}
                isRegionFacetTruncated={primaryAnalysis.isRegionFacetTruncated}
                filteredRegionCodeCount={primaryAnalysis.filteredRegionCodeCount}
                regionFacetTotalCount={primaryAnalysis.regionFacetTotalCount}
              />
            </div>
          </div>

          {/* Record Details Table */}
          <RecordDetailTable
            occurrences={primaryAnalysis.occurrences}
            totalCount={primaryAnalysis.totalRecords}
          />
        </div>
      ) : (
        <div className="py-24 text-center bg-[#111e17] rounded-3xl border border-emerald-900/60 p-8">
          <BarChart3 className="w-12 h-12 text-emerald-400/60 mx-auto mb-3 animate-pulse" />
          <h3 className="text-lg font-bold text-white mb-2">Analiz İçin Tür Yüklenmedi</h3>
          <p className="text-xs text-emerald-300/70 max-w-sm mx-auto mb-6">
            Detaylı grafik ve bölge istatistiklerini görüntülemek için lütfen arama çubuğundan bir canlı türü aratın.
          </p>
          <button
            type="button"
            onClick={() => onSearch('Ursus arctos', activeCountry)}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-[#0b1510] font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Bozayı Kaydını Yükle
          </button>
        </div>
      )}
    </div>
  );
};
