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
  BiologicalMembershipStatus,
  OccurrenceCountStatus,
  SubgroupMemberCursor,
  SubgroupPaginationMeta
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

const IN_FLIGHT_REQUESTS = new Map<string, Promise<any>>();

function runDedupedInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = IN_FLIGHT_REQUESTS.get(key);
  if (existing) return existing;
  const promise = fn().finally(() => {
    IN_FLIGHT_REQUESTS.delete(key);
  });
  IN_FLIGHT_REQUESTS.set(key, promise);
  return promise;
}

/**
 * Retry-After başlığını (saniye veya HTTP tarih formatı) milisaniyeye çevirir.
 * Sunucunun bildirdiği süreyi 8 saniyeye zorla indirmez.
 */
export function parseRetryAfterMs(retryAfterRaw: string | null): number | null {
  if (!retryAfterRaw) return null;
  const trimmed = retryAfterRaw.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const asSeconds = Number(trimmed);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.round(asSeconds * 1000);
    }
  }
  const asDateMs = Date.parse(trimmed);
  if (Number.isFinite(asDateMs)) {
    const delta = asDateMs - Date.now();
    return delta > 0 ? Math.round(delta) : 0;
  }
  return null;
}

interface HostQueueState {
  maxConcurrency: number;
  minIntervalMs: number;
  activeCount: number;
  lastStartedAt: number;
  cooldownUntil: number;
  timerId: ReturnType<typeof setTimeout> | null;
  waiters: Array<() => void>;
}

const HOST_QUEUES = new Map<string, HostQueueState>();

function getHostQueueKey(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('inaturalist.org')) return 'inaturalist';
    if (host.includes('gbif.org')) return 'gbif';
    if (host.includes('wikipedia.org') || host.includes('wikimedia.org')) return 'wikimedia';
    return host || 'default';
  } catch {
    if (url.includes('inaturalist.org')) return 'inaturalist';
    if (url.includes('gbif.org')) return 'gbif';
    if (url.includes('wikipedia.org') || url.includes('wikimedia.org')) return 'wikimedia';
    return 'default';
  }
}

function getOrCreateHostQueue(hostKey: string): HostQueueState {
  let state = HOST_QUEUES.get(hostKey);
  if (!state) {
    const isInat = hostKey === 'inaturalist';
    const isWiki = hostKey === 'wikimedia';
    state = {
      maxConcurrency: isInat ? 2 : isWiki ? 1 : 3,
      minIntervalMs: isInat ? 280 : isWiki ? 320 : 70,
      activeCount: 0,
      lastStartedAt: 0,
      cooldownUntil: 0,
      timerId: null,
      waiters: [],
    };
    HOST_QUEUES.set(hostKey, state);
  }
  return state;
}

function pumpHostQueue(hostKey: string): void {
  const state = getOrCreateHostQueue(hostKey);
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  while (state.waiters.length > 0 && state.activeCount < state.maxConcurrency) {
    const now = Date.now();
    const earliestStart = Math.max(state.cooldownUntil, state.lastStartedAt + state.minIntervalMs);
    if (now < earliestStart) {
      const delay = Math.max(10, earliestStart - now);
      state.timerId = setTimeout(() => {
        state.timerId = null;
        pumpHostQueue(hostKey);
      }, delay);
      return;
    }

    const nextWaiter = state.waiters.shift();
    if (nextWaiter) {
      state.activeCount++;
      state.lastStartedAt = now;
      nextWaiter();
    }
  }
}

export function setHostCooldown(hostKey: string, waitMs: number): void {
  if (!Number.isFinite(waitMs) || waitMs <= 0) return;
  const state = getOrCreateHostQueue(hostKey);
  const until = Date.now() + Math.round(waitMs);
  if (until > state.cooldownUntil) {
    state.cooldownUntil = until;
    if (state.waiters.length > 0) {
      pumpHostQueue(hostKey);
    }
  }
}

export function getHostCooldownRemainingMs(urlOrHostKey: string): number {
  const hostKey = urlOrHostKey.includes('://') ? getHostQueueKey(urlOrHostKey) : urlOrHostKey;
  const state = HOST_QUEUES.get(hostKey);
  if (!state) return 0;
  return Math.max(0, state.cooldownUntil - Date.now());
}

export function resetHostQueuesForTest(): void {
  for (const state of HOST_QUEUES.values()) {
    if (state.timerId) clearTimeout(state.timerId);
  }
  HOST_QUEUES.clear();
}

export function clearGbifCacheForTest(): void {
  GBIF_CACHE.clear();
  IN_FLIGHT_REQUESTS.clear();
}

async function withHostRequestSlot<T>(url: string, task: () => Promise<T>): Promise<T> {
  const hostKey = getHostQueueKey(url);
  const state = getOrCreateHostQueue(hostKey);

  await new Promise<void>((resolve) => {
    state.waiters.push(resolve);
    pumpHostQueue(hostKey);
  });

  try {
    return await task();
  } finally {
    state.activeCount = Math.max(0, state.activeCount - 1);
    pumpHostQueue(hostKey);
  }
}

/**
 * Paylaşımlı host kuyruğu, zaman aşımı (Timeout) ve sınırlı otomatik yeniden deneme
 * (Retry / HTTP 429 Retry-After paylaşımlı cooldown) mekanizmalı fetch sarmalayıcısı
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  maxRetries = 2,
  timeoutMs = 8000
): Promise<Response> {
  const hostKey = getHostQueueKey(url);
  let attempt = 0;
  let lastError: any = null;
  const boundedMaxRetries = Math.max(0, Math.min(3, Math.floor(maxRetries)));
  const rateLimitMaxAttempts = Math.min(3, Math.max(boundedMaxRetries, 2));

  while (true) {
    try {
      const response = await withHostRequestSlot(url, async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, {
            ...init,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
      });

      const is429 = response.status === 429;
      const is5xx = response.status >= 500;
      const allowedAttempts = is429 ? rateLimitMaxAttempts : boundedMaxRetries;

      if (!response.ok && (is429 || is5xx)) {
        const retryAfterMs = is429 ? parseRetryAfterMs(response.headers?.get?.('Retry-After')) : null;
        const jitter = Math.floor(Math.random() * 180);
        const waitMs = is429
          ? (retryAfterMs !== null ? retryAfterMs : Math.min(6000, 1000 * Math.pow(2, attempt) + jitter))
          : 350 * (attempt + 1) + jitter;

        if (is429 && waitMs > 0) {
          setHostCooldown(hostKey, waitMs);
        }

        if (attempt < allowedAttempts) {
          attempt++;
          if (waitMs > 0) {
            await new Promise((r) => setTimeout(r, waitMs));
          }
          continue;
        }
      }
      return response;
    } catch (err: any) {
      lastError = err;
      if (attempt < boundedMaxRetries) {
        attempt++;
        const jitter = Math.floor(Math.random() * 150);
        await new Promise((r) => setTimeout(r, 350 * attempt + jitter));
      } else {
        break;
      }
    }
  }

  throw lastError || new Error(`Ağ isteği başarısız: ${url}`);
}

export interface SafeJsonParseResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  errorType?: 'HTTP_ERROR' | 'INVALID_JSON';
  errorMessage?: string;
}

async function fetchSafeJson<T = any>(
  url: string,
  serviceLabel: string,
  maxRetries = 1,
  timeoutMs = 7000
): Promise<SafeJsonParseResult<T>> {
  return runDedupedInFlight(`json-req:${url}`, async () => {
    const res = await fetchWithRetry(url, undefined, maxRetries, timeoutMs);
    return readSafeJsonResponse<T>(res, serviceLabel);
  });
}

async function readSafeJsonResponse<T = any>(
  res: Response,
  serviceLabel: string
): Promise<SafeJsonParseResult<T>> {
  const status = typeof res?.status === 'number' ? res.status : 0;

  if (!res || !res.ok) {
    let preview = '';
    try {
      if (res && typeof res.text === 'function') {
        preview = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 180);
      }
    } catch {
      preview = '';
    }
    const detailSuffix = preview ? ` (${preview})` : '';
    return {
      ok: false,
      status,
      data: null,
      errorType: 'HTTP_ERROR',
      errorMessage: `${serviceLabel} HTTP ${status || 'hata'} yanıtı döndürdü${detailSuffix}.`,
    };
  }

  let rawText = '';
  try {
    if (typeof res.text === 'function') {
      rawText = await res.text();
    } else if (typeof res.json === 'function') {
      const fallbackData = await res.json();
      if (!fallbackData || typeof fallbackData !== 'object') {
        return {
          ok: false,
          status,
          data: null,
          errorType: 'INVALID_JSON',
          errorMessage: `${serviceLabel} geçersiz veya boş JSON nesnesi döndürdü.`,
        };
      }
      return { ok: true, status, data: fallbackData as T };
    }
  } catch (readErr: any) {
    return {
      ok: false,
      status,
      data: null,
      errorType: 'INVALID_JSON',
      errorMessage: `${serviceLabel} yanıt gövdesi okunamadı: ${readErr?.message || 'Bilinmeyen okuma hatası'}.`,
    };
  }

  const trimmed = rawText.trim();
  if (!trimmed || trimmed.startsWith('<')) {
    const kind = trimmed.startsWith('<') ? 'XML/HTML' : 'boş';
    return {
      ok: false,
      status,
      data: null,
      errorType: 'INVALID_JSON',
      errorMessage: `${serviceLabel} JSON yerine ${kind} yanıt döndürdü (HTTP ${status || 200}).`,
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        status,
        data: null,
        errorType: 'INVALID_JSON',
        errorMessage: `${serviceLabel} beklenen JSON nesne formatında yanıt vermedi.`,
      };
    }
    return { ok: true, status, data: parsed as T };
  } catch {
    return {
      ok: false,
      status,
      data: null,
      errorType: 'INVALID_JSON',
      errorMessage: `${serviceLabel} geçersiz JSON yanıtı döndürdü (${trimmed.slice(0, 120)}).`,
    };
  }
}

export const GBIF_BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

export interface CommonSpeciesEntry {
  scientificName: string;
  turkishName: string;
  englishName?: string;
  iucn?: string;
  category: string;
  populationNote?: string;
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
    aliases: ['ova zebrası', 'bayağı zebra', 'plains zebra', 'common zebra'],
    entry: { scientificName: 'Equus quagga', turkishName: 'Ova Zebrası', englishName: 'Plains Zebra', iucn: 'NT', category: 'Memeliler' },
  },
  {
    aliases: ['dağ zebrası', 'mountain zebra'],
    entry: { scientificName: 'Equus zebra', turkishName: 'Dağ Zebrası', englishName: 'Mountain Zebra', iucn: 'VU', category: 'Memeliler' },
  },
  {
    aliases: ['grevy zebrası', "grévy's zebra", "grevy's zebra", 'imperial zebra'],
    entry: { scientificName: 'Equus grevyi', turkishName: 'Grevy Zebrası', englishName: "Grévy's Zebra", iucn: 'EN', category: 'Memeliler' },
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
  {
    aliases: ['at', 'evcil at', 'horse', 'domestic horse'],
    entry: { scientificName: 'Equus caballus', turkishName: 'At', englishName: 'Domestic Horse', category: 'Memeliler' },
  },
  {
    aliases: ['eşek', 'evcil eşek', 'donkey'],
    entry: {
      scientificName: 'Equus asinus',
      turkishName: 'Eşek',
      englishName: 'Donkey',
      category: 'Memeliler',
      alternatives: [
        { scientificName: 'Equus africanus', turkishName: 'Afrika Yaban Eşeği' },
      ],
    },
  },
  {
    aliases: ['tibet atı', 'tibetan horse', 'tibetan pony', 'riwoche horse'],
    entry: {
      scientificName: 'Equus caballus',
      turkishName: 'At (Tibet Atı Popülasyonu / Irkı)',
      englishName: 'Domestic Horse (Tibetan Horse Breed)',
      category: 'Memeliler',
      populationNote:
        'Not: "Tibet atı" ayrı bir biyolojik tür değildir; evcil at (Equus caballus) türüne ait yerel bir at ırkı veya popülasyonudur. Yabani tür olan Tibet yaban eşeği / Kiang (Equus kiang) ile karıştırılmamalıdır.',
    },
  },
  {
    aliases: ['tibet yaban eşeği', 'kiang', 'tibetan wild ass'],
    entry: {
      scientificName: 'Equus kiang',
      turkishName: 'Tibet Yaban Eşeği (Kiang)',
      englishName: 'Kiang (Tibetan Wild Ass)',
      category: 'Memeliler',
    },
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
  if (lower.length >= 5 && (lower.endsWith('lar') || lower.endsWith('ler'))) {
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

interface ParsedParentheticalQuery {
  hasParentheses: boolean;
  outerText: string;
  innerText: string;
  innerLooksLikeAuthority: boolean;
}

function extractParentheticalParts(raw: string): ParsedParentheticalQuery {
  const clean = normalizeSearchQuery(raw).replace(/（/g, '(').replace(/）/g, ')');
  const match = clean.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (!match) {
    return {
      hasParentheses: false,
      outerText: clean,
      innerText: '',
      innerLooksLikeAuthority: false,
    };
  }
  const outerText = match[1].trim();
  const innerText = match[2].trim();
  const innerLooksLikeAuthority = /\d{4}|,|\bet\s+al\.?\b|\bL\.$/i.test(innerText);
  return {
    hasParentheses: true,
    outerText,
    innerText,
    innerLooksLikeAuthority,
  };
}

function isScientificBinomialCandidate(text: string): boolean {
  const parts = normalizeSearchQuery(text).split(' ').filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every(p => /^[a-zA-Z-]+$/.test(p));
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
  return runDedupedInFlight(`bb-verify:${formatted.toLowerCase()}`, async () => {
    const parsed = await fetchSafeJson<GbifBackboneMatchResult>(
      `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(formatted)}&verbose=true`,
      'GBIF Species Match API',
      2,
      8000
    );
    if (!parsed.ok || !parsed.data) {
      throw new Error(parsed.errorMessage || 'GBIF taksonomi eşleştirme servisi geçersiz yanıt döndürdü.');
    }
    const gbifData: GbifBackboneMatchResult = parsed.data;

    if (!gbifData || gbifData.matchType === 'NONE' || !gbifData.usageKey) {
      return { matched: false, data: gbifData || {} };
    }

    let resolvedData: GbifBackboneMatchResult = gbifData;
    let synonymOf: string | undefined;

    // Sinonim bulunduğunda GBIF Backbone üzerindeki kabul edilmiş taksona yönlendir
    if (gbifData.status === 'SYNONYM' && gbifData.acceptedUsageKey) {
      try {
        const accData = await fetchSpeciesDetailCached(gbifData.acceptedUsageKey);
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
      } catch (synErr) {
        console.warn('Accepted taxon resolution failed:', synErr);
      }
    } else if (gbifData.status === 'SYNONYM' && gbifData.accepted) {
      synonymOf = gbifData.accepted;
    }

    return { matched: true, data: resolvedData, synonymOf };
  });
}

function scoreCommonNameMatch(candidateName: string | undefined, query: string): number {
  if (!candidateName) return 0;
  const candLower = toTrLower(candidateName);
  const queryLower = toTrLower(query);
  const candFold = foldTurkishChars(candidateName);
  const queryFold = foldTurkishChars(query);

  if (!queryFold || queryFold.length < 2) return 0;
  if (candLower === queryLower || candFold === queryFold) return 100;

  // Çok kısa (<= 2 harf) sorgularda alt-dize veya çok kelimeli ifade içi belirsiz eşleşmeleri asla kabul etme
  if (queryFold.length <= 2) return 0;

  const escaped = queryFold.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(`(?:^|\\s|-)${escaped}(?:$|\\s|-)`, 'i');
  if (wordRegex.test(candFold)) {
    const candWords = candFold.split(/[\s,/-]+/).filter(Boolean);
    if (candWords.length <= 1) return 85;
    const lastWord = candWords[candWords.length - 1];
    // Türkçe ve İngilizce tür adlarında ana tür kelimesi sondadır (ör. "Kızıl Tilki", "Red Fox"); baştaki niteleyici ("Eşek Arısı", "Zebra Kumru") tek başına eşleşme sayılmaz
    if (lastWord === queryFold) return 65;
    return 40;
  }

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
async function resolveCommonNameCandidates(query: string): Promise<{
  candidates: DynamicCandidate[];
  hasSourceError: boolean;
  errorMessage?: string;
}> {
  const clean = normalizeSearchQuery(query);
  if (!clean || clean.length < 2) {
    return { candidates: [], hasSourceError: false };
  }

  const [inatTrAuto, inatEnAuto, inatTrTaxa, inatEnTaxa, gbifVern] = await Promise.allSettled([
    fetchSafeJson(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&locale=tr&per_page=8`, 'iNaturalist Autocomplete (TR)', 1, 6000),
    fetchSafeJson(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&locale=en&per_page=8`, 'iNaturalist Autocomplete (EN)', 1, 6000),
    fetchSafeJson(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(clean)}&locale=tr&rank=species&per_page=8`, 'iNaturalist Taxa (TR)', 1, 6000),
    fetchSafeJson(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(clean)}&locale=en&rank=species&per_page=8`, 'iNaturalist Taxa (EN)', 1, 6000),
    fetchSafeJson(`https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&q=${encodeURIComponent(clean)}&qField=VERNACULAR&rank=SPECIES&status=ACCEPTED&limit=10`, 'GBIF Vernacular Search', 1, 6000),
  ]);

  let successfulSources = 0;
  let failedSources = 0;
  let firstErrorMessage: string | undefined;
  for (const s of [inatTrAuto, inatEnAuto, inatTrTaxa, inatEnTaxa, gbifVern]) {
    if (s.status === 'fulfilled' && s.value.ok && s.value.data && Array.isArray((s.value.data as any).results)) {
      successfulSources++;
    } else {
      failedSources++;
      if (!firstErrorMessage) {
        firstErrorMessage =
          s.status === 'fulfilled'
            ? s.value.errorMessage
            : (s.reason?.message || 'Yaygın ad eşleştirme servisi yanıt vermedi.');
      }
    }
  }

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
  const cleanFoldLen = foldTurkishChars(clean).length;
  const inatSources = [inatTrAuto, inatEnAuto, inatTrTaxa, inatEnTaxa];
  for (const src of inatSources) {
    if (src.status !== 'fulfilled' || !src.value.ok || !Array.isArray(src.value.data?.results)) continue;
    for (const t of src.value.data.results) {
      if (!t || t.rank !== 'species' || !t.name) continue;
      const iconic = String(t.iconic_taxon_name || '').toLowerCase();
      if (!ANIMAL_INAT_ICONIC_TAXA.has(iconic)) continue;

      const prefScore = scoreCommonNameMatch(t.preferred_common_name, clean);
      const engScore = scoreCommonNameMatch(t.english_common_name, clean);
      const matchedTermIsNotSci =
        t.matched_term &&
        String(t.matched_term).toLowerCase() !== String(t.name).toLowerCase();
      const rawMatchedTermScore = matchedTermIsNotSci
        ? scoreCommonNameMatch(t.matched_term, clean)
        : 0;
      const obsCount = typeof t.observations_count === 'number' ? t.observations_count : 0;

      // API'nin yalnız matched_term alanını döndürmesi farklı dildeki/belirsiz eşleşmelerde tek başına yeterli sayılmaz
      let matchedTermScore = 0;
      if (prefScore > 0 || engScore > 0) {
        matchedTermScore = rawMatchedTermScore;
      } else if (cleanFoldLen >= 3 && rawMatchedTermScore >= 100 && obsCount >= 50) {
        matchedTermScore = 68;
      }

      const bestNameScore = Math.max(prefScore, engScore, matchedTermScore);
      if (bestNameScore < 65) continue;

      if (obsCount < 5 && bestNameScore < 100) continue;

      const obsBonus = Math.min(25, Math.log10(Math.max(1, obsCount)) * 4);
      registerCandidate(t.name, t.preferred_common_name || t.english_common_name, bestNameScore + obsBonus);
    }
  }

  // 2. GBIF Backbone VERNACULAR sonuçlarını değerlendir
  if (gbifVern.status === 'fulfilled' && gbifVern.value.ok && Array.isArray(gbifVern.value.data?.results)) {
    for (const r of gbifVern.value.data.results) {
      if (!r || r.rank !== 'SPECIES' || !r.canonicalName) continue;
      const kingdom = String(r.kingdom || '').toLowerCase();
      if (kingdom !== 'animalia') continue;

      const vernNames: Array<{ vernacularName?: string; language?: string }> = Array.isArray(r.vernacularNames)
        ? r.vernacularNames
        : [];
      let bestVernScore = 0;
      let matchedVern = '';

      for (const v of vernNames) {
        if (!v?.vernacularName || v.vernacularName.length > 55) continue;
        const lang = String(v.language || '').toLowerCase();
        const isAllowedLang = lang === 'tur' || lang === 'eng' || lang === 'tr' || lang === 'en';
        const sc = scoreCommonNameMatch(v.vernacularName, clean);
        if (!isAllowedLang) {
          if (lang || cleanFoldLen < 4 || sc < 100) continue;
        }
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

  if (candidateMap.size === 0 && failedSources > 0) {
    throw new Error(firstErrorMessage || 'Yaygın ad eşleştirme API servislerinden geçerli yanıt alınamadı.');
  }

  return {
    candidates: Array.from(candidateMap.values()).sort((a, b) => b.score - a.score),
    hasSourceError: failedSources > 0,
    errorMessage: firstErrorMessage,
  };
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

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    const cachedInside = getCached<SpeciesInfo>(cacheKey);
    if (cachedInside) return cachedInside;

    // 1. Parantezli sorgu ayrıştırma ve çift dilli (Türkçe & İngilizce) yaygın ad sözlüğü kontrolü
    const paren = extractParentheticalParts(normalizedInput);
    const directCommonEntry = lookupCommonSpeciesEntry(normalizedInput);
    const outerCommonEntry =
      !directCommonEntry && paren.hasParentheses && !paren.innerLooksLikeAuthority && paren.outerText
        ? lookupCommonSpeciesEntry(paren.outerText)
        : null;
    const innerCommonEntry =
      !directCommonEntry && paren.hasParentheses && !paren.innerLooksLikeAuthority && paren.innerText
        ? lookupCommonSpeciesEntry(paren.innerText)
        : null;

    let commonEntry: CommonSpeciesEntry | null = directCommonEntry;
    let targetScientific = directCommonEntry ? directCommonEntry.scientificName : normalizedInput;
    let predefinedTurkishName = directCommonEntry?.turkishName || '';
    let predefinedEnglishName = directCommonEntry?.englishName || '';
    let predefinedIucn: string | undefined = directCommonEntry?.iucn;
    let predefinedPopulationNote: string | undefined = directCommonEntry?.populationNote;
    let iucnSource = 'Resmi IUCN değerlendirme kaydı bulunamadı (NE)';
    let iucnVerified = false;
    let ambiguityAlternatives: Array<{ scientificName: string; turkishName: string }> = directCommonEntry?.alternatives || [];

    if (predefinedIucn) {
      iucnSource = 'IUCN Kırmızı Liste / Canlı Atlası Referans Envanteri';
      iucnVerified = true;
    }

    try {
      let resolvedData: GbifBackboneMatchResult = {};
      let isMatched = false;
      let synonymOf: string | undefined;
      let hadCommonSourceError = false;
      let commonSourceErrorMsg: string | undefined;

      const wordCount = normalizedInput.split(' ').length;

      const tryVerifySpeciesCandidate = async (candidate: string, allowAnyRankFromCommon: boolean): Promise<boolean> => {
        const check = await verifyWithGbifBackbone(candidate);
        if (!check.matched) return false;
        const d = check.data;
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
          (allowAnyRankFromCommon && Boolean(d.usageKey));

        if (!isVirusOrNoise && hasValidConfidence && isAcceptedRank) {
          resolvedData = d;
          synonymOf = check.synonymOf;
          targetScientific = d.canonicalName || candidate;
          return true;
        }
        return false;
      };

      // 2. Doğrudan GBIF Backbone /species/match ile taksonomik doğrulama
      //    (Yaygın ad sözlüğünden gelmişse, parantez içinde bilimsel ad varsa veya kullanıcı bilimsel ad yazmışsa)
      if (directCommonEntry) {
        isMatched = await tryVerifySpeciesCandidate(directCommonEntry.scientificName, true);
      } else if (paren.hasParentheses) {
        if (paren.innerLooksLikeAuthority) {
          isMatched = await tryVerifySpeciesCandidate(normalizedInput, false);
          if (!isMatched && paren.outerText && isScientificBinomialCandidate(paren.outerText)) {
            isMatched = await tryVerifySpeciesCandidate(paren.outerText, false);
          }
        } else {
          // Parantez içinde bilimsel tür adı varsa (ör. "Kızıl tilki (Vulpes vulpes)", "Red fox (Vulpes vulpes)")
          if (paren.innerText && isScientificBinomialCandidate(paren.innerText) && !innerCommonEntry) {
            isMatched = await tryVerifySpeciesCandidate(paren.innerText, false);
          }
          // Dış kısım bilimsel tür adıysa (ör. "Vulpes vulpes (Kızıl tilki)")
          if (!isMatched && paren.outerText && isScientificBinomialCandidate(paren.outerText) && !outerCommonEntry) {
            isMatched = await tryVerifySpeciesCandidate(paren.outerText, false);
          }
          // Parantez içi veya dışı bilinen yaygın ad sözlüğündeyse (ör. "Kızıl Tilki (Red Fox)", "Katil Balina (Orka)")
          if (!isMatched && (innerCommonEntry || outerCommonEntry)) {
            const chosenEntry = innerCommonEntry || outerCommonEntry!;
            commonEntry = chosenEntry;
            predefinedTurkishName = chosenEntry.turkishName || '';
            predefinedEnglishName = chosenEntry.englishName || '';
            predefinedIucn = chosenEntry.iucn;
            predefinedPopulationNote = chosenEntry.populationNote;
            ambiguityAlternatives = chosenEntry.alternatives || [];
            if (predefinedIucn) {
              iucnSource = 'IUCN Kırmızı Liste / Canlı Atlası Referans Envanteri';
              iucnVerified = true;
            }
            isMatched = await tryVerifySpeciesCandidate(chosenEntry.scientificName, true);
          }
        }
      } else if (wordCount >= 2) {
        isMatched = await tryVerifySpeciesCandidate(targetScientific, false);
      }

      // 3. Doğrudan bilimsel ad eşleşmediyse Türkçe/İngilizce yaygın ad adaylarını
      //    iNaturalist + GBIF Backbone VERNACULAR üzerinden ara ve GBIF Backbone ile doğrula
      if (!isMatched && !commonEntry) {
        let commonRes = await resolveCommonNameCandidates(normalizedInput);
        if (commonRes.candidates.length === 0 && paren.hasParentheses && !paren.innerLooksLikeAuthority && paren.outerText) {
          commonRes = await resolveCommonNameCandidates(paren.outerText);
        }
        hadCommonSourceError = commonRes.hasSourceError;
        commonSourceErrorMsg = commonRes.errorMessage;
        const candidates = commonRes.candidates;
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

      if ((!isMatched || !resolvedData.usageKey) && hadCommonSourceError) {
        throw new Error(commonSourceErrorMsg || 'Yaygın ad eşleştirme kaynaklarından birine erişilemedi.');
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

      // iNaturalist üzerinden fotoğraf, Türkçe/İngilizce ad ve özet desteği (eksik fotoğrafta Wikipedia/Wikimedia & GBIF StillImage fallback ile; eşzamanlı istekler tekilleştirilir)
      const inatOutcome = await runDedupedInFlight(
        `match-inat:v3:${canonicalName.toLowerCase()}`,
        () => fetchInatTaxon(canonicalName, { includeSummary: true, usageKey: resolvedData.usageKey })
      );
      const inatInfo = inatOutcome.status === 'FOUND' ? inatOutcome.data : null;

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
      if (predefinedPopulationNote) {
        summaryText = summaryText ? `${summaryText} ${predefinedPopulationNote}` : predefinedPopulationNote;
      }
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
        photoSource: inatInfo?.photoSource,
        iucnStatus: finalIucn,
        iucnCategoryName: finalIucnCategory,
        iucnSource,
        iucnVerified,
        summary: summaryText || undefined,
        inaturalistUrl: inatInfo?.inatUrl,
        gbifUrl: `https://www.gbif.org/species/${resolvedData.usageKey}`,
      };

      // iNaturalist geçici hata verdiyse eksik meta verili kaydı önbelleğe kitleme; sonraki denemede tekrar sorulabilsin
      if (inatOutcome.status !== 'ERROR') {
        setCached(cacheKey, result);
      }
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
  });
}

export interface InatTaxonMetadata {
  turkishName?: string;
  englishName?: string;
  photoUrl?: string;
  photoAttribution?: string;
  photoSource?: string;
  iucnStatus?: string;
  iucnCategoryName?: string;
  summary?: string;
  inatUrl?: string;
  fallbackCheckedWithKey?: number;
}

export type InatTaxonFetchOutcome =
  | { status: 'FOUND'; data: InatTaxonMetadata }
  | { status: 'NOT_FOUND' }
  | { status: 'ERROR'; statusCode?: number; errorMessage: string };

export interface FetchInatTaxonOptions {
  includeSummary?: boolean;
  usageKey?: number;
  skipFallbackPhoto?: boolean;
}

function formatShortLicenseLabel(rawLicense?: string): string {
  if (!rawLicense) return '';
  const lower = rawLicense.toLowerCase();
  if (lower.includes('publicdomain/zero') || lower.includes('cc0')) return 'CC0';
  if (lower.includes('publicdomain/mark') || lower === 'pd') return 'Public Domain';
  const ccMatch = lower.match(/creativecommons\.org\/licenses\/([^/]+)\/([^/]+)/);
  if (ccMatch) return `CC ${ccMatch[1].toUpperCase()} ${ccMatch[2]}`;
  return rawLicense.length <= 28 ? rawLicense : '';
}

function isUsableImageThumbnailUrl(url: string | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (/^https:\/\/ids\.si\.edu\//i.test(url)) return false;
  if (/\.(svg|pdf|html|htm|cfm)(?:$|\?)/i.test(url)) return false;
  if (/\/(?:range|distribution|status_iucn|red_list|cladogram|phylogeny|commons-logo|flag_of|question_book|ambox|disambig)/i.test(url)) {
    return false;
  }
  if (/image_details\.cfm/i.test(url)) return false;
  return true;
}

function extractCommonsFilenameFromUrl(url: string): string | null {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const thumbMatch = pathname.match(/\/thumb\/[^/]+\/[^/]+\/([^/]+)\/[^/]+$/);
    if (thumbMatch?.[1]) return thumbMatch[1];
    const directMatch = pathname.match(/\/commons\/[^/]+\/[^/]+\/([^/]+)$/);
    if (directMatch?.[1]) return directMatch[1];
  } catch {
    // ignore URL parse error
  }
  return null;
}

export interface ImageAssetVerificationResult {
  verified: boolean;
  status: number;
  contentType: string | null;
  magicType: string | null;
  corsOpaque?: boolean;
  reason?: string;
}

function detectImageMagicBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic';
  }
  return null;
}

function looksLikeTextOrHtmlPrefix(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 64)).trimStart().toLowerCase();
  return sample.startsWith('<!doctype') || sample.startsWith('<html') || sample.startsWith('<xml') || sample.startsWith('<?xml') || sample.startsWith('{');
}

function isSafeRedirectTargetFallback(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '::1' ||
      host === '[::1]' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^0\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^\[?(fe80|fc00|fd)/i.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isTransientMediaVerifyFailure(res?: ImageAssetVerificationResult | null): boolean {
  if (!res) return true;
  if (res.verified) return false;
  const reason = String(res.reason || '').toUpperCase();
  if (
    reason === 'INVALID_IMAGE_URL' ||
    reason === 'INVALID_OR_UNSAFE_URL' ||
    reason === 'UNSAFE_REDIRECT_URL' ||
    reason === 'NON_IMAGE_CONTENT_TYPE' ||
    reason === 'HTML_OR_NON_IMAGE_BYTES' ||
    reason === 'UNRECOGNIZED_IMAGE_MAGIC' ||
    reason === 'CORP_BLOCKED_IN_BROWSER'
  ) {
    return false;
  }
  if (res.status === 403 || res.status === 404 || res.status === 410 || res.status === 400) {
    return false;
  }
  if (res.status === 0 || res.status === 429 || res.status >= 500) {
    return true;
  }
  return /TIMEOUT|ABORT|NETWORK|ERROR|MISSING|RATE_LIMIT|TOO_MANY_REDIRECTS/.test(reason);
}

async function fetchImageResponseWithSafeRedirects(
  startUrl: string,
  signal: AbortSignal,
  validateUrl: (u: string) => boolean
): Promise<{ ok: true; response: Response; finalUrl: string } | { ok: false; result: ImageAssetVerificationResult }> {
  let currentUrl = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    if (!validateUrl(currentUrl)) {
      return {
        ok: false,
        result: {
          verified: false,
          status: 0,
          contentType: null,
          magicType: null,
          reason: hop === 0 ? 'INVALID_OR_UNSAFE_URL' : 'UNSAFE_REDIRECT_URL',
        },
      };
    }

    const res = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'CanliAtlasi/1.0 (https://github.com/canli-atlasi; educational-biodiversity-project)',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
      },
      signal,
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!location) {
        return {
          ok: false,
          result: {
            verified: false,
            status: res.status,
            contentType: res.headers.get('content-type'),
            magicType: null,
            reason: `HTTP_${res.status}`,
          },
        };
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return { ok: true, response: res, finalUrl: currentUrl };
  }

  return {
    ok: false,
    result: {
      verified: false,
      status: 0,
      contentType: null,
      magicType: null,
      reason: 'TOO_MANY_REDIRECTS',
    },
  };
}

/**
 * Görsel URL'sinin yalnızca HTTP 200 değil, gerçekten image/* Content-Type ve gerçek görsel baytları döndürdüğünü doğrular.
 * HTML/404 yanıtlarını reddeder; geçici ağ/429/5xx hatalarını kalıcı başarısızlık olarak önbelleğe almaz.
 */
