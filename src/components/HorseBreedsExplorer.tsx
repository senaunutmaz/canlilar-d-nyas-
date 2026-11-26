import React, { useEffect, useMemo, useState } from 'react';
import {
  HORSE_BREEDS_CATALOG,
  fetchVerifiedHorseBreedPhotos,
} from '../data/horseBreeds';
import { HorseBreedCategory, HorseBreedRecord } from '../types/biodiversity';
import {
  ArrowUpRight,
  Compass,
  Info,
  Layers,
  MapPin,
  Search,
  Sparkles,
  ImageOff,
  X,
} from 'lucide-react';

interface HorseBreedsExplorerProps {
  searchQuery: string;
  countryCode: string;
  onSelectBreed: (breed: HorseBreedRecord) => void;
  onInspectBiologicalSpecies: () => void;
  onBackToDefault: () => void;
}

export const HorseBreedsExplorer: React.FC<HorseBreedsExplorerProps> = ({
  searchQuery,
  onSelectBreed,
  onInspectBiologicalSpecies,
  onBackToDefault,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | HorseBreedCategory>('all');
  const [filterText, setFilterText] = useState<string>('');
  const [photoMap, setPhotoMap] = useState<Record<string, { photoUrl: string; sourceTitle: string }>>({});
  const [isCheckingPhotos, setIsCheckingPhotos] = useState<boolean>(true);
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    setIsCheckingPhotos(true);
    fetchVerifiedHorseBreedPhotos(HORSE_BREEDS_CATALOG)
      .then((res) => {
        if (active) setPhotoMap(res);
      })
      .catch(() => {
        // Doğrulanamayan görseller gösterilmez
      })
      .finally(() => {
        if (active) setIsCheckingPhotos(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const categories: Array<{ id: 'all' | HorseBreedCategory; label: string; count: number }> = useMemo(() => {
    const counts = {
      riding_racing: HORSE_BREEDS_CATALOG.filter((b) => b.category === 'riding_racing').length,
      draft_carriage: HORSE_BREEDS_CATALOG.filter((b) => b.category === 'draft_carriage').length,
      pony_feral_nordic: HORSE_BREEDS_CATALOG.filter((b) => b.category === 'pony_feral_nordic').length,
    };
    return [
      { id: 'all', label: 'Tüm At Irkları', count: HORSE_BREEDS_CATALOG.length },
      { id: 'riding_racing', label: 'Binek & Yarış Atları', count: counts.riding_racing },
      { id: 'draft_carriage', label: 'Koşum & Çeki Atları', count: counts.draft_carriage },
      { id: 'pony_feral_nordic', label: 'Pony, Ada & Yabanıllaşmış', count: counts.pony_feral_nordic },
    ];
  }, []);

  const filteredBreeds = useMemo(() => {
    const q = filterText.trim().toLocaleLowerCase('tr-TR');
    return HORSE_BREEDS_CATALOG.filter((breed) => {
      if (selectedCategory !== 'all' && breed.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        breed.turkishName.toLocaleLowerCase('tr-TR').includes(q) ||
        breed.internationalName.toLocaleLowerCase('tr-TR').includes(q) ||
        breed.originCountryOrRegion.toLocaleLowerCase('tr-TR').includes(q) ||
        breed.distinguishingTraits.some((t) => t.toLocaleLowerCase('tr-TR').includes(q))
      );
    });
  }, [selectedCategory, filterText]);

  return (
    <div className="max-w-7xl mx-auto py-2 animate-fadeIn">
      {/* Header Panel */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#D6E4DC] shadow-sm mb-8 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#247A63] font-semibold mb-2">
              <Compass className="w-3.5 h-3.5" />
              <span>Irk Keşif Kataloğu · Bilimsel Tür: Equus caballus</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1E332B] tracking-tight">
              At Irkları
            </h1>
            <p className="text-sm text-[#556B62] mt-2 max-w-3xl leading-relaxed">
              "{searchQuery}" araması için evcil at (<em className="text-[#247A63] font-serif font-medium">Equus caballus</em>) türüne ait doğrulanmış at ırkları listelenmektedir. At ırkları ayrı birer biyolojik tür değildir; ırk düzeyinde uydurma GBIF gözlem sayısı üretilmez.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onInspectBiologicalSpecies}
              className="px-4 py-2.5 bg-[#DDEFE3] hover:bg-[#247A63] text-[#1E332B] hover:text-white rounded-xl text-xs font-semibold border border-[#8CCFB0] transition-colors flex items-center gap-2 cursor-pointer"
            >
              <span>Equus caballus Tür Analizini Aç</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onBackToDefault}
              className="px-4 py-2.5 bg-[#F5F9F4] hover:bg-[#DDEFE3]/60 text-[#556B62] hover:text-[#1E332B] rounded-xl text-xs font-semibold border border-[#D6E4DC] transition-colors flex items-center gap-2 cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>Keşften Çık</span>
            </button>
          </div>
        </div>

        {/* Scientific Distinction Notice */}
        <div className="mt-6 p-4 rounded-2xl bg-[#FDF6EC] border border-[#F3D9B5] flex items-start gap-3 text-xs text-[#6E4716] leading-relaxed">
          <Info className="w-4 h-4 text-[#9A631A] shrink-0 mt-0.5" />
          <div>
            <strong className="text-[#59380D]">Irk ve Biyolojik Tür Ayrımı:</strong>{' '}
            Bu katalogdaki tüm kayıtlar taksonomik olarak tek bir biyolojik türün (<em className="text-[#1E332B] font-serif font-semibold">Equus caballus</em> Linnaeus, 1758) yapay seçilim veya yerel adaptasyonla şekillenmiş ırklarıdır. Aynı ırkın farklı isimlerle tekrarlanmasını önlemek amacıyla Türkçede "İngiliz Atı" olarak anılan ırk <strong>İngiliz Atı (Thoroughbred)</strong> başlığında birleştirilmiştir.
          </div>
        </div>

        {/* Category Filter Tabs & Quick Filter */}
        <div className="mt-6 pt-6 border-t border-[#E6EFEA] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <Layers className="w-4 h-4 text-[#247A63] shrink-0 mr-1" />
            {categories.map((cat) => {
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    isActive
                      ? 'bg-[#247A63] text-white shadow-xs font-bold'
                      : 'bg-[#F5F9F4] text-[#556B62] hover:text-[#1E332B] hover:bg-[#DDEFE3]/60 border border-[#D6E4DC]'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                      isActive ? 'bg-white/20 text-white' : 'bg-white text-[#247A63] border border-[#D6E4DC]'
                    }`}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-[#247A63] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Irk, köken veya özellik filtrele..."
              className="w-full pl-9 pr-3 py-2 bg-[#F5F9F4] border border-[#D6E4DC] rounded-xl text-xs text-[#1E332B] placeholder-[#556B62]/65 focus:outline-none focus:border-[#247A63]"
            />
          </div>
        </div>
      </div>

      {/* Breed Cards Grid */}
      {filteredBreeds.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-3xl border border-[#D6E4DC] p-8 shadow-xs">
          <p className="text-sm text-[#556B62] mb-4">
            Filtre ölçütlerine uyan at ırkı bulunamadı.
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('all');
              setFilterText('');
            }}
            className="px-4 py-2 bg-[#247A63] hover:bg-[#1D6350] text-white font-bold text-xs rounded-xl cursor-pointer"
          >
            Tüm At Irklarını Göster
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredBreeds.map((breed) => {
            const photoInfo = photoMap[breed.slug];
            const photoUrl = photoInfo?.photoUrl;
            const showImage = Boolean(photoUrl && !failedUrls[photoUrl]);

            return (
              <div
                key={breed.slug}
                onClick={() => onSelectBreed(breed)}
                className="group bg-white hover:bg-[#F9FCF8] rounded-2xl p-6 border border-[#D6E4DC] hover:border-[#8CCFB0] shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between cursor-pointer relative overflow-hidden"
              >
                <div>
                  {/* Photo or Verified Checking / Missing Placeholder with breathing room */}
                  {showImage ? (
                    <div className="w-full h-48 rounded-xl overflow-hidden mb-5 bg-[#F5F9F4] border border-[#E6EFEA] relative">
                      <img
                        src={photoUrl}
                        alt={`${breed.turkishName} (${breed.internationalName})`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (photoUrl) {
                            setFailedUrls((prev) => ({ ...prev, [photoUrl]: true }));
                          }
                        }}
                      />
                      <div className="absolute top-2.5 left-2.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#FDF6EC]/95 border border-[#F3D9B5] text-[#6E4716] shadow-xs backdrop-blur-xs">
                          {breed.isFeralPopulation ? 'FERAL POPÜLASYON' : 'EVCİL IRK'}
                        </span>
                      </div>
                      <div className="absolute top-2.5 right-2.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-serif italic bg-white/95 border border-[#D6E4DC] text-[#247A63] font-medium shadow-xs backdrop-blur-xs">
                          {breed.scientificSpecies}
                        </span>
                      </div>
                    </div>
                  ) : isCheckingPhotos ? (
                    <div className="w-full h-48 rounded-xl mb-5 bg-[#F5F9F4] border border-[#D6E4DC] relative flex flex-col items-center justify-center p-4 text-center">
                      <div className="absolute top-2.5 left-2.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#FDF6EC] border border-[#F3D9B5] text-[#6E4716]">
                          {breed.isFeralPopulation ? 'FERAL POPÜLASYON' : 'EVCİL IRK'}
                        </span>
                      </div>
                      <div className="absolute top-2.5 right-2.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-serif italic bg-white border border-[#D6E4DC] text-[#247A63] font-medium">
                          {breed.scientificSpecies}
                        </span>
                      </div>
                      <div className="w-5 h-5 border-2 border-[#DDEFE3] border-t-[#247A63] rounded-full animate-spin mb-2 mt-4" />
                      <span className="text-[11px] font-medium text-[#556B62]">
                        Görsel kontrol ediliyor...
                      </span>
                    </div>
                  ) : (
                    <div className="w-full h-48 rounded-xl mb-5 bg-[#F5F9F4] border border-[#D6E4DC] relative flex flex-col items-center justify-center p-4 text-center">
                      <div className="absolute top-2.5 left-2.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#FDF6EC] border border-[#F3D9B5] text-[#6E4716]">
                          {breed.isFeralPopulation ? 'FERAL POPÜLASYON' : 'EVCİL IRK'}
                        </span>
                      </div>
                      <div className="absolute top-2.5 right-2.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-serif italic bg-white border border-[#D6E4DC] text-[#247A63] font-medium">
                          {breed.scientificSpecies}
                        </span>
                      </div>
                      <ImageOff className="w-6 h-6 text-[#556B62]/50 mb-1.5 mt-4" />
                      <span className="text-[11px] font-medium text-[#556B62]">
                        Görsel kaydı bulunamadı
                      </span>
                    </div>
                  )}

                  {/* Names & Scientific Species */}
                  <div className="mb-3">
                    <h3 className="text-lg font-bold text-[#1E332B] group-hover:text-[#247A63] transition-colors">
                      {breed.turkishName}
                    </h3>
                    <p className="text-xs text-[#556B62] font-medium mt-0.5">
                      Uluslararası Adı: <span className="text-[#1E332B] font-semibold">{breed.internationalName}</span>
                    </p>
                    <p className="text-[11px] text-[#556B62] mt-0.5">
                      Bilimsel Tür: <em className="font-serif text-[#247A63] font-medium">{breed.scientificSpecies}</em> (Irk)
                    </p>
                  </div>

                  {/* Origin */}
                  <div className="flex items-center gap-1.5 text-xs text-[#6E4716] bg-[#FDF6EC] border border-[#F3D9B5] rounded-lg px-2.5 py-1.5 mb-3.5 font-medium">
                    <MapPin className="w-3.5 h-3.5 text-[#9A631A] shrink-0" />
                    <span className="truncate">Köken: {breed.originCountryOrRegion}</span>
                  </div>

                  {/* Distinguishing Traits */}
                  <div className="space-y-1.5 mb-4">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#247A63]">
                      <Sparkles className="w-3 h-3 text-[#247A63] shrink-0" />
                      <span>Ayırt Edici Özellikler</span>
                    </div>
                    <ul className="space-y-1 text-[11px] text-[#556B62] leading-relaxed">
                      {breed.distinguishingTraits.slice(0, 2).map((trait, idx) => (
                        <li key={idx} className="line-clamp-2 flex items-start gap-1.5">
                          <span className="text-[#247A63] mt-0.5 font-bold">•</span>
                          <span>{trait}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Footer */}
                <div className="pt-3.5 border-t border-[#E6EFEA] flex items-center justify-between gap-2 text-xs">
                  <span className="text-[10px] text-[#556B62]">
                    GBIF gözlemi tür bazlıdır (ırk sayacı yok)
                  </span>
                  <span className="text-[#247A63] group-hover:text-[#1D6350] font-bold flex items-center gap-1 shrink-0">
                    <span>Irk Detayı</span>
                    <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
