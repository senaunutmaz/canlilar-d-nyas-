import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InteractiveMap } from '../components/InteractiveMap';
import { SpeciesAnalysis, SearchErrorType } from '../types/biodiversity';
import { MapPin, Search, Compass, AlertCircle } from 'lucide-react';

interface MapPageProps {
  primaryAnalysis: SpeciesAnalysis | null;
  activeCountry: string;
  onSearch: (query: string, country: string) => void;
  isLoading: boolean;
  onCountryChange: (country: string) => void;
  errorMessage?: string | null;
  errorType?: SearchErrorType | null;
  onRetry?: () => void;
}

export const MapPage: React.FC<MapPageProps> = ({
  primaryAnalysis,
  activeCountry,
  onSearch,
  isLoading,
  onCountryChange,
  errorMessage,
  errorType,
  onRetry,
}) => {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState<string>('');
  const isApiError = errorType === 'ERROR';

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
            <MapPin className="w-3.5 h-3.5" />
            <span>OpenStreetMap & Leaflet Gözlem Konumları</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Biyoçeşitlilik Gözlem Haritası
          </h1>
          <p className="text-sm text-emerald-100/75 mt-1 max-w-xl">
            {primaryAnalysis ? (
              <>Aktif Tür: <strong className="text-emerald-300">{primaryAnalysis.species.turkishName || primaryAnalysis.species.canonicalName}</strong> (<em>{primaryAnalysis.species.scientificName}</em>) için GBIF GPS koordinat haritası ({primaryAnalysis.countryName}).</>
            ) : (
              'GBIF açık bilim veritabanından indirilen GPS gözlem noktaları.'
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

          {/* Quick Species Search on Map Page */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 bg-[#0b1510] p-2 rounded-2xl border border-emerald-700/50 shadow-md shrink-0">
            <div className="relative flex items-center flex-1">
              <Search className="w-4 h-4 text-emerald-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tür değiştir (örn: Bozayı, Kurt)..."
                className="w-44 sm:w-56 pl-9 pr-3 py-2 bg-transparent text-white placeholder-emerald-100/40 text-xs focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !searchInput.trim()}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-[#0b1510] font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Yükle
            </button>
          </form>
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-[#111e17] rounded-3xl border border-emerald-900/60 p-8">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-900/60 border-t-emerald-400 animate-spin" />
            <Compass className="w-8 h-8 text-emerald-400 absolute inset-0 m-auto" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">
            GBIF Gözlem Koordinatları Yükleniyor
          </h3>
          <p className="text-xs text-emerald-300/70 max-w-sm">
            {activeCountry === 'TR' ? 'Türkiye (TR)' : 'Tüm Dünya (Global)'} kapsamı için GPS kayıtları getiriliyor...
          </p>
        </div>
      ) : errorMessage ? (
        <div
          className={`p-6 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 ${
            isApiError
              ? 'bg-amber-950/40 border-amber-700/50'
              : 'bg-rose-950/40 border-rose-700/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <AlertCircle
              className={`w-6 h-6 shrink-0 ${isApiError ? 'text-amber-400' : 'text-rose-400'}`}
            />
            <div>
              <h3
                className={`text-sm font-bold mb-0.5 ${
                  isApiError ? 'text-amber-200' : 'text-rose-200'
                }`}
              >
                {isApiError ? 'Veri Kaynağına Erişilemedi' : 'Sonuç Bulunamadı'}
              </h3>
              <p className={`text-sm ${isApiError ? 'text-amber-200/90' : 'text-rose-200/90'}`}>
                {errorMessage}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isApiError && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-4 py-2 bg-amber-800/70 hover:bg-amber-700/80 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Tekrar Dene
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
              className={`px-4 py-2 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                isApiError ? 'bg-[#13241b] hover:bg-emerald-950 border border-emerald-800/50' : 'bg-rose-900/60 hover:bg-rose-800/60'
              }`}
            >
              Tür Keşfine Git
            </button>
          </div>
        </div>
      ) : primaryAnalysis ? (
        <InteractiveMap
          occurrences={primaryAnalysis.occurrences}
          totalRecords={primaryAnalysis.totalRecords}
          species={primaryAnalysis.species}
          countryCode={primaryAnalysis.countryCode}
        />
      ) : (
        <div className="py-24 text-center bg-[#111e17] rounded-3xl border border-emerald-900/60 p-8">
          <MapPin className="w-12 h-12 text-emerald-400/60 mx-auto mb-3 animate-bounce" />
          <h3 className="text-lg font-bold text-white mb-2">Harita İçin Tür Yüklenmedi</h3>
          <p className="text-xs text-emerald-300/70 max-w-sm mx-auto mb-6">
            Gözlem haritasını görüntülemek için lütfen yukarıdaki arama çubuğundan bir canlı türü aratın.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-[#0b1510] font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Tür Keşfine Git
          </button>
        </div>
      )}
    </div>
  );
};
