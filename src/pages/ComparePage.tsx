import React from 'react';
import { useNavigate } from 'react-router-dom';
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
  onRetry?: () => void;
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
  onRetry,
  activeCountry,
}) => {
  const navigate = useNavigate();
  const isApiError = errorType === 'ERROR';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#D6E4DC] shadow-sm">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#9A631A] font-semibold mb-2">
          <Scale className="w-3.5 h-3.5" />
          <span>İki Canlı Türünü Yan Yana Kıyaslayın</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#1E332B] tracking-tight">
          Tür Karşılaştırma Modülü
        </h1>
        <p className="text-sm text-[#556B62] mt-1.5 max-w-xl leading-relaxed">
          GBIF açık veri arşivinden iki farklı türün gözlem sayılarını, coğrafi dağılımlarını, IUCN statülerini ve 13 yönerge metriğini karşılaştırın.
        </p>
      </div>

      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-white rounded-3xl border border-[#D6E4DC] p-8 shadow-xs">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-[#DDEFE3] border-t-[#247A63] animate-spin" />
            <Compass className="w-8 h-8 text-[#247A63] absolute inset-0 m-auto" />
          </div>
          <h3 className="text-xl font-bold text-[#1E332B] mb-2">
            GBIF Karşılaştırma Verileri Yükleniyor
          </h3>
          <p className="text-xs text-[#556B62] max-w-sm">
            {activeCountry === 'TR' ? 'Türkiye (TR)' : 'Tüm Dünya (Global)'} kapsamı için birincil tür kayıtları hazırlanıyor...
          </p>
        </div>
      ) : errorMessage ? (
        <div
          className={`p-6 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs ${
            isApiError
              ? 'bg-[#FDF6EC] border-[#F3D9B5]'
              : 'bg-rose-50 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <AlertCircle
              className={`w-6 h-6 shrink-0 ${isApiError ? 'text-amber-700' : 'text-rose-600'}`}
            />
            <div>
              <h3
                className={`text-sm font-bold mb-0.5 ${
                  isApiError ? 'text-[#6E4716]' : 'text-rose-900'
                }`}
              >
                {isApiError ? 'Veri Kaynağına Erişilemedi' : 'Sonuç Bulunamadı'}
              </h3>
              <p className={`text-sm ${isApiError ? 'text-[#6E4716]/90' : 'text-rose-800'}`}>
                {errorMessage}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isApiError && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-4 py-2 bg-[#247A63] hover:bg-[#1D6350] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Tekrar Dene
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                isApiError ? 'bg-white hover:bg-[#F5F9F4] text-[#1E332B] border border-[#D6E4DC]' : 'bg-rose-700 hover:bg-rose-800 text-white'
              }`}
            >
              Tür Keşfine Git
            </button>
          </div>
        </div>
      ) : primaryAnalysis ? (
        <SpeciesComparison
          primaryAnalysis={primaryAnalysis}
          secondaryAnalysis={secondaryAnalysis}
          onSelectSecondarySpecies={onSelectSecondarySpecies}
          isLoadingSecondary={isLoadingSecondary}
        />
      ) : (
        <div className="py-24 text-center bg-white rounded-3xl border border-[#D6E4DC] p-8 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-[#FDF6EC] border border-[#F3D9B5] text-[#9A631A] flex items-center justify-center mx-auto mb-4">
            <Scale className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-[#1E332B] mb-2">Karşılaştırma İçin Önce 1. Tür Yüklenmedi</h3>
          <p className="text-xs text-[#556B62] max-w-sm mx-auto mb-6 leading-relaxed">
            Karşılaştırma yapabilmek için lütfen öncelikle birincil canlı türünü aratın.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/kesfet?country=${encodeURIComponent(activeCountry)}`)}
            className="px-5 py-2.5 bg-[#247A63] hover:bg-[#1D6350] text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs"
          >
            Tür Keşfine Git
          </button>
        </div>
      )}
    </div>
  );
};
