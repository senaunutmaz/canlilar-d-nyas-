import React from 'react';
import { SpeciesComparison } from '../components/SpeciesComparison';
import { SpeciesAnalysis } from '../types/biodiversity';
import { Scale, Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ComparePageProps {
  primaryAnalysis: SpeciesAnalysis | null;
  secondaryAnalysis: SpeciesAnalysis | null;
  onSelectSecondarySpecies: (scientificName: string) => void;
  isLoadingSecondary: boolean;
  onSearch: (query: string, country: string) => void;
  activeCountry: string;
}

export const ComparePage: React.FC<ComparePageProps> = ({
  primaryAnalysis,
  secondaryAnalysis,
  onSelectSecondarySpecies,
  isLoadingSecondary,
  onSearch,
  activeCountry,
}) => {
  const navigate = useNavigate();

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

      {primaryAnalysis ? (
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
            onClick={() => {
              onSearch('Ursus arctos', activeCountry);
              navigate('/analiz');
            }}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-[#0b1510] font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Bozayı Kaydını Yükle
          </button>
        </div>
      )}
    </div>
  );
};
