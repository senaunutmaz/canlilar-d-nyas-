/**
 * Canlı Atlası: Kaybolan Canlıların İzinde – Biyoçeşitliliğin Dijital Hafızası
 * Açık veri tabanlarından (GBIF & iNaturalist) beslenen çok sayfalı biyoçeşitlilik analiz platformu.
 */

import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
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

const STORAGE_SPECIES_KEY = 'canli_atlasi_species';
const STORAGE_COUNTRY_KEY = 'canli_atlasi_country';

function readStoredValue(key: string, fallback: string): string {
  try {
    const val = sessionStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredSelection(species: string, country: string): void {
  try {
    sessionStorage.setItem(STORAGE_SPECIES_KEY, species);
    sessionStorage.setItem(STORAGE_COUNTRY_KEY, country);
  } catch {
    // sessionStorage erişilemezse sessizce geç
  }
}

interface ExecuteSearchOptions {
  updateUrl?: boolean;
  navigateToAnalysis?: boolean;
}

function MainRouter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [primaryAnalysis, setPrimaryAnalysis] = useState<SpeciesAnalysis | null>(null);
  const [secondaryAnalysis, setSecondaryAnalysis] = useState<SpeciesAnalysis | null>(null);
  const [isCompareMode, setIsCompareMode] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingSecondary, setIsLoadingSecondary] = useState<boolean>(false);
  const [activeCountry, setActiveCountry] = useState<string>(() => readStoredValue(STORAGE_COUNTRY_KEY, 'TR'));
  const [lastSpeciesName, setLastSpeciesName] = useState<string>(() => readStoredValue(STORAGE_SPECIES_KEY, 'Ursus arctos'));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Race condition prevention sequence counter and active request key
  const searchSeqRef = useRef(0);
  const inFlightKeyRef = useRef<string | null>(null);

  const isSpeciesViewRoute =
    location.pathname === '/analiz' ||
    location.pathname === '/harita' ||
    location.pathname === '/karsilastir';

  // Sync with URL params on route/searchParams change
  useEffect(() => {
    const countryParam = searchParams.get('country');

    if (location.pathname === '/kesfet') {
      if (countryParam !== null && countryParam !== activeCountry) {
        setActiveCountry(countryParam);
      }
      return;
    }

    const speciesParam = searchParams.get('species')?.trim();
    const targetCountry = countryParam !== null ? countryParam : activeCountry;

    if (speciesParam) {
      const isAlreadyLoaded =
        primaryAnalysis &&
        primaryAnalysis.countryCode === targetCountry &&
        (primaryAnalysis.species.canonicalName?.toLowerCase() === speciesParam.toLowerCase() ||
          primaryAnalysis.species.scientificName?.toLowerCase() === speciesParam.toLowerCase());

      const requestKey = `${speciesParam.toLowerCase()}::${targetCountry}`;

      if (!isAlreadyLoaded && inFlightKeyRef.current !== requestKey) {
        executeSearch(speciesParam, targetCountry, { updateUrl: false, navigateToAnalysis: false });
      }
      return;
    }

    // Species view pages (/analiz, /harita, /karsilastir) without ?species= param
    if (isSpeciesViewRoute) {
      const targetSpecies = primaryAnalysis?.species.canonicalName || primaryAnalysis?.species.scientificName || lastSpeciesName || 'Ursus arctos';
      if (primaryAnalysis && primaryAnalysis.countryCode === targetCountry) {
        setSearchParams({ species: targetSpecies, country: targetCountry }, { replace: true });
      } else {
        executeSearch(targetSpecies, targetCountry, { updateUrl: true, navigateToAnalysis: false });
      }
      return;
    }

    // Initial background preload on HomePage if nothing loaded yet
    if (location.pathname === '/' && !primaryAnalysis && !isLoading && !errorMessage && searchSeqRef.current === 0) {
      executeSearch(lastSpeciesName || 'Ursus arctos', targetCountry, { updateUrl: false, navigateToAnalysis: false });
    }
  }, [location.pathname, searchParams]);

  const executeSearch = async (
    query: string,
    country: string = activeCountry,
    options: ExecuteSearchOptions = {}
  ) => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    const { updateUrl = true, navigateToAnalysis = false } = options;
    const currentSeq = ++searchSeqRef.current;
    const requestKey = `${cleanQuery.toLowerCase()}::${country}`;
    inFlightKeyRef.current = requestKey;

    setIsLoading(true);
    setErrorMessage(null);
    setActiveCountry(country);
    setPrimaryAnalysis(null);

    try {
      const intent = await resolveSearchIntent(cleanQuery, country);

      if (currentSeq !== searchSeqRef.current) return;

      if (intent.mode === 'TAXON_GROUP_DISCOVERY') {
        inFlightKeyRef.current = null;
        setIsLoading(false);
        writeStoredSelection(lastSpeciesName, country);
        navigate(`/kesfet?q=${encodeURIComponent(cleanQuery)}&country=${encodeURIComponent(country)}`);
        return;
      }

      if (intent.mode === 'NOT_FOUND') {
        inFlightKeyRef.current = null;
        setPrimaryAnalysis(null);
        setErrorMessage(
          intent.reason ||
            `"${cleanQuery}" için GBIF Backbone taksonomisinde eşleşen bir canlı türü veya hayvan grubu bulunamadı. Lütfen Türkçe, İngilizce veya bilimsel adını kontrol edip tekrar deneyin.`
        );
        setIsLoading(false);
        return;
      }

      const targetQuery =
        intent.mode === 'SINGLE_SPECIES' && intent.matchedSpecies?.scientificName
          ? intent.matchedSpecies.canonicalName || intent.matchedSpecies.scientificName
          : cleanQuery;

      const data = await fetchSpeciesAnalysis(targetQuery, country);

      if (currentSeq !== searchSeqRef.current) return;

      if (!data || data.species.isMatched === false) {
        inFlightKeyRef.current = null;
        setPrimaryAnalysis(null);
        setErrorMessage(
          data?.species?.summary ||
            `"${cleanQuery}" için GBIF Backbone taksonomisinde eşleşen bir canlı türü bulunamadı. Lütfen Türkçe, İngilizce veya bilimsel adını kontrol edin.`
        );
        setIsLoading(false);
        return;
      }

      const canonicalOrSci = data.species.canonicalName || data.species.scientificName;
      inFlightKeyRef.current = null;
      setPrimaryAnalysis(data);
      setLastSpeciesName(canonicalOrSci);
      writeStoredSelection(canonicalOrSci, country);

      if (navigateToAnalysis) {
        navigate(`/analiz?species=${encodeURIComponent(canonicalOrSci)}&country=${encodeURIComponent(country)}`);
      } else if (updateUrl && isSpeciesViewRoute) {
        setSearchParams({ species: canonicalOrSci, country }, { replace: true });
      }

      if (isCompareMode && secondaryAnalysis) {
        const secName = secondaryAnalysis.species.canonicalName || secondaryAnalysis.species.scientificName;
        if (secondaryAnalysis.countryCode !== country) {
          setIsLoadingSecondary(true);
          fetchSpeciesAnalysis(secName, country)
            .then((secData) => {
              if (currentSeq === searchSeqRef.current) {
                setSecondaryAnalysis(secData);
              }
            })
            .catch((secErr) => console.error('Secondary country refresh error:', secErr))
            .finally(() => {
              if (currentSeq === searchSeqRef.current) {
                setIsLoadingSecondary(false);
              }
            });
        }
      }
    } catch (err) {
      if (currentSeq !== searchSeqRef.current) return;
      inFlightKeyRef.current = null;
      console.error('Search error:', err);
      setPrimaryAnalysis(null);
      setErrorMessage('GBIF sunucularına bağlanırken bir hata oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    } finally {
      if (currentSeq === searchSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleCountryChange = (nextCountry: string) => {
    setActiveCountry(nextCountry);
    if (location.pathname === '/kesfet') {
      writeStoredSelection(lastSpeciesName, nextCountry);
      return;
    }
    const targetQuery =
      primaryAnalysis?.species?.canonicalName ||
      primaryAnalysis?.species?.scientificName ||
      lastSpeciesName ||
      'Ursus arctos';
    executeSearch(targetQuery, nextCountry, {
      updateUrl: isSpeciesViewRoute,
      navigateToAnalysis: false,
    });
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
      const defaultSecondary =
        primaryAnalysis.species.canonicalName === 'Ursus arctos'
          ? 'Canis lupus'
          : 'Ursus arctos';
      handleSelectSecondary(defaultSecondary);
    }
  };

  const activeSpeciesForNav =
    primaryAnalysis?.species?.canonicalName ||
    primaryAnalysis?.species?.scientificName ||
    lastSpeciesName;

  return (
    <div className="min-h-screen bg-[#0b1510] text-[#e8f0ec] flex flex-col font-sans selection:bg-emerald-600 selection:text-white">
      {/* Navigation Bar */}
      <Navbar
        onQuickSearch={(query) => executeSearch(query, activeCountry, { updateUrl: true, navigateToAnalysis: true })}
        isCompareMode={isCompareMode}
        onToggleCompare={handleToggleCompare}
        onSelectSpecies={(sciName) => executeSearch(sciName, activeCountry, { updateUrl: true, navigateToAnalysis: true })}
        activeSpecies={activeSpeciesForNav}
        activeCountry={activeCountry}
      />

      {/* Main Multi-Page Content Router */}
      <main className="flex-1">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: true })}
                isLoading={isLoading}
                activeCountry={activeCountry}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
              />
            }
          />
          <Route
            path="/kesfet"
            element={
              <ExplorePage
                onSelectSpecies={(sciName, country) => {
                  executeSearch(sciName, country, { updateUrl: true, navigateToAnalysis: true });
                }}
                activeCountry={activeCountry}
                onCountryChange={(c) => {
                  setActiveCountry(c);
                  writeStoredSelection(lastSpeciesName, c);
                }}
              />
            }
          />
          <Route
            path="/harita"
            element={
              <MapPage
                primaryAnalysis={primaryAnalysis}
                activeCountry={activeCountry}
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: false })}
                isLoading={isLoading}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
              />
            }
          />
          <Route
            path="/analiz"
            element={
              <AnalysisPage
                primaryAnalysis={primaryAnalysis}
                activeCountry={activeCountry}
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: false })}
                isLoading={isLoading}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
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
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: false })}
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
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: true })}
                isLoading={isLoading}
                activeCountry={activeCountry}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
              />
            }
          />
        </Routes>
      </main>

      {/* Global Nature Footer */}
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MainRouter />
    </BrowserRouter>
  );
}
