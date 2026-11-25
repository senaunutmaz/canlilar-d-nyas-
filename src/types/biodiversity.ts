/**
 * Canlı Atlası - Biyoçeşitlilik Veri Tipleri
 * GBIF API, iNaturalist ve IUCN veri yapıları
 */

export interface SpeciesInfo {
  usageKey?: number;
  scientificName: string;
  canonicalName: string;
  turkishName?: string;
  englishName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  classHierarchy?: string;
  order?: string;
  family?: string;
  genus?: string;
  rank?: string;
  taxonomicStatus?: string;
  matchType?: string;
  confidence?: number;
  synonymOf?: string;
  isMatched?: boolean;
  photoUrl?: string;
  photoAttribution?: string;
  photoSource?: string;
  iucnStatus?: 'EX' | 'EW' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC' | 'DD' | 'NE' | string;
  iucnCategoryName?: string;
  iucnSource?: string;
  iucnEvaluationDate?: string;
  iucnVerified?: boolean;
  summary?: string;
  inaturalistUrl?: string;
  gbifUrl?: string;
}

export interface GBIFOccurrence {
  key: number;
  scientificName: string;
  decimalLatitude?: number;
  decimalLongitude?: number;
  year?: number;
  month?: number;
  day?: number;
  eventDate?: string;
  country?: string;
  countryCode?: string;
  stateProvince?: string;
  locality?: string;
  basisOfRecord?: string;
  institutionCode?: string;
  collectionCode?: string;
  catalogNumber?: string;
  recordedBy?: string;
  datasetName?: string;
  license?: string;
  references?: string;
}

export interface YearlyStat {
  year: number;
  count: number;
}

export interface RegionStat {
  region: string;
  count: number;
  percentage: number;
}

export interface SpeciesAnalysis {
  species: SpeciesInfo;
  countryCode: string;
  countryName: string;
  totalRecords: number; // GBIF veritabanındaki toplam kayıt sayısı (Archive Count)
  downloadedRecordsCount: number; // İndirilen ve harita/detayda incelenen kayıt sayısı (Sample Count)
  mappedRecordsCount: number; // İndirilenler arasında geçerli ve doğrulanmış GPS koordinatlı olanlar
  unmappedRecordsCount: number; // İndirilenler arasında koordinatı olmayan veya (0,0) geçersiz olanlar
  unlocatedCount: number; // Arşivde il/bölge adı belirtilmemiş kayıt sayısı (faset kesilmediyse kesin)
  missingYearCount?: number | null; // Arşivde geçerli yıl bilgisi olmayan kayıt sayısı (null = faset kesilmesi nedeniyle izole edilemedi)
  invalidYearCount?: number; // Geçersiz / aralık dışı tarihli kayıt sayısı
  yearFacetCount?: number; // Yıllık fasetten alınan toplam geçerli kayıt sayısı
  isYearFacetTruncated?: boolean; // GBIF YEAR faseti limit nedeniyle kesildi mi
  isRegionFacetTruncated?: boolean; // GBIF STATE_PROVINCE faseti limit nedeniyle kesildi mi
  filteredRegionCodeCount?: number; // Kısa kod (Zh, Gr, Be vb.) veya geçersiz metin olduğu için il listesine alınmayan faset kayıtları
  regionFacetTotalCount?: number; // STATE_PROVINCE fasetinden dönen ham kayıt toplamı
  dateRange: {
    minYear: number | null;
    maxYear: number | null;
  };
  earliestYear?: {
    year: number;
    count: number;
  } | null;
  peakYear: {
    year: number;
    count: number;
  } | null;
  lowestYear: {
    year: number;
    count: number;
  } | null;
  yearlyStats: YearlyStat[];
  regionalStats: RegionStat[];
  occurrences: GBIFOccurrence[];
  appliedFilters?: {
    countryCode?: string;
    countryName?: string;
    startYear?: number;
    endYear?: number;
    taxonKey?: number;
  };
  isArchiveFacetCalculated: boolean;
  dataQualityNotice?: string;
  queriedAt: string;
}

export interface ResearchParameters {
  speciesName: string;
  scientificName: string;
  country: string;
  countryCode: string;
  startYear?: number;
  endYear?: number;
  dateRangeText: string;
  analysisType: string;
  geographicScope: string;
}

export interface FetchSpeciesOptions {
  countryCode?: string;
  startYear?: number;
  endYear?: number;
  limit?: number;
  fetchExtraPages?: boolean;
  preMatchedSpecies?: SpeciesInfo;
  preferredTurkishName?: string;
}

export interface DiscoverySpecimen {
  id: string;
  category: 'mammals' | 'birds' | 'reptiles' | 'marine' | 'amphibians' | 'endangered';
  turkishName: string;
  scientificName: string;
  family: string;
  iucnStatus: 'CR' | 'EN' | 'VU' | 'NT' | 'LC' | 'DD';
  iucnCategoryName: string;
  description: string;
  habitat: string;
  thumbnailPlaceholderColor?: string;
}

