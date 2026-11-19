/**
 * Canlı Atlası - GBIF ve iNaturalist Veri Servisi
 * Gerçek açık veri kaynakları üzerinden biyoçeşitlilik gözlem ve tür bilgisi çekme modülü.
 */

import { 
  DiscoverySpecimen, 
  GBIFOccurrence, 
  RegionStat, 
  SpeciesAnalysis, 
  SpeciesInfo, 
  YearlyStat,
  ResearchParameters,
  FetchSpeciesOptions,
  SearchResolutionMode,
  TaxonGroupCandidate,
  DiscoveredSpeciesItem,
  SpeciesDiscoveryResult,
  SearchIntentResult,
  SpeciesExistenceStatus,
  BiologicalMembershipStatus
} from '../types/biodiversity';

// In-Memory TTL Önbellek Sistemi (GBIF ve iNaturalist verilerini 15 dakika boyunca saklar)
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const GBIF_CACHE = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 dakika

export function getCached<T>(key: string): T | null {
  const entry = GBIF_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    GBIF_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached<T>(key: string, data: T, ttlMs = CACHE_TTL_MS): void {
  // Bellek şişmesini önlemek için en fazla 1000 kayıt tut
  if (GBIF_CACHE.size > 1000) {
    const oldestKey = GBIF_CACHE.keys().next().value;
    if (oldestKey) GBIF_CACHE.delete(oldestKey);
  }
  GBIF_CACHE.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Zaman aşımı (Timeout) ve otomatik yeniden deneme (Retry) mekanizmalı fetch sarmalayıcısı
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  maxRetries = 2,
  timeoutMs = 8000
): Promise<Response> {
  let attempt = 0;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok && (response.status === 429 || response.status >= 500) && attempt < Math.max(maxRetries, response.status === 429 ? 3 : maxRetries)) {
        attempt++;
        const retryAfterRaw = response.headers?.get?.('Retry-After');
        const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
        const waitMs =
          response.status === 429
            ? (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.min(8000, retryAfterSec * 1000) : 900 * attempt)
            : 350 * attempt;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;
      if (attempt < maxRetries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 350 * attempt));
      } else {
        break;
      }
    }
  }

  throw lastError || new Error(`Ağ isteği başarısız: ${url}`);
}

export const GBIF_BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

export interface CommonSpeciesEntry {
  scientificName: string;
  turkishName: string;
  englishName?: string;
  iucn?: string;
  category: string;
  alternatives?: Array<{ scientificName: string; turkishName: string }>;
}

// Yaygın Türkçe canlı isimleri ve bilimsel ad eşleşmeleri (geriye dönük uyumlu)
export const COMMON_TURKISH_SPECIES: Record<string, { scientificName: string; turkishName: string; iucn: string; category: string }> = {
  'bozayı': { scientificName: 'Ursus arctos', turkishName: 'Bozayı', iucn: 'LC', category: 'Memeliler' },
  'boz ayı': { scientificName: 'Ursus arctos', turkishName: 'Bozayı', iucn: 'LC', category: 'Memeliler' },
  'ayı': { scientificName: 'Ursus arctos', turkishName: 'Bozayı', iucn: 'LC', category: 'Memeliler' },
  'vaşak': { scientificName: 'Lynx lynx', turkishName: 'Bayağı Vaşak', iucn: 'LC', category: 'Memeliler' },
  'bayağı vaşak': { scientificName: 'Lynx lynx', turkishName: 'Bayağı Vaşak', iucn: 'LC', category: 'Memeliler' },
  'kurt': { scientificName: 'Canis lupus', turkishName: 'Bozkurt', iucn: 'LC', category: 'Memeliler' },
  'bozkurt': { scientificName: 'Canis lupus', turkishName: 'Bozkurt', iucn: 'LC', category: 'Memeliler' },
  'yaban kedisi': { scientificName: 'Felis silvestris', turkishName: 'Yaban Kedisi', iucn: 'LC', category: 'Memeliler' },
  'akdeniz foku': { scientificName: 'Monachus monachus', turkishName: 'Akdeniz Foku', iucn: 'EN', category: 'Deniz Canlıları' },
  'deniz foku': { scientificName: 'Monachus monachus', turkishName: 'Akdeniz Foku', iucn: 'EN', category: 'Deniz Canlıları' },
  'fok': { scientificName: 'Monachus monachus', turkishName: 'Akdeniz Foku', iucn: 'EN', category: 'Deniz Canlıları' },
  'çizgili sırtlan': { scientificName: 'Hyaena hyaena', turkishName: 'Çizgili Sırtlan', iucn: 'NT', category: 'Memeliler' },
  'sırtlan': { scientificName: 'Hyaena hyaena', turkishName: 'Çizgili Sırtlan', iucn: 'NT', category: 'Memeliler' },
  'caretta caretta': { scientificName: 'Caretta caretta', turkishName: 'İribaş Deniz Kaplumbağası', iucn: 'VU', category: 'Sürüngenler' },
  'caretta': { scientificName: 'Caretta caretta', turkishName: 'İribaş Deniz Kaplumbağası', iucn: 'VU', category: 'Sürüngenler' },
  'deniz kaplumbağası': { scientificName: 'Caretta caretta', turkishName: 'İribaş Deniz Kaplumbağası', iucn: 'VU', category: 'Sürüngenler' },
  'iribaş deniz kaplumbağası': { scientificName: 'Caretta caretta', turkishName: 'İribaş Deniz Kaplumbağası', iucn: 'VU', category: 'Sürüngenler' },
  'yeşil deniz kaplumbağası': { scientificName: 'Chelonia mydas', turkishName: 'Yeşil Deniz Kaplumbağası', iucn: 'EN', category: 'Sürüngenler' },
  'kelaynak': { scientificName: 'Geronticus eremita', turkishName: 'Kelaynak', iucn: 'EN', category: 'Kuşlar' },
  'kaya kartalı': { scientificName: 'Aquila chrysaetos', turkishName: 'Kaya Kartalı', iucn: 'LC', category: 'Kuşlar' },
  'kartal': { scientificName: 'Aquila chrysaetos', turkishName: 'Kaya Kartalı', iucn: 'LC', category: 'Kuşlar' },
  'şah kartal': { scientificName: 'Aquila heliaca', turkishName: 'Şah Kartal', iucn: 'VU', category: 'Kuşlar' },
  'toy': { scientificName: 'Otis tarda', turkishName: 'Toy Kuşu', iucn: 'VU', category: 'Kuşlar' },
  'toy kuşu': { scientificName: 'Otis tarda', turkishName: 'Toy Kuşu', iucn: 'VU', category: 'Kuşlar' },
  'kafkas engereği': { scientificName: 'Vipera kaznakovi', turkishName: 'Kafkas Burunlu Engereği', iucn: 'EN', category: 'Sürüngenler' },
  'toros kurbağası': { scientificName: 'Rana holtzi', turkishName: 'Toros Kurbağası', iucn: 'CR', category: 'Amfibiler' },
  'kafkas semenderi': { scientificName: 'Mertensiella caucasica', turkishName: 'Kafkas Semenderi', iucn: 'VU', category: 'Amfibiler' },
  'şişeburunlu yunus': { scientificName: 'Tursiops truncatus', turkishName: 'Afalina (Şişeburunlu Yunus)', iucn: 'LC', category: 'Deniz Canlıları' },
  'afalina': { scientificName: 'Tursiops truncatus', turkishName: 'Afalina (Şişeburunlu Yunus)', iucn: 'LC', category: 'Deniz Canlıları' },
  'yunus': { scientificName: 'Tursiops truncatus', turkishName: 'Afalina (Şişeburunlu Yunus)', iucn: 'LC', category: 'Deniz Canlıları' },
  'aslan': { scientificName: 'Panthera leo', turkishName: 'Aslan', iucn: 'VU', category: 'Memeliler' },
  'leopar': { scientificName: 'Panthera pardus', turkishName: 'Anadolu Leoparı', iucn: 'VU', category: 'Memeliler' },
  'anadolu leoparı': { scientificName: 'Panthera pardus', turkishName: 'Anadolu Leoparı', iucn: 'VU', category: 'Memeliler' },
  'anadolu parsı': { scientificName: 'Panthera pardus', turkishName: 'Anadolu Leoparı', iucn: 'VU', category: 'Memeliler' },
  'kaplan': { scientificName: 'Panthera tigris', turkishName: 'Kaplan', iucn: 'EN', category: 'Memeliler' },
  'tilki': { scientificName: 'Vulpes vulpes', turkishName: 'Kızıl Tilki', iucn: 'LC', category: 'Memeliler' },
  'kızıl tilki': { scientificName: 'Vulpes vulpes', turkishName: 'Kızıl Tilki', iucn: 'LC', category: 'Memeliler' },
  'geyik': { scientificName: 'Cervus elaphus', turkishName: 'Kızıl Geyik', iucn: 'LC', category: 'Memeliler' },
  'kızıl geyik': { scientificName: 'Cervus elaphus', turkishName: 'Kızıl Geyik', iucn: 'LC', category: 'Memeliler' },
  'karaca': { scientificName: 'Capreolus capreolus', turkishName: 'Karaca', iucn: 'LC', category: 'Memeliler' },
  'alageyik': { scientificName: 'Dama dama', turkishName: 'Alageyik', iucn: 'LC', category: 'Memeliler' },
  'su samuru': { scientificName: 'Lutra lutra', turkishName: 'Avrasya Su Samuru', iucn: 'NT', category: 'Memeliler' },
  'samur': { scientificName: 'Lutra lutra', turkishName: 'Avrasya Su Samuru', iucn: 'NT', category: 'Memeliler' },
  'sincap': { scientificName: 'Sciurus vulgaris', turkishName: 'Kızıl Sincap', iucn: 'LC', category: 'Memeliler' },
  'kızıl sincap': { scientificName: 'Sciurus vulgaris', turkishName: 'Kızıl Sincap', iucn: 'LC', category: 'Memeliler' },
  'flamingo': { scientificName: 'Phoenicopterus roseus', turkishName: 'Büyük Flamingo', iucn: 'LC', category: 'Kuşlar' },
  'büyük flamingo': { scientificName: 'Phoenicopterus roseus', turkishName: 'Büyük Flamingo', iucn: 'LC', category: 'Kuşlar' },
  'panda': { scientificName: 'Ailuropoda melanoleuca', turkishName: 'Dev Panda', iucn: 'VU', category: 'Memeliler' },
  'dev panda': { scientificName: 'Ailuropoda melanoleuca', turkishName: 'Dev Panda', iucn: 'VU', category: 'Memeliler' },
  'kızıl panda': { scientificName: 'Ailurus fulgens', turkishName: 'Kızıl Panda', iucn: 'EN', category: 'Memeliler' },
  'kirpi': { scientificName: 'Erinaceus concolor', turkishName: 'Doğu Avrupa Kirpisi', iucn: 'LC', category: 'Memeliler' },
  'leylek': { scientificName: 'Ciconia ciconia', turkishName: 'Ak Leylek', iucn: 'LC', category: 'Kuşlar' },
  'çita': { scientificName: 'Acinonyx jubatus', turkishName: 'Çita', iucn: 'VU', category: 'Memeliler' },
  'jaguar': { scientificName: 'Panthera onca', turkishName: 'Jaguar', iucn: 'NT', category: 'Memeliler' },
  'puma': { scientificName: 'Puma concolor', turkishName: 'Puma', iucn: 'LC', category: 'Memeliler' },
  'kar leoparı': { scientificName: 'Panthera uncia', turkishName: 'Kar Leoparı', iucn: 'VU', category: 'Memeliler' },
  'kutup ayısı': { scientificName: 'Ursus maritimus', turkishName: 'Kutup Ayısı', iucn: 'VU', category: 'Memeliler' },
  'kutup tilkisi': { scientificName: 'Vulpes lagopus', turkishName: 'Kutup Tilkisi', iucn: 'LC', category: 'Memeliler' },
  'zürafa': { scientificName: 'Giraffa camelopardalis', turkishName: 'Zürafa', iucn: 'VU', category: 'Memeliler' },
  'fil': { scientificName: 'Loxodonta africana', turkishName: 'Afrika Savan Fili', iucn: 'EN', category: 'Memeliler' },
  'asya fili': { scientificName: 'Elephas maximus', turkishName: 'Asya Fili', iucn: 'EN', category: 'Memeliler' },
  'afrika fili': { scientificName: 'Loxodonta africana', turkishName: 'Afrika Savan Fili', iucn: 'EN', category: 'Memeliler' },
  'koala': { scientificName: 'Phascolarctos cinereus', turkishName: 'Koala', iucn: 'VU', category: 'Memeliler' },
  'penguen': { scientificName: 'Spheniscus demersus', turkishName: 'Afrika Pengueni', iucn: 'EN', category: 'Kuşlar' },
  'balina': { scientificName: 'Megaptera novaeangliae', turkishName: 'Kambur Balina', iucn: 'LC', category: 'Deniz Canlıları' },
  'kambur balina': { scientificName: 'Megaptera novaeangliae', turkishName: 'Kambur Balina', iucn: 'LC', category: 'Deniz Canlıları' },
  'katil balina': { scientificName: 'Orcinus orca', turkishName: 'Katil Balina (Orka)', iucn: 'DD', category: 'Deniz Canlıları' },
  'orka': { scientificName: 'Orcinus orca', turkishName: 'Katil Balina (Orka)', iucn: 'DD', category: 'Deniz Canlıları' },
  'kunduz': { scientificName: 'Castor fiber', turkishName: 'Avrasya Kunduzu', iucn: 'LC', category: 'Memeliler' },
  'porsuk': { scientificName: 'Meles meles', turkishName: 'Porsuk', iucn: 'LC', category: 'Memeliler' },
  'yaban domuzu': { scientificName: 'Sus scrofa', turkishName: 'Yaban Domuzu', iucn: 'LC', category: 'Memeliler' },
  'dağ keçisi': { scientificName: 'Capra aegagrus', turkishName: 'Yaban Keçisi', iucn: 'NT', category: 'Memeliler' },
  'yaban keçisi': { scientificName: 'Capra aegagrus', turkishName: 'Yaban Keçisi', iucn: 'NT', category: 'Memeliler' },
  'ceylan': { scientificName: 'Gazella subgutturosa', turkishName: 'Ceylan', iucn: 'VU', category: 'Memeliler' },
  'pelikan': { scientificName: 'Pelecanus onocrotalus', turkishName: 'Ak Pelikan', iucn: 'LC', category: 'Kuşlar' },
  'turna': { scientificName: 'Grus grus', turkishName: 'Bayağı Turna', iucn: 'LC', category: 'Kuşlar' },
  'akbaba': { scientificName: 'Gyps fulvus', turkishName: 'Kızıl Akbaba', iucn: 'LC', category: 'Kuşlar' },
  'gökdoğan': { scientificName: 'Falco peregrinus', turkishName: 'Gökdoğan', iucn: 'LC', category: 'Kuşlar' },
  'şahin': { scientificName: 'Buteo buteo', turkishName: 'Bayağı Şahin', iucn: 'LC', category: 'Kuşlar' },
  'baykuş': { scientificName: 'Bubo bubo', turkishName: 'Bayağı Puhu', iucn: 'LC', category: 'Kuşlar' },
  'köpekbalığı': { scientificName: 'Carcharodon carcharias', turkishName: 'Büyük Beyaz Köpekbalığı', iucn: 'VU', category: 'Deniz Canlıları' },
  'ahtapot': { scientificName: 'Octopus vulgaris', turkishName: 'Bayağı Ahtapot', iucn: 'LC', category: 'Deniz Canlıları' },
  'bal arısı': { scientificName: 'Apis mellifera', turkishName: 'Batı Bal Arısı', iucn: 'DD', category: 'Böcekler' },
};

