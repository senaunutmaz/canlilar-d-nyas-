import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  HORSE_BREEDS_CATALOG,
  fetchVerifiedHorseBreedPhotos,
  getHorseBreedBySlug,
} from '../data/horseBreeds';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ExternalLink,
  ImageOff,
  Info,
  MapPin,
  Sparkles,
  Tag,
} from 'lucide-react';

interface HorseBreedDetailPageProps {
  activeCountry: string;
}

export const HorseBreedDetailPage: React.FC<HorseBreedDetailPageProps> = ({ activeCountry }) => {
  const { breedSlug } = useParams<{ breedSlug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const countryParam = searchParams.get('country');
  const effectiveCountry = countryParam !== null ? countryParam : activeCountry;

  const breed = getHorseBreedBySlug(breedSlug || '');

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isCheckingPhoto, setIsCheckingPhoto] = useState<boolean>(true);
  const [imgFailed, setImgFailed] = useState<boolean>(false);

  useEffect(() => {
    if (!breed) {
      setPhotoUrl(null);
      setIsCheckingPhoto(false);
      return;
    }
    let active = true;
    setImgFailed(false);
    setIsCheckingPhoto(true);

    fetchVerifiedHorseBreedPhotos([breed])
      .then((res) => {
        if (!active) return;
        setPhotoUrl(res[breed.slug]?.photoUrl || null);
      })
      .catch(() => {
        if (active) setPhotoUrl(null);
      })
      .finally(() => {
        if (active) setIsCheckingPhoto(false);
      });

    return () => {
      active = false;
    };
  }, [breed]);

  if (!breed) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="p-8 rounded-3xl bg-rose-50 border border-rose-200 text-center shadow-xs">
          <AlertCircle className="w-12 h-12 text-rose-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-rose-900 mb-2">At Irkı Bulunamadı</h1>
          <p className="text-sm text-rose-800 mb-6">
            "{breedSlug}" için doğrulanmış bir at ırkı kaydı bulunamadı.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/kesfet?q=At&country=${encodeURIComponent(effectiveCountry)}`)}
            className="px-5 py-2.5 bg-[#247A63] hover:bg-[#1D6350] text-white font-bold text-xs rounded-xl cursor-pointer"
          >
            At Irkları Kataloğuna Dön
          </button>
        </div>
      </div>
    );
  }

  const otherBreeds = HORSE_BREEDS_CATALOG.filter((b) => b.slug !== breed.slug).slice(0, 6);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fadeIn">
      {/* Top Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(`/kesfet?q=At&country=${encodeURIComponent(effectiveCountry)}`)}
          className="px-4 py-2 rounded-xl bg-white hover:bg-[#DDEFE3]/60 text-[#1E332B] hover:text-[#247A63] border border-[#D6E4DC] text-xs font-semibold flex items-center gap-2 transition-colors shadow-2xs cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>At Irkları Kataloğuna Dön</span>
        </button>

        <button
          type="button"
          onClick={() =>
            navigate(
              `/analiz?species=${encodeURIComponent(breed.scientificSpecies)}&country=${encodeURIComponent(
                effectiveCountry
              )}`
            )
          }
          className="px-4 py-2 rounded-xl bg-[#247A63] hover:bg-[#1D6350] text-white text-xs font-semibold flex items-center gap-2 transition-colors shadow-xs cursor-pointer"
        >
          <span>Equus caballus Tür Düzeyi GBIF Analizi</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Breed Detail Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#D6E4DC] shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Verified Photo Column */}
          <div className="lg:col-span-5">
            {photoUrl && !imgFailed ? (
              <div className="rounded-2xl overflow-hidden border border-[#D6E4DC] bg-[#F5F9F4]">
                <img
                  src={photoUrl}
                  alt={`${breed.turkishName} (${breed.internationalName})`}
                  className="w-full h-72 sm:h-80 object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                />
                <div className="px-4 py-2.5 text-[11px] text-[#556B62] bg-white border-t border-[#E6EFEA] flex items-center justify-between gap-2">
                  <span>Doğrulanmış görsel kaynağı: {breed.sourceName}</span>
                  <a
                    href={breed.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#247A63] hover:text-[#1D6350] inline-flex items-center gap-1 font-semibold shrink-0"
                  >
                    <span>Kaynak</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ) : isCheckingPhoto ? (
              <div className="w-full h-72 sm:h-80 rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-7 h-7 border-2 border-[#DDEFE3] border-t-[#247A63] rounded-full animate-spin mb-3" />
                <span className="text-xs text-[#556B62]">Irk görseli doğrulanıyor...</span>
              </div>
            ) : (
              <div className="w-full h-72 sm:h-80 rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC] flex flex-col items-center justify-center p-6 text-center">
                <ImageOff className="w-8 h-8 text-[#556B62]/50 mb-2" />
                <span className="text-xs text-[#556B62]">Görsel kaydı bulunamadı</span>
              </div>
            )}
          </div>

          {/* Info Column */}
          <div className="lg:col-span-7 space-y-5">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#556B62] mb-2">
                <span className="font-bold text-[#9A631A]">
                  {breed.isFeralPopulation ? 'Yabanıllaşmış (Feral) Popülasyon' : 'Evcil At Irkı'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[#247A63] font-semibold">{breed.categoryLabel}</span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1E332B] tracking-tight">
                {breed.turkishName}
              </h1>
              <p className="text-sm text-[#556B62] mt-1.5">
                Uluslararası Adı: <strong className="text-[#1E332B]">{breed.internationalName}</strong>
              </p>
            </div>

            {/* Key Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-2xl bg-[#DDEFE3]/55 border border-[#8CCFB0]/60">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase text-[#247A63] font-bold mb-1">
                  <Tag className="w-3.5 h-3.5" />
                  <span>Biyolojik Tür</span>
                </div>
                <p className="text-sm font-bold text-[#1E332B]">
                  <em className="font-serif text-[#247A63]">{breed.scientificSpecies}</em>
                </p>
                <p className="text-[11px] text-[#556B62] mt-0.5">
                  {breed.scientificClassificationLabel}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-[#FDF6EC] border border-[#F3D9B5]">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase text-[#9A631A] font-bold mb-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Köken Ülke / Bölge</span>
                </div>
                <p className="text-sm font-bold text-[#1E332B]">{breed.originCountryOrRegion}</p>
                <p className="text-[11px] text-[#6E4716] mt-0.5">
                  Ayrı bir biyolojik tür değildir
                </p>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC]">
              <div className="flex items-center gap-2 text-xs font-bold text-[#247A63] mb-2">
                <BookOpen className="w-4 h-4" />
                <span>Irk Tanımı ve Köken Bilgisi</span>
              </div>
              <p className="text-sm text-[#1E332B] leading-relaxed">{breed.summary}</p>
            </div>

            {/* Distinguishing Traits */}
            <div>
              <h2 className="text-sm font-bold text-[#1E332B] flex items-center gap-2 mb-2.5">
                <Sparkles className="w-4 h-4 text-[#247A63]" />
                <span>Ayırt Edici Özellikler</span>
              </h2>
              <ul className="space-y-2">
                {breed.distinguishingTraits.map((trait, idx) => (
                  <li
                    key={idx}
                    className="text-xs sm:text-sm text-[#1E332B] bg-[#F5F9F4] border border-[#E6EFEA] rounded-xl px-3.5 py-2.5 flex items-start gap-2"
                  >
                    <span className="text-[#247A63] font-bold mt-0.5">•</span>
                    <span>{trait}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Distribution & Population Transparency */}
            <div className="p-4 rounded-2xl bg-[#ECF6FA] border border-[#B9DDEB] space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1B576E]">
                <Info className="w-4 h-4 shrink-0" />
                <span>Dağılım ve Popülasyon Verisi Hakkında (Veri Şeffaflığı)</span>
              </div>
              <p className="text-xs text-[#1E332B] leading-relaxed">
                {breed.distributionAndPopulationNote}
              </p>
              <div className="pt-2 border-t border-[#B9DDEB]/70 flex flex-wrap items-center gap-4 text-[11px]">
                <span className="text-[#556B62]">
                  GBIF Irk Gözlem Sayacı: <strong className="text-[#1E332B]">Irk düzeyinde veri yok</strong>
                </span>
                <span className="text-[#556B62]">
                  Küresel Irk Popülasyon Verisi: <strong className="text-[#1E332B]">Standart veri bulunmuyor</strong>
                </span>
                <a
                  href={breed.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#247A63] hover:text-[#1D6350] inline-flex items-center gap-1 font-semibold"
                >
                  <span>Açık Erişim Kaynağını İncele ({breed.sourceName})</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Other Breeds Quick Links */}
      <div className="bg-white rounded-3xl p-6 border border-[#D6E4DC] shadow-xs">
        <h2 className="text-sm font-bold text-[#1E332B] mb-4">Katalogdaki Diğer At Irkları</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {otherBreeds.map((other) => (
            <button
              key={other.slug}
              type="button"
              onClick={() =>
                navigate(`/at-irklari/${other.slug}?country=${encodeURIComponent(effectiveCountry)}`)
              }
              className="p-3 rounded-xl bg-[#F5F9F4] hover:bg-[#DDEFE3]/70 border border-[#D6E4DC] hover:border-[#8CCFB0] text-left transition-colors cursor-pointer"
            >
              <div className="text-xs font-bold text-[#1E332B] truncate">{other.turkishName}</div>
              <div className="text-[10px] text-[#556B62] truncate mt-0.5">
                {other.originCountryOrRegion}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
