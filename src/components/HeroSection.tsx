import React, { useEffect, useState } from 'react';
import { Search, Globe2, ArrowRight } from 'lucide-react';
import heroBg from './assets/images/canli_atlasi_hero_1794352926481.jpg';

interface HeroSectionProps {
  onSearch: (query: string, country: string) => void;
  onCountryChange?: (country: string) => void;
  isLoading: boolean;
  activeCountry: string;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onSearch,
  onCountryChange,
  isLoading,
  activeCountry,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [country, setCountry] = useState(activeCountry);

  useEffect(() => {
    setCountry(activeCountry);
  }, [activeCountry]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onSearch(searchInput.trim(), country);
    }
  };

  const handleQuickChip = (term: string) => {
    setSearchInput(term);
    onSearch(term, country);
  };

  const quickSpecies = [
    { label: 'Bozayı (Ursus arctos)', query: 'Ursus arctos' },
    { label: 'Vaşak (Lynx lynx)', query: 'Lynx lynx' },
    { label: 'Bozkurt (Canis lupus)', query: 'Canis lupus' },
    { label: 'Caretta caretta', query: 'Caretta caretta' },
    { label: 'Kelaynak (Geronticus eremita)', query: 'Geronticus eremita' },
    { label: 'Akdeniz Foku (Monachus)', query: 'Monachus monachus' }
  ];

  return (
    <section id="arama" className="relative overflow-hidden border-b border-[#D6E4DC] bg-[#F5F9F4]">
      {/* Subtle Daylight Nature Backdrop */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <img
          src={heroBg}
          alt="Anadolu dağları ve sisli ormanlar"
          className="w-full h-full object-cover object-center opacity-18"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#F5F9F4]/80 via-[#F5F9F4]/88 to-[#F5F9F4]" />
        <div className="absolute -top-24 left-1/4 w-[420px] h-[420px] rounded-full bg-[#DDEFE3]/70 blur-3xl" />
        <div className="absolute -bottom-24 right-1/4 w-[380px] h-[380px] rounded-full bg-[#B9DDEB]/45 blur-3xl" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 pt-16 pb-20 text-center">
        {/* Clean Unboxed Metadata Kicker */}
        <div className="inline-flex flex-wrap items-center justify-center gap-2 text-xs font-mono uppercase tracking-wider text-[#247A63] font-semibold mb-4">
          <span>GBIF Açık Bilim Verisi</span>
          <span aria-hidden="true" className="text-[#8CCFB0]">·</span>
          <span>OpenStreetMap & Leaflet</span>
          <span aria-hidden="true" className="text-[#8CCFB0]">·</span>
          <span>Biyoçeşitlilik Analizi</span>
        </div>

        {/* Main Display Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-[#1E332B] mb-5 text-balance">
          Kaybolan Canlıların İzinde
        </h1>
        <p className="text-lg sm:text-xl text-[#556B62] max-w-2xl mx-auto font-normal leading-relaxed mb-10 text-balance">
          <strong className="text-[#247A63] font-bold">Canlı Atlası</strong>, açık küresel veri tabanlarından beslenen, geçmiş yıllardaki bilimsel gözlemleri, coğrafi yayılışı ve türlerin korunma durumunu inceleyen etkileşimli bir dijital hafıza platformudur.
        </p>

        {/* Main Search Console */}
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={handleSubmit}
            className="relative flex flex-col sm:flex-row items-stretch gap-2.5 bg-white p-2.5 rounded-2xl border border-[#D6E4DC] shadow-lg shadow-[#247A63]/8"
          >
            {/* Search Input */}
            <div className="relative flex-1 flex items-center">
              <Search className="w-5 h-5 text-[#247A63] absolute left-4 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Canlı adı veya bilimsel ad yazın (örn: Ursus arctos, Bozayı, Kurt, Vaşak...)"
                className="w-full pl-11 pr-4 py-3.5 bg-transparent text-[#1E332B] placeholder-[#556B62]/65 text-base focus:outline-none focus:ring-0 font-medium"
              />
            </div>

            {/* Country Selector */}
            <div className="flex items-center gap-1.5 px-3 py-2 bg-[#F5F9F4] rounded-xl border border-[#D6E4DC] shrink-0">
              <Globe2 className="w-4 h-4 text-[#247A63]" />
              <select
                value={country}
                onChange={(e) => {
                  const nextCountry = e.target.value;
                  setCountry(nextCountry);
                  if (searchInput.trim()) {
                    onSearch(searchInput.trim(), nextCountry);
                  } else if (onCountryChange) {
                    onCountryChange(nextCountry);
                  }
                }}
                className="bg-transparent text-xs font-semibold text-[#1E332B] focus:outline-none cursor-pointer pr-2"
              >
                <option value="TR" className="bg-white text-[#1E332B]">Türkiye Kayıtları (TR)</option>
                <option value="" className="bg-white text-[#1E332B]">Tüm Dünya (Global)</option>
              </select>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !searchInput.trim()}
              className="px-6 py-3.5 bg-[#247A63] hover:bg-[#1D6350] disabled:bg-[#DDEFE3] disabled:text-[#556B62] text-white font-bold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>GBIF Taranıyor...</span>
                </>
              ) : (
                <>
                  <span>Gözlemleri Getir</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Filter Search Prompts */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-[#556B62]">
            <span className="font-semibold text-[#1E332B]">Örnek türler:</span>
            {quickSpecies.map((s) => (
              <button
                key={s.query}
                type="button"
                onClick={() => handleQuickChip(s.query)}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#DDEFE3] text-[#1E332B] hover:text-[#247A63] border border-[#D6E4DC] hover:border-[#8CCFB0] transition-colors shadow-2xs cursor-pointer font-medium"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
};
