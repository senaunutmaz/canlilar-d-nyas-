/**
 * Canlı Atlası: Kaybolan Canlıların İzinde – Biyoçeşitliliğin Dijital Hafızası
 * Açık veri tabanlarından (GBIF & iNaturalist) beslenen çok sayfalı biyoçeşitlilik analiz platformu.
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';
import { ExplorePage } from './pages/ExplorePage';
import { MapPage } from './pages/MapPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { ComparePage } from './pages/ComparePage';
import { ConservationPage } from './pages/ConservationPage';

import { fetchSpeciesAnalysis, resolveSearchIntent } from './services/gbif';
import { SpeciesAnalysis } from './types/biodiversity';

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
      const intent = await resolveSearchIntent(cleanQuery, country);

      if (intent.mode === 'TAXON_GROUP_DISCOVERY') {
        setDiscoveryQuery(cleanQuery);
        setPrimaryAnalysis(null);
        setIsLoading(false);
        return;
      }

      const targetQuery = intent.mode === 'SINGLE_SPECIES' && intent.matchedSpecies?.scientificName
        ? intent.matchedSpecies.scientificName
        : cleanQuery;

      const data = await fetchSpeciesAnalysis(targetQuery, country);

      if (!data || data.species.isMatched === false) {
        setPrimaryAnalysis(null);
        setDiscoveryQuery(null);
        setErrorMessage(
          data?.species?.summary ||
            `"${cleanQuery}" için GBIF Backbone taksonomisinde eşleşen bir canlı türü bulunamadı.`
        );
        return;
      }

      setPrimaryAnalysis(data);

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
      setErrorMessage('GBIF sunucularına bağlanırken bir hata oluştu.');
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
      const defaultSecondary = primaryAnalysis.species.scientificName === 'Ursus arctos' 
        ? 'Canis lupus' 
        : 'Ursus arctos';
      handleSelectSecondary(defaultSecondary);
    }
  };

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0b1510] text-[#e8f0ec] flex flex-col font-sans selection:bg-emerald-600 selection:text-white">
        {/* Navigation Bar */}
        <Navbar
          onQuickSearch={(query) => executeSearch(query, activeCountry)}
          isCompareMode={isCompareMode}
          onToggleCompare={handleToggleCompare}
          onSelectSpecies={(sciName) => executeSearch(sciName, activeCountry)}
        />

        {/* Main Multi-Page Content Router */}
        <main className="flex-1">
          <Routes>
            <Route 
              path="/" 
              element={
                <HomePage
                  onSearch={(q, c) => executeSearch(q, c)}
                  isLoading={isLoading}
                  activeCountry={activeCountry}
                  onCountryChange={handleCountryChange}
                />
              } 
            />
            <Route 
              path="/kesfet" 
              element={
                <ExplorePage
                  onSelectSpecies={(sciName, country) => executeSearch(sciName, country)}
                  activeCountry={activeCountry}
                  onCountryChange={handleCountryChange}
                />
              } 
            />
            <Route 
              path="/harita" 
              element={
                <MapPage
                  primaryAnalysis={primaryAnalysis}
                  activeCountry={activeCountry}
                  onSearch={(q, c) => executeSearch(q, c)}
                  isLoading={isLoading}
                  onCountryChange={handleCountryChange}
                />
              } 
            />
            <Route 
              path="/analiz" 
              element={
                <AnalysisPage
                  primaryAnalysis={primaryAnalysis}
                  activeCountry={activeCountry}
                  onSearch={(q, c) => executeSearch(q, c)}
                  isLoading={isLoading}
                  onCountryChange={handleCountryChange}
                />
              } 
            />
            <Route 
              path="/karsilastir" 
              element={
                <ComparePage
                  primaryAnalysis={primaryAnalysis}
                  secondaryAnalysis={secondaryAnalysis}
                  onSelectSecondarySpecies={handleSelectSecondary}
                  isLoadingSecondary={isLoadingSecondary}
                  onSearch={(q, c) => executeSearch(q, c)}
                  activeCountry={activeCountry}
                />
              } 
            />
            <Route 
              path="/koruma" 
              element={<ConservationPage />} 
            />
            <Route 
              path="*" 
              element={
                <HomePage
                  onSearch={(q, c) => executeSearch(q, c)}
                  isLoading={isLoading}
                  activeCountry={activeCountry}
                  onCountryChange={handleCountryChange}
                />
              } 
            />
          </Routes>
        </main>

        {/* Global Nature Footer */}
        <Footer />
      </div>
    </BrowserRouter>
  );
}
