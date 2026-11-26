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
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#D6E4DC] shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#1B6884] font-semibold mb-2">
            <MapPin className="w-3.5 h-3.5" />
            <span>OpenStreetMap & Leaflet Gözlem Konumları</span>
          </div>
          <h1 className="text-3xl font-extrabold text-[#1E332B] tracking-tight">
            Biyoçeşitlilik Gözlem Haritası
          </h1>
          <p className="text-sm text-[#556B62] mt-1.5 max-w-xl leading-relaxed">
            {primaryAnalysis ? (
              <>Aktif Tür: <strong className="text-[#247A63]">{primaryAnalysis.species.turkishName || primaryAnalysis.species.canonicalName}</strong> (<em>{primaryAnalysis.species.scientificName}</em>) için GBIF GPS koordinat haritası ({primaryAnalysis.countryName}).</>
            ) : (
              'GBIF açık bilim veritabanından indirilen GPS gözlem noktaları.'
            )}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          {/* Country Scope Toggle */}
          <div className="flex items-center gap-1 p-1 bg-[#F5F9F4] rounded-xl border border-[#D6E4DC]">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => onCountryChange('TR')}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                activeCountry === 'TR'
                  ? 'bg-[#247A63] text-white shadow-xs'
                  : 'text-[#556B62] hover:text-[#1E332B]'
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
                  ? 'bg-[#247A63] text-white shadow-xs'
                  : 'text-[#556B62] hover:text-[#1E332B]'
              }`}
            >
              Tüm Dünya (Global)
            </button>
          </div>

          {/* Quick Species Search on Map Page */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 bg-[#F5F9F4] p-1.5 rounded-2xl border border-[#D6E4DC] shrink-0">
            <div className="relative flex items-center flex-1">
              <Search className="w-4 h-4 text-[#247A63] absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tür değiştir (örn: Bozayı, Kurt)..."
                className="w-44 sm:w-56 pl-9 pr-3 py-2 bg-transparent text-[#1E332B] placeholder-[#556B62]/65 text-xs focus:outline-none font-medium"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !searchInput.trim()}
              className="px-4 py-2 bg-[#247A63] hover:bg-[#1D6350] disabled:bg-[#DDEFE3] disabled:text-[#556B62] text-white font-bold text-xs rounded-xl transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              Yükle
            </button>
          </form>
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-white rounded-3xl border border-[#D6E4DC] p-8 shadow-xs">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-[#DDEFE3] border-t-[#247A63] animate-spin" />
            <Compass className="w-8 h-8 text-[#247A63] absolute inset-0 m-auto" />
          </div>
          <h3 className="text-xl font-bold text-[#1E332B] mb-2">
            GBIF Gözlem Koordinatları Yükleniyor
          </h3>
          <p className="text-xs text-[#556B62] max-w-sm">
            {activeCountry === 'TR' ? 'Türkiye (TR)' : 'Tüm Dünya (Global)'} kapsamı için GPS kayıtları getiriliyor...
          </p>
        </div>
      ) : errorMessage ? (
        <div
          className={`p-6 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs ${
            isApiError
              ? 'bg-[#FDF6EC] border-[#F3D9B5]'
              : 'bg-rose-50 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <AlertCircle
              className={`w-6 h-6 shrink-0 ${isApiError ? 'text-amber-700' : 'text-rose-600'}`}
            />
            <div>
              <h3
                className={`text-sm font-bold mb-0.5 ${
                  isApiError ? 'text-[#6E4716]' : 'text-rose-900'
                }`}
              >
                {isApiError ? 'Veri Kaynağına Erişilemedi' : 'Sonuç Bulunamadı'}
              </h3>
              <p className={`text-sm ${isApiError ? 'text-[#6E4716]/90' : 'text-rose-800'}`}>
                {errorMessage}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isApiError && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-4 py-2 bg-[#247A63] hover:bg-[#1D6350] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Tekrar Dene
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                isApiError ? 'bg-white hover:bg-[#F5F9F4] text-[#1E332B] border border-[#D6E4DC]' : 'bg-rose-700 hover:bg-rose-800 text-white'
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
        <div className="py-24 text-center bg-white rounded-3xl border border-[#D6E4DC] p-8 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-[#ECF6FA] border border-[#B9DDEB] text-[#1B6884] flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-[#1E332B] mb-2">Harita İçin Tür Yüklenmedi</h3>
          <p className="text-xs text-[#556B62] max-w-sm mx-auto mb-6 leading-relaxed">
            Gözlem haritasını görüntülemek için lütfen yukarıdaki arama çubuğundan bir canlı türü aratın.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
            className="px-5 py-2.5 bg-[#247A63] hover:bg-[#1D6350] text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs"
          >
            Tür Keşfine Git
          </button>
        </div>
      )}
    </div>
  );
};
