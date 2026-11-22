import React, { useState, useEffect, useRef } from 'react';
import { 
  resolveSearchIntent, 
  discoverSpeciesByGroup,
  expandTaxonCandidateToSubgroups,
  enrichSubgroupLabels
} from '../services/gbif';
import { 
  TaxonGroupCandidate, 
  DiscoveredSpeciesItem, 
  SpeciesDiscoveryResult 
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
  onSelectSpecies: (scientificName: string, country: string) => void;
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

  const [groups, setGroups] = useState<TaxonGroupCandidate[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string>('');
  const [discoveryResult, setDiscoveryResult] = useState<SpeciesDiscoveryResult | null>(null);
  const [drillStack, setDrillStack] = useState<Array<{ label: string; groups: TaxonGroupCandidate[]; activeGroupId: string }>>([]);
  const [isDrillingDown, setIsDrillingDown] = useState<boolean>(false);
  
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [includeFossil, setIncludeFossil] = useState<boolean>(false);
  const [currentCountry, setCurrentCountry] = useState<string>(countryCode);
  const [visibleSubgroupCount, setVisibleSubgroupCount] = useState<number>(16);
  const [isLoadingMoreSubgroups, setIsLoadingMoreSubgroups] = useState<boolean>(false);

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
    setDiscoveryResult(null);
    setVisibleSubgroupCount(16);
    try {
      const intent = await resolveSearchIntent(query, cc);
      if (seq !== requestSeqRef.current) return;

      if (intent.mode === 'TAXON_GROUP_DISCOVERY' && intent.groups && intent.groups.length > 0) {
        setGroups(intent.groups);
        const firstId = intent.activeGroupId || intent.groups[0].id;
        setActiveGroupId(firstId);
        await loadSpeciesForGroup(intent.groups, firstId, cc, 1, includeFossil, seq);
      } else if (intent.mode === 'SINGLE_SPECIES' && intent.matchedSpecies?.scientificName) {
        setIsLoadingIntent(false);
        onSelectSpecies(intent.matchedSpecies.canonicalName || intent.matchedSpecies.scientificName, cc);
      } else {
        setGroups([]);
        setDiscoveryResult(null);
        setErrorMessage(intent.reason || `"${query}" araması için Animalia alemi içinde doğrulanmış bir taksonomik grup bulunamadı.`);
        setIsLoadingIntent(false);
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('Taxon intent error:', err);
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
    try {
      const res = await discoverSpeciesByGroup(targetGroups, {
        countryCode: cc,
        groupId: gid,
        page,
        pageSize: 16,
        includeFossilOnly: fossil,
        enrichWithInaturalist: true,
        groups: targetGroups,
      });
      if (seq !== requestSeqRef.current) return;
      setDiscoveryResult(res);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('Species discovery load error:', err);
      setErrorMessage('Tür keşif listesi yüklenirken bir hata oluştu.');
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoadingIntent(false);
        setIsLoadingSpecies(false);
      }
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
      const nextGroups = await expandTaxonCandidateToSubgroups(group, currentCountry);
      if (seq !== requestSeqRef.current) return;
      if (nextGroups.length > 1) {
        setDrillStack((prev) => [
          ...prev,
          { label: prev.length === 0 ? searchQuery : (groups[0]?.label || searchQuery), groups, activeGroupId },
        ]);
        subgroupSeqRef.current++;
        setGroups(nextGroups);
        setVisibleSubgroupCount(16);
        const firstId = nextGroups[0].id;
        setActiveGroupId(firstId);
        await loadSpeciesForGroup(nextGroups, firstId, currentCountry, 1, includeFossil, seq);
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
    setVisibleSubgroupCount(16);
    setActiveGroupId(target.activeGroupId);
    loadSpeciesForGroup(target.groups, target.activeGroupId, currentCountry, 1, includeFossil);
  };

  const handleRevealMoreSubgroups = async (showAll = false) => {
    if (isLoadingMoreSubgroups || visibleSubgroupCount >= groups.length) return;
    const startIdx = visibleSubgroupCount;
    const nextCount = showAll ? groups.length : Math.min(groups.length, visibleSubgroupCount + 16);
    setVisibleSubgroupCount(nextCount);

    const subSeq = ++subgroupSeqRef.current;
    setIsLoadingMoreSubgroups(true);
    try {
      const batchSize = Math.min(24, nextCount - startIdx);
      const enriched = await enrichSubgroupLabels(groups, startIdx, batchSize);
      if (subSeq === subgroupSeqRef.current) {
        setGroups(enriched);
      }
    } catch (err) {
      console.warn('Subgroup label enrichment warning:', err);
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
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-600/50 text-emerald-300">YAŞAYAN (LIVING)</span>;
      case 'FOSSIL_OR_EXTINCT':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 border border-rose-600/50 text-rose-300">FOSİL / SOYU TÜKENMİŞ</span>;
      case 'HISTORICAL_OR_UNCERTAIN':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 border border-amber-600/50 text-amber-300">TARİHSEL / BELİRSİZ</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900 border border-slate-700 text-slate-300">DOĞRULANMIŞ</span>;
    }
  };

  const getIucnBadge = (status?: string) => {
    if (!status || status === 'NE') return null;
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900 border border-slate-700 text-emerald-200">
        IUCN: {status}
      </span>
    );
  };

  const activeGroupCandidate = groups.find(g => g.id === activeGroupId) || groups[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fadeIn">
      {/* Explorer Header Header */}
      <div className="bg-[#111e17] rounded-3xl p-6 sm:p-8 border border-emerald-800/50 shadow-2xl mb-8 relative overflow-hidden">
        <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-2 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-800/40">
              <Compass className="w-3.5 h-3.5" />
              <span>GBIF Dinamik Taksonomik Keşif Sistemi</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              "{searchQuery}" — Canlı Grubu Keşfi
            </h1>
            <p className="text-sm text-emerald-100/75 mt-2 max-w-2xl leading-relaxed">
              Animalia alemi için GBIF Backbone üzerinden doğrulanan alt gruplar ve kabul edilmiş tür kataloğu (gözlem kapsamından bağımsız). Türkiye veya Global görünümünü değiştirerek gözlem sayılarını karşılaştırabilir, herhangi bir türe tıklayarak analiz sayfasını açabilirsiniz.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Country Selector Toggle */}
            <div className="flex items-center gap-1.5 p-1 bg-[#0b1510] rounded-xl border border-emerald-800/60">
              <button
                type="button"
                onClick={() => handleCountryToggle('TR')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  currentCountry === 'TR'
                    ? 'bg-emerald-500 text-[#0b1510] shadow-md'
                    : 'text-emerald-200/70 hover:text-white'
                }`}
              >
                Türkiye (TR)
              </button>
              <button
                type="button"
                onClick={() => handleCountryToggle('')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  currentCountry === ''
                    ? 'bg-emerald-500 text-[#0b1510] shadow-md'
                    : 'text-emerald-200/70 hover:text-white'
                }`}
              >
                Tüm Dünya (Global)
              </button>
            </div>

            <button
              type="button"
              onClick={onBackToDefault}
              className="px-4 py-2.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 rounded-xl text-xs font-semibold border border-emerald-800/60 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>Keşften Çık</span>
            </button>
          </div>
        </div>

        {/* Subgroups Navigation Tabs */}
        {groups.length > 0 && (
          <div className="mt-8 pt-6 border-t border-emerald-900/60">
            {drillStack.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs mb-4 bg-[#0b1510]/80 px-3.5 py-2 rounded-xl border border-emerald-800/40">
                <span className="text-emerald-400/80 font-mono uppercase text-[10px] mr-1">Hiyerarşi:</span>
                {drillStack.map((crumb, idx) => (
                  <React.Fragment key={`${crumb.activeGroupId}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => handleDrillBreadcrumbBack(idx)}
                      className="text-emerald-300 hover:text-white underline underline-offset-2 font-medium cursor-pointer"
                    >
                      {crumb.label}
                    </button>
                    <ChevronRight className="w-3.5 h-3.5 text-emerald-600" />
                  </React.Fragment>
                ))}
                <span className="text-white font-semibold">{groups[0]?.scientificName || activeGroupCandidate?.scientificName}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300/80">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>Doğrulanmış Alt Gruplar ({groups.length}):</span>
              </div>

              {activeGroupCandidate?.canDrillDown && !activeGroupCandidate?.isParentOverview && (
                <button
                  type="button"
                  disabled={isDrillingDown || isLoadingSpecies}
                  onClick={() => handleDrillDownSubgroup(activeGroupCandidate)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-950/90 hover:bg-emerald-800/70 disabled:opacity-50 text-emerald-200 hover:text-white border border-emerald-700/60 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{isDrillingDown ? 'Alt Gruplar Yükleniyor...' : 'Bu Alt Grubu Daha Detaylı Böl'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-none">
              {groups.slice(0, visibleSubgroupCount).map((g) => {
                const isActive = g.id === activeGroupId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => handleSubgroupChange(g.id)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-2 cursor-pointer ${
                      isActive
                        ? 'bg-emerald-500 text-[#0b1510] shadow-lg shadow-emerald-500/20 font-bold'
                        : 'bg-[#0b1510] text-emerald-200/80 hover:text-white hover:bg-[#13241b] border border-emerald-800/60'
                    }`}
                  >
                    <span>{g.label}</span>
                    {g.scientificName && !g.label.includes(g.scientificName) && (
                      <span className={`text-[10px] italic font-serif px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-[#0b1510]/20 text-[#0b1510]' : 'bg-emerald-950 text-emerald-400'
                      }`}>
                        {g.scientificName}
                      </span>
                    )}
                  </button>
                );
              })}

              {groups.length > visibleSubgroupCount && (
                <>
                  <button
                    type="button"
                    disabled={isLoadingMoreSubgroups}
                    onClick={() => handleRevealMoreSubgroups(false)}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Daha Fazla (+{Math.min(16, groups.length - visibleSubgroupCount)})</span>
                  </button>
                  {groups.length - visibleSubgroupCount > 16 && (
                    <button
                      type="button"
                      disabled={isLoadingMoreSubgroups}
                      onClick={() => handleRevealMoreSubgroups(true)}
                      className="px-3.5 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap bg-[#0b1510] hover:bg-[#13241b] text-emerald-300/80 hover:text-white border border-emerald-800/60 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      Tümünü Göster ({groups.length})
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {isLoadingIntent ? (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-[#111e17]/50 rounded-3xl border border-emerald-900/40">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-900/60 border-t-emerald-400 animate-spin" />
            <Compass className="w-8 h-8 text-emerald-400 absolute inset-0 m-auto" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">
            GBIF Backbone Dinamik Taksonomisi Taranıyor
          </h3>
          <p className="text-xs text-emerald-300/70 max-w-sm">
            "{searchQuery}" için Animalia üst taksonları doğrulanıyor ve alt gruplar listeleniyor...
          </p>
        </div>
      ) : errorMessage && !discoveryResult ? (
        <div className="p-8 rounded-3xl bg-rose-950/40 border border-rose-700/50 flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-12 h-12 text-rose-400 mb-3" />
          <h3 className="text-lg font-bold text-rose-200 mb-1">Grup Keşif Hatası</h3>
          <p className="text-sm text-rose-200/90 max-w-md mb-6">{errorMessage}</p>
          <button
            type="button"
            onClick={onBackToDefault}
            className="px-5 py-2.5 bg-rose-900/60 hover:bg-rose-800 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Ana Sayfaya Dön
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Status HUD / Info Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#111e17] px-6 py-4 rounded-2xl border border-emerald-900/60">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-white">
                  {activeGroupCandidate?.label || searchQuery}
                </h4>
                <p className="text-xs text-emerald-300/70">
                  {discoveryResult?.dataQualityNotice || 'Doğrulanmış tür arşivi listeleniyor.'}
                </p>
              </div>
            </div>

            {/* Fossil Toggle */}
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-200 shrink-0">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFossil}
                  onChange={(e) => handleFossilToggle(e.target.checked)}
                  className="rounded bg-[#0b1510] border-emerald-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <span>Fosil / Soyu Tükenmişleri de Göster</span>
              </label>
            </div>
          </div>

          {/* Species Cards Grid */}
          {isLoadingSpecies ? (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <div className="w-8 h-8 border-3 border-emerald-900 border-t-emerald-400 rounded-full animate-spin mb-3" />
              <p className="text-xs text-emerald-300/70">Seçilen gruptaki türler yükleniyor...</p>
            </div>
          ) : discoveryResult?.species && discoveryResult.species.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {discoveryResult.species.map((item: DiscoveredSpeciesItem) => (
                <div
                  key={item.acceptedUsageKey || item.usageKey}
                  onClick={() => onSelectSpecies(item.canonicalName, currentCountry)}
                  className="group bg-[#111e17] hover:bg-[#13241b] rounded-2xl p-5 border border-emerald-900/60 hover:border-emerald-600/60 shadow-lg transition-all duration-300 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                >
                  <div>
                    {/* Thumbnail Image or Clean Visual Placeholder */}
                    {item.photoUrl ? (
                      <div className="w-full h-36 rounded-xl overflow-hidden mb-4 bg-emerald-950/40 relative">
                        <img
                          src={item.photoUrl}
                          alt={item.canonicalName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#111e17] via-transparent to-transparent opacity-80" />
                        <div className="absolute top-2 left-2">
                          {getIucnBadge(item.iucnStatus)}
                        </div>
                        <div className="absolute top-2 right-2">
                          {getExistenceBadge(item.existenceStatus)}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-36 rounded-xl mb-4 bg-[#0b1510]/85 border border-emerald-900/50 relative flex flex-col items-center justify-center p-3 text-center">
                        <div className="absolute top-2 left-2">
                          {getIucnBadge(item.iucnStatus)}
                        </div>
                        <div className="absolute top-2 right-2">
                          {getExistenceBadge(item.existenceStatus)}
                        </div>
                        <ImageOff className="w-6 h-6 text-emerald-500/45 mb-1.5 mt-4" />
                        <span className="text-[11px] font-medium text-emerald-200/55">
                          Görsel kaydı bulunamadı
                        </span>
                      </div>
                    )}

                    {/* Names */}
                    <div className="mb-3">
                      <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors line-clamp-1">
                        {item.turkishName || item.canonicalName}
                      </h3>
                      <p className="text-xs italic font-serif text-emerald-300/80">
                        {item.scientificName}
                      </p>
                    </div>

                    {/* Evidence / Note */}
                    <p className="text-[11px] text-emerald-100/70 leading-relaxed line-clamp-2 mb-4">
                      {item.existenceEvidence || item.membershipEvidence || 'GBIF Backbone onaylı tür.'}
                    </p>
                  </div>

                  {/* Footer Stats & Action */}
                  <div className="pt-3 border-t border-emerald-900/40 flex items-center justify-between gap-2 text-xs">
                    <div className="flex flex-col">
                      {item.gbifRecordStatus === 'ERROR' ? (
                        <>
                          <span className="font-semibold text-[11px] text-rose-300/90">
                            Veri alınamadı (GBIF)
                          </span>
                          {currentCountry === 'TR' && (
                            <span className="font-mono text-[10px] mt-0.5 text-emerald-300/70">
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
                            <span className="font-semibold text-[11px] text-amber-300/90">
                              Türkiye'de GBIF gözlem kaydı yok
                            </span>
                            {item.globalRecordStatus === 'ERROR' ? (
                              <span className="font-mono text-[10px] text-rose-300/80 mt-0.5">
                                Global: Veri alınamadı
                              </span>
                            ) : typeof item.globalRecordCount === 'number' && (
                              <span className="font-mono text-[10px] text-emerald-300/75 mt-0.5">
                                Global: {item.globalRecordCount.toLocaleString('tr-TR')} gözlem
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="font-mono text-[11px] text-emerald-400 font-bold">
                              {item.gbifRecordCount.toLocaleString('tr-TR')} TR Gözlemi
                            </span>
                            {item.globalRecordStatus === 'ERROR' ? (
                              <span className="font-mono text-[10px] text-rose-300/80 mt-0.5">
                                Global: Veri alınamadı
                              </span>
                            ) : typeof item.globalRecordCount === 'number' && (
                              <span className="font-mono text-[10px] text-emerald-300/70 mt-0.5">
                                Global: {item.globalRecordCount.toLocaleString('tr-TR')} gözlem
                              </span>
                            )}
                          </>
                        )
                      ) : (
                        <span className={`font-mono text-[11px] font-bold ${item.gbifRecordCount === 0 ? 'text-amber-300/90 font-semibold font-sans' : 'text-emerald-400'}`}>
                          {item.gbifRecordCount === 0
                            ? "GBIF'te gözlem kaydı yok"
                            : `${item.gbifRecordCount.toLocaleString('tr-TR')} Global Gözlem`}
                        </span>
                      )}
                    </div>

                    <span className="text-emerald-400 group-hover:text-white font-medium flex items-center gap-1 shrink-0">
                      <span>Analiz Et</span>
                      <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-center bg-[#111e17]/40 rounded-2xl border border-emerald-900/40">
              <HelpCircle className="w-10 h-10 text-emerald-400/60 mb-3" />
              <h4 className="text-base font-bold text-white mb-1">Bu Grupta Tür Bulunamadı</h4>
              <p className="text-xs text-emerald-300/70 max-w-sm mb-4">
                Seçilen alt grup için {currentCountry === 'TR' ? 'Türkiye' : 'Global'} sınırları içinde doğrulanmış kayıt bulunamadı veya filtrelendi.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {currentCountry === 'TR' && (
                  <button
                    type="button"
                    onClick={() => handleCountryToggle('')}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0b1510] rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Globe2 className="w-3.5 h-3.5" />
                    <span>Tüm Dünya (Global) Kayıtlarını Göster</span>
                  </button>
                )}
                {!includeFossil && (
                  <button
                    type="button"
                    onClick={() => handleFossilToggle(true)}
                    className="px-4 py-2 bg-emerald-800 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Fosil Kayıtları Dahil Et
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 100k Offset Limit Notice */}
          {discoveryResult?.offsetLimitReached && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-700/50 text-xs text-amber-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                GBIF <code className="font-mono text-amber-300">/v1/species/search</code> servisinin 100.000 kayıtlık sayfalama sınırına ulaşıldı. Şimdiye kadar getirilen kayıtlar korundu; daha derindeki türleri görmek için yukarıdaki alt gruplara bölerek taramayı daraltabilirsiniz.
              </span>
            </div>
          )}

          {/* Pagination Controls */}
          {discoveryResult?.pagination && discoveryResult.pagination.totalDiscovered > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-6 border-t border-emerald-900/60 text-xs">
              <span className="text-emerald-300/75">
                {typeof discoveryResult.pagination.filteredCatalogCount === 'number' ? (
                  <>
                    Filtrelenmiş katalogda toplam{' '}
                    <strong className="text-white">
                      {discoveryResult.pagination.filteredCatalogCount.toLocaleString('tr-TR')}
                    </strong>{' '}
                    tür (GBIF Backbone ham eşleşmesi:{' '}
                    {(discoveryResult.pagination.backboneMatchCount ?? discoveryResult.pagination.filteredCatalogCount).toLocaleString('tr-TR')}) · Bu sayfada{' '}
                    <strong className="text-emerald-300">{discoveryResult.species.length}</strong> tür (Sayfa {currentPage}).
                  </>
                ) : (discoveryResult.pagination.backboneMatchCount ?? discoveryResult.pagination.backboneTotalCount ?? 0) > 0 ? (
                  <>
                    GBIF Backbone ham sorgu eşleşmesi:{' '}
                    <strong className="text-white">
                      ~{(discoveryResult.pagination.backboneMatchCount ?? discoveryResult.pagination.backboneTotalCount ?? 0).toLocaleString('tr-TR')}
                    </strong>{' '}
                    tür · Şu ana kadar doğrulanan havuz:{' '}
                    <strong className="text-emerald-300">
                      {discoveryResult.pagination.totalDiscovered.toLocaleString('tr-TR')}
                    </strong>{' '}
                    (Bu sayfada {discoveryResult.species.length} tür, Sayfa {currentPage}).
                  </>
                ) : (
                  <>
                    Toplam <strong className="text-white">{discoveryResult.pagination.totalDiscovered.toLocaleString('tr-TR')}</strong> doğrulanmış tür keşfedildi (Sayfa {currentPage}).
                  </>
                )}
              </span>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={currentPage <= 1 || isLoadingSpecies}
                  onClick={() => handlePageChange(currentPage - 1)}
                  className="px-3.5 py-2 rounded-xl bg-[#111e17] hover:bg-[#13241b] disabled:opacity-40 text-emerald-200 border border-emerald-800/60 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  Önceki Sayfa
                </button>
                <span className="px-3 py-2 font-mono font-bold text-white bg-emerald-950/60 rounded-xl border border-emerald-800/40">
                  {currentPage}
                </span>
                <button
                  type="button"
                  disabled={!discoveryResult.pagination.hasMore || isLoadingSpecies}
                  onClick={() => handlePageChange(currentPage + 1)}
                  className="px-3.5 py-2 rounded-xl bg-[#111e17] hover:bg-[#13241b] disabled:opacity-40 text-emerald-200 border border-emerald-800/60 transition-colors cursor-pointer disabled:cursor-not-allowed"
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
