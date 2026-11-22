import React, { useState } from 'react';
import { InteractiveMap } from '../components/InteractiveMap';
import { SpeciesAnalysis } from '../types/biodiversity';
import { MapPin, Globe2, Search, ArrowRight } from 'lucide-react';

interface MapPageProps {
  primaryAnalysis: SpeciesAnalysis | null;
  activeCountry: string;
  onSearch: (query: string, country: string) => void;
  isLoading: boolean;
  onCountryChange: (country: string) => void;
}

export const MapPage: React.FC<MapPageProps> = ({
  primaryAnalysis,
  activeCountry,
  onSearch,
  isLoading,
  onCountryChange,
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
      <div className="bg-[#111e17] rounded-3xl p-6 sm:p-8 border border-emerald-800/50 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
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
              <>Aktif Tür: <strong className="text-emerald-300">{primaryAnalysis.species.turkishName || primaryAnalysis.species.canonicalName}</strong> (*{primaryAnalysis.species.scientificName}*) için GBIF GPS koordinat haritası.</>
            ) : (
              'GBIF açık bilim veritabanından indirilen GPS gözlem noktaları.'
            )}
          </p>
        </div>

        {/* Quick Species Search on Map Page */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 bg-[#0b1510] p-2 rounded-2xl border border-emerald-700/50 shadow-md shrink-0">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-emerald-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tür değiştir (örn: Bozayı, Kurt)..."
              className="w-48 sm:w-64 pl-9 pr-3 py-2 bg-transparent text-white placeholder-emerald-100/40 text-xs focus:outline-none"
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

      {/* Interactive Map Viewport */}
      {primaryAnalysis ? (
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
