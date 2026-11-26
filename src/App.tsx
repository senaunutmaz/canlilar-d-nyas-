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
import { HorseBreedDetailPage } from './pages/HorseBreedDetailPage';

import { fetchSpeciesAnalysis, resolveSearchIntent } from './services/gbif';
import { isHorseBreedCatalogQuery, resolveHorseBreedQuery } from './data/horseBreeds';
import { SpeciesAnalysis, SearchErrorType } from './types/biodiversity';

const STORAGE_SPECIES_KEY = 'canli_atlasi_species';
const STORAGE_COUNTRY_KEY = 'canli_atlasi_country';
const STORAGE_COMMON_NAME_KEY = 'canli_atlasi_common_name';

function readStoredValue(key: string, fallback: string): string {
  try {
    const val = sessionStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredSelection(species: string, country: string, commonName: string = ''): void {
  try {
    sessionStorage.setItem(STORAGE_SPECIES_KEY, species);
    sessionStorage.setItem(STORAGE_COUNTRY_KEY, country);
    sessionStorage.setItem(STORAGE_COMMON_NAME_KEY, commonName);
  } catch {
    // sessionStorage erişilemezse sessizce geç
  }
}

interface ExecuteSearchOptions {
  updateUrl?: boolean;
  navigateToAnalysis?: boolean;
  commonName?: string;
  clearCommonName?: boolean;
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
  const [lastSpeciesName, setLastSpeciesName] = useState<string>(() => readStoredValue(STORAGE_SPECIES_KEY, ''));
  const [lastCommonName, setLastCommonName] = useState<string>(() => readStoredValue(STORAGE_COMMON_NAME_KEY, ''));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<SearchErrorType | null>(null);
  const [lastAttemptedSearch, setLastAttemptedSearch] = useState<{
    query: string;
    country: string;
    options: ExecuteSearchOptions;
  } | null>(null);

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

    if (location.pathname === '/kesfet' || location.pathname.startsWith('/at-irklari')) {
      if (countryParam !== null && countryParam !== activeCountry) {
        setActiveCountry(countryParam);
      }
      return;
    }

    const speciesParam = searchParams.get('species')?.trim();
    const commonNameParam = searchParams.get('commonName')?.trim() || '';
    const targetCountry = countryParam !== null ? countryParam : activeCountry;

    if (speciesParam) {
      const effectiveCommonName =
        commonNameParam ||
        (speciesParam.toLowerCase() === lastSpeciesName.toLowerCase() ? lastCommonName : '');

      const matchesLoadedSpecies = Boolean(
        primaryAnalysis &&
          primaryAnalysis.countryCode === targetCountry &&
          (primaryAnalysis.species.canonicalName?.toLowerCase() === speciesParam.toLowerCase() ||
            primaryAnalysis.species.scientificName?.toLowerCase() === speciesParam.toLowerCase())
      );
      const matchesCommonName =
        !effectiveCommonName ||
        primaryAnalysis?.species.turkishName?.toLowerCase() === effectiveCommonName.toLowerCase();

      const isAlreadyLoaded = matchesLoadedSpecies && matchesCommonName;
      const requestKey = `${speciesParam.toLowerCase()}::${targetCountry}::${effectiveCommonName.toLowerCase()}`;

      if (!isAlreadyLoaded && inFlightKeyRef.current !== requestKey) {
        executeSearch(speciesParam, targetCountry, {
          updateUrl: false,
          navigateToAnalysis: false,
          commonName: effectiveCommonName,
          clearCommonName: !effectiveCommonName,
        });
      }
      return;
    }

    // Species view pages (/analiz, /harita, /karsilastir) without ?species= param:
    // Yalnızca oturumda önceden seçilmiş/aranmış bir tür varsa yükle; aksi halde gereksiz GBIF sorgusu başlatma.
    if (isSpeciesViewRoute) {
      const targetSpecies =
        primaryAnalysis?.species.canonicalName ||
        primaryAnalysis?.species.scientificName ||
        lastSpeciesName;
      if (!targetSpecies) return;

      const activeCommon =
        targetSpecies.toLowerCase() === lastSpeciesName.toLowerCase() ? lastCommonName : '';
      if (primaryAnalysis && primaryAnalysis.countryCode === targetCountry) {
        const nextParams = new URLSearchParams({ species: targetSpecies, country: targetCountry });
        if (activeCommon) nextParams.set('commonName', activeCommon);
        setSearchParams(nextParams, { replace: true });
      } else {
        executeSearch(targetSpecies, targetCountry, {
          updateUrl: true,
          navigateToAnalysis: false,
          commonName: activeCommon,
          clearCommonName: !activeCommon,
        });
      }
      return;
    }
  }, [location.pathname, searchParams]);

  const executeSearch = async (
    query: string,
    country: string = activeCountry,
    options: ExecuteSearchOptions = {}
  ) => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    const { updateUrl = true, navigateToAnalysis = false, commonName, clearCommonName = false } = options;

    // Belirli bir at ırkı adı arandıysa (ör. "Arap Atı", "Akhal-Teke", "Frizyen Atı") doğrudan ırk detay sayfasına yönlendir
    const matchedBreed = resolveHorseBreedQuery(cleanQuery);
    if (matchedBreed) {
      inFlightKeyRef.current = null;
      setIsLoading(false);
      setErrorMessage(null);
      setErrorType(null);
      setActiveCountry(country);
      writeStoredSelection(lastSpeciesName, country, lastCommonName);
      navigate(`/at-irklari/${matchedBreed.slug}?country=${encodeURIComponent(country)}`);
      return;
    }

    // "At" araması yapıldığında Equus caballus analizine değil "At Irkları" keşif kataloğuna yönlendir
    if (isHorseBreedCatalogQuery(cleanQuery)) {
      inFlightKeyRef.current = null;
      setIsLoading(false);
      setErrorMessage(null);
      setErrorType(null);
      setActiveCountry(country);
      writeStoredSelection(lastSpeciesName, country, lastCommonName);
      navigate(`/kesfet?q=${encodeURIComponent(cleanQuery)}&country=${encodeURIComponent(country)}`);
      return;
    }

    const preferredCommonName = commonName?.trim()
      ? commonName.trim()
      : !clearCommonName && cleanQuery.toLowerCase() === lastSpeciesName.toLowerCase()
        ? lastCommonName
        : '';
    const currentSeq = ++searchSeqRef.current;
    const requestKey = `${cleanQuery.toLowerCase()}::${country}::${preferredCommonName.toLowerCase()}`;
    inFlightKeyRef.current = requestKey;

    setIsLoading(true);
    setErrorMessage(null);
    setErrorType(null);
    setActiveCountry(country);
    setPrimaryAnalysis(null);
    setLastAttemptedSearch({ query: cleanQuery, country, options });

    try {
      const intent = await resolveSearchIntent(cleanQuery, country);

      if (currentSeq !== searchSeqRef.current) return;

      if (intent.mode === 'TAXON_GROUP_DISCOVERY') {
        inFlightKeyRef.current = null;
        setIsLoading(false);
        writeStoredSelection(lastSpeciesName, country, lastCommonName);
        navigate(`/kesfet?q=${encodeURIComponent(cleanQuery)}&country=${encodeURIComponent(country)}`);
        return;
      }

      if (intent.mode === 'NOT_FOUND') {
        inFlightKeyRef.current = null;
        setPrimaryAnalysis(null);
        setErrorType('NOT_FOUND');
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

      const data = await fetchSpeciesAnalysis(targetQuery, {
        countryCode: country,
        preMatchedSpecies: intent.mode === 'SINGLE_SPECIES' ? intent.matchedSpecies : undefined,
        preferredTurkishName: preferredCommonName || undefined,
      });

      if (currentSeq !== searchSeqRef.current) return;

      if (!data || data.species.isMatched === false) {
        inFlightKeyRef.current = null;
        setPrimaryAnalysis(null);
        setErrorType(data?.species?.matchType === 'ERROR' ? 'ERROR' : 'NOT_FOUND');
        setErrorMessage(
          data?.species?.summary ||
            `"${cleanQuery}" için GBIF Backbone taksonomisinde eşleşen bir canlı türü bulunamadı. Lütfen Türkçe, İngilizce veya bilimsel adını kontrol edin.`
        );
        setIsLoading(false);
        return;
      }

      const canonicalOrSci = data.species.canonicalName || data.species.scientificName;
      const storedCommonName =
        preferredCommonName &&
        preferredCommonName.toLowerCase() !== canonicalOrSci.toLowerCase() &&
        (canonicalOrSci.toLowerCase() === cleanQuery.toLowerCase() ||
          targetQuery.toLowerCase() === canonicalOrSci.toLowerCase())
          ? preferredCommonName
          : '';
      inFlightKeyRef.current = null;
      setPrimaryAnalysis(data);
      setLastSpeciesName(canonicalOrSci);
      setLastCommonName(storedCommonName);
      writeStoredSelection(canonicalOrSci, country, storedCommonName);

      const nextUrlParams = new URLSearchParams({ species: canonicalOrSci, country });
      if (storedCommonName) {
        nextUrlParams.set('commonName', storedCommonName);
      }

      if (navigateToAnalysis) {
        navigate(`/analiz?${nextUrlParams.toString()}`);
      } else if (updateUrl && isSpeciesViewRoute) {
        setSearchParams(nextUrlParams, { replace: true });
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
      setErrorType('ERROR');
      setErrorMessage('GBIF sunucularına bağlanırken bir hata oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    } finally {
      if (currentSeq === searchSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleCountryChange = (nextCountry: string) => {
    setActiveCountry(nextCountry);
    if (location.pathname === '/kesfet' || location.pathname.startsWith('/at-irklari')) {
      writeStoredSelection(lastSpeciesName, nextCountry, lastCommonName);
      return;
    }
    const targetQuery =
      primaryAnalysis?.species?.canonicalName ||
      primaryAnalysis?.species?.scientificName ||
      lastSpeciesName;
    if (!targetQuery) {
      writeStoredSelection('', nextCountry, '');
      return;
    }
    const preservedCommonName =
      targetQuery.toLowerCase() === lastSpeciesName.toLowerCase() ? lastCommonName : '';
    executeSearch(targetQuery, nextCountry, {
      updateUrl: isSpeciesViewRoute,
      navigateToAnalysis: false,
      commonName: preservedCommonName,
      clearCommonName: !preservedCommonName,
    });
  };

  const handleSelectSecondary = async (scientificName: string) => {
    setIsLoadingSecondary(true);
    try {
      const data = await fetchSpeciesAnalysis(scientificName, activeCountry);
      setSecondaryAnalysis(data);
    } catch (err) {
      console.error('Secondary species error:', err);
      throw err;
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

  const handleRetryLastSearch = () => {
    if (lastAttemptedSearch) {
      executeSearch(lastAttemptedSearch.query, lastAttemptedSearch.country, lastAttemptedSearch.options);
      return;
    }
    const speciesParam = searchParams.get('species')?.trim();
    const fallbackQuery = speciesParam || lastSpeciesName || 'Ursus arctos';
    executeSearch(fallbackQuery, activeCountry, {
      updateUrl: isSpeciesViewRoute,
      navigateToAnalysis: false,
    });
  };

  const activeSpeciesForNav =
    primaryAnalysis?.species?.canonicalName ||
    primaryAnalysis?.species?.scientificName ||
    lastSpeciesName;

  const hasRequestedSpecies = Boolean(searchParams.get('species')?.trim() || lastSpeciesName);
  const isInitialAutoLoading = isSpeciesViewRoute && hasRequestedSpecies && !primaryAnalysis && !errorMessage;
  const effectiveSpeciesViewLoading = isLoading || isInitialAutoLoading;

  return (
    <div className="min-h-screen bg-[#F5F9F4] text-[#1E332B] flex flex-col font-sans selection:bg-[#247A63] selection:text-white">
      {/* Navigation Bar */}
      <Navbar
        onQuickSearch={(query) => executeSearch(query, activeCountry, { updateUrl: true, navigateToAnalysis: true, clearCommonName: true })}
        isCompareMode={isCompareMode}
        onToggleCompare={handleToggleCompare}
        onSelectSpecies={(sciName) => executeSearch(sciName, activeCountry, { updateUrl: true, navigateToAnalysis: true, clearCommonName: true })}
        activeSpecies={activeSpeciesForNav}
        activeCountry={activeCountry}
        activeCommonName={activeSpeciesForNav?.toLowerCase() === lastSpeciesName.toLowerCase() ? lastCommonName : ''}
      />

      {/* Main Multi-Page Content Router */}
      <main className="flex-1">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: true, clearCommonName: true })}
                isLoading={isLoading}
                activeCountry={activeCountry}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
                errorType={errorType}
                onRetry={handleRetryLastSearch}
              />
            }
          />
          <Route
            path="/kesfet"
            element={
              <ExplorePage
                onSelectSpecies={(sciName, country, turkishName) => {
                  executeSearch(sciName, country, {
                    updateUrl: true,
                    navigateToAnalysis: true,
                    commonName: turkishName,
                    clearCommonName: !turkishName,
                  });
                }}
                activeCountry={activeCountry}
                onCountryChange={(c) => {
                  setActiveCountry(c);
                  writeStoredSelection(lastSpeciesName, c, lastCommonName);
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
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: false, clearCommonName: true })}
                isLoading={effectiveSpeciesViewLoading}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
                errorType={errorType}
                onRetry={handleRetryLastSearch}
              />
            }
          />
          <Route
            path="/analiz"
            element={
              <AnalysisPage
                primaryAnalysis={primaryAnalysis}
                activeCountry={activeCountry}
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: false, clearCommonName: true })}
                isLoading={effectiveSpeciesViewLoading}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
                errorType={errorType}
                onRetry={handleRetryLastSearch}
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
                isLoading={effectiveSpeciesViewLoading}
                errorMessage={errorMessage}
                errorType={errorType}
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: false, clearCommonName: true })}
                onRetry={handleRetryLastSearch}
                activeCountry={activeCountry}
              />
            }
          />
          <Route
            path="/at-irklari"
            element={
              <ExplorePage
                defaultQuery="At"
                onSelectSpecies={(sciName, country, turkishName) => {
                  executeSearch(sciName, country, {
                    updateUrl: true,
                    navigateToAnalysis: true,
                    commonName: turkishName,
                    clearCommonName: !turkishName,
                  });
                }}
                activeCountry={activeCountry}
                onCountryChange={(c) => {
                  setActiveCountry(c);
                  writeStoredSelection(lastSpeciesName, c, lastCommonName);
                }}
              />
            }
          />
          <Route
            path="/at-irklari/:breedSlug"
            element={<HorseBreedDetailPage activeCountry={activeCountry} />}
          />
          <Route
            path="/koruma"
            element={<ConservationPage />}
          />
          <Route
            path="*"
            element={
              <HomePage
                onSearch={(q, c) => executeSearch(q, c, { updateUrl: true, navigateToAnalysis: true, clearCommonName: true })}
                isLoading={isLoading}
                activeCountry={activeCountry}
                onCountryChange={handleCountryChange}
                errorMessage={errorMessage}
                errorType={errorType}
                onRetry={handleRetryLastSearch}
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