// İngilizce ve ek çok dilli yaygın tür eşleşmeleri + çoklu tür belirsizlik adayları
const BILINGUAL_SPECIES_ENTRIES: Array<{
  aliases: string[];
  entry: CommonSpeciesEntry;
}> = [
  {
    aliases: ['aslan', 'lion', 'african lion'],
    entry: { scientificName: 'Panthera leo', turkishName: 'Aslan', englishName: 'Lion', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['kaplan', 'tiger'],
    entry: { scientificName: 'Panthera tigris', turkishName: 'Kaplan', englishName: 'Tiger', iucn: 'EN', category: 'Memeliler' },
  },
  {
    aliases: ['tilki', 'kızıl tilki', 'fox', 'red fox'],
    entry: {
      scientificName: 'Vulpes vulpes',
      turkishName: 'Kızıl Tilki',
      englishName: 'Red Fox',
      iucn: 'LC',
      category: 'Memeliler',
      alternatives: [
        { scientificName: 'Vulpes lagopus', turkishName: 'Kutup Tilkisi' },
        { scientificName: 'Vulpes cana', turkishName: 'Afgan Tilkisi' },
      ],
    },
  },
  {
    aliases: ['geyik', 'kızıl geyik', 'deer', 'red deer'],
    entry: {
      scientificName: 'Cervus elaphus',
      turkishName: 'Kızıl Geyik',
      englishName: 'Red Deer',
      iucn: 'LC',
      category: 'Memeliler',
      alternatives: [
        { scientificName: 'Dama dama', turkishName: 'Alageyik' },
        { scientificName: 'Capreolus capreolus', turkishName: 'Karaca' },
      ],
    },
  },
  {
    aliases: ['kartal', 'kaya kartalı', 'eagle', 'golden eagle'],
    entry: {
      scientificName: 'Aquila chrysaetos',
      turkishName: 'Kaya Kartalı',
      englishName: 'Golden Eagle',
      iucn: 'LC',
      category: 'Kuşlar',
      alternatives: [
        { scientificName: 'Aquila heliaca', turkishName: 'Şah Kartal' },
        { scientificName: 'Haliaeetus albicilla', turkishName: 'Ak Kuyruklu Kartal' },
        { scientificName: 'Circaetus gallicus', turkishName: 'Yılan Kartalı' },
      ],
    },
  },
  {
    aliases: ['şah kartal', 'imperial eagle', 'eastern imperial eagle'],
    entry: { scientificName: 'Aquila heliaca', turkishName: 'Şah Kartal', englishName: 'Eastern Imperial Eagle', iucn: 'VU', category: 'Kuşlar' },
  },
  {
    aliases: ['kel kartal', 'bald eagle'],
    entry: { scientificName: 'Haliaeetus leucocephalus', turkishName: 'Kel Kartal', englishName: 'Bald Eagle', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['su samuru', 'samur', 'otter', 'eurasian otter', 'river otter'],
    entry: { scientificName: 'Lutra lutra', turkishName: 'Avrasya Su Samuru', englishName: 'Eurasian Otter', iucn: 'NT', category: 'Memeliler' },
  },
  {
    aliases: ['deniz samuru', 'sea otter'],
    entry: { scientificName: 'Enhydra lutris', turkishName: 'Deniz Samuru', englishName: 'Sea Otter', iucn: 'EN', category: 'Deniz Canlıları' },
  },
  {
    aliases: ['sincap', 'kızıl sincap', 'squirrel', 'red squirrel', 'eurasian red squirrel'],
    entry: {
      scientificName: 'Sciurus vulgaris',
      turkishName: 'Kızıl Sincap',
      englishName: 'Eurasian Red Squirrel',
      iucn: 'LC',
      category: 'Memeliler',
      alternatives: [
        { scientificName: 'Sciurus anomalus', turkishName: 'Anadolu Sincabı' },
        { scientificName: 'Sciurus carolinensis', turkishName: 'Boz Sincap' },
      ],
    },
  },
  {
    aliases: ['bozayı', 'boz ayı', 'ayı', 'bear', 'brown bear', 'grizzly bear'],
    entry: {
      scientificName: 'Ursus arctos',
      turkishName: 'Bozayı',
      englishName: 'Brown Bear',
      iucn: 'LC',
      category: 'Memeliler',
      alternatives: [
        { scientificName: 'Ursus americanus', turkishName: 'Amerikan Kara Ayısı' },
        { scientificName: 'Ursus maritimus', turkishName: 'Kutup Ayısı' },
      ],
    },
  },
  {
    aliases: ['kurt', 'bozkurt', 'wolf', 'gray wolf', 'grey wolf'],
    entry: { scientificName: 'Canis lupus', turkishName: 'Bozkurt', englishName: 'Gray Wolf', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['vaşak', 'bayağı vaşak', 'lynx', 'eurasian lynx'],
    entry: {
      scientificName: 'Lynx lynx',
      turkishName: 'Bayağı Vaşak',
      englishName: 'Eurasian Lynx',
      iucn: 'LC',
      category: 'Memeliler',
      alternatives: [
        { scientificName: 'Lynx rufus', turkishName: 'Kızıl Vaşak' },
        { scientificName: 'Caracal caracal', turkishName: 'Karakulak' },
      ],
    },
  },
  {
    aliases: ['flamingo', 'büyük flamingo', 'greater flamingo'],
    entry: {
      scientificName: 'Phoenicopterus roseus',
      turkishName: 'Büyük Flamingo',
      englishName: 'Greater Flamingo',
      iucn: 'LC',
      category: 'Kuşlar',
      alternatives: [
        { scientificName: 'Phoenicopterus ruber', turkishName: 'Karayip Flamingosu' },
        { scientificName: 'Phoeniconaias minor', turkishName: 'Küçük Flamingo' },
      ],
    },
  },
  {
    aliases: ['panda', 'dev panda', 'giant panda'],
    entry: {
      scientificName: 'Ailuropoda melanoleuca',
      turkishName: 'Dev Panda',
      englishName: 'Giant Panda',
      iucn: 'VU',
      category: 'Memeliler',
      alternatives: [
        { scientificName: 'Ailurus fulgens', turkishName: 'Kızıl Panda' },
      ],
    },
  },
  {
    aliases: ['kızıl panda', 'red panda'],
    entry: { scientificName: 'Ailurus fulgens', turkishName: 'Kızıl Panda', englishName: 'Red Panda', iucn: 'EN', category: 'Memeliler' },
  },
  {
    aliases: ['caretta caretta', 'caretta', 'deniz kaplumbağası', 'iribaş deniz kaplumbağası', 'sea turtle', 'loggerhead', 'loggerhead sea turtle'],
    entry: {
      scientificName: 'Caretta caretta',
      turkishName: 'İribaş Deniz Kaplumbağası',
      englishName: 'Loggerhead Sea Turtle',
      iucn: 'VU',
      category: 'Sürüngenler',
      alternatives: [
        { scientificName: 'Chelonia mydas', turkishName: 'Yeşil Deniz Kaplumbağası' },
      ],
    },
  },
  {
    aliases: ['yeşil deniz kaplumbağası', 'green sea turtle'],
    entry: { scientificName: 'Chelonia mydas', turkishName: 'Yeşil Deniz Kaplumbağası', englishName: 'Green Sea Turtle', iucn: 'EN', category: 'Sürüngenler' },
  },
  {
    aliases: ['akdeniz foku', 'deniz foku', 'fok', 'monk seal', 'mediterranean monk seal'],
    entry: { scientificName: 'Monachus monachus', turkishName: 'Akdeniz Foku', englishName: 'Mediterranean Monk Seal', iucn: 'EN', category: 'Deniz Canlıları' },
  },
  {
    aliases: ['kelaynak', 'bald ibis', 'northern bald ibis'],
    entry: { scientificName: 'Geronticus eremita', turkishName: 'Kelaynak', englishName: 'Northern Bald Ibis', iucn: 'EN', category: 'Kuşlar' },
  },
  {
    aliases: ['çizgili sırtlan', 'sırtlan', 'hyena', 'striped hyena'],
    entry: { scientificName: 'Hyaena hyaena', turkishName: 'Çizgili Sırtlan', englishName: 'Striped Hyena', iucn: 'NT', category: 'Memeliler' },
  },
  {
    aliases: ['yaban kedisi', 'wildcat', 'european wildcat'],
    entry: { scientificName: 'Felis silvestris', turkishName: 'Yaban Kedisi', englishName: 'European Wildcat', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['leopar', 'pars', 'anadolu leoparı', 'anadolu parsı', 'leopard'],
    entry: { scientificName: 'Panthera pardus', turkishName: 'Anadolu Leoparı', englishName: 'Leopard', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['kar leoparı', 'snow leopard'],
    entry: { scientificName: 'Panthera uncia', turkishName: 'Kar Leoparı', englishName: 'Snow Leopard', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['çita', 'cheetah'],
    entry: { scientificName: 'Acinonyx jubatus', turkishName: 'Çita', englishName: 'Cheetah', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['jaguar'],
    entry: { scientificName: 'Panthera onca', turkishName: 'Jaguar', englishName: 'Jaguar', iucn: 'NT', category: 'Memeliler' },
  },
  {
    aliases: ['puma', 'cougar', 'mountain lion'],
    entry: { scientificName: 'Puma concolor', turkishName: 'Puma', englishName: 'Cougar', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['kutup ayısı', 'polar bear'],
    entry: { scientificName: 'Ursus maritimus', turkishName: 'Kutup Ayısı', englishName: 'Polar Bear', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['kutup tilkisi', 'arctic fox'],
    entry: { scientificName: 'Vulpes lagopus', turkishName: 'Kutup Tilkisi', englishName: 'Arctic Fox', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['karaca', 'roe deer'],
    entry: { scientificName: 'Capreolus capreolus', turkishName: 'Karaca', englishName: 'European Roe Deer', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['alageyik', 'fallow deer'],
    entry: { scientificName: 'Dama dama', turkishName: 'Alageyik', englishName: 'Fallow Deer', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['kirpi', 'hedgehog'],
    entry: { scientificName: 'Erinaceus concolor', turkishName: 'Doğu Avrupa Kirpisi', englishName: 'Southern White-breasted Hedgehog', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['leylek', 'white stork', 'stork'],
    entry: { scientificName: 'Ciconia ciconia', turkishName: 'Ak Leylek', englishName: 'White Stork', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['toy', 'toy kuşu', 'great bustard'],
    entry: { scientificName: 'Otis tarda', turkishName: 'Toy Kuşu', englishName: 'Great Bustard', iucn: 'VU', category: 'Kuşlar' },
  },
  {
    aliases: ['toros kurbağası'],
    entry: { scientificName: 'Rana holtzi', turkishName: 'Toros Kurbağası', iucn: 'CR', category: 'Amfibiler' },
  },
  {
    aliases: ['kafkas semenderi'],
    entry: { scientificName: 'Mertensiella caucasica', turkishName: 'Kafkas Semenderi', iucn: 'VU', category: 'Amfibiler' },
  },
  {
    aliases: ['kafkas engereği'],
    entry: { scientificName: 'Vipera kaznakovi', turkishName: 'Kafkas Burunlu Engereği', iucn: 'EN', category: 'Sürüngenler' },
  },
  {
    aliases: ['yunus', 'afalina', 'şişeburunlu yunus', 'dolphin', 'bottlenose dolphin'],
    entry: {
      scientificName: 'Tursiops truncatus',
      turkishName: 'Afalina (Şişeburunlu Yunus)',
      englishName: 'Common Bottlenose Dolphin',
      iucn: 'LC',
      category: 'Deniz Canlıları',
      alternatives: [{ scientificName: 'Delphinus delphis', turkishName: 'Tırtak (Bayağı Yunus)' }],
    },
  },
  {
    aliases: ['balina', 'kambur balina', 'whale', 'humpback whale'],
    entry: {
      scientificName: 'Megaptera novaeangliae',
      turkishName: 'Kambur Balina',
      englishName: 'Humpback Whale',
      iucn: 'LC',
      category: 'Deniz Canlıları',
      alternatives: [
        { scientificName: 'Balaenoptera physalus', turkishName: 'Oluklu Balina' },
        { scientificName: 'Orcinus orca', turkishName: 'Katil Balina' },
      ],
    },
  },
  {
    aliases: ['katil balina', 'orka', 'orca', 'killer whale'],
    entry: { scientificName: 'Orcinus orca', turkishName: 'Katil Balina (Orka)', englishName: 'Killer Whale', iucn: 'DD', category: 'Deniz Canlıları' },
  },
  {
    aliases: ['zürafa', 'giraffe'],
    entry: { scientificName: 'Giraffa camelopardalis', turkishName: 'Zürafa', englishName: 'Giraffe', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['fil', 'afrika fili', 'elephant', 'african elephant'],
    entry: {
      scientificName: 'Loxodonta africana',
      turkishName: 'Afrika Savan Fili',
      englishName: 'African Bush Elephant',
      iucn: 'EN',
      category: 'Memeliler',
      alternatives: [{ scientificName: 'Elephas maximus', turkishName: 'Asya Fili' }],
    },
  },
  {
    aliases: ['asya fili', 'asian elephant'],
    entry: { scientificName: 'Elephas maximus', turkishName: 'Asya Fili', englishName: 'Asian Elephant', iucn: 'EN', category: 'Memeliler' },
  },
  {
    aliases: ['koala'],
    entry: { scientificName: 'Phascolarctos cinereus', turkishName: 'Koala', englishName: 'Koala', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['penguen', 'penguin'],
    entry: {
      scientificName: 'Spheniscus demersus',
      turkishName: 'Afrika Pengueni',
      englishName: 'African Penguin',
      iucn: 'EN',
      category: 'Kuşlar',
      alternatives: [
        { scientificName: 'Aptenodytes forsteri', turkishName: 'İmparator Penguen' },
        { scientificName: 'Spheniscus magellanicus', turkishName: 'Macellan Pengueni' },
      ],
    },
  },
  {
    aliases: ['kanguru', 'kangaroo'],
    entry: { scientificName: 'Osphranter rufus', turkishName: 'Kızıl Kanguru', englishName: 'Red Kangaroo', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['gergedan', 'rhinoceros', 'rhino'],
    entry: { scientificName: 'Diceros bicornis', turkishName: 'Siyah Gergedan', englishName: 'Black Rhinoceros', iucn: 'CR', category: 'Memeliler' },
  },
  {
    aliases: ['su aygırı', 'hippopotamus', 'hippo'],
    entry: { scientificName: 'Hippopotamus amphibius', turkishName: 'Su Aygırı', englishName: 'Hippopotamus', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['zebra'],
    entry: { scientificName: 'Equus quagga', turkishName: 'Ova Zebrası', englishName: 'Plains Zebra', iucn: 'NT', category: 'Memeliler' },
  },
  {
    aliases: ['goril', 'gorilla'],
    entry: { scientificName: 'Gorilla gorilla', turkishName: 'Batı Gorili', englishName: 'Western Gorilla', iucn: 'CR', category: 'Memeliler' },
  },
  {
    aliases: ['şempanze', 'chimpanzee', 'chimp'],
    entry: { scientificName: 'Pan troglodytes', turkishName: 'Şempanze', englishName: 'Chimpanzee', iucn: 'EN', category: 'Memeliler' },
  },
  {
    aliases: ['orangutan'],
    entry: { scientificName: 'Pongo pygmaeus', turkishName: 'Borneo Orangutanı', englishName: 'Bornean Orangutan', iucn: 'CR', category: 'Memeliler' },
  },
  {
    aliases: ['kunduz', 'beaver'],
    entry: { scientificName: 'Castor fiber', turkishName: 'Avrasya Kunduzu', englishName: 'Eurasian Beaver', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['porsuk', 'badger', 'european badger'],
    entry: { scientificName: 'Meles meles', turkishName: 'Porsuk', englishName: 'European Badger', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['yaban domuzu', 'wild boar', 'boar'],
    entry: { scientificName: 'Sus scrofa', turkishName: 'Yaban Domuzu', englishName: 'Wild Boar', iucn: 'LC', category: 'Memeliler' },
  },
  {
    aliases: ['dağ keçisi', 'yaban keçisi', 'wild goat', 'ibex'],
    entry: { scientificName: 'Capra aegagrus', turkishName: 'Yaban Keçisi', englishName: 'Wild Goat', iucn: 'NT', category: 'Memeliler' },
  },
  {
    aliases: ['ceylan', 'gazelle'],
    entry: { scientificName: 'Gazella subgutturosa', turkishName: 'Ceylan', englishName: 'Goitered Gazelle', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['pelikan', 'pelican'],
    entry: { scientificName: 'Pelecanus onocrotalus', turkishName: 'Ak Pelikan', englishName: 'Great White Pelican', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['turna', 'crane'],
    entry: { scientificName: 'Grus grus', turkishName: 'Bayağı Turna', englishName: 'Common Crane', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['akbaba', 'vulture'],
    entry: { scientificName: 'Gyps fulvus', turkishName: 'Kızıl Akbaba', englishName: 'Griffon Vulture', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['gökdoğan', 'peregrine falcon', 'falcon'],
    entry: { scientificName: 'Falco peregrinus', turkishName: 'Gökdoğan', englishName: 'Peregrine Falcon', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['şahin', 'buzzard'],
    entry: { scientificName: 'Buteo buteo', turkishName: 'Bayağı Şahin', englishName: 'Common Buzzard', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['baykuş', 'owl'],
    entry: { scientificName: 'Bubo bubo', turkishName: 'Bayağı Puhu', englishName: 'Eurasian Eagle-Owl', iucn: 'LC', category: 'Kuşlar' },
  },
  {
    aliases: ['köpekbalığı', 'büyük beyaz köpekbalığı', 'shark', 'great white shark'],
    entry: { scientificName: 'Carcharodon carcharias', turkishName: 'Büyük Beyaz Köpekbalığı', englishName: 'Great White Shark', iucn: 'VU', category: 'Deniz Canlıları' },
  },
  {
    aliases: ['ahtapot', 'octopus'],
    entry: { scientificName: 'Octopus vulgaris', turkishName: 'Bayağı Ahtapot', englishName: 'Common Octopus', iucn: 'LC', category: 'Deniz Canlıları' },
  },
  {
    aliases: ['bal arısı', 'honey bee', 'honeybee'],
    entry: { scientificName: 'Apis mellifera', turkishName: 'Batı Bal Arısı', englishName: 'Western Honey Bee', iucn: 'DD', category: 'Böcekler' },
  },
  {
    aliases: ['tavşan', 'yabani tavşan', 'hare', 'european hare'],
    entry: { scientificName: 'Lepus europaeus', turkishName: 'Bayağı Yabani Tavşan', englishName: 'European Hare', iucn: 'LC', category: 'Memeliler' },
  },
];

function normalizeSearchQuery(raw: string): string {
  return (raw || '')
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toTrLower(text: string): string {
  return normalizeSearchQuery(text).toLocaleLowerCase('tr-TR');
}

function foldTurkishChars(text: string): string {
  return toTrLower(text)
    .replace(/i\u0307/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u');
}

function stripCommonPlurals(lower: string): string[] {
  const candidates = [lower];
  if (lower.length > 5 && (lower.endsWith('lar') || lower.endsWith('ler'))) {
    candidates.push(lower.slice(0, -3));
  }
  if (lower.length > 4 && lower.endsWith('s') && !lower.endsWith('us') && !lower.endsWith('is')) {
    candidates.push(lower.slice(0, -1));
  }
  return candidates;
}

const COMMON_SPECIES_INDEX = (() => {
  const exactMap = new Map<string, CommonSpeciesEntry>();
  const foldedMap = new Map<string, CommonSpeciesEntry>();
  for (const item of BILINGUAL_SPECIES_ENTRIES) {
    for (const alias of item.aliases) {
      exactMap.set(toTrLower(alias), item.entry);
      foldedMap.set(foldTurkishChars(alias), item.entry);
    }
  }
  return { exactMap, foldedMap };
})();

function lookupCommonSpeciesEntry(query: string): CommonSpeciesEntry | null {
  const lower = toTrLower(query);
  for (const variant of stripCommonPlurals(lower)) {
    const exact = COMMON_SPECIES_INDEX.exactMap.get(variant);
    if (exact) return exact;
  }
  const folded = foldTurkishChars(query);
  for (const variant of stripCommonPlurals(folded)) {
    const match = COMMON_SPECIES_INDEX.foldedMap.get(variant);
    if (match) return match;
  }
  return null;
}

function formatScientificCandidate(raw: string): string {
  const parts = normalizeSearchQuery(raw).split(' ');
  if (parts.length >= 2 && parts.every(p => /^[a-zA-ZçğıöşüÇĞİÖŞÜ-]+$/.test(p))) {
    const genus = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    const rest = parts.slice(1).map(p => p.toLowerCase());
    return [genus, ...rest].join(' ');
  }
  return normalizeSearchQuery(raw);
}

const DISALLOWED_COMMON_KINGDOMS = new Set([
  'viruses',
  'pararnavirae',
  'shotokuvirae',
  'bamfordvirae',
  'orthornavirae',
  'bacteria',
  'archaea',
  'plantae',
  'fungi',
  'chromista',
  'protozoa',
]);

const ANIMAL_INAT_ICONIC_TAXA = new Set([
  'animalia',
  'mammalia',
  'aves',
  'reptilia',
  'amphibia',
  'actinopterygii',
  'mollusca',
  'arachnida',
  'insecta',
]);

export interface SpeciesRule {
  scientificName: string;
  turkishName: string;
  family: string;
  patterns: RegExp[];
}

export const SPECIES_RECOGNITION_RULES: SpeciesRule[] = [
  // 1. Bozayı (Ursus arctos) - "boz ayıların", "bozayılar", "ursus arctos"
  {
    scientificName: 'Ursus arctos',
    turkishName: 'Bozayı',
    family: 'Ursidae',
    patterns: [
      /(?:^|[^\p{L}\p{N}])(boz\s*ay[ıi]|ursus\s+arctos)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
    ],
  },
  // 2. Vaşak (Lynx lynx) - "vaşak", "vaşaklar", "vaşakların", "vaşağın"
  {
    scientificName: 'Lynx lynx',
    turkishName: 'Bayağı Vaşak',
    family: 'Felidae',
    patterns: [
      /(?:^|[^\p{L}\p{N}])(baya[gğ]ı\s+va[sş]ak|lynx\s+lynx)(?=[^\p{L}\p{N}]|$)/iu,
      /(?:^|[^\p{L}\p{N}])va[sş]a[kğ](?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
    ],
  },
  // 3. Bozkurt / Kurt (Canis lupus) - "bozkurt", "kurt", "kurtların", "kurdun"
  {
    scientificName: 'Canis lupus',
    turkishName: 'Bozkurt',
    family: 'Canidae',
    patterns: [
      /(?:^|[^\p{L}\p{N}])(bozkurt|canis\s+lupus)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
      /(?:^|[^\p{L}\p{N}])(kurt|kurd)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
    ],
  },
  // 4. Caretta caretta - "caretta caretta", "carettaların", "deniz kaplumbağası"
  {
    scientificName: 'Caretta caretta',
    turkishName: 'İribaş Deniz Kaplumbağası',
    family: 'Cheloniidae',
    patterns: [
      /(?:^|[^\p{L}\p{N}])(caretta(?:\s+caretta)?)(?=[^\p{L}\p{N}]|$)/iu,
      /(?:^|[^\p{L}\p{N}])deniz\s+kaplumba[gğ]as[ıi](?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
    ],
  },
  // 5. Akdeniz Foku (Monachus monachus) - "akdeniz foku", "akdeniz foklarının"
  {
    scientificName: 'Monachus monachus',
    turkishName: 'Akdeniz Foku',
    family: 'Phocidae',
    patterns: [
      /(?:^|[^\p{L}\p{N}])(akdeniz\s+foku|monachus\s+monachus|deniz\s+foku)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
      /(?:^|[^\p{L}\p{N}])fok(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
    ],
  },
  // 6. Toros Kurbağası (Rana holtzi)
  {
    scientificName: 'Rana holtzi',
    turkishName: 'Toros Kurbağası',
    family: 'Ranidae',
    patterns: [
      /(?:^|[^\p{L}\p{N}])(toros\s+kurba[gğ]as[ıi]|rana\s+holtzi)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
    ],
  },
  // 7. Kelaynak (Geronticus eremita)
  {
    scientificName: 'Geronticus eremita',
    turkishName: 'Kelaynak',
    family: 'Threskiornithidae',
    patterns: [
      /(?:^|[^\p{L}\p{N}])(kelayna[kğ]|geronticus\s+eremita)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}\p{N}]|$)/iu,
    ],
  },
  // 8. Çizgili Sırtlan (Hyaena hyaena)
  {
    scientificName: 'Hyaena hyaena',
    turkishName: 'Çizgili Sırtlan',
    family: 'Hyaenidae',
    patterns: [
      /\b([cç]izgili\s+s[ıi]rtlan|hyaena\s+hyaena)\b/iu,
      /\bs[ıi]rtlan(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 9. Yaban Kedisi (Felis silvestris)
  {
    scientificName: 'Felis silvestris',
    turkishName: 'Yaban Kedisi',
    family: 'Felidae',
    patterns: [
      /\b(yaban\s+kedisi|felis\s+silvestris)(?:ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 10. Anadolu Leoparı / Pars (Panthera pardus)
  {
    scientificName: 'Panthera pardus',
    turkishName: 'Anadolu Leoparı',
    family: 'Felidae',
    patterns: [
      /\b(anadolu\s+leopar[ıi]|anadolu\s+pars[ıi]|panthera\s+pardus)\b/iu,
      /\b(leopar|pars)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 11. Kafkas Semenderi (Mertensiella caucasica)
  {
    scientificName: 'Mertensiella caucasica',
    turkishName: 'Kafkas Semenderi',
    family: 'Salamandridae',
    patterns: [
      /\b(kafkas\s+semenderi|mertensiella\s+caucasica)(?:ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 12. Kaya Kartalı (Aquila chrysaetos)
  {
    scientificName: 'Aquila chrysaetos',
    turkishName: 'Kaya Kartalı',
    family: 'Accipitridae',
    patterns: [
      /\b(kaya\s+kartal[ıi]|aquila\s+chrysaetos)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 13. Şah Kartal (Aquila heliaca)
  {
    scientificName: 'Aquila heliaca',
    turkishName: 'Şah Kartal',
    family: 'Accipitridae',
    patterns: [
      /\b([sş]ah\s+kartal[ıi]?|aquila\s+heliaca)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 14. Toy Kuşu (Otis tarda)
  {
    scientificName: 'Otis tarda',
    turkishName: 'Toy Kuşu',
    family: 'Otididae',
    patterns: [
      /\b(toy(\s+ku[sş]u)?|otis\s+tarda)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 15. Yeşil Deniz Kaplumbağası (Chelonia mydas)
  {
    scientificName: 'Chelonia mydas',
    turkishName: 'Yeşil Deniz Kaplumbağası',
    family: 'Cheloniidae',
    patterns: [
      /\b(ye[sş]il\s+deniz\s+kaplumba[gğ]as[ıi]|chelonia\s+mydas)\b/iu,
    ],
  },
  // 16. Kafkas Engereği (Vipera kaznakovi)
  {
    scientificName: 'Vipera kaznakovi',
    turkishName: 'Kafkas Burunlu Engereği',
    family: 'Viperidae',
    patterns: [
      /\b(kafkas\s+engere[gğ]i|vipera\s+kaznakovi)(?:ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 17. Afalina / Yunus (Tursiops truncatus)
  {
    scientificName: 'Tursiops truncatus',
    turkishName: 'Afalina (Şişeburunlu Yunus)',
    family: 'Delphinidae',
    patterns: [
      /\b([sş]i[sş]eburunlu\s+yunus|tursiops\s+truncatus|afalina)\b/iu,
      /\byunus(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 18. Aslan (Panthera leo)
  {
    scientificName: 'Panthera leo',
    turkishName: 'Aslan',
    family: 'Felidae',
    patterns: [
      /\b(aslan|panthera\s+leo)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 19. Kaplan (Panthera tigris)
  {
    scientificName: 'Panthera tigris',
    turkishName: 'Kaplan',
    family: 'Felidae',
    patterns: [
      /\b(kaplan|panthera\s+tigris)(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?\b/iu,
    ],
  },
  // 20. Genel Ayı (Ursus arctos) - checked last if not matched as boz ayı
  {
    scientificName: 'Ursus arctos',
    turkishName: 'Bozayı',
    family: 'Ursidae',
    patterns: [
      /(?:^|[^\p{L}])(ay[ıi])(?:lar|ler)?(?:[ıiuü]|n[ıiuü]|[ıiuü]n|n[ıiuü]n|[ae]|y[ae]|[dt][ae]|[dt][ae]n)?(?=[^\p{L}]|$)/iu,
    ],
  },
];

/**
 * Doğal dildeki kullanıcı araştırma talebini parametrelere ayırma fonksiyonu
 */
export function extractSpeciesAndParameters(
  rawQuery: string,
  defaultCountry: string = 'TR'
): {
  foundSpecies: boolean;
  parameters?: ResearchParameters;
  resolvedScientificName?: string;
  error?: string;
} {
  const text = (rawQuery || '').trim();
  if (!text) {
    return {
      foundSpecies: false,
      error: 'Lütfen bir araştırma görevi veya soru girin.',
    };
  }

  // Normalize Turkish characters and punctuation
  const normalized = text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035']/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036"]/g, '"');

  // 1. Match against biological rules
  let matchedRule: SpeciesRule | null = null;
  for (const rule of SPECIES_RECOGNITION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        matchedRule = rule;
        break;
      }
    }
    if (matchedRule) break;
  }

  let scientificName = matchedRule?.scientificName;
  let turkishName = matchedRule?.turkishName;

  // 2. Check for Latin binomial names (e.g. "Ursus arctos", "Lutra lutra")
  if (!matchedRule) {
    const binomialMatch = normalized.match(/\b([A-Z][a-z]{2,}\s+[a-z]{3,})\b/);
    if (binomialMatch && binomialMatch[1]) {
      const candidate = binomialMatch[1];
      const isTurkishStopPhrase = /\b(türkiye|türkiyede|kayıt|kayıtları|kayıtlarını|gözlem|gözlemleri|yıllık|verileri|raporu|bana|lütfen|hakkında|nedir|hangi|nerede|arşiv|analiz|harita|atlas|tüm|bölge|bölgeler|iller|yıllara|en|fazla|bulunan|bilgi|ver)\b/i.test(candidate);
      if (!isTurkishStopPhrase) {
        scientificName = candidate;
        turkishName = candidate;
      }
    }
  }

  // 3. Fallback to dictionary direct lookups
  if (!scientificName) {
    const lowerClean = normalized.toLowerCase();
    for (const [key, val] of Object.entries(COMMON_TURKISH_SPECIES)) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|[^\\p{L}])${escaped}(?:lar|ler)?(?:[^\\p{L}]|$)`, 'iu');
      if (regex.test(lowerClean)) {
        scientificName = val.scientificName;
        turkishName = val.turkishName;
        break;
      }
    }
  }

  if (!scientificName) {
    return {
      foundSpecies: false,
      error: 'Araştırılacak canlı türü tespit edilemedi. Lütfen araştırmak istediğiniz canlı türünün adını (Türkçe veya bilimsel adıyla) belirtin (Örn: Bozayı, Vaşak, Bozkurt, Caretta caretta, Akdeniz Foku veya Ursus arctos).',
    };
  }

  // 4. Extract Year Range
  const currentYear = new Date().getFullYear();
  let startYear: number | undefined;
  let endYear: number | undefined;
  let dateRangeText = 'Tüm Tarihsel Kayıtlar (GBIF Arşivi)';

  // "son X yıl" / "son X yıllık" / "son X yılda" / "son X yıldaki" / "son X yılın"
  const lastNYearsMatch = normalized.match(/\bson\s+(\d+|on|beş|yirmi|üç|iki)\s+yıl(?:lık|da|daki|dan|den|ın|in|ı|i)?\b/iu);
  if (lastNYearsMatch) {
    let numYears = 10;
    const word = lastNYearsMatch[1].toLowerCase();
    if (word === 'on') numYears = 10;
    else if (word === 'beş') numYears = 5;
    else if (word === 'yirmi') numYears = 20;
    else if (word === 'üç') numYears = 3;
    else if (word === 'iki') numYears = 2;
    else numYears = parseInt(word, 10);

    if (!isNaN(numYears) && numYears > 0) {
      startYear = currentYear - numYears;
      endYear = currentYear;
      dateRangeText = `Son ${numYears} yıl (${startYear} – ${endYear})`;
    }
  }

  // "YYYY - YYYY" or "YYYY ile YYYY"
  if (!startYear) {
    const rangeMatch = normalized.match(/\b(19\d\d|20\d\d)\s*(?:[-–—/]|ile|ve)\s*(19\d\d|20\d\d)\b/iu);
    if (rangeMatch) {
      startYear = parseInt(rangeMatch[1], 10);
      endYear = parseInt(rangeMatch[2], 10);
      if (startYear > endYear) {
        const tmp = startYear;
        startYear = endYear;
        endYear = tmp;
      }
      dateRangeText = `${startYear} – ${endYear} Yılları Arası`;
    }
  }

  // "YYYY sonrası" / "YYYY yılından sonra"
  if (!startYear) {
    const afterMatch = normalized.match(/\b(19\d\d|20\d\d)\s*(?:yılından\s+sonra|sonrası|itibaren)\b/iu);
    if (afterMatch) {
      startYear = parseInt(afterMatch[1], 10);
      endYear = currentYear;
      dateRangeText = `${startYear} Yılından Günümüze`;
    }
  }

  // 5. Extract Country
  let country = defaultCountry === 'TR' ? 'Türkiye' : 'Küresel / Tüm Dünya';
  let countryCode = defaultCountry;

  if (/\b(küresel|dünya|dünyada|dünya\s+genelinde|global)\b/iu.test(normalized)) {
    country = 'Küresel / Tüm Dünya';
    countryCode = '';
  } else if (/\b(türkiye(?:'deki|deki|'de|de)?|turkey|anadolu(?:'da|da)?)\b/iu.test(normalized)) {
    country = 'Türkiye';
    countryCode = 'TR';
  }

  // 6. Extract Analysis Type and Geographic Scope
  const analysisType = /\b(yıllara\s+göre|zamansal|yıllık|değişim|trend|artış|azalış)\b/iu.test(normalized)
    ? 'Yıllık gözlem sayıları ve zamansal trend analizi'
    : 'Genel biyoçeşitlilik ve arşiv kayıt analizi';

  const geographicScope = /\b(il|iller|bölge|bölgeler|dağılım|nerede|yoğunluk|sıcak\s+nokta)\b/iu.test(normalized)
    ? 'En fazla kayıt bulunan iller ve coğrafi sıcak noktalar'
    : 'Ulusal ve bölgesel coğrafi dağılım';

  return {
    foundSpecies: true,
    resolvedScientificName: scientificName,
    parameters: {
      speciesName: turkishName || scientificName,
      scientificName,
      country,
      countryCode,
      startYear,
      endYear,
      dateRangeText,
      analysisType,
      geographicScope,
    },
  };
}

/**
 * Kullanıcı metninde iki farklı türün karşılaştırılmak istenip istenmediğini kontrol eder
 */
export function extractComparisonSpecies(
  rawQuery: string
): { isComparison: boolean; speciesA?: string; speciesB?: string } {
  const text = (rawQuery || '').trim();
  if (!text) return { isComparison: false };

  const isCompareIntent = /\b(karşılaştır|kıyasla|kıyas|farkı|farkları|vs|versus)\b/iu.test(text) ||
    /\b(ile|ve)\b/iu.test(text);

  if (!isCompareIntent) return { isComparison: false };

  const matchedSpecies: { scientificName: string; turkishName: string }[] = [];

  for (const rule of SPECIES_RECOGNITION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        if (!matchedSpecies.some(m => m.scientificName === rule.scientificName)) {
          matchedSpecies.push({ scientificName: rule.scientificName, turkishName: rule.turkishName });
        }
        break;
      }
    }
    if (matchedSpecies.length >= 2) break;
  }

  if (matchedSpecies.length >= 2) {
    return {
      isComparison: true,
      speciesA: matchedSpecies[0].scientificName,
      speciesB: matchedSpecies[1].scientificName,
    };
  }

  return { isComparison: false };
}


// Keşif alanı için 6 ana kategoride seçilmiş türler
export const DISCOVERY_SPECIMENS: DiscoverySpecimen[] = [
  // Memeliler
  {
    id: 'ursus-arctos',
    category: 'mammals',
    turkishName: 'Bozayı',
    scientificName: 'Ursus arctos',
    family: 'Ursidae',
    iucnStatus: 'LC',
    iucnCategoryName: 'Asgari Endişe (Least Concern)',
    description: 'Türkiye\'nin en büyük kara memelisi. Karadeniz, Doğu Anadolu ve İç Anadolu\'nun ormanlık ve dağlık alanlarında yaşar.',
    habitat: 'Yoğun iğne yapraklı ve karışık dağ ormanları'
  },
  {
    id: 'lynx-lynx',
    category: 'mammals',
    turkishName: 'Bayağı Vaşak',
    scientificName: 'Lynx lynx',
    family: 'Felidae',
    iucnStatus: 'LC',
    iucnCategoryName: 'Asgari Endişe (Least Concern)',
    description: 'Gizemli ve usta bir avcı olan vaşak, kulak uçlarındaki püskülleri ve benekli postuyla tanınır. Bolu, Kastamonu ve Kars ormanlarında gözlemlenir.',
    habitat: 'Sarp kayalık ormanlık araziler'
  },
  {
    id: 'canis-lupus',
    category: 'mammals',
    turkishName: 'Bozkurt',
    scientificName: 'Canis lupus',
    family: 'Canidae',
    iucnStatus: 'LC',
    iucnCategoryName: 'Asgari Endişe (Least Concern)',
    description: 'Anadolu ekosisteminin tepe yırtıcılarından biri. Sürüler halinde avlanan kurtlar ekolojik dengenin kilit taşıdır.',
    habitat: 'Bozkırlar, ormanlar ve dağlık platolar'
  },
  {
    id: 'hyaena-hyaena',
    category: 'mammals',
    turkishName: 'Çizgili Sırtlan',
    scientificName: 'Hyaena hyaena',
    family: 'Hyaenidae',
    iucnStatus: 'NT',
    iucnCategoryName: 'Tehdite Yakın (Near Threatened)',
    description: 'Güneydoğu Anadolu ve Akdeniz\'in kayalık vadilerinde yaşayan, leşçil ve gececil ender bir tür.',
    habitat: 'Kurak vadiler, kayalık bozkırlar ve kanyonlar'
  },
  {
    id: 'felis-silvestris',
    category: 'mammals',
    turkishName: 'Yaban Kedisi',
    scientificName: 'Felis silvestris',
    family: 'Felidae',
    iucnStatus: 'LC',
    iucnCategoryName: 'Asgari Endişe (Least Concern)',
    description: 'Evcil kedilere benzese de daha iri, daha kalın kuyruklu ve vahşi olan orman kedisi.',
    habitat: 'Geniş yapraklı ve karışık ormanlar'
  },

  // Kuşlar
  {
    id: 'aquila-chrysaetos',
    category: 'birds',
    turkishName: 'Kaya Kartalı',
    scientificName: 'Aquila chrysaetos',
    family: 'Accipitridae',
    iucnStatus: 'LC',
    iucnCategoryName: 'Asgari Endişe (Least Concern)',
    description: 'Geniş kanat açıklığı ve heybetli süzülüşüyle Türkiye\'nin yüksek dağ zirvelerinin hükümdarı.',
    habitat: 'Yüksek dağlar ve sarp kayalık boğazlar'
  },
  {
    id: 'geronticus-eremita',
    category: 'birds',
    turkishName: 'Kelaynak',
    scientificName: 'Geronticus eremita',
    family: 'Threskiornithidae',
    iucnStatus: 'EN',
    iucnCategoryName: 'Tehlikede (Endangered)',
    description: 'Dünyada sadece Birecik (Şanlıurfa) ve Fas\'ta kalan, biyoçeşitlilik koruma projelerinin simgesi olan kadim göçmen kuş.',
    habitat: 'Fırat nehri kıyısındaki kayalık yarlar ve yarı kurak otlaklar'
  },
  {
    id: 'otis-tarda',
    category: 'birds',
    turkishName: 'Toy Kuşu',
    scientificName: 'Otis tarda',
    family: 'Otididae',
    iucnStatus: 'VU',
    iucnCategoryName: 'Hassas (Vulnerable)',
    description: 'Türkiye\'nin ve dünyanın uçabilen en ağır kuşlarından biridir. İç ve Doğu Anadolu bozkırlarında yaşar.',
    habitat: 'Geniş açık düzlükler ve bozkır tarım alanları'
  },
  {
    id: 'aquila-heliaca',
    category: 'birds',
    turkishName: 'Şah Kartal',
    scientificName: 'Aquila heliaca',
    family: 'Accipitridae',
    iucnStatus: 'VU',
    iucnCategoryName: 'Hassas (Vulnerable)',
    description: 'Baş ve ensesindeki altın sarısı tüyleriyle ayırt edilen, yaşlı meşe ve çam ağaçlarında yuvalayan nadir kartal.',
    habitat: 'Açık ormanlık araziler ve ağaçlı bozkırlar'
  },

  // Sürüngenler
  {
    id: 'caretta-caretta',
    category: 'reptiles',
    turkishName: 'İribaş Deniz Kaplumbağası',
    scientificName: 'Caretta caretta',
    family: 'Cheloniidae',
    iucnStatus: 'VU',
    iucnCategoryName: 'Hassas (Vulnerable)',
    description: 'Akdeniz kumsallarını (İztuzu, Patara, Belek) yuvalama alanı olarak kullanan deniz kaplumbağası.',
    habitat: 'Açık deniz ve Akdeniz kumsalları'
  },
  {
    id: 'chelonia-mydas',
    category: 'reptiles',
    turkishName: 'Yeşil Deniz Kaplumbağası',
    scientificName: 'Chelonia mydas',
    family: 'Cheloniidae',
    iucnStatus: 'EN',
    iucnCategoryName: 'Tehlikede (Endangered)',
    description: 'Otçul beslenen ve Akdeniz\'de özellikle İskenderun ve Akyatan lagünlerini kullanan kritik tür.',
    habitat: 'Deniz çayırları ve korunaklı koylar'
  },
  {
    id: 'vipera-kaznakovi',
    category: 'reptiles',
    turkishName: 'Kafkas Burunlu Engereği',
    scientificName: 'Vipera kaznakovi',
    family: 'Viperidae',
    iucnStatus: 'EN',
    iucnCategoryName: 'Tehlikede (Endangered)',
    description: 'Doğu Karadeniz\'in nemli vadilerinde (Artvin, Rize) yaşayan, göz alıcı kırmızı ve siyah desenli zehirli yılan.',
    habitat: 'Karadeniz nemli dere yatakları ve orman kenarları'
  },
  {
    id: 'varanus-griseus',
    category: 'reptiles',
    turkishName: 'Çöl Varanı',
    scientificName: 'Varanus griseus',
    family: 'Varanidae',
    iucnStatus: 'LC',
    iucnCategoryName: 'Asgari Endişe',
    description: 'Türkiye\'nin en büyük kertenkelesidir. Şanlıurfa Birecik ve Ceylanpınar yarı çöl arazilerinde bulunur.',
    habitat: 'Kumulluklar, killi topraklar ve yarı çöl alanlar'
  },

  // Deniz Canlıları
  {
    id: 'monachus-monachus',
    category: 'marine',
    turkishName: 'Akdeniz Foku',
    scientificName: 'Monachus monachus',
    family: 'Phocidae',
    iucnStatus: 'EN',
    iucnCategoryName: 'Tehlikede (Endangered)',
    description: 'Dünya popülasyonu 1000 civarında olan, Ege ve Akdeniz kıyılarındaki su altı mağaralarında barınan en nadir memelilerden biri.',
    habitat: 'İnsan baskısından uzak kayalık kıyı mağaraları'
  },
  {
    id: 'tursiops-truncatus',
    category: 'marine',
    turkishName: 'Şişeburunlu Yunus (Afalina)',
    scientificName: 'Tursiops truncatus',
    family: 'Delphinidae',
    iucnStatus: 'LC',
    iucnCategoryName: 'Asgari Endişe (Least Concern)',
    description: 'Boğazlar ve kıyı sularında düzenli olarak izlenen, zeki ve sosyal deniz memelisi.',
    habitat: 'Kıyısal sular ve boğaz akıntı bölgeleri'
  },
  {
    id: 'acipenser-sturio',
    category: 'marine',
    turkishName: 'Kolon Mersin Balığı',
    scientificName: 'Acipenser sturio',
    family: 'Acipenseridae',
    iucnStatus: 'CR',
    iucnCategoryName: 'Kritik Düzeyde Tehlikede (Critically Endangered)',
    description: 'Geçmişte Kızılırmak ve Sakarya nehirlerine yumurtlamak için giren, nesli tükenme eşiğindeki fosil balık.',
    habitat: 'Karadeniz suları ve büyük nehir deltaları'
  },

  // Amfibiler
  {
    id: 'rana-holtzi',
    category: 'amphibians',
    turkishName: 'Toros Kurbağası',
    scientificName: 'Rana holtzi',
    family: 'Ranidae',
    iucnStatus: 'CR',
    iucnCategoryName: 'Kritik Tehlikede (Critically Endangered)',
    description: 'Dünyada SADECE Niğde Bolkar Dağları\'ndaki Karagöl ve Çiniligöl\'de (2500m+) yaşayan endemik canlı.',
    habitat: 'Yüksek buzul gölleri ve alpin dağ çayırları'
  },
  {
    id: 'mertensiella-caucasica',
    category: 'amphibians',
    turkishName: 'Kafkas Semenderi',
    scientificName: 'Mertensiella caucasica',
    family: 'Salamandridae',
    iucnStatus: 'VU',
    iucnCategoryName: 'Hassas (Vulnerable)',
    description: 'Kuyruk dibindeki özel çıkıntısıyla bilinen, Doğu Karadeniz yaylalarının soğuk dağ derelerinde yaşayan endemik tür.',
    habitat: 'Soğuk dağ dereleri ve gölgeli nemli orman altları'
  },

  // Tehlike Altındakiler
  {
    id: 'endangered-geronticus',
    category: 'endangered',
    turkishName: 'Kelaynak',
    scientificName: 'Geronticus eremita',
    family: 'Threskiornithidae',
    iucnStatus: 'EN',
    iucnCategoryName: 'Tehlikede (Endangered)',
    description: 'Doğal üreme kolonileri insan müdahalesi ve pestisitler nedeniyle neredeyse yok olan, yapay koruma altındaki tür.',
    habitat: 'Güneydoğu Anadolu yarı çöl kayalıkları'
  },
  {
    id: 'endangered-monachus',
    category: 'endangered',
    turkishName: 'Akdeniz Foku',
    scientificName: 'Monachus monachus',
    family: 'Phocidae',
    iucnStatus: 'EN',
    iucnCategoryName: 'Tehlikede (Endangered)',
    description: 'Kıyı yapılaşması ve balıkçı ağları nedeniyle yaşam alanları daralan Akdeniz\'in en hassas canlısı.',
    habitat: 'Foça, Karaburun ve Kaş kıyı mağaraları'
  },
  {
    id: 'endangered-holtzi',
    category: 'endangered',
    turkishName: 'Toros Kurbağası',
    scientificName: 'Rana holtzi',
    family: 'Ranidae',
    iucnStatus: 'CR',
    iucnCategoryName: 'Kritik Tehlikede (CR)',
    description: 'Göllere sonradan aşılanan yabancı balık türleri ve aşırı turizm baskısı yüzünden tükenme riski yaşayan endemik hazine.',
    habitat: 'Bolkar Dağları Karagöl ve Çiniligöl'
  }
];

interface GbifBackboneMatchResult {
  usageKey?: number;
  acceptedUsageKey?: number;
  scientificName?: string;
  canonicalName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  rank?: string;
  status?: string;
  confidence?: number;
  matchType?: string;
  accepted?: string;
}

/**
 * GBIF Backbone üzerinden kesin tür eşleştirme ve sinonim -> kabul edilmiş takson yönlendirmesi
 */
async function verifyWithGbifBackbone(scientificCandidate: string): Promise<{
  matched: boolean;
  data: GbifBackboneMatchResult;
  synonymOf?: string;
}> {
  const formatted = formatScientificCandidate(scientificCandidate);
  const res = await fetchWithRetry(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(formatted)}&verbose=true`
  );
  const gbifData: GbifBackboneMatchResult = await res.json();

  if (!gbifData || gbifData.matchType === 'NONE' || !gbifData.usageKey) {
    return { matched: false, data: gbifData || {} };
  }

  let resolvedData: GbifBackboneMatchResult = gbifData;
  let synonymOf: string | undefined;

  // Sinonim bulunduğunda GBIF Backbone üzerindeki kabul edilmiş taksona yönlendir
  if (gbifData.status === 'SYNONYM' && gbifData.acceptedUsageKey) {
    try {
      const accRes = await fetchWithRetry(
        `https://api.gbif.org/v1/species/${gbifData.acceptedUsageKey}`
      );
      if (accRes.ok) {
        const accData = await accRes.json();
        if (accData && accData.key) {
          synonymOf = gbifData.canonicalName || gbifData.scientificName;
          resolvedData = {
            usageKey: accData.key,
            scientificName: accData.scientificName || gbifData.scientificName,
            canonicalName: accData.canonicalName || gbifData.canonicalName,
            kingdom: accData.kingdom || gbifData.kingdom,
            phylum: accData.phylum || gbifData.phylum,
            class: accData.class || gbifData.class,
            order: accData.order || gbifData.order,
            family: accData.family || gbifData.family,
            genus: accData.genus || gbifData.genus,
            rank: accData.rank || gbifData.rank,
            status: accData.taxonomicStatus || 'ACCEPTED',
            confidence: gbifData.confidence,
            matchType: gbifData.matchType,
          };
        }
      }
    } catch (synErr) {
      console.warn('Accepted taxon resolution failed:', synErr);
    }
  } else if (gbifData.status === 'SYNONYM' && gbifData.accepted) {
    synonymOf = gbifData.accepted;
  }

  return { matched: true, data: resolvedData, synonymOf };
}

function scoreCommonNameMatch(candidateName: string | undefined, query: string): number {
  if (!candidateName) return 0;
  const candLower = toTrLower(candidateName);
  const queryLower = toTrLower(query);
  const candFold = foldTurkishChars(candidateName);
  const queryFold = foldTurkishChars(query);

  if (candLower === queryLower || candFold === queryFold) return 100;

  const escaped = queryFold.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(`(?:^|\\s|-)${escaped}(?:$|\\s|-)`, 'i');
  if (wordRegex.test(candFold)) return 65;

  return 0;
}

interface DynamicCandidate {
  scientificName: string;
  commonName?: string;
  score: number;
}

/**
 * Sabit sözlükte olmayan Türkçe / İngilizce yaygın adlar için iNaturalist + GBIF Backbone VERNACULAR aday araması.
 * Yalnızca Animalia (SPECIES) adaylarını kabul eder; virüs/bitki/mantar/yazar-adı yanlış eşleşmelerini eler.
 */
async function resolveCommonNameCandidates(query: string): Promise<DynamicCandidate[]> {
  const clean = normalizeSearchQuery(query);
  if (!clean || clean.length < 2) return [];

  const [inatTrAuto, inatEnAuto, inatTrTaxa, inatEnTaxa, gbifVern] = await Promise.allSettled([
    fetchWithRetry(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&locale=tr&per_page=8`, undefined, 1, 6000).then(r => r.json()),
    fetchWithRetry(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&locale=en&per_page=8`, undefined, 1, 6000).then(r => r.json()),
    fetchWithRetry(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(clean)}&locale=tr&rank=species&per_page=8`, undefined, 1, 6000).then(r => r.json()),
    fetchWithRetry(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(clean)}&locale=en&rank=species&per_page=8`, undefined, 1, 6000).then(r => r.json()),
    fetchWithRetry(`https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&q=${encodeURIComponent(clean)}&qField=VERNACULAR&rank=SPECIES&status=ACCEPTED&limit=10`, undefined, 1, 6000).then(r => r.json()),
  ]);

  const candidateMap = new Map<string, DynamicCandidate>();

  const registerCandidate = (sci: string, commonName: string | undefined, score: number) => {
    if (!sci || score <= 0) return;
    const key = sci.toLowerCase();
    const existing = candidateMap.get(key);
    if (!existing || score > existing.score) {
      candidateMap.set(key, { scientificName: sci, commonName: commonName || existing?.commonName, score });
    }
  };

  // 1. iNaturalist adaylarını değerlendir (sadece Animalia iconic taxa + SPECIES)
  const inatSources = [inatTrAuto, inatEnAuto, inatTrTaxa, inatEnTaxa];
  for (const src of inatSources) {
    if (src.status !== 'fulfilled' || !Array.isArray(src.value?.results)) continue;
    for (const t of src.value.results) {
      if (!t || t.rank !== 'species' || !t.name) continue;
      const iconic = String(t.iconic_taxon_name || '').toLowerCase();
      if (!ANIMAL_INAT_ICONIC_TAXA.has(iconic)) continue;

      const prefScore = scoreCommonNameMatch(t.preferred_common_name, clean);
      const engScore = scoreCommonNameMatch(t.english_common_name, clean);
      const matchedTermIsNotSci =
        t.matched_term &&
        String(t.matched_term).toLowerCase() !== String(t.name).toLowerCase();
      const matchedTermScore = matchedTermIsNotSci
        ? scoreCommonNameMatch(t.matched_term, clean)
        : 0;

      const bestNameScore = Math.max(prefScore, engScore, matchedTermScore);
      if (bestNameScore === 0) continue;

      const obsCount = typeof t.observations_count === 'number' ? t.observations_count : 0;
      if (obsCount < 5 && bestNameScore < 100) continue;

      const obsBonus = Math.min(25, Math.log10(Math.max(1, obsCount)) * 4);
      registerCandidate(t.name, t.preferred_common_name || t.english_common_name, bestNameScore + obsBonus);
    }
  }

  // 2. GBIF Backbone VERNACULAR sonuçlarını değerlendir
  if (gbifVern.status === 'fulfilled' && Array.isArray(gbifVern.value?.results)) {
    for (const r of gbifVern.value.results) {
      if (!r || r.rank !== 'SPECIES' || !r.canonicalName) continue;
      const kingdom = String(r.kingdom || '').toLowerCase();
      if (kingdom !== 'animalia') continue;

      const vernNames: Array<{ vernacularName?: string; language?: string }> = Array.isArray(r.vernacularNames)
        ? r.vernacularNames
        : [];
      let bestVernScore = 0;
      let matchedVern = '';

      for (const v of vernNames) {
        if (!v?.vernacularName) continue;
        const lang = String(v.language || '').toLowerCase();
        if (lang && lang !== 'tur' && lang !== 'eng' && lang !== 'tr' && lang !== 'en') continue;
        const sc = scoreCommonNameMatch(v.vernacularName, clean);
        if (sc > bestVernScore) {
          bestVernScore = sc;
          matchedVern = v.vernacularName;
        }
      }

      if (bestVernScore >= 65) {
        registerCandidate(r.canonicalName, matchedVern, bestVernScore + 10);
      }
    }
  }

  return Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);
}

/**
 * GBIF Backbone API Tür Çözümleme (Türkçe, İngilizce ve Bilimsel Adlar)
 */
export async function matchSpecies(query: string): Promise<SpeciesInfo> {
  const normalizedInput = normalizeSearchQuery(query);
  const cacheKey = `species-match:v2:${toTrLower(normalizedInput)}`;
  const cached = getCached<SpeciesInfo>(cacheKey);
  if (cached) return cached;

  if (!normalizedInput || normalizedInput.length < 2) {
    return {
      scientificName: normalizedInput || query,
      canonicalName: normalizedInput || query,
      turkishName: normalizedInput || query,
      rank: 'SPECIES',
      isMatched: false,
      matchType: 'NONE',
      confidence: 0,
      iucnStatus: 'NE',
      iucnCategoryName: getIucnLabel('NE'),
      iucnSource: 'Geçerli bir tür adı girilmedi',
      iucnVerified: false,
      summary: 'Lütfen aramak istediğiniz canlı türünün Türkçe, İngilizce veya bilimsel adını girin.',
    };
  }

  // 1. Çift dilli (Türkçe & İngilizce) yaygın ad sözlüğünü kontrol et
  const commonEntry = lookupCommonSpeciesEntry(normalizedInput);
  let targetScientific = commonEntry ? commonEntry.scientificName : normalizedInput;
  let predefinedTurkishName = commonEntry?.turkishName || '';
  let predefinedEnglishName = commonEntry?.englishName || '';
  let predefinedIucn: string | undefined = commonEntry?.iucn;
  let iucnSource = 'Resmi IUCN değerlendirme kaydı bulunamadı (NE)';
  let iucnVerified = false;
  let ambiguityAlternatives: Array<{ scientificName: string; turkishName: string }> = commonEntry?.alternatives || [];

  if (predefinedIucn) {
    iucnSource = 'IUCN Kırmızı Liste / Canlı Atlası Referans Envanteri';
    iucnVerified = true;
  }

  try {
    let resolvedData: GbifBackboneMatchResult = {};
    let isMatched = false;
    let synonymOf: string | undefined;

    const wordCount = normalizedInput.split(' ').length;

    // 2. Doğrudan GBIF Backbone /species/match ile taksonomik doğrulama
    //    (Yaygın ad sözlüğünden gelmişse veya kullanıcı bilimsel ad yazmışsa)
    if (commonEntry || wordCount >= 2) {
      const directMatch = await verifyWithGbifBackbone(targetScientific);
      if (directMatch.matched) {
        const d = directMatch.data;
        const kingdomLower = String(d.kingdom || '').toLowerCase();
        const isVirusOrNoise =
          kingdomLower === 'viruses' ||
          kingdomLower === 'pararnavirae' ||
          kingdomLower === 'shotokuvirae';
        const hasValidConfidence = (d.confidence ?? 0) >= 75;
        const isAcceptedRank =
          d.rank === 'SPECIES' ||
          d.rank === 'SUBSPECIES' ||
          d.rank === 'VARIETY' ||
          (commonEntry !== null && Boolean(d.usageKey));

        if (!isVirusOrNoise && hasValidConfidence && isAcceptedRank) {
          resolvedData = d;
          synonymOf = directMatch.synonymOf;
          isMatched = true;
        }
      }
    }

    // 3. Doğrudan bilimsel ad eşleşmediyse Türkçe/İngilizce yaygın ad adaylarını
    //    iNaturalist + GBIF Backbone VERNACULAR üzerinden ara ve GBIF Backbone ile doğrula
    if (!isMatched && !commonEntry) {
      const candidates = await resolveCommonNameCandidates(normalizedInput);
      for (const cand of candidates.slice(0, 4)) {
        const backboneCheck = await verifyWithGbifBackbone(cand.scientificName);
        if (backboneCheck.matched && backboneCheck.data.usageKey) {
          const kingdomLower = String(backboneCheck.data.kingdom || '').toLowerCase();
          if (DISALLOWED_COMMON_KINGDOMS.has(kingdomLower)) continue;
          if (backboneCheck.data.rank !== 'SPECIES' && backboneCheck.data.rank !== 'SUBSPECIES') continue;

          resolvedData = backboneCheck.data;
          synonymOf = backboneCheck.synonymOf;
          targetScientific = resolvedData.canonicalName || cand.scientificName;
          isMatched = true;

          // Birden fazla güçlü hayvan adayı varsa belirsizlik bilgisi ekle
          const otherCandidates = candidates
            .filter(c => c.scientificName.toLowerCase() !== cand.scientificName.toLowerCase() && c.score >= 65)
            .slice(0, 3)
            .map(c => ({
              scientificName: c.scientificName,
              turkishName: c.commonName || c.scientificName,
            }));
          if (otherCandidates.length > 0) {
            ambiguityAlternatives = otherCandidates;
          }
          break;
        }
      }
    }

    // 4. Tek kelimelik bilimsel cins/tür sorgusu olarak son kontrol (yalnızca Animalia SPECIES veya kesin bilimsel cins)
    if (!isMatched && !commonEntry && wordCount === 1) {
      const singleMatch = await verifyWithGbifBackbone(normalizedInput);
      if (singleMatch.matched && singleMatch.data.usageKey) {
        const d = singleMatch.data;
        const kingdomLower = String(d.kingdom || '').toLowerCase();
        const isExactRankMatch = d.matchType === 'EXACT' && (d.confidence ?? 0) >= 95 && d.rank === 'SPECIES';
        if (isExactRankMatch && !DISALLOWED_COMMON_KINGDOMS.has(kingdomLower)) {
          resolvedData = d;
          synonymOf = singleMatch.synonymOf;
          isMatched = true;
        }
      }
    }

    // 5. Eşleşme bulunamadıysa uydurma bilimsel ad veya rastgele taxonKey döndürme!
    if (!isMatched || !resolvedData.usageKey) {
      const unmatchedResult: SpeciesInfo = {
        scientificName: normalizedInput,
        canonicalName: normalizedInput,
        turkishName: normalizedInput,
        rank: 'SPECIES',
        taxonomicStatus: 'UNMATCHED',
        matchType: 'NONE',
        confidence: 0,
        isMatched: false,
        iucnStatus: 'NE',
        iucnCategoryName: getIucnLabel('NE'),
        iucnSource: 'GBIF Backbone taksonomi arşivinde eşleşme bulunamadı',
        iucnVerified: false,
        summary: `"${normalizedInput}" araması için GBIF Backbone taksonomi veritabanında doğrulanmış bir canlı türü bulunamadı. Lütfen Türkçe, İngilizce veya bilimsel tür adını (ör. Aslan, Panthera leo, Su Samuru, Lutra lutra) kontrol ederek yeniden deneyin.`,
        gbifUrl: `https://www.gbif.org/species/search?q=${encodeURIComponent(normalizedInput)}`,
      };
      setCached(cacheKey, unmatchedResult, 5 * 60 * 1000);
      return unmatchedResult;
    }

    const scientificName = resolvedData.scientificName || resolvedData.canonicalName || targetScientific;
    const canonicalName = resolvedData.canonicalName || scientificName.split('(')[0].trim();

    // Eğer doğrudan bilimsel adla arandıysa çift dilli sözlükten Türkçe/İngilizce ek destek kontrolü
    if (!predefinedTurkishName) {
      const sciEntry = BILINGUAL_SPECIES_ENTRIES.find(
        e => e.entry.scientificName.toLowerCase() === canonicalName.toLowerCase()
      )?.entry;
      if (sciEntry) {
        predefinedTurkishName = sciEntry.turkishName;
        if (!predefinedEnglishName && sciEntry.englishName) {
          predefinedEnglishName = sciEntry.englishName;
        }
        if (!predefinedIucn && sciEntry.iucn) {
          predefinedIucn = sciEntry.iucn;
          iucnSource = 'IUCN Kırmızı Liste / Canlı Atlası Referans Envanteri';
          iucnVerified = true;
        }
      }
    }

    // iNaturalist üzerinden fotoğraf, Türkçe/İngilizce ad ve özet desteği (birebir bilimsel ad eşleşmesi ile)
    const inatInfo = await fetchInatTaxon(canonicalName);

    let finalIucn = predefinedIucn;
    let finalIucnCategory = getIucnLabel(predefinedIucn);

    if (inatInfo?.iucnStatus) {
      finalIucn = inatInfo.iucnStatus;
      finalIucnCategory = inatInfo.iucnCategoryName || getIucnLabel(finalIucn);
      iucnSource = 'iNaturalist & IUCN Kırmızı Liste Ortak Veri Ağı';
      iucnVerified = true;
    } else if (predefinedIucn) {
      finalIucn = predefinedIucn;
      finalIucnCategory = getIucnLabel(predefinedIucn);
    } else {
      // Kesin kural: Veri yoksa ASLA otomatik 'LC' atama, 'NE' (Not Evaluated) göster!
      finalIucn = 'NE';
      finalIucnCategory = 'Değerlendirilmemiş (Not Evaluated)';
      iucnSource = 'Resmi IUCN değerlendirme kaydı bulunamadı (NE)';
      iucnVerified = false;
    }

    let summaryText = inatInfo?.summary || '';
    if (ambiguityAlternatives.length > 0) {
      const altText = ambiguityAlternatives
        .map(a => `${a.turkishName} (${a.scientificName})`)
        .join(', ');
      const disambigNote = `Not: "${normalizedInput}" araması birden fazla türle ilişkili olabileceğinden birincil temsilci olarak ${predefinedTurkishName || inatInfo?.turkishName || canonicalName} (${canonicalName}) seçilmiştir. Diğer ilgili türler: ${altText}.`;
      summaryText = summaryText ? `${summaryText} ${disambigNote}` : disambigNote;
    }

    const result: SpeciesInfo = {
      usageKey: resolvedData.usageKey,
      scientificName,
      canonicalName,
      turkishName: predefinedTurkishName || inatInfo?.turkishName || canonicalName,
      englishName: predefinedEnglishName || inatInfo?.englishName,
      kingdom: resolvedData.kingdom || 'Animalia',
      phylum: resolvedData.phylum,
      class: resolvedData.class,
      order: resolvedData.order,
      family: resolvedData.family,
      genus: resolvedData.genus,
      rank: resolvedData.rank || 'SPECIES',
      taxonomicStatus: resolvedData.status || 'ACCEPTED',
      matchType: resolvedData.matchType,
      confidence: resolvedData.confidence,
      synonymOf,
      isMatched: true,
      photoUrl: inatInfo?.photoUrl,
      photoAttribution: inatInfo?.photoAttribution,
      iucnStatus: finalIucn,
      iucnCategoryName: finalIucnCategory,
      iucnSource,
      iucnVerified,
      summary: summaryText || undefined,
      inaturalistUrl: inatInfo?.inatUrl,
      gbifUrl: `https://www.gbif.org/species/${resolvedData.usageKey}`,
    };

    setCached(cacheKey, result);
    return result;
  } catch (error) {
    console.error('GBIF species match error:', error);
    return {
      scientificName: normalizedInput,
      canonicalName: normalizedInput,
      turkishName: predefinedTurkishName || normalizedInput,
      rank: 'SPECIES',
      isMatched: false,
      matchType: 'ERROR',
      confidence: 0,
      iucnStatus: predefinedIucn || 'NE',
      iucnCategoryName: getIucnLabel(predefinedIucn || 'NE'),
      iucnSource: 'Değerlendirilmemiş (Ağ Hatası / Çevrimdışı)',
      iucnVerified: false,
      summary: 'GBIF taksonomi sunucusuna bağlanırken bir hata oluştu. Lütfen bağlantınızı kontrol edip tekrar deneyin.',
      gbifUrl: `https://www.gbif.org/species/search?q=${encodeURIComponent(normalizedInput)}`,
    };
  }
}

/**
 * iNaturalist API'den fotoğraf, Türkçe/İngilizce isim ve özet çekme
 * (results[0] körü körüne alınmaz; bilimsel ad ve species rank eşleşmesi esas alınır)
 */
async function fetchInatTaxon(scientificName: string) {
  const cleanSci = normalizeSearchQuery(scientificName).toLowerCase();
  if (!cleanSci) return null;

  try {
    const res = await fetchWithRetry(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&locale=tr&per_page=10`,
      undefined,
      1,
      6000
    );
    const data = await res.json();
    if (!Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }

    const findExactMatch = (results: any[]) => {
      const exactSpecies = results.find(
        (t: any) =>
          typeof t?.name === 'string' &&
          t.name.toLowerCase() === cleanSci &&
          (t.rank === 'species' || t.rank === 'subspecies' || t.rank === 'variety')
      );
      return (
        exactSpecies ||
        results.find(
          (t: any) => typeof t?.name === 'string' && t.name.toLowerCase() === cleanSci
        )
      );
    };

    let exactAny = findExactMatch(data.results);

    // Eğer /taxa?q ilk 10'da birebir tür yoksa autocomplete ile species seviyesinde ara (örn: Lynx lynx)
    if (!exactAny) {
      try {
        const autoRes = await fetchWithRetry(
          `https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(scientificName)}&rank=species&locale=tr&per_page=10`,
          undefined,
          1,
          5000
        );
        const autoData = await autoRes.json();
        if (Array.isArray(autoData.results) && autoData.results.length > 0) {
          exactAny = findExactMatch(autoData.results);
        }
      } catch {
        // Fallback autocomplete hatası yoksayılır
      }
    }

    // Eşleşen gerçek tür bulunamadıysa başka cins/alt-familya sonucunu (Panthera, Lutrinae vb.) ASLA alma!
    if (!exactAny) {
      return null;
    }

    const taxon = exactAny;
    let englishCommonName: string | undefined = taxon.english_common_name || undefined;

    // locale=tr yanıtında english_common_name yoksa aynı taxon ID üzerinden İngilizce adını çek
    if (!englishCommonName && taxon.id) {
      try {
        const enRes = await fetchWithRetry(
          `https://api.inaturalist.org/v1/taxa/${taxon.id}?locale=en`,
          undefined,
          0,
          4000
        );
        const enData = await enRes.json();
        const enTaxon = enData?.results?.[0];
        if (enTaxon?.preferred_common_name) {
          englishCommonName = enTaxon.preferred_common_name;
        }
      } catch {
        // İngilizce ek ad isteği opsiyoneldir
      }
    }

    let iucnCode: string | undefined;
    let iucnLabel: string | undefined;

    if (taxon.conservation_status && taxon.conservation_status.status) {
      iucnCode = String(taxon.conservation_status.status).toUpperCase();
      iucnLabel = taxon.conservation_status.status_name || getIucnLabel(iucnCode);
    }

    return {
      turkishName: taxon.preferred_common_name,
      englishName: englishCommonName,
      photoUrl: taxon.default_photo?.medium_url || taxon.default_photo?.url,
      photoAttribution: taxon.default_photo?.attribution,
      iucnStatus: iucnCode,
      iucnCategoryName: iucnLabel,
      summary: taxon.wikipedia_summary,
      inatUrl: `https://www.inaturalist.org/taxa/${taxon.id}`,
    };
  } catch (e) {
    console.warn('iNaturalist API unavailable:', e);
  }
  return null;
}

/**
 * IUCN kodundan anlaşılır Türkçe etiket üretme (NE ve DD ayrımı korunmuştur)
 */
export function getIucnLabel(code?: string): string {
  switch (code?.toUpperCase()) {
    case 'EX': return 'Nesli Tükenmiş (Extinct)';
    case 'EW': return 'Doğada Tükenmiş (Extinct in the Wild)';
    case 'CR': return 'Kritik Düzeyde Tehlikede (Critically Endangered)';
    case 'EN': return 'Tehlikede (Endangered)';
    case 'VU': return 'Hassas (Vulnerable)';
    case 'NT': return 'Tehdite Yakın (Near Threatened)';
    case 'LC': return 'Asgari Endişe (Least Concern)';
    case 'DD': return 'Veri Yetersiz (Data Deficient)';
    case 'NE': return 'Değerlendirilmemiş (Not Evaluated)';
    default: return 'Değerlendirilmemiş (Not Evaluated)';
  }
}

const MIN_VALID_YEAR = 1500;
const FACET_PAGE_LIMIT = 1000;
const MAX_STATE_FACET_PAGES = 3;

function foldLatinDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractValidYear(
  rawYear: unknown,
  rawEventDate?: unknown,
  minYear = MIN_VALID_YEAR,
  maxYear = new Date().getFullYear()
): { year?: number; hasRawDate: boolean; isInvalid: boolean } {
  if (rawYear !== undefined && rawYear !== null && String(rawYear).trim() !== '') {
    const parsed = typeof rawYear === 'number' ? rawYear : Number(String(rawYear).trim());
    if (Number.isInteger(parsed) && parsed >= minYear && parsed <= maxYear) {
      return { year: parsed, hasRawDate: true, isInvalid: false };
    }
    return { hasRawDate: true, isInvalid: true };
  }

  if (typeof rawEventDate === 'string' && rawEventDate.trim()) {
    const trimmedDate = rawEventDate.trim();
    const isoMatch = trimmedDate.match(/(?:^|[^\d])((?:1[0-9]{3}|20[0-9]{2}))(?:$|[^\d])/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      // Basit ay/gün tutarlılık kontrolü (YYYY-MM-DD formatındaysa)
      const fullDateMatch = trimmedDate.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
      if (fullDateMatch) {
        const month = parseInt(fullDateMatch[2], 10);
        const day = fullDateMatch[3] ? parseInt(fullDateMatch[3], 10) : 1;
        if (month < 1 || month > 12 || day < 1 || day > 31) {
          return { hasRawDate: true, isInvalid: true };
        }
      }
      if (y >= minYear && y <= maxYear) {
        return { year: y, hasRawDate: true, isInvalid: false };
      }
    }
    return { hasRawDate: true, isInvalid: true };
  }

  return { hasRawDate: false, isInvalid: false };
}

/**
 * Belirli bir canlı türünün GBIF gözlem verilerini, yıllara ve bölgelere göre dağılımını çekme
 * @param scientificName Bilimsel ad veya Türkçe/İngilizce ad (örn: Ursus arctos, Bozayı, Lion)
 * @param optionsOrCountry Ülke kodu veya detaylı filtre opsiyonları
 */
export async function fetchSpeciesAnalysis(
  scientificName: string,
  optionsOrCountry: string | FetchSpeciesOptions = 'TR'
): Promise<SpeciesAnalysis> {
  // Normalize options
  const options: FetchSpeciesOptions = typeof optionsOrCountry === 'string'
    ? { countryCode: optionsOrCountry }
    : (optionsOrCountry || {});

  const countryCode = options.countryCode !== undefined ? options.countryCode : 'TR';
  const startYear = options.startYear;
  const endYear = options.endYear;
  const limit = options.limit || 300;
  const fetchExtraPages = options.fetchExtraPages ?? true;
  const currentYear = new Date().getFullYear();

  const cacheKey = `analysis:v3:${toTrLower(scientificName)}:${countryCode}:${startYear || ''}:${endYear || ''}:${limit}`;
  const cachedAnalysis = getCached<SpeciesAnalysis>(cacheKey);
  if (cachedAnalysis) return cachedAnalysis;

  // 1. Türün taksonomik kimlik ve GBIF Backbone usageKey bilgilerini çöz
  const species = await matchSpecies(scientificName);

  // Eşleşme bulunamadıysa doğrulanmamış sorguyla occurrence endpoint'ini çağırma
  if (!species.isMatched || !species.usageKey) {
    const emptyAnalysis: SpeciesAnalysis = {
      species,
      countryCode,
      countryName: countryCode === 'TR' ? 'Türkiye' : 'Tüm Dünya',
      totalRecords: 0,
      downloadedRecordsCount: 0,
      mappedRecordsCount: 0,
      unmappedRecordsCount: 0,
      unlocatedCount: 0,
      missingYearCount: 0,
      invalidYearCount: 0,
      yearFacetCount: 0,
      isYearFacetTruncated: false,
      isRegionFacetTruncated: false,
      filteredRegionCodeCount: 0,
      regionFacetTotalCount: 0,
      dateRange: { minYear: null, maxYear: null },
      earliestYear: null,
      peakYear: null,
      lowestYear: null,
      yearlyStats: [],
      regionalStats: [],
      occurrences: [],
      appliedFilters: {
        countryCode,
        countryName: countryCode === 'TR' ? 'Türkiye' : 'Tüm Dünya',
        startYear,
        endYear,
        taxonKey: undefined,
      },
      isArchiveFacetCalculated: false,
      dataQualityNotice: species.summary || `"${scientificName}" için GBIF Backbone arşivinde eşleşen tür bulunamadı.`,
      queriedAt: new Date().toISOString(),
    };
    setCached(cacheKey, emptyAnalysis, 5 * 60 * 1000);
    return emptyAnalysis;
  }

  // 2. GBIF Occurrence Search URL parametrelerini oluştur
  const countryParam = countryCode ? `&country=${countryCode}` : '';

  let yearParam = '';
  if (startYear && endYear) {
    yearParam = `&year=${startYear},${endYear}`;
  } else if (startYear) {
    yearParam = `&year=${startYear},${currentYear}`;
  } else if (endYear) {
    yearParam = `&year=${MIN_VALID_YEAR},${endYear}`;
  }

  // Yalnızca doğrulanmış GBIF Backbone taxonKey (usageKey) kullan
  const taxonParam = `taxonKey=${species.usageKey}`;

  // Küresel kesilmeleri önlemek için faset limiti 1000'e çıkarıldı
  const gbifUrl = `https://api.gbif.org/v1/occurrence/search?${taxonParam}${countryParam}${yearParam}&limit=${limit}&facet=year&facet=stateProvince&facetLimit=${FACET_PAGE_LIMIT}`;

  let totalRecords = 0;
  let yearlyStats: YearlyStat[] = [];
  let regionalStats: RegionStat[] = [];
  let occurrences: GBIFOccurrence[] = [];
  let unlocatedCount = 0;
  let missingYearCount: number | null = 0;
  let invalidYearCount = 0;
  let yearFacetCount = 0;
  let isYearFacetTruncated = false;
  let isRegionFacetTruncated = false;
  let filteredRegionCodeCount = 0;
  let regionFacetTotalCount = 0;
  let isArchiveFacetCalculated = false;

  try {
    const res = await fetchWithRetry(gbifUrl);
    const data = await res.json();

    totalRecords = typeof data.count === 'number' ? data.count : 0;

    // Ölçeklenebilir Sayfalama: Örneklem için concurrent istekler yap (en fazla 1.200 kayıt)
    if (totalRecords > limit && fetchExtraPages) {
      try {
        const maxRecordsToFetch = Math.min(1200, totalRecords);
        const pagePromises: Promise<any>[] = [];
        for (let offset = limit; offset < maxRecordsToFetch; offset += limit) {
          const batchLimit = Math.min(limit, maxRecordsToFetch - offset);
          const pageUrl = `https://api.gbif.org/v1/occurrence/search?${taxonParam}${countryParam}${yearParam}&offset=${offset}&limit=${batchLimit}`;
          pagePromises.push(
            fetchWithRetry(pageUrl)
              .then(r => r.json())
              .catch(err => {
                console.warn(`GBIF pagination offset ${offset} failed:`, err);
                return { results: [] };
              })
          );
        }

        const pageResults = await Promise.all(pagePromises);
        for (const pr of pageResults) {
          if (pr.results && Array.isArray(pr.results)) {
            data.results = [...(data.results || []), ...pr.results];
          }
        }
      } catch (pageErr) {
        console.warn('GBIF scalable pagination error:', pageErr);
      }
    }

    // Yıllık faset verilerini ayrıştır (gerekirse 2. faset sayfasıyla tamamla ve kesilmeyi takip et)
    const yearFacet = data.facets?.find((f: { field: string }) => f.field === 'YEAR');
    let rawYearCounts: Array<{ name: string; count: number }> = Array.isArray(yearFacet?.counts)
      ? [...yearFacet.counts]
      : [];

    if (rawYearCounts.length >= FACET_PAGE_LIMIT) {
      try {
        const extraYearUrl = `https://api.gbif.org/v1/occurrence/search?${taxonParam}${countryParam}${yearParam}&limit=0&facet=year&facetLimit=${FACET_PAGE_LIMIT}&facetOffset=${FACET_PAGE_LIMIT}`;
        const extraYearRes = await fetchWithRetry(extraYearUrl).then(r => r.json());
        const extraYearCounts = extraYearRes?.facets?.find((f: { field: string }) => f.field === 'YEAR')?.counts || [];
        rawYearCounts = [...rawYearCounts, ...extraYearCounts];
        if (extraYearCounts.length >= FACET_PAGE_LIMIT) {
          isYearFacetTruncated = true;
        }
      } catch (yearFacetErr) {
        console.warn('Extra YEAR facet pagination failed:', yearFacetErr);
        isYearFacetTruncated = true;
      }
    }

    if (rawYearCounts.length > 0) {
      isArchiveFacetCalculated = true;
      const validYearMap = new Map<number, number>();
      const seenRawYears = new Set<string>();

      for (const c of rawYearCounts) {
        const rawKey = String(c?.name ?? '');
        if (!rawKey || seenRawYears.has(rawKey)) continue;
        seenRawYears.add(rawKey);

        const count = typeof c.count === 'number' ? c.count : 0;
        const parsedYear = extractValidYear(c.name, undefined, MIN_VALID_YEAR, currentYear);
        if (parsedYear.year !== undefined) {
          validYearMap.set(parsedYear.year, (validYearMap.get(parsedYear.year) || 0) + count);
          yearFacetCount += count;
        } else {
          invalidYearCount += count;
        }
      }

      yearlyStats = Array.from(validYearMap.entries())
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year - b.year);
    }

    // İl / Bölge faset verilerini ayrıştır (gerekirse sayfalı faset çekimiyle 1000+ bölgeyi tamamla)
    const stateFacet = data.facets?.find((f: { field: string }) => f.field === 'STATE_PROVINCE');
    let rawStateCounts: Array<{ name: string; count: number }> = Array.isArray(stateFacet?.counts)
      ? [...stateFacet.counts]
      : [];

    if (rawStateCounts.length >= FACET_PAGE_LIMIT) {
      let pageIdx = 1;
      while (pageIdx < MAX_STATE_FACET_PAGES) {
        try {
          const offset = pageIdx * FACET_PAGE_LIMIT;
          const extraStateUrl = `https://api.gbif.org/v1/occurrence/search?${taxonParam}${countryParam}${yearParam}&limit=0&facet=stateProvince&facetLimit=${FACET_PAGE_LIMIT}&facetOffset=${offset}`;
          const extraStateRes = await fetchWithRetry(extraStateUrl).then(r => r.json());
          const extraCounts = extraStateRes?.facets?.find((f: { field: string }) => f.field === 'STATE_PROVINCE')?.counts || [];
          rawStateCounts = [...rawStateCounts, ...extraCounts];
          if (extraCounts.length < FACET_PAGE_LIMIT) {
            break;
          }
          pageIdx++;
          if (pageIdx >= MAX_STATE_FACET_PAGES) {
            isRegionFacetTruncated = true;
          }
        } catch (stateFacetErr) {
          console.warn('Extra STATE_PROVINCE facet pagination failed:', stateFacetErr);
          isRegionFacetTruncated = true;
          break;
        }
      }
    }

    if (rawStateCounts.length > 0) {
      isArchiveFacetCalculated = true;
      const seenRawStates = new Set<string>();
      // Global kapsamda aksan farkı ("Andalucía" vs "Andalucia") ve yazım birleştirme haritası
      const consolidatedRegions = new Map<string, { label: string; count: number; labelScore: number }>();

      for (const c of rawStateCounts) {
        const rawName = String(c?.name ?? '');
        if (!rawName || seenRawStates.has(rawName)) continue;
        seenRawStates.add(rawName);

        const count = typeof c.count === 'number' ? c.count : 0;
        regionFacetTotalCount += count;

        const cleanName = cleanProvinceName(rawName, countryCode);
        if (!cleanName) {
          filteredRegionCodeCount += count;
          continue;
        }

        const groupKey = countryCode === 'TR' ? cleanName : foldLatinDiacritics(cleanName);
        const hasDiacritics = cleanName !== foldLatinDiacritics(cleanName);
        const candidateScore = (hasDiacritics ? 10 : 0) + count * 0.0001;

        const existing = consolidatedRegions.get(groupKey);
        if (!existing) {
          consolidatedRegions.set(groupKey, { label: cleanName, count, labelScore: candidateScore });
        } else {
          existing.count += count;
          if (candidateScore > existing.labelScore) {
            existing.label = cleanName;
            existing.labelScore = candidateScore;
          }
        }
      }

      regionalStats = Array.from(consolidatedRegions.values())
        .map(({ label, count }) => ({
          region: label,
          count,
          percentage: totalRecords > 0 ? (count / totalRecords) * 100 : 0,
        }))
        .sort((a: RegionStat, b: RegionStat) => b.count - a.count);
    }

    // Tüm indirilen gözlem kayıtlarını (koordinatsızlar dahil) koru; koordinat ve tarihleri normalize et
    let sampleMissingYear = 0;
    let sampleInvalidYear = 0;

    if (data.results && Array.isArray(data.results)) {
      occurrences = data.results.map((r: Record<string, unknown>) => {
        const occKey = Number(r.key);
        const rawCountry = typeof r.country === 'string' && r.country.trim() ? r.country.trim() : undefined;
        const rawCountryCode = typeof r.countryCode === 'string' && r.countryCode.trim()
          ? r.countryCode.trim().toUpperCase()
          : undefined;
        const provinceCountryContext = rawCountryCode || countryCode;
        const parsedOccYear = extractValidYear(r.year, r.eventDate, MIN_VALID_YEAR, currentYear);

        if (parsedOccYear.isInvalid) {
          sampleInvalidYear++;
        } else if (parsedOccYear.year === undefined) {
          sampleMissingYear++;
        }

        return {
          key: occKey,
          scientificName: String(r.scientificName || species.scientificName),
          decimalLatitude: normalizeCoordinate(r.decimalLatitude),
          decimalLongitude: normalizeCoordinate(r.decimalLongitude),
          year: parsedOccYear.year,
          month: typeof r.month === 'number' && r.month >= 1 && r.month <= 12 ? r.month : undefined,
          day: typeof r.day === 'number' && r.day >= 1 && r.day <= 31 ? r.day : undefined,
          eventDate: typeof r.eventDate === 'string' ? r.eventDate : undefined,
          country: rawCountry,
          countryCode: rawCountryCode,
          stateProvince: typeof r.stateProvince === 'string'
            ? (cleanProvinceName(r.stateProvince, provinceCountryContext) || undefined)
            : undefined,
          locality: typeof r.locality === 'string' ? r.locality : undefined,
          basisOfRecord: typeof r.basisOfRecord === 'string' ? translateBasisOfRecord(r.basisOfRecord) : 'Gözlem Kaydı',
          institutionCode: typeof r.institutionCode === 'string' ? r.institutionCode : undefined,
          collectionCode: typeof r.collectionCode === 'string' ? r.collectionCode : undefined,
          catalogNumber: typeof r.catalogNumber === 'string' ? r.catalogNumber : undefined,
          recordedBy: typeof r.recordedBy === 'string' ? r.recordedBy : undefined,
          datasetName: typeof r.datasetName === 'string' ? r.datasetName : undefined,
          license: typeof r.license === 'string' ? r.license : undefined,
          references: typeof r.references === 'string' ? r.references : undefined
        };
      });
    }

    // Yalnızca GBIF YEAR faseti hiç dönmediyse indirilen örneklemden yedek hesapla (faset ile örneklemi karıştırma)
    if (yearlyStats.length === 0 && rawYearCounts.length === 0 && occurrences.length > 0) {
      const yearMap = new Map<number, number>();
      occurrences.forEach(o => {
        if (o.year !== undefined) {
          yearMap.set(o.year, (yearMap.get(o.year) || 0) + 1);
        }
      });
      yearlyStats = Array.from(yearMap.entries())
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year - b.year);

      if (occurrences.length === totalRecords) {
        missingYearCount = sampleMissingYear;
        invalidYearCount = sampleInvalidYear;
      } else {
        missingYearCount = null;
        invalidYearCount = sampleInvalidYear;
      }
      isArchiveFacetCalculated = false;
    } else if (isYearFacetTruncated) {
      // Faset sınırı aşıldıysa kalan farkın tamamını tarihsiz sayma!
      missingYearCount = null;
    } else {
      // Kesilmemiş YEAR fasetinde kalan fark doğrudan tarihsiz/geçersiz kayıtları temsil eder
      missingYearCount = Math.max(0, totalRecords - yearFacetCount - invalidYearCount);
    }

    if (regionalStats.length === 0 && rawStateCounts.length === 0 && occurrences.length > 0) {
      const regMap = new Map<string, number>();
      occurrences.forEach(o => {
        if (o.stateProvince) {
          regMap.set(o.stateProvince, (regMap.get(o.stateProvince) || 0) + 1);
        }
      });
      regionalStats = Array.from(regMap.entries())
        .map(([region, count]) => ({
          region,
          count,
          percentage: totalRecords > 0 ? (count / totalRecords) * 100 : 0
        }))
        .sort((a, b) => b.count - a.count);
    }

    // İl/bölge faseti kesildiyse faset dışı illeri "konumu belirtilmemiş kayıt" olarak sayma
    unlocatedCount = isRegionFacetTruncated
      ? 0
      : Math.max(0, totalRecords - regionFacetTotalCount);

    // Haritada gösterilebilen (doğrulanmış koordinatlı ve coğrafi bağlamı tutarlı) kayıtlar
    const mappedRecords = occurrences.filter(o =>
      isOccurrenceMappable(o, countryCode)
    );

    const downloadedRecordsCount = occurrences.length;
    const mappedRecordsCount = mappedRecords.length;
    const unmappedRecordsCount = Math.max(0, downloadedRecordsCount - mappedRecordsCount);

    // Yıl aralığı ve Zirve / İlk / En Az kayıt yılları
    const years = yearlyStats.map(y => y.year);
    const minYear = years.length > 0 ? Math.min(...years) : null;
    const maxYear = years.length > 0 ? Math.max(...years) : null;

    const earliestYear: { year: number; count: number } | null =
      yearlyStats.length > 0
        ? { year: yearlyStats[0].year, count: yearlyStats[0].count }
        : null;

    let peakYear: { year: number; count: number } | null = null;
    let lowestYear: { year: number; count: number } | null = null;

    if (yearlyStats.length > 0) {
      const sortedByCount = [...yearlyStats].sort((a, b) => b.count - a.count);
      peakYear = sortedByCount[0];
      lowestYear = sortedByCount[sortedByCount.length - 1];
    }

    // Kapsamlı ve dürüst veri kalitesi bildirimi
    const noticeParts: string[] = [];
    if (totalRecords > downloadedRecordsCount) {
      noticeParts.push(
        `GBIF arşivinde toplam ${totalRecords.toLocaleString('tr-TR')} kayıt bulunmaktadır. Yıl ve il dağılımları GBIF arşiv fasetlerinden hesaplanmış; harita ve detay tablosu için en fazla ${downloadedRecordsCount.toLocaleString('tr-TR')} kayıtlık örneklem indirilmiştir (${mappedRecordsCount.toLocaleString('tr-TR')} haritalanabilir GPS, ${unmappedRecordsCount.toLocaleString('tr-TR')} koordinatsız/kapsam dışı).`
      );
    }
    if (typeof missingYearCount === 'number' && missingYearCount > 0) {
      noticeParts.push(
        `Arşivde yıl/tarih bilgisi eksik ${missingYearCount.toLocaleString('tr-TR')} kayıt mevcuttur.`
      );
    }
    if (invalidYearCount > 0) {
      noticeParts.push(
        `${invalidYearCount.toLocaleString('tr-TR')} kayıt geçersiz veya aralık dışı tarih nedeniyle yıllık analiz dışında bırakılmıştır.`
      );
    }
    if (isYearFacetTruncated) {
      noticeParts.push('Yıllık faset yanıtı GBIF faset sınırına ulaştığı için kısmi kesilme olabilir.');
    }
    if (isRegionFacetTruncated) {
      noticeParts.push(
        `Bölgesel dağılım faseti çok fazla alt bölge içerdiğinden ilk ${(MAX_STATE_FACET_PAGES * FACET_PAGE_LIMIT).toLocaleString('tr-TR')} faset ile sınırlandı; kalan bölgeler il adı eksik kayıt olarak sayılmamıştır.`
      );
    }
    if (filteredRegionCodeCount > 0) {
      noticeParts.push(
        `${filteredRegionCodeCount.toLocaleString('tr-TR')} kayıt standart il adı yerine kısa kod (ör. Zh, Gr, Be) veya tanımsız ifade içerdiğinden il listesine eklenmemiştir.`
      );
    }

    const analysisResult: SpeciesAnalysis = {
      species,
      countryCode,
      countryName: countryCode === 'TR' ? 'Türkiye' : 'Tüm Dünya',
      totalRecords,
      downloadedRecordsCount,
      mappedRecordsCount,
      unmappedRecordsCount,
      unlocatedCount,
      missingYearCount,
      invalidYearCount,
      yearFacetCount,
      isYearFacetTruncated,
      isRegionFacetTruncated,
      filteredRegionCodeCount,
      regionFacetTotalCount,
      dateRange: {
        minYear,
        maxYear
      },
      earliestYear,
      peakYear,
      lowestYear,
      yearlyStats,
      regionalStats,
      occurrences, // Tüm geçerli gözlem kayıtları (koordinatsız olanlar dahil) korunur
      appliedFilters: {
        countryCode,
        countryName: countryCode === 'TR' ? 'Türkiye' : 'Tüm Dünya',
        startYear,
        endYear,
        taxonKey: species.usageKey,
      },
      isArchiveFacetCalculated,
      dataQualityNotice: noticeParts.length > 0 ? noticeParts.join(' ') : undefined,
      queriedAt: new Date().toISOString()
    };

    setCached(cacheKey, analysisResult);
    return analysisResult;

  } catch (err) {
    console.error('GBIF occurrences fetch failed:', err);
    throw err;
  }
}

export const TURKEY_PROVINCES: Record<string, string> = {
  'adana': 'Adana', 'adiyaman': 'Adıyaman', 'adıyaman': 'Adıyaman', 'afyon': 'Afyonkarahisar', 'afyonkarahisar': 'Afyonkarahisar',
  'agri': 'Ağrı', 'ağrı': 'Ağrı', 'aksaray': 'Aksaray', 'amasya': 'Amasya', 'ankara': 'Ankara', 'antalya': 'Antalya',
  'ardahan': 'Ardahan', 'artvin': 'Artvin', 'aydin': 'Aydın', 'aydın': 'Aydın', 'balikesir': 'Balıkesir', 'balıkesir': 'Balıkesir',
  'bartin': 'Bartın', 'bartın': 'Bartın', 'batman': 'Batman', 'bayburt': 'Bayburt', 'bilecik': 'Bilecik', 'bingol': 'Bingöl',
  'bingöl': 'Bingöl', 'bitlis': 'Bitlis', 'bolu': 'Bolu', 'burdur': 'Burdur', 'bursa': 'Bursa', 'canakkale': 'Çanakkale',
  'çanakkale': 'Çanakkale', 'cankiri': 'Çankırı', 'çankırı': 'Çankırı', 'corum': 'Çorum', 'çorum': 'Çorum', 'denizli': 'Denizli',
  'diyarbakir': 'Diyarbakır', 'diyarbakır': 'Diyarbakır', 'duzce': 'Düzce', 'düzce': 'Düzce', 'edirne': 'Edirne',
  'elazig': 'Elazığ', 'elazığ': 'Elazığ', 'erzincan': 'Erzincan', 'erzurum': 'Erzurum', 'eskisehir': 'Eskişehir',
  'eskişehir': 'Eskişehir', 'gaziantep': 'Gaziantep', 'giresun': 'Giresun', 'gumushane': 'Gümüşhane', 'gümüşhane': 'Gümüşhane',
  'hakkari': 'Hakkâri', 'hakkâri': 'Hakkâri', 'hatay': 'Hatay', 'igdir': 'Iğdır', 'ığdır': 'Iğdır', 'isparta': 'Isparta',
  'ısparta': 'Isparta', 'istanbul': 'İstanbul', 'i̇stanbul': 'İstanbul', 'izmir': 'İzmir', 'i̇zmir': 'İzmir',
  'kahramanmaras': 'Kahramanmaraş', 'kahramanmaraş': 'Kahramanmaraş', 'maraş': 'Kahramanmaraş', 'karabuk': 'Karabük', 'karabük': 'Karabük',
  'karaman': 'Karaman', 'kars': 'Kars', 'kastamonu': 'Kastamonu', 'kayseri': 'Kayseri', 'kilis': 'Kilis',
  'kirikkale': 'Kırıkkale', 'kırıkkale': 'Kırıkkale', 'kirklareli': 'Kırklareli', 'kırklareli': 'Kırklareli',
  'kirsehir': 'Kırşehir', 'kırşehir': 'Kırşehir', 'kocaeli': 'Kocaeli', 'izmit': 'Kocaeli', 'konya': 'Konya', 'kutahya': 'Kütahya',
  'kütahya': 'Kütahya', 'malatya': 'Malatya', 'manisa': 'Manisa', 'mardin': 'Mardin', 'mersin': 'Mersin',
  'içel': 'Mersin', 'icel': 'Mersin', 'mugla': 'Muğla', 'muğla': 'Muğla', 'mus': 'Muş', 'muş': 'Muş', 'nevsehir': 'Nevşehir',
  'nevşehir': 'Nevşehir', 'nigde': 'Niğde', 'niğde': 'Niğde', 'ordu': 'Ordu', 'osmaniye': 'Osmaniye', 'rize': 'Rize',
  'sakarya': 'Sakarya', 'adapazarı': 'Sakarya', 'samsun': 'Samsun', 'sanliurfa': 'Şanlıurfa', 'şanlıurfa': 'Şanlıurfa', 'urfa': 'Şanlıurfa',
  'siirt': 'Siirt', 'sinop': 'Sinop', 'sivas': 'Sivas', 'sirnak': 'Şırnak', 'şırnak': 'Şırnak', 'tekirdag': 'Tekirdağ',
  'tekirdağ': 'Tekirdağ', 'tokat': 'Tokat', 'trabzon': 'Trabzon', 'tunceli': 'Tunceli', 'usak': 'Uşak', 'uşak': 'Uşak',
  'van': 'Van', 'yalova': 'Yalova', 'yozgat': 'Yozgat', 'zonguldak': 'Zonguldak'
};

const TURKEY_ISO_CODES: Record<string, string> = {
  'TR-01': 'Adana', 'TR-02': 'Adıyaman', 'TR-03': 'Afyonkarahisar', 'TR-04': 'Ağrı', 'TR-05': 'Amasya',
  'TR-06': 'Ankara', 'TR-07': 'Antalya', 'TR-08': 'Artvin', 'TR-09': 'Aydın', 'TR-10': 'Balıkesir',
  'TR-11': 'Bilecik', 'TR-12': 'Bingöl', 'TR-13': 'Bitlis', 'TR-14': 'Bolu', 'TR-15': 'Burdur',
  'TR-16': 'Bursa', 'TR-17': 'Çanakkale', 'TR-18': 'Çankırı', 'TR-19': 'Çorum', 'TR-20': 'Denizli',
  'TR-21': 'Diyarbakır', 'TR-22': 'Edirne', 'TR-23': 'Elazığ', 'TR-24': 'Erzincan', 'TR-25': 'Erzurum',
  'TR-26': 'Eskişehir', 'TR-27': 'Gaziantep', 'TR-28': 'Giresun', 'TR-29': 'Gümüşhane', 'TR-30': 'Hakkâri',
  'TR-31': 'Hatay', 'TR-32': 'Isparta', 'TR-33': 'Mersin', 'TR-34': 'İstanbul', 'TR-35': 'İzmir',
  'TR-36': 'Kars', 'TR-37': 'Kastamonu', 'TR-38': 'Kayseri', 'TR-39': 'Kırklareli', 'TR-40': 'Kırşehir',
  'TR-41': 'Kocaeli', 'TR-42': 'Konya', 'TR-43': 'Kütahya', 'TR-44': 'Malatya', 'TR-45': 'Manisa',
  'TR-46': 'Kahramanmaraş', 'TR-47': 'Mardin', 'TR-48': 'Muğla', 'TR-49': 'Muş', 'TR-50': 'Nevşehir',
  'TR-51': 'Niğde', 'TR-52': 'Ordu', 'TR-53': 'Rize', 'TR-54': 'Sakarya', 'TR-55': 'Samsun',
  'TR-56': 'Siirt', 'TR-57': 'Sinop', 'TR-58': 'Sivas', 'TR-59': 'Tekirdağ', 'TR-60': 'Tokat',
  'TR-61': 'Trabzon', 'TR-62': 'Tunceli', 'TR-63': 'Şanlıurfa', 'TR-64': 'Uşak', 'TR-65': 'Van',
  'TR-66': 'Yozgat', 'TR-67': 'Zonguldak', 'TR-68': 'Aksaray', 'TR-69': 'Bayburt', 'TR-70': 'Karaman',
  'TR-71': 'Kırıkkale', 'TR-72': 'Batman', 'TR-73': 'Şırnak', 'TR-74': 'Bartın', 'TR-75': 'Ardahan',
  'TR-76': 'Iğdır', 'TR-77': 'Yalova', 'TR-78': 'Karabük', 'TR-79': 'Kilis', 'TR-80': 'Osmaniye',
  'TR-81': 'Düzce'
};

const NON_EQUATORIAL_ZERO_ZERO_COUNTRIES = new Set([
  'TR', 'US', 'CA', 'MX', 'GB', 'FR', 'DE', 'ES', 'IT', 'GR', 'RU', 'CN', 'JP', 'AU', 'NZ', 'IN', 'SE', 'NO', 'FI', 'PL', 'UA', 'RO', 'BG', 'IR', 'IQ', 'SY', 'GE', 'AZ', 'AM'
]);

/**
 * Sayısal veya metin tabanlı ("39.123") koordinat değerlerini güvenli sayıya dönüştürür.
 */
export function normalizeCoordinate(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Enlem (-90..90) ve boylam (-180..180) değerlerini merkezi olarak doğrular ve sayıya çevirir.
 * 0 değerini tek başına geçersiz saymaz.
 */
export function parseValidCoordinates(
  lat: unknown,
  lon: unknown
): { lat: number; lon: number } | null {
  const nLat = normalizeCoordinate(lat);
  const nLon = normalizeCoordinate(lon);
  if (nLat === undefined || nLon === undefined) return null;
  if (nLat < -90 || nLat > 90 || nLon < -180 || nLon > 180) return null;
  return { lat: nLat, lon: nLon };
}

export function isValidCoordinateRange(lat: unknown, lon: unknown): boolean {
  return parseValidCoordinates(lat, lon) !== null;
}

/**
 * Türkiye coğrafi sınırları (kıyı ve denizel habitatlar dahil) ve kaynak bağlamında koordinat doğrulama
 */
export function isWithinTurkeyBounds(
  lat?: unknown,
  lon?: unknown,
  sourceCountryCode?: string
): boolean {
  const coords = parseValidCoordinates(lat, lon);
  if (!coords) return false;
  if (sourceCountryCode && sourceCountryCode.trim().toUpperCase() !== 'TR') {
    return false;
  }
  return coords.lat >= 35.3 && coords.lat <= 42.4 && coords.lon >= 25.4 && coords.lon <= 45.0;
}

/**
 * Bir gözlem kaydının haritada işaretlenebilir olup olmadığını coğrafi bağlama göre değerlendirir.
 * (0,0) koordinatını otomatik olarak silmez; GBIF ZERO_COORDINATE bayrağı veya ülke bağlamı çelişiyorsa hariç tutar.
 */
export function isOccurrenceMappable(
  occ: {
    decimalLatitude?: unknown;
    decimalLongitude?: unknown;
    countryCode?: string;
  },
  filterCountryCode: string = '',
  issues?: unknown[]
): boolean {
  const coords = parseValidCoordinates(occ.decimalLatitude, occ.decimalLongitude);
  if (!coords) return false;

  const occCountry = occ.countryCode?.trim().toUpperCase();

  if (filterCountryCode === 'TR') {
    return isWithinTurkeyBounds(coords.lat, coords.lon, occCountry);
  }

  if (coords.lat === 0 && coords.lon === 0) {
    if (Array.isArray(issues) && issues.includes('ZERO_COORDINATE')) {
      return false;
    }
    if (occCountry && NON_EQUATORIAL_ZERO_ZERO_COUNTRIES.has(occCountry)) {
      return false;
    }
  }

  return true;
}

/**
 * İl adlarındaki olası fazlalıkları temizleme, ISO kodlarını ve Türkçe adları konsolide etme
 */
export function cleanProvinceName(raw?: string, countryCode = 'TR'): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.normalize('NFC').trim();
  if (!trimmed) return '';

  if (countryCode === 'TR') {
    const upperCode = trimmed.toUpperCase();
    if (TURKEY_ISO_CODES[upperCode]) {
      return TURKEY_ISO_CODES[upperCode];
    }

    const lowered = trimmed
      .toLocaleLowerCase('tr-TR')
      .replace(/\u0307/g, '')
      .replace(/[()[\]]/g, ' ')
      .replace(/[,/].*$/g, ' ')
      .replace(/(?:^|\s)(province|ili|vilayeti|valiliği|state|region|district|municipality|merkez|turkey|türkiye)(?=\s|$)/g, ' ')
      .replace(/[0-9]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (TURKEY_PROVINCES[lowered]) {
      return TURKEY_PROVINCES[lowered];
    }

    const folded = foldTurkishChars(lowered);
    if (TURKEY_PROVINCES[folded]) {
      return TURKEY_PROVINCES[folded];
    }
  }

  const name = trimmed
    .replace(/\b(Province|State|Region|District|County|Prefecture|Oblast)\b/gi, '')
    .replace(/(?:^|\s)(İli|Ili|Vilayeti|Valiliği)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // "Zh", "Gr", "Be" gibi 2 harfli kısaltma kodlarını otomatik gerçek il/bölge adı sayma;
  // ancak 3+ harfli geçerli kısa adları (Van, Muş, Goa, Zug, Uri, Osh vb.) koru.
  if (
    /^\d+$/.test(name) ||
    name.length < 3 ||
    /^(null|undefined|tr|turkey|türkiye|none|unknown|not applicable|unspecified|other)$/i.test(name)
  ) {
    return '';
  }
  return name.charAt(0).toLocaleUpperCase('tr-TR') + name.slice(1);
}

/**
 * GBIF BasisOfRecord kodlarını anlaşılır Türkçeye çevirme
 */
export function translateBasisOfRecord(basis?: string): string {
  switch (basis) {
    case 'HUMAN_OBSERVATION': return 'Saha İnsan Gözlemi';
    case 'PRESERVED_SPECIMEN': return 'Müze / Koleksiyon Örneği';
    case 'MACHINE_OBSERVATION': return 'Fotokapan / Sensör Kaydı';
    case 'OBSERVATION': return 'Doğrulanmış Gözlem';
    case 'MATERIAL_SAMPLE': return 'Biyolojik Numune';
    case 'LIVING_SPECIMEN': return 'Yaşayan Örnek / Botanik Parkı';
    case 'FOSSIL_SPECIMEN': return 'Fosil Kaydı';
    default: return basis || 'Gözlem Kaydı';
  }
}

// ============================================================================
// FAZ 1: GENEL TÜR KEŞİF SİSTEMİ & ÜST TAKSON DOĞRULAMA MOTORU
// (Mevcut matchSpecies, fetchSpeciesAnalysis ve 5A.1 faset kodlarını bozmaz)
// ============================================================================

const HIGHER_TAXON_RANKS = new Set([
  'GENUS',
  'SUBGENUS',
  'FAMILY',
  'SUBFAMILY',
  'TRIBE',
  'ORDER',
  'SUBORDER',
  'INFRAORDER',
  'CLASS',
  'SUBCLASS',
  'PHYLUM',
]);

const SPECIES_LEVEL_RANKS = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM']);

const DOMESTIC_CANONICAL_NAMES = new Set([
  'felis catus',
  'canis familiaris',
  'bos taurus',
  'ovis aries',
  'capra hircus',
  'equus caballus',
  'equus asinus',
  'gallus gallus',
  'anas platyrhynchos',
  'columba livia',
  'sus domesticus',
]);

const DEFAULT_FACET_FETCH_LIMIT = 200;
const DISCOVERY_CONCURRENCY_LIMIT = 3;

export interface TaxonGroupMemberSpec {
  scientificName: string;
  expectedRank?: string;
  expectedClass?: string;
  expectedFamily?: string;
}

export interface TaxonGroupSubgroupProfile {
  id: string;
  label: string;
  description: string;
  members: TaxonGroupMemberSpec[];
  excludedScientificNames?: string[];
  excludedOrderNames?: string[];
  excludedFamilyNames?: string[];
  excludedGenusNames?: string[];
  excludedClassNames?: string[];
  excludedTaxonKeys?: number[];
  allowedCanonicalNames?: string[];
  mergedEquivalents?: Record<string, string>;
  genusBiologicalLabels?: Record<string, string>;
  allowDomestic?: boolean;
  membershipPolicyNote?: string;
}

export interface TaxonGroupProfile {
  id: string;
  displayName: string;
  aliases: string[];
  subgroups: TaxonGroupSubgroupProfile[];
}

export const TAXONOMIC_GROUP_PROFILES: TaxonGroupProfile[] = [
  {
    id: 'tilki',
    displayName: 'Tilki Türleri',
    aliases: ['tilki', 'tilkiler', 'tilki türleri', 'fox', 'foxes'],
    subgroups: [
      {
        id: 'tilki-gercek',
        label: 'Tüm Tilki Cinsleri (Vulpes ve İlgili Tilkiler)',
        description: 'Gerçek tilkiler (Vulpes) ve yakın tilki cinslerini (Urocyon, Cerdocyon, Otocyon, Lycalopex) kapsar.',
        members: [
          { scientificName: 'Vulpes', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
          { scientificName: 'Urocyon', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
          { scientificName: 'Cerdocyon', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
          { scientificName: 'Otocyon', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
          { scientificName: 'Lycalopex', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
        ],
        genusBiologicalLabels: {
          vulpes: 'Gerçek Tilki (Vulpes)',
          urocyon: 'Boz Tilki Cinsi (Urocyon)',
          cerdocyon: 'Yengeç Yiyen Tilki (Cerdocyon)',
          otocyon: 'İri Kulaklı Tilki (Otocyon)',
          lycalopex: 'Güney Amerika Tilkisi / Zorro (Lycalopex)',
        },
        membershipPolicyNote: 'Yalnızca yaşayan veya doğrulanmış tilki cinsleri listelenir; doğrulanmamış tarihsel adlar belirsiz olarak işaretlenir.',
      },
      {
        id: 'tilki-vulpes',
        label: 'Gerçek Tilkiler (Vulpes)',
        description: 'Kızıl tilki, kutup tilkisi, çöl tilkisi (fennek) ve korsak gibi Vulpes cinsi türleri.',
        members: [
          { scientificName: 'Vulpes', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
        ],
        genusBiologicalLabels: {
          vulpes: 'Gerçek Tilki (Vulpes)',
        },
      },
    ],
  },
  {
    id: 'kurt',
    displayName: 'Kurt Türleri',
    aliases: ['kurt', 'kurtlar', 'kurt türleri', 'wolf', 'wolves'],
    subgroups: [
      {
        id: 'kurt-gercek',
        label: 'Gerçek Kurtlar (Biyolojik Kurt Türleri)',
        description: 'Bozkurt (Canis lupus), Doğu Kanada kurdu (C. lycaon), Habeş kurdu (C. simensis) ve Afrika altın kurdu (C. lupaster kompleksi). Çakallar, koyote, yeleli kurt, Asya yaban köpeği ve evcil köpek kayıtları hariçtir.',
        members: [
          { scientificName: 'Canis', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
        ],
        allowedCanonicalNames: [
          'Canis lupus',
          'Canis lycaon',
          'Canis simensis',
          'Canis lupaster',
          'Canis anthus',
        ],
        mergedEquivalents: {
          'canis anthus': 'canis lupaster',
        },
        excludedScientificNames: [
          'Canis aureus',
          'Canis adustus',
          'Canis mesomelas',
          'Canis latrans',
          'Canis familiaris',
          'Cuon alpinus',
          'Canis alopex',
          'Canis primaevus',
          'Canis niger',
        ],
        excludedTaxonKeys: [6164210, 5219200], // Canis lupus familiaris & Canis familiaris evcil köpek kayıtları Bozkurt sayacından düşülür
        excludedOrderNames: ['Araneae'],
        excludedFamilyNames: ['Lycosidae'],
        genusBiologicalLabels: {
          canis: 'Biyolojik Kurt Türü (Canis lupus / lycaon / simensis / lupaster)',
        },
        membershipPolicyNote: 'Yalnızca cins adına bakılarak tür kabul edilmez. Çakallar, koyote, Asya yaban köpeği (Cuon alpinus) ve evcil köpek alt türü (Canis lupus familiaris) gerçek kurtlardan ayrılmıştır.',
      },
      {
        id: 'kurt-cakallar',
        label: 'Çakallar (Altın, Çizgili ve Kara Sırtlı Çakal)',
        description: 'Biyolojik olarak kurt değil çakal olan türler: Altın çakal (Canis aureus), Çizgili çakal (C. adustus) ve Kara sırtlı çakal (C. mesomelas).',
        members: [
          { scientificName: 'Canis', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
        ],
        allowedCanonicalNames: ['Canis aureus', 'Canis adustus', 'Canis mesomelas'],
        genusBiologicalLabels: {
          canis: 'Çakal Türü (Kurt Değil)',
        },
        membershipPolicyNote: 'Canis cinsinde yer almalarına rağmen biyolojik ve yaygın ad bakımından kurt değil çakaldır.',
      },
      {
        id: 'kurt-koyote',
        label: 'Koyote / Kır Kurdu (Canis latrans)',
        description: 'Kuzey Amerika kökenli kır kurdu / koyote (Canis latrans). Gerçek bozkurtlardan ve çakallardan ayrı değerlendirilir.',
        members: [
          { scientificName: 'Canis', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
        ],
        allowedCanonicalNames: ['Canis latrans'],
        genusBiologicalLabels: {
          canis: 'Koyote / Kır Kurdu (Canis latrans)',
        },
        membershipPolicyNote: 'Türkçede yaygın olarak kır kurdu adıyla anılsa da biyolojik olarak koyote (prairie wolf) ayrı bir alt grup olarak sunulur.',
      },
      {
        id: 'kurt-yeleli',
        label: 'Yeleli Kurt (Chrysocyon brachyurus)',
        description: 'Güney Amerika savanlarına özgü Chrysocyon cinsinin tek yaşayan türü; gerçek kurtlardan (Canis) evrimsel olarak ayrıdır.',
        members: [
          { scientificName: 'Chrysocyon', expectedRank: 'GENUS', expectedFamily: 'Canidae' },
        ],
        allowedCanonicalNames: ['Chrysocyon brachyurus'],
        genusBiologicalLabels: {
          chrysocyon: 'Yeleli Kurt (Chrysocyon — Güney Amerika Canid)',
        },
        membershipPolicyNote: 'Yaygın adı kurt olsa da Canis cinsi gerçek kurtlarla aynı alt grupta gösterilmez.',
      },
    ],
  },
  {
    id: 'ayi',
    displayName: 'Ayı Türleri',
    aliases: ['ayı', 'ayılar', 'ayı türleri', 'bear', 'bears'],
    subgroups: [
      {
        id: 'ayi-ursidae',
        label: 'Ayıgiller (Ursidae)',
        description: 'Bozayı, kutup ayısı, Amerikan kara ayısı, Asya kara ayısı, dev panda ve diğer yaşayan Ursidae türleri.',
        members: [
          { scientificName: 'Ursidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
        ],
        genusBiologicalLabels: {
          ursus: 'Ursus Cinsi Ayı',
          tremarctos: 'And Ayısı (Tremarctos)',
          melursus: 'Tembel Ayı (Melursus)',
          helarctos: 'Güneş Ayısı (Helarctos)',
          ailuropoda: 'Dev Panda (Ailuropoda — Ursidae)',
        },
        membershipPolicyNote: 'Fosil türler (ör. Ursus spelaeus) hariç tutulur; yaşayan statüsü doğrulanamayan tarihsel kayıtlar (ör. Ursus ingressus) belirsiz/tarihsel olarak işaretlenir.',
      },
    ],
  },
  {
    id: 'kartal',
    displayName: 'Kartal Türleri',
    aliases: ['kartal', 'kartallar', 'kartal türleri', 'eagle', 'eagles'],
    subgroups: [
      {
        id: 'kartal-gercek',
        label: 'Gerçek & Tepeli Kartallar (Aquila, Clanga kompleksi, Hieraaetus, Harpia vb.)',
        description: 'Gerçek kartallar (Aquila / Clanga kompleksi, Hieraaetus), tropikal orman/tepeli kartallar (Harpia, Pithecophaga, Morphnus, Harpyopsis) ve atmaca kartalları (Spizaetus, Nisaetus). Şahin, atmaca, akbaba, çaylak, balık kartalı ve yılan kartalları hariçtir.',
        members: [
          { scientificName: 'Aquila', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Hieraaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Lophaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Polemaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Stephanoaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Ictinaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Spizaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Nisaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Harpia', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Pithecophaga', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Morphnus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Harpyopsis', expectedRank: 'GENUS', expectedClass: 'Aves' },
        ],
        excludedGenusNames: ['Buteo', 'Accipiter', 'Gyps', 'Milvus', 'Circus', 'Pandion', 'Circaetus', 'Terathopius', 'Haliaeetus', 'Icthyophaga'],
        genusBiologicalLabels: {
          aquila: 'Gerçek Kartal (Aquila / Aquilinae)',
          hieraaetus: 'Cüce / Gerçek Kartal (Hieraaetus)',
          lophaetus: 'Sorguçlu Kartal (Lophaetus)',
          polemaetus: 'Dövüşken Kartal (Polemaetus)',
          stephanoaetus: 'Taçlı Kartal (Stephanoaetus)',
          ictinaetus: 'Kara Kartal (Ictinaetus)',
          spizaetus: 'Atmaca Kartalı (Spizaetus)',
          nisaetus: 'Atmaca Kartalı (Nisaetus)',
          harpia: 'Harpi Kartalı (Harpiinae)',
          pithecophaga: 'Filipin Kartalı (Pithecophaga)',
          morphnus: 'Tepeli Orman Kartalı (Morphnus)',
          harpyopsis: 'Papua Kartalı (Harpyopsis)',
        },
        membershipPolicyNote: 'Clanga (Büyük/Küçük Orman Kartalı) GBIF Backbone içinde Aquila altında yer alır. Şahin (Buteo), atmaca (Accipiter), akbaba (Gyps), çaylak (Milvus), delice (Circus), balık kartalı ve yılan kartalları karıştırılmaz.',
      },
      {
        id: 'kartal-deniz',
        label: 'Deniz & Balıkçı Kartalları (Haliaeetus / Icthyophaga)',
        description: 'Ak kuyruklu kartal, kel kartal ve deniz/balıkçı kartalı cinsleri (Haliaeetus, Icthyophaga).',
        members: [
          { scientificName: 'Haliaeetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Icthyophaga', expectedRank: 'GENUS', expectedClass: 'Aves' },
        ],
        genusBiologicalLabels: {
          haliaeetus: 'Deniz Kartalı (Haliaeetus)',
          icthyophaga: 'Balıkçı Kartal (Icthyophaga)',
        },
        membershipPolicyNote: 'Deniz ve balıkçı kartalları (Haliaeetinae) gerçek kara kartallarından (Aquilinae) ayrı alt grupta sunulur.',
      },
      {
        id: 'kartal-yilan',
        label: 'Yılan Kartalları & Cambaz Kartal (Circaetus / Terathopius)',
        description: 'Yılan kartalları (Circaetus) ve ayrı bir Circaetinae türü olan Cambaz Kartal / Bateleur (Terathopius ecaudatus).',
        members: [
          { scientificName: 'Circaetus', expectedRank: 'GENUS', expectedClass: 'Aves' },
          { scientificName: 'Terathopius', expectedRank: 'GENUS', expectedClass: 'Aves' },
        ],
        genusBiologicalLabels: {
          circaetus: 'Yılan Kartalı (Circaetus — Circaetinae)',
          terathopius: 'Cambaz Kartal / Bateleur (Terathopius ecaudatus — gerçek kartal değil)',
        },
        membershipPolicyNote: 'Circaetus türleri yılan kartalıdır; Terathopius ecaudatus ise gerçek Aquila kartalı olarak etiketlenmez, kendi yaygın adı (Cambaz Kartal / Bateleur) ile tanımlanır.',
      },
      {
        id: 'kartal-balik',
        label: 'Balık Kartalı (Pandion — Pandionidae)',
        description: 'Accipitridae dışındaki ayrı Pandionidae familyasına ait balık kartalı (Osprey) türleri.',
        members: [
          { scientificName: 'Pandion', expectedRank: 'GENUS', expectedClass: 'Aves' },
        ],
        genusBiologicalLabels: {
          pandion: 'Balık Kartalı / Osprey (Pandionidae familyası)',
        },
        membershipPolicyNote: 'Biyolojik olarak Accipitridae kartallarından ayrı Pandionidae familyasında yer alır.',
      },
    ],
  },
  {
    id: 'geyik',
    displayName: 'Geyik Türleri',
    aliases: ['geyik', 'geyikler', 'geyik türleri', 'deer'],
    subgroups: [
      {
        id: 'geyik-cervidae',
        label: 'Geyikgiller (Cervidae)',
        description: 'Kızıl geyik, alageyik, karaca, sığın, ren geyiği ve ak kuyruklu geyik türleri.',
        members: [
          { scientificName: 'Cervidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
        ],
        membershipPolicyNote: 'Yaşayan Cervidae türleri esas alınır; fosil cins/türler (ör. Megaceroides, Dicrocerus) varsayılan görünümde filtrelenir, belirsiz kayıtlar işaretlenir.',
      },
    ],
  },
  {
    id: 'kaplumbaga',
    displayName: 'Kaplumbağa Türleri',
    aliases: ['kaplumbağa', 'kaplumbağalar', 'kaplumbağa türleri', 'turtle', 'turtles', 'tortoise', 'tortoises'],
    subgroups: [
      {
        id: 'kaplumbaga-tumu',
        label: 'Tüm Kaplumbağalar (Testudines)',
        description: 'Kara, deniz ve tatlı su kaplumbağalarının tamamını kapsar.',
        members: [
          { scientificName: 'Testudines', expectedRank: 'CLASS' },
        ],
      },
      {
        id: 'kaplumbaga-kara',
        label: 'Kara Kaplumbağaları (Testudinidae)',
        description: 'Adi tosbağa (Testudo graeca), Trakya tosbağası ve diğer kara kaplumbağası türleri.',
        members: [
          { scientificName: 'Testudinidae', expectedRank: 'FAMILY' },
        ],
        genusBiologicalLabels: {
          testudo: 'Kara Kaplumbağası (Testudinidae)',
        },
      },
      {
        id: 'kaplumbaga-deniz',
        label: 'Deniz Kaplumbağaları (Cheloniidae & Dermochelyidae)',
        description: 'Caretta caretta, Yeşil deniz kaplumbağası (Chelonia mydas) ve Deri sırtlı deniz kaplumbağası.',
        members: [
          { scientificName: 'Cheloniidae', expectedRank: 'FAMILY' },
          { scientificName: 'Dermochelyidae', expectedRank: 'FAMILY' },
        ],
        membershipPolicyNote: 'Kretase/Eosen fosil deniz kaplumbağaları (ör. Toxochelys, Tasbacka, Eosphargis) varsayılan görünümde filtrelenir.',
      },
      {
        id: 'kaplumbaga-tatlisu',
        label: 'Tatlı Su & Bataklık Kaplumbağaları',
        description: 'Çizgili kaplumbağa (Mauremys), benekli kaplumbağa (Emys), Fırat kaplumbağası (Rafetus/Trionychidae) ve doğrulanmış tüm tatlı su familyaları.',
        members: [
          { scientificName: 'Geoemydidae', expectedRank: 'FAMILY' },
          { scientificName: 'Emydidae', expectedRank: 'FAMILY' },
          { scientificName: 'Trionychidae', expectedRank: 'FAMILY' },
          { scientificName: 'Pelomedusidae', expectedRank: 'FAMILY' },
          { scientificName: 'Chelidae', expectedRank: 'FAMILY' },
          { scientificName: 'Kinosternidae', expectedRank: 'FAMILY' },
          { scientificName: 'Chelydridae', expectedRank: 'FAMILY' },
          { scientificName: 'Podocnemididae', expectedRank: 'FAMILY' },
          { scientificName: 'Carettochelyidae', expectedRank: 'FAMILY' },
          { scientificName: 'Platysternidae', expectedRank: 'FAMILY' },
          { scientificName: 'Dermatemydidae', expectedRank: 'FAMILY' },
        ],
      },
    ],
  },
  {
    id: 'kedi',
    displayName: 'Kedi Türleri (Yabani & Evcil Ayrımı)',
    aliases: ['kedi', 'kediler', 'yabani kedi', 'yabani kediler', 'kedi türleri', 'cat', 'cats', 'wildcat', 'wildcats', 'wild cat', 'wild cats', 'felid', 'felids'],
    subgroups: [
      {
        id: 'kedi-yabani',
        label: 'Yabani Kediler (Evcil Kedi Hariç)',
        description: 'Yaban kedisi, saz kedisi, karakulak, vaşak, leopar, kaplan, aslan, çita ve tüm yabani Felidae türleri (Felis catus hariç).',
        members: [
          { scientificName: 'Felidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
        ],
        excludedScientificNames: ['Felis catus'],
        allowDomestic: false,
        membershipPolicyNote: 'Evcil kedi (Felis catus) yabani kedi listelerinden çıkarılmış ve ayrı bir alt gruba ayrılmıştır.',
      },
      {
        id: 'kedi-kucuk',
        label: 'Küçük & Orta Boy Yabani Kediler',
        description: 'Yaban kedisi (Felis silvestris), saz kedisi, vaşak, karakulak, ocelot (Leopardus), pars kedisi (Prionailurus), serval (Leptailurus), Asya altın kedisi (Catopuma), mermer kedisi (Pardofelis) ve jaguarundi (Puma yagouaroundi).',
        members: [
          { scientificName: 'Felis', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Lynx', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Caracal', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Leopardus', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Prionailurus', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Leptailurus', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Catopuma', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Pardofelis', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Profelis', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Puma', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
        ],
        excludedScientificNames: ['Felis catus', 'Puma concolor'],
        allowDomestic: false,
        genusBiologicalLabels: {
          felis: 'Küçük Yaban Kedisi (Felis)',
          lynx: 'Vaşak (Lynx)',
          caracal: 'Karakulak (Caracal)',
          leopardus: 'Neotropikal Küçük/Orta Yaban Kedisi (Leopardus)',
          prionailurus: 'Asya Küçük Yaban Kedisi (Prionailurus)',
          leptailurus: 'Serval (Leptailurus)',
          catopuma: 'Katopuma (Catopuma)',
          pardofelis: 'Mermer Kedisi (Pardofelis)',
          profelis: 'Afrika Altın Kedisi (Profelis)',
          puma: 'Jaguarundi — Küçük/Orta Yaban Kedisi (Puma yagouaroundi)',
        },
        membershipPolicyNote: 'Evcil kedi (Felis catus) ve büyük kedi Puma concolor hariç tutulmuştur; Puma yagouaroundi (jaguarundi) büyük kedi değil küçük/orta boy yabani kedi olarak burada sunulur.',
      },
      {
        id: 'kedi-buyuk',
        label: 'Büyük Kediler (Panthera, Uncia, Neofelis, Acinonyx, Puma concolor)',
        description: 'Aslan, kaplan, leopar, jaguar, kar leoparı (Uncia uncia), bulutlu leoparlar (Neofelis), çita (Acinonyx) ve puma (Puma concolor). Jaguarundi (Puma yagouaroundi) hariçtir.',
        members: [
          { scientificName: 'Panthera', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Uncia', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Neofelis', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Acinonyx', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
          { scientificName: 'Puma', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
        ],
        excludedScientificNames: ['Puma yagouaroundi'],
        allowDomestic: false,
        genusBiologicalLabels: {
          panthera: 'Büyük Kedi (Panthera)',
          uncia: 'Kar Leoparı — Büyük Kedi (Uncia)',
          neofelis: 'Bulutlu Leopar — Büyük Kedi (Neofelis)',
          acinonyx: 'Çita — Büyük Kedi (Acinonyx)',
          puma: 'Puma / Dağ Aslanı — Büyük Kedi (Puma concolor)',
        },
        membershipPolicyNote: 'Kar leoparı (Uncia uncia) ve bulutlu leoparlar (Neofelis) dahil edilmiş, jaguarundi (Puma yagouaroundi) büyük kedilerden çıkarılmıştır.',
      },
      {
        id: 'kedi-evcil',
        label: 'Evcil Kedi (Felis catus)',
        description: 'Yalnızca evcilleştirilmiş evcil kedi türünü (Felis catus) yabani kedilerden ayrı olarak gösterir.',
        members: [
          { scientificName: 'Felis', expectedRank: 'GENUS', expectedFamily: 'Felidae' },
        ],
        allowedCanonicalNames: ['Felis catus'],
        allowDomestic: true,
        genusBiologicalLabels: {
          felis: 'Evcil Kedi (Domesticated)',
        },
        membershipPolicyNote: 'Evcil kedi yabani Felidae türleriyle karıştırılmaz.',
      },
    ],
  },
  {
    id: 'balina',
    displayName: 'Balina Türleri',
    aliases: ['balina', 'balinalar', 'balina türleri', 'whale', 'whales'],
    subgroups: [
      {
        id: 'balina-buyuk',
        label: 'Balinalar (Çubuklu & Büyük Dişli Balinalar)',
        description: 'Kambur, oluklu, mavi, ispermeçet ve gagalı balina familyalarını içerir (Rhincodon typus balina köpekbalığı kesinlikle hariçtir).',
        members: [
          { scientificName: 'Balaenidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Balaenopteridae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Eschrichtiidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Cetotheriidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Physeteridae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Kogiidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Ziphiidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Monodontidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
        ],
        excludedScientificNames: ['Rhincodon typus'],
        excludedClassNames: ['Elasmobranchii', 'Actinopterygii'],
      },
      {
        id: 'balina-mysticeti',
        label: 'Çubuklu (Dişsiz) Balinalar',
        description: 'Mavi balina, oluklu balina, kambur balina ve gerçek balina familyaları.',
        members: [
          { scientificName: 'Balaenidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Balaenopteridae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Eschrichtiidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Cetotheriidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
        ],
        excludedScientificNames: ['Rhincodon typus'],
        excludedClassNames: ['Elasmobranchii', 'Actinopterygii'],
      },
      {
        id: 'balina-cetacea',
        label: 'Tüm Deniz Memelileri (Cetacea Takımı)',
        description: 'Balinalar ile birlikte yunus ve mutur türlerini de içeren Cetacea takımı.',
        members: [
          { scientificName: 'Cetacea', expectedRank: 'ORDER', expectedClass: 'Mammalia' },
        ],
        excludedScientificNames: ['Rhincodon typus'],
        excludedClassNames: ['Elasmobranchii', 'Actinopterygii'],
      },
    ],
  },
  {
    id: 'kopek-baligi',
    displayName: 'Köpek Balığı Türleri',
    aliases: ['köpek balığı', 'köpekbalığı', 'köpek balıkları', 'köpekbalıkları', 'kopek baligi', 'kopekbaligi', 'shark', 'sharks'],
    subgroups: [
      {
        id: 'kopek-baligi-tumu',
        label: 'Tüm Köpek Balıkları (8 Takım — Vatozlar Hariç)',
        description: 'Yalnızca gerçek köpek balığı takımlarını içerir; vatoz ve tırpana takımları (Rajiformes, Myliobatiformes, Torpediniformes, Rhinopristiformes) hariçtir.',
        members: [
          { scientificName: 'Carcharhiniformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Lamniformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Squaliformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Orectolobiformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Hexanchiformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Heterodontiformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Pristiophoriformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Squatiniformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
        ],
        excludedOrderNames: ['Rajiformes', 'Myliobatiformes', 'Torpediniformes', 'Rhinopristiformes'],
      },
      {
        id: 'kopek-baligi-yuzey',
        label: 'Yüzey, Resif & Büyük Avcı Köpek Balıkları',
        description: 'Büyük beyaz, mako, mavi köpek balığı, çekiç başlılar ve balina köpek balığı (Carcharhiniformes, Lamniformes, Orectolobiformes).',
        members: [
          { scientificName: 'Carcharhiniformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Lamniformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Orectolobiformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
        ],
        excludedOrderNames: ['Rajiformes', 'Myliobatiformes', 'Torpediniformes', 'Rhinopristiformes'],
      },
      {
        id: 'kopek-baligi-derinsu',
        label: 'Camgözler, Melek & Derin Su Köpek Balıkları',
        description: 'Mahmuzlu camgözler, boz camgözler ve keler (melek) köpek balıkları.',
        members: [
          { scientificName: 'Squaliformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Hexanchiformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Squatiniformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Heterodontiformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
          { scientificName: 'Pristiophoriformes', expectedRank: 'ORDER', expectedClass: 'Elasmobranchii' },
        ],
        excludedOrderNames: ['Rajiformes', 'Myliobatiformes', 'Torpediniformes', 'Rhinopristiformes'],
      },
    ],
  },
];

const GROUP_PROFILE_INDEX = (() => {
  const exactMap = new Map<string, TaxonGroupProfile>();
  const foldedMap = new Map<string, TaxonGroupProfile>();
  for (const profile of TAXONOMIC_GROUP_PROFILES) {
    for (const alias of profile.aliases) {
      exactMap.set(toTrLower(alias), profile);
      foldedMap.set(foldTurkishChars(alias), profile);
    }
  }
  return { exactMap, foldedMap };
})();

function lookupTaxonGroupProfile(query: string): TaxonGroupProfile | null {
  const lower = toTrLower(query);
  const direct = GROUP_PROFILE_INDEX.exactMap.get(lower);
  if (direct) return direct;
  const folded = foldTurkishChars(query);
  return GROUP_PROFILE_INDEX.foldedMap.get(folded) || null;
}

/**
 * Sınırlı paralellik ile Promise çalıştırıcı (GBIF hız ve bağlantı sınırlarını korur)
 */
async function runWithConcurrencyLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const currentIndex = cursor++;
        try {
          const val = await worker(items[currentIndex]);
          results[currentIndex] = { status: 'fulfilled', value: val };
        } catch (err) {
          results[currentIndex] = { status: 'rejected', reason: err };
        }
      }
    })
  );

  return results;
}

interface VerifiedHigherTaxonResult {
  verified: boolean;
  usageKey?: number;
  acceptedUsageKey?: number;
  scientificName: string;
  canonicalName?: string;
  rank?: string;
  taxonomicStatus?: string;
  kingdom?: string;
  class?: string;
  order?: string;
  family?: string;
  parentKey?: number;
  matchType?: string;
  synonymOf?: string;
  reason?: string;
}

/**
 * GBIF Backbone üzerinde üst taksonu (GENUS, FAMILY, ORDER, CLASS) homonimlere karşı güvenli doğrular.
 * Sahte taxonKey üretmez; doğrulanamayan taksonu açıkça raporlar.
 */
export async function verifyHigherTaxonWithGbifBackbone(
  scientificName: string,
  expectedRank?: string,
  expectedClass?: string,
  expectedFamily?: string
): Promise<VerifiedHigherTaxonResult> {
  const cleanName = normalizeSearchQuery(scientificName);
  const cacheKey = `higher-taxon:v1:${cleanName.toLowerCase()}:${expectedRank || ''}:${expectedClass || ''}:${expectedFamily || ''}`;
  const cached = getCached<VerifiedHigherTaxonResult>(cacheKey);
  if (cached) return cached;

  if (!cleanName || cleanName.length < 2) {
    return { verified: false, scientificName: cleanName, reason: 'Geçersiz takson adı.' };
  }

  try {
    const rankQuery = expectedRank ? `&rank=${encodeURIComponent(expectedRank)}` : '';
    const matchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(cleanName)}&kingdom=Animalia${rankQuery}&strict=true&verbose=true`;
    const matchRes = await fetchWithRetry(matchUrl, undefined, 1, 7000).then(r => r.json());

    let candidateRecord: any = null;
    let synonymOf: string | undefined;

    const isRejectedHigherrank =
      !matchRes ||
      matchRes.matchType === 'NONE' ||
      !matchRes.usageKey ||
      (matchRes.matchType === 'HIGHERRANK' &&
        (matchRes.rank === 'KINGDOM' || matchRes.rank === 'PHYLUM' || (expectedRank && matchRes.rank !== expectedRank)));

    if (!isRejectedHigherrank) {
      candidateRecord = matchRes;
    } else {
      // Homonim nedeniyle match HIGHERRANK döndürdüyse (ör. Panthera, Lycaon, Clanga) GBIF Backbone search ile doğrula
      const searchRankQuery = expectedRank ? `&rank=${encodeURIComponent(expectedRank)}` : '';
      const searchUrl = `https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&q=${encodeURIComponent(cleanName)}${searchRankQuery}&limit=15`;
      const searchRes = await fetchWithRetry(searchUrl, undefined, 1, 7000).then(r => r.json());
      const hits: any[] = Array.isArray(searchRes?.results) ? searchRes.results : [];

      const matchingHits = hits.filter(h => {
        if (!h || !h.key) return false;
        if (String(h.kingdom || '').toLowerCase() !== 'animalia') return false;
        if (String(h.canonicalName || '').toLowerCase() !== cleanName.toLowerCase()) return false;
        if (expectedRank && String(h.rank || '').toUpperCase() !== expectedRank.toUpperCase()) return false;
        if (expectedClass && h.class && String(h.class).toLowerCase() !== expectedClass.toLowerCase()) return false;
        if (expectedFamily && h.family && String(h.family).toLowerCase() !== expectedFamily.toLowerCase()) return false;
        return true;
      });

      const acceptedHit =
        matchingHits.find(h => h.taxonomicStatus === 'ACCEPTED') ||
        matchingHits.find(h => h.taxonomicStatus === 'SYNONYM' && h.acceptedKey);

      if (acceptedHit) {
        candidateRecord = {
          usageKey: acceptedHit.key,
          acceptedUsageKey: acceptedHit.acceptedKey,
          scientificName: acceptedHit.scientificName,
          canonicalName: acceptedHit.canonicalName,
          rank: acceptedHit.rank,
          status: acceptedHit.taxonomicStatus,
          kingdom: acceptedHit.kingdom,
          class: acceptedHit.class,
          order: acceptedHit.order,
          family: acceptedHit.family,
          parentKey: acceptedHit.parentKey,
          matchType: 'BACKBONE_EXACT_SEARCH',
        };
      }
    }

    if (!candidateRecord || !candidateRecord.usageKey) {
      const failRes: VerifiedHigherTaxonResult = {
        verified: false,
        scientificName: cleanName,
        reason: `"${cleanName}" için GBIF Backbone arşivinde kabul edilen Animalia üst takson kaydı doğrulanamadı.`,
      };
      setCached(cacheKey, failRes, 10 * 60 * 1000);
      return failRes;
    }

    // Sinonim ise acceptedUsageKey üzerinden kabul edilen üst taksona yönlendir
    let finalKey: number = Number(candidateRecord.acceptedUsageKey || candidateRecord.usageKey);
    if (candidateRecord.status === 'SYNONYM' && candidateRecord.acceptedUsageKey) {
      synonymOf = candidateRecord.canonicalName || candidateRecord.scientificName;
    }

    // Detaylı alanlar (parentKey, class, family) için /v1/species/{finalKey} kontrolü
    let detailData: any = null;
    try {
      const detailRes = await fetchWithRetry(`https://api.gbif.org/v1/species/${finalKey}`, undefined, 1, 7000);
      if (detailRes.ok) {
        detailData = await detailRes.json();
      }
    } catch {
      // Detay isteği başarısız olursa mevcut doğrulanmış Backbone alanlarıyla devam edilir
    }

    const finalKingdom = detailData?.kingdom || candidateRecord.kingdom;
    const finalRank = detailData?.rank || candidateRecord.rank;
    const finalClass = detailData?.class || candidateRecord.class;
    const finalFamily = detailData?.family || candidateRecord.family;
    const finalStatus = detailData?.taxonomicStatus || (candidateRecord.status === 'SYNONYM' ? 'ACCEPTED' : candidateRecord.status) || 'ACCEPTED';

    if (String(finalKingdom || '').toLowerCase() !== 'animalia') {
      const nonAnimalRes: VerifiedHigherTaxonResult = {
        verified: false,
        scientificName: cleanName,
        reason: `"${cleanName}" Animalia alemi dışında (${finalKingdom || 'Bilinmiyor'}) yer aldığı için reddedildi.`,
      };
      setCached(cacheKey, nonAnimalRes, 10 * 60 * 1000);
      return nonAnimalRes;
    }

    if (expectedClass && finalClass && String(finalClass).toLowerCase() !== expectedClass.toLowerCase()) {
      const mismatchRes: VerifiedHigherTaxonResult = {
        verified: false,
        scientificName: cleanName,
        reason: `"${cleanName}" beklenen sınıf (${expectedClass}) ile uyuşmadı (bulunan: ${finalClass}).`,
      };
      setCached(cacheKey, mismatchRes, 10 * 60 * 1000);
      return mismatchRes;
    }

    if (expectedFamily && finalFamily && String(finalFamily).toLowerCase() !== expectedFamily.toLowerCase()) {
      const mismatchFamilyRes: VerifiedHigherTaxonResult = {
        verified: false,
        scientificName: cleanName,
        reason: `"${cleanName}" beklenen familya (${expectedFamily}) ile uyuşmadı (bulunan: ${finalFamily}).`,
      };
      setCached(cacheKey, mismatchFamilyRes, 10 * 60 * 1000);
      return mismatchFamilyRes;
    }

    if (finalStatus === 'DOUBTFUL') {
      const doubtfulRes: VerifiedHigherTaxonResult = {
        verified: false,
        scientificName: cleanName,
        reason: `"${cleanName}" GBIF Backbone üzerinde DOUBTFUL statüsünde olduğu için hariç tutuldu.`,
      };
      setCached(cacheKey, doubtfulRes, 10 * 60 * 1000);
      return doubtfulRes;
    }

    const okRes: VerifiedHigherTaxonResult = {
      verified: true,
      usageKey: Number(candidateRecord.usageKey),
      acceptedUsageKey: finalKey,
      scientificName: detailData?.scientificName || candidateRecord.scientificName || cleanName,
      canonicalName: detailData?.canonicalName || candidateRecord.canonicalName || cleanName,
      rank: finalRank,
      taxonomicStatus: finalStatus,
      kingdom: finalKingdom,
      class: finalClass,
      order: detailData?.order || candidateRecord.order,
      family: finalFamily,
      parentKey: detailData?.parentKey || candidateRecord.parentKey,
      matchType: candidateRecord.matchType || 'EXACT',
      synonymOf,
    };

    setCached(cacheKey, okRes, 30 * 60 * 1000);
    return okRes;
  } catch (err: any) {
    return {
      verified: false,
      scientificName: cleanName,
      reason: err?.message || 'GBIF Backbone doğrulama isteği başarısız oldu.',
    };
  }
}

async function resolveProfileToTaxonGroups(
  profile: TaxonGroupProfile
): Promise<{
  groups: TaxonGroupCandidate[];
  unresolvedGroups: Array<{ scientificName: string; reason: string }>;
}> {
  const unresolvedGroups: Array<{ scientificName: string; reason: string }> = [];
  const uniqueMemberMap = new Map<string, TaxonGroupMemberSpec>();

  for (const sub of profile.subgroups) {
    for (const m of sub.members) {
      const key = `${m.scientificName.toLowerCase()}:${m.expectedRank || ''}:${m.expectedClass || ''}:${m.expectedFamily || ''}`;
      if (!uniqueMemberMap.has(key)) {
        uniqueMemberMap.set(key, m);
      }
    }
  }

  const memberSpecs = Array.from(uniqueMemberMap.entries());
  const verifiedMemberCache = new Map<string, VerifiedHigherTaxonResult>();

  const settled = await runWithConcurrencyLimit(
    memberSpecs,
    DISCOVERY_CONCURRENCY_LIMIT,
    async ([key, spec]) => {
      const verified = await verifyHigherTaxonWithGbifBackbone(
        spec.scientificName,
        spec.expectedRank,
        spec.expectedClass,
        spec.expectedFamily
      );
      return { key, spec, verified };
    }
  );

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      verifiedMemberCache.set(s.value.key, s.value.verified);
      if (!s.value.verified.verified) {
        unresolvedGroups.push({
          scientificName: s.value.spec.scientificName,
          reason: s.value.verified.reason || 'GBIF Backbone üzerinde doğrulanamadı.',
        });
      }
    }
  }

  const groups: TaxonGroupCandidate[] = [];
  for (const sub of profile.subgroups) {
    const verifiedMembers: VerifiedHigherTaxonResult[] = [];
    const subWarnings: string[] = [];

    for (const m of sub.members) {
      const key = `${m.scientificName.toLowerCase()}:${m.expectedRank || ''}:${m.expectedClass || ''}:${m.expectedFamily || ''}`;
      const res = verifiedMemberCache.get(key);
      if (res?.verified && res.acceptedUsageKey) {
        verifiedMembers.push(res);
      } else {
        subWarnings.push(`${m.scientificName}: ${res?.reason || 'Doğrulanamadı'}`);
      }
    }

    const taxonKeys = Array.from(
      new Set(
        verifiedMembers
          .map(v => v.acceptedUsageKey)
          .filter((k): k is number => typeof k === 'number' && k > 0)
      )
    );

    const primaryMember = verifiedMembers[0];
    groups.push({
      id: sub.id,
      label: sub.label,
      scientificName:
        verifiedMembers.length === 1
          ? primaryMember.canonicalName || sub.members[0].scientificName
          : sub.members.map(m => m.scientificName).slice(0, 4).join(', ') +
            (sub.members.length > 4 ? ` (+${sub.members.length - 4})` : ''),
      usageKey: verifiedMembers.length === 1 ? primaryMember.usageKey : undefined,
      acceptedUsageKey: verifiedMembers.length === 1 ? primaryMember.acceptedUsageKey : undefined,
      taxonKeys,
      rank: verifiedMembers.length === 1 ? primaryMember.rank || 'GROUP' : 'COMPOSITE_GROUP',
      taxonomicStatus: verifiedMembers.length > 0 ? 'ACCEPTED' : 'UNVERIFIED',
      kingdom: 'Animalia',
      parentKey: verifiedMembers.length === 1 ? primaryMember.parentKey : undefined,
      turkishName: profile.displayName,
      description: sub.description,
      dataSource: 'GBIF Backbone Taxonomy',
      matchType: verifiedMembers.length > 0 ? 'VERIFIED_GROUP' : 'UNVERIFIED',
      isVerified: taxonKeys.length > 0,
      excludedScientificNames: sub.excludedScientificNames,
      excludedOrderNames: [
        ...(sub.excludedOrderNames || []),
        ...(sub.excludedFamilyNames || []),
        ...(sub.excludedGenusNames || []),
        ...(sub.excludedClassNames || []),
      ],
      excludedTaxonKeys: sub.excludedTaxonKeys,
      allowedCanonicalNames: sub.allowedCanonicalNames,
      mergedEquivalents: sub.mergedEquivalents,
      genusBiologicalLabels: sub.genusBiologicalLabels,
      allowDomestic: sub.allowDomestic,
      membershipPolicyNote: sub.membershipPolicyNote,
      verificationWarning: subWarnings.length > 0 ? subWarnings.join('; ') : undefined,
    });
  }

  return { groups, unresolvedGroups };
}

function scoreHigherTaxonCommonMatch(candidateName: string | undefined, query: string): number {
  if (!candidateName) return 0;
  const baseScore = scoreCommonNameMatch(candidateName, query);
  if (baseScore > 0) return baseScore;

  const candFold = foldTurkishChars(candidateName);
  const queryFold = foldTurkishChars(query);
  if (!queryFold || queryFold.length < 3) return 0;

  const escaped = queryFold.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trTaxonRegex = new RegExp(`(?:^|\\s|-)${escaped}(?:lar|ler|giller|ları|leri|s|es)(?:$|\\s|-)`, 'i');
  if (trTaxonRegex.test(candFold)) return 85;
  return 0;
}

/**
 * Profilde yer almayan genel hayvan adları için (örn: Baykuş, Ördek, Yunus, Penguen vb.)
 * iNaturalist + GBIF Backbone üzerinden dinamik üst takson keşfi yapar.
 * iNaturalist verisini asla tek başına doğrulama kabul etmez; mutlaka GBIF Backbone ile teyit eder.
 */
async function resolveDynamicHigherTaxonGroups(query: string): Promise<{
  groups: TaxonGroupCandidate[];
  unresolvedGroups: Array<{ scientificName: string; reason: string }>;
}> {
  const clean = normalizeSearchQuery(query);
  const cacheKey = `dynamic-groups:v2:${toTrLower(clean)}`;
  const cached = getCached<{
    groups: TaxonGroupCandidate[];
    unresolvedGroups: Array<{ scientificName: string; reason: string }>;
  }>(cacheKey);
  if (cached) return cached;

  const [inatTr, inatEn] = await Promise.allSettled([
    fetchWithRetry(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&locale=tr&per_page=10`, undefined, 1, 6000).then(r => r.json()),
    fetchWithRetry(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&locale=en&per_page=10`, undefined, 1, 6000).then(r => r.json()),
  ]);

  const rawCandidates = new Map<string, { sci: string; rank: string; commonName?: string; score: number }>();

  for (const src of [inatTr, inatEn]) {
    if (src.status !== 'fulfilled' || !Array.isArray(src.value?.results)) continue;
    for (const t of src.value.results) {
      if (!t || !t.name || !t.rank) continue;
      const iconic = String(t.iconic_taxon_name || '').toLowerCase();
      if (!ANIMAL_INAT_ICONIC_TAXA.has(iconic)) continue;

      const rankLower = String(t.rank).toLowerCase();
      if (!['genus', 'subfamily', 'family', 'order', 'infraorder', 'suborder', 'class', 'subclass'].includes(rankLower)) {
        continue;
      }

      const bestNameScore = Math.max(
        scoreHigherTaxonCommonMatch(t.preferred_common_name, clean),
        scoreHigherTaxonCommonMatch(t.english_common_name, clean),
        scoreHigherTaxonCommonMatch(t.matched_term, clean)
      );
      if (bestNameScore < 65) continue;

      const sciKey = String(t.name).toLowerCase();
      const obsBonus = Math.min(20, Math.log10(Math.max(1, Number(t.observations_count || 1))) * 3);
      const totalScore = bestNameScore + obsBonus;
      const existing = rawCandidates.get(sciKey);
      if (!existing || totalScore > existing.score) {
        rawCandidates.set(sciKey, {
          sci: t.name,
          rank: rankLower.toUpperCase(),
          commonName: t.preferred_common_name || t.english_common_name,
          score: totalScore,
        });
      }
    }
  }

  const sortedCands = Array.from(rawCandidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const groups: TaxonGroupCandidate[] = [];
  const unresolvedGroups: Array<{ scientificName: string; reason: string }> = [];

  if (sortedCands.length > 0) {
    const settled = await runWithConcurrencyLimit(sortedCands, DISCOVERY_CONCURRENCY_LIMIT, async (cand) => {
      const gbifRank = ['SUBFAMILY', 'INFRAORDER', 'SUBORDER', 'SUBCLASS'].includes(cand.rank)
        ? undefined
        : cand.rank;
      const verified = await verifyHigherTaxonWithGbifBackbone(cand.sci, gbifRank);
      return { cand, verified };
    });

    const seenAccKeys = new Set<number>();
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const { cand, verified } = s.value;
      if (!verified.verified || !verified.acceptedUsageKey) {
        unresolvedGroups.push({
          scientificName: cand.sci,
          reason: verified.reason || 'GBIF Backbone üzerinde doğrulanamadı.',
        });
        continue;
      }
      if (seenAccKeys.has(verified.acceptedUsageKey)) continue;
      seenAccKeys.add(verified.acceptedUsageKey);

      groups.push({
        id: `dyn-${verified.acceptedUsageKey}`,
        label: cand.commonName
          ? `${cand.commonName} (${verified.canonicalName || cand.sci})`
          : `${verified.canonicalName || cand.sci} (${verified.rank})`,
        scientificName: verified.canonicalName || cand.sci,
        usageKey: verified.usageKey,
        acceptedUsageKey: verified.acceptedUsageKey,
        taxonKeys: [verified.acceptedUsageKey],
        rank: verified.rank || cand.rank,
        taxonomicStatus: verified.taxonomicStatus || 'ACCEPTED',
        kingdom: verified.kingdom || 'Animalia',
        parentKey: verified.parentKey,
        turkishName: cand.commonName,
        dataSource: 'GBIF Backbone Taxonomy (iNaturalist Keşif Desteği)',
        matchType: verified.matchType || 'EXACT',
        isVerified: true,
      });
    }
  }

  const res = { groups, unresolvedGroups };
  setCached(cacheKey, res, 15 * 60 * 1000);
  return res;
}

function normalizeDiscoveryCountryCode(countryCode?: string): string {
  const raw = (countryCode ?? 'TR').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (upper === 'GLOBAL' || upper === 'ALL' || upper === 'WORLD' || upper === 'TÜM DÜNYA') {
    return '';
  }
  return upper;
}

/**
 * Kullanıcı aramasının niyetini (Tekil Tür / Taksonomik Grup Keşfi / Bulunamadı) belirler.
 * Mevcut BILINGUAL_SPECIES_ENTRIES ve matchSpecies davranışını bozmadan ölçeklenebilir yönlendirme sağlar.
 */
export async function resolveSearchIntent(
  query: string,
  countryCode: string = 'TR'
): Promise<SearchIntentResult> {
  const normalizedInput = normalizeSearchQuery(query);
  const cleanCountry = normalizeDiscoveryCountryCode(countryCode);

  if (!normalizedInput || normalizedInput.length < 2) {
    return {
      mode: 'NOT_FOUND',
      query: normalizedInput,
      countryCode: cleanCountry,
      reason: 'Lütfen aramak istediğiniz canlı türünün veya hayvan grubunun adını girin.',
    };
  }

  const cacheKey = `search-intent:v1:${toTrLower(normalizedInput)}:${cleanCountry || 'GLOBAL'}`;
  const cached = getCached<SearchIntentResult>(cacheKey);
  if (cached) return cached;

  // 1. Öncelik: Bilinen genel hayvan grubu profilleri (Tilki, Kurt, Ayı, Kartal, Geyik, Kaplumbağa, Kedi, Balina, Köpek balığı)
  const groupProfile = lookupTaxonGroupProfile(normalizedInput);
  if (groupProfile) {
    const { groups, unresolvedGroups } = await resolveProfileToTaxonGroups(groupProfile);
    const verifiedGroups = groups.filter(g => g.isVerified);
    if (verifiedGroups.length > 0) {
      const intentRes: SearchIntentResult = {
        mode: 'TAXON_GROUP_DISCOVERY',
        query: normalizedInput,
        countryCode: cleanCountry,
        groups: verifiedGroups,
        activeGroupId: verifiedGroups[0].id,
        unresolvedGroups: unresolvedGroups.length > 0 ? unresolvedGroups : undefined,
      };
      setCached(cacheKey, intentRes, 15 * 60 * 1000);
      return intentRes;
    }
    return {
      mode: 'NOT_FOUND',
      query: normalizedInput,
      countryCode: cleanCountry,
      unresolvedGroups,
      reason: `"${normalizedInput}" grubunun üst taksonları GBIF Backbone üzerinde doğrulanamadı.`,
    };
  }

  const words = normalizedInput.split(' ').filter(Boolean);

  // 2. Tek kelimeli bilimsel üst takson sorgusu kontrolü (örn: Vulpes, Felidae, Testudines, Ursidae, Canis)
  //    Önemli: Cins/familya/takım/sınıf düzeyindeki eşleşmeler ASLA tek tür gibi döndürülmez.
  if (words.length === 1 && /^[a-zA-Z-]+$/.test(words[0])) {
    const isInSpecificCommonDict = Boolean(lookupCommonSpeciesEntry(normalizedInput));
    // Bilimsel ad büyük/küçük harf duyarsız olarak GBIF Backbone üst taksonlarında aranır
    const higherCheck = await verifyHigherTaxonWithGbifBackbone(
      words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase()
    );
    if (
      higherCheck.verified &&
      higherCheck.acceptedUsageKey &&
      higherCheck.rank &&
      HIGHER_TAXON_RANKS.has(higherCheck.rank.toUpperCase())
    ) {
      const singleTaxonGroup: TaxonGroupCandidate = {
        id: `taxon-${higherCheck.acceptedUsageKey}`,
        label: `${higherCheck.canonicalName || words[0]} (${higherCheck.rank})`,
        scientificName: higherCheck.canonicalName || words[0],
        usageKey: higherCheck.usageKey,
        acceptedUsageKey: higherCheck.acceptedUsageKey,
        taxonKeys: [higherCheck.acceptedUsageKey],
        rank: higherCheck.rank,
        taxonomicStatus: higherCheck.taxonomicStatus || 'ACCEPTED',
        kingdom: higherCheck.kingdom || 'Animalia',
        parentKey: higherCheck.parentKey,
        dataSource: 'GBIF Backbone Taxonomy',
        matchType: higherCheck.matchType || 'EXACT',
        isVerified: true,
      };
      const intentRes: SearchIntentResult = {
        mode: 'TAXON_GROUP_DISCOVERY',
        query: normalizedInput,
        countryCode: cleanCountry,
        groups: [singleTaxonGroup],
        activeGroupId: singleTaxonGroup.id,
      };
      setCached(cacheKey, intentRes, 15 * 60 * 1000);
      return intentRes;
    }

    // Üst takson değilse ve spesifik yaygın ad sözlüğünde varsa tekil tür çözümlemeye devam et
    if (isInSpecificCommonDict) {
      const speciesMatch = await matchSpecies(normalizedInput);
      if (speciesMatch.isMatched && speciesMatch.usageKey && (!speciesMatch.rank || SPECIES_LEVEL_RANKS.has(speciesMatch.rank.toUpperCase()))) {
        const singleRes: SearchIntentResult = {
          mode: 'SINGLE_SPECIES',
          query: normalizedInput,
          countryCode: cleanCountry,
          matchedSpecies: speciesMatch,
        };
        setCached(cacheKey, singleRes, 15 * 60 * 1000);
        return singleRes;
      }
    }
  }

  // 3. Spesifik çift/çok kelimeli yaygın ad veya binominal bilimsel ad kontrolü (Ursus arctos, Panthera leo, Vulpes vulpes, Bozayı, Kızıl tilki, Su samuru, Caretta caretta)
  const commonSpecific = lookupCommonSpeciesEntry(normalizedInput);
  if (commonSpecific || words.length >= 2) {
    const speciesMatch = await matchSpecies(normalizedInput);
    if (speciesMatch.isMatched && speciesMatch.usageKey) {
      const rankUpper = (speciesMatch.rank || 'SPECIES').toUpperCase();
      if (SPECIES_LEVEL_RANKS.has(rankUpper)) {
        const singleRes: SearchIntentResult = {
          mode: 'SINGLE_SPECIES',
          query: normalizedInput,
          countryCode: cleanCountry,
          matchedSpecies: speciesMatch,
        };
        setCached(cacheKey, singleRes, 15 * 60 * 1000);
        return singleRes;
      }
      if (HIGHER_TAXON_RANKS.has(rankUpper)) {
        const groupCand: TaxonGroupCandidate = {
          id: `taxon-${speciesMatch.usageKey}`,
          label: `${speciesMatch.turkishName || speciesMatch.canonicalName} (${rankUpper})`,
          scientificName: speciesMatch.canonicalName,
          usageKey: speciesMatch.usageKey,
          acceptedUsageKey: speciesMatch.usageKey,
          taxonKeys: [speciesMatch.usageKey],
          rank: rankUpper,
          taxonomicStatus: speciesMatch.taxonomicStatus || 'ACCEPTED',
          kingdom: speciesMatch.kingdom || 'Animalia',
          dataSource: 'GBIF Backbone Taxonomy',
          matchType: speciesMatch.matchType,
          isVerified: true,
        };
        const groupRes: SearchIntentResult = {
          mode: 'TAXON_GROUP_DISCOVERY',
          query: normalizedInput,
          countryCode: cleanCountry,
          groups: [groupCand],
          activeGroupId: groupCand.id,
        };
        setCached(cacheKey, groupRes, 15 * 60 * 1000);
        return groupRes;
      }
    }
  }

  // 4. Profilde olmayan genel hayvan adları için dinamik üst-takson keşfi (ör. Baykuş, Ördek, Yengeç, Kelebek)
  const dynamicGroups = await resolveDynamicHigherTaxonGroups(normalizedInput);
  if (dynamicGroups.groups.length > 0) {
    const dynRes: SearchIntentResult = {
      mode: 'TAXON_GROUP_DISCOVERY',
      query: normalizedInput,
      countryCode: cleanCountry,
      groups: dynamicGroups.groups,
      activeGroupId: dynamicGroups.groups[0].id,
      unresolvedGroups: dynamicGroups.unresolvedGroups.length > 0 ? dynamicGroups.unresolvedGroups : undefined,
    };
    setCached(cacheKey, dynRes, 15 * 60 * 1000);
    return dynRes;
  }

  // 5. Son tekil tür doğrulama denemesi (matchSpecies tüm Animalia koruma kurallarını uygular)
  const fallbackMatch = await matchSpecies(normalizedInput);
  if (fallbackMatch.isMatched && fallbackMatch.usageKey) {
    const rankUpper = (fallbackMatch.rank || 'SPECIES').toUpperCase();
    if (SPECIES_LEVEL_RANKS.has(rankUpper)) {
      const singleRes: SearchIntentResult = {
        mode: 'SINGLE_SPECIES',
        query: normalizedInput,
        countryCode: cleanCountry,
        matchedSpecies: fallbackMatch,
      };
      setCached(cacheKey, singleRes, 15 * 60 * 1000);
      return singleRes;
    }
  }

  // 6. Eşleşme yok
  const notFoundRes: SearchIntentResult = {
    mode: 'NOT_FOUND',
    query: normalizedInput,
    countryCode: cleanCountry,
    reason: fallbackMatch.summary || `"${normalizedInput}" için GBIF Backbone arşivinde doğrulanmış bir tür veya taksonomik grup bulunamadı.`,
  };
  setCached(cacheKey, notFoundRes, 5 * 60 * 1000);
  return notFoundRes;
}

export interface DiscoverSpeciesOptions {
  countryCode?: string;
  page?: number;
  pageSize?: number;
  groupId?: string;
  includeFossilOnly?: boolean;
  includeUncertainTaxa?: boolean;
  includeTaxonSearchComplement?: boolean;
  groups?: TaxonGroupCandidate[];
  unresolvedGroups?: Array<{ scientificName: string; reason: string }>;
  enrichWithInaturalist?: boolean;
}

interface RawFacetBucketPage {
  totalOccurrences: number;
  counts: Array<{ speciesKey: number; count: number }>;
  hasMoreBuckets: boolean;
}

interface SpeciesEvidenceSummary {
  existenceStatus: SpeciesExistenceStatus;
  existenceEvidence: string;
  isFossilOnly: boolean;
  gbifTurkishName?: string;
  gbifEnglishName?: string;
  hasVernacularName: boolean;
  isAuthoritativeLivingChecklist: boolean;
  hasLivingProfile: boolean;
}

interface VerifiedDiscoveryPoolState {
  totalOccurrencesInScope: number;
  rawBuckets: Array<{ speciesKey: number; count: number }>;
  rawSeenKeys: Set<number>;
  nextRawBucketIndex: number;
  nextApiFacetOffset: number;
  apiHasMoreBuckets: boolean;
  complementFetched: boolean;
  verifiedItems: DiscoveredSpeciesItem[];
  seenAcceptedKeys: Set<number>;
  seenCanonicalNames: Set<string>;
  uncertainOrHistoricalCount: number;
  filteredFossilCount: number;
  filteredOutOfGroupCount: number;
}

const AUTHORITATIVE_LIVING_CHECKLISTS = new Set([
  '7ddf754f-d193-4cc9-b351-99906754a03b', // Catalogue of Life
  '47f16512-bf31-410f-b272-d151c996b2f6', // The Clements Checklist
]);

const GEOLOGICAL_PERIOD_PATTERN = /\b(\d+(?:\.\d+)?\s*(?:to|-)\s*\d+(?:\.\d+)?\s*ma|ma|ka|pleistocene|pliocene|miocene|oligocene|eocene|paleocene|cretaceous|jurassic|triassic)\b/i;

async function fetchSpeciesDetailCached(speciesKey: number): Promise<any | null> {
  const spCacheKey = `gbif-species-detail:v1:${speciesKey}`;
  const cached = getCached<any>(spCacheKey);
  if (cached) return cached;
  const res = await fetchWithRetry(`https://api.gbif.org/v1/species/${speciesKey}`, undefined, 1, 7000);
  if (!res.ok) return null;
  const data = await res.json();
  setCached(spCacheKey, data, 30 * 60 * 1000);
  return data;
}

async function resolveCanonicalSpeciesTarget(
  targetCanonical: string
): Promise<any | null> {
  const clean = normalizeSearchQuery(targetCanonical);
  if (!clean) return null;
  const cacheKey = `gbif-canonical-target:v1:${clean.toLowerCase()}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return cached;
  try {
    const matchRes = await fetchWithRetry(
      `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(clean)}&kingdom=Animalia&rank=SPECIES&strict=true`,
      undefined,
      1,
      6000
    );
    if (!matchRes.ok) return null;
    const m = await matchRes.json();
    const targetKey = Number(m?.acceptedUsageKey || m?.usageKey);
    if (!targetKey) return null;
    const detail = await fetchSpeciesDetailCached(targetKey);
    if (detail?.key) {
      setCached(cacheKey, detail, 30 * 60 * 1000);
      return detail;
    }
  } catch {
    // Eşdeğer takson çözümlenemezse yoksayılır
  }
  return null;
}

async function evaluateSpeciesEvidence(
  resolvedSp: any,
  localSciEntry: CommonSpeciesEntry | undefined
): Promise<SpeciesEvidenceSummary> {
  const key = Number(resolvedSp.key);
  const evidenceCacheKey = `gbif-species-evidence:v3:${key}`;
  const cached = getCached<SpeciesEvidenceSummary>(evidenceCacheKey);
  if (cached) return cached;

  const isAuthoritativeLivingChecklist = AUTHORITATIVE_LIVING_CHECKLISTS.has(
    String(resolvedSp.constituentKey || '')
  );

  const [profilesRes, basisRes, vernRes] = await Promise.allSettled([
    fetchWithRetry(`https://api.gbif.org/v1/species/${key}/speciesProfiles`, undefined, 0, 5000).then(r =>
      r.ok ? r.json() : { results: [] }
    ),
    fetchWithRetry(
      `https://api.gbif.org/v1/occurrence/search?speciesKey=${key}&limit=0&facet=basisOfRecord`,
      undefined,
      0,
      5000
    ).then(r => (r.ok ? r.json() : { facets: [] })),
    fetchWithRetry(`https://api.gbif.org/v1/species/${key}/vernacularNames?limit=30`, undefined, 0, 5000).then(r =>
      r.ok ? r.json() : { results: [] }
    ),
  ]);

  const profiles: any[] =
    profilesRes.status === 'fulfilled' && Array.isArray(profilesRes.value?.results)
      ? profilesRes.value.results
      : [];
  const bCounts: Array<{ name: string; count: number }> =
    basisRes.status === 'fulfilled' ? basisRes.value?.facets?.[0]?.counts || [] : [];
  const vernResults: any[] =
    vernRes.status === 'fulfilled' && Array.isArray(vernRes.value?.results)
      ? vernRes.value.results
      : [];

  const gbifTurkishName =
    vernResults.find(x => x?.language === 'tur' && x?.preferred)?.vernacularName ||
    vernResults.find(x => x?.language === 'tur')?.vernacularName ||
    undefined;
  const gbifEnglishName =
    vernResults.find(x => x?.language === 'eng' && x?.preferred)?.vernacularName ||
    vernResults.find(x => x?.language === 'eng')?.vernacularName ||
    undefined;
  const hasVernacularName = Boolean(localSciEntry || gbifTurkishName || gbifEnglishName);

  const hasLivingProfile = profiles.some(p => p?.extinct === false);
  const hasExtinctProfile = profiles.some(p => p?.extinct === true);
  const pbdbGeologicalProfile = profiles.find(
    p =>
      (/paleobiology/i.test(String(p?.source || '')) && (Boolean(p?.livingPeriod) || p?.extinct !== false)) ||
      (typeof p?.livingPeriod === 'string' && GEOLOGICAL_PERIOD_PATTERN.test(p.livingPeriod) && p?.extinct !== false)
  );

  const fossilTotal = bCounts.find(x => x.name === 'FOSSIL_SPECIMEN')?.count || 0;
  const humanObs = bCounts.find(x => x.name === 'HUMAN_OBSERVATION')?.count || 0;
  const machineObs = bCounts.find(x => x.name === 'MACHINE_OBSERVATION')?.count || 0;
  const genericObs = bCounts.find(x => x.name === 'OBSERVATION')?.count || 0;
  const liveObs = humanObs + machineObs + genericObs;

  let existenceStatus: SpeciesExistenceStatus;
  let existenceEvidence: string;
  let isFossilOnly = false;

  // 1. Kesin Fosil / Soyu Tükenmiş Kanıtı (speciesProfiles, extinct bayrağı veya ezici fosil hakimiyeti)
  if (resolvedSp.extinct === true || hasExtinctProfile) {
    existenceStatus = 'FOSSIL_OR_EXTINCT';
    isFossilOnly = true;
    existenceEvidence = pbdbGeologicalProfile?.livingPeriod
      ? `GBIF speciesProfiles soyu tükenmiş / fosil kaydı (${pbdbGeologicalProfile.livingPeriod})`
      : 'GBIF Backbone / speciesProfiles üzerinde soyu tükenmiş (extinct=true) olarak işaretli';
  } else if (pbdbGeologicalProfile && !hasLivingProfile) {
    existenceStatus = 'FOSSIL_OR_EXTINCT';
    isFossilOnly = true;
    existenceEvidence = `Paleobiology Database jeolojik dönem kaydı (${pbdbGeologicalProfile.livingPeriod || 'fosil takson'})`;
  } else if (fossilTotal >= 5 && fossilTotal >= liveObs * 3 && !hasLivingProfile) {
    existenceStatus = 'FOSSIL_OR_EXTINCT';
    isFossilOnly = true;
    existenceEvidence = `Fosil kayıtları baskın (${fossilTotal} FOSSIL_SPECIMEN, ${liveObs} canlı gözlem; yaşayan tür profili yok)`;
  }
  // 2. Doğrulanmış Yaşayan Tür Kanıtı (düşük kayıt sayısına göre ASLA elenmez)
  else if (
    hasLivingProfile ||
    isAuthoritativeLivingChecklist ||
    (liveObs >= 3 && fossilTotal === 0) ||
    (liveObs >= 1 && hasVernacularName && fossilTotal === 0)
  ) {
    existenceStatus = 'LIVING';
    const reasons: string[] = [];
    if (hasLivingProfile) reasons.push('GBIF speciesProfiles (extinct=false)');
    if (isAuthoritativeLivingChecklist) reasons.push('Catalogue of Life / Clements kontrol listesi');
    if (liveObs > 0) reasons.push(`${liveObs.toLocaleString('tr-TR')} canlı gözlem`);
    if (hasVernacularName) reasons.push('yaygın ad doğrulaması');
    existenceEvidence = `Yaşayan tür (${reasons.join(', ')})`;
  }
  // 3. Yetersiz / Belirsiz veya Tarihsel Kanıt (silmek yerine şeffaf işaretlenir)
  else {
    existenceStatus = 'HISTORICAL_OR_UNCERTAIN';
    existenceEvidence =
      fossilTotal > 0
        ? `Sınırlı fosil (${fossilTotal}) ve doğrulanmamış gözlem (${liveObs}) kaydı; yaşayan tür profili bulunamadı`
        : `Yaşayan tür profili, canlı gözlem (${liveObs}) ve yaygın ad kanıtı eksik; tarihsel/belirsiz kayıt`;
  }

  const summary: SpeciesEvidenceSummary = {
    existenceStatus,
    existenceEvidence,
    isFossilOnly,
    gbifTurkishName,
    gbifEnglishName,
    hasVernacularName,
    isAuthoritativeLivingChecklist,
    hasLivingProfile,
  };
  setCached(evidenceCacheKey, summary, 30 * 60 * 1000);
  return summary;
}

async function fetchExcludedSubspeciesCount(
  taxonKeys: number[],
  countryParam: string,
  nonFossilBasisParam: string
): Promise<number> {
  if (!taxonKeys || taxonKeys.length === 0) return 0;
  const cacheKey = `discover-excl-sub:v1:${taxonKeys.join(',')}:${countryParam}:${nonFossilBasisParam ? 1 : 0}`;
  const cached = getCached<number>(cacheKey);
  if (cached !== null) return cached;

  let totalExcluded = 0;
  // GBIF'te Canis familiaris (5219200) -> Canis lupus familiaris (6164210) altında toplandığı için birincil kabul edilmiş alt tür anahtarı kullanılır
  const primarySubKey = taxonKeys[0];
  try {
    const res = await fetchWithRetry(
      `https://api.gbif.org/v1/occurrence/search?taxonKey=${primarySubKey}${countryParam}${nonFossilBasisParam}&limit=0`,
      undefined,
      1,
      6000
    );
    if (res.ok) {
      const json = await res.json();
      if (typeof json?.count === 'number') {
        totalExcluded = json.count;
      }
    }
  } catch {
    totalExcluded = 0;
  }
  setCached(cacheKey, totalExcluded, 15 * 60 * 1000);
  return totalExcluded;
}

function evaluateBiologicalMembership(
  resolvedSp: any,
  canonicalLower: string,
  activeGroup: TaxonGroupCandidate,
  evidence: SpeciesEvidenceSummary,
  excludedSciSet: Set<string>,
  excludedTaxonomySet: Set<string>
): { status: BiologicalMembershipStatus; evidence: string } {
  const genusLower = String(resolvedSp.genus || canonicalLower.split(' ')[0] || '').toLowerCase();
  const orderLower = String(resolvedSp.order || '').toLowerCase();
  const familyLower = String(resolvedSp.family || '').toLowerCase();
  const classLower = String(resolvedSp.class || '').toLowerCase();

  if (
    excludedSciSet.has(canonicalLower) ||
    (orderLower && excludedTaxonomySet.has(orderLower)) ||
    (familyLower && excludedTaxonomySet.has(familyLower)) ||
    (genusLower && excludedTaxonomySet.has(genusLower)) ||
    (classLower && excludedTaxonomySet.has(classLower))
  ) {
    return {
      status: 'EXCLUDED',
      evidence: 'Grup dışlama kuralı nedeniyle kapsam dışı bırakıldı',
    };
  }

  const isDomestic = DOMESTIC_CANONICAL_NAMES.has(canonicalLower);
  if (isDomestic && activeGroup.allowDomestic === false) {
    return {
      status: 'EXCLUDED',
      evidence: 'Evcilleştirilmiş tür; yabani grup kapsamı dışında',
    };
  }

  if (activeGroup.allowedCanonicalNames && activeGroup.allowedCanonicalNames.length > 0) {
    const allowedSet = new Set(activeGroup.allowedCanonicalNames.map(n => n.toLowerCase()));
    if (!allowedSet.has(canonicalLower)) {
      return {
        status: 'EXCLUDED',
        evidence: `"${activeGroup.label}" biyolojik üyelik listesi dışında (yalnızca cins eşleşmesi yeterli sayılmaz)`,
      };
    }
    const customLabel = activeGroup.genusBiologicalLabels?.[genusLower];
    return {
      status: 'VERIFIED_MEMBER',
      evidence: customLabel || `Doğrulanmış grup üyesi (${activeGroup.label})`,
    };
  }

  const genusLabel = activeGroup.genusBiologicalLabels?.[genusLower];
  let specificLabel = genusLabel;
  if (genusLower === 'aquila' && ['aquila clanga', 'aquila pomarina', 'aquila hastata'].includes(canonicalLower)) {
    specificLabel = "Gerçek Kartal — Clanga kompleksi (GBIF Backbone'da Aquila altında)";
  } else if (genusLower === 'puma' && canonicalLower === 'puma yagouaroundi') {
    specificLabel = 'Jaguarundi — Küçük/Orta Boy Yaban Kedisi (Büyük kedi değil)';
  } else if (genusLower === 'puma' && canonicalLower === 'puma concolor') {
    specificLabel = 'Puma / Dağ Aslanı — Büyük Kedi';
  }

  if (evidence.existenceStatus === 'LIVING' && (evidence.hasVernacularName || evidence.isAuthoritativeLivingChecklist || Boolean(specificLabel))) {
    return {
      status: 'VERIFIED_MEMBER',
      evidence: specificLabel
        ? `${specificLabel}; ${evidence.existenceEvidence}`
        : `Doğrulanmış biyolojik üye (${activeGroup.label}); ${evidence.existenceEvidence}`,
    };
  }

  return {
    status: 'UNVERIFIED_MEMBERSHIP',
    evidence: `Biyolojik grup üyeliği veya yaygın ad/yaşayan statüsü kesinleştirilemedi (${evidence.existenceEvidence})`,
  };
}

/**
 * Bir veya birden fazla doğrulanmış GBIF üst taksonundan gerçek SPECIES kayıtlarını faset + Backbone + biyolojik üyelik doğrulamasıyla keşfeder.
 * Sinonimleri acceptedUsageKey üzerinden tekilleştirir, fosil/belirsiz türleri ayırır ve sayfalar arası tekrarsız deterministik imleçle çalışır.
 */
export async function discoverSpeciesByGroup(
  groupOrQuery: string | TaxonGroupCandidate | TaxonGroupCandidate[],
  options: DiscoverSpeciesOptions = {}
): Promise<SpeciesDiscoveryResult> {
  const countryCode = normalizeDiscoveryCountryCode(options.countryCode);
  const countryName = countryCode === 'TR' ? 'Türkiye' : 'Tüm Dünya';
  const page = Math.max(1, Math.floor(options.page || 1));
  const pageSize = Math.min(24, Math.max(12, Math.floor(options.pageSize || 16)));
  const includeFossilOnly = options.includeFossilOnly ?? false;
  const includeUncertainTaxa = options.includeUncertainTaxa ?? true;
  const includeTaxonSearchComplement = options.includeTaxonSearchComplement ?? false;
  const enrichWithInaturalist = options.enrichWithInaturalist ?? true;

  let queryLabel = '';
  let groups: TaxonGroupCandidate[] = options.groups ? [...options.groups] : [];
  let unresolvedGroups = options.unresolvedGroups ? [...options.unresolvedGroups] : [];

  if (typeof groupOrQuery === 'string') {
    queryLabel = normalizeSearchQuery(groupOrQuery);
    if (groups.length === 0) {
      const intent = await resolveSearchIntent(queryLabel, countryCode);
      if (intent.mode === 'TAXON_GROUP_DISCOVERY' && intent.groups && intent.groups.length > 0) {
        groups = intent.groups;
        unresolvedGroups = intent.unresolvedGroups || unresolvedGroups;
      } else if (intent.mode === 'SINGLE_SPECIES' && intent.matchedSpecies?.usageKey) {
        groups = [{
          id: `single-${intent.matchedSpecies.usageKey}`,
          label: intent.matchedSpecies.turkishName || intent.matchedSpecies.canonicalName,
          scientificName: intent.matchedSpecies.canonicalName,
          usageKey: intent.matchedSpecies.usageKey,
          acceptedUsageKey: intent.matchedSpecies.usageKey,
          taxonKeys: [intent.matchedSpecies.usageKey],
          rank: intent.matchedSpecies.rank || 'SPECIES',
          taxonomicStatus: intent.matchedSpecies.taxonomicStatus || 'ACCEPTED',
          kingdom: intent.matchedSpecies.kingdom || 'Animalia',
          dataSource: 'GBIF Backbone Taxonomy',
          isVerified: true,
        }];
      }
    }
  } else if (Array.isArray(groupOrQuery)) {
    groups = groupOrQuery;
    queryLabel = groups[0]?.label || groups[0]?.scientificName || 'Takson Grubu';
  } else if (groupOrQuery) {
    if (groups.length === 0) groups = [groupOrQuery];
    queryLabel = groupOrQuery.label || groupOrQuery.scientificName;
  }

  const verifiedGroups = groups.filter(g => g.isVerified && ((g.taxonKeys && g.taxonKeys.length > 0) || g.acceptedUsageKey || g.usageKey));
  const activeGroup =
    verifiedGroups.find(g => g.id === options.groupId) ||
    verifiedGroups[0];

  if (!activeGroup) {
    return {
      query: queryLabel,
      countryCode,
      countryName,
      groups,
      species: [],
      totalOccurrencesInScope: 0,
      pagination: {
        page,
        pageSize,
        totalDiscovered: 0,
        hasMore: false,
        facetOffset: 0,
        nextFacetOffset: null,
      },
      unresolvedGroups: unresolvedGroups.length > 0 ? unresolvedGroups : undefined,
      dataQualityNotice: `"${queryLabel}" için GBIF Backbone üzerinde doğrulanmış bir taksonomik grup bulunamadı.`,
      queriedAt: new Date().toISOString(),
    };
  }

  const activeTaxonKeys = Array.from(
    new Set(
      (activeGroup.taxonKeys && activeGroup.taxonKeys.length > 0
        ? activeGroup.taxonKeys
        : [activeGroup.acceptedUsageKey || activeGroup.usageKey]
      ).filter((k): k is number => typeof k === 'number' && k > 0)
    )
  ).sort((a, b) => a - b);

  const discoveryCacheKey = `discover:v3:${activeTaxonKeys.join(',')}:${activeGroup.id}:${countryCode || 'GLOBAL'}:p${page}:s${pageSize}:f${includeFossilOnly ? 1 : 0}:u${includeUncertainTaxa ? 1 : 0}:c${includeTaxonSearchComplement ? 1 : 0}:i${enrichWithInaturalist ? 1 : 0}`;
  const cachedResult = getCached<SpeciesDiscoveryResult>(discoveryCacheKey);
  if (cachedResult) return cachedResult;

  const taxonQueryParams = activeTaxonKeys.map(k => `taxonKey=${k}`).join('&');
  const countryParam = countryCode ? `&country=${encodeURIComponent(countryCode)}` : '';
  const nonFossilBasisParam = includeFossilOnly
    ? ''
    : '&basisOfRecord=HUMAN_OBSERVATION&basisOfRecord=OBSERVATION&basisOfRecord=MACHINE_OBSERVATION&basisOfRecord=PRESERVED_SPECIMEN&basisOfRecord=MATERIAL_SAMPLE&basisOfRecord=LIVING_SPECIMEN';

  const excludedSciSet = new Set(
    (activeGroup.excludedScientificNames || []).map(n => n.toLowerCase())
  );
  const excludedTaxonomySet = new Set(
    (activeGroup.excludedOrderNames || []).map(n => n.toLowerCase())
  );

  // Deterministik aday havuzu önbelleği (sayfalar arası tekilleştirme ve imleç koruması)
  const poolCacheKey = `discover-pool:v3:${activeTaxonKeys.join(',')}:${activeGroup.id}:${countryCode || 'GLOBAL'}:f${includeFossilOnly ? 1 : 0}:u${includeUncertainTaxa ? 1 : 0}:c${includeTaxonSearchComplement ? 1 : 0}`;
  let pool = getCached<VerifiedDiscoveryPoolState>(poolCacheKey);
  if (!pool) {
    pool = {
      totalOccurrencesInScope: 0,
      rawBuckets: [],
      rawSeenKeys: new Set<number>(),
      nextRawBucketIndex: 0,
      nextApiFacetOffset: 0,
      apiHasMoreBuckets: true,
      complementFetched: false,
      verifiedItems: [],
      seenAcceptedKeys: new Set<number>(),
      seenCanonicalNames: new Set<string>(),
      uncertainOrHistoricalCount: 0,
      filteredFossilCount: 0,
      filteredOutOfGroupCount: 0,
    };
  }

  const targetStartIdx = (page - 1) * pageSize;
  const targetEndIdx = targetStartIdx + pageSize;
  const maxBatchesPerCall = 8;
  let batchesProcessed = 0;

  while (pool.verifiedItems.length < targetEndIdx && batchesProcessed < maxBatchesPerCall) {
    if (pool.nextRawBucketIndex >= pool.rawBuckets.length) {
      if (pool.apiHasMoreBuckets) {
        const fOffset = pool.nextApiFacetOffset;
        const facetCacheKey = `discover-facet:v1:${activeTaxonKeys.join(',')}:${countryCode || 'GLOBAL'}:f${includeFossilOnly ? 1 : 0}:o${fOffset}`;
        let pageData = getCached<RawFacetBucketPage>(facetCacheKey);

        if (!pageData) {
          const occUrl = `https://api.gbif.org/v1/occurrence/search?${taxonQueryParams}${countryParam}${nonFossilBasisParam}&limit=0&facet=speciesKey&facetLimit=${DEFAULT_FACET_FETCH_LIMIT}&facetOffset=${fOffset}`;
          const occHttpRes = await fetchWithRetry(occUrl, undefined, 1, 8000);
          if (!occHttpRes.ok) {
            throw new Error(`GBIF occurrence facet HTTP ${occHttpRes.status}`);
          }
          const occRes = await occHttpRes.json();
          const rawCounts: Array<{ name: string; count: number }> =
            occRes?.facets?.find((f: { field: string }) => f.field === 'speciesKey' || f.field === 'SPECIES_KEY')?.counts || [];

          const parsedCounts = rawCounts
            .map(c => ({ speciesKey: Number(c.name), count: Number(c.count || 0) }))
            .filter(c => Number.isInteger(c.speciesKey) && c.speciesKey > 0 && c.count > 0);

          pageData = {
            totalOccurrences: typeof occRes?.count === 'number' ? occRes.count : 0,
            counts: parsedCounts,
            hasMoreBuckets: rawCounts.length >= DEFAULT_FACET_FETCH_LIMIT,
          };
          setCached(facetCacheKey, pageData, 15 * 60 * 1000);
        }

        if (fOffset === 0) {
          pool.totalOccurrencesInScope = pageData.totalOccurrences;
        }
        for (const b of pageData.counts) {
          if (!pool.rawSeenKeys.has(b.speciesKey)) {
            pool.rawSeenKeys.add(b.speciesKey);
            pool.rawBuckets.push(b);
          }
        }
        pool.nextApiFacetOffset = fOffset + DEFAULT_FACET_FETCH_LIMIT;
        pool.apiHasMoreBuckets = pageData.hasMoreBuckets;
      } else if (includeTaxonSearchComplement && !pool.complementFetched && activeTaxonKeys.length <= 3) {
        pool.complementFetched = true;
        const compSettled = await runWithConcurrencyLimit(activeTaxonKeys, 3, async (htKey) => {
          const searchUrl = `https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&highertaxonKey=${htKey}&rank=SPECIES&status=ACCEPTED&limit=50`;
          return fetchWithRetry(searchUrl, undefined, 1, 7000).then(r => r.json());
        });
        for (const cs of compSettled) {
          if (cs.status !== 'fulfilled' || !Array.isArray(cs.value?.results)) continue;
          for (const sp of cs.value.results) {
            const spKey = Number(sp?.key);
            if (!spKey || pool.rawSeenKeys.has(spKey)) continue;
            if (String(sp.kingdom || '').toLowerCase() !== 'animalia') continue;
            if (sp.extinct === true && !includeFossilOnly) continue;
            pool.rawSeenKeys.add(spKey);
            pool.rawBuckets.push({ speciesKey: spKey, count: 0 });
          }
        }
      } else {
        break;
      }
    }

    if (pool.nextRawBucketIndex >= pool.rawBuckets.length) {
      if (!pool.apiHasMoreBuckets && (!includeTaxonSearchComplement || pool.complementFetched)) {
        break;
      }
      continue;
    }

    const batchSize = Math.max(pageSize + 4, 16);
    const rawBatch = pool.rawBuckets.slice(pool.nextRawBucketIndex, pool.nextRawBucketIndex + batchSize);
    pool.nextRawBucketIndex += rawBatch.length;
    batchesProcessed++;

    const batchSettled = await runWithConcurrencyLimit(
      rawBatch,
      DISCOVERY_CONCURRENCY_LIMIT,
      async (bucket) => {
        const rawSp = await fetchSpeciesDetailCached(bucket.speciesKey);
        if (!rawSp) throw new Error(`GBIF species ${bucket.speciesKey} yüklenemedi`);

        let resolvedSp = rawSp;
        let synonymOf: string | undefined;

        if (rawSp.taxonomicStatus === 'SYNONYM' && rawSp.acceptedKey) {
          synonymOf = rawSp.canonicalName || rawSp.scientificName;
          const accSp = await fetchSpeciesDetailCached(Number(rawSp.acceptedKey));
          if (accSp?.key) resolvedSp = accSp;
        }

        if (resolvedSp.rank && resolvedSp.rank !== 'SPECIES' && resolvedSp.speciesKey && resolvedSp.speciesKey !== resolvedSp.key) {
          const parentSp = await fetchSpeciesDetailCached(Number(resolvedSp.speciesKey));
          if (parentSp?.key) resolvedSp = parentSp;
        }

        if (!resolvedSp?.key) return null;
        if (String(resolvedSp.kingdom || '').toLowerCase() !== 'animalia') return null;
        if (String(resolvedSp.rank || '').toUpperCase() !== 'SPECIES') return null;
        if (resolvedSp.taxonomicStatus && resolvedSp.taxonomicStatus !== 'ACCEPTED') return null;

        let canonical = String(resolvedSp.canonicalName || resolvedSp.scientificName || '').trim();
        let canonicalLower = canonical.toLowerCase();

        // Tartışmalı / örtüşen taksonomik ikizleri (örn. Canis anthus -> Canis lupaster) tek birleşik taksona yönlendir
        const mergedTarget = activeGroup.mergedEquivalents?.[canonicalLower];
        if (mergedTarget && mergedTarget.toLowerCase() !== canonicalLower) {
          const targetSp = await resolveCanonicalSpeciesTarget(mergedTarget);
          if (targetSp?.key) {
            synonymOf = synonymOf || `${canonical} (örtüşen taksonomik kompleks)`;
            resolvedSp = targetSp;
            canonical = String(resolvedSp.canonicalName || resolvedSp.scientificName || mergedTarget).trim();
            canonicalLower = canonical.toLowerCase();
          }
        }

        const canonicalWords = canonical.split(/\s+/).filter(Boolean);
        if (!canonical || canonicalWords.length < 2 || /\b(spec|sp|spp)\.?$/i.test(canonical)) {
          return null;
        }

        const localSciEntry = BILINGUAL_SPECIES_ENTRIES.find(
          e => e.entry.scientificName.toLowerCase() === canonicalLower
        )?.entry;

        const evidence = await evaluateSpeciesEvidence(resolvedSp, localSciEntry);
        const membership = evaluateBiologicalMembership(
          resolvedSp,
          canonicalLower,
          activeGroup,
          evidence,
          excludedSciSet,
          excludedTaxonomySet
        );

        let adjustedCount = bucket.count;
        let excludedSubspeciesNote: string | undefined;

        // Örn. Canis lupus (5219173) içinde yer alan evcil köpek alt türü (Canis lupus familiaris / C. familiaris) gözlemlerini düş
        if (
          membership.status !== 'EXCLUDED' &&
          Number(resolvedSp.key) === 5219173 &&
          activeGroup.excludedTaxonKeys &&
          activeGroup.excludedTaxonKeys.length > 0 &&
          adjustedCount > 0
        ) {
          const exclCount = await fetchExcludedSubspeciesCount(
            activeGroup.excludedTaxonKeys,
            countryParam,
            nonFossilBasisParam
          );
          if (exclCount > 0) {
            adjustedCount = Math.max(0, adjustedCount - exclCount);
            excludedSubspeciesNote = `Evcil köpek (Canis familiaris / Canis lupus familiaris) kayıtları (${exclCount.toLocaleString('tr-TR')}) çıkarıldı`;
          }
        }

        return {
          resolvedSp,
          canonical,
          canonicalLower,
          synonymOf,
          localSciEntry,
          evidence,
          membership,
          adjustedCount,
          excludedSubspeciesNote,
        };
      }
    );

    const batchNewItems: DiscoveredSpeciesItem[] = [];

    for (const s of batchSettled) {
      if (s.status !== 'fulfilled' || !s.value) continue;
      const {
        resolvedSp,
        canonical,
        canonicalLower,
        synonymOf,
        localSciEntry,
        evidence,
        membership,
        adjustedCount,
        excludedSubspeciesNote,
      } = s.value;

      if (membership.status === 'EXCLUDED') {
        pool.filteredOutOfGroupCount++;
        continue;
      }

      if (evidence.existenceStatus === 'FOSSIL_OR_EXTINCT' && !includeFossilOnly) {
        pool.filteredFossilCount++;
        continue;
      }

      if (evidence.existenceStatus === 'HISTORICAL_OR_UNCERTAIN' && !includeUncertainTaxa) {
        pool.uncertainOrHistoricalCount++;
        continue;
      }

      // Evcil alt tür çıkarıldıktan sonra 0 kalan kayıt (ör. bir ülkede yalnızca evcil köpek kaydı varsa) yabani kurt olarak sayılmaz
      if (excludedSubspeciesNote && adjustedCount <= 0) {
        pool.filteredOutOfGroupCount++;
        continue;
      }

      const acceptedKey = Number(resolvedSp.acceptedKey || resolvedSp.key);
      if (pool.seenAcceptedKeys.has(acceptedKey) || pool.seenCanonicalNames.has(canonicalLower)) {
        const existing = pool.verifiedItems.find(
          item => item.acceptedUsageKey === acceptedKey || item.canonicalName.toLowerCase() === canonicalLower
        ) || batchNewItems.find(
          item => item.acceptedUsageKey === acceptedKey || item.canonicalName.toLowerCase() === canonicalLower
        );
        if (existing) {
          existing.gbifRecordCount = Math.max(existing.gbifRecordCount, adjustedCount);
          if (synonymOf && !existing.synonymOf) existing.synonymOf = synonymOf;
        }
        continue;
      }

      if (evidence.existenceStatus === 'HISTORICAL_OR_UNCERTAIN') {
        pool.uncertainOrHistoricalCount++;
      }

      const item: DiscoveredSpeciesItem = {
        usageKey: Number(resolvedSp.key),
        acceptedUsageKey: acceptedKey,
        canonicalName: canonical,
        scientificName: String(resolvedSp.scientificName || canonical),
        rank: 'SPECIES',
        taxonomicStatus: String(resolvedSp.taxonomicStatus || 'ACCEPTED'),
        kingdom: String(resolvedSp.kingdom || 'Animalia'),
        phylum: resolvedSp.phylum,
        class: resolvedSp.class,
        order: resolvedSp.order,
        family: resolvedSp.family,
        genus: resolvedSp.genus,
        parentKey: typeof resolvedSp.parentKey === 'number' ? resolvedSp.parentKey : undefined,
        turkishName: localSciEntry?.turkishName || evidence.gbifTurkishName,
        englishName: localSciEntry?.englishName || evidence.gbifEnglishName,
        gbifRecordCount: adjustedCount,
        isFossilOnly: evidence.isFossilOnly,
        existenceStatus: evidence.existenceStatus,
        existenceEvidence: evidence.existenceEvidence,
        membershipStatus: membership.status,
        membershipEvidence: membership.evidence,
        excludedSubspeciesNote,
        isDomestic: DOMESTIC_CANONICAL_NAMES.has(canonicalLower),
        synonymOf,
        iucnStatus: localSciEntry?.iucn,
        iucnCategoryName: localSciEntry?.iucn ? getIucnLabel(localSciEntry.iucn) : undefined,
        iucnSource: localSciEntry?.iucn ? 'IUCN Kırmızı Liste / Canlı Atlası Referans Envanteri' : undefined,
        iucnVerified: Boolean(localSciEntry?.iucn),
        gbifUrl: `https://www.gbif.org/species/${acceptedKey}`,
        dataSource: 'GBIF Backbone & SpeciesProfiles API',
        matchType: 'EXACT',
        groupId: activeGroup.id,
        groupLabel: activeGroup.label,
      };

      pool.seenAcceptedKeys.add(acceptedKey);
      pool.seenCanonicalNames.add(canonicalLower);
      batchNewItems.push(item);
    }

    // Batch içi deterministik sıralama: yaşayan doğrulanmış türler önce, kayıt sayısı azalan
    batchNewItems.sort((a, b) => {
      const tierA = a.existenceStatus === 'LIVING' ? 0 : a.existenceStatus === 'HISTORICAL_OR_UNCERTAIN' ? 1 : 2;
      const tierB = b.existenceStatus === 'LIVING' ? 0 : b.existenceStatus === 'HISTORICAL_OR_UNCERTAIN' ? 1 : 2;
      if (tierA !== tierB) return tierA - tierB;
      return b.gbifRecordCount - a.gbifRecordCount;
    });

    pool.verifiedItems.push(...batchNewItems);
  }

  setCached(poolCacheKey, pool, 15 * 60 * 1000);

  const pageSpecies = pool.verifiedItems.slice(targetStartIdx, targetEndIdx);

  // Opsiyonel iNaturalist zenginleştirme (yalnızca sayfa dilimi, max 5 paralel istek; bulunamazsa boş kalır)
  if (enrichWithInaturalist && pageSpecies.length > 0) {
    const inatSettled = await runWithConcurrencyLimit(
      pageSpecies,
      DISCOVERY_CONCURRENCY_LIMIT,
      async (item) => {
        const inatCacheKey = `inat-taxon:v1:${item.canonicalName.toLowerCase()}`;
        let inat = getCached<Awaited<ReturnType<typeof fetchInatTaxon>>>(inatCacheKey);
        if (inat === null && !GBIF_CACHE.has(inatCacheKey)) {
          inat = await fetchInatTaxon(item.canonicalName);
          setCached(inatCacheKey, inat, 30 * 60 * 1000);
        }
        return { item, inat };
      }
    );

    for (const is of inatSettled) {
      if (is.status !== 'fulfilled' || !is.value.inat) continue;
      const { item, inat } = is.value;
      if (!item.turkishName && inat.turkishName) item.turkishName = inat.turkishName;
      if (!item.englishName && inat.englishName) item.englishName = inat.englishName;
      if (inat.photoUrl) item.photoUrl = inat.photoUrl;
      if (inat.photoAttribution) item.photoAttribution = inat.photoAttribution;
      if (inat.inatUrl) item.inaturalistUrl = inat.inatUrl;
      if (inat.iucnStatus) {
        item.iucnStatus = inat.iucnStatus;
        item.iucnCategoryName = inat.iucnCategoryName || getIucnLabel(inat.iucnStatus);
        item.iucnSource = 'iNaturalist & IUCN Kırmızı Liste Ortak Veri Ağı';
        item.iucnVerified = true;
      }
      item.dataSource = 'GBIF Backbone + SpeciesProfiles + iNaturalist';
    }
  }

  const hasMore =
    pool.verifiedItems.length > targetEndIdx ||
    pool.nextRawBucketIndex < pool.rawBuckets.length ||
    pool.apiHasMoreBuckets;
  const totalDiscovered = pool.verifiedItems.length;

  const noticeParts: string[] = [];
  if (totalDiscovered > 0) {
    noticeParts.push(
      `${activeGroup.label} grubu için ${countryName} kapsamında ${totalDiscovered.toLocaleString('tr-TR')}${hasMore ? '+' : ''} doğrulanmış tür listelendi (${pool.totalOccurrencesInScope.toLocaleString('tr-TR')} ham arşiv kaydı).`
    );
  } else {
    noticeParts.push(
      `${activeGroup.label} grubu için ${countryName} sınırları içinde doğrulanmış tür kaydı tespit edilemedi.`
    );
  }
  if (pool.filteredFossilCount > 0) {
    noticeParts.push(`${pool.filteredFossilCount} fosil/soyu tükenmiş kayıt hariç tutuldu.`);
  }
  if (pool.filteredOutOfGroupCount > 0) {
    noticeParts.push(`${pool.filteredOutOfGroupCount} grup dışı/evcil kayıt ayrıştırıldı.`);
  }
  if (pool.uncertainOrHistoricalCount > 0) {
    noticeParts.push(`${pool.uncertainOrHistoricalCount} tarihsel/belirsiz kayıt açıkça işaretlendi.`);
  }
  if (activeGroup.membershipPolicyNote) {
    noticeParts.push(activeGroup.membershipPolicyNote);
  }
  if (activeGroup.verificationWarning) {
    noticeParts.push(`Taksonomi doğrulama notu: ${activeGroup.verificationWarning}`);
  }

  const result: SpeciesDiscoveryResult = {
    query: queryLabel,
    countryCode,
    countryName,
    groups: verifiedGroups,
    activeGroupId: activeGroup.id,
    species: pageSpecies,
    totalOccurrencesInScope: pool.totalOccurrencesInScope,
    pagination: {
      page,
      pageSize,
      totalDiscovered,
      hasMore,
      facetOffset: targetStartIdx,
      nextFacetOffset: hasMore ? targetEndIdx : null,
    },
    uncertainOrHistoricalCount: pool.uncertainOrHistoricalCount,
    filteredFossilCount: pool.filteredFossilCount,
    filteredOutOfGroupCount: pool.filteredOutOfGroupCount,
    unresolvedGroups: unresolvedGroups.length > 0 ? unresolvedGroups : undefined,
    dataQualityNotice: noticeParts.join(' '),
    queriedAt: new Date().toISOString(),
  };

  setCached(discoveryCacheKey, result, 15 * 60 * 1000);
  return result;
}