export async function verifyImageAssetUrl(
  url: string | undefined,
  timeoutMs = 5500,
  validateExternalUrl?: (rawUrl: string) => boolean
): Promise<ImageAssetVerificationResult> {
  if (!isUsableImageThumbnailUrl(url)) {
    return { verified: false, status: 0, contentType: null, magicType: null, reason: 'INVALID_IMAGE_URL' };
  }

  const cacheKey = `img-verify:v2:${url}`;
  const cached = getCached<ImageAssetVerificationResult>(cacheKey);
  if (cached) return cached;

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Tarayıcı ortamında doğrudan üçüncü parti görsel CDN'lerine CORS fetch gönderme;
      // doğrulamayı aynı kök (same-origin) sunucu uç noktası üzerinden yap.
      if (typeof window !== 'undefined') {
        const res = await fetch(`/api/media/verify?url=${encodeURIComponent(url)}`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!res.ok) {
          return {
            verified: false,
            status: res.status,
            contentType: null,
            magicType: null,
            reason: `SERVER_VERIFY_HTTP_${res.status}`,
          };
        }
        const data = (await res.json()) as ImageAssetVerificationResult;
        const normalized: ImageAssetVerificationResult = {
          verified: Boolean(data?.verified),
          status: typeof data?.status === 'number' ? data.status : 0,
          contentType: data?.contentType ?? null,
          magicType: data?.magicType ?? null,
          reason: data?.reason,
        };
        if (normalized.verified) {
          setCached(cacheKey, normalized, 30 * 60 * 1000);
        } else if (!isTransientMediaVerifyFailure(normalized)) {
          setCached(cacheKey, normalized, 10 * 60 * 1000);
        }
        return normalized;
      }

      const safeValidator = validateExternalUrl || isSafeRedirectTargetFallback;
      let res: Response | null = null;
      let finalUrl = url;
      let lastNetworkReason = 'NETWORK_ERROR';

      for (let attempt = 0; attempt < 2; attempt++) {
        if (controller.signal.aborted) break;
        try {
          const hopRes = await fetchImageResponseWithSafeRedirects(url, controller.signal, safeValidator);
          if (!hopRes.ok) {
            if (!isTransientMediaVerifyFailure(hopRes.result)) {
              setCached(cacheKey, hopRes.result, 10 * 60 * 1000);
            }
            return hopRes.result;
          }
          res = hopRes.response;
          finalUrl = hopRes.finalUrl;
          if ((res.status === 429 || res.status >= 500) && attempt === 0 && !controller.signal.aborted) {
            try { await res.body?.cancel(); } catch { /* ignore */ }
            res = null;
            await new Promise((r) => setTimeout(r, 250));
            continue;
          }
          break;
        } catch (err: any) {
          lastNetworkReason = err?.name === 'AbortError' || controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
          if (attempt === 0 && lastNetworkReason === 'NETWORK_ERROR' && !controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, 250));
            continue;
          }
        }
      }

      if (!res) {
        return {
          verified: false,
          status: 0,
          contentType: null,
          magicType: null,
          reason: lastNetworkReason,
        };
      }

      const contentType = res.headers.get('content-type');
      const ctLower = (contentType || '').toLowerCase();

      if (!res.ok) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        const failed: ImageAssetVerificationResult = {
          verified: false,
          status: res.status,
          contentType,
          magicType: null,
          reason: `HTTP_${res.status}`,
        };
        if (!isTransientMediaVerifyFailure(failed)) {
          setCached(cacheKey, failed, 10 * 60 * 1000);
        }
        return failed;
      }

      const corpHeader = (res.headers.get('cross-origin-resource-policy') || '').toLowerCase().trim();
      if (corpHeader === 'same-origin' || corpHeader === 'same-site' || /(?:^|\/\/)ids\.si\.edu\//i.test(finalUrl)) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        const corpBlocked: ImageAssetVerificationResult = {
          verified: false,
          status: res.status,
          contentType,
          magicType: null,
          reason: 'CORP_BLOCKED_IN_BROWSER',
        };
        setCached(cacheKey, corpBlocked, 10 * 60 * 1000);
        return corpBlocked;
      }

      if (ctLower && !ctLower.startsWith('image/')) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        const nonImg: ImageAssetVerificationResult = {
          verified: false,
          status: res.status,
          contentType,
          magicType: null,
          reason: 'NON_IMAGE_CONTENT_TYPE',
        };
        setCached(cacheKey, nonImg, 10 * 60 * 1000);
        return nonImg;
      }

      let headBytes = new Uint8Array(0);
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        try {
          const chunks: Uint8Array[] = [];
          let total = 0;
          while (total < 32) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            chunks.push(value);
            total += value.length;
          }
          const combined = new Uint8Array(Math.min(total, 64));
          let offset = 0;
          for (const ch of chunks) {
            const take = Math.min(ch.length, combined.length - offset);
            combined.set(ch.subarray(0, take), offset);
            offset += take;
            if (offset >= combined.length) break;
          }
          headBytes = combined;
        } finally {
          try { await reader.cancel(); } catch { /* ignore */ }
        }
      }

      const magicType = detectImageMagicBytes(headBytes);
      if (headBytes.length > 0 && (looksLikeTextOrHtmlPrefix(headBytes) || (!magicType && !ctLower.startsWith('image/')))) {
        const invalidBytes: ImageAssetVerificationResult = {
          verified: false,
          status: res.status,
          contentType,
          magicType,
          reason: 'HTML_OR_NON_IMAGE_BYTES',
        };
        setCached(cacheKey, invalidBytes, 10 * 60 * 1000);
        return invalidBytes;
      }

      if (headBytes.length >= 4 && !magicType) {
        const badMagic: ImageAssetVerificationResult = {
          verified: false,
          status: res.status,
          contentType,
          magicType: null,
          reason: 'UNRECOGNIZED_IMAGE_MAGIC',
        };
        setCached(cacheKey, badMagic, 10 * 60 * 1000);
        return badMagic;
      }

      const okRes: ImageAssetVerificationResult = {
        verified: true,
        status: res.status,
        contentType,
        magicType: magicType || (ctLower.startsWith('image/') ? ctLower.split(';')[0].trim() : null),
      };
      setCached(cacheKey, okRes, 30 * 60 * 1000);
      return okRes;
    } catch (err: any) {
      return {
        verified: false,
        status: 0,
        contentType: null,
        magicType: null,
        reason: err?.name === 'AbortError'
          ? 'TIMEOUT'
          : typeof window !== 'undefined'
            ? 'SERVER_VERIFY_ERROR'
            : 'NETWORK_ERROR',
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function verifyImageAssetUrlsBatch(
  urls: string[],
  timeoutMs = 15000
): Promise<Map<string, ImageAssetVerificationResult>> {
  const resultMap = new Map<string, ImageAssetVerificationResult>();
  const pendingUrls: string[] = [];

  for (const raw of urls) {
    if (!isUsableImageThumbnailUrl(raw)) {
      if (raw) {
        resultMap.set(raw, { verified: false, status: 0, contentType: null, magicType: null, reason: 'INVALID_IMAGE_URL' });
      }
      continue;
    }
    const cached = getCached<ImageAssetVerificationResult>(`img-verify:v2:${raw}`);
    if (cached) {
      resultMap.set(raw, cached);
    } else if (!pendingUrls.includes(raw)) {
      pendingUrls.push(raw);
    }
  }

  if (pendingUrls.length === 0) return resultMap;

  if (typeof window !== 'undefined') {
    const postBatch = async (batchUrls: string[], batchTimeoutMs: number): Promise<{ ok: boolean; results: Record<string, ImageAssetVerificationResult> }> => {
      const chunks: string[][] = [];
      for (let i = 0; i < batchUrls.length; i += 10) {
        chunks.push(batchUrls.slice(i, i + 10));
      }

      const chunkResponses = await Promise.all(
        chunks.map(async (chunk) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), batchTimeoutMs);
          try {
            const res = await fetch('/api/media/verify-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls: chunk }),
              signal: controller.signal,
            });
            if (!res.ok) {
              return { ok: false, results: {} as Record<string, ImageAssetVerificationResult> };
            }
            const payload = await res.json();
            return { ok: true, results: (payload?.results || {}) as Record<string, ImageAssetVerificationResult> };
          } catch {
            return { ok: false, results: {} as Record<string, ImageAssetVerificationResult> };
          } finally {
            clearTimeout(timer);
          }
        })
      );

      const merged: Record<string, ImageAssetVerificationResult> = {};
      let anyOk = false;
      for (const cr of chunkResponses) {
        if (cr.ok) {
          anyOk = true;
          Object.assign(merged, cr.results);
        }
      }
      return { ok: anyOk, results: merged };
    };

    const firstAttempt = await postBatch(pendingUrls, timeoutMs);
    const transientRetryUrls: string[] = [];

    for (const u of pendingUrls) {
      const itemRes: ImageAssetVerificationResult = firstAttempt.results[u] || {
        verified: false,
        status: 0,
        contentType: null,
        magicType: null,
        reason: firstAttempt.ok ? 'SERVER_VERIFY_MISSING' : 'SERVER_VERIFY_ERROR',
      };
      resultMap.set(u, itemRes);
      if (itemRes.verified) {
        setCached(`img-verify:v2:${u}`, itemRes, 30 * 60 * 1000);
      } else if (!isTransientMediaVerifyFailure(itemRes)) {
        setCached(`img-verify:v2:${u}`, itemRes, 10 * 60 * 1000);
      } else if (transientRetryUrls.length < 8) {
        transientRetryUrls.push(u);
      }
    }

    // Geçici ağ/zaman aşımı hataları için yalnızca başarısız kalan URL'leri sınırlı olarak 1 kez daha dene
    if (transientRetryUrls.length > 0) {
      await new Promise((r) => setTimeout(r, 350));
      const retryAttempt = await postBatch(transientRetryUrls, Math.min(timeoutMs, 12000));
      if (retryAttempt.ok) {
        for (const u of transientRetryUrls) {
          const retryRes = retryAttempt.results[u];
          if (!retryRes) continue;
          resultMap.set(u, retryRes);
          if (retryRes.verified) {
            setCached(`img-verify:v2:${u}`, retryRes, 30 * 60 * 1000);
          } else if (!isTransientMediaVerifyFailure(retryRes)) {
            setCached(`img-verify:v2:${u}`, retryRes, 10 * 60 * 1000);
          }
        }
      }
    }

    return resultMap;
  }

  await runWithConcurrencyLimit(pendingUrls, 4, async (u) => {
    const r = await verifyImageAssetUrl(u, 5000);
    resultMap.set(u, r);
    return r;
  });
  return resultMap;
}

export interface FallbackPhotoResult {
  photoUrl: string;
  photoAttribution: string;
  photoSource: string;
  inatUrl?: string;
}

interface FallbackCandidatePhoto {
  photoUrl: string;
  photoAttribution: string;
  photoSource: string;
  inatUrl?: string;
  needsCommonsMeta?: boolean;
  wikiPageTitle?: string;
}

