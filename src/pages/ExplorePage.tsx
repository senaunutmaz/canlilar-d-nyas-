import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TaxonGroupExplorer } from '../components/TaxonGroupExplorer';
import { Search, Compass, ArrowRight } from 'lucide-react';

interface ExplorePageProps {
  onSelectSpecies: (scientificName: string, country: string, turkishName?: string) => void;
  activeCountry: string;
  onCountryChange: (country: string) => void;
}

export const ExplorePage: React.FC<ExplorePageProps> = ({
  onSelectSpecies,
  activeCountry,
  onCountryChange,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlQuery = searchParams.get('q')?.trim() || 'Kuş';
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
    if (clean) {
      setActiveQuery(clean);
      setSearchParams({ q: clean, country: effectiveCountry });
    }
  };

  const quickGroups = ['Kuş', 'Memeli', 'Böcek', 'Kelebek', 'Balık', 'Yılan', 'Sürüngen', 'Kurbağa', 'Örümcek', 'Tilki', 'Kurt', 'Kedi', 'Ayı', 'Baykuş', 'Yunus'];

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Search & Category Bar */}
      <div className="bg-[#111e17] rounded-3xl p-6 sm:p-8 border border-emerald-800/50 shadow-2xl">
        <div className="max-w-3xl mx-auto text-center mb-6">
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-2 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-800/40">
            <Compass className="w-3.5 h-3.5" />
            <span>Tüm Animalia Alemi Dinamik Keşif</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-3">
            Canlı Türleri Keşif Alanı
          </h1>
          <p className="text-sm text-emerald-100/75 leading-relaxed">
            Arama alanına herhangi bir hayvan grubu (ör. <em>Kelebek, Kuş, Böcek, Balık, Memeli, Sürüngen...</em>) veya cins/tür adı yazarak GBIF Backbone hiyerarşisinde gerçek zamanlı keşif yapın.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="max-w-2xl mx-auto flex items-center gap-2 bg-[#0b1510] p-2.5 rounded-2xl border border-emerald-700/50 shadow-lg">
          <div className="relative flex-1 flex items-center">
            <Search className="w-5 h-5 text-emerald-400 absolute left-4 pointer-events-none" />
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Hayvan grubu veya tür adı yazın (örn: Kelebek, Kuş, Kurt, Balık...)"
              className="w-full pl-11 pr-4 py-3 bg-transparent text-white placeholder-emerald-100/40 text-sm focus:outline-none font-medium"
            />
          </div>
          <button
            type="submit"
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-[#0b1510] font-bold text-sm rounded-xl transition-all shadow-md flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <span>Keşfet</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Quick Chips */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-emerald-200/80">
          <span className="font-medium text-emerald-300">Popüler gruplar:</span>
          {quickGroups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setInputQuery(g);
                setActiveQuery(g);
                setSearchParams({ q: g, country: effectiveCountry });
              }}
              className="px-3 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-800/50 text-emerald-200 hover:text-white border border-emerald-800/40 transition-colors cursor-pointer"
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Taxon Group Explorer */}
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
    </div>
  );
};
