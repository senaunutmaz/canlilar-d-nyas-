/**
 * Canlı Atlası: Kaybolan Canlıların İzinde – Biyoçeşitliliğin Dijital Hafızası
 * Açık veri tabanlarından (GBIF & iNaturalist) beslenen biyoçeşitlilik analiz platformu.
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { SpeciesOverview } from './components/SpeciesOverview';
import { YearlyAnalysisChart } from './components/YearlyAnalysisChart';
import { RegionalDistribution } from './components/RegionalDistribution';
import { InteractiveMap } from './components/InteractiveMap';
import { SpeciesDiscovery } from './components/SpeciesDiscovery';
import { SpeciesComparison } from './components/SpeciesComparison';
import { RecordDetailTable } from './components/RecordDetailTable';
import { ConservationGuide } from './components/ConservationGuide';
import { Footer } from './components/Footer';
import { fetchSpeciesAnalysis, resolveSearchIntent } from './services/gbif';
import { SpeciesAnalysis } from './types/biodiversity';
import { TaxonGroupExplorer } from './components/TaxonGroupExplorer';
import { AlertCircle, RefreshCw, Compass } from 'lucide-react';

export default function App() {
  const [primaryAnalysis, setPrimaryAnalysis] = useState<SpeciesAnalysis | null>(null);
  const [secondaryAnalysis, setSecondaryAnalysis] = useState<SpeciesAnalysis | null>(null);
  const [isCompareMode, setIsCompareMode] = useState<boolean>(false);
  const [discoveryQuery, setDiscoveryQuery] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingSecondary, setIsLoadingSecondary] = useState<boolean>(false);
  const [activeCountry, setActiveCountry] = useState<string>('TR');
  const [lastQuery, setLastQuery] = useState<string>('Ursus arctos');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initial load: Ursus arctos (Bozayı) in Turkey (TR)
  useEffect(() => {
    executeSearch('Ursus arctos', 'TR');
  }, []);

  const executeSearch = async (query: string, country: string = activeCountry) => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    setIsLoading(true);
    setErrorMessage(null);
    setActiveCountry(country);
    setLastQuery(cleanQuery);
    setDiscoveryQuery(null);

    try {
      // 1. Önce arama niyetini (Tekil Tür mu, Genel Grup mu?) çöz
      const intent = await resolveSearchIntent(cleanQuery, country);

      if (intent.mode === 'TAXON_GROUP_DISCOVERY') {
        setDiscoveryQuery(cleanQuery);
        setPrimaryAnalysis(null);
        setIsLoading(false);
        return;
      }

      // 2. Tekil tür veya doğrudan bilimsel ad analizi
      const targetQuery = intent.mode === 'SINGLE_SPECIES' && intent.matchedSpecies?.scientificName
        ? intent.matchedSpecies.scientificName
        : cleanQuery;

      const data = await fetchSpeciesAnalysis(targetQuery, country);

      if (!data || data.species.isMatched === false) {
        setPrimaryAnalysis(null);
        setDiscoveryQuery(null);
        setErrorMessage(
          data?.species?.summary ||
            `"${cleanQuery}" için GBIF Backbone taksonomisinde eşleşen bir canlı türü bulunamadı. Lütfen Türkçe, İngilizce veya bilimsel adını kontrol edip tekrar deneyin.`
        );
        return;
      }

      setPrimaryAnalysis(data);

      // Karşılaştırma modu açıksa 2. türü de aktif ülke filtresine göre güncel tut
      if (isCompareMode && secondaryAnalysis) {
        const secName = secondaryAnalysis.species.scientificName;
        if (secondaryAnalysis.countryCode !== country) {
          setIsLoadingSecondary(true);
          fetchSpeciesAnalysis(secName, country)
            .then((secData) => setSecondaryAnalysis(secData))
            .catch((secErr) => console.error('Secondary country refresh error:', secErr))
            .finally(() => setIsLoadingSecondary(false));
        }
      }
    } catch (err) {
      console.error('Search error:', err);
      setErrorMessage('GBIF sunucularına bağlanırken bir hata oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCountryChange = (nextCountry: string) => {
    const targetQuery = primaryAnalysis?.species?.scientificName || lastQuery;
    if (targetQuery) {
      executeSearch(targetQuery, nextCountry);
    } else {
      setActiveCountry(nextCountry);
    }
  };

  const handleSelectSecondary = async (scientificName: string) => {
    setIsLoadingSecondary(true);
    try {
      const data = await fetchSpeciesAnalysis(scientificName, activeCountry);
      setSecondaryAnalysis(data);
    } catch (err) {
      console.error('Secondary species error:', err);
    } finally {
      setIsLoadingSecondary(false);
    }
  };

  const handleToggleCompare = () => {
    const nextMode = !isCompareMode;
    setIsCompareMode(nextMode);
    if (nextMode && !secondaryAnalysis && primaryAnalysis) {
      // Default companion species based on primary
      const defaultSecondary = primaryAnalysis.species.scientificName === 'Ursus arctos' 
        ? 'Canis lupus' 
        : 'Ursus arctos';
      handleSelectSecondary(defaultSecondary);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1510] text-[#e8f0ec] flex flex-col font-sans selection:bg-emerald-600 selection:text-white">
      {/* Navigation Top Bar */}
      <Navbar
        onQuickSearch={(query) => executeSearch(query, activeCountry)}
        isCompareMode={isCompareMode}
        onToggleCompare={handleToggleCompare}
        onSelectSpecies={(sciName) => executeSearch(sciName, activeCountry)}
      />

      {/* Hero Header with Search Console */}
      <HeroSection
        onSearch={executeSearch}
        onCountryChange={handleCountryChange}
        isLoading={isLoading}
        activeCountry={activeCountry}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        
        {/* Loading Indicator HUD */}
        {isLoading && (
          <div className="py-24 flex flex-col items-center justify-center text-center">
            <div className="relative w-16 h-16 mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-emerald-900/60 border-t-emerald-400 animate-spin" />
              <Compass className="w-8 h-8 text-emerald-400 absolute inset-0 m-auto" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              GBIF Açık Bilim Veri Tabanı Taranıyor
            </h3>
            <p className="text-xs text-emerald-300/70 max-w-sm">
              Gerçek gözlem kayıtları, GPS koordinatları, il dağılımı ve iNaturalist taksonomi arşivi çözümleniyor...
            </p>
          </div>
        )}

        {/* Error / Unmatched Species Notification */}
        {!isLoading && errorMessage && (
          <div className="p-6 rounded-2xl bg-rose-950/40 border border-rose-700/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-rose-400 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-rose-200 mb-0.5">Tür Eşleşmesi Bulunamadı</h3>
                <p className="text-sm text-rose-200/90">{errorMessage}</p>
              </div>
            </div>
            <button
              onClick={() => executeSearch('Ursus arctos', 'TR')}
              className="px-4 py-2 bg-rose-900/60 hover:bg-rose-800/60 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Bozayı Kaydını Yükle</span>
            </button>
          </div>
        )}

        {/* Dynamic Taxon Group Explorer View */}
        {!isLoading && discoveryQuery && (
          <TaxonGroupExplorer
            searchQuery={discoveryQuery}
            countryCode={activeCountry}
            onSelectSpecies={(sciName, country) => executeSearch(sciName, country)}
            onBackToDefault={() => {
              setDiscoveryQuery(null);
              executeSearch('Ursus arctos', activeCountry);
            }}
            onCountryChange={(country) => setActiveCountry(country)}
          />
        )}

        {/* Loaded Analysis View */}
        {!isLoading && primaryAnalysis && (
          <>
            {/* Zero-record notice for TR with explicit Global option */}
            {primaryAnalysis.totalRecords === 0 && primaryAnalysis.countryCode === 'TR' && (
              <div className="p-5 rounded-2xl bg-amber-950/35 border border-amber-700/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                  <p className="text-sm text-amber-100">
                    <strong>{primaryAnalysis.species.turkishName || primaryAnalysis.species.scientificName}</strong> için Türkiye (TR) sınırları içinde GBIF gözlem kaydı bulunamadı.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => executeSearch(primaryAnalysis.species.scientificName, '')}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-[#0b1510] rounded-xl text-xs font-bold transition-colors shrink-0 cursor-pointer"
                >
                  Tüm Dünya (Global) Kayıtlarını Göster
                </button>
              </div>
            )}



            {/* 1. Species Overview Card & Key KPIs */}
            <SpeciesOverview analysis={primaryAnalysis} />

            {/* 2. Analysis Grid: Yearly Chart + Regional Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <div className="lg:col-span-7">
                <YearlyAnalysisChart
                  yearlyStats={primaryAnalysis.yearlyStats}
                  peakYear={primaryAnalysis.peakYear}
                  lowestYear={primaryAnalysis.lowestYear}
                  earliestYear={primaryAnalysis.earliestYear}
                  scientificName={primaryAnalysis.species.scientificName}
                  totalRecords={primaryAnalysis.totalRecords}
                  missingYearCount={primaryAnalysis.missingYearCount}
                  invalidYearCount={primaryAnalysis.invalidYearCount}
                  isYearFacetTruncated={primaryAnalysis.isYearFacetTruncated}
                  isArchiveFacetCalculated={primaryAnalysis.isArchiveFacetCalculated}
                />
              </div>

              <div className="lg:col-span-5">
                <RegionalDistribution
                  regionalStats={primaryAnalysis.regionalStats}
                  unlocatedCount={primaryAnalysis.unlocatedCount}
                  totalRecords={primaryAnalysis.totalRecords}
                  isRegionFacetTruncated={primaryAnalysis.isRegionFacetTruncated}
                  filteredRegionCodeCount={primaryAnalysis.filteredRegionCodeCount}
                  regionFacetTotalCount={primaryAnalysis.regionFacetTotalCount}
                />
              </div>
            </div>

            {/* 3. Interactive Leaflet Map Stage */}
            <InteractiveMap
              occurrences={primaryAnalysis.occurrences}
              totalRecords={primaryAnalysis.totalRecords}
              species={primaryAnalysis.species}
              countryCode={primaryAnalysis.countryCode}
              secondaryOccurrences={isCompareMode ? secondaryAnalysis?.occurrences : undefined}
              secondarySpecies={isCompareMode ? secondaryAnalysis?.species : undefined}
            />

            {/* 4. Comparison Mode Panel (if toggled) */}
            {isCompareMode && (
              <SpeciesComparison
                primaryAnalysis={primaryAnalysis}
                secondaryAnalysis={secondaryAnalysis}
                onSelectSecondarySpecies={handleSelectSecondary}
                isLoadingSecondary={isLoadingSecondary}
              />
            )}

            {/* 5. Raw Scientific Observations Table */}
            <RecordDetailTable
              occurrences={primaryAnalysis.occurrences}
              totalCount={primaryAnalysis.totalRecords}
            />

            {/* 6. Species Discovery Area (6 Categories) */}
            <SpeciesDiscovery
              onSelectSpecies={(sciName) => {
                executeSearch(sciName, activeCountry);
                window.scrollTo({ top: 350, behavior: 'smooth' });
              }}
              activeScientificName={primaryAnalysis.species.scientificName}
            />

            {/* 7. IUCN Conservation Guide & Methodology */}
            <ConservationGuide />
          </>
        )}

      </main>

      {/* Global Nature Footer */}
      <Footer />
    </div>
  );
}
