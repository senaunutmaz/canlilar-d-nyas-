import React from 'react';
import { SpeciesComparison } from '../components/SpeciesComparison';
import { SpeciesAnalysis, SearchErrorType } from '../types/biodiversity';
import { Scale, Compass, AlertCircle } from 'lucide-react';

interface ComparePageProps {
  primaryAnalysis: SpeciesAnalysis | null;
  secondaryAnalysis: SpeciesAnalysis | null;
  onSelectSecondarySpecies: (scientificName: string) => void;
  isLoadingSecondary: boolean;
  isLoading?: boolean;
  errorMessage?: string | null;
  errorType?: SearchErrorType | null;
  onSearch: (query: string, country: string) => void;
  activeCountry: string;
}

export const ComparePage: React.FC<ComparePageProps> = ({
  primaryAnalysis,
  secondaryAnalysis,
  onSelectSecondarySpecies,
  isLoadingSecondary,
  isLoading = false,
  errorMessage,
  errorType,
  onSearch,
  activeCountry,
}) => {
  const isApiError = errorType === 'ERROR';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      <div className="bg-[#111e17] rounded-3xl p-6 sm:p-8 border border-emerald-800/50 shadow-2xl">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-amber-400 mb-2 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-800/40">
          <Scale className="w-3.5 h-3.5" />
          <span>İki Canlı Türünü Yan Yana Kıyaslayın</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          Tür Karşılaştırma Modülü
        </h1>
        <p className="text-sm text-emerald-100/75 mt-1 max-w-xl">
          GBIF açık veri arşivinden iki farklı türün gözlem sayılarını, coğrafi dağılımlarını, IUCN statülerini ve 13 yönerge metriğini karşılaştırın.
        </p>
      </div>

      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-[#111e17] rounded-3xl border border-emerald-900/60 p-8">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-900/60 border-t-emerald-400 animate-spin" />
            <Compass className="w-8 h-8 text-emerald-400 absolute inset-0 m-auto" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">
            GBIF Karşılaştırma Verileri Yükleniyor
          </h3>
          <p className="text-xs text-emerald-300/70 max-w-sm">
            {activeCountry === 'TR' ? 'Türkiye (TR)' : 'Tüm Dünya (Global)'} kapsamı için birincil tür kayıtları hazırlanıyor...
          </p>
        </div>
      ) : errorMessage ? (
        <div
          className={`p-6 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 ${
            isApiError
              ? 'bg-amber-950/40 border-amber-700/50'
              : 'bg-rose-950/40 border-rose-700/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <AlertCircle
              className={`w-6 h-6 shrink-0 ${isApiError ? 'text-amber-400' : 'text-rose-400'}`}
            />
            <div>
              <h3
                className={`text-sm font-bold mb-0.5 ${
                  isApiError ? 'text-amber-200' : 'text-rose-200'
                }`}
              >
                {isApiError ? 'Veri Kaynağına Erişilemedi' : 'Sonuç Bulunamadı'}
              </h3>
              <p className={`text-sm ${isApiError ? 'text-amber-200/90' : 'text-rose-200/90'}`}>
                {errorMessage}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSearch('Ursus arctos', activeCountry)}
            className={`px-4 py-2 text-white rounded-xl text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
              isApiError ? 'bg-amber-800/70 hover:bg-amber-700/80' : 'bg-rose-900/60 hover:bg-rose-800/60'
            }`}
          >
            Bozayı Kaydını Yükle
          </button>
        </div>
      ) : primaryAnalysis ? (
        <SpeciesComparison
          primaryAnalysis={primaryAnalysis}
          secondaryAnalysis={secondaryAnalysis}
          onSelectSecondarySpecies={onSelectSecondarySpecies}
          isLoadingSecondary={isLoadingSecondary}
        />
      ) : (
        <div className="py-24 text-center bg-[#111e17] rounded-3xl border border-emerald-900/60 p-8">
          <Scale className="w-12 h-12 text-emerald-400/60 mx-auto mb-3 animate-pulse" />
          <h3 className="text-lg font-bold text-white mb-2">Karşılaştırma İçin Önce 1. Tür Yüklenmedi</h3>
          <p className="text-xs text-emerald-300/70 max-w-sm mx-auto mb-6">
            Karşılaştırma yapabilmek için lütfen öncelikle birincil canlı türünü aratın.
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
