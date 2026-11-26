import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HeroSection } from '../components/HeroSection';
import { SpeciesDiscovery } from '../components/SpeciesDiscovery';
import { SearchErrorType } from '../types/biodiversity';
import { Compass, MapPin, ArrowRight, Shield, BarChart3, Layers, AlertCircle } from 'lucide-react';

interface HomePageProps {
  onSearch: (query: string, country: string) => void;
  isLoading: boolean;
  activeCountry: string;
  onCountryChange: (country: string) => void;
  errorMessage?: string | null;
  errorType?: SearchErrorType | null;
  onRetry?: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onSearch,
  isLoading,
  activeCountry,
  onCountryChange,
  errorMessage,
  errorType,
  onRetry,
}) => {
  const navigate = useNavigate();
  const isApiError = errorType === 'ERROR';

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
          <div
            className={`p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm ${
              isApiError
                ? 'bg-[#FDF6EC] border-[#F3D9B5]'
                : 'bg-rose-50 border-rose-200'
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle
                className={`w-5 h-5 shrink-0 mt-0.5 ${isApiError ? 'text-amber-700' : 'text-rose-600'}`}
              />
              <div>
                <h3
                  className={`text-sm font-bold mb-0.5 ${
                    isApiError ? 'text-[#7A4E16]' : 'text-rose-900'
                  }`}
                >
                  {isApiError ? 'Veri Kaynağına Erişilemedi' : 'Sonuç Bulunamadı'}
                </h3>
                <p
                  className={`text-xs sm:text-sm leading-relaxed ${
                    isApiError ? 'text-[#7A4E16]/90' : 'text-rose-800'
                  }`}
                >
                  {errorMessage}
                </p>
              </div>
            </div>
            {isApiError && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-4 py-2 bg-[#247A63] hover:bg-[#1D6350] text-white rounded-xl text-xs font-semibold transition-colors shrink-0 cursor-pointer"
              >
                Tekrar Dene
              </button>
            )}
          </div>
        </section>
      )}

      {/* Quick Navigation Tile Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <span className="text-xs font-mono uppercase tracking-widest text-[#247A63] font-semibold block mb-2">
            Canlı Atlası Keşif Modülleri
          </span>
          <h2 className="text-3xl font-extrabold text-[#1E332B] tracking-tight">
            Biyoçeşitlilik Portalları
          </h2>
          <p className="text-sm text-[#556B62] mt-2 max-w-xl mx-auto leading-relaxed">
            Milyonlarca GBIF gözlem kaydını interaktif haritalar, zamansal analizler ve çok sayfalı keşif araçlarıyla inceleyin.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Tile 1: Explore */}
          <div 
            onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
            className="group bg-white hover:bg-[#F9FCF8] rounded-3xl p-6 border border-[#D6E4DC] hover:border-[#8CCFB0] shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#DDEFE3] border border-[#8CCFB0]/60 flex items-center justify-center text-[#247A63] mb-4 group-hover:scale-105 transition-transform">
                <Compass className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#1E332B] mb-2 group-hover:text-[#247A63] transition-colors">
                Dinamik Tür Keşfi
              </h3>
              <p className="text-xs text-[#556B62] leading-relaxed mb-4">
                Bütün Animalia alemini kapsayan genel hayvan grupları, alt gruplar ve doğrulanmış tür indeksleri.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#247A63] group-hover:translate-x-1 transition-transform">
              <span>Keşfetmeye Başla</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 2: Map */}
          <div 
            onClick={() => navigate('/harita')}
            className="group bg-white hover:bg-[#F9FCF8] rounded-3xl p-6 border border-[#D6E4DC] hover:border-[#B9DDEB] shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#ECF6FA] border border-[#B9DDEB] flex items-center justify-center text-[#1B6884] mb-4 group-hover:scale-105 transition-transform">
                <MapPin className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#1E332B] mb-2 group-hover:text-[#247A63] transition-colors">
                Biyoçeşitlilik Haritası
              </h3>
              <p className="text-xs text-[#556B62] leading-relaxed mb-4">
                OpenStreetMap ve Leaflet altyapısıyla Türkiye ve Global ölçekte gerçek GPS gözlem noktaları.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#247A63] group-hover:translate-x-1 transition-transform">
              <span>Haritayı Aç</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 3: Analysis */}
          <div 
            onClick={() => navigate('/analiz')}
            className="group bg-white hover:bg-[#F9FCF8] rounded-3xl p-6 border border-[#D6E4DC] hover:border-[#8CCFB0] shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#DDEFE3] border border-[#8CCFB0]/60 flex items-center justify-center text-[#247A63] mb-4 group-hover:scale-105 transition-transform">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#1E332B] mb-2 group-hover:text-[#247A63] transition-colors">
                Veri & Zaman Analizi
              </h3>
              <p className="text-xs text-[#556B62] leading-relaxed mb-4">
                Yıllara göre gözlem dağılım grafikleri, zirve yılları, il ve bölge yoğunluk normalizasyonları.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#247A63] group-hover:translate-x-1 transition-transform">
              <span>Analizleri İncele</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 4: Conservation */}
          <div 
            onClick={() => navigate('/koruma')}
            className="group bg-white hover:bg-[#F9FCF8] rounded-3xl p-6 border border-[#D6E4DC] hover:border-[#8CCFB0] shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#ECF6FA] border border-[#B9DDEB] flex items-center justify-center text-[#1B6884] mb-4 group-hover:scale-105 transition-transform">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#1E332B] mb-2 group-hover:text-[#247A63] transition-colors">
                Koruma & IUCN Kılavuzu
              </h3>
              <p className="text-xs text-[#556B62] leading-relaxed mb-4">
                Nesli tehlike altındaki türler, IUCN kırmızı liste kategorileri ve ekolojik koruma kriterleri.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#247A63] group-hover:translate-x-1 transition-transform">
              <span>Rehberi Gör</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Tile 5: Compare */}
          <div 
            onClick={() => navigate('/karsilastir')}
            className="group bg-white hover:bg-[#F9FCF8] rounded-3xl p-6 border border-[#D6E4DC] hover:border-[#F3D9B5] shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#FDF6EC] border border-[#F3D9B5] flex items-center justify-center text-[#9A631A] mb-4 group-hover:scale-105 transition-transform">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#1E332B] mb-2 group-hover:text-[#247A63] transition-colors">
                Tür Karşılaştırma
              </h3>
              <p className="text-xs text-[#556B62] leading-relaxed mb-4">
                İki farklı canlı türünün gözlem kayıtlarını ve bölgesel dağılımlarını yan yana kıyaslayın.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#247A63] group-hover:translate-x-1 transition-transform">
              <span>Karşılaştır</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </section>

      {/* Featured Species Discovery Showcase */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <SpeciesDiscovery
          onSelectSpecies={(sciName) => {
            onSearch(sciName, activeCountry);
          }}
        />
      </section>
    </div>
  );
};
