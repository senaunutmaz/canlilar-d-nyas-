import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TaxonGroupExplorer } from '../components/TaxonGroupExplorer';
import { HorseBreedsExplorer } from '../components/HorseBreedsExplorer';
import { isHorseBreedCatalogQuery, resolveHorseBreedQuery } from '../data/horseBreeds';
import { Search, Compass, ArrowRight } from 'lucide-react';

interface ExplorePageProps {
  onSelectSpecies: (scientificName: string, country: string, turkishName?: string) => void;
  activeCountry: string;
  onCountryChange: (country: string) => void;
  defaultQuery?: string;
}

export const ExplorePage: React.FC<ExplorePageProps> = ({
  onSelectSpecies,
  activeCountry,
  onCountryChange,
  defaultQuery = '',
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlQuery = searchParams.get('q')?.trim() || defaultQuery;
  const urlCountry = searchParams.get('country');
  const effectiveCountry = urlCountry !== null ? urlCountry : activeCountry;

  const [inputQuery, setInputQuery] = useState<string>(urlQuery);
  const [activeQuery, setActiveQuery] = useState<string>(urlQuery);

  useEffect(() => {
    setInputQuery(urlQuery);
    setActiveQuery(urlQuery);
  }, [urlQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputQuery.trim();
    if (!clean) return;
    const matchedBreed = resolveHorseBreedQuery(clean);
    if (matchedBreed) {
      navigate(`/at-irklari/${matchedBreed.slug}?country=${encodeURIComponent(effectiveCountry)}`);
      return;
    }
    setActiveQuery(clean);
    setSearchParams({ q: clean, country: effectiveCountry });
  };

  const quickGroups = ['Kuş', 'Memeli', 'Böcek', 'Kelebek', 'Balık', 'Yılan', 'Sürüngen', 'Kurbağa', 'Örümcek', 'Tilki', 'Kurt', 'Kedi', 'Ayı', 'Baykuş', 'Yunus', 'At'];

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Search & Category Bar */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#D6E4DC] shadow-sm">
        <div className="max-w-3xl mx-auto text-center mb-6">
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#247A63] font-semibold mb-2">
            <Compass className="w-3.5 h-3.5" />
            <span>Tüm Animalia Alemi Dinamik Keşif</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1E332B] tracking-tight mb-3">
            Canlı Türleri Keşif Alanı
          </h1>
          <p className="text-sm text-[#556B62] leading-relaxed">
            Arama alanına herhangi bir hayvan grubu (ör. <em>Kelebek, Kuş, Böcek, Balık, Memeli, Sürüngen...</em>) veya cins/tür adı yazarak GBIF Backbone hiyerarşisinde gerçek zamanlı keşif yapın.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="max-w-2xl mx-auto flex items-center gap-2 bg-[#F5F9F4] p-2 rounded-2xl border border-[#D6E4DC] shadow-2xs">
          <div className="relative flex-1 flex items-center">
            <Search className="w-5 h-5 text-[#247A63] absolute left-4 pointer-events-none" />
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Hayvan grubu veya tür adı yazın (örn: Kelebek, Kuş, Kurt, Balık...)"
              className="w-full pl-11 pr-4 py-3 bg-transparent text-[#1E332B] placeholder-[#556B62]/65 text-sm focus:outline-none font-medium"
            />
          </div>
          <button
            type="submit"
            disabled={!inputQuery.trim()}
            className="px-6 py-3 bg-[#247A63] hover:bg-[#1D6350] disabled:bg-[#DDEFE3] disabled:text-[#556B62] text-white font-bold text-sm rounded-xl transition-all shadow-xs flex items-center gap-2 shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Keşfet</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Quick Chips */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-[#556B62]">
          <span className="font-semibold text-[#1E332B]">Popüler gruplar:</span>
          {quickGroups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setInputQuery(g);
                setActiveQuery(g);
                setSearchParams({ q: g, country: effectiveCountry });
              }}
              className={`px-3 py-1.5 rounded-lg border transition-colors cursor-pointer font-medium ${
                activeQuery.toLocaleLowerCase('tr-TR') === g.toLocaleLowerCase('tr-TR')
                  ? 'bg-[#247A63] text-white border-[#247A63] shadow-xs'
                  : 'bg-[#F5F9F4] hover:bg-[#DDEFE3] text-[#1E332B] border-[#D6E4DC]'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Discovery Content: Horse Breeds Catalog, Taxon Group Explorer, or Clean Idle State */}
      {!activeQuery ? (
        <div className="py-16 px-6 text-center bg-white rounded-3xl border border-[#D6E4DC] shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-[#DDEFE3] text-[#247A63] flex items-center justify-center mx-auto mb-4">
            <Compass className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[#1E332B] mb-2">Keşif İçin Bir Grup veya Tür Seçin</h2>
          <p className="text-xs sm:text-sm text-[#556B62] max-w-lg mx-auto leading-relaxed">
            Yukarıdaki arama kutusuna bir canlı grubu yazarak veya popüler gruplardan birini seçerek GBIF Backbone taramasını başlatabilirsiniz.
          </p>
        </div>
      ) : isHorseBreedCatalogQuery(activeQuery) ? (
        <HorseBreedsExplorer
          searchQuery={activeQuery}
          countryCode={effectiveCountry}
          onSelectBreed={(breed) => {
            navigate(`/at-irklari/${breed.slug}?country=${encodeURIComponent(effectiveCountry)}`);
          }}
          onInspectBiologicalSpecies={() => {
            onSelectSpecies('Equus caballus', effectiveCountry, 'At');
          }}
          onBackToDefault={() => navigate('/')}
        />
      ) : (
        <TaxonGroupExplorer
          searchQuery={activeQuery}
          countryCode={effectiveCountry}
          onSelectSpecies={(sciName, country, turkishName) => {
            onSelectSpecies(sciName, country, turkishName);
          }}
          onBackToDefault={() => navigate('/')}
          onCountryChange={(nextCountry) => {
            onCountryChange(nextCountry);
            setSearchParams({ q: activeQuery, country: nextCountry }, { replace: true });
          }}
        />
      )}
    </div>
  );
};
