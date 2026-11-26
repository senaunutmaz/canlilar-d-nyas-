import React, { useEffect, useState } from 'react';
import { SpeciesAnalysis, SpeciesInfo } from '../types/biodiversity';
import { matchSpecies } from '../services/gbif';
import { Scale, AlertCircle, Loader2, Info } from 'lucide-react';

interface SpeciesComparisonProps {
  primaryAnalysis: SpeciesAnalysis;
  secondaryAnalysis: SpeciesAnalysis | null;
  onSelectSecondarySpecies: (scientificName: string) => void;
  isLoadingSecondary: boolean;
}

interface QuickPreset {
  id: string;
  label: string;
  scientificName: string;
}

const QUICK_SECONDARY_PRESETS: QuickPreset[] = [
  { id: 'canis-lupus', label: 'Bozkurt (Canis lupus)', scientificName: 'Canis lupus' },
  { id: 'lynx-lynx', label: 'Bayağı Vaşak (Lynx lynx)', scientificName: 'Lynx lynx' },
  { id: 'vulpes-vulpes', label: 'Kızıl Tilki (Vulpes vulpes)', scientificName: 'Vulpes vulpes' },
  { id: 'panthera-tigris', label: 'Kaplan (Panthera tigris)', scientificName: 'Panthera tigris' },
  { id: 'geronticus-eremita', label: 'Kelaynak (Geronticus eremita)', scientificName: 'Geronticus eremita' },
  { id: 'chelonia-mydas', label: 'Yeşil Deniz Kaplumbağası (Chelonia mydas)', scientificName: 'Chelonia mydas' },
];

function isSameTaxon(a: SpeciesAnalysis['species'], b: SpeciesAnalysis['species']): boolean {
  const keyA = (a as any).acceptedUsageKey || a.usageKey;
  const keyB = (b as any).acceptedUsageKey || b.usageKey;
  if (keyA && keyB) {
    return keyA === keyB;
  }
  const canonA = (a.canonicalName || a.scientificName || '').trim().toLowerCase();
  const canonB = (b.canonicalName || b.scientificName || '').trim().toLowerCase();
  return Boolean(canonA && canonB && canonA === canonB);
}

export type SecondaryValidationStatus = 'VALID' | 'ERROR' | 'NOT_FOUND' | 'DUPLICATE';

export interface SecondaryValidationOutcome {
  status: SecondaryValidationStatus;
  message?: string;
}

export function classifySecondaryMatchValidation(
  matched: SpeciesInfo | null | undefined,
  primarySpecies: SpeciesInfo,
  trimmedQuery: string
): SecondaryValidationOutcome {
  if (matched?.matchType === 'ERROR') {
    return {
      status: 'ERROR',
      message:
        matched.summary ||
        'GBIF taksonomi veya veri kaynağına şu anda erişilemiyor. Lütfen bağlantınızı kontrol edip tekrar deneyin.',
    };
  }

  if (!matched || matched.isMatched === false || !matched.usageKey) {
    return {
      status: 'NOT_FOUND',
      message: `"${trimmedQuery}" için GBIF Backbone taksonomisinde eşleşen ikinci bir canlı türü bulunamadı. Lütfen Türkçe, İngilizce veya bilimsel adını kontrol edip tekrar deneyin.`,
    };
  }

  if (isSameTaxon(primarySpecies, matched)) {
    return {
      status: 'DUPLICATE',
      message: `Aynı türü kendisiyle karşılaştıramazsınız (${matched.turkishName || matched.canonicalName}). Lütfen 1. türden farklı bir ikinci tür seçin.`,
    };
  }

  return { status: 'VALID' };
}

