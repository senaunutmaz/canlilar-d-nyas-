import React, { useState, useEffect } from 'react';
import { SpeciesAnalysis } from '../types/biodiversity';
import { Info, ExternalLink, ShieldAlert, Award, FileText, ImageOff } from 'lucide-react';

interface SpeciesOverviewProps {
  analysis: SpeciesAnalysis;
}

export const SpeciesOverview: React.FC<SpeciesOverviewProps> = ({ analysis }) => {
  const { 
    species, 
    totalRecords, 
    downloadedRecordsCount, 
    mappedRecordsCount, 
    unmappedRecordsCount,
    missingYearCount,
    dateRange, 
    countryName,
    dataQualityNotice 
  } = analysis;

  const [imgLoadFailed, setImgLoadFailed] = useState(false);

  useEffect(() => {
    setImgLoadFailed(false);
  }, [species.photoUrl]);

  const coordinatePercentage = downloadedRecordsCount > 0 
    ? Math.round((mappedRecordsCount / downloadedRecordsCount) * 100) 
    : 0;
  const isSampledArchive = totalRecords > downloadedRecordsCount;

  const cleanSummary = species.summary
    ? species.summary.replace(/<\/?[^>]+(>|$)/g, '').trim()
    : '';
  const disambigSplitIndex = cleanSummary.indexOf('Not: "');
  const mainSummaryText = disambigSplitIndex >= 0
    ? cleanSummary.slice(0, disambigSplitIndex).trim()
    : cleanSummary;
  const disambiguationNote = disambigSplitIndex >= 0
    ? cleanSummary.slice(disambigSplitIndex).trim()
    : '';

  // IUCN koruma kategorilerinin kendi anlamlı renkleri korunur
  const getIucnBadge = (status?: string) => {
    switch (status?.toUpperCase()) {
      case 'EX':
        return { bg: 'bg-zinc-100/95 border-zinc-400 text-zinc-800', dot: 'bg-zinc-600', name: 'Nesli Tükenmiş (EX)' };
      case 'EW':
        return { bg: 'bg-purple-50/95 border-purple-400 text-purple-900', dot: 'bg-purple-600', name: 'Doğada Tükenmiş (EW)' };
      case 'CR':
        return { bg: 'bg-rose-50/95 border-rose-400 text-rose-900', dot: 'bg-rose-600', name: 'Kritik Düzeyde Tehlikede (CR)' };
      case 'EN':
        return { bg: 'bg-orange-50/95 border-orange-400 text-orange-900', dot: 'bg-orange-600', name: 'Tehlikede (EN)' };
      case 'VU':
        return { bg: 'bg-amber-50/95 border-amber-400 text-amber-900', dot: 'bg-amber-500', name: 'Hassas (VU)' };
      case 'NT':
        return { bg: 'bg-yellow-50/95 border-yellow-400 text-yellow-900', dot: 'bg-yellow-500', name: 'Tehdite Yakın (NT)' };
      case 'LC':
        return { bg: 'bg-[#DDEFE3]/95 border-[#8CCFB0] text-[#1E5E4C]', dot: 'bg-[#247A63]', name: 'Asgari Endişe (LC)' };
      case 'DD':
        return { bg: 'bg-purple-50/95 border-purple-300 text-purple-900', dot: 'bg-purple-500', name: 'Veri Yetersiz (Data Deficient - DD)' };
      case 'NE':
      default:
        return { bg: 'bg-white/95 border-slate-300 text-slate-700', dot: 'bg-slate-500', name: 'Değerlendirilmemiş (Not Evaluated - NE)' };
    }
  };

  const iucnInfo = getIucnBadge(species.iucnStatus);

  return (
    <div className="bg-white border border-[#D6E4DC] rounded-2xl p-6 lg:p-8 shadow-sm">
      {/* Top Taxonomy Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#556B62] font-mono mb-4">
        <span className="text-[#247A63] font-semibold">{species.kingdom || 'Animalia'}</span>
        {species.phylum && (
          <>
            <span>›</span>
            <span>{species.phylum}</span>
          </>
        )}
        {species.class && (
          <>
            <span>›</span>
            <span>{species.class}</span>
          </>
        )}
        {species.order && (
          <>
            <span>›</span>
            <span>{species.order}</span>
          </>
        )}
        {species.family && (
          <>
            <span>›</span>
            <span>{species.family}</span>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Species Photo & IUCN Badge */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <div className="relative aspect-4/3 w-full rounded-xl overflow-hidden bg-[#F5F9F4] border border-[#D6E4DC] group">
            {species.photoUrl && !imgLoadFailed ? (
              <img
                src={species.photoUrl}
                alt={species.turkishName || species.scientificName}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
                onError={() => setImgLoadFailed(true)}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-[#556B62]">
                <ImageOff className="w-10 h-10 mb-2 stroke-1 text-[#556B62]/50" />
                <p className="text-xs">Bu tür için doğrulanmış görsel kaydı bulunamadı</p>
              </div>
            )}
            
            {/* IUCN Tag overlay */}
            <div className={`absolute bottom-3 left-3 px-3 py-1 rounded-lg border backdrop-blur-md text-xs font-semibold flex items-center gap-2 shadow-sm ${iucnInfo.bg}`}>
              <span className={`w-2 h-2 rounded-full ${iucnInfo.dot}`} />
              <span>{iucnInfo.name}</span>
            </div>
          </div>

          {species.photoUrl && !imgLoadFailed && species.photoAttribution && (
            <p className="text-[11px] text-[#556B62] truncate" title={species.photoAttribution}>
              Fotoğraf: {species.photoAttribution}
            </p>
          )}

          {/* Quick links to primary data sources */}
          <div className="flex items-center gap-2 pt-1">
            {species.gbifUrl && (
              <a
                href={species.gbifUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-3 py-2 text-xs font-semibold bg-[#F5F9F4] hover:bg-[#DDEFE3] border border-[#D6E4DC] rounded-lg text-[#1E332B] hover:text-[#247A63] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>GBIF Tür Kaydı</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {species.inaturalistUrl && (
              <a
                href={species.inaturalistUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-3 py-2 text-xs font-semibold bg-[#F5F9F4] hover:bg-[#DDEFE3] border border-[#D6E4DC] rounded-lg text-[#1E332B] hover:text-[#247A63] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>iNaturalist</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Right: Species Details & 4 Precision KPI Metrics */}
        <div className="lg:col-span-8 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-baseline gap-3 mb-2">
              <h2 className="text-3xl font-extrabold text-[#1E332B] tracking-tight">
                {species.turkishName || species.canonicalName}
              </h2>
              <span className="text-lg italic font-serif text-[#247A63]">
                {species.scientificName}
              </span>
            </div>

            {species.englishName && (
              <p className="text-sm text-[#556B62] mb-2">
                İngilizce: <span className="font-semibold text-[#1E332B]">{species.englishName}</span>
              </p>
            )}

            {species.iucnSource && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#556B62] mb-3 bg-[#F5F9F4] px-2.5 py-1 rounded-lg border border-[#D6E4DC] w-fit">
                <Award className="w-3.5 h-3.5 text-[#247A63] shrink-0" />
                <span>Statü Kaynağı: {species.iucnSource}</span>
              </div>
            )}

            {mainSummaryText && (
              <p className="text-sm text-[#1E332B] leading-relaxed mb-3 line-clamp-3 bg-[#F5F9F4] p-3.5 rounded-xl border border-[#E6EFEA]">
                {mainSummaryText}
              </p>
            )}

            {disambiguationNote && (
              <div className="mb-4 p-3 rounded-xl bg-[#FDF6EC] border border-[#F3D9B5] text-xs text-[#6E4716] leading-relaxed flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-[#9A631A] shrink-0 mt-0.5" />
                <span>{disambiguationNote}</span>
              </div>
            )}
          </div>

          {/* 4 Precision Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
            {/* Metric 1: Toplam Arşiv Kaydı */}
            <div className="bg-[#F5F9F4] p-4 rounded-xl border border-[#D6E4DC]">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-1">
                Toplam Arşiv Kaydı
              </span>
              <div className="text-2xl font-bold font-mono text-[#1E332B] tabular-nums">
                {totalRecords.toLocaleString('tr-TR')}
              </div>
              <span className="text-[11px] text-[#556B62] block mt-0.5">
                {countryName} (Örneklem: {downloadedRecordsCount.toLocaleString('tr-TR')})
              </span>
            </div>

            {/* Metric 2: Haritalanan Kayıt */}
            <div className="bg-[#DDEFE3]/55 p-4 rounded-xl border border-[#8CCFB0]/60">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-1">
                Haritalanan GPS
              </span>
              <div className="text-2xl font-bold font-mono text-[#247A63] tabular-nums">
                {mappedRecordsCount.toLocaleString('tr-TR')}
                <span className="text-xs font-normal text-[#556B62] ml-1">
                  (%{coordinatePercentage})
                </span>
              </div>
              <span className="text-[11px] text-[#556B62] block mt-0.5">
                {isSampledArchive
                  ? `İlk ${downloadedRecordsCount.toLocaleString('tr-TR')} örneklemde`
                  : 'İndirilen kayıtlarda'}
              </span>
            </div>

            {/* Metric 3: Gözlem Yıl Aralığı */}
            <div className="bg-[#ECF6FA] p-4 rounded-xl border border-[#B9DDEB]">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#1B6884] font-semibold block mb-1">
                Tarih Aralığı
              </span>
              <div className="text-lg font-bold font-mono text-[#1E332B] tabular-nums pt-1">
                {dateRange.minYear && dateRange.maxYear 
                  ? `${dateRange.minYear} – ${dateRange.maxYear}`
                  : 'Belirtilmemiş'}
              </div>
              <span className="text-[11px] text-[#556B62] block mt-0.5">
                {typeof missingYearCount === 'number' && missingYearCount > 0
                  ? `Tarihsiz: ${missingYearCount.toLocaleString('tr-TR')} kayıt`
                  : 'Arşivlenmiş yıllar'}
              </span>
            </div>

            {/* Metric 4: Koordinatsız Kayıtlar */}
            <div className="bg-[#FDF6EC] p-4 rounded-xl border border-[#F3D9B5]">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#9A631A] font-semibold block mb-1">
                Koordinatsız Kayıt
              </span>
              <div className="text-2xl font-bold font-mono text-[#6E4716] tabular-nums">
                {unmappedRecordsCount.toLocaleString('tr-TR')}
              </div>
              <span className="text-[11px] text-[#6E4716]/80 block mt-0.5">
                {isSampledArchive
                  ? `${downloadedRecordsCount.toLocaleString('tr-TR')} örneklemde korundu`
                  : 'Analizde korundu'}
              </span>
            </div>
          </div>

          {/* Örneklem ve Veri Kalitesi Bildirimi */}
          {dataQualityNotice && (
            <div className="mt-2 p-3.5 bg-[#ECF6FA] border border-[#B9DDEB] rounded-xl flex items-start gap-3 text-xs text-[#1E332B] leading-relaxed">
              <FileText className="w-4 h-4 text-[#1B6884] shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold text-[#1B576E] block mb-0.5">
                  Veri Kapsamı & Örneklem Notu:
                </strong>
                <span>{dataQualityNotice}</span>
              </div>
            </div>
          )}

          {/* Bilimsel Metodoloji & Popülasyon Ayrımı Uyarısı */}
          <div className="mt-3 p-3.5 bg-[#FDF6EC] border border-[#F3D9B5] rounded-xl flex items-start gap-3 text-xs text-[#6E4716] leading-relaxed">
            <Info className="w-5 h-5 text-[#9A631A] shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold text-[#59380D] block mb-0.5">
                Bilimsel Metodoloji Uyarısı:
              </strong>
              Gözlem kayıtlarının yıllara göre artması veya azalması doğrudan canlı popülasyonunun arttığı veya azaldığı anlamına gelmez. Dijital veri tabanlarının yaygınlaşması, mobil gözlem uygulamaları (vatandaş bilimi) ve araştırma seferlerinin sıklığı kayıt sayılarını belirgin biçimde etkiler.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