export type SearchResolutionMode =
  | 'SINGLE_SPECIES'
  | 'TAXON_GROUP_DISCOVERY'
  | 'NOT_FOUND';

export type SearchErrorType = 'NOT_FOUND' | 'ERROR';

export type SpeciesExistenceStatus =
  | 'LIVING'
  | 'FOSSIL_OR_EXTINCT'
  | 'HISTORICAL_OR_UNCERTAIN';

export type BiologicalMembershipStatus =
  | 'VERIFIED_MEMBER'
  | 'UNVERIFIED_MEMBERSHIP'
  | 'EXCLUDED';

export interface TaxonGroupCandidate {
  id: string;
  label: string;
  scientificName: string;
  usageKey?: number;
  acceptedUsageKey?: number;
  taxonKeys?: number[];
  rank: string;
  taxonomicStatus: string;
  kingdom: string;
  parentKey?: number;
  turkishName?: string;
  englishName?: string;
  description?: string;
  gbifRecordCount?: number;
  dataSource: string;
  matchType?: string;
  isVerified: boolean;
  excludedScientificNames?: string[];
  excludedOrderNames?: string[];
  excludedTaxonKeys?: number[];
  allowedCanonicalNames?: string[];
  mergedEquivalents?: Record<string, string>;
  genusBiologicalLabels?: Record<string, string>;
  allowDomestic?: boolean;
  membershipPolicyNote?: string;
  verificationWarning?: string;
  isParentOverview?: boolean;
  canDrillDown?: boolean;
  isExtinct?: boolean;
}

export interface SubgroupMemberCursor {
  memberKey: number;
  targetRank: string;
  nextOffset: number;
  endOfRecords: boolean;
  apiTotalCount: number | null;
  hitOffsetLimit: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export interface SubgroupPaginationMeta {
  parentGroup: TaxonGroupCandidate;
  hasMore: boolean;
  loadedCount: number;
  totalMatchedCount: number | null;
  offsetLimitReached: boolean;
  hasError: boolean;
  errorMessage?: string;
  cursors: SubgroupMemberCursor[];
}

export type OccurrenceCountStatus = 'OK' | 'ERROR';

export interface DiscoveredSpeciesItem {
  usageKey: number;
  acceptedUsageKey: number;
  canonicalName: string;
  scientificName: string;
  rank: string;
  taxonomicStatus: string;
  kingdom: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  parentKey?: number;
  turkishName?: string;
  englishName?: string;
  gbifRecordCount: number;
  gbifRecordStatus?: OccurrenceCountStatus;
  globalRecordCount?: number;
  globalRecordStatus?: OccurrenceCountStatus;
  isFossilOnly?: boolean;
  existenceStatus?: SpeciesExistenceStatus;
  existenceEvidence?: string;
  membershipStatus?: BiologicalMembershipStatus;
  membershipEvidence?: string;
  excludedSubspeciesNote?: string;
  isDomestic?: boolean;
  synonymOf?: string;
  photoUrl?: string;
  photoAttribution?: string;
  photoSource?: string;
  iucnStatus?: string;
  iucnCategoryName?: string;
  iucnSource?: string;
  iucnVerified?: boolean;
  inaturalistUrl?: string;
  gbifUrl: string;
  dataSource: string;
  matchType?: string;
  groupId?: string;
  groupLabel?: string;
}

export interface SpeciesDiscoveryPagination {
  page: number;
  pageSize: number;
  totalDiscovered: number;
  backboneTotalCount?: number;
  backboneMatchCount?: number;
  filteredCatalogCount?: number | null;
  offsetLimitReached?: boolean;
  serverErrorReached?: boolean;
  hasMore: boolean;
  facetOffset: number;
  nextFacetOffset: number | null;
}

export interface SpeciesDiscoveryResult {
  query: string;
  countryCode: string;
  countryName: string;
  groups: TaxonGroupCandidate[];
  activeGroupId?: string;
  species: DiscoveredSpeciesItem[];
  totalOccurrencesInScope: number | null;
  totalOccurrencesStatus?: OccurrenceCountStatus;
  totalOccurrencesError?: string;
  occurrenceEnrichmentStatus?: 'OK' | 'PARTIAL_ERROR' | 'ERROR';
  offsetLimitReached?: boolean;
  serverErrorReached?: boolean;
  catalogErrorMessage?: string;
  pagination: SpeciesDiscoveryPagination;
  uncertainOrHistoricalCount?: number;
  filteredFossilCount?: number;
  filteredOutOfGroupCount?: number;
  unresolvedGroups?: Array<{
    scientificName: string;
    reason: string;
  }>;
  dataQualityNotice?: string;
  queriedAt: string;
}

export interface SearchIntentResult {
  mode: SearchResolutionMode;
  query: string;
  countryCode: string;
  matchedSpecies?: SpeciesInfo;
  groups?: TaxonGroupCandidate[];
  activeGroupId?: string;
  subgroupPagination?: SubgroupPaginationMeta;
  discovery?: SpeciesDiscoveryResult;
  unresolvedGroups?: Array<{
    scientificName: string;
    reason: string;
  }>;
  reason?: string;
}

