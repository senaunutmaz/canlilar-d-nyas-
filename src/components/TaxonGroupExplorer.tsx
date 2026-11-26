import React, { useState, useEffect, useRef } from 'react';
import { 
  resolveSearchIntent, 
  discoverSpeciesByGroup,
  enrichDiscoveryPageItems,
  expandTaxonCandidateToSubgroupsPaged,
  enrichSubgroupLabels,
  fetchVerifiedFallbackPhoto,
  TaxonSubgroupExpansionResult
} from '../services/gbif';
import { 
  TaxonGroupCandidate, 
  DiscoveredSpeciesItem, 
  SpeciesDiscoveryResult,
  SearchErrorType,
  SubgroupPaginationMeta
} from '../types/biodiversity';
import { 
  Compass, 
  Globe2, 
  ChevronRight, 
  AlertCircle, 
  Layers, 
  HelpCircle, 
  X, 
  ArrowUpRight,
  Database,
  ImageOff,
  ChevronDown
} from 'lucide-react';

interface TaxonGroupExplorerProps {
  searchQuery: string;
  countryCode: string;
  onSelectSpecies: (scientificName: string, country: string, turkishName?: string) => void;
  onBackToDefault: () => void;
  onCountryChange: (country: string) => void;
}

export const TaxonGroupExplorer: React.FC<TaxonGroupExplorerProps> = ({
  searchQuery,
  countryCode,
  onSelectSpecies,
  onBackToDefault,
  onCountryChange,
}) => {
  const [isLoadingIntent, setIsLoadingIntent] = useState<boolean>(true);
  const [isLoadingSpecies, setIsLoadingSpecies] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<SearchErrorType | null>(null);

  const [groups, setGroups] = useState<TaxonGroupCandidate[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string>('');
  const [subgroupMeta, setSubgroupMeta] = useState<SubgroupPaginationMeta | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<SpeciesDiscoveryResult | null>(null);
  const [drillStack, setDrillStack] = useState<Array<{ label: string; groups: TaxonGroupCandidate[]; activeGroupId: string; subgroupMeta: SubgroupPaginationMeta | null }>>([]);
  const [isDrillingDown, setIsDrillingDown] = useState<boolean>(false);
  
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [includeFossil, setIncludeFossil] = useState<boolean>(false);
  const [currentCountry, setCurrentCountry] = useState<string>(countryCode);
  const [visibleSubgroupCount, setVisibleSubgroupCount] = useState<number>(16);
  const [isLoadingMoreSubgroups, setIsLoadingMoreSubgroups] = useState<boolean>(false);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Record<string, boolean>>({});
  const [enrichingPhotoKeys, setEnrichingPhotoKeys] = useState<Record<number, boolean>>({});
  const browserRetryAttemptedRef = useRef<Set<number>>(new Set());

  const markPhotoFailed = (item?: DiscoveredSpeciesItem) => {
    const failedUrl = item?.photoUrl;
    if (!failedUrl || !item) return;
    setFailedPhotoUrls((prev) => (prev[failedUrl] ? prev : { ...prev, [failedUrl]: true }));

    const itemKey = item.acceptedUsageKey || item.usageKey;
    if (browserRetryAttemptedRef.current.has(itemKey)) return;
    browserRetryAttemptedRef.current.add(itemKey);

    const activeSeq = requestSeqRef.current;
    setEnrichingPhotoKeys((prev) => ({ ...prev, [itemKey]: true }));

    void fetchVerifiedFallbackPhoto(item.canonicalName, itemKey, {
      excludeUrls: new Set([failedUrl]),
      includeInatSynonymCheck: true,
    })
      .then((alt) => {
        if (activeSeq !== requestSeqRef.current || !alt) return;
        setDiscoveryResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            species: prev.species.map((sp) => {
              const spKey = sp.acceptedUsageKey || sp.usageKey;
              if (spKey !== itemKey) return sp;
              return {
                ...sp,
                photoUrl: alt.photoUrl,
                photoAttribution: alt.photoAttribution,
                photoSource: alt.photoSource,
              };
            }),
          };
        });
      })
      .catch(() => {
        // Yedek görsel alınamazsa temiz yer tutucu korunur
      })
      .finally(() => {
        if (activeSeq === requestSeqRef.current) {
          setEnrichingPhotoKeys((prev) => {
            if (!prev[itemKey]) return prev;
            const next = { ...prev };
            delete next[itemKey];
            return next;
          });
        }
      });
  };

  const requestSeqRef = useRef<number>(0);
  const prevQueryRef = useRef<string | null>(null);
  const subgroupSeqRef = useRef<number>(0);

  useEffect(() => {
    setCurrentCountry(countryCode);
    if (prevQueryRef.current !== searchQuery || groups.length === 0) {
      prevQueryRef.current = searchQuery;
      setDrillStack([]);
      setVisibleSubgroupCount(16);
      loadGroupIntent(searchQuery, countryCode);
    } else {
      loadSpeciesForGroup(groups, activeGroupId || groups[0].id, countryCode, currentPage, includeFossil);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, countryCode]);

  const loadGroupIntent = async (query: string, cc: string) => {
    const seq = ++requestSeqRef.current;
    subgroupSeqRef.current++;
    setIsLoadingIntent(true);
    setErrorMessage(null);
    setErrorType(null);
    setDiscoveryResult(null);
    setSubgroupMeta(null);
    setVisibleSubgroupCount(16);
    try {
      const intent = await resolveSearchIntent(query, cc);
      if (seq !== requestSeqRef.current) return;

      if (intent.mode === 'TAXON_GROUP_DISCOVERY' && intent.groups && intent.groups.length > 0) {
        setGroups(intent.groups);
        setSubgroupMeta(intent.subgroupPagination ?? null);
        const firstId = intent.activeGroupId || intent.groups[0].id;
        setActiveGroupId(firstId);
        await loadSpeciesForGroup(intent.groups, firstId, cc, 1, includeFossil, seq);
      } else if (intent.mode === 'SINGLE_SPECIES' && intent.matchedSpecies?.scientificName) {
        setIsLoadingIntent(false);
        onSelectSpecies(
          intent.matchedSpecies.canonicalName || intent.matchedSpecies.scientificName,
          cc,
          intent.matchedSpecies.turkishName
        );
      } else {
        setGroups([]);
        setSubgroupMeta(null);
        setDiscoveryResult(null);
        setErrorType('NOT_FOUND');
        setErrorMessage(intent.reason || `"${query}" araması için Animalia alemi içinde doğrulanmış bir taksonomik grup bulunamadı.`);
        setIsLoadingIntent(false);
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('Taxon intent error:', err);
      setErrorType('ERROR');
      setErrorMessage('GBIF Backbone taksonomi servislerine bağlanırken bir hata oluştu.');
      setIsLoadingIntent(false);
    }
  };

  const loadSpeciesForGroup = async (
    targetGroups: TaxonGroupCandidate[], 
    gid: string, 
    cc: string, 
    page: number, 
    fossil: boolean,
    existingSeq?: number
  ) => {
    const seq = existingSeq ?? ++requestSeqRef.current;
    setIsLoadingSpecies(true);
    setEnrichingPhotoKeys({});
    setErrorMessage(null);
    setErrorType(null);
    try {
      const res = await discoverSpeciesByGroup(targetGroups, {
        countryCode: cc,
        groupId: gid,
        page,
        pageSize: 16,
        includeFossilOnly: fossil,
        enrichWithInaturalist: false,
        groups: targetGroups,
      });
      if (seq !== requestSeqRef.current) return;
      setDiscoveryResult(res);
      setCurrentPage(page);
      setIsLoadingIntent(false);
      setIsLoadingSpecies(false);

      if (res.species.length > 0) {
        const pendingKeys: Record<number, boolean> = {};
        for (const item of res.species) {
          if (!item.photoUrl) {
            pendingKeys[item.acceptedUsageKey || item.usageKey] = true;
          }
        }
        setEnrichingPhotoKeys(pendingKeys);

        void enrichDiscoveryPageItems(res.species, {
          shouldCancel: () => seq !== requestSeqRef.current,
          onUpdate: (updatedSpecies, completedKeys) => {
            if (seq !== requestSeqRef.current) return;
            setDiscoveryResult((prev) =>
              prev ? { ...prev, species: updatedSpecies } : prev
            );
            const remainingKeys: Record<number, boolean> = {};
            for (const item of updatedSpecies) {
              const itemKey = item.acceptedUsageKey || item.usageKey;
              if (!item.photoUrl && !completedKeys.has(itemKey)) {
                remainingKeys[itemKey] = true;
              }
            }
            setEnrichingPhotoKeys(remainingKeys);
          },
        })
          .catch((enrichErr) => {
            console.warn('Progressive species photo enrichment warning:', enrichErr);
          })
          .finally(() => {
            if (seq === requestSeqRef.current) {
              setEnrichingPhotoKeys({});
            }
          });
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('Species discovery load error:', err);
      setErrorType('ERROR');
      setErrorMessage('Tür keşif listesi yüklenirken bir hata oluştu.');
      setIsLoadingIntent(false);
      setIsLoadingSpecies(false);
    }
  };

  const handleSubgroupChange = (gid: string) => {
    setActiveGroupId(gid);
    loadSpeciesForGroup(groups, gid, currentCountry, 1, includeFossil);
  };

  const handleDrillDownSubgroup = async (group: TaxonGroupCandidate) => {
    if (!group.canDrillDown || isDrillingDown || isLoadingSpecies) return;
    const seq = ++requestSeqRef.current;
    setIsDrillingDown(true);
    try {
      const expanded = await expandTaxonCandidateToSubgroupsPaged(group, { countryCode: currentCountry });
      if (seq !== requestSeqRef.current) return;
      if (expanded.groups.length > 1) {
        setDrillStack((prev) => [
          ...prev,
          {
            label: prev.length === 0 ? searchQuery : (groups[0]?.label || searchQuery),
            groups,
            activeGroupId,
            subgroupMeta,
          },
        ]);
        subgroupSeqRef.current++;
        setGroups(expanded.groups);
        setSubgroupMeta(expanded.pagination);
        setVisibleSubgroupCount(16);
        const firstId = expanded.groups[0].id;
        setActiveGroupId(firstId);
        await loadSpeciesForGroup(expanded.groups, firstId, currentCountry, 1, includeFossil, seq);
      }
    } catch (err) {
      console.error('Subgroup drill-down error:', err);
    } finally {
      if (seq === requestSeqRef.current) {
        setIsDrillingDown(false);
      }
    }
  };

  const handleDrillBreadcrumbBack = (targetIndex: number) => {
    const target = drillStack[targetIndex];
    if (!target) return;
    subgroupSeqRef.current++;
    setDrillStack((prev) => prev.slice(0, targetIndex));
    setGroups(target.groups);
    setSubgroupMeta(target.subgroupMeta);
    setVisibleSubgroupCount(16);
    setActiveGroupId(target.activeGroupId);
    loadSpeciesForGroup(target.groups, target.activeGroupId, currentCountry, 1, includeFossil);
  };

  const handleRevealMoreSubgroups = async (showAll = false) => {
    if (isLoadingMoreSubgroups) return;
    const needsRemoteFetch = Boolean(subgroupMeta?.hasMore) && (showAll || visibleSubgroupCount + 16 > groups.length);
    if (!needsRemoteFetch && visibleSubgroupCount >= groups.length) return;

    const subSeq = ++subgroupSeqRef.current;
    const startIdx = visibleSubgroupCount;
    setIsLoadingMoreSubgroups(true);

    try {
      let workingGroups = groups;
      if (needsRemoteFetch && subgroupMeta) {
        const existingExpanded: TaxonSubgroupExpansionResult = {
          groups: workingGroups.filter((g) => g.isParentOverview || g.id.startsWith('dyn-sub-')),
          pagination: subgroupMeta,
        };
        const fetched = await expandTaxonCandidateToSubgroupsPaged(subgroupMeta.parentGroup, {
          countryCode: currentCountry,
          existingResult: existingExpanded,
          fetchAll: showAll,
          maxPagesPerBatch: 1,
        });
        if (subSeq !== subgroupSeqRef.current) return;

        // Varsa ikincil üst grup adaylarını (dyn-sub-* olmayanlar) sonuna koruyarak ekle
        const seenIds = new Set(fetched.groups.map((g) => g.id));
        const seenKeys = new Set(
          fetched.groups
            .map((g) => g.acceptedUsageKey || g.taxonKeys?.[0])
            .filter((k): k is number => typeof k === 'number')
        );
        const trailingExtras = workingGroups.filter((g) => {
          if (g.isParentOverview || g.id.startsWith('dyn-sub-') || seenIds.has(g.id)) return false;
          const k = g.acceptedUsageKey || g.taxonKeys?.[0];
          return !k || !seenKeys.has(k);
        });
        workingGroups = [...fetched.groups, ...trailingExtras];
        setGroups(workingGroups);
        setSubgroupMeta(fetched.pagination);
      }

      const nextCount = showAll ? workingGroups.length : Math.min(workingGroups.length, startIdx + 16);
      setVisibleSubgroupCount(nextCount);

      const batchSize = Math.min(16, Math.max(0, nextCount - startIdx));
      if (batchSize > 0) {
        const enriched = await enrichSubgroupLabels(workingGroups, startIdx, batchSize);
        if (subSeq === subgroupSeqRef.current) {
          setGroups(enriched);
        }
      }
    } catch (err) {
      console.warn('Subgroup pagination/label warning:', err);
    } finally {
      if (subSeq === subgroupSeqRef.current) {
        setIsLoadingMoreSubgroups(false);
      }
    }
  };

  const handlePageChange = (nextPage: number) => {
    loadSpeciesForGroup(groups, activeGroupId, currentCountry, nextPage, includeFossil);
  };

  const handleCountryToggle = (cc: string) => {
    if (cc === currentCountry) return;
    setCurrentCountry(cc);
    onCountryChange(cc);
  };

  const handleFossilToggle = (fossilVal: boolean) => {
    setIncludeFossil(fossilVal);
    loadSpeciesForGroup(groups, activeGroupId, currentCountry, 1, fossilVal);
  };

  const getExistenceBadge = (status?: string) => {
    switch (status) {
      case 'LIVING':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#DDEFE3]/95 border border-[#8CCFB0] text-[#1E5E4C] shadow-2xs">YAŞAYAN (LIVING)</span>;
      case 'FOSSIL_OR_EXTINCT':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-rose-50/95 border border-rose-300 text-rose-800 shadow-2xs">FOSİL / SOYU TÜKENMİŞ</span>;
      case 'HISTORICAL_OR_UNCERTAIN':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#FDF6EC]/95 border border-[#F3D9B5] text-[#7A4E16] shadow-2xs">TARİHSEL / BELİRSİZ</span>;
      default:
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-white/95 border border-[#D6E4DC] text-[#556B62] shadow-2xs">DOĞRULANMIŞ</span>;
    }
  };

  const getIucnBadge = (status?: string) => {
    if (!status || status === 'NE') return null;
    const upper = status.toUpperCase();
    let badgeTone = 'bg-white/95 border-[#D6E4DC] text-[#1E332B]';
    if (upper === 'CR') badgeTone = 'bg-rose-50/95 border-rose-300 text-rose-800';
    else if (upper === 'EN') badgeTone = 'bg-orange-50/95 border-orange-300 text-orange-800';
    else if (upper === 'VU') badgeTone = 'bg-amber-50/95 border-amber-300 text-amber-800';
    else if (upper === 'NT') badgeTone = 'bg-yellow-50/95 border-yellow-300 text-yellow-800';
    else if (upper === 'LC') badgeTone = 'bg-[#DDEFE3]/95 border-[#8CCFB0] text-[#1E5E4C]';
    else if (upper === 'EW') badgeTone = 'bg-purple-50/95 border-purple-300 text-purple-800';
    return (
      <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border shadow-2xs ${badgeTone}`}>
        IUCN: {status}
      </span>
    );
  };

  const hasLivingSubgroups = groups.some((g) => !g.isParentOverview && !g.isExtinct);
  const displayGroups =
    !includeFossil && hasLivingSubgroups
      ? groups.filter((g) => g.isParentOverview || !g.isExtinct || g.id === activeGroupId)
      : groups;
  const hiddenExtinctSubgroupCount = Math.max(0, groups.length - displayGroups.length);
  const activeGroupCandidate = groups.find(g => g.id === activeGroupId) || groups[0];

  return (
    <div className="max-w-7xl mx-auto py-2 animate-fadeIn">
      {/* Explorer Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#D6E4DC] shadow-sm mb-8 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#247A63] font-semibold mb-2">
              <Compass className="w-3.5 h-3.5" />
              <span>GBIF Dinamik Taksonomik Keşif Sistemi</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1E332B] tracking-tight">
              "{searchQuery}" — Canlı Grubu Keşfi
            </h1>
            <p className="text-sm text-[#556B62] mt-2 max-w-2xl leading-relaxed">
              Animalia alemi için GBIF Backbone üzerinden doğrulanan alt gruplar ve kabul edilmiş tür kataloğu (gözlem kapsamından bağımsız). Türkiye veya Global görünümünü değiştirerek gözlem sayılarını karşılaştırabilir, herhangi bir türe tıklayarak analiz sayfasını açabilirsiniz.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Country Selector Toggle */}
            <div className="flex items-center gap-1 p-1 bg-[#F5F9F4] rounded-xl border border-[#D6E4DC]">
              <button
                type="button"
                onClick={() => handleCountryToggle('TR')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  currentCountry === 'TR'
                    ? 'bg-[#247A63] text-white shadow-xs'
                    : 'text-[#556B62] hover:text-[#1E332B]'
                }`}
              >
                Türkiye (TR)
              </button>
              <button
                type="button"
                onClick={() => handleCountryToggle('')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  currentCountry === ''
                    ? 'bg-[#247A63] text-white shadow-xs'
                    : 'text-[#556B62] hover:text-[#1E332B]'
                }`}
              >
                Tüm Dünya (Global)
              </button>
            </div>

            <button
              type="button"
              onClick={onBackToDefault}
              className="px-4 py-2.5 bg-[#F5F9F4] hover:bg-[#DDEFE3]/60 text-[#556B62] hover:text-[#1E332B] rounded-xl text-xs font-semibold border border-[#D6E4DC] transition-colors flex items-center gap-2 cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>Keşften Çık</span>
            </button>
          </div>
        </div>

        {/* Subgroups Navigation Tabs */}
        {groups.length > 0 && (
          <div className="mt-8 pt-6 border-t border-[#E6EFEA]">
            {drillStack.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs mb-4 bg-[#F5F9F4] px-3.5 py-2 rounded-xl border border-[#D6E4DC]">
                <span className="text-[#247A63] font-mono uppercase text-[10px] font-bold mr-1">Hiyerarşi:</span>
                {drillStack.map((crumb, idx) => (
                  <React.Fragment key={`${crumb.activeGroupId}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => handleDrillBreadcrumbBack(idx)}
                      className="text-[#247A63] hover:text-[#1D6350] underline underline-offset-2 font-semibold cursor-pointer"
                    >
                      {crumb.label}
                    </button>
                    <ChevronRight className="w-3.5 h-3.5 text-[#556B62]" />
                  </React.Fragment>
                ))}
                <span className="text-[#1E332B] font-bold">{groups[0]?.scientificName || activeGroupCandidate?.scientificName}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#556B62]">
                <Layers className="w-4 h-4 text-[#247A63]" />
                <span>
                  {subgroupMeta?.hasMore
                    ? `Doğrulanmış Alt Gruplar (${displayGroups.length}+ yüklendi${
                        subgroupMeta.totalMatchedCount
                          ? ` / ~${subgroupMeta.totalMatchedCount.toLocaleString('tr-TR')} GBIF kaydı`
                          : ', devamı var'
                      }):`
                    : subgroupMeta?.offsetLimitReached
                      ? `Doğrulanmış Alt Gruplar (${displayGroups.length}+ · 100.000 GBIF sınırı):`
                      : `Doğrulanmış Alt Gruplar (${displayGroups.length}):`}
                </span>
              </div>

              {activeGroupCandidate?.canDrillDown && !activeGroupCandidate?.isParentOverview && (
                <button
                  type="button"
                  disabled={isDrillingDown || isLoadingSpecies}
                  onClick={() => handleDrillDownSubgroup(activeGroupCandidate)}
                  className="px-3 py-1.5 rounded-lg bg-[#DDEFE3] hover:bg-[#247A63] disabled:opacity-50 text-[#1E332B] hover:text-white border border-[#8CCFB0] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{isDrillingDown ? 'Alt Gruplar Yükleniyor...' : 'Bu Alt Grubu Daha Detaylı Böl'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-none">
              {displayGroups.slice(0, visibleSubgroupCount).map((g) => {
                const isActive = g.id === activeGroupId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => handleSubgroupChange(g.id)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-2 cursor-pointer ${
                      isActive
                        ? 'bg-[#247A63] text-white shadow-xs font-bold'
                        : 'bg-[#F5F9F4] text-[#1E332B] hover:bg-[#DDEFE3]/70 border border-[#D6E4DC]'
                    }`}
                  >
                    <span>{g.label}</span>
                    {g.isExtinct && (
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        FOSİL
                      </span>
                    )}
                    {g.scientificName && !g.label.includes(g.scientificName) && (
                      <span className={`text-[10px] italic font-serif px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-white/20 text-white' : 'bg-white text-[#247A63] border border-[#D6E4DC]'
                      }`}>
                        {g.scientificName}
                      </span>
                    )}
                  </button>
                );
              })}

              {(displayGroups.length > visibleSubgroupCount || Boolean(subgroupMeta?.hasMore)) && (
                <>
                  <button
                    type="button"
                    disabled={isLoadingMoreSubgroups}
                    onClick={() => handleRevealMoreSubgroups(false)}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap bg-[#DDEFE3] hover:bg-[#8CCFB0]/60 text-[#1E332B] border border-[#8CCFB0] transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>
                      {isLoadingMoreSubgroups
                        ? 'Yükleniyor...'
                        : displayGroups.length > visibleSubgroupCount
                          ? `Daha Fazla (+${Math.min(16, displayGroups.length - visibleSubgroupCount)})`
                          : 'Daha Fazla Yükle (+)'}
                    </span>
                  </button>
                  {(displayGroups.length - visibleSubgroupCount > 16 || Boolean(subgroupMeta?.hasMore)) && (
                    <button
                      type="button"
                      disabled={isLoadingMoreSubgroups}
                      onClick={() => handleRevealMoreSubgroups(true)}
                      className="px-3.5 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap bg-[#F5F9F4] hover:bg-[#DDEFE3]/50 text-[#556B62] hover:text-[#1E332B] border border-[#D6E4DC] transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {isLoadingMoreSubgroups
                        ? 'Eksik Alt Gruplar Getiriliyor...'
                        : subgroupMeta?.hasMore
                          ? subgroupMeta.totalMatchedCount
                            ? `Tümünü Göster (~${subgroupMeta.totalMatchedCount.toLocaleString('tr-TR')})`
                            : `Tümünü Göster (${displayGroups.length}+)`
                          : `Tümünü Göster (${displayGroups.length})`}
                    </button>
                  )}
                </>
              )}
            </div>

            {(subgroupMeta?.hasMore || subgroupMeta?.hasError || subgroupMeta?.offsetLimitReached || hiddenExtinctSubgroupCount > 0) && (
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6E4716] bg-[#FDF6EC] border border-[#F3D9B5] rounded-xl px-3.5 py-2">
                <span>
                  {subgroupMeta?.hasError
                    ? `Alt grup listesi GBIF hatası nedeniyle eksik kaldı (${subgroupMeta.errorMessage || 'geçici sunucu hatası'}).`
                    : subgroupMeta?.offsetLimitReached
                      ? 'GBIF Backbone /v1/species/search 100.000 kayıt sınırına ulaşıldığı için sonraki alt gruplar listelenemedi.'
                      : subgroupMeta?.hasMore
                        ? `GBIF Backbone üzerinde devam eden alt gruplar bulunuyor (şu ana kadar ${groups.length} grup yüklendi; eksik olanları getirmek için "Tümünü Göster"i kullanabilirsiniz).`
                        : `${hiddenExtinctSubgroupCount} fosil/soyu tükenmiş alt grup katalogda korundu (görmek için "Fosil / Soyu Tükenmişleri de Göster" seçeneğini açabilirsiniz).`}
                </span>
                {subgroupMeta?.hasError && (
                  <button
                    type="button"
                    disabled={isLoadingMoreSubgroups}
                    onClick={() => handleRevealMoreSubgroups(false)}
                    className="px-2.5 py-1 rounded-lg bg-[#247A63] hover:bg-[#1D6350] text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    Tekrar Dene
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {isLoadingIntent ? (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-white rounded-3xl border border-[#D6E4DC] shadow-xs">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-[#DDEFE3] border-t-[#247A63] animate-spin" />
            <Compass className="w-8 h-8 text-[#247A63] absolute inset-0 m-auto" />
          </div>
          <h3 className="text-xl font-bold text-[#1E332B] mb-2">
            GBIF Backbone Dinamik Taksonomisi Taranıyor
          </h3>
          <p className="text-xs text-[#556B62] max-w-sm">
            "{searchQuery}" için Animalia üst taksonları doğrulanıyor ve alt gruplar listeleniyor...
          </p>
        </div>
      ) : errorMessage && !discoveryResult ? (
        <div
          className={`p-8 rounded-3xl border flex flex-col items-center justify-center text-center shadow-xs ${
            errorType === 'ERROR'
              ? 'bg-[#FDF6EC] border-[#F3D9B5]'
              : 'bg-rose-50 border-rose-200'
          }`}
        >
          <AlertCircle
            className={`w-12 h-12 mb-3 ${errorType === 'ERROR' ? 'text-amber-700' : 'text-rose-600'}`}
          />
          <h3
            className={`text-lg font-bold mb-1 ${
              errorType === 'ERROR' ? 'text-[#6E4716]' : 'text-rose-900'
            }`}
          >
            {errorType === 'ERROR' ? 'Veri Kaynağına Erişilemedi' : 'Sonuç Bulunamadı'}
          </h3>
          <p
            className={`text-sm max-w-md mb-6 ${
              errorType === 'ERROR' ? 'text-[#6E4716]/90' : 'text-rose-800'
            }`}
          >
            {errorMessage}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {errorType === 'ERROR' && (
              <button
                type="button"
                onClick={() => loadGroupIntent(searchQuery, currentCountry)}
                className="px-5 py-2.5 bg-[#247A63] hover:bg-[#1D6350] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Tekrar Dene
              </button>
            )}
            <button
              type="button"
              onClick={onBackToDefault}
              className={`px-5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                errorType === 'ERROR'
                  ? 'bg-white hover:bg-[#F5F9F4] text-[#1E332B] border border-[#D6E4DC]'
                  : 'bg-rose-700 hover:bg-rose-800 text-white'
              }`}
            >
              Ana Sayfaya Dön
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Status HUD / Info Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white px-6 py-4 rounded-2xl border border-[#D6E4DC] shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#ECF6FA] border border-[#B9DDEB] flex items-center justify-center text-[#1B6884] shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#1E332B]">
                  {activeGroupCandidate?.label || searchQuery}
                </h4>
                <p className="text-xs text-[#556B62]">
                  {discoveryResult?.dataQualityNotice || 'Doğrulanmış tür arşivi listeleniyor.'}
                </p>
              </div>
            </div>

            {/* Fossil Toggle */}
            <div className="flex items-center gap-2 text-xs font-medium text-[#1E332B] shrink-0">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFossil}
                  onChange={(e) => handleFossilToggle(e.target.checked)}
                  className="rounded border-[#8CCFB0] text-[#247A63] focus:ring-[#247A63] cursor-pointer"
                />
                <span>Fosil / Soyu Tükenmişleri de Göster</span>
              </label>
            </div>
          </div>

          {/* Species Cards Grid */}
          {isLoadingSpecies ? (
            <div className="py-20 flex flex-col items-center justify-center text-center bg-white rounded-3xl border border-[#D6E4DC]">
              <div className="w-8 h-8 border-3 border-[#DDEFE3] border-t-[#247A63] rounded-full animate-spin mb-3" />
              <p className="text-xs text-[#556B62]">Seçilen gruptaki türler yükleniyor...</p>
            </div>
          ) : discoveryResult?.species && discoveryResult.species.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {discoveryResult.species.map((item: DiscoveredSpeciesItem) => {
                const itemKey = item.acceptedUsageKey || item.usageKey;
                const isCheckingPhoto = Boolean(enrichingPhotoKeys[itemKey]);
                return (
                <div
                  key={itemKey}
                  onClick={() => onSelectSpecies(item.canonicalName, currentCountry, item.turkishName)}
                  className="group bg-white hover:bg-[#F9FCF8] rounded-2xl p-5 border border-[#D6E4DC] hover:border-[#8CCFB0] shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                >
                  <div>
                    {/* Thumbnail Image or Clean Visual Placeholder */}
                    {item.photoUrl && !failedPhotoUrls[item.photoUrl] ? (
                      <div className="w-full h-40 rounded-xl overflow-hidden mb-4 bg-[#F5F9F4] border border-[#E6EFEA] relative">
                        <img
                          src={item.photoUrl}
                          alt={item.turkishName || item.canonicalName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                          onError={() => markPhotoFailed(item)}
                        />
                        <div className="absolute top-2 left-2">
                          {getIucnBadge(item.iucnStatus)}
                        </div>
                        <div className="absolute top-2 right-2">
                          {getExistenceBadge(item.existenceStatus)}
                        </div>
                      </div>
                    ) : isCheckingPhoto ? (
                      <div className="w-full h-40 rounded-xl mb-4 bg-[#F5F9F4] border border-[#D6E4DC] relative flex flex-col items-center justify-center p-3 text-center">
                        <div className="absolute top-2 left-2">
                          {getIucnBadge(item.iucnStatus)}
                        </div>
                        <div className="absolute top-2 right-2">
                          {getExistenceBadge(item.existenceStatus)}
                        </div>
                        <div className="w-5 h-5 border-2 border-[#DDEFE3] border-t-[#247A63] rounded-full animate-spin mb-2 mt-4" />
                        <span className="text-[11px] font-medium text-[#556B62]">
                          Görsel kontrol ediliyor...
                        </span>
                      </div>
                    ) : (
                      <div className="w-full h-40 rounded-xl mb-4 bg-[#F5F9F4] border border-[#D6E4DC] relative flex flex-col items-center justify-center p-3 text-center">
                        <div className="absolute top-2 left-2">
                          {getIucnBadge(item.iucnStatus)}
                        </div>
                        <div className="absolute top-2 right-2">
                          {getExistenceBadge(item.existenceStatus)}
                        </div>
                        <ImageOff className="w-6 h-6 text-[#556B62]/45 mb-1.5 mt-4" />
                        <span className="text-[11px] font-medium text-[#556B62]">
                          Görsel kaydı bulunamadı
                        </span>
                      </div>
                    )}

                    {/* Names */}
                    <div className="mb-3">
                      <h3 className="text-base font-bold text-[#1E332B] group-hover:text-[#247A63] transition-colors line-clamp-1">
                        {item.turkishName || item.canonicalName}
                      </h3>
                      <p className="text-xs italic font-serif text-[#556B62]">
                        {item.scientificName}
                      </p>
                    </div>

                    {/* Evidence / Note */}
                    <p className="text-[11px] text-[#556B62] leading-relaxed line-clamp-2 mb-4">
                      {item.existenceEvidence || item.membershipEvidence || 'GBIF Backbone onaylı tür.'}
                    </p>
                  </div>

                  {/* Footer Stats & Action */}
                  <div className="pt-3 border-t border-[#E6EFEA] flex items-center justify-between gap-2 text-xs">
                    <div className="flex flex-col">
                      {item.gbifRecordStatus === 'ERROR' ? (
                        <>
                          <span className="font-semibold text-[11px] text-rose-700">
                            Veri alınamadı (GBIF)
                          </span>
                          {currentCountry === 'TR' && (
                            <span className="font-mono text-[10px] mt-0.5 text-[#556B62]">
                              {item.globalRecordStatus === 'ERROR'
                                ? 'Global: Veri alınamadı'
                                : typeof item.globalRecordCount === 'number'
                                  ? `Global: ${item.globalRecordCount.toLocaleString('tr-TR')} gözlem`
                                  : null}
                            </span>
                          )}
                        </>
                      ) : currentCountry === 'TR' ? (
                        item.gbifRecordCount === 0 ? (
                          <>
                            <span className="font-semibold text-[11px] text-[#9A631A]">
                              Türkiye'de GBIF gözlem kaydı yok
                            </span>
                            {item.globalRecordStatus === 'ERROR' ? (
                              <span className="font-mono text-[10px] text-rose-700 mt-0.5">
                                Global: Veri alınamadı
                              </span>
                            ) : typeof item.globalRecordCount === 'number' && (
                              <span className="font-mono text-[10px] text-[#556B62] mt-0.5">
                                Global: {item.globalRecordCount.toLocaleString('tr-TR')} gözlem
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="font-mono text-[11px] text-[#247A63] font-bold">
                              {item.gbifRecordCount.toLocaleString('tr-TR')} TR Gözlemi
                            </span>
                            {item.globalRecordStatus === 'ERROR' ? (
                              <span className="font-mono text-[10px] text-rose-700 mt-0.5">
                                Global: Veri alınamadı
                              </span>
                            ) : typeof item.globalRecordCount === 'number' && (
                              <span className="font-mono text-[10px] text-[#556B62] mt-0.5">
                                Global: {item.globalRecordCount.toLocaleString('tr-TR')} gözlem
                              </span>
                            )}
                          </>
                        )
                      ) : (
                        <span className={`font-mono text-[11px] font-bold ${item.gbifRecordCount === 0 ? 'text-[#9A631A] font-semibold font-sans' : 'text-[#247A63]'}`}>
                          {item.gbifRecordCount === 0
                            ? "GBIF'te gözlem kaydı yok"
                            : `${item.gbifRecordCount.toLocaleString('tr-TR')} Global Gözlem`}
                        </span>
                      )}
                    </div>

                    <span className="text-[#247A63] group-hover:text-[#1D6350] font-semibold flex items-center gap-1 shrink-0">
                      <span>Analiz Et</span>
                      <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
                );
              })}
            </div>
          ) : discoveryResult?.catalogErrorMessage ? (
            <div className="py-16 px-6 flex flex-col items-center justify-center text-center bg-[#FDF6EC] rounded-2xl border border-[#F3D9B5]">
              <AlertCircle className="w-10 h-10 text-amber-700 mb-3" />
              <h4 className="text-base font-bold text-[#6E4716] mb-1">
                Veri Kaynağına Erişilemedi
              </h4>
              <p className="text-xs text-[#6E4716]/90 max-w-md mb-4">
                {discoveryResult.catalogErrorMessage}
              </p>
              <button
                type="button"
                onClick={() => handlePageChange(currentPage)}
                className="px-4 py-2 bg-[#247A63] hover:bg-[#1D6350] text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Tekrar Dene
              </button>
            </div>
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-[#D6E4DC]">
              <HelpCircle className="w-10 h-10 text-[#247A63]/60 mb-3" />
              <h4 className="text-base font-bold text-[#1E332B] mb-1">Bu Grupta Tür Bulunamadı</h4>
              <p className="text-xs text-[#556B62] max-w-sm mb-4">
                Seçilen alt grup için {currentCountry === 'TR' ? 'Türkiye' : 'Global'} sınırları içinde doğrulanmış kayıt bulunamadı veya filtrelendi.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {currentCountry === 'TR' && (
                  <button
                    type="button"
                    onClick={() => handleCountryToggle('')}
                    className="px-4 py-2 bg-[#247A63] hover:bg-[#1D6350] text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Globe2 className="w-3.5 h-3.5" />
                    <span>Tüm Dünya (Global) Kayıtlarını Göster</span>
                  </button>
                )}
                {!includeFossil && (
                  <button
                    type="button"
                    onClick={() => handleFossilToggle(true)}
                    className="px-4 py-2 bg-[#DDEFE3] hover:bg-[#8CCFB0]/60 text-[#1E332B] border border-[#8CCFB0] rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Fosil Kayıtları Dahil Et
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Catalog Server / Request Error Notice (distinct from 100k offset limit) */}
          {discoveryResult?.catalogErrorMessage && discoveryResult.species.length > 0 && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{discoveryResult.catalogErrorMessage}</span>
            </div>
          )}

          {/* 100k Offset Limit Notice */}
          {discoveryResult?.offsetLimitReached && (
            <div className="p-3.5 rounded-xl bg-[#FDF6EC] border border-[#F3D9B5] text-xs text-[#6E4716] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-[#9A631A] shrink-0 mt-0.5" />
              <span>
                GBIF <code className="font-mono font-semibold text-[#59380D]">/v1/species/search</code> servisinin 100.000 kayıtlık sayfalama sınırına ulaşıldı. Şimdiye kadar getirilen kayıtlar korundu; daha derindeki türleri görmek için yukarıdaki alt gruplara bölerek taramayı daraltabilirsiniz.
              </span>
            </div>
          )}

          {/* Pagination Controls */}
          {discoveryResult?.pagination && discoveryResult.pagination.totalDiscovered > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-6 border-t border-[#D6E4DC] text-xs">
              <span className="text-[#556B62]">
                {typeof discoveryResult.pagination.filteredCatalogCount === 'number' ? (
                  <>
                    Filtrelenmiş katalogda toplam{' '}
                    <strong className="text-[#1E332B]">
                      {discoveryResult.pagination.filteredCatalogCount.toLocaleString('tr-TR')}
                    </strong>{' '}
                    tür (GBIF Backbone ham eşleşmesi:{' '}
                    {(discoveryResult.pagination.backboneMatchCount ?? discoveryResult.pagination.filteredCatalogCount).toLocaleString('tr-TR')}) · Bu sayfada{' '}
                    <strong className="text-[#247A63]">{discoveryResult.species.length}</strong> tür (Sayfa {currentPage}).
                  </>
                ) : (discoveryResult.pagination.backboneMatchCount ?? discoveryResult.pagination.backboneTotalCount ?? 0) > 0 ? (
                  <>
                    GBIF Backbone ham sorgu eşleşmesi:{' '}
                    <strong className="text-[#1E332B]">
                      ~{(discoveryResult.pagination.backboneMatchCount ?? discoveryResult.pagination.backboneTotalCount ?? 0).toLocaleString('tr-TR')}
                    </strong>{' '}
                    tür · Şu ana kadar doğrulanan havuz:{' '}
                    <strong className="text-[#247A63]">
                      {discoveryResult.pagination.totalDiscovered.toLocaleString('tr-TR')}
                    </strong>{' '}
                    (Bu sayfada {discoveryResult.species.length} tür, Sayfa {currentPage}).
                  </>
                ) : (
                  <>
                    Toplam <strong className="text-[#1E332B]">{discoveryResult.pagination.totalDiscovered.toLocaleString('tr-TR')}</strong> doğrulanmış tür keşfedildi (Sayfa {currentPage}).
                  </>
                )}
              </span>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={currentPage <= 1 || isLoadingSpecies}
                  onClick={() => handlePageChange(currentPage - 1)}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#DDEFE3]/60 disabled:opacity-40 text-[#1E332B] border border-[#D6E4DC] transition-colors cursor-pointer disabled:cursor-not-allowed font-medium"
                >
                  Önceki Sayfa
                </button>
                <span className="px-3 py-2 font-mono font-bold text-white bg-[#247A63] rounded-xl">
                  {currentPage}
                </span>
                <button
                  type="button"
                  disabled={!discoveryResult.pagination.hasMore || isLoadingSpecies}
                  onClick={() => handlePageChange(currentPage + 1)}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#DDEFE3]/60 disabled:opacity-40 text-[#1E332B] border border-[#D6E4DC] transition-colors cursor-pointer disabled:cursor-not-allowed font-medium"
                >
                  Sonraki Sayfa
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