function isCleanBioCommonsCandidate(title: string, url: string, mime?: string, metaText?: string, sciLower?: string): boolean {
  const mimeLower = (mime || '').toLowerCase();
  if (mimeLower && !mimeLower.startsWith('image/') && !mimeLower.includes('tiff')) return false;
  if (/\.pdf(?:$|\?)/i.test(title) || /\.pdf(?:$|\?)/i.test(url)) return false;
  const combined = `${title} ${url}`.toLowerCase();
  if (/(?:verbreitung|distribution|range|cladogram|phylogeny|map|diagram|status_iucn|commons-logo|flag_of|question_book)/i.test(combined)) {
    return false;
  }
  if (!sciLower) return false;
  const normalizedTitle = title.replace(/^File:/i, '').replace(/[_-]+/g, ' ').toLowerCase();
  const normalizedMeta = (metaText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return normalizedTitle.includes(sciLower) || normalizedMeta.includes(sciLower);
}

function validateWikipediaPageForTaxon(
  page: any,
  cleanSci: string
): { photoUrl: string; wikiPageTitle: string } | null {
  if (!page || page.missing !== undefined || page.invalid !== undefined) return null;
  const thumb: string | undefined = page.thumbnail?.source;
  if (!isUsableImageThumbnailUrl(thumb)) return null;

  const sciLower = cleanSci.toLowerCase();
  const sciWords = sciLower.split(' ').filter(Boolean);
  const genusLower = sciWords[0] || '';
  const speciesLower = sciWords[1] || '';

  const titleLower = String(page.title || '').toLowerCase();
  const extractLower = String(page.extract || '').toLowerCase();
  const descLower = Array.isArray(page.terms?.description)
    ? String(page.terms.description[0] || '').toLowerCase()
    : '';

  const hasExactTitle = titleLower === sciLower;
  const hasBinomialInText = extractLower.includes(sciLower) || descLower.includes(sciLower);
  const isBioTaxonPage =
    /(?:species|subspecies|genus|animal|mammal|bird|reptile|amphibian|fish|insect|spider|arachnid|mollusc|cephalopod|octopus|crustacean|echinoderm|annelid|butterfly|moth|beetle|ant|wasp|bee|snake|lizard|frog|toad|turtle|shark)/i.test(descLower) ||
    /(?:is a species|is a subspecies)/i.test(extractLower);
  const hasSpeciesInGenusPage =
    Boolean(genusLower && speciesLower) &&
    extractLower.includes(genusLower) &&
    extractLower.includes(speciesLower) &&
    isBioTaxonPage;

  if (hasExactTitle || hasBinomialInText || hasSpeciesInGenusPage) {
    return {
      photoUrl: thumb,
      wikiPageTitle: String(page.title || cleanSci),
    };
  }
  return null;
}

/**
 * Birden fazla tür için Wikipedia thumbnail ve takson doğrulamasını tek toplu API isteğiyle getirir
 * (Wikimedia 429 hız sınırlarını önler).
 */
export async function fetchBatchWikipediaThumbnails(
  scientificNames: string[]
): Promise<{ map: Map<string, { photoUrl: string; wikiPageTitle: string } | null>; hadError: boolean }> {
  const map = new Map<string, { photoUrl: string; wikiPageTitle: string } | null>();
  let hadError = false;

  const uniqueCleanNames: string[] = [];
  const seenLower = new Set<string>();
  for (const raw of scientificNames) {
    const clean = normalizeSearchQuery(raw);
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      uniqueCleanNames.push(clean);
    }
  }

  for (let i = 0; i < uniqueCleanNames.length; i += 20) {
    const chunk = uniqueCleanNames.slice(i, i + 20);
    const titlesParam = chunk.map((n) => n.replace(/\s+/g, '_')).join('|');
    const res = await fetchSafeJson<any>(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titlesParam)}&prop=pageimages|extracts|pageterms&exintro=1&explaintext=1&exchars=400&piprop=thumbnail&pithumbsize=500&redirects=1&format=json&origin=*`,
      'Wikipedia Batch Query API',
      0,
      5500
    );

    if (!res.ok || !res.data?.query) {
      hadError = true;
      continue;
    }

    const normalizedMap = new Map<string, string>();
    for (const n of Array.isArray(res.data.query.normalized) ? res.data.query.normalized : []) {
      if (n?.from && n?.to) normalizedMap.set(String(n.from), String(n.to));
    }

    const redirectMap = new Map<string, string>();
    for (const r of Array.isArray(res.data.query.redirects) ? res.data.query.redirects : []) {
      if (r?.from && r?.to) redirectMap.set(String(r.from), String(r.to));
    }

    const pageByTitle = new Map<string, any>();
    const pages = res.data.query.pages ? Object.values<any>(res.data.query.pages) : [];
    for (const p of pages) {
      if (p?.title) pageByTitle.set(String(p.title), p);
    }

    for (const clean of chunk) {
      const slug = clean.replace(/\s+/g, '_');
      let resolvedTitle = normalizedMap.get(slug) || normalizedMap.get(clean) || clean;
      for (let hop = 0; hop < 3; hop++) {
        const nextTitle = redirectMap.get(resolvedTitle);
        if (!nextTitle || nextTitle === resolvedTitle) break;
        resolvedTitle = nextTitle;
      }
      const page = pageByTitle.get(resolvedTitle);
      map.set(clean.toLowerCase(), validateWikipediaPageForTaxon(page, clean));
    }
  }

  return { map, hadError };
}

/**
 * iNaturalist'te görseli olmayan veya ilk adayı başarısız olan türler için bilimsel ad doğrulamalı paralel yedek görsel çözümleyici:
 * 1) iNaturalist Tam Tür / Eş Anlamlı Taksonomik Ad Eşleşmesi (/v1/taxa?q=...)
 * 2) Wikipedia MediaWiki Query API (HTTP 200 güvenli veya toplu önbellekli)
 * 3) GBIF Species Media (/v1/species/{usageKey}/media — Zenodo/müze/taksonomik levhalar)
 * 4) GBIF Occurrence Media (taxonKey={usageKey}, StillImage)
 * 5) Wikimedia Commons (yalnızca birebir bilimsel ad eşleşmesi doğrulanırsa)
 */
export async function fetchVerifiedFallbackPhoto(
  scientificName: string,
  usageKey?: number,
  options?: {
    excludeUrls?: Set<string>;
    includeInatSynonymCheck?: boolean;
    skipWikiQuery?: boolean;
    preloadedWikiThumb?: { photoUrl: string; wikiPageTitle: string } | null;
    skipCommonsSearch?: boolean;
  }
): Promise<FallbackPhotoResult | null> {
  const cleanSci = normalizeSearchQuery(scientificName);
  if (!cleanSci) return null;
  const sciLower = cleanSci.toLowerCase();
  const sciWords = sciLower.split(' ').filter(Boolean);
  const excludeUrls = options?.excludeUrls;
  const useCache = !excludeUrls || excludeUrls.size === 0;

  const cacheKey = `fallback-photo:v4:${sciLower}:${usageKey || 0}:${options?.includeInatSynonymCheck ? 'syn' : 'nosyn'}`;
  if (useCache) {
    const cached = getCached<{ kind: 'FOUND'; data: FallbackPhotoResult } | { kind: 'NOT_FOUND' }>(cacheKey);
    if (cached) {
      return cached.kind === 'FOUND' ? cached.data : null;
    }
  }

  return runDedupedInFlight(`in-flight:${cacheKey}:${excludeUrls ? Array.from(excludeUrls).join('|') : ''}`, async () => {
    let hadTransientError = false;
    const candidates: FallbackCandidatePhoto[] = [];
    const seenCandidateUrls = new Set<string>();

    const pushCandidate = (cand: FallbackCandidatePhoto) => {
      if (!isUsableImageThumbnailUrl(cand.photoUrl)) return;
      if (excludeUrls?.has(cand.photoUrl) || seenCandidateUrls.has(cand.photoUrl)) return;
      seenCandidateUrls.add(cand.photoUrl);
      candidates.push(cand);
    };

    const slug = cleanSci.replace(/\s+/g, '_');
    const preloadedWiki = options?.preloadedWikiThumb ?? null;
    const hasPreloadedWiki = Boolean(preloadedWiki && isUsableImageThumbnailUrl(preloadedWiki.photoUrl));

    const [inatSynRes, wikiRes, spMediaRes, occRes, commonsRes] = await Promise.allSettled([
      options?.includeInatSynonymCheck
        ? fetchSafeJson<{ results?: any[] }>(
            `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(cleanSci)}&locale=tr&per_page=8`,
            'iNaturalist Taxa Synonym API',
            0,
            5000
          )
        : Promise.resolve(null),
      !options?.skipWikiQuery
        ? fetchSafeJson<any>(
            `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(slug)}&prop=pageimages|extracts|pageterms&exintro=1&explaintext=1&exchars=400&piprop=thumbnail&pithumbsize=500&redirects=1&format=json&origin=*`,
            'Wikipedia Query API',
            0,
            4500
          )
        : Promise.resolve(null),
      usageKey && Number.isFinite(usageKey)
        ? fetchSafeJson<{ results?: any[] }>(
            `https://api.gbif.org/v1/species/${usageKey}/media?limit=8`,
            'GBIF Species Media API',
            0,
            4500
          )
        : Promise.resolve(null),
      usageKey && Number.isFinite(usageKey)
        ? fetchSafeJson<{ results?: any[] }>(
            `https://api.gbif.org/v1/occurrence/search?taxonKey=${usageKey}&mediaType=StillImage&limit=8`,
            'GBIF Occurrence Media API',
            0,
            4500
          )
        : Promise.resolve(null),
      !options?.skipCommonsSearch && !hasPreloadedWiki
        ? fetchSafeJson<any>(
            `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`"${cleanSci}"`)}&gsrnamespace=6&gsrlimit=4&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=500&format=json&origin=*`,
            'Wikimedia Commons Search API',
            0,
            4500
          )
        : Promise.resolve(null),
    ]);

    // 1. iNaturalist Tam Tür / Eş Anlamlı Ad Adayları
    if (inatSynRes.status === 'fulfilled' && inatSynRes.value) {
      if (!inatSynRes.value.ok) {
        hadTransientError = true;
      } else if (Array.isArray(inatSynRes.value.data?.results)) {
        const matchedTaxon = inatSynRes.value.data.results.find((t: any) => {
          const rankOk = t?.rank === 'species' || t?.rank === 'subspecies' || t?.rank === 'variety';
          if (!rankOk) return false;
          const exactName = typeof t?.name === 'string' && t.name.toLowerCase() === sciLower;
          const exactSynonym =
            sciWords.length >= 2 &&
            typeof t?.matched_term === 'string' &&
            t.matched_term.toLowerCase() === sciLower;
          return exactName || exactSynonym;
        });
        const inatPhoto = matchedTaxon?.default_photo?.medium_url || matchedTaxon?.default_photo?.url;
        if (inatPhoto) {
          pushCandidate({
            photoUrl: inatPhoto,
            photoAttribution: matchedTaxon.default_photo?.attribution || `iNaturalist (${matchedTaxon.name})`,
            photoSource: 'iNaturalist',
            inatUrl: matchedTaxon.id ? `https://www.inaturalist.org/taxa/${matchedTaxon.id}` : undefined,
          });
        }
      }
    } else if (inatSynRes.status === 'rejected') {
      hadTransientError = true;
    }

    // 2. Wikipedia Taxon Thumbnail (önceden toplu yüklenmiş veya tekil sorgulanmış)
    let hasWikiThumb = false;
    if (options?.skipWikiQuery) {
      if (hasPreloadedWiki && preloadedWiki) {
        hasWikiThumb = true;
        pushCandidate({
          photoUrl: preloadedWiki.photoUrl,
          photoAttribution: `Wikimedia Commons / Wikipedia (${preloadedWiki.wikiPageTitle || cleanSci})`,
          photoSource: 'Wikimedia Commons',
          needsCommonsMeta: false,
          wikiPageTitle: preloadedWiki.wikiPageTitle || cleanSci,
        });
      }
    } else if (wikiRes.status === 'fulfilled' && wikiRes.value) {
      if (!wikiRes.value.ok) {
        hadTransientError = true;
      } else {
        const pagesObj = wikiRes.value.data?.query?.pages;
        const firstPage: any = pagesObj ? Object.values(pagesObj)[0] : null;
        const validWiki = validateWikipediaPageForTaxon(firstPage, cleanSci);
        if (validWiki) {
          hasWikiThumb = true;
          pushCandidate({
            photoUrl: validWiki.photoUrl,
            photoAttribution: `Wikimedia Commons / Wikipedia (${validWiki.wikiPageTitle || cleanSci})`,
            photoSource: 'Wikimedia Commons',
            needsCommonsMeta: true,
            wikiPageTitle: validWiki.wikiPageTitle || cleanSci,
          });
        }
      }
    } else if (wikiRes.status === 'rejected') {
      hadTransientError = true;
    }

    // 3. GBIF Species Media (/v1/species/{usageKey}/media — bilimsel tür levhaları ve müze kayıtları)
    if (spMediaRes.status === 'fulfilled' && spMediaRes.value) {
      if (!spMediaRes.value.ok) {
        hadTransientError = true;
      } else if (Array.isArray(spMediaRes.value.data?.results)) {
        let added = 0;
        for (const m of spMediaRes.value.data.results) {
          if (added >= 3) break;
          if (!m || m.type !== 'StillImage' || !isUsableImageThumbnailUrl(m.identifier)) continue;
          if (m.taxonKey && usageKey && Number(m.taxonKey) !== Number(usageKey)) continue;
          const fmt = String(m.format || '').toLowerCase();
          if (fmt && !fmt.startsWith('image/')) continue;
          const titleCheck = `${m.title || ''} ${m.description || ''} ${m.identifier}`.toLowerCase();
          if (/(?:range|distribution|cladogram|phylogeny|map\b)/i.test(titleCheck)) continue;

          const holder = m.creator || m.rightsHolder || m.publisher || m.source || 'GBIF Species Media';
          const lic = formatShortLicenseLabel(m.license);
          const attribution = lic ? `${holder} · ${lic} (GBIF)` : `${holder} (GBIF)`;
          pushCandidate({
            photoUrl: m.identifier,
            photoAttribution: attribution,
            photoSource: 'GBIF Species Media',
          });
          added++;
        }
      }
    } else if (spMediaRes.status === 'rejected') {
      hadTransientError = true;
    }

    // 4. GBIF Occurrence StillImage (taxonKey bazlı canlı ve müze gözlem kayıtları)
    if (occRes.status === 'fulfilled' && occRes.value) {
      if (!occRes.value.ok) {
        hadTransientError = true;
      } else if (Array.isArray(occRes.value.data?.results)) {
        const preferredOrder = ['HUMAN_OBSERVATION', 'OBSERVATION', 'MACHINE_OBSERVATION', 'LIVING_SPECIMEN', 'PRESERVED_SPECIMEN'];
        const sortedResults = [...occRes.value.data.results].sort((a, b) => {
          const ia = preferredOrder.indexOf(String(a?.basisOfRecord || ''));
          const ib = preferredOrder.indexOf(String(b?.basisOfRecord || ''));
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });

        let added = 0;
        for (const occ of sortedResults) {
          if (added >= 3) break;
          if (!occ || !Array.isArray(occ.media)) continue;
          const occKeyMatches =
            Number(occ.speciesKey) === Number(usageKey) ||
            Number(occ.acceptedTaxonKey) === Number(usageKey) ||
            Number(occ.taxonKey) === Number(usageKey);
          if (!occKeyMatches) continue;

          for (const m of occ.media) {
            if (added >= 3) break;
            if (!m || m.type !== 'StillImage' || !isUsableImageThumbnailUrl(m.identifier)) continue;
            const fmt = String(m.format || '').toLowerCase();
            const looksLikeImgUrl = /\.(jpe?g|png|webp)(?:$|\?)/i.test(m.identifier) || m.identifier.includes('/media/?');
            if (fmt && !fmt.startsWith('image/')) continue;
            if (!fmt && !looksLikeImgUrl) continue;

            const holder = m.rightsHolder || m.creator || occ.recordedBy || occ.institutionCode || 'GBIF Occurrence';
            const lic = formatShortLicenseLabel(m.license || occ.license);
            const attribution = lic ? `${holder} · ${lic} (GBIF)` : `${holder} (GBIF)`;
            pushCandidate({
              photoUrl: m.identifier,
              photoAttribution: attribution,
              photoSource: 'GBIF Media',
            });
            added++;
          }
        }
      }
    } else if (occRes.status === 'rejected') {
      hadTransientError = true;
    }

    // 5. Wikimedia Commons (yalnızca Wikipedia görseli yoksa ve birebir bilimsel ad eşleşmesi varsa)
    if (!hasWikiThumb && commonsRes.status === 'fulfilled' && commonsRes.value) {
      if (!commonsRes.value.ok) {
        hadTransientError = true;
      } else {
        const cPages = commonsRes.value.data?.query?.pages ? Object.values<any>(commonsRes.value.data.query.pages) : [];
        let added = 0;
        for (const p of cPages) {
          if (added >= 2) break;
          const ii = p?.imageinfo?.[0];
          const thumbUrl = ii?.thumburl || ii?.url;
          if (!thumbUrl || !isUsableImageThumbnailUrl(thumbUrl)) continue;
          const meta = ii?.extmetadata;
          const metaText = `${meta?.ObjectName?.value || ''} ${meta?.ImageDescription?.value || ''}`;
          if (!isCleanBioCommonsCandidate(String(p.title || ''), thumbUrl, ii?.mime, metaText, sciLower)) {
            continue;
          }
          const rawArtist = String(meta?.Artist?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          const licenseShort = String(meta?.LicenseShortName?.value || '').trim();
          const shortArtist = rawArtist.length > 48 ? `${rawArtist.slice(0, 45)}...` : rawArtist;
          const attribution = shortArtist && licenseShort
            ? `${shortArtist} · ${licenseShort} (Wikimedia Commons)`
            : licenseShort
              ? `${licenseShort} · Wikimedia Commons (${cleanSci})`
              : `Wikimedia Commons (${cleanSci})`;
          pushCandidate({
            photoUrl: thumbUrl,
            photoAttribution: attribution,
            photoSource: 'Wikimedia Commons',
          });
          added++;
        }
      }
    } else if (!hasWikiThumb && commonsRes.status === 'rejected') {
      hadTransientError = true;
    }

    if (candidates.length === 0) {
      if (useCache && !hadTransientError) {
        setCached(cacheKey, { kind: 'NOT_FOUND' }, 3 * 60 * 1000);
      }
      return null;
    }

    // Aday görselleri tek toplu doğrulamadan geçir
    const toVerify = candidates.slice(0, 6);
    const verifiedMap = await verifyImageAssetUrlsBatch(
      toVerify.map((c) => c.photoUrl),
      12000
    );

    let winner: FallbackCandidatePhoto | null = null;
    for (const cand of toVerify) {
      const check = verifiedMap.get(cand.photoUrl);
      if (check?.verified) {
        winner = cand;
        break;
      }
      if (isTransientMediaVerifyFailure(check)) {
        hadTransientError = true;
      }
    }

    if (!winner) {
      if (useCache && !hadTransientError) {
        setCached(cacheKey, { kind: 'NOT_FOUND' }, 3 * 60 * 1000);
      }
      return null;
    }

    let finalAttribution = winner.photoAttribution;
    if (winner.needsCommonsMeta) {
      const commonsFile = extractCommonsFilenameFromUrl(winner.photoUrl);
      if (commonsFile) {
        try {
          const cmRes = await fetchSafeJson<any>(
            `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${commonsFile}`)}&prop=imageinfo&iiprop=extmetadata&format=json&origin=*`,
            'Wikimedia Commons Metadata API',
            0,
            2500
          );
          const pages = cmRes.ok && cmRes.data?.query?.pages ? Object.values(cmRes.data.query.pages) : [];
          const meta = (pages[0] as any)?.imageinfo?.[0]?.extmetadata;
          const rawArtist = String(meta?.Artist?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          const licenseShort = String(meta?.LicenseShortName?.value || '').trim();
          const shortArtist = rawArtist.length > 48 ? `${rawArtist.slice(0, 45)}...` : rawArtist;
          if (shortArtist && licenseShort) {
            finalAttribution = `${shortArtist} · ${licenseShort} (Wikimedia Commons)`;
          } else if (licenseShort) {
            finalAttribution = `${licenseShort} · Wikimedia Commons (${winner.wikiPageTitle || cleanSci})`;
          }
        } catch {
          // Commons meta opsiyoneldir
        }
      }
    }

    const out: FallbackPhotoResult = {
      photoUrl: winner.photoUrl,
      photoAttribution: finalAttribution,
      photoSource: winner.photoSource,
      inatUrl: winner.inatUrl,
    };

    if (useCache) {
      setCached(cacheKey, { kind: 'FOUND', data: out }, 30 * 60 * 1000);
    }
    return out;
  });
}

/**
 * iNaturalist API'den fotoğraf, Türkçe/İngilizce isim ve özet çekme
 * (results[0] körü körüne alınmaz; bilimsel ad ve species rank eşleşmesi esas alınır;
 * iNaturalist'te fotoğraf eksikse Wikipedia/Wikimedia & GBIF Species/Occurrence Media ile doğrulanmış yedek görsel çözümlenir;
 * gerçek bulunamama durumu ile HTTP/XML/ağ hataları net biçimde ayrıştırılır)
 */
export async function fetchInatTaxon(
  scientificName: string,
  options: FetchInatTaxonOptions = {}
): Promise<InatTaxonFetchOutcome> {
  const cleanSci = normalizeSearchQuery(scientificName).toLowerCase();
  if (!cleanSci) return { status: 'NOT_FOUND' };
  const isBinomialQuery = cleanSci.split(' ').filter(Boolean).length >= 2;

  const includeSummary = options.includeSummary ?? true;
  const skipFallbackPhoto = options.skipFallbackPhoto ?? false;
  const usageKey = options.usageKey;
  const cacheKey = `inat-taxon:v4:${cleanSci}`;
  const notFoundKey = `inat-taxon-nf:v4:${cleanSci}:${skipFallbackPhoto ? 0 : (usageKey || 0)}`;
  const cachedOutcome = getCached<InatTaxonFetchOutcome>(cacheKey);
  if (cachedOutcome) {
    if (
      cachedOutcome.status === 'FOUND' &&
      (!includeSummary || cachedOutcome.data.summary !== undefined) &&
      (Boolean(cachedOutcome.data.photoUrl) || skipFallbackPhoto || !usageKey || cachedOutcome.data.fallbackCheckedWithKey === usageKey)
    ) {
      return cachedOutcome;
    }
  }
  const cachedNotFound = getCached<InatTaxonFetchOutcome>(notFoundKey);
  if (cachedNotFound && cachedNotFound.status === 'NOT_FOUND') {
    return cachedNotFound;
  }

  return runDedupedInFlight(`in-flight:inat:${cleanSci}:${includeSummary ? 'full' : 'lite'}:${skipFallbackPhoto ? 'nofb' : (usageKey || 0)}`, async () => {
    const findExactMatch = (results: any[]) => {
      const exactSpecies = results.find(
        (t: any) =>
          typeof t?.name === 'string' &&
          t.name.toLowerCase() === cleanSci &&
          (t.rank === 'species' || t.rank === 'subspecies' || t.rank === 'variety')
      );
      if (exactSpecies) return exactSpecies;

      const exactAnyName = results.find(
        (t: any) => typeof t?.name === 'string' && t.name.toLowerCase() === cleanSci
      );
      if (exactAnyName) return exactAnyName;

      if (isBinomialQuery) {
        return results.find(
          (t: any) =>
            (t?.rank === 'species' || t?.rank === 'subspecies' || t?.rank === 'variety') &&
            typeof t?.matched_term === 'string' &&
            t.matched_term.toLowerCase() === cleanSci
        );
      }
      return undefined;
    };

    try {
      let exactAny: any = undefined;

      if (includeSummary) {
        const parsed = await fetchSafeJson<{ results?: any[] }>(
          `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&locale=tr&per_page=10`,
          'iNaturalist Taxa API',
          1,
          6000
        );
        if (!parsed.ok || !parsed.data || !Array.isArray(parsed.data.results)) {
          const errMsg = parsed.errorMessage || 'iNaturalist API beklenen JSON results dizisini döndürmedi.';
          console.warn('iNaturalist Taxa API error:', errMsg);
          return {
            status: 'ERROR',
            statusCode: parsed.status || undefined,
            errorMessage: errMsg,
          };
        }
        exactAny = findExactMatch(parsed.data.results);

        // Eğer /taxa?q ilk 10'da birebir tür yoksa autocomplete ile species seviyesinde ara (örn: Lynx lynx)
        if (!exactAny) {
          const autoParsed = await fetchSafeJson<{ results?: any[] }>(
            `https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(scientificName)}&rank=species&locale=tr&per_page=10`,
            'iNaturalist Autocomplete API',
            1,
            5000
          );
          if (!autoParsed.ok || !autoParsed.data || !Array.isArray(autoParsed.data.results)) {
            const errMsg = autoParsed.errorMessage || 'iNaturalist Autocomplete API geçersiz yanıt döndürdü.';
            console.warn('iNaturalist Autocomplete API error:', errMsg);
            return {
              status: 'ERROR',
              statusCode: autoParsed.status || undefined,
              errorMessage: errMsg,
            };
          }
          if (autoParsed.data.results.length > 0) {
            exactAny = findExactMatch(autoParsed.data.results);
          }
        }
      } else {
        // Keşif kartları için hızlı ve tek istekli yol: autocomplete doğrudan species + fotoğraf + IUCN + ad verir
        const autoParsed = await fetchSafeJson<{ results?: any[] }>(
          `https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(scientificName)}&rank=species&locale=tr&per_page=5`,
          'iNaturalist Autocomplete API',
          1,
          5500
        );
        if (!autoParsed.ok || !autoParsed.data || !Array.isArray(autoParsed.data.results)) {
          const errMsg = autoParsed.errorMessage || 'iNaturalist Autocomplete API geçersiz yanıt döndürdü.';
          console.warn('iNaturalist Autocomplete API error:', errMsg);
          return {
            status: 'ERROR',
            statusCode: autoParsed.status || undefined,
            errorMessage: errMsg,
          };
        }
        exactAny = findExactMatch(autoParsed.data.results);
      }

      if (!exactAny) {
        if (skipFallbackPhoto) {
          // Lite modda Phase 2 eş anlamlı / yedek kaynak kontrolü yapılacağı için kısa tutulur
          const notFoundFast: InatTaxonFetchOutcome = { status: 'NOT_FOUND' };
          setCached(notFoundKey, notFoundFast, 3 * 60 * 1000);
          return notFoundFast;
        }
        const fallbackPhoto = await fetchVerifiedFallbackPhoto(scientificName, usageKey, {
          includeInatSynonymCheck: true,
        });
        if (fallbackPhoto) {
          const fallbackFound: InatTaxonFetchOutcome = {
            status: 'FOUND',
            data: {
              photoUrl: fallbackPhoto.photoUrl,
              photoAttribution: fallbackPhoto.photoAttribution,
              photoSource: fallbackPhoto.photoSource,
              summary: includeSummary ? '' : undefined,
              inatUrl: fallbackPhoto.inatUrl,
              fallbackCheckedWithKey: usageKey,
            },
          };
          setCached(cacheKey, fallbackFound, 30 * 60 * 1000);
          return fallbackFound;
        }
        const notFound: InatTaxonFetchOutcome = { status: 'NOT_FOUND' };
        setCached(notFoundKey, notFound, 3 * 60 * 1000);
        return notFound;
      }

      const taxon = exactAny;
      let englishCommonName: string | undefined = taxon.english_common_name || undefined;

      // Yalnızca tam analiz modunda İngilizce ad hala eksikse ek detay isteği at
      if (includeSummary && !englishCommonName && taxon.id) {
        try {
          const enParsed = await fetchSafeJson<{ results?: any[] }>(
            `https://api.inaturalist.org/v1/taxa/${taxon.id}?locale=en`,
            'iNaturalist Taxon Detail API',
            0,
            4000
          );
          const enTaxon = enParsed.ok ? enParsed.data?.results?.[0] : undefined;
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

      let photoUrl: string | undefined = taxon.default_photo?.medium_url || taxon.default_photo?.url;
      let photoAttribution: string | undefined = taxon.default_photo?.attribution;
      let photoSource: string | undefined = photoUrl ? 'iNaturalist' : undefined;

      if (photoUrl && (!isUsableImageThumbnailUrl(photoUrl) || (!skipFallbackPhoto && !(await verifyImageAssetUrl(photoUrl, 5000)).verified))) {
        photoUrl = undefined;
        photoAttribution = undefined;
        photoSource = undefined;
      }

      if (!photoUrl && !skipFallbackPhoto) {
        const fallbackPhoto = await fetchVerifiedFallbackPhoto(scientificName, usageKey, {
          includeInatSynonymCheck: false,
        });
        if (fallbackPhoto) {
          photoUrl = fallbackPhoto.photoUrl;
          photoAttribution = fallbackPhoto.photoAttribution;
          photoSource = fallbackPhoto.photoSource;
        }
      }

      const preservedTurkishName =
        taxon.preferred_common_name ||
        (cachedOutcome?.status === 'FOUND' ? cachedOutcome.data.turkishName : undefined);

      const found: InatTaxonFetchOutcome = {
        status: 'FOUND',
        data: {
          turkishName: preservedTurkishName,
          englishName: englishCommonName,
          photoUrl,
          photoAttribution,
          photoSource,
          iucnStatus: iucnCode,
          iucnCategoryName: iucnLabel,
          summary: taxon.wikipedia_summary,
          inatUrl: `https://www.inaturalist.org/taxa/${taxon.id}`,
          fallbackCheckedWithKey: skipFallbackPhoto ? undefined : usageKey,
        },
      };

      // Eğer mevcut önbellekte summary varsa lite çağrısı onu ezmesin; fotoğrafı boşsa yalnızca fallback kontrol edilmişse önbelleğe yaz
      if ((includeSummary || !cachedOutcome || cachedOutcome.status !== 'FOUND') && (photoUrl || !skipFallbackPhoto)) {
        setCached(cacheKey, found, 30 * 60 * 1000);
      }
      return found;
    } catch (e: any) {
      const errMsg = e?.message || 'iNaturalist API erişilemez durumda.';
      console.warn('iNaturalist API unavailable:', errMsg);
      return {
        status: 'ERROR',
        errorMessage: errMsg,
      };
    }
  });
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

  const preferredCommonClean = options.preferredTurkishName?.trim();
  const variantKeyParts = [
    options.preMatchedSpecies?.turkishName ? toTrLower(options.preMatchedSpecies.turkishName) : '',
    preferredCommonClean ? toTrLower(preferredCommonClean) : '',
  ].filter(Boolean);
  const variantKey = variantKeyParts.length > 0 ? `:${variantKeyParts.join('::')}` : '';
  const cacheKey = `analysis:v3:${toTrLower(scientificName)}:${countryCode}:${startYear || ''}:${endYear || ''}:${limit}${variantKey}`;
  const cachedAnalysis = getCached<SpeciesAnalysis>(cacheKey);
  if (cachedAnalysis) return cachedAnalysis;

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    const cachedInside = getCached<SpeciesAnalysis>(cacheKey);
    if (cachedInside) return cachedInside;

  // 1. Türün taksonomik kimlik ve GBIF Backbone usageKey bilgilerini çöz
  const baseSpecies =
    options.preMatchedSpecies?.isMatched && options.preMatchedSpecies?.usageKey
      ? { ...options.preMatchedSpecies }
      : { ...(await matchSpecies(scientificName)) };

  // Keşif kartından gelen doğrulanmış Türkçe ortak adı koru (bilimsel ada veya boşluğa düşmesini engelle)
  const species: SpeciesInfo = (() => {
    if (!preferredCommonClean) return baseSpecies;
    const currentTrLower = (baseSpecies.turkishName || '').trim().toLowerCase();
    const canonicalLower = (baseSpecies.canonicalName || '').trim().toLowerCase();
    const sciLower = (baseSpecies.scientificName || '').trim().toLowerCase();
    const prefLower = preferredCommonClean.toLowerCase();
    if (
      prefLower !== canonicalLower &&
      prefLower !== sciLower &&
      (!currentTrLower || currentTrLower === canonicalLower || currentTrLower === sciLower)
    ) {
      return { ...baseSpecies, turkishName: preferredCommonClean };
    }
    return baseSpecies;
  })();

  // Taksonomi doğrulama geçici ağ/API hatasıyla sonuçlandıysa bunu "0 gözlem" gibi önbelleğe alma
  if (species.matchType === 'ERROR') {
    throw new Error(
      species.summary || 'GBIF taksonomi sunucusuna bağlanırken hata oluştu.'
    );
  }

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
    const parsedMain = await readSafeJsonResponse<Record<string, any>>(res, 'GBIF Occurrence API');
    if (!parsedMain.ok || !parsedMain.data) {
      throw new Error(parsedMain.errorMessage || 'GBIF gözlem servisinden geçerli yanıt alınamadı.');
    }
    const data = parsedMain.data;

    if (
      typeof data.count !== 'number' ||
      !Number.isFinite(data.count) ||
      data.count < 0 ||
      !Array.isArray(data.results)
    ) {
      throw new Error('GBIF gözlem yanıtı geçerli count veya results alanı içermiyor.');
    }

    totalRecords = data.count;

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
              .then(r => readSafeJsonResponse<Record<string, any>>(r, `GBIF Occurrence Pagination (offset=${offset})`))
              .then(pr => {
                if (!pr.ok || !pr.data || !Array.isArray(pr.data.results)) {
                  console.warn(`GBIF pagination offset ${offset} invalid response:`, pr.errorMessage);
                  return { results: [] };
                }
                return pr.data;
              })
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
        const extraYearHttp = await fetchWithRetry(extraYearUrl);
        const extraYearParsed = await readSafeJsonResponse<Record<string, any>>(extraYearHttp, 'GBIF YEAR Facet API');
        if (!extraYearParsed.ok || !extraYearParsed.data) {
          console.warn('Extra YEAR facet pagination error:', extraYearParsed.errorMessage);
          isYearFacetTruncated = true;
        } else {
          const extraYearCounts = extraYearParsed.data?.facets?.find((f: { field: string }) => f.field === 'YEAR')?.counts || [];
          rawYearCounts = [...rawYearCounts, ...extraYearCounts];
          if (extraYearCounts.length >= FACET_PAGE_LIMIT) {
            isYearFacetTruncated = true;
          }
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
          const extraStateHttp = await fetchWithRetry(extraStateUrl);
          const extraStateParsed = await readSafeJsonResponse<Record<string, any>>(extraStateHttp, 'GBIF STATE_PROVINCE Facet API');
          if (!extraStateParsed.ok || !extraStateParsed.data) {
            console.warn('Extra STATE_PROVINCE facet pagination error:', extraStateParsed.errorMessage);
            isRegionFacetTruncated = true;
            break;
          }
          const extraCounts = extraStateParsed.data?.facets?.find((f: { field: string }) => f.field === 'STATE_PROVINCE')?.counts || [];
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
  });
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
  'KINGDOM',
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
        label: 'Tüm Ayıgiller (Ursidae)',
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
      {
        id: 'ayi-ursus',
        label: 'Bozayı, Kutup & Kara Ayılar (Ursus)',
        description: 'Bozayı (Ursus arctos), kutup ayısı (U. maritimus), Amerikan kara ayısı (U. americanus) ve Asya kara ayısı (U. thibetanus).',
        members: [
          { scientificName: 'Ursus', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
        ],
        genusBiologicalLabels: {
          ursus: 'Gerçek Ursus Ayısı',
        },
      },
      {
        id: 'ayi-panda',
        label: 'Dev Panda (Ailuropoda)',
        description: 'Ayıgiller (Ursidae) familyasının bambu ile beslenen özelleşmiş cinsi: Dev Panda (Ailuropoda melanoleuca).',
        members: [
          { scientificName: 'Ailuropoda', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
        ],
        genusBiologicalLabels: {
          ailuropoda: 'Dev Panda (Ailuropoda — Ursidae)',
        },
      },
      {
        id: 'ayi-tropikal-and',
        label: 'And, Güneş & Tembel Ayıları (Tremarctos, Helarctos, Melursus)',
        description: 'Gözlüklü And ayısı (Tremarctos ornatus), Malaya güneş ayısı (Helarctos malayanus) ve Tembel ayı (Melursus ursinus).',
        members: [
          { scientificName: 'Tremarctos', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
          { scientificName: 'Helarctos', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
          { scientificName: 'Melursus', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
        ],
        genusBiologicalLabels: {
          tremarctos: 'And Ayısı (Tremarctos)',
          helarctos: 'Güneş Ayısı (Helarctos)',
          melursus: 'Tembel Ayı (Melursus)',
        },
      },
    ],
  },
  {
    id: 'panda',
    displayName: 'Panda Türleri (Dev Panda & Kızıl Panda)',
    aliases: ['panda', 'pandalar', 'panda türleri', 'pandas'],
    subgroups: [
      {
        id: 'panda-tumu',
        label: 'Tüm Pandalar (Dev Panda & Kızıl Panda)',
        description: 'Gerçek memeli panda türleri: Ayıgiller (Ursidae) familyasından Dev Panda (Ailuropoda melanoleuca) ve Ailuridae familyasından Kızıl Panda (Ailurus fulgens).',
        members: [
          { scientificName: 'Ailuropoda', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
          { scientificName: 'Ailurus', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
        ],
        allowedCanonicalNames: ['Ailuropoda melanoleuca', 'Ailurus fulgens'],
        excludedClassNames: ['Gastropoda'],
        genusBiologicalLabels: {
          ailuropoda: 'Dev Panda (Ailuropoda melanoleuca — Ursidae)',
          ailurus: 'Kızıl Panda (Ailurus fulgens — Ailuridae)',
        },
        membershipPolicyNote: 'Yalnızca yaşayan gerçek memeli panda türleri (Dev Panda ve Kızıl Panda) sunulur; yaygın ad benzerliği taşıyan ilgisiz taksonlar (ör. Hedleyella kara salyangozları) kapsam dışıdır.',
      },
      {
        id: 'panda-dev',
        label: 'Dev Panda (Ailuropoda)',
        description: 'Ayıgiller (Ursidae) familyasının Çin\'e özgü bambu ile beslenen türü: Dev Panda (Ailuropoda melanoleuca).',
        members: [
          { scientificName: 'Ailuropoda', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
        ],
        allowedCanonicalNames: ['Ailuropoda melanoleuca'],
        genusBiologicalLabels: {
          ailuropoda: 'Dev Panda (Ailuropoda melanoleuca — Ursidae)',
        },
      },
      {
        id: 'panda-kizil',
        label: 'Kızıl Panda (Ailurus)',
        description: 'Doğu Himalayalar ve Güneybatı Çin\'e özgü Ailuridae familyasının Kızıl Panda (Ailurus fulgens) türü.',
        members: [
          { scientificName: 'Ailurus', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
        ],
        allowedCanonicalNames: ['Ailurus fulgens'],
        genusBiologicalLabels: {
          ailurus: 'Kızıl Panda (Ailurus fulgens — Ailuridae)',
        },
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
  {
    id: 'balik',
    displayName: 'Balık Türleri (Kemikli, Kıkırdaklı & Çenesiz Balıklar)',
    aliases: ['balık', 'balıklar', 'balık türleri', 'balık türü', 'fish', 'fishes', 'actinopterygii', 'osteichthyes', 'teleostei', 'chondrichthyes'],
    subgroups: [
      {
        id: 'balik-tumu',
        label: 'Tüm Balık Grupları (Kemikli & Kıkırdaklı Balıklar)',
        description: 'GBIF Backbone üzerindeki kemikli balık takımları (Perciformes, Cypriniformes, Salmoniformes, Clupeiformes vb.) ile kıkırdaklı ve çenesiz balıkları bir arada listeler.',
        members: [
          { scientificName: 'Perciformes', expectedRank: 'ORDER' },
          { scientificName: 'Cypriniformes', expectedRank: 'ORDER' },
          { scientificName: 'Salmoniformes', expectedRank: 'ORDER' },
          { scientificName: 'Siluriformes', expectedRank: 'ORDER' },
          { scientificName: 'Clupeiformes', expectedRank: 'ORDER' },
          { scientificName: 'Gadiformes', expectedRank: 'ORDER' },
          { scientificName: 'Pleuronectiformes', expectedRank: 'ORDER' },
          { scientificName: 'Scorpaeniformes', expectedRank: 'ORDER' },
          { scientificName: 'Syngnathiformes', expectedRank: 'ORDER' },
          { scientificName: 'Tetraodontiformes', expectedRank: 'ORDER' },
          { scientificName: 'Anguilliformes', expectedRank: 'ORDER' },
          { scientificName: 'Cyprinodontiformes', expectedRank: 'ORDER' },
          { scientificName: 'Mugiliformes', expectedRank: 'ORDER' },
          { scientificName: 'Beloniformes', expectedRank: 'ORDER' },
          { scientificName: 'Atheriniformes', expectedRank: 'ORDER' },
          { scientificName: 'Esociformes', expectedRank: 'ORDER' },
          { scientificName: 'Acipenseriformes', expectedRank: 'ORDER' },
          { scientificName: 'Elasmobranchii', expectedRank: 'CLASS' },
          { scientificName: 'Holocephali', expectedRank: 'CLASS' },
          { scientificName: 'Petromyzonti', expectedRank: 'CLASS' },
          { scientificName: 'Myxini', expectedRank: 'CLASS' },
        ],
        membershipPolicyNote: 'GBIF Backbone kemikli balıkları doğrudan Chordata altında takım (Order) düzeyinde sınıflandırır; balık kartalı (Aves) veya balinalar (Mammalia) kesinlikle dahil edilmez.',
      },
      {
        id: 'balik-tatlisu',
        label: 'Tatlı Su & Akarsu Balıkları (Sazan, Alabalık, Yayın, Turna)',
        description: 'Cypriniformes, Salmoniformes, Siluriformes, Esociformes, Cyprinodontiformes ve Characiformes takımları.',
        members: [
          { scientificName: 'Cypriniformes', expectedRank: 'ORDER' },
          { scientificName: 'Salmoniformes', expectedRank: 'ORDER' },
          { scientificName: 'Siluriformes', expectedRank: 'ORDER' },
          { scientificName: 'Esociformes', expectedRank: 'ORDER' },
          { scientificName: 'Cyprinodontiformes', expectedRank: 'ORDER' },
          { scientificName: 'Characiformes', expectedRank: 'ORDER' },
          { scientificName: 'Osteoglossiformes', expectedRank: 'ORDER' },
        ],
      },
      {
        id: 'balik-deniz-kemikli',
        label: 'Deniz Kemikli Balıkları (Levrek, Hamsi, Mezgit, Dil, Denizatı)',
        description: 'Perciformes, Clupeiformes, Gadiformes, Pleuronectiformes, Scorpaeniformes, Mugiliformes, Syngnathiformes ve Tetraodontiformes.',
        members: [
          { scientificName: 'Perciformes', expectedRank: 'ORDER' },
          { scientificName: 'Clupeiformes', expectedRank: 'ORDER' },
          { scientificName: 'Gadiformes', expectedRank: 'ORDER' },
          { scientificName: 'Pleuronectiformes', expectedRank: 'ORDER' },
          { scientificName: 'Scorpaeniformes', expectedRank: 'ORDER' },
          { scientificName: 'Mugiliformes', expectedRank: 'ORDER' },
          { scientificName: 'Syngnathiformes', expectedRank: 'ORDER' },
          { scientificName: 'Tetraodontiformes', expectedRank: 'ORDER' },
          { scientificName: 'Anguilliformes', expectedRank: 'ORDER' },
          { scientificName: 'Beloniformes', expectedRank: 'ORDER' },
          { scientificName: 'Beryciformes', expectedRank: 'ORDER' },
          { scientificName: 'Lophiiformes', expectedRank: 'ORDER' },
        ],
      },
      {
        id: 'balik-kikirdak',
        label: 'Kıkırdaklı Balıklar (Köpek Balıkları, Vatozlar & Deniz Kedileri)',
        description: 'Elasmobranchii ve Holocephali sınıfları.',
        members: [
          { scientificName: 'Elasmobranchii', expectedRank: 'CLASS' },
          { scientificName: 'Holocephali', expectedRank: 'CLASS' },
        ],
      },
      {
        id: 'balik-cenesiz-kadim',
        label: 'Mersin Balıkları, Çenesizler & Akciğerli Balıklar',
        description: 'Acipenseriformes, Petromyzonti (dokuzgözler), Myxini (mukus balıkları), Dipneusti ve Coelacanthi.',
        members: [
          { scientificName: 'Acipenseriformes', expectedRank: 'ORDER' },
          { scientificName: 'Petromyzonti', expectedRank: 'CLASS' },
          { scientificName: 'Myxini', expectedRank: 'CLASS' },
          { scientificName: 'Dipneusti', expectedRank: 'CLASS' },
          { scientificName: 'Coelacanthi', expectedRank: 'CLASS' },
        ],
      },
    ],
  },
  {
    id: 'surungen',
    displayName: 'Sürüngen Türleri',
    aliases: ['sürüngen', 'sürüngenler', 'sürüngen türleri', 'reptile', 'reptiles', 'reptilia'],
    subgroups: [
      {
        id: 'surungen-tumu',
        label: 'Tüm Sürüngenler (Pullular, Kaplumbağalar, Timsahlar)',
        description: 'Squamata (kertenkele & yılanlar), Testudines (kaplumbağalar), Crocodylia (timsahlar) ve Sphenodontia sınıfları.',
        members: [
          { scientificName: 'Squamata', expectedRank: 'CLASS' },
          { scientificName: 'Testudines', expectedRank: 'CLASS' },
          { scientificName: 'Crocodylia', expectedRank: 'CLASS' },
          { scientificName: 'Sphenodontia', expectedRank: 'CLASS' },
        ],
      },
      {
        id: 'surungen-squamata',
        label: 'Kertenkeleler & Yılanlar (Squamata)',
        description: 'Pullular sınıfı altındaki tüm kertenkele ve yılan türleri.',
        members: [{ scientificName: 'Squamata', expectedRank: 'CLASS' }],
      },
      {
        id: 'surungen-testudines',
        label: 'Kaplumbağalar (Testudines)',
        description: 'Kara, deniz ve tatlı su kaplumbağaları.',
        members: [{ scientificName: 'Testudines', expectedRank: 'CLASS' }],
      },
      {
        id: 'surungen-crocodylia',
        label: 'Timsahlar & Alligatörler (Crocodylia)',
        description: 'Gerçek timsahlar, alligatörler, kaymanlar ve gavyaller.',
        members: [{ scientificName: 'Crocodylia', expectedRank: 'CLASS' }],
      },
      {
        id: 'surungen-sphenodontia',
        label: 'Tuatara (Sphenodontia)',
        description: 'Yeni Zelanda kökenli yaşayan kadim sürüngen takımı.',
        members: [{ scientificName: 'Sphenodontia', expectedRank: 'CLASS' }],
      },
    ],
  },
  {
    id: 'yilan',
    displayName: 'Yılan Türleri',
    aliases: ['yılan', 'yılanlar', 'yılan türleri', 'snake', 'snakes', 'serpentes'],
    subgroups: [
      {
        id: 'yilan-tumu',
        label: 'Tüm Yılan Familyaları',
        description: 'Su ve kırbaç yılanları (Colubridae, Natricidae), engerekler (Viperidae), kobralar (Elapidae), boa & pitonlar ve kör yılanlar.',
        members: [
          { scientificName: 'Colubridae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Viperidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Elapidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Boidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Pythonidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Natricidae', expectedRank: 'FAMILY' },
          { scientificName: 'Lamprophiidae', expectedRank: 'FAMILY' },
          { scientificName: 'Psammophiidae', expectedRank: 'FAMILY' },
          { scientificName: 'Dipsadidae', expectedRank: 'FAMILY' },
          { scientificName: 'Homalopsidae', expectedRank: 'FAMILY' },
          { scientificName: 'Typhlopidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Leptotyphlopidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Acrochordidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Atractaspididae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
        ],
      },
      {
        id: 'yilan-colubridae',
        label: 'Su, Kırbaç & Kara Yılanları (Colubridae, Natricidae, Psammophiidae)',
        description: 'Zehirsiz veya yarı zehirli kırbaç yılanları, su yılanları ve çöl yılanları.',
        members: [
          { scientificName: 'Colubridae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Natricidae', expectedRank: 'FAMILY' },
          { scientificName: 'Psammophiidae', expectedRank: 'FAMILY' },
          { scientificName: 'Lamprophiidae', expectedRank: 'FAMILY' },
          { scientificName: 'Dipsadidae', expectedRank: 'FAMILY' },
        ],
      },
      {
        id: 'yilan-viperidae',
        label: 'Engerekler & Çıngıraklı Yılanlar (Viperidae)',
        description: 'Koca engerek, Kafkas engereği, boynuzlu engerek ve çıngıraklı yılanlar.',
        members: [{ scientificName: 'Viperidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' }],
      },
      {
        id: 'yilan-elapidae',
        label: 'Kobralar, Mambalar & Mercan Yılanları (Elapidae)',
        description: 'Nörotoksik zehirli Elapidae familyası ve deniz yılanları.',
        members: [{ scientificName: 'Elapidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' }],
      },
      {
        id: 'yilan-boidae',
        label: 'Boa & Piton Yılanları (Boidae, Pythonidae)',
        description: 'Mahmuzlu yılanlar (Eryx / Boidae) ve pitonlar (Pythonidae).',
        members: [
          { scientificName: 'Boidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Pythonidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
        ],
      },
      {
        id: 'yilan-kor',
        label: 'Kör Yılanlar (Typhlopidae, Leptotyphlopidae)',
        description: 'Toprak altında yaşayan küçük kör yılan familyaları.',
        members: [
          { scientificName: 'Typhlopidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Leptotyphlopidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
        ],
      },
    ],
  },
  {
    id: 'kertenkele',
    displayName: 'Kertenkele Türleri',
    aliases: ['kertenkele', 'kertenkeleler', 'kertenkele türleri', 'lizard', 'lizards'],
    subgroups: [
      {
        id: 'kertenkele-tumu',
        label: 'Tüm Kertenkele Familyaları',
        description: 'Asıl kertenkeleler (Lacertidae), agamalar, gekolar, bukalemunlar, skinkler, varanlar ve iguanalar.',
        members: [
          { scientificName: 'Lacertidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Agamidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Gekkonidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Phyllodactylidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Sphaerodactylidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Scincidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Chamaeleonidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Anguidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Varanidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Iguanidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Dactyloidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
        ],
      },
      {
        id: 'kertenkele-lacertidae',
        label: 'Asıl Kertenkeleler (Lacertidae)',
        description: 'Yeşil kertenkele, duvar kertenkelesi ve Anadolu dağ kertenkeleleri.',
        members: [{ scientificName: 'Lacertidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' }],
      },
      {
        id: 'kertenkele-geko',
        label: 'Gekolar (Gekkonidae, Phyllodactylidae, Sphaerodactylidae)',
        description: 'Süleymancık, yarımparmaklı geko ve gececi geko türleri.',
        members: [
          { scientificName: 'Gekkonidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Phyllodactylidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Sphaerodactylidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
        ],
      },
      {
        id: 'kertenkele-agama',
        label: 'Agamalar & İguanalar (Agamidae, Iguanidae, Dactyloidae)',
        description: 'Dikenli keler (Stellagama), kırkbenek ve iguanalar.',
        members: [
          { scientificName: 'Agamidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Iguanidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Dactyloidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
        ],
      },
      {
        id: 'kertenkele-bukalemun-skink',
        label: 'Bukalemun, Skink & Körkertenkeleler',
        description: 'Chamaeleonidae, Scincidae ve Anguidae familyaları.',
        members: [
          { scientificName: 'Chamaeleonidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Scincidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
          { scientificName: 'Anguidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' },
        ],
      },
      {
        id: 'kertenkele-varan',
        label: 'Varangiller / Dev Kertenkeleler (Varanidae)',
        description: 'Çöl varanı (Varanus griseus) ve Komodo ejderi dahil Varanidae familyası.',
        members: [{ scientificName: 'Varanidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' }],
      },
    ],
  },
  {
    id: 'baykus',
    displayName: 'Baykuş Türleri',
    aliases: ['baykuş', 'baykuşlar', 'baykuş türleri', 'owl', 'owls', 'strigiformes'],
    subgroups: [
      {
        id: 'baykus-tumu',
        label: 'Tüm Baykuşlar (Strigiformes)',
        description: 'Gerçek baykuşlar (Strigidae) ve peçeli baykuşları (Tytonidae) kapsayan baykuş takımı.',
        members: [{ scientificName: 'Strigiformes', expectedRank: 'ORDER', expectedClass: 'Aves' }],
      },
      {
        id: 'baykus-strigidae',
        label: 'Gerçek Baykuşlar (Strigidae)',
        description: 'Puhu (Bubo bubo), kukumav (Athene noctua), kulaklı orman baykuşu ve ishak kuşu türleri.',
        members: [{ scientificName: 'Strigidae', expectedRank: 'FAMILY', expectedClass: 'Aves' }],
      },
      {
        id: 'baykus-tytonidae',
        label: 'Peçeli Baykuşlar (Tytonidae)',
        description: 'Kalp yüzlü peçeli baykuş (Tyto alba) ve yakın türler.',
        members: [{ scientificName: 'Tytonidae', expectedRank: 'FAMILY', expectedClass: 'Aves' }],
      },
    ],
  },
  {
    id: 'yunus',
    displayName: 'Yunus Türleri',
    aliases: ['yunus', 'yunuslar', 'yunus türleri', 'dolphin', 'dolphins', 'delphinidae'],
    subgroups: [
      {
        id: 'yunus-okyanus',
        label: 'Okyanus & Deniz Yunusları (Delphinidae)',
        description: 'Afalina / Şişeburunlu yunus (Tursiops truncatus), Tırtak (Delphinus delphis), Çizgili yunus ve Orka.',
        members: [{ scientificName: 'Delphinidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' }],
      },
      {
        id: 'yunus-nehir',
        label: 'Nehir Yunusları (Iniidae, Platanistidae, Pontoporiidae)',
        description: 'Amazon, Ganj/İndus ve La Plata tatlı su yunusları.',
        members: [
          { scientificName: 'Iniidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Platanistidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
          { scientificName: 'Pontoporiidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' },
        ],
      },
      {
        id: 'yunus-mutur',
        label: 'Muturlar (Phocoenidae)',
        description: 'Karadeniz ve kuzey denizlerinde yaşayan küçük dişli balinalar (Phocoena phocoena).',
        members: [{ scientificName: 'Phocoenidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' }],
      },
    ],
  },
  {
    id: 'amfibi',
    displayName: 'Amfibi / İki Yaşamlı Türleri',
    aliases: ['amfibi', 'amfibiler', 'iki yaşamlı', 'iki yaşamlılar', 'amphibian', 'amphibians', 'amphibia'],
    subgroups: [
      {
        id: 'amfibi-tumu',
        label: 'Tüm Amfibiler (Amphibia)',
        description: 'Kurbağalar, semenderler ve ayaksız amfibilerin tamamı.',
        members: [{ scientificName: 'Amphibia', expectedRank: 'CLASS' }],
      },
      {
        id: 'amfibi-anura',
        label: 'Kurbağalar & Kara Kurbağaları (Anura)',
        description: 'Kuyruksuz amfibiler (ova kurbağası, ağaç kurbağası, siğilli kurbağa, Toros kurbağası).',
        members: [{ scientificName: 'Anura', expectedRank: 'ORDER', expectedClass: 'Amphibia' }],
      },
      {
        id: 'amfibi-caudata',
        label: 'Semenderler & Kuyruklu Amfibiler (Caudata)',
        description: 'Lekeli semender, Kafkas semenderi, Likya semenderi ve taraklı semenderler.',
        members: [{ scientificName: 'Caudata', expectedRank: 'ORDER', expectedClass: 'Amphibia' }],
      },
      {
        id: 'amfibi-gymnophiona',
        label: 'Ayaksız Amfibiler / Sesilyalar (Gymnophiona)',
        description: 'Tropikal toprak altı ayaksız amfibi takımı.',
        members: [{ scientificName: 'Gymnophiona', expectedRank: 'ORDER', expectedClass: 'Amphibia' }],
      },
    ],
  },
  {
    id: 'fil',
    displayName: 'Fil Türleri (Elephantidae)',
    aliases: ['fil', 'filler', 'fil türleri', 'elephant', 'elephants', 'elephantidae'],
    subgroups: [
      {
        id: 'fil-tumu',
        label: 'Tüm Filler (Elephantidae — Afrika & Asya)',
        description: 'Yaşayan Afrika savan fili (Loxodonta africana), Afrika orman fili (L. cyclotis) ve Asya fili (Elephas maximus) türlerini kapsar. Fosil mamut/Palaeoloxodon kayıtları yalnızca fosil filtresi açıldığında gösterilir.',
        members: [{ scientificName: 'Elephantidae', expectedRank: 'FAMILY', expectedClass: 'Mammalia' }],
        genusBiologicalLabels: {
          loxodonta: 'Afrika Fili (Loxodonta — Elephantidae)',
          elephas: 'Asya Fili (Elephas — Elephantidae)',
        },
        membershipPolicyNote: 'Varsayılan görünümde yalnızca yaşayan Elephantidae türleri listelenir; soyu tükenmiş fosil filler (Palaeoloxodon, Mammuthus) yalnızca fosil filtresi etkinleştirildiğinde gösterilir.',
      },
      {
        id: 'fil-afrika',
        label: 'Afrika Filleri (Loxodonta)',
        description: 'Afrika savan fili (Loxodonta africana) ve Afrika orman fili (Loxodonta cyclotis).',
        members: [{ scientificName: 'Loxodonta', expectedRank: 'GENUS', expectedFamily: 'Elephantidae' }],
        genusBiologicalLabels: {
          loxodonta: 'Afrika Fili (Loxodonta)',
        },
      },
      {
        id: 'fil-asya',
        label: 'Asya Fili (Elephas)',
        description: 'Asya ve Hindistan ekosistemlerine özgü Elephas maximus ve yakın taksonlar.',
        members: [{ scientificName: 'Elephas', expectedRank: 'GENUS', expectedFamily: 'Elephantidae' }],
        genusBiologicalLabels: {
          elephas: 'Asya Fili (Elephas)',
        },
      },
    ],
  },
  {
    id: 'bukalemun',
    displayName: 'Bukalemun Türleri (Chamaeleonidae)',
    aliases: ['bukalemun', 'bukalemunlar', 'bukalemun türleri', 'chameleon', 'chameleons', 'chamaeleonidae'],
    subgroups: [
      {
        id: 'bukalemun-tumu',
        label: 'Tüm Bukalemunlar (Chamaeleonidae)',
        description: 'Bayağı bukalemun (Chamaeleo chamaeleon), peçeli bukalemun, panter bukalemun (Furcifer), Madagaskar yaprak bukalemunları (Brookesia) ve tüm Chamaeleonidae familyası.',
        members: [{ scientificName: 'Chamaeleonidae', expectedRank: 'FAMILY', expectedClass: 'Squamata' }],
      },
      {
        id: 'bukalemun-chamaeleo',
        label: 'Akdeniz & Afrika Bukalemunları (Chamaeleo & Trioceros)',
        description: 'Türkiye ve Akdeniz havzasında da yaşayan Chamaeleo ile boynuzlu Trioceros cinsleri.',
        members: [
          { scientificName: 'Chamaeleo', expectedRank: 'GENUS', expectedFamily: 'Chamaeleonidae' },
          { scientificName: 'Trioceros', expectedRank: 'GENUS', expectedFamily: 'Chamaeleonidae' },
        ],
      },
      {
        id: 'bukalemun-madagaskar',
        label: 'Madagaskar & Cüce Bukalemunlar (Furcifer, Calumma, Brookesia, Bradypodion)',
        description: 'Panter bukalemun (Furcifer), Calumma, yaprak bukalemunu (Brookesia) ve güney Afrika cüce bukalemunları.',
        members: [
          { scientificName: 'Furcifer', expectedRank: 'GENUS', expectedFamily: 'Chamaeleonidae' },
          { scientificName: 'Calumma', expectedRank: 'GENUS', expectedFamily: 'Chamaeleonidae' },
          { scientificName: 'Brookesia', expectedRank: 'GENUS', expectedFamily: 'Chamaeleonidae' },
          { scientificName: 'Bradypodion', expectedRank: 'GENUS', expectedFamily: 'Chamaeleonidae' },
        ],
      },
    ],
  },
  {
    id: 'deniz-yildizi',
    displayName: 'Deniz Yıldızı Türleri (Asteroidea)',
    aliases: ['deniz yıldızı', 'deniz yıldızları', 'deniz yıldızı türleri', 'starfish', 'sea star', 'sea stars', 'asteroidea'],
    subgroups: [
      {
        id: 'deniz-yildizi-tumu',
        label: 'Tüm Deniz Yıldızları (Asteroidea)',
        description: 'Derisidikenliler şubesindeki tüm yaşayan deniz yıldızı takımlarını ve familyalarını kapsar.',
        members: [{ scientificName: 'Asteroidea', expectedRank: 'CLASS' }],
      },
      {
        id: 'deniz-yildizi-valvatida',
        label: 'Yastık & Mercan Deniz Yıldızları (Valvatida)',
        description: 'Akdeniz ve mercan resiflerinde yaygın yastık yıldızı (Asterina), dikenli taç deniz yıldızı vb.',
        members: [{ scientificName: 'Valvatida', expectedRank: 'ORDER', expectedClass: 'Asteroidea' }],
      },
      {
        id: 'deniz-yildizi-forcipulatida',
        label: 'Kıskaçlı Deniz Yıldızları (Forcipulatida)',
        description: 'Bayağı deniz yıldızı (Asterias rubens), Marthasterias glacialis ve kıyı deniz yıldızları.',
        members: [{ scientificName: 'Forcipulatida', expectedRank: 'ORDER', expectedClass: 'Asteroidea' }],
      },
      {
        id: 'deniz-yildizi-paxillosida',
        label: 'Kum & Taraklı Deniz Yıldızları (Paxillosida)',
        description: 'Kumluk deniz tabanında yaşayan Astropecten ve Luidia deniz yıldızları.',
        members: [{ scientificName: 'Paxillosida', expectedRank: 'ORDER', expectedClass: 'Asteroidea' }],
      },
      {
        id: 'deniz-yildizi-diger',
        label: 'Dikenli & Derin Deniz Yıldızları (Spinulosida, Velatida, Brisingida)',
        description: 'Echinasteridae, Solasteridae ve derin deniz kol yıldızları.',
        members: [
          { scientificName: 'Spinulosida', expectedRank: 'ORDER', expectedClass: 'Asteroidea' },
          { scientificName: 'Velatida', expectedRank: 'ORDER', expectedClass: 'Asteroidea' },
          { scientificName: 'Brisingida', expectedRank: 'ORDER', expectedClass: 'Asteroidea' },
        ],
      },
    ],
  },
  {
    id: 'deniz-kestanesi',
    displayName: 'Deniz Kestanesi Türleri (Echinoidea)',
    aliases: ['deniz kestanesi', 'deniz kestaneleri', 'deniz kestanesi türleri', 'sea urchin', 'sea urchins', 'echinoidea'],
    subgroups: [
      {
        id: 'deniz-kestanesi-tumu',
        label: 'Tüm Deniz Kestaneleri (Echinoidea)',
        description: 'Akdeniz mor ve siyah deniz kestaneleri, kalem kestaneleri ve kum dolarları dahil Echinoidea sınıfı.',
        members: [{ scientificName: 'Echinoidea', expectedRank: 'CLASS' }],
      },
      {
        id: 'deniz-kestanesi-camarodonta',
        label: 'Kıyı & Kaya Deniz Kestaneleri (Camarodonta & Arbacioida)',
        description: 'Paracentrotus lividus, Arbacia lixula ve Echinus türleri.',
        members: [
          { scientificName: 'Camarodonta', expectedRank: 'ORDER', expectedClass: 'Echinoidea' },
          { scientificName: 'Arbacioida', expectedRank: 'ORDER', expectedClass: 'Echinoidea' },
        ],
      },
      {
        id: 'deniz-kestanesi-uzun-dikenli',
        label: 'Uzun Dikenli & Kalem Kestaneleri (Diadematoida & Cidaroida)',
        description: 'Centrostephanus longispinus, Diadema ve ilkel kalem dikenli deniz kestaneleri.',
        members: [
          { scientificName: 'Diadematoida', expectedRank: 'ORDER', expectedClass: 'Echinoidea' },
          { scientificName: 'Cidaroida', expectedRank: 'ORDER', expectedClass: 'Echinoidea' },
        ],
      },
      {
        id: 'deniz-kestanesi-duz',
        label: 'Kalp Kestaneleri & Kum Dolarları (Spatangoida & Clypeasteroida)',
        description: 'Kumluk tabanda yaşayan yassı kum dolarları ve düzensiz deniz kestaneleri.',
        members: [
          { scientificName: 'Spatangoida', expectedRank: 'ORDER', expectedClass: 'Echinoidea' },
          { scientificName: 'Clypeasteroida', expectedRank: 'ORDER', expectedClass: 'Echinoidea' },
        ],
      },
    ],
  },
  {
    id: 'suluk',
    displayName: 'Sülük Türleri (Hirudinea / Clitellata)',
    aliases: ['sülük', 'sülükler', 'sülük türleri', 'leech', 'leeches'],
    subgroups: [
      {
        id: 'suluk-tumu',
        label: 'Tüm Sülükler (Arhynchobdellida & Rhynchobdellida)',
        description: 'Tıbbi sülükler (Hirudinidae), yabani sülükler (Haemopidae, Erpobdellidae) ve tatlı su/deniz hortumlu sülükleri (Glossiphoniidae, Piscicolidae). Sülükayaklı kabuklular (Cirripedia) hariçtir.',
        members: [
          { scientificName: 'Arhynchobdellida', expectedRank: 'ORDER', expectedClass: 'Clitellata' },
          { scientificName: 'Rhynchobdellida', expectedRank: 'ORDER', expectedClass: 'Clitellata' },
        ],
        excludedClassNames: ['Hexanauplia', 'Thecostraca'],
      },
      {
        id: 'suluk-arhynchobdellida',
        label: 'Tıbbi & Yabani Sülükler (Arhynchobdellida)',
        description: 'Hirudo medicinalis, Hirudo verbana, Haemopis ve Erpobdella sülük familyaları.',
        members: [{ scientificName: 'Arhynchobdellida', expectedRank: 'ORDER', expectedClass: 'Clitellata' }],
      },
      {
        id: 'suluk-rhynchobdellida',
        label: 'Hortumlu & Balık Sülükleri (Rhynchobdellida)',
        description: 'Glossiphoniidae (yassı tatlı su sülükleri) ve Piscicolidae (balık sülükleri).',
        members: [{ scientificName: 'Rhynchobdellida', expectedRank: 'ORDER', expectedClass: 'Clitellata' }],
      },
    ],
  },
  {
    id: 'zebra',
    displayName: 'Zebra Türleri (Equus)',
    aliases: ['zebra', 'zebralar', 'zebra türleri', 'zebras'],
    subgroups: [
      {
        id: 'zebra-tumu',
        label: 'Tüm Zebra Türleri (Ova, Dağ & Grevy Zebraları)',
        description: 'Yaşayan üç biyolojik zebra türünü birlikte keşfedin: Ova zebrası (Equus quagga), Dağ zebrası (Equus zebra) ve Grevy zebrası (Equus grevyi).',
        members: [
          { scientificName: 'Equus', expectedRank: 'GENUS', expectedClass: 'Mammalia' },
        ],
        allowedCanonicalNames: ['Equus quagga', 'Equus zebra', 'Equus grevyi'],
        genusBiologicalLabels: {
          equus: 'Zebra Türü (Equus — Equidae)',
        },
        membershipPolicyNote: 'Yalnızca yaşayan üç biyolojik zebra türü (Equus quagga, Equus zebra ve Equus grevyi) listelenir; at (Equus caballus) ve eşek (Equus asinus) türleri kapsam dışıdır.',
      },
      {
        id: 'zebra-ova',
        label: 'Ova Zebrası (Equus quagga)',
        description: 'Doğu ve Güney Afrika savanlarında yaşayan Bayağı / Ova Zebrası (Equus quagga).',
        members: [{ scientificName: 'Equus', expectedRank: 'GENUS', expectedClass: 'Mammalia' }],
        allowedCanonicalNames: ['Equus quagga'],
        genusBiologicalLabels: { equus: 'Ova Zebrası (Equus quagga)' },
      },
      {
        id: 'zebra-dag',
        label: 'Dağ Zebrası (Equus zebra)',
        description: 'Güneybatı Afrika dağlık ve kayalık alanlarına özgü Dağ Zebrası (Equus zebra).',
        members: [{ scientificName: 'Equus', expectedRank: 'GENUS', expectedClass: 'Mammalia' }],
        allowedCanonicalNames: ['Equus zebra'],
        genusBiologicalLabels: { equus: 'Dağ Zebrası (Equus zebra)' },
      },
      {
        id: 'zebra-grevy',
        label: 'Grevy Zebrası (Equus grevyi)',
        description: 'Kenya ve Etiyopya yarı kurak savanlarında yaşayan, tehlike altındaki en iri zebra türü (Equus grevyi).',
        members: [{ scientificName: 'Equus', expectedRank: 'GENUS', expectedClass: 'Mammalia' }],
        allowedCanonicalNames: ['Equus grevyi'],
        genusBiologicalLabels: { equus: 'Grevy Zebrası (Equus grevyi)' },
      },
    ],
  },
  {
    id: 'at-sinegi',
    displayName: 'At Sineği Türleri (Tabanidae)',
    aliases: ['at sineği', 'at sinekleri', 'at sineği türleri', 'horsefly', 'horseflies', 'horse fly', 'horse flies', 'tabanidae'],
    subgroups: [
      {
        id: 'at-sinegi-tabanus',
        label: 'Gerçek At Sinekleri (Tabanus Cinsi)',
        description: 'Sığır ve at sineği olarak bilinen Tabanus cinsine ait gerçek at sineği türleri.',
        members: [{ scientificName: 'Tabanus', expectedRank: 'GENUS', expectedClass: 'Insecta' }],
        genusBiologicalLabels: { tabanus: 'Gerçek At Sineği (Tabanus — Tabanidae)' },
      },
      {
        id: 'at-sinegi-tumu',
        label: 'Tüm At Sineğigiller (Tabanidae Familyası)',
        description: 'Tabanus, Chrysops ve Haematopota dahil tüm Tabanidae at/geyik sineği türleri.',
        members: [{ scientificName: 'Tabanidae', expectedRank: 'FAMILY', expectedClass: 'Insecta' }],
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
  status: 'VERIFIED' | 'NOT_FOUND' | 'ERROR';
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
  errorMessage?: string;
}

/**
 * GBIF Backbone üzerinde üst taksonu (GENUS, FAMILY, ORDER, CLASS) homonimlere karşı güvenli doğrular.
 * Sahte taxonKey üretmez; doğrulanamayan taksonu ile API erişim hatasını (ERROR) net biçimde ayırır.
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
  if (cached && cached.status !== 'ERROR') return cached;

  if (!cleanName || cleanName.length < 2) {
    return { verified: false, status: 'NOT_FOUND', scientificName: cleanName, reason: 'Geçersiz takson adı.' };
  }

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    const cachedInside = getCached<VerifiedHigherTaxonResult>(cacheKey);
    if (cachedInside && cachedInside.status !== 'ERROR') return cachedInside;

    try {
      const resolveMatchOrSearch = async (rankFilter?: string): Promise<any | null> => {
        const rankQuery = rankFilter ? `&rank=${encodeURIComponent(rankFilter)}` : '';
        const matchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(cleanName)}&kingdom=Animalia${rankQuery}&strict=true&verbose=true`;
        const matchParsed = await fetchSafeJson<any>(matchUrl, 'GBIF Higher Taxon Match API', 1, 7000);
        if (!matchParsed.ok || !matchParsed.data) {
          throw new Error(matchParsed.errorMessage || 'GBIF üst takson doğrulama servisi geçersiz yanıt döndürdü.');
        }
        const matchRes = matchParsed.data;

        const matchRankUpper = String(matchRes?.rank || '').toUpperCase();
        const isGenusDowngrade =
          Boolean(rankFilter) &&
          !['GENUS', 'SUBGENUS'].includes(String(rankFilter).toUpperCase()) &&
          ['GENUS', 'SUBGENUS'].includes(matchRankUpper);
        const isRejectedHigherrank =
          !matchRes ||
          matchRes.matchType === 'NONE' ||
          !matchRes.usageKey ||
          isGenusDowngrade ||
          (matchRes.matchType === 'HIGHERRANK' &&
            (matchRes.rank === 'KINGDOM' || matchRes.rank === 'PHYLUM' || (rankFilter && matchRes.rank !== rankFilter)));

        if (!isRejectedHigherrank) {
          return matchRes;
        }

        // Homonim veya komşu takson basamağı nedeniyle match HIGHERRANK döndürdüyse GBIF Backbone search ile doğrula
        const searchRankQuery = rankFilter ? `&rank=${encodeURIComponent(rankFilter)}` : '';
        const searchUrl = `https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&q=${encodeURIComponent(cleanName)}${searchRankQuery}&limit=15`;
        const searchParsed = await fetchSafeJson<{ results?: any[] }>(searchUrl, 'GBIF Higher Taxon Search API', 1, 7000);
        if (!searchParsed.ok || !searchParsed.data) {
          throw new Error(searchParsed.errorMessage || 'GBIF üst takson arama servisi geçersiz yanıt döndürdü.');
        }
        const hits: any[] = Array.isArray(searchParsed.data?.results) ? searchParsed.data.results : [];

        const matchingHits = hits.filter(h => {
          if (!h || !h.key) return false;
          if (String(h.kingdom || '').toLowerCase() !== 'animalia') return false;
          if (String(h.canonicalName || '').toLowerCase() !== cleanName.toLowerCase()) return false;
          const hRankUpper = String(h.rank || '').toUpperCase();
          if (rankFilter) {
            if (hRankUpper !== rankFilter.toUpperCase()) return false;
          } else {
            if (!HIGHER_TAXON_RANKS.has(hRankUpper) || hRankUpper === 'KINGDOM' || hRankUpper === 'PHYLUM') return false;
            if (expectedRank && !['GENUS', 'SUBGENUS'].includes(expectedRank.toUpperCase()) && ['GENUS', 'SUBGENUS'].includes(hRankUpper)) {
              return false;
            }
          }
          if (expectedClass && h.class && String(h.class).toLowerCase() !== expectedClass.toLowerCase()) return false;
          if (expectedFamily && h.family && String(h.family).toLowerCase() !== expectedFamily.toLowerCase()) return false;
          return true;
        });

        const acceptedHit =
          matchingHits.find(h => h.taxonomicStatus === 'ACCEPTED') ||
          matchingHits.find(h => h.taxonomicStatus === 'SYNONYM' && h.acceptedKey);

        if (acceptedHit) {
          return {
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
        return null;
      };

      let candidateRecord: any = await resolveMatchOrSearch(expectedRank);
      // iNaturalist ile GBIF Backbone arasındaki takson basamağı farklarını tolere et (ör. Crocodylia: iNat=ORDER, GBIF=CLASS)
      if (
        !candidateRecord &&
        expectedRank &&
        HIGHER_TAXON_RANKS.has(expectedRank.toUpperCase()) &&
        !['GENUS', 'SUBGENUS', 'KINGDOM', 'PHYLUM'].includes(expectedRank.toUpperCase())
      ) {
        const fallbackCandidate = await resolveMatchOrSearch(undefined);
        const fbRank = String(fallbackCandidate?.rank || '').toUpperCase();
        if (
          fallbackCandidate &&
          HIGHER_TAXON_RANKS.has(fbRank) &&
          !['KINGDOM', 'PHYLUM', 'GENUS', 'SUBGENUS'].includes(fbRank)
        ) {
          candidateRecord = fallbackCandidate;
        }
      }
      let synonymOf: string | undefined;

      if (!candidateRecord || !candidateRecord.usageKey) {
        const failRes: VerifiedHigherTaxonResult = {
          verified: false,
          status: 'NOT_FOUND',
          scientificName: cleanName,
          reason: `"${cleanName}" için GBIF Backbone arşivinde kabul edilen Animalia üst takson kaydı doğrulanamadı.`,
        };
        setCached(cacheKey, failRes, 10 * 60 * 1000);
        return failRes;
      }

      // Sinonim ise acceptedUsageKey üzerinden kabul edilen üst taksona yönlendir
      const finalKey: number = Number(candidateRecord.acceptedUsageKey || candidateRecord.usageKey);
      if (candidateRecord.status === 'SYNONYM' && candidateRecord.acceptedUsageKey) {
        synonymOf = candidateRecord.canonicalName || candidateRecord.scientificName;
      }

      // Yalnızca sinonim çözümlemesi veya eksik sınıf/familya bilgisi gerektiğinde ek /v1/species/{finalKey} isteği at
      let detailData: any = null;
      const needsDetailFetch =
        candidateRecord.status === 'SYNONYM' ||
        (expectedClass && !candidateRecord.class) ||
        (expectedFamily && !candidateRecord.family);

      if (needsDetailFetch) {
        try {
          detailData = await fetchSpeciesDetailCached(finalKey);
        } catch {
          // Detay isteği başarısız olursa mevcut doğrulanmış Backbone alanlarıyla devam edilir
        }
      }

      const finalKingdom = detailData?.kingdom || candidateRecord.kingdom;
      const finalRank = detailData?.rank || candidateRecord.rank;
      const finalClass = detailData?.class || candidateRecord.class;
      const finalFamily = detailData?.family || candidateRecord.family;
      const finalStatus = detailData?.taxonomicStatus || (candidateRecord.status === 'SYNONYM' ? 'ACCEPTED' : candidateRecord.status) || 'ACCEPTED';

      if (String(finalKingdom || '').toLowerCase() !== 'animalia') {
        const nonAnimalRes: VerifiedHigherTaxonResult = {
          verified: false,
          status: 'NOT_FOUND',
          scientificName: cleanName,
          reason: `"${cleanName}" Animalia alemi dışında (${finalKingdom || 'Bilinmiyor'}) yer aldığı için reddedildi.`,
        };
        setCached(cacheKey, nonAnimalRes, 10 * 60 * 1000);
        return nonAnimalRes;
      }

      if (expectedClass && finalClass && String(finalClass).toLowerCase() !== expectedClass.toLowerCase()) {
        const mismatchRes: VerifiedHigherTaxonResult = {
          verified: false,
          status: 'NOT_FOUND',
          scientificName: cleanName,
          reason: `"${cleanName}" beklenen sınıf (${expectedClass}) ile uyuşmadı (bulunan: ${finalClass}).`,
        };
        setCached(cacheKey, mismatchRes, 10 * 60 * 1000);
        return mismatchRes;
      }

      if (expectedFamily && finalFamily && String(finalFamily).toLowerCase() !== expectedFamily.toLowerCase()) {
        const mismatchFamilyRes: VerifiedHigherTaxonResult = {
          verified: false,
          status: 'NOT_FOUND',
          scientificName: cleanName,
          reason: `"${cleanName}" beklenen familya (${expectedFamily}) ile uyuşmadı (bulunan: ${finalFamily}).`,
        };
        setCached(cacheKey, mismatchFamilyRes, 10 * 60 * 1000);
        return mismatchFamilyRes;
      }

      if (finalStatus === 'DOUBTFUL') {
        const doubtfulRes: VerifiedHigherTaxonResult = {
          verified: false,
          status: 'NOT_FOUND',
          scientificName: cleanName,
          reason: `"${cleanName}" GBIF Backbone üzerinde DOUBTFUL statüsünde olduğu için hariç tutuldu.`,
        };
        setCached(cacheKey, doubtfulRes, 10 * 60 * 1000);
        return doubtfulRes;
      }

      const okRes: VerifiedHigherTaxonResult = {
        verified: true,
        status: 'VERIFIED',
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
      const errMsg = err?.message || 'GBIF Backbone doğrulama isteği başarısız oldu.';
      return {
        verified: false,
        status: 'ERROR',
        scientificName: cleanName,
        errorMessage: errMsg,
        reason: errMsg,
      };
    }
  });
}

async function resolveProfileToTaxonGroups(
  profile: TaxonGroupProfile
): Promise<{
  groups: TaxonGroupCandidate[];
  unresolvedGroups: Array<{ scientificName: string; reason: string }>;
  hasApiError: boolean;
  apiErrorMessage?: string;
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
  let hasApiError = false;
  let apiErrorMessage: string | undefined;

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
      if (s.value.verified.status === 'ERROR') {
        hasApiError = true;
        if (!apiErrorMessage) {
          apiErrorMessage = s.value.verified.errorMessage || s.value.verified.reason;
        }
      }
      if (!s.value.verified.verified) {
        unresolvedGroups.push({
          scientificName: s.value.spec.scientificName,
          reason: s.value.verified.reason || 'GBIF Backbone üzerinde doğrulanamadı.',
        });
      }
    } else {
      hasApiError = true;
      if (!apiErrorMessage) {
        apiErrorMessage = s.reason?.message || 'GBIF Backbone doğrulama isteği başarısız oldu.';
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
    const singleRank = verifiedMembers.length === 1 ? primaryMember.rank || 'GROUP' : 'COMPOSITE_GROUP';
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
      rank: singleRank,
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
      canDrillDown:
        !sub.allowedCanonicalNames?.length &&
        verifiedMembers.some(v =>
          ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY'].includes(String(v.rank || '').toUpperCase())
        ),
    });
  }

  return { groups, unresolvedGroups, hasApiError, apiErrorMessage };
}

const GENERAL_GROUP_PRIORITY_ALIASES = new Set(
  [
    'hayvan', 'hayvanlar', 'animal', 'animals', 'animalia',
    'memeli', 'memeliler', 'mammal', 'mammals',
    'kuş', 'kuşlar', 'bird', 'birds',
    'sürüngen', 'sürüngenler', 'reptile', 'reptiles',
    'amfibi', 'amfibiler', 'iki yaşamlı', 'iki yaşamlılar', 'amphibian', 'amphibians',
    'balık', 'balıklar', 'fish', 'fishes',
    'böcek', 'böcekler', 'insect', 'insects',
    'kelebek', 'kelebekler', 'butterfly', 'butterflies', 'güve', 'moth', 'moths',
    'örümcek', 'örümcekler', 'spider', 'spiders',
    'yılan', 'yılanlar', 'snake', 'snakes',
    'kertenkele', 'kertenkeleler', 'lizard', 'lizards',
    'kurbağa', 'kurbağalar', 'frog', 'frogs', 'toad', 'toads',
    'semender', 'semenderler', 'salamander', 'salamanders', 'newt',
    'baykuş', 'baykuşlar', 'owl', 'owls',
    'papağan', 'papağanlar', 'parrot', 'parrots',
    'penguen', 'penguenler', 'penguin', 'penguins',
    'yunus', 'yunuslar', 'dolphin', 'dolphins',
    'şahin', 'şahinler', 'buzzard', 'hawk', 'hawks',
    'doğan', 'doğanlar', 'falcon', 'falcons',
    'akbaba', 'akbabalar', 'vulture', 'vultures',
    'pelikan', 'pelikanlar', 'pelican', 'pelicans',
    'turna', 'turnalar', 'crane', 'cranes',
    'leylek', 'leylekler', 'stork', 'storks',
    'flamingo', 'flamingolar', 'flamingos',
    'ördek', 'ördekler', 'duck', 'ducks',
    'kaz', 'kazlar', 'goose', 'geese',
    'kuğu', 'kuğular', 'swan', 'swans',
    'martı', 'martılar', 'gull', 'gulls',
    'karga', 'kargalar', 'crow', 'crows',
    'ağaçkakan', 'ağaçkakanlar', 'woodpecker', 'woodpeckers',
    'serçe', 'serçeler', 'sparrow', 'sparrows',
    'güvercin', 'güvercinler', 'pigeon', 'dove', 'doves',
    'sincap', 'sincaplar', 'squirrel', 'squirrels',
    'kirpi', 'kirpiler', 'hedgehog', 'hedgehogs',
    'tavşan', 'tavşanlar', 'hare', 'hares', 'rabbit', 'rabbits',
    'yarasa', 'yarasalar', 'bat', 'bats',
    'maymun', 'maymunlar', 'monkey', 'monkeys', 'primate', 'primates', 'primat',
    'fok', 'foklar', 'seal', 'seals',
    'sırtlan', 'sırtlanlar', 'hyena', 'hyenas',
    'vaşak', 'vaşaklar', 'lynx', 'lynxes',
    'porsuk', 'porsuklar', 'badger', 'badgers',
    'ceylan', 'ceylanlar', 'gazelle', 'gazelles',
    'kunduz', 'kunduzlar', 'beaver', 'beavers',
    'samur', 'samurlar', 'otter', 'otters',
    'panda', 'pandalar',
    'fil', 'filler', 'elephant', 'elephants',
    'gergedan', 'gergedanlar', 'rhino', 'rhinoceros',
    'kanguru', 'kangurular', 'kangaroo', 'kangaroos',
    'timsah', 'timsahlar', 'crocodile', 'crocodiles',
    'ahtapot', 'ahtapotlar', 'octopus', 'octopuses',
    'kalamar', 'kalamarlar', 'squid', 'squids',
    'yengeç', 'yengeçler', 'crab', 'crabs',
    'ıstakoz', 'istakoz', 'lobster',
    'karides', 'shrimp',
    'yumuşakça', 'yumuşakçalar', 'mollusk', 'mollusca',
    'salyangoz', 'salyangozlar', 'snail', 'snails',
    'denizanası', 'denizanaları', 'jellyfish',
    'mercan', 'mercanlar', 'coral', 'corals',
    'arı', 'arılar', 'bee', 'bees',
    'karınca', 'karıncalar', 'ant', 'ants',
    'yusufçuk', 'yusufçuklar', 'dragonfly', 'dragonflies',
    'çekirge', 'çekirgeler', 'grasshopper', 'locust',
    'sinek', 'sinekler', 'fly', 'flies',
    'akrep', 'akrepler', 'scorpion', 'scorpions',
    'kene', 'keneler', 'tick', 'ticks',
    'bukalemun', 'bukalemunlar', 'chameleon', 'chameleons',
    'deniz yıldızı', 'deniz yıldızları', 'starfish', 'sea star', 'sea stars',
    'deniz kestanesi', 'deniz kestaneleri', 'sea urchin', 'sea urchins',
    'sülük', 'sülükler', 'leech', 'leeches',
    'peygamberdevesi', 'peygamberdeveleri', 'mantis', 'praying mantis',
    'zebra', 'zebralar', 'zebras',
    'at sineği', 'at sinekleri', 'horsefly', 'horseflies', 'horse fly', 'horse flies',
  ].map(s => foldTurkishChars(s))
);

function isGeneralGroupAliasQuery(query: string): boolean {
  const folded = foldTurkishChars(query);
  for (const variant of stripCommonPlurals(folded)) {
    if (GENERAL_GROUP_PRIORITY_ALIASES.has(variant)) return true;
  }
  return false;
}

function translateTaxonRankTr(rank?: string): string {
  switch ((rank || '').toUpperCase()) {
    case 'KINGDOM': return 'Alem';
    case 'PHYLUM': return 'Şube';
    case 'CLASS': return 'Sınıf';
    case 'ORDER': return 'Takım';
    case 'FAMILY': return 'Familya';
    case 'GENUS': return 'Cins';
    case 'SPECIES': return 'Tür';
    default: return rank || 'Alt Grup';
  }
}

function getChildRankForRank(rank?: string): string | null {
  switch ((rank || '').toUpperCase()) {
    case 'KINGDOM': return 'PHYLUM';
    case 'PHYLUM': return 'CLASS';
    case 'CLASS': return 'ORDER';
    case 'SUBCLASS': return 'ORDER';
    case 'ORDER': return 'FAMILY';
    case 'SUBORDER': return 'FAMILY';
    case 'INFRAORDER': return 'FAMILY';
    case 'FAMILY': return 'GENUS';
    case 'SUBFAMILY': return 'GENUS';
    default: return null;
  }
}

function getFallbackChildRank(primaryRank: string): string | null {
  switch (primaryRank.toUpperCase()) {
    case 'PHYLUM': return 'CLASS';
    case 'CLASS': return 'ORDER';
    case 'ORDER': return 'FAMILY';
    case 'FAMILY': return 'GENUS';
    default: return null;
  }
}

function extractVernacularsFromSearchItem(item: any): { trName?: string; enName?: string } {
  const vList: any[] = Array.isArray(item?.vernacularNames) ? item.vernacularNames : [];
  if (vList.length === 0) return {};
  const sciLower = String(item?.canonicalName || item?.scientificName || '').toLowerCase();

  const pickLang = (langs: string[]): string | undefined => {
    const matches = vList.filter(
      v => v && typeof v.vernacularName === 'string' && langs.includes(String(v.language || '').toLowerCase())
    );
    const preferred = matches.find(v => v.preferred && v.vernacularName.toLowerCase() !== sciLower);
    const first = matches.find(v => v.vernacularName.toLowerCase() !== sciLower);
    return (preferred || first)?.vernacularName;
  };

  return {
    trName: pickLang(['tur', 'tr']),
    enName: pickLang(['eng', 'en']),
  };
}

async function fetchTaxonBilingualLabel(
  scientificName: string,
  speciesKey: number,
  rank?: string,
  skipGbifVernacular = false
): Promise<{ trName?: string; enName?: string }> {
  const cacheKey = `taxon-label:v1:${speciesKey}:${scientificName.toLowerCase()}`;
  const cached = getCached<{ trName?: string; enName?: string }>(cacheKey);
  if (cached) return cached;

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    let trName: string | undefined;
    let enName: string | undefined;

    const rankParam = rank ? `&rank=${encodeURIComponent(rank.toLowerCase())}` : '';
    const [inatRes, gbifVernRes] = await Promise.allSettled([
      fetchSafeJson<{ results?: any[] }>(
        `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}${rankParam}&locale=tr&per_page=5`,
        'iNaturalist Bilingual Label API',
        1,
        5000
      ),
      skipGbifVernacular
        ? Promise.resolve<SafeJsonParseResult<{ results?: any[] }>>({ ok: false, status: 0, data: null })
        : fetchSafeJson<{ results?: any[] }>(
            `https://api.gbif.org/v1/species/${speciesKey}/vernacularNames?limit=30`,
            'GBIF Vernacular Names API',
            0,
            4500
          ),
    ]);

    const inatOk = inatRes.status === 'fulfilled' && inatRes.value.ok && Boolean(inatRes.value.data);
    const gbifVernOk = gbifVernRes.status === 'fulfilled' && gbifVernRes.value.ok && Boolean(gbifVernRes.value.data);

    if (inatOk && Array.isArray(inatRes.value.data?.results)) {
      const exactInat = inatRes.value.data.results.find(
        (x: any) =>
          x &&
          typeof x.name === 'string' &&
          x.name.toLowerCase() === scientificName.toLowerCase() &&
          (!x.iconic_taxon_name || ANIMAL_INAT_ICONIC_TAXA.has(String(x.iconic_taxon_name).toLowerCase()))
      );
      if (exactInat) {
        if (exactInat.preferred_common_name && String(exactInat.preferred_common_name).toLowerCase() !== scientificName.toLowerCase()) {
          trName = exactInat.preferred_common_name;
        }
        if (exactInat.english_common_name && String(exactInat.english_common_name).toLowerCase() !== scientificName.toLowerCase()) {
          enName = exactInat.english_common_name;
        }
      }
    }

    if ((!trName || !enName) && gbifVernOk && Array.isArray(gbifVernRes.value.data?.results)) {
      const vList: any[] = gbifVernRes.value.data.results;
      if (!trName) {
        const tur = vList.find(v => v?.language === 'tur' && v?.preferred) || vList.find(v => v?.language === 'tur');
        if (tur?.vernacularName) trName = tur.vernacularName;
      }
      if (!enName) {
        const eng = vList.find(v => v?.language === 'eng' && v?.preferred) || vList.find(v => v?.language === 'eng');
        if (eng?.vernacularName) enName = eng.vernacularName;
      }
    }

    const out = { trName, enName };
    if (inatOk || gbifVernOk) {
      setCached(cacheKey, out, 30 * 60 * 1000);
    }
    return out;
  });
}

/**
 * Alt grup listesi sayfalarında görünen taksonların eksik Türkçe/İngilizce yaygın adlarını isteğe bağlı olarak zenginleştirir.
 */
export async function enrichSubgroupLabels(
  subgroups: TaxonGroupCandidate[],
  startIndex = 0,
  count = 10
): Promise<TaxonGroupCandidate[]> {
  if (!subgroups || subgroups.length === 0) return subgroups;
  const endIndex = Math.min(subgroups.length, startIndex + count);
  const targets: Array<{ index: number; group: TaxonGroupCandidate }> = [];

  for (let i = startIndex; i < endIndex; i++) {
    const g = subgroups[i];
    if (!g || g.isParentOverview) continue;
    const key = g.acceptedUsageKey || g.taxonKeys?.[0];
    if (!key) continue;
    if (!g.turkishName || !g.englishName) {
      targets.push({ index: i, group: g });
    }
  }

  if (targets.length === 0) return subgroups;

  const settled = await runWithConcurrencyLimit(targets, 2, async ({ index, group }) => {
    const key = Number(group.acceptedUsageKey || group.taxonKeys?.[0]);
    const skipGbifVernacular = Boolean((group as any)._hasInlineGbifChecked);
    const names = await fetchTaxonBilingualLabel(group.scientificName, key, group.rank, skipGbifVernacular);
    return { index, names };
  });

  const updated = [...subgroups];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { index, names } = s.value;
    const cur = updated[index];
    if (!cur) continue;
    const trName = cur.turkishName || names.trName;
    const enName = cur.englishName || names.enName;
    const commonLabel = trName || enName;
    const displayLabel = commonLabel
      ? `${commonLabel} (${cur.scientificName})`
      : `${cur.scientificName} (${translateTaxonRankTr(cur.rank)})`;
    updated[index] = {
      ...cur,
      turkishName: trName,
      englishName: enName,
      label: displayLabel,
    };
  }
  return updated;
}

export interface TaxonSubgroupExpansionResult {
  groups: TaxonGroupCandidate[];
  pagination: SubgroupPaginationMeta;
}

export interface ExpandSubgroupsOptions {
  countryCode?: string;
  existingResult?: TaxonSubgroupExpansionResult;
  fetchAll?: boolean;
  maxPagesPerBatch?: number;
}

/**
 * Doğrulanmış herhangi bir Animalia üst taksonunu (tekil veya COMPOSITE_GROUP)
 * yalnızca GBIF Backbone taksonomik hiyerarşisi üzerinden gerçek cursor tabanlı sayfalama ile
 * biyolojik alt gruplarına ayırır. Eksik alt gruplar varsa sayfalama meta verisi ile bildirir;
 * soyu tükenmiş taksonları fosil/görünüm filtresinden bağımsız olarak katalogdan silmez.
 */
export async function expandTaxonCandidateToSubgroupsPaged(
  parentGroup: TaxonGroupCandidate,
  options: ExpandSubgroupsOptions = {}
): Promise<TaxonSubgroupExpansionResult> {
  const existingResult = options.existingResult;
  const effectiveParent = existingResult?.pagination?.parentGroup || parentGroup;
  const fetchAll = Boolean(options.fetchAll);
  const maxPagesPerBatch = fetchAll ? Number.POSITIVE_INFINITY : Math.max(1, options.maxPagesPerBatch ?? 1);

  const rawMemberKeys =
    effectiveParent.taxonKeys && effectiveParent.taxonKeys.length > 0
      ? effectiveParent.taxonKeys
      : [effectiveParent.acceptedUsageKey || effectiveParent.usageKey];
  const memberKeys = Array.from(
    new Set(rawMemberKeys.filter((k): k is number => typeof k === 'number' && k > 0))
  ).sort((a, b) => a - b);

  if (memberKeys.length === 0 || !effectiveParent.isVerified) {
    return {
      groups: [effectiveParent],
      pagination: {
        parentGroup: effectiveParent,
        hasMore: false,
        loadedCount: 1,
        totalMatchedCount: 1,
        offsetLimitReached: false,
        hasError: false,
        cursors: [],
      },
    };
  }

  const cacheKey = `expand-bb-subgroups:v3:${memberKeys.join(',')}:${(effectiveParent.rank || '').toUpperCase()}`;
  if (!existingResult && !fetchAll) {
    const cached = getCached<TaxonSubgroupExpansionResult>(cacheKey);
    if (cached) return cached;
  }

  const inflightKey = existingResult
    ? `in-flight:${cacheKey}:more:${existingResult.pagination.cursors.map(c => `${c.memberKey}:${c.nextOffset}`).join(',')}:${fetchAll ? 'all' : 'page'}`
    : `in-flight:${cacheKey}:${fetchAll ? 'all' : 'init'}`;

  return runDedupedInFlight(inflightKey, async () => {
    const excludedSciSet = new Set(
      (effectiveParent.excludedScientificNames || []).map(n => n.toLowerCase())
    );
    const excludedTaxonSet = new Set(
      (effectiveParent.excludedOrderNames || []).map(n => n.toLowerCase())
    );
    const parentKeySet = new Set<number>(memberKeys);

    // İlk yüklemede varsa mevcut cursor durumunu koru; aksi halde her memberKey için cursor başlat
    let cursors: SubgroupMemberCursor[] = [];
    if (existingResult?.pagination?.cursors?.length) {
      cursors = existingResult.pagination.cursors.map(c => ({
        ...c,
        // Hata nedeniyle durmuş cursor'ları tekrar denemeye aç
        hasError: false,
        errorMessage: undefined,
      }));
    } else {
      await runWithConcurrencyLimit(memberKeys, 3, async (mKey) => {
        const detail = await fetchSpeciesDetailCached(mKey);
        const mRank = String(detail?.rank || effectiveParent.rank || '').toUpperCase();
        const primaryChildRank = getChildRankForRank(mRank);
        if (!primaryChildRank) {
          cursors.push({
            memberKey: mKey,
            targetRank: '',
            nextOffset: 0,
            endOfRecords: true,
            apiTotalCount: 0,
            hitOffsetLimit: false,
            hasError: false,
          });
          return;
        }
        cursors.push({
          memberKey: mKey,
          targetRank: primaryChildRank,
          nextOffset: 0,
          endOfRecords: false,
          apiTotalCount: null,
          hitOffsetLimit: false,
          hasError: false,
        });
      });
      cursors.sort((a, b) => a.memberKey - b.memberKey);
    }

    const existingChildByKey = new Map<number, TaxonGroupCandidate>();
    if (existingResult?.groups) {
      for (const g of existingResult.groups) {
        if (g.isParentOverview) continue;
        const k = g.acceptedUsageKey || g.taxonKeys?.[0];
        if (k) existingChildByKey.set(k, g);
      }
    }

    const newlyCollectedByKey = new Map<number, { item: any; parentMemberKey: number; numDescendants: number }>();

    const fetchBackboneChildrenPages = async (
      cursor: SubgroupMemberCursor,
      rankToQuery: string,
      maxPages: number
    ): Promise<Array<{ item: any; parentMemberKey: number; numDescendants: number }>> => {
      const collected: Array<{ item: any; parentMemberKey: number; numDescendants: number }> = [];
      const pageLimit = fetchAll ? 1000 : 200;
      let pagesFetched = 0;

      while (!cursor.endOfRecords && pagesFetched < maxPages) {
        const remainingBeforeCap = GBIF_SPECIES_SEARCH_MAX_OFFSET - cursor.nextOffset;
        if (remainingBeforeCap <= 0) {
          cursor.endOfRecords = true;
          cursor.hitOffsetLimit = true;
          break;
        }
        const effectiveLimit = Math.min(pageLimit, remainingBeforeCap);
        const url = `https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&higherTaxonKey=${cursor.memberKey}&rank=${encodeURIComponent(rankToQuery)}&status=ACCEPTED&limit=${effectiveLimit}&offset=${cursor.nextOffset}`;

        try {
          const res = await fetchWithRetry(url, undefined, 2, 8000);
          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            if (res.status === 400) {
              const isBoundaryExceeded =
                cursor.nextOffset >= GBIF_SPECIES_SEARCH_MAX_OFFSET ||
                cursor.nextOffset + effectiveLimit > GBIF_SPECIES_SEARCH_MAX_OFFSET;
              const hasOffsetLimitBody =
                /max(?:imum)?\s*offset|offset\s*(?:must|cannot|can't|exceed|exceeded|limit|greater|<=|<)|exceeded.*offset|100[\s,.]?000/i.test(
                  errBody
                );
              if (isBoundaryExceeded || hasOffsetLimitBody) {
                cursor.endOfRecords = true;
                cursor.hitOffsetLimit = true;
                break;
              }
            }
            cursor.hasError = true;
            cursor.errorMessage = `GBIF alt grup servisi HTTP ${res.status} hatası döndürdü.`;
            break;
          }

          let json: any = null;
          try {
            json = await res.json();
          } catch {
            cursor.hasError = true;
            cursor.errorMessage = 'GBIF alt grup yanıtı geçerli JSON değil.';
            break;
          }

          if (!json || typeof json !== 'object' || !Array.isArray(json.results)) {
            cursor.hasError = true;
            cursor.errorMessage = 'GBIF alt grup yanıtında results alanı eksik.';
            break;
          }

          const items: any[] = json.results;
          if (typeof json.count === 'number' && Number.isFinite(json.count)) {
            cursor.apiTotalCount = json.count;
          }

          for (const item of items) {
            const k = Number(item?.key);
            if (!k || parentKeySet.has(k)) continue;
            if (String(item.kingdom || '').toLowerCase() !== 'animalia') continue;
            if (item.taxonomicStatus && item.taxonomicStatus !== 'ACCEPTED') continue;
            // Soyu tükenmiş taksonları (item.extinct === true) katalogdan SİLME — metadata ile işaretle
            collected.push({
              item,
              parentMemberKey: cursor.memberKey,
              numDescendants: Number(item.numDescendants || 0),
            });
          }

          cursor.nextOffset += items.length;
          pagesFetched++;

          if (cursor.nextOffset >= GBIF_SPECIES_SEARCH_MAX_OFFSET) {
            cursor.endOfRecords = true;
            cursor.hitOffsetLimit = true;
          } else if (json.endOfRecords === true || items.length === 0) {
            cursor.endOfRecords = true;
          }
        } catch (err: any) {
          cursor.hasError = true;
          cursor.errorMessage = err?.message || 'GBIF alt grup servisine erişilemedi.';
          break;
        }
      }

      return collected;
    };

    const activeCursors = cursors.filter(c => !c.endOfRecords && c.targetRank);
    await runWithConcurrencyLimit(activeCursors, 3, async (cursor) => {
      let rows = await fetchBackboneChildrenPages(cursor, cursor.targetRank, maxPagesPerBatch);

      // İlk sorguda çok az (<2) sonuç gelip tarama bittiyse ve henüz bir sonraki rank'a düşülmediyse fallback rank dene
      if (
        !existingResult &&
        !cursor.hasError &&
        cursor.endOfRecords &&
        rows.length < 2
      ) {
        const fbRank = getFallbackChildRank(cursor.targetRank);
        if (fbRank) {
          const fbCursor: SubgroupMemberCursor = {
            memberKey: cursor.memberKey,
            targetRank: fbRank,
            nextOffset: 0,
            endOfRecords: false,
            apiTotalCount: null,
            hitOffsetLimit: false,
            hasError: false,
          };
          const fbRows = await fetchBackboneChildrenPages(fbCursor, fbRank, maxPagesPerBatch);
          if (!fbCursor.hasError && (fbRows.length >= 2 || fbRows.length > rows.length)) {
            rows = fbRows;
            cursor.targetRank = fbCursor.targetRank;
            cursor.nextOffset = fbCursor.nextOffset;
            cursor.endOfRecords = fbCursor.endOfRecords;
            cursor.apiTotalCount = fbCursor.apiTotalCount;
            cursor.hitOffsetLimit = fbCursor.hitOffsetLimit;
            cursor.hasError = fbCursor.hasError;
            cursor.errorMessage = fbCursor.errorMessage;
          }
        }
      }

      for (const row of rows) {
        const { item, parentMemberKey, numDescendants } = row;
        const childKey = Number(item.key);
        if (!childKey || parentKeySet.has(childKey)) continue;
        const childSci = String(item.canonicalName || item.scientificName || '').trim();
        const childSciLower = childSci.toLowerCase();
        if (!childSci) continue;
        if (excludedSciSet.has(childSciLower) || excludedTaxonSet.has(childSciLower)) continue;

        const orderLower = String(item.order || '').toLowerCase();
        const familyLower = String(item.family || '').toLowerCase();
        const genusLower = String(item.genus || '').toLowerCase();
        if (
          (orderLower && excludedTaxonSet.has(orderLower)) ||
          (familyLower && excludedTaxonSet.has(familyLower)) ||
          (genusLower && excludedTaxonSet.has(genusLower))
        ) {
          continue;
        }

        if (!existingChildByKey.has(childKey) && !newlyCollectedByKey.has(childKey)) {
          newlyCollectedByKey.set(childKey, { item, parentMemberKey, numDescendants });
        }
      }
    });

    const newChildCandidates: TaxonGroupCandidate[] = Array.from(newlyCollectedByKey.values()).map(
      ({ item, parentMemberKey, numDescendants }) => {
        const childKey = Number(item.key);
        const childRank = String(item.rank || '').toUpperCase();
        const childSci = String(item.canonicalName || item.scientificName || '').trim();
        const isExtinct = item.extinct === true;
        const inlineNames = extractVernacularsFromSearchItem(item);
        const commonLabel = inlineNames.trName || inlineNames.enName;
        const displayLabel = commonLabel
          ? `${commonLabel} (${childSci})`
          : `${childSci} (${translateTaxonRankTr(childRank)})`;

        return {
          id: `dyn-sub-${childKey}`,
          label: displayLabel,
          scientificName: childSci,
          usageKey: childKey,
          acceptedUsageKey: childKey,
          taxonKeys: [childKey],
          rank: childRank,
          taxonomicStatus: String(item.taxonomicStatus || 'ACCEPTED'),
          kingdom: 'Animalia',
          parentKey: typeof item.parentKey === 'number' ? item.parentKey : parentMemberKey,
          turkishName: inlineNames.trName,
          englishName: inlineNames.enName,
          description: `${effectiveParent.scientificName} altındaki GBIF Backbone doğrulamalı ${translateTaxonRankTr(childRank).toLowerCase()} grubu${numDescendants > 0 ? ` (${numDescendants.toLocaleString('tr-TR')} alt takson)` : ''}${isExtinct ? ' — fosil / soyu tükenmiş' : ''}.`,
          dataSource: 'GBIF Backbone Taxonomy',
          matchType: 'VERIFIED_SUBGROUP',
          isVerified: true,
          isExtinct,
          canDrillDown: ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY'].includes(childRank) && childRank !== 'GENUS',
          ...(Array.isArray(item.vernacularNames) ? { _hasInlineGbifChecked: true } : {}),
          _numDescendants: numDescendants,
        } as TaxonGroupCandidate & { _numDescendants?: number };
      }
    );

    const combinedChildrenMap = new Map<number, TaxonGroupCandidate>();
    for (const [k, g] of existingChildByKey.entries()) {
      combinedChildrenMap.set(k, g);
    }
    for (const g of newChildCandidates) {
      const k = g.acceptedUsageKey || g.taxonKeys?.[0];
      if (k && !combinedChildrenMap.has(k)) {
        combinedChildrenMap.set(k, g);
      }
    }

    const anyCursorHasError = cursors.some(c => c.hasError);
    const anyCursorHasMore = cursors.some(c => !c.endOfRecords && !c.hasError);
    const anyCursorHitOffsetLimit = cursors.some(c => c.hitOffsetLimit);
    const firstCursorErr = cursors.find(c => c.hasError && c.errorMessage)?.errorMessage;
    const totalMatchedCount = cursors.every(c => typeof c.apiTotalCount === 'number')
      ? cursors.reduce((acc, c) => acc + (c.apiTotalCount || 0), 0)
      : cursors.some(c => typeof c.apiTotalCount === 'number')
        ? cursors.reduce((acc, c) => acc + (c.apiTotalCount || 0), 0)
        : null;

    if (combinedChildrenMap.size === 0) {
      const emptyPagination: SubgroupPaginationMeta = {
        parentGroup: effectiveParent,
        hasMore: anyCursorHasMore,
        loadedCount: 1,
        totalMatchedCount,
        offsetLimitReached: anyCursorHitOffsetLimit,
        hasError: anyCursorHasError,
        errorMessage: firstCursorErr,
        cursors,
      };
      return {
        groups: [effectiveParent],
        pagination: emptyPagination,
      };
    }

    // Gözlemlerden ve ülkeden bağımsız deterministik sıralama: yaşayan/belirtilmemiş taksonlar önce, ardından alt takson zenginliği azalan ve alfabetik
    const sortedChildren = Array.from(combinedChildrenMap.values()).sort((a, b) => {
      const extA = a.isExtinct ? 1 : 0;
      const extB = b.isExtinct ? 1 : 0;
      if (extA !== extB) return extA - extB;
      const descA = Number((a as any)._numDescendants || 0);
      const descB = Number((b as any)._numDescendants || 0);
      if (descB !== descA) return descB - descA;
      return a.scientificName.localeCompare(b.scientificName, 'en');
    });

    const overviewGroup: TaxonGroupCandidate =
      existingResult?.groups?.find(g => g.isParentOverview) || {
        ...effectiveParent,
        isParentOverview: true,
        canDrillDown: false,
        label: effectiveParent.label.startsWith('Tümü')
          ? effectiveParent.label
          : `Tümü — ${effectiveParent.label}`,
      };

    // İlk yüklemede yalnızca ilk 10 alt grubu zenginleştir; "Tümünü Göster" / devam sayfalarında mevcut etiketleri koru
    const enrichedChildren = existingResult
      ? sortedChildren
      : await enrichSubgroupLabels(sortedChildren, 0, 10);
    const finalSubgroups = [overviewGroup, ...enrichedChildren];

    const pagination: SubgroupPaginationMeta = {
      parentGroup: effectiveParent,
      hasMore: anyCursorHasMore || anyCursorHasError,
      loadedCount: finalSubgroups.length,
      totalMatchedCount,
      offsetLimitReached: anyCursorHitOffsetLimit,
      hasError: anyCursorHasError,
      errorMessage: firstCursorErr,
      cursors,
    };

    const result: TaxonSubgroupExpansionResult = {
      groups: finalSubgroups,
      pagination,
    };

    if (!anyCursorHasError && !anyCursorHasMore && !anyCursorHitOffsetLimit) {
      setCached(cacheKey, result, 15 * 60 * 1000);
    }
    return result;
  });
}

export async function expandTaxonCandidateToSubgroups(
  parentGroup: TaxonGroupCandidate,
  countryCode: string = 'TR'
): Promise<TaxonGroupCandidate[]> {
  const res = await expandTaxonCandidateToSubgroupsPaged(parentGroup, { countryCode });
  return res.groups;
}

function scoreHigherTaxonCommonMatch(candidateName: string | undefined, query: string): number {
  if (!candidateName) return 0;
  const candLower = toTrLower(candidateName);
  const queryLower = toTrLower(query);
  const candFold = foldTurkishChars(candidateName);
  const queryFold = foldTurkishChars(query);

  if (!queryFold || queryFold.length < 2) return 0;
  if (candLower === queryLower || candFold === queryFold) return 100;

  // 2 harfli çok kısa sorgularda "-giller" / çok kelimeli başlık genişletmesi yapma (ör. "at" -> "Atgiller" / "At Sinekleri" önlenir)
  if (queryFold.length <= 2) return 0;

  const queryForms = Array.from(new Set(stripCommonPlurals(queryFold)));
  const stemPatterns = queryForms.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const combinedStem = `(?:${stemPatterns.join('|')})`;

  const pluralRegex = new RegExp(`^${combinedStem}(?:lar|ler|giller|lari|leri|s|es)?$`, 'i');
  if (pluralRegex.test(candFold)) return 96;

  // "Kelebekler ve Güveler", "Yusufçuklar ve Kızböcekleri" gibi çoklu başlıklar (yalnızca ilk kelime gerçek bağlaç başlığıysa)
  const headPluralRegex = new RegExp(`(?:^|\\s|,)\\s*${combinedStem}(?:lar|ler|giller|lari|leri|s|es)?(?:$|\\s|,)`, 'i');
  if (headPluralRegex.test(candFold)) {
    const candWordsEarly = candFold.split(/[\s,/-]+/).filter(Boolean);
    const isExactConjunctionHead =
      candWordsEarly.length >= 3 &&
      (candWordsEarly[1] === 've' || candWordsEarly[1] === '&') &&
      pluralRegex.test(candWordsEarly[0]);
    if (isExactConjunctionHead) return 92;
  }

  const baseScore = Math.max(...queryForms.map(f => scoreCommonNameMatch(candidateName, f)));
  if (baseScore >= 95) return baseScore;

  const candWords = candFold.split(/[\s,/-]+/).filter(Boolean);
  if (candWords.length >= 2) {
    const hasExactOrPluralWord = candWords.some(w => pluralRegex.test(w));
    // Örn: "Eşek Arısı", "At Sinekleri", "Balık Kartalı" -> sorgu yalnızca niteleyiciyse reddet (50 < 65);
    // "Tipik Örümcekler", "Zıplayan Örümcekler" -> ana başlık kelimesi sondaysa kabul et
    if (hasExactOrPluralWord) {
      const firstWord = candWords[0];
      const lastWord = candWords[candWords.length - 1];
      const isConjunctionHead = candWords.length >= 3 && (candWords[1] === 've' || candWords[1] === '&') && pluralRegex.test(firstWord);
      if (isConjunctionHead) return 92;
      const isLastWordHead = pluralRegex.test(lastWord);
      return isLastWordHead ? (candWords.length === 2 ? 86 : 78) : 50;
    }
  }

  return baseScore;
}

function isInatIconicCompatibleWithGbifClass(iconicLower: string, gbifClass?: string, gbifKingdom?: string): boolean {
  if (String(gbifKingdom || '').toLowerCase() !== 'animalia') return false;
  if (!iconicLower || iconicLower === 'animalia') return true;
  if (!gbifClass) return true;
  const clsLower = gbifClass.toLowerCase();
  if (iconicLower === 'mammalia') return clsLower === 'mammalia';
  if (iconicLower === 'aves') return clsLower === 'aves';
  if (iconicLower === 'amphibia') return clsLower === 'amphibia';
  if (iconicLower === 'arachnida') return clsLower === 'arachnida';
  if (iconicLower === 'insecta') return clsLower === 'insecta';
  if (iconicLower === 'elasmobranchii') return clsLower === 'elasmobranchii';
  if (iconicLower === 'reptilia') {
    return ['squamata', 'testudines', 'crocodylia', 'sphenodontia', 'reptilia'].includes(clsLower);
  }
  return true;
}

/**
 * Profilde yer almayan genel hayvan adları için (örn: Kuş, Kelebek, Örümcek, Papağan, Penguen, Karınca, Yarasa vb.)
 * iNaturalist + GBIF Backbone üzerinden dinamik üst takson keşfi yapar ve alt gruplarına böler.
 */
async function resolveDynamicHigherTaxonGroups(
  query: string,
  countryCode: string = 'TR'
): Promise<{
  groups: TaxonGroupCandidate[];
  subgroupPagination?: SubgroupPaginationMeta;
  unresolvedGroups: Array<{ scientificName: string; reason: string }>;
  hasPartialError?: boolean;
}> {
  const clean = normalizeSearchQuery(query);
  const cleanCountry = normalizeDiscoveryCountryCode(countryCode);
  const cacheKey = `dynamic-groups:v5:${toTrLower(clean)}:${cleanCountry || 'GLOBAL'}`;
  const cached = getCached<{
    groups: TaxonGroupCandidate[];
    subgroupPagination?: SubgroupPaginationMeta;
    unresolvedGroups: Array<{ scientificName: string; reason: string }>;
    hasPartialError?: boolean;
  }>(cacheKey);
  if (cached) return cached;

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    const cleanLower = toTrLower(clean);
    const singularStem = stripCommonPlurals(cleanLower).find(v => v !== cleanLower);

    const [inatTr, inatEn, gbifVern, inatTrStem] = await Promise.allSettled([
      fetchSafeJson<{ results?: any[] }>(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&taxon_id=1&locale=tr&per_page=15`, 'iNaturalist Autocomplete (TR)', 1, 6000),
      fetchSafeJson<{ results?: any[] }>(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(clean)}&taxon_id=1&locale=en&per_page=15`, 'iNaturalist Autocomplete (EN)', 1, 6000),
      fetchSafeJson<{ results?: any[] }>(`https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&q=${encodeURIComponent(clean)}&qField=VERNACULAR&status=ACCEPTED&limit=12`, 'GBIF Vernacular Higher Taxon Search', 1, 6000),
      singularStem
        ? fetchSafeJson<{ results?: any[] }>(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(singularStem)}&taxon_id=1&locale=tr&per_page=15`, 'iNaturalist Autocomplete Stem (TR)', 1, 6000)
        : Promise.resolve<SafeJsonParseResult<{ results?: any[] }>>({ ok: true, status: 200, data: { results: [] } }),
    ]);

    const inatTrOk = inatTr.status === 'fulfilled' && inatTr.value.ok && Array.isArray(inatTr.value.data?.results);
    const inatEnOk = inatEn.status === 'fulfilled' && inatEn.value.ok && Array.isArray(inatEn.value.data?.results);
    const gbifVernOk = gbifVern.status === 'fulfilled' && gbifVern.value.ok && Array.isArray(gbifVern.value.data?.results);
    const hasAnySourceError = !inatTrOk || !inatEnOk || !gbifVernOk;
    const firstSourceErrorMsg =
      (!inatTrOk && (inatTr.status === 'fulfilled' ? inatTr.value.errorMessage : inatTr.reason?.message)) ||
      (!inatEnOk && (inatEn.status === 'fulfilled' ? inatEn.value.errorMessage : inatEn.reason?.message)) ||
      (!gbifVernOk && (gbifVern.status === 'fulfilled' ? gbifVern.value.errorMessage : gbifVern.reason?.message)) ||
      undefined;

    const rawCandidates = new Map<string, { sci: string; rank: string; iconic: string; commonName?: string; score: number }>();

    const inatSourceEntries: Array<{ res: typeof inatTr; isTurkishLocale: boolean }> = [
      { res: inatTr, isTurkishLocale: true },
      { res: inatTrStem, isTurkishLocale: true },
      { res: inatEn, isTurkishLocale: false },
    ];

    for (const { res: src, isTurkishLocale } of inatSourceEntries) {
      if (src.status !== 'fulfilled' || !src.value.ok || !Array.isArray(src.value.data?.results)) continue;
      for (const t of src.value.data.results) {
        if (!t || !t.name || !t.rank) continue;
        const iconic = String(t.iconic_taxon_name || '').toLowerCase();
        if (!ANIMAL_INAT_ICONIC_TAXA.has(iconic)) continue;

        const rankLower = String(t.rank).toLowerCase();
        if (!['genus', 'subfamily', 'family', 'superfamily', 'order', 'infraorder', 'suborder', 'class', 'subclass', 'phylum', 'kingdom'].includes(rankLower)) {
          continue;
        }

        const prefScore = scoreHigherTaxonCommonMatch(t.preferred_common_name, clean);
        const engScore = scoreHigherTaxonCommonMatch(t.english_common_name, clean);
        const rawMatchedScore =
          t.matched_term && String(t.matched_term).toLowerCase() !== String(t.name).toLowerCase()
            ? scoreHigherTaxonCommonMatch(t.matched_term, clean)
            : 0;
        const matchedScore =
          prefScore > 0 || engScore > 0
            ? rawMatchedScore
            : foldTurkishChars(clean).length <= 2
              ? 0
              : Math.min(rawMatchedScore, 60);
        const bestNameScore = Math.max(prefScore, engScore, matchedScore);
        if (bestNameScore < 65) continue;

        const trPrefBonus =
          isTurkishLocale &&
          prefScore >= 90 &&
          t.preferred_common_name &&
          t.preferred_common_name !== t.english_common_name
            ? 8
            : 0;

        // Broad biological higher ranks (order/family/class) get a gentle structural bonus over narrow sub-ranks when name score ties
        const rankBonus = ['class', 'order', 'family'].includes(rankLower) ? 8 : rankLower === 'phylum' ? 4 : 0;
        const sciKey = String(t.name).toLowerCase();
        const obsBonus = Math.min(20, Math.log10(Math.max(1, Number(t.observations_count || 1))) * 3);
        const totalScore = bestNameScore + trPrefBonus + obsBonus + rankBonus;
        const existing = rawCandidates.get(sciKey);
        if (!existing || totalScore > existing.score) {
          rawCandidates.set(sciKey, {
            sci: t.name,
            rank: rankLower.toUpperCase(),
            iconic,
            commonName: t.preferred_common_name || t.english_common_name,
            score: totalScore,
          });
        }
      }
    }

    // Fallback: GBIF Backbone VERNACULAR üzerinden üst takson adayları (iNaturalist yetersiz kalırsa; soyu tükenmiş/fosil üst taksonları tercih etmez)
    if (rawCandidates.size === 0 && gbifVernOk && gbifVern.status === 'fulfilled' && Array.isArray(gbifVern.value.data?.results)) {
      const cleanFoldLen = foldTurkishChars(clean).length;
      for (const r of gbifVern.value.data.results) {
        if (!r || !r.canonicalName || !r.rank) continue;
        if (String(r.kingdom || '').toLowerCase() !== 'animalia') continue;
        if (r.extinct === true) continue;
        const rUpper = String(r.rank).toUpperCase();
        if (!HIGHER_TAXON_RANKS.has(rUpper)) continue;
        const vernList: Array<{ vernacularName?: string; language?: string }> = Array.isArray(r.vernacularNames) ? r.vernacularNames : [];
        let bestScore = 0;
        let matchedCommon = '';
        for (const v of vernList) {
          if (!v?.vernacularName || v.vernacularName.length > 55) continue;
          const lang = String(v.language || '').toLowerCase();
          const isAllowedLang = lang === 'tur' || lang === 'eng' || lang === 'tr' || lang === 'en';
          const sc = scoreHigherTaxonCommonMatch(v.vernacularName, clean);
          if (!isAllowedLang) {
            if (lang || cleanFoldLen < 4 || sc < 100) continue;
          }
          if (sc > bestScore) {
            bestScore = sc;
            matchedCommon = v.vernacularName;
          }
        }
        if (bestScore >= 75) {
          const sciKey = String(r.canonicalName).toLowerCase();
          if (!rawCandidates.has(sciKey)) {
            rawCandidates.set(sciKey, {
              sci: r.canonicalName,
              rank: rUpper,
              iconic: String(r.class || '').toLowerCase(),
              commonName: matchedCommon,
              score: bestScore,
            });
          }
        }
      }
    }

    const allCands = Array.from(rawCandidates.values()).sort((a, b) => b.score - a.score);
    // Eğer yüksek güvenli (>= 90 name+rank+obs -> ~105+) tam/çoğul eşleşme varsa, zayıf niteleyici gürültüsünü baskıla
    const topScore = allCands[0]?.score || 0;
    const filteredCands = allCands.filter(c => topScore < 105 || c.score >= topScore - 26).slice(0, 4);

    const primaryGroups: TaxonGroupCandidate[] = [];
    const unresolvedGroups: Array<{ scientificName: string; reason: string }> = [];
    let hasVerificationError = false;
    let lastVerificationError: string | undefined;

    if (filteredCands.length > 0) {
      const settled = await runWithConcurrencyLimit(filteredCands, DISCOVERY_CONCURRENCY_LIMIT, async (cand) => {
        const gbifExactRanks = new Set(['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY', 'GENUS']);
        const gbifRank = gbifExactRanks.has(cand.rank) ? cand.rank : undefined;
        const verified = await verifyHigherTaxonWithGbifBackbone(cand.sci, gbifRank);
        return { cand, verified };
      });

      const seenAccKeys = new Set<number>();
      for (const s of settled) {
        if (s.status !== 'fulfilled') {
          hasVerificationError = true;
          if (!lastVerificationError) {
            lastVerificationError = s.reason?.message || 'GBIF Backbone doğrulama isteği başarısız oldu.';
          }
          continue;
        }
        const { cand, verified } = s.value;
        if (verified.status === 'ERROR') {
          hasVerificationError = true;
          if (!lastVerificationError) {
            lastVerificationError = verified.errorMessage || verified.reason;
          }
        }
        if (!verified.verified || !verified.acceptedUsageKey) {
          unresolvedGroups.push({
            scientificName: cand.sci,
            reason: verified.reason || 'GBIF Backbone üzerinde doğrulanamadı.',
          });
          continue;
        }

        const verifiedRankUpper = String(verified.rank || '').toUpperCase();
        // iNaturalist ara basamağı (SUBORDER/SUBCLASS/SUPERFAMILY) GBIF Backbone'da mevcut olmayıp üst sınıfa (HIGHERRANK) düştüyse reddet
        if (
          !verified.synonymOf &&
          String(verified.matchType || '').toUpperCase() === 'HIGHERRANK' &&
          String(verified.canonicalName || '').toLowerCase() !== cand.sci.toLowerCase()
        ) {
          continue;
        }
        // iNaturalist ara basamağı GBIF'te yanlışlıkla bir GENUS homonimine düştüyse reddet
        if (cand.rank !== 'GENUS' && verifiedRankUpper === 'GENUS') {
          continue;
        }
        if (!isInatIconicCompatibleWithGbifClass(cand.iconic, verified.class, verified.kingdom)) {
          continue;
        }

        if (seenAccKeys.has(verified.acceptedUsageKey)) continue;
        seenAccKeys.add(verified.acceptedUsageKey);

        primaryGroups.push({
          id: `dyn-${verified.acceptedUsageKey}`,
          label: cand.commonName
            ? `${cand.commonName} (${verified.canonicalName || cand.sci})`
            : `${verified.canonicalName || cand.sci} (${translateTaxonRankTr(verifiedRankUpper)})`,
          scientificName: verified.canonicalName || cand.sci,
          usageKey: verified.usageKey,
          acceptedUsageKey: verified.acceptedUsageKey,
          taxonKeys: [verified.acceptedUsageKey],
          rank: verifiedRankUpper || cand.rank,
          taxonomicStatus: verified.taxonomicStatus || 'ACCEPTED',
          kingdom: verified.kingdom || 'Animalia',
          parentKey: verified.parentKey,
          turkishName: cand.commonName,
          dataSource: 'GBIF Backbone Taxonomy (Dinamik Takson Keşfi)',
          matchType: verified.matchType || 'EXACT',
          isVerified: true,
          canDrillDown: ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY'].includes(verifiedRankUpper),
        });
      }
    }

    // En güçlü birincil üst taksonu GBIF Backbone hiyerarşisi üzerinden gerçek biyolojik alt gruplarına ayır!
    let finalGroups: TaxonGroupCandidate[] = primaryGroups;
    let subgroupPagination: SubgroupPaginationMeta | undefined;
    if (primaryGroups.length > 0) {
      const primary = primaryGroups[0];
      const expandedRes = await expandTaxonCandidateToSubgroupsPaged(primary, { countryCode: cleanCountry });
      subgroupPagination = expandedRes.pagination;
      const seenKeys = new Set<number>();
      const merged: TaxonGroupCandidate[] = [];

      for (const g of expandedRes.groups) {
        const k = g.acceptedUsageKey || g.taxonKeys?.[0];
        if (k) seenKeys.add(k);
        merged.push(g);
      }
      for (const extra of primaryGroups.slice(1)) {
        const k = extra.acceptedUsageKey || extra.taxonKeys?.[0];
        if (k && seenKeys.has(k)) continue;
        if (k) seenKeys.add(k);
        merged.push(extra);
      }
      finalGroups = merged;
    }

    const hasPartialError = hasAnySourceError || hasVerificationError || Boolean(subgroupPagination?.hasError);
    const res = { groups: finalGroups, subgroupPagination, unresolvedGroups, hasPartialError };
    if (finalGroups.length === 0 && hasPartialError) {
      if (!inatTrOk && !inatEnOk && !gbifVernOk) {
        throw new Error(firstSourceErrorMsg || 'iNaturalist ve GBIF taksonomi servislerinden geçerli yanıt alınamadı.');
      }
      throw new Error(
        lastVerificationError ||
          firstSourceErrorMsg ||
          'Taksonomi keşif kaynaklarından birine geçici olarak erişilemedi.'
      );
    }
    if (!hasPartialError && !subgroupPagination?.hasMore) {
      setCached(cacheKey, res, 15 * 60 * 1000);
    }
    return res;
  });
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
 * Tüm Animalia alemi için genel hayvan gruplarını alt gruplarıyla dinamik olarak keşfeder;
 * spesifik tür adlarını ise doğrudan ilgili tür analizine yönlendirir.
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

  const cacheKey = `search-intent:v2:${toTrLower(normalizedInput)}:${cleanCountry || 'GLOBAL'}`;
  const cached = getCached<SearchIntentResult>(cacheKey);
  if (cached) return cached;

  // 1. Öncelik: Bilinen genel/polifiletik hayvan grubu profilleri (Tilki, Kurt, Ayı, Kartal, Geyik, Kaplumbağa, Kedi, Balina, Köpek balığı, Balık, Sürüngen, Yılan, Kertenkele, Baykuş, Yunus, Amfibi)
  //    Parantez içinde tek kelimelik üst takson varsa (ör. "Tilki (Vulpes)") grup profilini koru;
  //    parantez içinde binominal tür adı varsa (ör. "Tilki (Vulpes vulpes)", "Kızıl tilki (Vulpes vulpes)") tür aramasına devam et.
  const paren = extractParentheticalParts(normalizedInput);
  const hasExplicitBinomialInParens =
    paren.hasParentheses &&
    !paren.innerLooksLikeAuthority &&
    isScientificBinomialCandidate(paren.innerText);

  const directGroupProfile = lookupTaxonGroupProfile(normalizedInput);
  const parentheticalGroupProfile =
    !directGroupProfile &&
    paren.hasParentheses &&
    !paren.innerLooksLikeAuthority &&
    !isScientificBinomialCandidate(paren.innerText) &&
    paren.innerText.split(' ').filter(Boolean).length === 1 &&
    /^[a-zA-Z-]+$/.test(paren.innerText)
      ? lookupTaxonGroupProfile(paren.outerText)
      : null;
  const groupProfile = directGroupProfile || parentheticalGroupProfile;
  if (groupProfile) {
    const { groups, unresolvedGroups, hasApiError, apiErrorMessage } = await resolveProfileToTaxonGroups(groupProfile);
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
      if (!hasApiError) {
        setCached(cacheKey, intentRes, 15 * 60 * 1000);
      }
      return intentRes;
    }
    if (hasApiError) {
      throw new Error(apiErrorMessage || 'GBIF Backbone taksonomi doğrulama servisine erişilemedi.');
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
  const isGeneralGroupWord = !hasExplicitBinomialInParens && isGeneralGroupAliasQuery(normalizedInput);

  // 1.5. Genel grup kelimesi olmayan, bilinen spesifik yaygın adlar (ör. "At", "Eşek", "Zebra", "Aslan")
  //      GBIF Backbone'daki olası Latince cins/sinonim homonimlerinden (ör. Zebra -> Orthalicus) önce çözümlenir.
  if (!isGeneralGroupWord && Boolean(lookupCommonSpeciesEntry(normalizedInput))) {
    const speciesMatch = await matchSpecies(normalizedInput);
    if (speciesMatch.matchType === 'ERROR') {
      throw new Error(speciesMatch.summary || 'GBIF taksonomi doğrulama servisine erişilemedi.');
    }
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

  // 2. Tek kelimeli bilimsel üst takson sorgusu kontrolü (örn: Aves, Lepidoptera, Araneae, Coleoptera, Ursidae, Vulpes, Animalia)
  //    Cins/familya/takım/sınıf düzeyindeki eşleşmeler ASLA tek tür gibi döndürülmez; alt gruplarına ayrılır.
  if (words.length === 1 && /^[a-zA-Z-]+$/.test(words[0])) {
    const higherCheck = await verifyHigherTaxonWithGbifBackbone(
      words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase()
    );
    if (higherCheck.status === 'ERROR') {
      throw new Error(higherCheck.errorMessage || higherCheck.reason || 'GBIF Backbone taksonomi doğrulama servisine erişilemedi.');
    }
    if (
      higherCheck.verified &&
      higherCheck.acceptedUsageKey &&
      higherCheck.rank &&
      HIGHER_TAXON_RANKS.has(higherCheck.rank.toUpperCase())
    ) {
      const rankUpper = higherCheck.rank.toUpperCase();
      const baseTaxonGroup: TaxonGroupCandidate = {
        id: `taxon-${higherCheck.acceptedUsageKey}`,
        label: `${higherCheck.canonicalName || words[0]} (${translateTaxonRankTr(rankUpper)})`,
        scientificName: higherCheck.canonicalName || words[0],
        usageKey: higherCheck.usageKey,
        acceptedUsageKey: higherCheck.acceptedUsageKey,
        taxonKeys: [higherCheck.acceptedUsageKey],
        rank: rankUpper,
        taxonomicStatus: higherCheck.taxonomicStatus || 'ACCEPTED',
        kingdom: higherCheck.kingdom || 'Animalia',
        parentKey: higherCheck.parentKey,
        dataSource: 'GBIF Backbone Taxonomy',
        matchType: higherCheck.matchType || 'EXACT',
        isVerified: true,
        canDrillDown: ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY'].includes(rankUpper),
      };
      const expandedRes = await expandTaxonCandidateToSubgroupsPaged(baseTaxonGroup, { countryCode: cleanCountry });
      const intentRes: SearchIntentResult = {
        mode: 'TAXON_GROUP_DISCOVERY',
        query: normalizedInput,
        countryCode: cleanCountry,
        groups: expandedRes.groups,
        activeGroupId: expandedRes.groups[0].id,
        subgroupPagination: expandedRes.pagination,
      };
      if (!expandedRes.pagination.hasError && !expandedRes.pagination.hasMore) {
        setCached(cacheKey, intentRes, 15 * 60 * 1000);
      }
      return intentRes;
    }

    // Üst takson değilse, genel grup kelimesi değilse ve spesifik yaygın ad sözlüğünde varsa tekil tür olarak çöz
    if (!isGeneralGroupWord && Boolean(lookupCommonSpeciesEntry(normalizedInput))) {
      const speciesMatch = await matchSpecies(normalizedInput);
      if (speciesMatch.matchType === 'ERROR') {
        throw new Error(speciesMatch.summary || 'GBIF taksonomi doğrulama servisine erişilemedi.');
      }
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

  // 3. Spesifik çift/çok kelimeli yaygın ad veya binominal bilimsel ad kontrolü (Ursus arctos, Vulpes vulpes, Kızıl tilki (Vulpes vulpes), Bozayı, Su samuru, Caretta caretta)
  //    Önemli: Genel hayvan grubu kelimeleri (ör. "Baykuş", "Yunus", "Penguen", "Kuş", "Kelebek") burada tek türe yönlendirilmez.
  const commonSpecific = !isGeneralGroupWord ? lookupCommonSpeciesEntry(normalizedInput) : null;
  if (commonSpecific || hasExplicitBinomialInParens || (words.length >= 2 && !isGeneralGroupWord)) {
    const speciesMatch = await matchSpecies(normalizedInput);
    if (speciesMatch.matchType === 'ERROR') {
      throw new Error(speciesMatch.summary || 'GBIF taksonomi doğrulama servisine erişilemedi.');
    }
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
        const baseGroupCand: TaxonGroupCandidate = {
          id: `taxon-${speciesMatch.usageKey}`,
          label: `${speciesMatch.turkishName || speciesMatch.canonicalName} (${translateTaxonRankTr(rankUpper)})`,
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
          canDrillDown: ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY'].includes(rankUpper),
        };
        const expandedRes = await expandTaxonCandidateToSubgroupsPaged(baseGroupCand, { countryCode: cleanCountry });
        const groupRes: SearchIntentResult = {
          mode: 'TAXON_GROUP_DISCOVERY',
          query: normalizedInput,
          countryCode: cleanCountry,
          groups: expandedRes.groups,
          activeGroupId: expandedRes.groups[0].id,
          subgroupPagination: expandedRes.pagination,
        };
        if (!expandedRes.pagination.hasError && !expandedRes.pagination.hasMore) {
          setCached(cacheKey, groupRes, 15 * 60 * 1000);
        }
        return groupRes;
      }
    }
  }

  // 4. Tüm Animalia alemi için dinamik üst-takson ve alt-grup keşfi (örn. Kuş, Kelebek, Örümcek, Papağan, Penguen, Yusufçuk, Karınca, Yarasa, Ahtapot...)
  const dynamicGroups = await resolveDynamicHigherTaxonGroups(normalizedInput, cleanCountry);
  if (dynamicGroups.groups.length > 0) {
    const dynRes: SearchIntentResult = {
      mode: 'TAXON_GROUP_DISCOVERY',
      query: normalizedInput,
      countryCode: cleanCountry,
      groups: dynamicGroups.groups,
      activeGroupId: dynamicGroups.groups[0].id,
      subgroupPagination: dynamicGroups.subgroupPagination,
      unresolvedGroups: dynamicGroups.unresolvedGroups.length > 0 ? dynamicGroups.unresolvedGroups : undefined,
    };
    if (!dynamicGroups.hasPartialError && !dynamicGroups.subgroupPagination?.hasMore) {
      setCached(cacheKey, dynRes, 15 * 60 * 1000);
    }
    return dynRes;
  }

  // 5. Son tekil tür doğrulama denemesi (matchSpecies tüm Animalia koruma kurallarını uygular)
  const fallbackMatch = await matchSpecies(normalizedInput);
  if (fallbackMatch.matchType === 'ERROR') {
    throw new Error(fallbackMatch.summary || 'GBIF taksonomi doğrulama servisine erişilemedi.');
  }
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

const GBIF_SPECIES_SEARCH_MAX_OFFSET = 100000;

interface BackboneTaxonCursor {
  htKey: number;
  nextOffset: number;
  endOfRecords: boolean;
  apiTotalCount: number | null;
  hitOffsetLimit?: boolean;
  consecutiveFailures?: number;
}

interface BackboneCatalogPoolState {
  taxonCursors: BackboneTaxonCursor[];
  cursorRoundRobinIndex: number;
  rawCandidates: any[];
  rawSeenKeys: Set<number>;
  nextRawCandidateIndex: number;
  allowedResolved: boolean;
  verifiedItems: DiscoveredSpeciesItem[];
  seenAcceptedKeys: Set<number>;
  seenCanonicalNames: Set<string>;
  uncertainOrHistoricalCount: number;
  filteredFossilCount: number;
  filteredOutOfGroupCount: number;
  hitOffsetLimit: boolean;
  serverErrorReached: boolean;
  catalogErrorMessage?: string;
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

const AUTHORITATIVE_LIVING_CHECKLISTS = new Set([
  '7ddf754f-d193-4cc9-b351-99906754a03b', // Catalogue of Life
  '47f16512-bf31-410f-b272-d151c996b2f6', // The Clements Checklist
]);

const GEOLOGICAL_PERIOD_PATTERN = /\b(\d+(?:\.\d+)?\s*(?:to|-)\s*\d+(?:\.\d+)?\s*ma|ma|ka|pleistocene|pliocene|miocene|oligocene|eocene|paleocene|cretaceous|jurassic|triassic)\b/i;

async function fetchSpeciesDetailCached(speciesKey: number): Promise<any | null> {
  const spCacheKey = `gbif-species-detail:v1:${speciesKey}`;
  const cached = getCached<any>(spCacheKey);
  if (cached) return cached;
  return runDedupedInFlight(spCacheKey, async () => {
    const parsed = await fetchSafeJson<any>(`https://api.gbif.org/v1/species/${speciesKey}`, 'GBIF Species Detail API', 1, 7000);
    if (!parsed.ok || !parsed.data) return null;
    setCached(spCacheKey, parsed.data, 30 * 60 * 1000);
    return parsed.data;
  });
}

async function resolveCanonicalSpeciesTarget(
  targetCanonical: string
): Promise<any | null> {
  const clean = normalizeSearchQuery(targetCanonical);
  if (!clean) return null;
  const cacheKey = `gbif-canonical-target:v1:${clean.toLowerCase()}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return cached;
  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    try {
      const parsed = await fetchSafeJson<any>(
        `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(clean)}&kingdom=Animalia&rank=SPECIES&strict=true`,
        'GBIF Canonical Target Match API',
        1,
        6000
      );
      if (!parsed.ok || !parsed.data) return null;
      const m = parsed.data;
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
  });
}

interface EvidenceBasisEntry {
  fossilTotal: number;
  liveObs: number;
  ok: boolean;
}

async function batchFetchEvidenceBasisCounts(
  speciesKeys: number[]
): Promise<Map<number, EvidenceBasisEntry>> {
  const result = new Map<number, EvidenceBasisEntry>();
  const uniqueKeys = Array.from(
    new Set(speciesKeys.filter((k): k is number => Number.isInteger(k) && k > 0))
  ).sort((a, b) => a - b);

  if (uniqueKeys.length === 0) return result;

  const missingKeys: number[] = [];
  for (const k of uniqueKeys) {
    const cached = getCached<EvidenceBasisEntry>(`evidence-basis:v1:${k}`);
    if (cached && cached.ok) {
      result.set(k, cached);
    } else {
      missingKeys.push(k);
    }
  }

  if (missingKeys.length === 0) return result;

  const chunks: number[][] = [];
  for (let i = 0; i < missingKeys.length; i += 40) {
    chunks.push(missingKeys.slice(i, i + 40));
  }

  await runWithConcurrencyLimit(chunks, 2, async (chunkKeys) => {
    const keyParams = chunkKeys.map(k => `speciesKey=${k}`).join('&');
    const facetLimit = Math.max(50, chunkKeys.length + 15);
    const fossilUrl = `https://api.gbif.org/v1/occurrence/search?${keyParams}&basisOfRecord=FOSSIL_SPECIMEN&limit=0&facet=speciesKey&facetLimit=${facetLimit}`;
    const liveUrl = `https://api.gbif.org/v1/occurrence/search?${keyParams}&basisOfRecord=HUMAN_OBSERVATION&basisOfRecord=OBSERVATION&basisOfRecord=MACHINE_OBSERVATION&limit=0&facet=speciesKey&facetLimit=${facetLimit}`;

    const [fossilParsed, liveParsed] = await Promise.all([
      fetchSafeJson<any>(fossilUrl, 'GBIF Fossil Evidence Batch API', 1, 7500),
      fetchSafeJson<any>(liveUrl, 'GBIF Live Evidence Batch API', 1, 7500),
    ]);

    const extractFacetMap = (parsed: SafeJsonParseResult<any>): { ok: boolean; map: Map<number, number> } => {
      const map = new Map<number, number>();
      if (!parsed.ok || !parsed.data || !Array.isArray(parsed.data.facets)) {
        return { ok: false, map };
      }
      const spFacet = parsed.data.facets.find(
        (f: any) => f && (f.field === 'speciesKey' || f.field === 'SPECIES_KEY')
      );
      if (!spFacet || !Array.isArray(spFacet.counts)) {
        return { ok: false, map };
      }
      for (const rc of spFacet.counts) {
        const k = Number(rc?.name);
        const cnt = typeof rc?.count === 'number' ? rc.count : 0;
        if (Number.isInteger(k) && k > 0) map.set(k, cnt);
      }
      return { ok: true, map };
    };

    const fossilFacet = extractFacetMap(fossilParsed);
    const liveFacet = extractFacetMap(liveParsed);
    const bothOk = fossilFacet.ok && liveFacet.ok;

    for (const k of chunkKeys) {
      const entry: EvidenceBasisEntry = {
        fossilTotal: fossilFacet.map.get(k) ?? 0,
        liveObs: liveFacet.map.get(k) ?? 0,
        ok: bothOk,
      };
      result.set(k, entry);
      if (bothOk) {
        setCached(`evidence-basis:v1:${k}`, entry, 30 * 60 * 1000);
      }
    }
  });

  return result;
}

async function evaluateSpeciesEvidence(
  resolvedSp: any,
  localSciEntry: CommonSpeciesEntry | undefined,
  preloadedBasis?: EvidenceBasisEntry
): Promise<SpeciesEvidenceSummary> {
  const key = Number(resolvedSp.key);
  const evidenceCacheKey = `gbif-species-evidence:v5:${key}`;
  const cached = getCached<SpeciesEvidenceSummary>(evidenceCacheKey);
  if (cached) return cached;

  return runDedupedInFlight(evidenceCacheKey, async () => {
    const isAuthoritativeLivingChecklist = AUTHORITATIVE_LIVING_CHECKLISTS.has(
      String(resolvedSp.constituentKey || '')
    );
    const inlineVern = extractVernacularsFromSearchItem(resolvedSp);
    const gbifInlineTr = inlineVern.trName;
    const gbifInlineEn = inlineVern.enName;
    const hasInlineVernacular = Boolean(localSciEntry || gbifInlineTr || gbifInlineEn);

    // Hızlı Yol 1: GBIF Backbone doğrudan soyu tükenmiş (extinct=true) olarak işaretlemişse ek API çağrısı yapma
    if (resolvedSp.extinct === true) {
      const extinctSummary: SpeciesEvidenceSummary = {
        existenceStatus: 'FOSSIL_OR_EXTINCT',
        existenceEvidence: 'GBIF Backbone üzerinde soyu tükenmiş (extinct=true) olarak işaretli',
        isFossilOnly: true,
        gbifTurkishName: gbifInlineTr,
        gbifEnglishName: gbifInlineEn,
        hasVernacularName: hasInlineVernacular,
        isAuthoritativeLivingChecklist,
        hasLivingProfile: false,
      };
      setCached(evidenceCacheKey, extinctSummary, 30 * 60 * 1000);
      return extinctSummary;
    }

    // Hızlı Yol 2: GBIF Backbone yaşayan tür (extinct=false) olarak doğrulamışsa per-species profil/gözlem isteği atma
    if (resolvedSp.extinct === false) {
      const reasons: string[] = ['GBIF extinct=false yaşam kaydı'];
      if (localSciEntry) reasons.push('doğrulanmış tür envanteri');
      if (hasInlineVernacular) reasons.push('yaygın ad doğrulaması');
      if (isAuthoritativeLivingChecklist) reasons.push('Catalogue of Life / Clements');

      const livingSummary: SpeciesEvidenceSummary = {
        existenceStatus: 'LIVING',
        existenceEvidence: `Yaşayan tür (${reasons.join(', ')})`,
        isFossilOnly: false,
        gbifTurkishName: gbifInlineTr,
        gbifEnglishName: gbifInlineEn,
        hasVernacularName: hasInlineVernacular,
        isAuthoritativeLivingChecklist,
        hasLivingProfile: true,
      };
      setCached(evidenceCacheKey, livingSummary, 30 * 60 * 1000);
      return livingSummary;
    }

    // extinct === undefined ise toplu (batch) gözlem kanıtını kullan; yalnızca belirsiz/sınır vakalarda speciesProfiles / vernacularNames sor
    let basisEntry = preloadedBasis;
    if (!basisEntry) {
      const singleBatch = await batchFetchEvidenceBasisCounts([key]);
      basisEntry = singleBatch.get(key) ?? { fossilTotal: 0, liveObs: 0, ok: false };
    }

    const fossilTotal = basisEntry.fossilTotal;
    const liveObs = basisEntry.liveObs;
    const basisOk = basisEntry.ok;

    const needsProfileCheck = liveObs < 3 || fossilTotal > 0;
    const needsVernacularRequest =
      !hasInlineVernacular &&
      liveObs >= 1 &&
      liveObs < 3 &&
      fossilTotal === 0 &&
      !isAuthoritativeLivingChecklist;

    const [profilesRes, vernRes] = await Promise.allSettled([
      needsProfileCheck
        ? fetchSafeJson<{ results?: any[] }>(`https://api.gbif.org/v1/species/${key}/speciesProfiles`, 'GBIF SpeciesProfiles API', 1, 6000)
        : Promise.resolve<SafeJsonParseResult<{ results?: any[] }>>({ ok: true, status: 200, data: { results: [] } }),
      needsVernacularRequest
        ? fetchSafeJson<{ results?: any[] }>(`https://api.gbif.org/v1/species/${key}/vernacularNames?limit=30`, 'GBIF VernacularNames API', 1, 6000)
        : Promise.resolve<SafeJsonParseResult<{ results?: any[] }>>({ ok: true, status: 200, data: { results: [] } }),
    ]);

    const profilesOk = !needsProfileCheck || (profilesRes.status === 'fulfilled' && profilesRes.value.ok);
    const profiles: any[] =
      profilesRes.status === 'fulfilled' && profilesRes.value.ok && Array.isArray(profilesRes.value.data?.results)
        ? profilesRes.value.data.results
        : [];
    const vernResults: any[] =
      vernRes.status === 'fulfilled' && vernRes.value.ok && Array.isArray(vernRes.value.data?.results)
        ? vernRes.value.data.results
        : [];

    const gbifTurkishName =
      gbifInlineTr ||
      vernResults.find(x => x?.language === 'tur' && x?.preferred)?.vernacularName ||
      vernResults.find(x => x?.language === 'tur')?.vernacularName ||
      undefined;
    const gbifEnglishName =
      gbifInlineEn ||
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

    const hasLivingLocalInventory = Boolean(
      localSciEntry && !['EX', 'EW'].includes((localSciEntry.iucn || '').toUpperCase())
    );

    let existenceStatus: SpeciesExistenceStatus;
    let existenceEvidence: string;
    let isFossilOnly = false;

    if (hasExtinctProfile) {
      existenceStatus = 'FOSSIL_OR_EXTINCT';
      isFossilOnly = true;
      existenceEvidence = pbdbGeologicalProfile?.livingPeriod
        ? `GBIF speciesProfiles soyu tükenmiş / fosil kaydı (${pbdbGeologicalProfile.livingPeriod})`
        : 'GBIF speciesProfiles üzerinde soyu tükenmiş (extinct=true) olarak işaretli';
    } else if (pbdbGeologicalProfile && !hasLivingProfile) {
      existenceStatus = 'FOSSIL_OR_EXTINCT';
      isFossilOnly = true;
      existenceEvidence = `Paleobiology Database jeolojik dönem kaydı (${pbdbGeologicalProfile.livingPeriod || 'fosil takson'})`;
    } else if (fossilTotal >= 5 && fossilTotal >= liveObs * 3 && !hasLivingProfile) {
      existenceStatus = 'FOSSIL_OR_EXTINCT';
      isFossilOnly = true;
      existenceEvidence = `Fosil kayıtları baskın (${fossilTotal} FOSSIL_SPECIMEN, ${liveObs} canlı gözlem; yaşayan tür profili yok)`;
    } else if (
      hasLivingProfile ||
      (hasLivingLocalInventory && fossilTotal === 0) ||
      (liveObs >= 3 && fossilTotal === 0) ||
      (liveObs >= 1 && (hasVernacularName || isAuthoritativeLivingChecklist) && fossilTotal === 0)
    ) {
      existenceStatus = 'LIVING';
      const reasons: string[] = [];
      if (hasLivingProfile) reasons.push('GBIF extinct=false yaşam kaydı');
      if (liveObs > 0) reasons.push(`${liveObs.toLocaleString('tr-TR')} canlı gözlem`);
      if (hasLivingLocalInventory) reasons.push('doğrulanmış tür envanteri');
      if (hasVernacularName) reasons.push('yaygın ad doğrulaması');
      if (isAuthoritativeLivingChecklist && (hasLivingProfile || liveObs > 0)) {
        reasons.push('Catalogue of Life / Clements');
      }
      existenceEvidence = `Yaşayan tür (${reasons.join(', ')})`;
    } else {
      existenceStatus = 'HISTORICAL_OR_UNCERTAIN';
      existenceEvidence =
        fossilTotal > 0
          ? `Sınırlı fosil (${fossilTotal}) ve yetersiz canlı gözlem (${liveObs}) kaydı; güncel yaşayan profil doğrulaması yok`
          : isAuthoritativeLivingChecklist
            ? `Catalogue of Life / Clements kaydı var ancak GBIF'te extinct=false veya güncel canlı gözlem (${liveObs}) kanıtı bulunamadı; durumu tarihsel/belirsiz`
            : `Yaşayan tür profili (extinct=false) ve canlı gözlem (${liveObs}) kanıtı eksik; tarihsel/belirsiz kayıt`;
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
    if (profilesOk && basisOk) {
      setCached(evidenceCacheKey, summary, 30 * 60 * 1000);
    }
    return summary;
  });
}

async function fetchExcludedSubspeciesCount(
  taxonKeys: number[],
  countryParam: string,
  nonFossilBasisParam: string
): Promise<{ status: OccurrenceCountStatus; count: number }> {
  if (!taxonKeys || taxonKeys.length === 0) return { status: 'OK', count: 0 };
  const cacheKey = `discover-excl-sub:v2:${taxonKeys.join(',')}:${countryParam}:${nonFossilBasisParam ? 1 : 0}`;
  const cached = getCached<{ status: OccurrenceCountStatus; count: number }>(cacheKey);
  if (cached !== null) return cached;

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    const primarySubKey = taxonKeys[0];
    try {
      const parsed = await fetchSafeJson<{ count?: number }>(
        `https://api.gbif.org/v1/occurrence/search?taxonKey=${primarySubKey}${countryParam}${nonFossilBasisParam}&limit=0`,
        'GBIF Excluded Subspecies Count API',
        1,
        6000
      );
      if (parsed.ok && typeof parsed.data?.count === 'number' && Number.isFinite(parsed.data.count) && parsed.data.count >= 0) {
        const okRes: { status: OccurrenceCountStatus; count: number } = { status: 'OK', count: parsed.data.count };
        setCached(cacheKey, okRes, 15 * 60 * 1000);
        return okRes;
      }
    } catch {
      // ignore, return ERROR below without caching
    }
    return { status: 'ERROR', count: 0 };
  });
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

  const isDynamicDiscoveryGroup = !activeGroup.allowedCanonicalNames && !activeGroup.genusBiologicalLabels;
  if (
    evidence.existenceStatus === 'LIVING' &&
    (isDynamicDiscoveryGroup || evidence.hasVernacularName || evidence.isAuthoritativeLivingChecklist || Boolean(specificLabel))
  ) {
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

export interface BatchOccurrenceCountsResult {
  counts: Map<number, number>;
  keyStatuses: Map<number, OccurrenceCountStatus>;
  hasErrors: boolean;
  errorReason?: string;
}

const BATCH_OCCURRENCE_CHUNK_SIZE = 40;

export async function fetchBatchOccurrenceCounts(
  speciesKeys: number[],
  countryCode: string,
  nonFossilBasisParam: string
): Promise<BatchOccurrenceCountsResult> {
  const counts = new Map<number, number>();
  const keyStatuses = new Map<number, OccurrenceCountStatus>();
  const uniqueSortedKeys = Array.from(
    new Set(speciesKeys.filter((k): k is number => Number.isInteger(k) && k > 0))
  ).sort((a, b) => a - b);

  if (uniqueSortedKeys.length === 0) {
    return { counts, keyStatuses, hasErrors: false };
  }

  const countryParam = countryCode ? `&country=${encodeURIComponent(countryCode)}` : '';
  const chunks: number[][] = [];
  for (let i = 0; i < uniqueSortedKeys.length; i += BATCH_OCCURRENCE_CHUNK_SIZE) {
    chunks.push(uniqueSortedKeys.slice(i, i + BATCH_OCCURRENCE_CHUNK_SIZE));
  }

  let hasErrors = false;
  let errorReason: string | undefined;

  await runWithConcurrencyLimit(chunks, 2, async (chunkKeys) => {
    const chunkCacheKey = `occ-batch:v3:${chunkKeys.join(',')}:${countryCode || 'GLOBAL'}:${nonFossilBasisParam ? 1 : 0}`;
    const cachedChunk = getCached<Array<[number, number]>>(chunkCacheKey);
    if (cachedChunk) {
      const cachedMap = new Map(cachedChunk);
      for (const k of chunkKeys) {
        counts.set(k, cachedMap.get(k) ?? 0);
        keyStatuses.set(k, 'OK');
      }
      return;
    }

    const chunkOutcome = await runDedupedInFlight(`in-flight:${chunkCacheKey}`, async () => {
      const keyParams = chunkKeys.map(k => `speciesKey=${k}`).join('&');
      const facetLimit = Math.max(50, chunkKeys.length + 15);
      const url = `https://api.gbif.org/v1/occurrence/search?${keyParams}${countryParam}${nonFossilBasisParam}&limit=0&facet=speciesKey&facetLimit=${facetLimit}`;

      try {
        const parsed = await fetchSafeJson<Record<string, any>>(url, 'GBIF occurrence API', 2, 8000);
        if (!parsed.ok || !parsed.data) {
          return { ok: false as const, reason: parsed.errorMessage || `GBIF occurrence API HTTP ${parsed.status}` };
        }
        const json = parsed.data;
        if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.facets)) {
          return { ok: false as const, reason: 'GBIF occurrence yanıtında beklenen facets alanı bulunamadı' };
        }

        const speciesFacet = json.facets.find(
          (f: any) => f && typeof f === 'object' && (f.field === 'speciesKey' || f.field === 'SPECIES_KEY')
        );
        if (!speciesFacet || !Array.isArray(speciesFacet.counts)) {
          return { ok: false as const, reason: 'GBIF occurrence yanıtında speciesKey facet verisi eksik veya geçersiz' };
        }

        if (typeof json.count === 'number' && json.count > 0 && speciesFacet.counts.length === 0) {
          return { ok: false as const, reason: 'GBIF occurrence toplam sayısı pozitif ancak speciesKey facet dökümü boş döndü' };
        }

        const chunkMap = new Map<number, number>();
        for (const rc of speciesFacet.counts) {
          if (
            !rc ||
            typeof rc !== 'object' ||
            rc.name === undefined ||
            rc.name === null ||
            typeof rc.count !== 'number' ||
            !Number.isFinite(rc.count) ||
            rc.count < 0
          ) {
            return { ok: false as const, reason: 'GBIF speciesKey facet öğeleri beklenen biçimde değil' };
          }
          const k = Number(rc.name);
          if (!Number.isInteger(k) || k <= 0) {
            return { ok: false as const, reason: 'GBIF speciesKey facet öğeleri beklenen biçimde değil' };
          }
          chunkMap.set(k, rc.count);
        }

        setCached(chunkCacheKey, Array.from(chunkMap.entries()), 15 * 60 * 1000);
        return { ok: true as const, chunkMap };
      } catch (err: any) {
        return { ok: false as const, reason: err?.message || 'GBIF occurrence servisine bağlanılamadı' };
      }
    });

    if (!chunkOutcome.ok) {
      hasErrors = true;
      errorReason = chunkOutcome.reason;
      for (const k of chunkKeys) {
        keyStatuses.set(k, 'ERROR');
      }
    } else {
      for (const k of chunkKeys) {
        counts.set(k, chunkOutcome.chunkMap.get(k) ?? 0);
        keyStatuses.set(k, 'OK');
      }
    }
  });

  return { counts, keyStatuses, hasErrors, errorReason };
}

export interface ScopeOccurrenceResult {
  status: OccurrenceCountStatus;
  count: number | null;
  errorMessage?: string;
}

export async function fetchScopeTotalOccurrences(
  taxonKeys: number[],
  countryCode: string,
  nonFossilBasisParam: string
): Promise<ScopeOccurrenceResult> {
  if (taxonKeys.length === 0) {
    return {
      status: 'ERROR',
      count: null,
      errorMessage: 'Kapsam gözlem sayısı için geçerli takson anahtarı bulunamadı.',
    };
  }
  const cacheKey = `scope-total-occ:v2:${taxonKeys.join(',')}:${countryCode || 'GLOBAL'}:${nonFossilBasisParam ? 1 : 0}`;
  const cached = getCached<ScopeOccurrenceResult>(cacheKey);
  if (cached !== null) return cached;

  return runDedupedInFlight(`in-flight:${cacheKey}`, async () => {
    const taxonQueryParams = taxonKeys.map(k => `taxonKey=${k}`).join('&');
    const countryParam = countryCode ? `&country=${encodeURIComponent(countryCode)}` : '';
    const url = `https://api.gbif.org/v1/occurrence/search?${taxonQueryParams}${countryParam}${nonFossilBasisParam}&limit=0`;

    try {
      const parsed = await fetchSafeJson<{ count?: number }>(url, 'GBIF Scope Occurrence Count API', 2, 7000);
      if (
        parsed.ok &&
        parsed.data &&
        typeof parsed.data.count === 'number' &&
        Number.isFinite(parsed.data.count) &&
        parsed.data.count >= 0
      ) {
        const result: ScopeOccurrenceResult = {
          status: 'OK',
          count: parsed.data.count,
        };
        setCached(cacheKey, result, 15 * 60 * 1000);
        return result;
      }
      return {
        status: 'ERROR',
        count: null,
        errorMessage: parsed.errorMessage || 'GBIF kapsam gözlem sayısı servisi geçersiz veya eksik count alanı döndürdü.',
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        count: null,
        errorMessage: err?.message || 'GBIF kapsam gözlem sayısı servisine bağlanılamadı.',
      };
    }
  });
}

/**
 * Bir veya birden fazla doğrulanmış GBIF üst taksonundan gerçek SPECIES kayıtlarını
 * doğrudan GBIF Backbone taksonomisi üzerinden keşfeder (gözlem kayıtlarından bağımsız).
 * Sinonimleri acceptedUsageKey üzerinden tekilleştirir, fosil/belirsiz türleri ayırır
 * ve seçilen ülke/Global kapsamı için gözlem sayılarını ayrıca zenginleştirir.
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

  const verifiedGroups = groups.filter(
    g => g.isVerified && ((g.taxonKeys && g.taxonKeys.length > 0) || g.acceptedUsageKey || g.usageKey)
  );
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
      totalOccurrencesInScope: null,
      totalOccurrencesStatus: 'ERROR',
      totalOccurrencesError: 'Doğrulanmış bir taksonomik grup bulunamadığı için kapsam gözlem sayısı sorgulanamadı.',
      pagination: {
        page,
        pageSize,
        totalDiscovered: 0,
        backboneTotalCount: 0,
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

  const discoveryCacheKey = `discover-bb:v2:${activeTaxonKeys.join(',')}:${activeGroup.id}:${countryCode || 'GLOBAL'}:p${page}:s${pageSize}:f${includeFossilOnly ? 1 : 0}:u${includeUncertainTaxa ? 1 : 0}:i${enrichWithInaturalist ? 1 : 0}`;
  const cachedResult = getCached<SpeciesDiscoveryResult>(discoveryCacheKey);
  if (cachedResult) return cachedResult;

  return runDedupedInFlight(`in-flight:${discoveryCacheKey}`, async () => {
    const excludedSciSet = new Set(
      (activeGroup.excludedScientificNames || []).map(n => n.toLowerCase())
    );
    const excludedTaxonomySet = new Set(
      (activeGroup.excludedOrderNames || []).map(n => n.toLowerCase())
    );

    // ÜLKEDEN VE GÖZLEM SAYILARINDAN TAMAMEN BAĞIMSIZ GBIF BACKBONE KATALOG HAVUZU
    const backbonePoolCacheKey = `discover-bb-pool:v3:${activeTaxonKeys.join(',')}:${activeGroup.id}:f${includeFossilOnly ? 1 : 0}:u${includeUncertainTaxa ? 1 : 0}`;
    const cachedPool = getCached<BackboneCatalogPoolState>(backbonePoolCacheKey);
    let pool: BackboneCatalogPoolState = cachedPool
      ? {
          ...cachedPool,
          taxonCursors: cachedPool.taxonCursors.map(c => ({ ...c })),
          rawCandidates: [...cachedPool.rawCandidates],
          rawSeenKeys: new Set(cachedPool.rawSeenKeys),
          verifiedItems: [...cachedPool.verifiedItems],
          seenAcceptedKeys: new Set(cachedPool.seenAcceptedKeys),
          seenCanonicalNames: new Set(cachedPool.seenCanonicalNames),
        }
      : {
          taxonCursors: activeTaxonKeys.map(htKey => ({
            htKey,
            nextOffset: 0,
            endOfRecords: false,
            apiTotalCount: null,
            hitOffsetLimit: false,
            consecutiveFailures: 0,
          })),
          cursorRoundRobinIndex: 0,
          rawCandidates: [],
          rawSeenKeys: new Set<number>(),
          nextRawCandidateIndex: 0,
          allowedResolved: false,
          verifiedItems: [],
          seenAcceptedKeys: new Set<number>(),
          seenCanonicalNames: new Set<string>(),
          uncertainOrHistoricalCount: 0,
          filteredFossilCount: 0,
          filteredOutOfGroupCount: 0,
          hitOffsetLimit: false,
          serverErrorReached: false,
          catalogErrorMessage: undefined,
        };

    const targetStartIdx = (page - 1) * pageSize;
    const targetEndIdx = targetStartIdx + pageSize;

    const processCandidateRecords = async (records: any[]): Promise<DiscoveredSpeciesItem[]> => {
      // Adım 1: Sinonim / alt-tür çözümlerini ve erken grup filtrelemesini yap
      const preparedSettled = await runWithConcurrencyLimit(
        records,
        DISCOVERY_CONCURRENCY_LIMIT,
        async (rawCandidate) => {
          if (!rawCandidate) return null;

          if (!includeFossilOnly && rawCandidate.extinct === true) {
            return { kind: 'EARLY' as const, earlyFiltered: 'FOSSIL' as const };
          }

          let resolvedSp = rawCandidate;
          let synonymOf: string | undefined = rawCandidate._synonymOf;

          if (resolvedSp.taxonomicStatus === 'SYNONYM' && resolvedSp.acceptedKey) {
            synonymOf = synonymOf || resolvedSp.canonicalName || resolvedSp.scientificName;
            const accSp = await fetchSpeciesDetailCached(Number(resolvedSp.acceptedKey));
            if (accSp?.key) resolvedSp = accSp;
          }

          if (resolvedSp.rank && String(resolvedSp.rank).toUpperCase() !== 'SPECIES' && resolvedSp.speciesKey && resolvedSp.speciesKey !== resolvedSp.key) {
            const parentSp = await fetchSpeciesDetailCached(Number(resolvedSp.speciesKey));
            if (parentSp?.key) resolvedSp = parentSp;
          }

          if (!resolvedSp?.key) return null;
          if (String(resolvedSp.kingdom || '').toLowerCase() !== 'animalia') return null;
          if (String(resolvedSp.rank || '').toUpperCase() !== 'SPECIES') return null;
          if (resolvedSp.taxonomicStatus && resolvedSp.taxonomicStatus !== 'ACCEPTED') return null;

          let canonical = String(resolvedSp.canonicalName || resolvedSp.scientificName || '').trim();
          let canonicalLower = canonical.toLowerCase();

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

          const genusLower = String(resolvedSp.genus || canonicalLower.split(' ')[0] || '').toLowerCase();
          const orderLower = String(resolvedSp.order || '').toLowerCase();
          const familyLower = String(resolvedSp.family || '').toLowerCase();
          const classLower = String(resolvedSp.class || '').toLowerCase();
          if (
            excludedSciSet.has(canonicalLower) ||
            (orderLower && excludedTaxonomySet.has(orderLower)) ||
            (familyLower && excludedTaxonomySet.has(familyLower)) ||
            (genusLower && excludedTaxonomySet.has(genusLower)) ||
            (classLower && excludedTaxonomySet.has(classLower)) ||
            (DOMESTIC_CANONICAL_NAMES.has(canonicalLower) && activeGroup.allowDomestic === false)
          ) {
            return { kind: 'EARLY' as const, earlyFiltered: 'EXCLUDED' as const };
          }

          const localSciEntry = BILINGUAL_SPECIES_ENTRIES.find(
            e => e.entry.scientificName.toLowerCase() === canonicalLower
          )?.entry;

          return {
            kind: 'CANDIDATE' as const,
            resolvedSp,
            canonical,
            canonicalLower,
            synonymOf,
            localSciEntry,
          };
        }
      );

      // Adım 2: Yalnızca extinct alanı undefined olan türler için kanıt gözlemlerini TEK/İKİ toplu batch sorguda çek
      const unresolvedExtinctKeys: number[] = [];
      for (const p of preparedSettled) {
        if (p.status !== 'fulfilled' || !p.value || p.value.kind !== 'CANDIDATE') continue;
        const sp = p.value.resolvedSp;
        const spKey = Number(sp.key);
        if (
          sp.extinct === undefined &&
          !getCached<SpeciesEvidenceSummary>(`gbif-species-evidence:v5:${spKey}`)
        ) {
          unresolvedExtinctKeys.push(spKey);
        }
      }

      const preloadedBasisMap =
        unresolvedExtinctKeys.length > 0
          ? await batchFetchEvidenceBasisCounts(unresolvedExtinctKeys)
          : new Map<number, EvidenceBasisEntry>();

      // Adım 3: Yaşam kanıtı ve biyolojik üyelik değerlendirmesi
      const batchSettled = await runWithConcurrencyLimit(
        preparedSettled,
        DISCOVERY_CONCURRENCY_LIMIT,
        async (p) => {
          if (p.status !== 'fulfilled' || !p.value) return null;
          if (p.value.kind === 'EARLY') return p.value;

          const { resolvedSp, canonical, canonicalLower, synonymOf, localSciEntry } = p.value;
          const spKey = Number(resolvedSp.key);
          const evidence = await evaluateSpeciesEvidence(
            resolvedSp,
            localSciEntry,
            preloadedBasisMap.get(spKey)
          );
          const membership = evaluateBiologicalMembership(
            resolvedSp,
            canonicalLower,
            activeGroup,
            evidence,
            excludedSciSet,
            excludedTaxonomySet
          );

          return {
            kind: 'VERIFIED' as const,
            resolvedSp,
            canonical,
            canonicalLower,
            synonymOf,
            localSciEntry,
            evidence,
            membership,
          };
        }
      );

    const acceptedItems: DiscoveredSpeciesItem[] = [];

    for (const s of batchSettled) {
      if (s.status !== 'fulfilled' || !s.value) continue;
      if (s.value.kind === 'EARLY') {
        if (s.value.earlyFiltered === 'FOSSIL') pool.filteredFossilCount++;
        else pool.filteredOutOfGroupCount++;
        continue;
      }

      const {
        resolvedSp,
        canonical,
        canonicalLower,
        synonymOf,
        localSciEntry,
        evidence,
        membership,
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

      const acceptedKey = Number(resolvedSp.acceptedKey || resolvedSp.key);
      if (pool.seenAcceptedKeys.has(acceptedKey) || pool.seenCanonicalNames.has(canonicalLower)) {
        const existing = pool.verifiedItems.find(
          item => item.acceptedUsageKey === acceptedKey || item.canonicalName.toLowerCase() === canonicalLower
        ) || acceptedItems.find(
          item => item.acceptedUsageKey === acceptedKey || item.canonicalName.toLowerCase() === canonicalLower
        );
        if (existing && synonymOf && !existing.synonymOf) {
          existing.synonymOf = synonymOf;
        }
        continue;
      }

      if (evidence.existenceStatus === 'HISTORICAL_OR_UNCERTAIN') {
        pool.uncertainOrHistoricalCount++;
      }

      const inlineVern = extractVernacularsFromSearchItem(resolvedSp);

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
        turkishName: localSciEntry?.turkishName || evidence.gbifTurkishName || inlineVern.trName,
        englishName: localSciEntry?.englishName || evidence.gbifEnglishName || inlineVern.enName,
        gbifRecordCount: 0,
        globalRecordCount: 0,
        isFossilOnly: evidence.isFossilOnly,
        existenceStatus: evidence.existenceStatus,
        existenceEvidence: evidence.existenceEvidence,
        membershipStatus: membership.status,
        membershipEvidence: membership.evidence,
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
      acceptedItems.push(item);
    }

    // Gözlemlerden bağımsız deterministik sıralama: Yaşayan türler önce, ardından Backbone sırası korunur
    acceptedItems.sort((a, b) => {
      const tierA = a.existenceStatus === 'LIVING' ? 0 : a.existenceStatus === 'HISTORICAL_OR_UNCERTAIN' ? 1 : 2;
      const tierB = b.existenceStatus === 'LIVING' ? 0 : b.existenceStatus === 'HISTORICAL_OR_UNCERTAIN' ? 1 : 2;
      return tierA - tierB;
    });

    return acceptedItems;
  };

  // Durum A: Özel biyolojik beyaz liste tanımlı alt gruplar (kurt, çakallar, koyote, yeleli kurt, evcil kedi)
  if (activeGroup.allowedCanonicalNames && activeGroup.allowedCanonicalNames.length > 0) {
    if (!pool.allowedResolved) {
      pool.allowedResolved = true;
      for (const c of pool.taxonCursors) c.endOfRecords = true;

      const resolvedTargets = await runWithConcurrencyLimit(
        activeGroup.allowedCanonicalNames,
        3,
        async (name) => {
          const targetName = activeGroup.mergedEquivalents?.[name.toLowerCase()] || name;
          const sp = await resolveCanonicalSpeciesTarget(targetName);
          if (!sp) return null;
          if (targetName.toLowerCase() !== name.toLowerCase()) {
            return { ...sp, _synonymOf: `${name} (örtüşen taksonomik kompleks)` };
          }
          return sp;
        }
      );

      const rawAllowed = resolvedTargets
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && Boolean(r.value))
        .map(r => r.value);

      const verifiedAllowed = await processCandidateRecords(rawAllowed);
      pool.verifiedItems.push(...verifiedAllowed);
    }
  }
  // Durum B: Tekil tür grubu (rank === 'SPECIES')
  else if (String(activeGroup.rank || '').toUpperCase() === 'SPECIES' && activeTaxonKeys.length === 1) {
    if (pool.verifiedItems.length === 0 && !pool.taxonCursors[0].endOfRecords) {
      pool.taxonCursors[0].endOfRecords = true;
      pool.taxonCursors[0].apiTotalCount = 1;
      const spDetail = await fetchSpeciesDetailCached(activeTaxonKeys[0]);
      if (spDetail) {
        const verifiedSingle = await processCandidateRecords([spDetail]);
        pool.verifiedItems.push(...verifiedSingle);
      }
    }
  }
  // Durum C: Genel GBIF Backbone sayfalı katalog keşfi (tekil üst takson veya COMPOSITE_GROUP)
  else {
    const maxBatchesPerCall = 16;
    let batchesProcessed = 0;

    while (pool.verifiedItems.length < targetEndIdx && batchesProcessed < maxBatchesPerCall) {
      if (pool.nextRawCandidateIndex >= pool.rawCandidates.length) {
        const activeCursors = pool.taxonCursors.filter(c => !c.endOfRecords);
        if (activeCursors.length === 0) break;

        // Round-robin: COMPOSITE_GROUP'larda her döngüde en fazla 6 alt takson ilerletilir
        const selectedCursors: BackboneTaxonCursor[] = [];
        const totalCursors = pool.taxonCursors.length;
        let scanned = 0;
        while (selectedCursors.length < Math.min(6, activeCursors.length) && scanned < totalCursors) {
          const idx = (pool.cursorRoundRobinIndex + scanned) % totalCursors;
          const cur = pool.taxonCursors[idx];
          if (!cur.endOfRecords) selectedCursors.push(cur);
          scanned++;
        }
        pool.cursorRoundRobinIndex = (pool.cursorRoundRobinIndex + scanned) % Math.max(1, totalCursors);

        const perCursorLimit =
          selectedCursors.length === 1
            ? 50
            : Math.max(8, Math.min(25, Math.ceil(60 / selectedCursors.length)));

        const pageSettled = await runWithConcurrencyLimit(
          selectedCursors,
          DISCOVERY_CONCURRENCY_LIMIT,
          async (cursor) => {
            const remainingBeforeCap = GBIF_SPECIES_SEARCH_MAX_OFFSET - cursor.nextOffset;
            if (remainingBeforeCap <= 0) {
              return { kind: 'OFFSET_LIMIT' as const, cursor, effectiveLimit: 0, json: null };
            }
            const effectiveLimit = Math.min(perCursorLimit, remainingBeforeCap);
            const bbUrl = `https://api.gbif.org/v1/species/search?datasetKey=${GBIF_BACKBONE_DATASET_KEY}&higherTaxonKey=${cursor.htKey}&rank=SPECIES&status=ACCEPTED&limit=${effectiveLimit}&offset=${cursor.nextOffset}`;
            const res = await fetchWithRetry(bbUrl, undefined, 2, 8000);
            if (!res.ok) {
              const errBody = await res.text().catch(() => '');
              if (res.status === 400) {
                const isBoundaryExceeded =
                  cursor.nextOffset >= GBIF_SPECIES_SEARCH_MAX_OFFSET ||
                  cursor.nextOffset + effectiveLimit > GBIF_SPECIES_SEARCH_MAX_OFFSET;
                const hasOffsetLimitBody =
                  /max(?:imum)?\s*offset|offset\s*(?:must|cannot|can't|exceed|exceeded|limit|greater|<=|<)|exceeded.*offset|100[\s,.]?000/i.test(
                    errBody
                  );
                if (isBoundaryExceeded || hasOffsetLimitBody) {
                  return { kind: 'OFFSET_LIMIT' as const, cursor, effectiveLimit, json: null };
                }
                return {
                  kind: 'REQUEST_ERROR' as const,
                  cursor,
                  effectiveLimit,
                  statusCode: res.status,
                  detail: errBody.trim().slice(0, 200),
                };
              }
              if (res.status >= 500) {
                return {
                  kind: 'SERVER_ERROR' as const,
                  cursor,
                  effectiveLimit,
                  statusCode: res.status,
                  detail: errBody.trim().slice(0, 200),
                };
              }
              return {
                kind: 'REQUEST_ERROR' as const,
                cursor,
                effectiveLimit,
                statusCode: res.status,
                detail: errBody.trim().slice(0, 200),
              };
            }
            const json = await res.json();
            if (!json || typeof json !== 'object' || !Array.isArray(json.results)) {
              return {
                kind: 'SERVER_ERROR' as const,
                cursor,
                effectiveLimit,
                statusCode: res.status || 502,
                detail: 'GBIF Backbone arama yanıtı beklenen results dizisini içermiyor',
              };
            }
            return { kind: 'OK' as const, cursor, effectiveLimit, json };
          }
        );

        const perCursorResults: any[][] = [];
        let allSelectedFailed = selectedCursors.length > 0;
        for (let i = 0; i < pageSettled.length; i++) {
          const ps = pageSettled[i];
          const cursor = selectedCursors[i];
          if (ps.status !== 'fulfilled') {
            cursor.consecutiveFailures = (cursor.consecutiveFailures || 0) + 1;
            cursor.endOfRecords = true;
            cursor.hitOffsetLimit = false;
            pool.serverErrorReached = true;
            if (!pool.catalogErrorMessage) {
              const reasonMsg = ps.reason instanceof Error ? ps.reason.message : String(ps.reason || '');
              pool.catalogErrorMessage = reasonMsg
                ? `GBIF Backbone servisine erişilemedi (${reasonMsg}); şimdiye kadar getirilen kayıtlar korundu.`
                : 'GBIF Backbone servisine erişilemedi; şimdiye kadar getirilen kayıtlar korundu.';
            }
            continue;
          }

          if (ps.value.kind === 'OFFSET_LIMIT') {
            allSelectedFailed = false;
            cursor.consecutiveFailures = 0;
            cursor.endOfRecords = true;
            cursor.hitOffsetLimit = true;
            pool.hitOffsetLimit = true;
            continue;
          }

          if (ps.value.kind === 'SERVER_ERROR') {
            cursor.consecutiveFailures = (cursor.consecutiveFailures || 0) + 1;
            cursor.endOfRecords = true;
            cursor.hitOffsetLimit = false;
            pool.serverErrorReached = true;
            if (!pool.catalogErrorMessage) {
              pool.catalogErrorMessage = `GBIF Backbone sunucusundan geçici hata alındı (HTTP ${ps.value.statusCode}); şu ana kadar getirilen kayıtlar korundu.`;
            }
            continue;
          }

          if (ps.value.kind === 'REQUEST_ERROR') {
            cursor.consecutiveFailures = (cursor.consecutiveFailures || 0) + 1;
            cursor.endOfRecords = true;
            cursor.hitOffsetLimit = false;
            if (!pool.catalogErrorMessage) {
              pool.catalogErrorMessage = `GBIF Backbone tür arama isteği reddedildi (HTTP ${ps.value.statusCode})${ps.value.detail ? `: ${ps.value.detail}` : '.'}`;
            }
            continue;
          }

          allSelectedFailed = false;
          cursor.consecutiveFailures = 0;

          const { effectiveLimit, json } = ps.value;
          const results: any[] = json.results;
          if (typeof json?.count === 'number') {
            cursor.apiTotalCount = json.count;
          }
          cursor.nextOffset += results.length;
          if (cursor.nextOffset >= GBIF_SPECIES_SEARCH_MAX_OFFSET) {
            cursor.endOfRecords = true;
            cursor.hitOffsetLimit = true;
            pool.hitOffsetLimit = true;
          } else if (json?.endOfRecords || results.length < effectiveLimit || results.length === 0) {
            cursor.endOfRecords = true;
          }
          perCursorResults.push(results);
        }

        if (allSelectedFailed && pool.taxonCursors.every(c => c.endOfRecords)) {
          break;
        }

        // Composite gruplarda dengeli sayfa sunumu için sonuçları sırayla harmanla (round-robin interleave)
        const maxLen = perCursorResults.reduce((m, arr) => Math.max(m, arr.length), 0);
        for (let i = 0; i < maxLen; i++) {
          for (const arr of perCursorResults) {
            const sp = arr[i];
            const k = Number(sp?.key);
            if (!k || pool.rawSeenKeys.has(k)) continue;
            pool.rawSeenKeys.add(k);
            pool.rawCandidates.push(sp);
          }
        }
      }

      if (pool.nextRawCandidateIndex >= pool.rawCandidates.length) {
        if (pool.taxonCursors.every(c => c.endOfRecords)) break;
        batchesProcessed++;
        continue;
      }

      const batchSize = Math.max(pageSize + 4, 20);
      const rawBatch = pool.rawCandidates.slice(
        pool.nextRawCandidateIndex,
        pool.nextRawCandidateIndex + batchSize
      );
      pool.nextRawCandidateIndex += rawBatch.length;
      batchesProcessed++;

      const verifiedBatch = await processCandidateRecords(rawBatch);
      pool.verifiedItems.push(...verifiedBatch);
    }
  }

  if (!pool.serverErrorReached && !pool.catalogErrorMessage) {
    setCached(backbonePoolCacheKey, pool, 15 * 60 * 1000);
  }

  // Sayfa dilimini kopyala (ülke bazlı gözlem sayıları paylaşılan katalog önbelleğini kirletmesin)
  const pageSpecies: DiscoveredSpeciesItem[] = pool.verifiedItems
    .slice(targetStartIdx, targetEndIdx)
    .map(item => ({ ...item }));

  // AŞAMA 2: Seçilen kapsam (TR / Global) ve Global karşılaştırma için gözlem sayılarını ayrıca zenginleştir
  const nonFossilBasisParam = includeFossilOnly
    ? ''
    : '&basisOfRecord=HUMAN_OBSERVATION&basisOfRecord=OBSERVATION&basisOfRecord=MACHINE_OBSERVATION&basisOfRecord=PRESERVED_SPECIMEN&basisOfRecord=MATERIAL_SAMPLE&basisOfRecord=LIVING_SPECIMEN';

  const pageKeys = pageSpecies.map(s => s.acceptedUsageKey);
  const [scopeBatch, globalBatch, scopeTotalResult] = await Promise.all([
    fetchBatchOccurrenceCounts(pageKeys, countryCode, nonFossilBasisParam),
    countryCode
      ? fetchBatchOccurrenceCounts(pageKeys, '', nonFossilBasisParam)
      : Promise.resolve<BatchOccurrenceCountsResult | null>(null),
    fetchScopeTotalOccurrences(activeTaxonKeys, countryCode, nonFossilBasisParam),
  ]);

  const totalOccurrencesStatus: OccurrenceCountStatus = scopeTotalResult.status;
  const totalOccurrencesInScope: number | null =
    scopeTotalResult.status === 'OK' ? scopeTotalResult.count : null;
  const totalOccurrencesError: string | undefined =
    scopeTotalResult.status === 'ERROR' ? scopeTotalResult.errorMessage : undefined;

  const scopeCountryParam = countryCode ? `&country=${encodeURIComponent(countryCode)}` : '';
  const hasWolfSubspeciesExcl =
    Boolean(activeGroup.excludedTaxonKeys && activeGroup.excludedTaxonKeys.length > 0) &&
    pageKeys.includes(5219173);

  let exclScopeResult: { status: OccurrenceCountStatus; count: number } = { status: 'OK', count: 0 };
  let exclGlobalResult: { status: OccurrenceCountStatus; count: number } = { status: 'OK', count: 0 };
  if (hasWolfSubspeciesExcl && activeGroup.excludedTaxonKeys) {
    const [es, eg] = await Promise.all([
      fetchExcludedSubspeciesCount(activeGroup.excludedTaxonKeys, scopeCountryParam, nonFossilBasisParam),
      countryCode
        ? fetchExcludedSubspeciesCount(activeGroup.excludedTaxonKeys, '', nonFossilBasisParam)
        : Promise.resolve<{ status: OccurrenceCountStatus; count: number }>({ status: 'OK', count: 0 }),
    ]);
    exclScopeResult = es;
    exclGlobalResult = countryCode ? eg : es;
  }

  let scopeOkCount = 0;
  let scopeErrCount = 0;

  for (const item of pageSpecies) {
    const scopeStatus: OccurrenceCountStatus = scopeBatch.keyStatuses.get(item.acceptedUsageKey) ?? 'OK';
    const globalStatus: OccurrenceCountStatus = countryCode
      ? (globalBatch?.keyStatuses.get(item.acceptedUsageKey) ?? 'OK')
      : scopeStatus;

    let scopeCount = scopeStatus === 'OK' ? (scopeBatch.counts.get(item.acceptedUsageKey) ?? 0) : 0;
    let globalCount = countryCode
      ? (globalStatus === 'OK' ? (globalBatch?.counts.get(item.acceptedUsageKey) ?? 0) : 0)
      : scopeCount;

    if (scopeStatus === 'OK') scopeOkCount++;
    else scopeErrCount++;

    if (item.acceptedUsageKey === 5219173 && hasWolfSubspeciesExcl) {
      if (scopeStatus === 'OK' && exclScopeResult.status === 'OK' && exclScopeResult.count > 0 && scopeCount > 0) {
        scopeCount = Math.max(0, scopeCount - exclScopeResult.count);
        item.excludedSubspeciesNote = `Evcil köpek (Canis familiaris / Canis lupus familiaris) kayıtları (${exclScopeResult.count.toLocaleString('tr-TR')}) çıkarıldı`;
      }
      if (globalStatus === 'OK' && exclGlobalResult.status === 'OK' && exclGlobalResult.count > 0 && globalCount > 0) {
        globalCount = Math.max(0, globalCount - exclGlobalResult.count);
      }
    }

    item.gbifRecordCount = scopeCount;
    item.gbifRecordStatus = scopeStatus;
    item.globalRecordCount = globalCount;
    item.globalRecordStatus = globalStatus;
  }

  const occurrenceEnrichmentStatus: 'OK' | 'PARTIAL_ERROR' | 'ERROR' =
    scopeErrCount === 0 && !globalBatch?.hasErrors && totalOccurrencesStatus === 'OK'
      ? 'OK'
      : scopeOkCount === 0 && (scopeErrCount > 0 || totalOccurrencesStatus === 'ERROR')
        ? 'ERROR'
        : 'PARTIAL_ERROR';

  // Opsiyonel iNaturalist + doğrulanmış yedek görsel (Wikipedia/Wikimedia & GBIF StillImage) zenginleştirme
  let inatHadError = false;
  if (enrichWithInaturalist && pageSpecies.length > 0) {
    const inatSettled = await runWithConcurrencyLimit(
      pageSpecies,
      2,
      async (item) => {
        const outcome = await fetchInatTaxon(item.canonicalName, {
          includeSummary: false,
          usageKey: item.acceptedUsageKey || item.usageKey,
        });
        return { item, outcome };
      }
    );

    for (const is of inatSettled) {
      if (is.status !== 'fulfilled') {
        inatHadError = true;
        continue;
      }
      const { item, outcome } = is.value;
      if (outcome.status === 'ERROR') {
        inatHadError = true;
        continue;
      }
      if (outcome.status !== 'FOUND') continue;
      const inat = outcome.data;
      if (!item.turkishName && inat.turkishName) item.turkishName = inat.turkishName;
      if (!item.englishName && inat.englishName) item.englishName = inat.englishName;
      if (inat.photoUrl) item.photoUrl = inat.photoUrl;
      if (inat.photoAttribution) item.photoAttribution = inat.photoAttribution;
      if (inat.photoSource) item.photoSource = inat.photoSource;
      if (inat.inatUrl) item.inaturalistUrl = inat.inatUrl;
      if (inat.iucnStatus) {
        item.iucnStatus = inat.iucnStatus;
        item.iucnCategoryName = inat.iucnCategoryName || getIucnLabel(inat.iucnStatus);
        item.iucnSource = 'iNaturalist & IUCN Kırmızı Liste Ortak Veri Ağı';
        item.iucnVerified = true;
      }
      if (inat.inatUrl) {
        item.dataSource = 'GBIF Backbone + SpeciesProfiles + iNaturalist';
      } else if (inat.photoSource) {
        item.dataSource = `GBIF Backbone + ${inat.photoSource}`;
      }
    }
  }

  const hasMoreBackbone = pool.taxonCursors.some(c => !c.endOfRecords);
  const hasMore =
    pool.verifiedItems.length > targetEndIdx ||
    pool.nextRawCandidateIndex < pool.rawCandidates.length ||
    hasMoreBackbone;
  const totalDiscovered = pool.verifiedItems.length;

  const isDirectFiniteList =
    Boolean(activeGroup.allowedCanonicalNames && activeGroup.allowedCanonicalNames.length > 0) ||
    (String(activeGroup.rank || '').toUpperCase() === 'SPECIES' && activeTaxonKeys.length === 1);

  const rawBackboneSum = pool.taxonCursors.reduce((acc, c) => acc + (c.apiTotalCount || 0), 0);
  // GBIF Backbone sorgu eşleşme sayısı (fosil/kapsam filtrelerinden önceki ham API eşleşmesi; sayfalama boyunca sabit kalır)
  const backboneMatchCount = isDirectFiniteList ? totalDiscovered : rawBackboneSum;
  // Filtrelenmiş kesin toplam yalnızca tüm katalog tarandığında (ve 100k API sınırı veya katalog hatası kesintisi yoksa) belirlenir; tahmin yürütülmez
  const filteredCatalogCount: number | null =
    !hasMore &&
    pool.nextRawCandidateIndex >= pool.rawCandidates.length &&
    !pool.hitOffsetLimit &&
    !pool.serverErrorReached &&
    !pool.catalogErrorMessage
      ? totalDiscovered
      : null;
  const backboneTotalCount = backboneMatchCount;
  const offsetLimitReached = pool.hitOffsetLimit && !hasMoreBackbone;
  const serverErrorReached = pool.serverErrorReached;
  const catalogErrorMessage = pool.catalogErrorMessage;

  const scopeTotalSummaryText =
    totalOccurrencesStatus === 'OK' && totalOccurrencesInScope !== null
      ? `${countryName} kapsamında ${totalOccurrencesInScope.toLocaleString('tr-TR')} gözlem kaydı mevcut.`
      : `${countryName} toplam gözlem sayısı alınamadı (GBIF API hatası).`;

  const noticeParts: string[] = [];
  if (totalDiscovered > 0) {
    if (filteredCatalogCount !== null) {
      noticeParts.push(
        `${activeGroup.label} için filtreler sonrası katalogda toplam ${filteredCatalogCount.toLocaleString('tr-TR')} tür doğrulandı (GBIF Backbone ham eşleşme: ${backboneMatchCount.toLocaleString('tr-TR')}); ${scopeTotalSummaryText}`
      );
    } else {
      noticeParts.push(
        `${activeGroup.label} için şu ana kadar ${totalDiscovered.toLocaleString('tr-TR')} kabul edilmiş tür doğrulandı (GBIF Backbone ham sorgu eşleşmesi: ~${backboneMatchCount.toLocaleString('tr-TR')} tür, fosil/kapsam filtreleri tarama ilerledikçe uygulanır); ${scopeTotalSummaryText}`
      );
    }
  } else if (!catalogErrorMessage) {
    noticeParts.push(
      `${activeGroup.label} grubu için GBIF Backbone üzerinde kriterlere uygun kabul edilmiş tür bulunamadı (${scopeTotalSummaryText}).`
    );
  }
  if (catalogErrorMessage) {
    noticeParts.push(catalogErrorMessage);
  }
  if (offsetLimitReached) {
    noticeParts.push(
      'GBIF /v1/species/search servisinin 100.000 kayıtlık sayfalama sınırına ulaşıldı; sınır içindeki kayıtlar korundu ancak sınır ötesindeki ek türler bu uç üzerinden getirilemiyor (alt gruplara bölerek daha dar taksonlarda tarayabilirsiniz).'
    );
  }
  if (totalOccurrencesStatus === 'ERROR') {
    noticeParts.push(
      totalOccurrencesError ||
        `${countryName} toplam gözlem sayısı GBIF servisinden alınamadı (0 olarak gösterilmedi).`
    );
  }
  if (scopeErrCount > 0 || globalBatch?.hasErrors) {
    noticeParts.push(
      'Bazı türler için GBIF gözlem sayısı servisinden yanıt alınamadı; ilgili türler katalogdan çıkarılmadı ve "Veri alınamadı" olarak işaretlendi.'
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
    totalOccurrencesInScope,
    totalOccurrencesStatus,
    totalOccurrencesError,
    occurrenceEnrichmentStatus,
    offsetLimitReached,
    serverErrorReached,
    catalogErrorMessage,
    pagination: {
      page,
      pageSize,
      totalDiscovered,
      backboneTotalCount,
      backboneMatchCount,
      filteredCatalogCount,
      offsetLimitReached,
      serverErrorReached,
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

  if (
    occurrenceEnrichmentStatus === 'OK' &&
    totalOccurrencesStatus === 'OK' &&
    !serverErrorReached &&
    !catalogErrorMessage &&
    !inatHadError
  ) {
    setCached(discoveryCacheKey, result, 15 * 60 * 1000);
  }
  return result;
  });
}

export interface ProgressiveEnrichmentOptions {
  onUpdate?: (updatedItems: DiscoveredSpeciesItem[], completedKeys: Set<number>) => void;
  shouldCancel?: () => boolean;
}

/**
 * Büyük tür gruplarında arayüzü bloklamadan iNaturalist + sunucu doğrulamalı görselleri
 * iki aşamalı ve sınırlı eşzamanlılıkla (Phase 1: hızlı iNat + toplu doğrulama, Phase 2: Wikipedia/GBIF yedeği) yükler.
 */
export async function enrichDiscoveryPageItems(
  items: DiscoveredSpeciesItem[],
  options: ProgressiveEnrichmentOptions = {}
): Promise<DiscoveredSpeciesItem[]> {
  const { onUpdate, shouldCancel } = options;
  if (!items || items.length === 0) return items;

  const working = items.map((item) => ({ ...item }));
  const completedKeys = new Set<number>();
  const phase1OutcomeByKey = new Map<number, InatTaxonFetchOutcome['status']>();
  const getItemKey = (it: DiscoveredSpeciesItem) => it.acceptedUsageKey || it.usageKey;

  // Phase 1: Hızlı iNaturalist sorgusu (fallback görsel zinciri olmadan, concurrency=3)
  await runWithConcurrencyLimit(working, 3, async (item) => {
    if (shouldCancel?.()) return;
    const outcome = await fetchInatTaxon(item.canonicalName, {
      includeSummary: false,
      usageKey: getItemKey(item),
      skipFallbackPhoto: true,
    });
    phase1OutcomeByKey.set(getItemKey(item), outcome.status);
    if (shouldCancel?.()) return;
    if (outcome.status === 'FOUND') {
      const inat = outcome.data;
      if (!item.turkishName && inat.turkishName) item.turkishName = inat.turkishName;
      if (!item.englishName && inat.englishName) item.englishName = inat.englishName;
      if (inat.photoUrl) item.photoUrl = inat.photoUrl;
      if (inat.photoAttribution) item.photoAttribution = inat.photoAttribution;
      if (inat.photoSource) item.photoSource = inat.photoSource;
      if (inat.inatUrl) item.inaturalistUrl = inat.inatUrl;
      if (inat.iucnStatus) {
        item.iucnStatus = inat.iucnStatus;
        item.iucnCategoryName = inat.iucnCategoryName || getIucnLabel(inat.iucnStatus);
        item.iucnSource = 'iNaturalist & IUCN Kırmızı Liste Ortak Veri Ağı';
        item.iucnVerified = true;
      }
      if (inat.inatUrl) {
        item.dataSource = 'GBIF Backbone + SpeciesProfiles + iNaturalist';
      }
    }
  });

  if (shouldCancel?.()) return working;

  // Phase 1b: iNaturalist'ten gelen tüm görsel adaylarını tek bir sunucu toplu isteğiyle doğrula (sıfır tarayıcı CORS hatası)
  const candidateUrls = working
    .map((w) => w.photoUrl)
    .filter((u): u is string => Boolean(u));

  if (candidateUrls.length > 0) {
    const verificationMap = await verifyImageAssetUrlsBatch(candidateUrls, 15000);
    if (shouldCancel?.()) return working;

    for (const item of working) {
      if (!item.photoUrl) continue;
      const check = verificationMap.get(item.photoUrl);
      if (check?.verified) {
        completedKeys.add(getItemKey(item));
      } else {
        item.photoUrl = undefined;
        item.photoAttribution = undefined;
        item.photoSource = undefined;
      }
    }
  }

  onUpdate?.(working.map((w) => ({ ...w })), new Set(completedKeys));

  // Phase 2: Hâlâ doğrulanmış görseli olmayan türler için toplu Wikipedia + GBIF Species/Occurrence Media + Commons yedeği
  const missingPhotoItems = working.filter((item) => !item.photoUrl);
  if (missingPhotoItems.length === 0) {
    for (const item of working) completedKeys.add(getItemKey(item));
    onUpdate?.(working.map((w) => ({ ...w })), new Set(completedKeys));
    return working;
  }

  const wikiBatch = await fetchBatchWikipediaThumbnails(missingPhotoItems.map((i) => i.canonicalName));
  if (shouldCancel?.()) return working;

  await runWithConcurrencyLimit(missingPhotoItems, 4, async (item) => {
    const key = getItemKey(item);
    if (shouldCancel?.()) return;
    try {
      const cleanLower = normalizeSearchQuery(item.canonicalName).toLowerCase();
      const preloadedWikiThumb = wikiBatch.map.get(cleanLower) ?? null;
      const phase1Status = phase1OutcomeByKey.get(key);
      const fallback = await fetchVerifiedFallbackPhoto(item.canonicalName, key, {
        includeInatSynonymCheck: phase1Status === 'ERROR',
        skipWikiQuery: !wikiBatch.hadError,
        preloadedWikiThumb,
      });
      if (shouldCancel?.()) return;
      if (fallback) {
        item.photoUrl = fallback.photoUrl;
        item.photoAttribution = fallback.photoAttribution;
        item.photoSource = fallback.photoSource;
        if (fallback.inatUrl && !item.inaturalistUrl) {
          item.inaturalistUrl = fallback.inatUrl;
        }
        if (!item.inaturalistUrl) {
          item.dataSource = `GBIF Backbone + ${fallback.photoSource}`;
        }
      }
    } finally {
      completedKeys.add(key);
      if (!shouldCancel?.()) {
        onUpdate?.(working.map((w) => ({ ...w })), new Set(completedKeys));
      }
    }
  });

  return working;
}

