import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HeroSection } from '../components/HeroSection';
import { SpeciesDiscovery } from '../components/SpeciesDiscovery';
import { Compass, MapPin, ArrowRight, Shield, BarChart3, Layers, AlertCircle } from 'lucide-react';

interface HomePageProps {
  onSearch: (query: string, country: string) => void;
  isLoading: boolean;
  activeCountry: string;
  onCountryChange: (country: string) => void;
  errorMessage?: string | null;
}

export const HomePage: React.FC<HomePageProps> = ({
  onSearch,
  isLoading,
  activeCountry,
  onCountryChange,
  errorMessage,
}) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-12">
      {/* Hero Search Console */}
      <HeroSection
        onSearch={(query, country) => {
          onSearch(query, country);
        }}
        onCountryChange={onCountryChange}
        isLoading={isLoading}
        activeCountry={activeCountry}
      />

      {/* Search Error / Not Found Alert */}
      {!isLoading && errorMessage && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-5 rounded-2xl bg-rose-950/40 border border-rose-700/50 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-rose-200 mb-0.5">Arama Sonucu Bulunamadı</h3>
              <p className="text-xs sm:text-sm text-rose-200/90 leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        </section>
      )}

      {/* Quick Navigation Tile Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-2 bg-emerald-950/60 border border-emerald-800/40 px-3 py-1 rounded-full">
            <span>Canlı Atlası Keşif Modülleri</span>
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            Biyoçeşitlilik Portalları
          </h2>
          <p className="text-sm text-emerald-100/70 mt-1 max-w-xl mx-auto">
            Milyonlarca GBIF gözlem kaydını interaktif haritalar, zamansal analizler ve çok sayfalı keşif araçlarıyla inceleyin.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Tile 1: Explore */}
          <div 
            onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
            className="group bg-[#111e17] hover:bg-[#13241b] rounded-3xl p-6 border border-emerald-900/60 hover:border-emerald-500/60 shadow-xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                <Compass className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-emerald-300 transition-colors">
                Dinamik Tür Keşfi
              </h3>
              <p className="text-xs text-emerald-100/70 leading-relaxed mb-4">
                Bütün Animalia alemini kapsayan genel hayvan grupları, alt gruplar ve doğrulanmış tür indeksleri.
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Keşfetmeye Başla</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 2: Map */}
          <div 
            onClick={() => navigate('/harita')}
            className="group bg-[#111e17] hover:bg-[#13241b] rounded-3xl p-6 border border-emerald-900/60 hover:border-emerald-500/60 shadow-xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                <MapPin className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-emerald-300 transition-colors">
                Biyoçeşitlilik Haritası
              </h3>
              <p className="text-xs text-emerald-100/70 leading-relaxed mb-4">
                OpenStreetMap ve Leaflet altyapısıyla Türkiye ve Global ölçekte gerçek GPS gözlem noktaları.
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Haritayı Aç</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 3: Analysis */}
          <div 
            onClick={() => navigate('/analiz')}
            className="group bg-[#111e17] hover:bg-[#13241b] rounded-3xl p-6 border border-emerald-900/60 hover:border-emerald-500/60 shadow-xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-emerald-300 transition-colors">
                Veri & Zaman Analizi
              </h3>
              <p className="text-xs text-emerald-100/70 leading-relaxed mb-4">
                Yıllara göre gözlem dağılım grafikleri, zirve yılları, il ve bölge yoğunluk normalizasyonları.
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Analizleri İncele</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 4: Conservation */}
          <div 
            onClick={() => navigate('/koruma')}
            className="group bg-[#111e17] hover:bg-[#13241b] rounded-3xl p-6 border border-emerald-900/60 hover:border-emerald-500/60 shadow-xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-emerald-300 transition-colors">
                Koruma & IUCN Kılavuzu
              </h3>
              <p className="text-xs text-emerald-100/70 leading-relaxed mb-4">
                Nesli tehlike altındaki türler, IUCN kırmızı liste kategorileri ve ekolojik koruma kriterleri.
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Rehberi Gör</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 5: Compare */}
          <div 
            onClick={() => navigate('/karsilastir')}
            className="group bg-[#111e17] hover:bg-[#13241b] rounded-3xl p-6 border border-emerald-900/60 hover:border-emerald-500/60 shadow-xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-emerald-300 transition-colors">
                Tür Karşılaştırma
              </h3>
              <p className="text-xs text-emerald-100/70 leading-relaxed mb-4">
                İki farklı canlı türünün gözlem kayıtlarını ve bölgesel dağılımlarını yan yana kıyaslayın.
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Karşılaştır</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </section>

      {/* Featured Species Discovery Showcase */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        <SpeciesDiscovery
          onSelectSpecies={(sciName) => {
            onSearch(sciName, activeCountry);
          }}
        />
      </section>
    </div>
  );
};