export const SpeciesComparison: React.FC<SpeciesComparisonProps> = ({
  primaryAnalysis,
  secondaryAnalysis,
  onSelectSecondarySpecies,
  isLoadingSecondary,
}) => {
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Record<string, boolean>>({});
  const markPhotoFailed = (url?: string) => {
    if (!url) return;
    setFailedPhotoUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };
  const [customSecondaryQuery, setCustomSecondaryQuery] = useState('');
  const [isValidatingSecondary, setIsValidatingSecondary] = useState(false);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [secondaryErrorType, setSecondaryErrorType] = useState<'ERROR' | 'NOT_FOUND' | 'DUPLICATE' | null>(null);
  const [expectedSecondary, setExpectedSecondary] = useState<{
    query: string;
    usageKey?: number;
    canonicalName: string;
  } | null>(null);
  const [lastSecondaryAttempt, setLastSecondaryAttempt] = useState<string>('');

  const p = primaryAnalysis;
  const s = secondaryAnalysis;

  const isBusy = isLoadingSecondary || isValidatingSecondary;

  // Birinci tür değiştiğinde önceki doğrulama hata mesajını sıfırla (ikinci türü bozmadan)
  useEffect(() => {
    setSecondaryError(null);
    setSecondaryErrorType(null);
  }, [p.species.usageKey, p.species.scientificName]);

  // App üzerinden gelen secondaryAnalysis sonuçlarını doğrula (API hatası / eşleşmeme / aynı tür)
  const hasSecondaryApiError = Boolean(s && s.species.matchType === 'ERROR');
  const hasSecondaryMismatchError = Boolean(s && s.species.isMatched === false && !hasSecondaryApiError);
  const isDuplicateSpecies = Boolean(s && s.species.isMatched !== false && isSameTaxon(p.species, s.species));

  // Beklenen türle gelen secondaryAnalysis tutarlı mı?
  const isExpectedMatch =
    !expectedSecondary ||
    !s ||
    (expectedSecondary.usageKey && s.species.usageKey
      ? expectedSecondary.usageKey === s.species.usageKey
      : (s.species.canonicalName || '').toLowerCase() === expectedSecondary.canonicalName.toLowerCase());

  const validSecondary =
    s && s.species.isMatched !== false && !isDuplicateSpecies ? s : null;

  const handleSelectAndValidateSecondary = async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setSecondaryErrorType('NOT_FOUND');
      setSecondaryError('Lütfen karşılaştırılacak ikinci canlı türünün adını girin.');
      return;
    }

    setLastSecondaryAttempt(trimmed);
    setSecondaryError(null);
    setSecondaryErrorType(null);
    setIsValidatingSecondary(true);

    try {
      const matched = await matchSpecies(trimmed);
      const outcome = classifySecondaryMatchValidation(matched, p.species, trimmed);

      if (outcome.status === 'ERROR') {
        setSecondaryErrorType('ERROR');
        setSecondaryError(outcome.message || 'Veri kaynağına şu anda erişilemiyor.');
        return;
      }

      if (outcome.status === 'DUPLICATE') {
        setSecondaryErrorType('DUPLICATE');
        setSecondaryError(outcome.message || null);
        return;
      }

      if (outcome.status === 'NOT_FOUND') {
        setSecondaryErrorType('NOT_FOUND');
        setSecondaryError(outcome.message || null);
        return;
      }

      setExpectedSecondary({
        query: trimmed,
        usageKey: matched.usageKey,
        canonicalName: matched.canonicalName,
      });

      await Promise.resolve(onSelectSecondarySpecies(matched.canonicalName || matched.scientificName));
    } catch (err: any) {
      console.error('Secondary species validation/fetch error:', err);
      setSecondaryErrorType('ERROR');
      setSecondaryError(
        err?.message || 'İkinci tür verileri alınırken veri kaynağına erişilemedi. Lütfen tekrar deneyin.'
      );
    } finally {
      setIsValidatingSecondary(false);
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customSecondaryQuery.trim()) {
      handleSelectAndValidateSecondary(customSecondaryQuery.trim());
    }
  };

  const availablePresets = QUICK_SECONDARY_PRESETS.filter(
    (preset) => preset.scientificName.toLowerCase() !== (p.species.canonicalName || '').toLowerCase()
  );

  return (
    <section id="karsilastir" className="my-8 bg-white border border-[#D6E4DC] rounded-3xl p-6 lg:p-8 shadow-sm">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-5 border-b border-[#E6EFEA]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#9A631A] font-semibold mb-1.5">
            <Scale className="w-3.5 h-3.5" />
            <span>Karşılaştırmalı Biyoçeşitlilik Analizi</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E332B] tracking-tight">
            İki Canlı Türünü Karşılaştırın
          </h2>
          <p className="text-xs text-[#556B62] mt-1 max-w-xl leading-relaxed">
            Aynı coğrafya ve zaman dilimi çerçevesinde iki türün gözlem yoğunluğunu, yıllık eğilimlerini ve bölgesel yayılışını kıyaslayın.
          </p>
        </div>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-2">
          {availablePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={isBusy}
              onClick={() => {
                setCustomSecondaryQuery(preset.scientificName);
                handleSelectAndValidateSecondary(preset.scientificName);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#F5F9F4] hover:bg-[#DDEFE3] disabled:opacity-50 text-[#1E332B] hover:text-[#247A63] border border-[#D6E4DC] transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Target Selection Form for Second Species */}
      <div className="mb-6 p-4 rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC]">
        <form onSubmit={handleCustomSubmit} className="flex flex-col sm:flex-row items-center gap-3">
          <span className="text-xs font-semibold text-[#1E332B] whitespace-nowrap">
            Karşılaştırılacak İkinci Türü Seçin:
          </span>
          <input
            type="text"
            value={customSecondaryQuery}
            onChange={(e) => setCustomSecondaryQuery(e.target.value)}
            placeholder="İkinci canlı adı (örn: Kaplan, Canis lupus, Lynx lynx, Kelaynak...)"
            className="flex-1 w-full px-4 py-2.5 bg-white text-[#1E332B] placeholder-[#556B62]/65 rounded-xl border border-[#D6E4DC] text-sm focus:outline-none focus:border-[#247A63]"
          />
          <button
            type="submit"
            disabled={isBusy || !customSecondaryQuery.trim()}
            className="px-5 py-2.5 bg-[#247A63] hover:bg-[#1D6350] disabled:bg-[#DDEFE3] disabled:text-[#556B62] text-white font-bold text-xs rounded-xl transition-all cursor-pointer disabled:cursor-not-allowed whitespace-nowrap flex items-center gap-2 shadow-2xs"
          >
            {isBusy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Karşılaştırılıyor...</span>
              </>
            ) : (
              <span>Kıyasla</span>
            )}
          </button>
        </form>
      </div>

      {/* Validation / Fetch Error Notification */}
      {!isBusy && (secondaryError || hasSecondaryApiError || hasSecondaryMismatchError) && (() => {
        const isApiErr = secondaryErrorType === 'ERROR' || hasSecondaryApiError;
        const isDupErr = !isApiErr && secondaryErrorType === 'DUPLICATE';
        const isWarningTone = isApiErr || isDupErr;
        const headingText = isApiErr
          ? 'Veri Kaynağına Erişilemedi'
          : isDupErr
            ? 'Aynı Tür Karşılaştırılamaz'
            : 'İkinci Tür Bulunamadı';

        const retryTarget =
          lastSecondaryAttempt ||
          customSecondaryQuery.trim() ||
          s?.species.canonicalName ||
          s?.species.scientificName ||
          '';

        return (
          <div
            className={`mb-6 p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
              isWarningTone
                ? 'bg-[#FDF6EC] border-[#F3D9B5] text-[#6E4716]'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle
                className={`w-5 h-5 shrink-0 mt-0.5 ${
                  isWarningTone ? 'text-amber-700' : 'text-rose-600'
                }`}
              />
              <div>
                <strong
                  className={`font-bold block mb-0.5 ${
                    isWarningTone ? 'text-[#59380D]' : 'text-rose-900'
                  }`}
                >
                  {headingText}
                </strong>
                <span>
                  {secondaryError ||
                    (hasSecondaryApiError
                      ? s?.species.summary || 'GBIF taksonomi veya veri kaynağına şu anda erişilemiyor. Lütfen tekrar deneyin.'
                      : `"${s?.species.scientificName || ''}" için GBIF Backbone veritabanında geçerli bir ikinci tür eşleşmesi bulunamadı.`)}
                </span>
              </div>
            </div>
            {isApiErr && retryTarget && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleSelectAndValidateSecondary(retryTarget)}
                className="px-3.5 py-1.5 rounded-xl bg-[#247A63] hover:bg-[#1D6350] text-white font-semibold shrink-0 cursor-pointer disabled:opacity-50"
              >
                Tekrar Dene
              </button>
            )}
          </div>
        );
      })()}

      {/* Same Species Conflict Warning */}
      {isDuplicateSpecies && !secondaryError && (
        <div className="mb-6 p-4 rounded-2xl bg-[#FDF6EC] border border-[#F3D9B5] flex items-start gap-3 text-xs text-[#6E4716]">
          <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong className="font-bold text-[#59380D] block mb-0.5">Aynı Tür Karşılaştırılamaz</strong>
            <span>
              1. tür ile 2. tür aynı canlıyı ({p.species.turkishName || p.species.canonicalName}) göstermektedir. Karşılaştırma tablosu için yukarıdan farklı bir ikinci tür seçin.
            </span>
          </div>
        </div>
      )}

      {/* Country Scope Consistency Warning */}
      {validSecondary && validSecondary.countryCode !== p.countryCode && (
        <div className="mb-6 p-3.5 rounded-xl bg-[#FDF6EC] border border-[#F3D9B5] flex items-center justify-between gap-3 text-xs text-[#6E4716]">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Kapsam farkı: 1. tür <strong>{p.countryName}</strong>, 2. tür <strong>{validSecondary.countryName}</strong> verisiyle yüklü.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleSelectAndValidateSecondary(validSecondary.species.canonicalName || validSecondary.species.scientificName)}
            className="px-3 py-1.5 rounded-lg bg-[#247A63] hover:bg-[#1D6350] text-white font-bold shrink-0 cursor-pointer"
          >
            {p.countryName} Kapsamına Eşitle
          </button>
        </div>
      )}

      {/* Head-to-Head Showcase Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Specimen A (Primary) */}
        <div className="p-6 rounded-2xl bg-[#F5F9F4] border-2 border-[#247A63]/70 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#247A63]">
              1. TÜR (TEMEL İNCELEME · {p.countryName})
            </span>
          </div>

          <div className="flex items-start gap-4">
            {p.species.photoUrl && !failedPhotoUrls[p.species.photoUrl] ? (
              <img
                src={p.species.photoUrl}
                alt={p.species.turkishName || p.species.canonicalName}
                className="w-20 h-20 rounded-xl object-cover border border-[#D6E4DC] shrink-0"
                referrerPolicy="no-referrer"
                onError={() => markPhotoFailed(p.species.photoUrl)}
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-white border border-[#D6E4DC] flex items-center justify-center text-xs text-[#556B62] shrink-0 text-center px-1">
                Görsel Yok
              </div>
            )}
            <div>
              <h3 className="text-xl font-bold text-[#1E332B]">
                {p.species.turkishName || p.species.canonicalName}
              </h3>
              <p className="text-xs italic font-serif text-[#247A63] font-medium">
                {p.species.scientificName}
              </p>
              <div className="mt-2 text-xs font-mono text-[#556B62]">
                IUCN: <strong className="text-[#1E332B]">{p.species.iucnStatus || 'NE'}</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-[#D6E4DC] text-xs font-mono">
            <div>
              <span className="text-[10px] text-[#556B62] uppercase block">Toplam Kayıt</span>
              <span className="text-lg font-bold text-[#1E332B] tabular-nums">{p.totalRecords.toLocaleString('tr-TR')} adet</span>
            </div>
            <div>
              <span className="text-[10px] text-[#556B62] uppercase block">Haritalanan GPS</span>
              <span className="text-lg font-bold text-[#247A63] tabular-nums">{p.mappedRecordsCount.toLocaleString('tr-TR')} nokta</span>
            </div>
            <div>
              <span className="text-[10px] text-[#556B62] uppercase block">Zirve Yıl</span>
              <span className="text-sm font-bold text-[#1E332B]">{p.peakYear?.year || '—'} ({p.peakYear?.count || 0})</span>
            </div>
            <div>
              <span className="text-[10px] text-[#556B62] uppercase block">Lider İl</span>
              <span className="text-sm font-bold text-[#1E332B] truncate block">{p.regionalStats[0]?.region || '—'}</span>
            </div>
          </div>
        </div>

        {/* Specimen B (Secondary) */}
        <div className="p-6 rounded-2xl bg-[#FDF6EC]/70 border-2 border-[#F3D9B5] relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#9A631A]">
              2. TÜR (KARŞILAŞTIRMA{validSecondary ? ` · ${validSecondary.countryName}` : ''})
            </span>
          </div>

          {isBusy ? (
            <div className="py-12 text-center text-[#6E4716] flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-[#9A631A]" />
              <p className="text-xs">İkinci tür GBIF verileri getiriliyor ve doğrulanıyor...</p>
            </div>
          ) : validSecondary ? (
            <>
              <div className="flex items-start gap-4">
                {validSecondary.species.photoUrl && !failedPhotoUrls[validSecondary.species.photoUrl] ? (
                  <img
                    src={validSecondary.species.photoUrl}
                    alt={validSecondary.species.turkishName || validSecondary.species.canonicalName}
                    className="w-20 h-20 rounded-xl object-cover border border-[#F3D9B5] shrink-0"
                    referrerPolicy="no-referrer"
                    onError={() => markPhotoFailed(validSecondary.species.photoUrl)}
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-white border border-[#F3D9B5] flex items-center justify-center text-xs text-[#6E4716] shrink-0 text-center px-1">
                    Görsel Yok
                  </div>
                )}
                <div>
                  <h3 className="text-xl font-bold text-[#1E332B]">
                    {validSecondary.species.turkishName || validSecondary.species.canonicalName}
                  </h3>
                  <p className="text-xs italic font-serif text-[#9A631A] font-medium">
                    {validSecondary.species.scientificName}
                  </p>
                  <div className="mt-2 text-xs font-mono text-[#6E4716]">
                    IUCN: <strong className="text-[#1E332B]">{validSecondary.species.iucnStatus || 'NE'}</strong>
                  </div>
                </div>
              </div>

              {!isExpectedMatch && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-white border border-[#F3D9B5] text-[11px] text-[#6E4716]">
                  Not: Gösterilen tür mevcut yüklü ikinci türdür; son aramanız bekleniyor.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-[#F3D9B5] text-xs font-mono">
                <div>
                  <span className="text-[10px] text-[#6E4716] uppercase block">Toplam Kayıt</span>
                  <span className="text-lg font-bold text-[#1E332B] tabular-nums">{validSecondary.totalRecords.toLocaleString('tr-TR')} adet</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#6E4716] uppercase block">Haritalanan GPS</span>
                  <span className="text-lg font-bold text-[#9A631A] tabular-nums">{validSecondary.mappedRecordsCount.toLocaleString('tr-TR')} nokta</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#6E4716] uppercase block">Zirve Yıl</span>
                  <span className="text-sm font-bold text-[#1E332B]">{validSecondary.peakYear?.year || '—'} ({validSecondary.peakYear?.count || 0})</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#6E4716] uppercase block">Lider İl</span>
                  <span className="text-sm font-bold text-[#1E332B] truncate block">{validSecondary.regionalStats[0]?.region || '—'}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-[#6E4716]">
              <Scale className="w-10 h-10 mx-auto mb-2 opacity-50 text-[#9A631A]" />
              <p className="text-xs">
                {isDuplicateSpecies
                  ? 'Karşılaştırma için 1. türden farklı bir ikinci canlı seçin.'
                  : 'Yukarıdaki önerilerden veya kutudan ikinci bir canlı seçin.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Side-by-Side Yearly Comparison if both species loaded and valid */}
      {validSecondary && (
        <div className="p-6 bg-[#F5F9F4] rounded-2xl border border-[#D6E4DC]">
          <h4 className="text-sm font-bold text-[#1E332B] mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>Yıllara Göre Gözlem Hacmi Karşılaştırması</span>
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5 text-[#247A63]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#247A63] inline-block" />
                {p.species.turkishName || p.species.canonicalName}
              </span>
              <span className="flex items-center gap-1.5 text-[#9A631A]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#D97706] inline-block" />
                {validSecondary.species.turkishName || validSecondary.species.canonicalName}
              </span>
            </div>
          </h4>

          {/* Combined 9-Metric Scientific Comparison Table */}
          <div className="overflow-x-auto bg-white rounded-xl border border-[#D6E4DC] p-2 sm:p-4">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[#D6E4DC] text-[#556B62] text-left">
                  <th className="py-2.5 pr-4 uppercase text-[11px] font-bold">13. Yönerge Metrikleri</th>
                  <th className="py-2.5 px-4 text-[#247A63] font-bold text-sm">{p.species.turkishName || p.species.canonicalName}</th>
                  <th className="py-2.5 px-4 text-[#9A631A] font-bold text-sm">{validSecondary.species.turkishName || validSecondary.species.canonicalName}</th>
                  <th className="py-2.5 pl-4 text-right uppercase text-[11px]">Kıyaslama / Analiz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EFEA]">
                {/* 1. Türkçe İsim */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">1. Türkçe İsim</td>
                  <td className="py-2.5 px-4 font-bold text-[#1E332B]">{p.species.turkishName || p.species.canonicalName}</td>
                  <td className="py-2.5 px-4 font-bold text-[#1E332B]">{validSecondary.species.turkishName || validSecondary.species.canonicalName}</td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62]">Yerel adlandırma</td>
                </tr>

                {/* 2. Bilimsel İsim */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">2. Bilimsel İsim (Taksonomi)</td>
                  <td className="py-2.5 px-4 italic font-serif text-[#247A63] font-medium">{p.species.scientificName}</td>
                  <td className="py-2.5 px-4 italic font-serif text-[#9A631A] font-medium">{validSecondary.species.scientificName}</td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62]">Binominal nomenklatür</td>
                </tr>

                {/* 3. Familya ve Sınıf */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">3. Familya ve Sınıf</td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="block font-semibold">{p.species.family || 'Bilinmiyor'}</span>
                    <span className="text-[10px] text-[#556B62] block">{p.species.class || p.species.classHierarchy || '—'} / {p.species.order || '—'}</span>
                  </td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="block font-semibold">{validSecondary.species.family || 'Bilinmiyor'}</span>
                    <span className="text-[10px] text-[#556B62] block">{validSecondary.species.class || validSecondary.species.classHierarchy || '—'} / {validSecondary.species.order || '—'}</span>
                  </td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62]">
                    {p.species.family && validSecondary.species.family && p.species.family === validSecondary.species.family ? 'Aynı Familya' : 'Farklı Familya'}
                  </td>
                </tr>

                {/* 4. Toplam GBIF Gözlem Sayısı */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">4. Toplam GBIF Kaydı (Arşiv)</td>
                  <td className="py-2.5 px-4 font-bold text-[#1E332B] tabular-nums">{p.totalRecords.toLocaleString('tr-TR')} adet</td>
                  <td className="py-2.5 px-4 font-bold text-[#1E332B] tabular-nums">{validSecondary.totalRecords.toLocaleString('tr-TR')} adet</td>
                  <td className="py-2.5 pl-4 text-right text-[#247A63] font-bold">
                    {p.totalRecords > 0 && validSecondary.totalRecords > 0 
                      ? `${(Math.max(p.totalRecords, validSecondary.totalRecords) / Math.min(p.totalRecords, validSecondary.totalRecords)).toFixed(1)} kat fark`
                      : '—'}
                  </td>
                </tr>

                {/* 5. GPS Koordinatlı Gözlem Sayısı */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">5. GPS Koordinatlı Kayıt (Harita)</td>
                  <td className="py-2.5 px-4 font-bold text-[#247A63] tabular-nums">
                    {p.mappedRecordsCount.toLocaleString('tr-TR')} nokta
                    <span className="block text-[10px] font-normal text-[#556B62]">
                      (%{p.downloadedRecordsCount > 0 ? Math.round((p.mappedRecordsCount / p.downloadedRecordsCount) * 100) : 0} başarı)
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-bold text-[#9A631A] tabular-nums">
                    {validSecondary.mappedRecordsCount.toLocaleString('tr-TR')} nokta
                    <span className="block text-[10px] font-normal text-[#556B62]">
                      (%{validSecondary.downloadedRecordsCount > 0 ? Math.round((validSecondary.mappedRecordsCount / validSecondary.downloadedRecordsCount) * 100) : 0} başarı)
                    </span>
                  </td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62]">
                    Haritada coğrafi koordinatlı
                  </td>
                </tr>

                {/* 6. En Fazla Gözlem Yapılan Bölgeler */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">6. En Çok Gözlenen Bölgeler / İller</td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="font-bold text-[#247A63]">{p.regionalStats[0]?.region || '—'}</span>
                    <span className="text-[10px] text-[#556B62] block">
                      {p.regionalStats.slice(0, 3).map(r => `${r.region} (${r.count})`).join(', ') || 'Veri yok'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="font-bold text-[#9A631A]">{validSecondary.regionalStats[0]?.region || '—'}</span>
                    <span className="text-[10px] text-[#556B62] block">
                      {validSecondary.regionalStats.slice(0, 3).map(r => `${r.region} (${r.count})`).join(', ') || 'Veri yok'}
                    </span>
                  </td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62]">
                    {p.regionalStats.length} İl vs {validSecondary.regionalStats.length} İl yayılış
                  </td>
                </tr>

                {/* 7. Yıllara Göre Değişim / Zirve Yıl */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">7. Yıllara Göre Değişim / Zirve Yıl</td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="font-bold text-[#247A63]">Zirve: {p.peakYear?.year || '—'}</span>
                    <span className="text-[10px] text-[#556B62] block">
                      ({p.peakYear?.count || 0} kayıt) — İlk: {p.lowestYear?.year || '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="font-bold text-[#9A631A]">Zirve: {validSecondary.peakYear?.year || '—'}</span>
                    <span className="text-[10px] text-[#556B62] block">
                      ({validSecondary.peakYear?.count || 0} kayıt) — İlk: {validSecondary.lowestYear?.year || '—'}
                    </span>
                  </td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62]">
                    Kronolojik gözlem yoğunluğu
                  </td>
                </tr>

                {/* 8. Koruma Kategorisi (IUCN) */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">8. Koruma Durumu (IUCN Red List)</td>
                  <td className="py-2.5 px-4">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#DDEFE3] text-[#1E5E4C] border border-[#8CCFB0]">
                      {p.species.iucnStatus || 'NE'}
                    </span>
                    <span className="block text-[10px] text-[#556B62] mt-0.5">
                      {p.species.iucnCategoryName || 'Değerlendirilmemiş'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#FDF6EC] text-[#7A4E16] border border-[#F3D9B5]">
                      {validSecondary.species.iucnStatus || 'NE'}
                    </span>
                    <span className="block text-[10px] text-[#556B62] mt-0.5">
                      {validSecondary.species.iucnCategoryName || 'Değerlendirilmemiş'}
                    </span>
                  </td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62] text-[10px]">
                    Resmi IUCN Kırmızı Liste verisi
                  </td>
                </tr>

                {/* 9. Veri Kaynakları ve Güvenilirlik */}
                <tr>
                  <td className="py-2.5 pr-4 text-[#1E332B] font-sans font-semibold">9. Veri Kaynakları & Güvenilirlik</td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="block text-[#247A63] font-bold">GBIF + iNaturalist</span>
                    <span className="text-[10px] text-[#556B62] block">
                      Eşleşme: {p.species.matchType || 'EXACT'} (%{p.species.confidence || 95} güven)
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-[#1E332B]">
                    <span className="block text-[#9A631A] font-bold">GBIF + iNaturalist</span>
                    <span className="text-[10px] text-[#556B62] block">
                      Eşleşme: {validSecondary.species.matchType || 'EXACT'} (%{validSecondary.species.confidence || 95} güven)
                    </span>
                  </td>
                  <td className="py-2.5 pl-4 text-right text-[#556B62] text-[10px]">
                    Açık gözlem veri tabanları
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
