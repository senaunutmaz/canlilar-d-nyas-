import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { 
  fetchSpeciesAnalysis, 
  matchSpecies, 
  extractSpeciesAndParameters,
  COMMON_TURKISH_SPECIES,
  verifyImageAssetUrl,
  ImageAssetVerificationResult
} from './src/services/gbif.ts';
import { SpeciesAnalysis, ResearchParameters } from './src/types/biodiversity.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);

export interface AgentExecutionStep {
  id: string;
  title: string;
  detail: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: string;
}

// 1. Tool Declarations for Gemini Multi-Tool Function Calling
const fetchGbifDataDeclaration: FunctionDeclaration = {
  name: 'fetchGbifSpeciesData',
  description: 'Fetches verified scientific occurrence records, observation trends, GPS coordinates, and regional provincial stats from the Global Biodiversity Information Facility (GBIF) API for a species.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      scientificOrCommonName: {
        type: Type.STRING,
        description: 'Scientific name (e.g. Ursus arctos, Canis lupus) or Turkish name (e.g. Bozayı, Kurt, Akdeniz Foku) of the organism.',
      },
      countryCode: {
        type: Type.STRING,
        description: 'Two-letter ISO country code. Use "TR" for Turkey, or empty string "" for worldwide global data.',
      },
      startYear: {
        type: Type.INTEGER,
        description: 'Start year for the occurrence query if specified (e.g. 2016).',
      },
      endYear: {
        type: Type.INTEGER,
        description: 'End year for the occurrence query if specified (e.g. 2026).',
      },
    },
    required: ['scientificOrCommonName'],
  },
};

const searchSpeciesTaxonomyDeclaration: FunctionDeclaration = {
  name: 'searchSpeciesTaxonomy',
  description: 'Matches and validates a common or scientific species name against the GBIF taxonomy and iNaturalist databases, returning official taxonomy, kingdom, family, and IUCN Red List conservation status.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      speciesName: {
        type: Type.STRING,
        description: 'Common name (Turkish/English) or scientific binomial name of the species to search.',
      },
    },
    required: ['speciesName'],
  },
};

const compareTwoSpeciesDeclaration: FunctionDeclaration = {
  name: 'compareTwoSpecies',
  description: 'Performs side-by-side comparative analytics of two species (e.g. Bozayı and Bozkurt) comparing total GBIF observations, GPS mapped records, and regional centers.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      speciesA: {
        type: Type.STRING,
        description: 'Scientific or common name of the first species.',
      },
      speciesB: {
        type: Type.STRING,
        description: 'Scientific or common name of the second species.',
      },
      countryCode: {
        type: Type.STRING,
        description: 'Two-letter ISO country code (e.g. "TR").',
      },
    },
    required: ['speciesA', 'speciesB'],
  },
};

interface ResolvedAgentSpecies {
  scientificName: string;
  canonicalName: string;
  turkishName: string;
  usageKey: number;
}

interface AgentQueryResolution {
  foundSpecies: boolean;
  requiresClarification?: boolean;
  error?: string;
  parameters?: ResearchParameters;
  primarySpecies?: ResolvedAgentSpecies;
  secondarySpecies?: ResolvedAgentSpecies;
  isComparison: boolean;
}

const AGENT_STOP_WORDS = new Set([
  've', 'ile', 'veya', 'ya', 'da', 'de', 'ki', 'mi', 'mı', 'mu', 'mü', 'için', 'göre', 'kadar', 'üzerine',
  'hakkında', 'karşı', 'ancak', 'fakat', 'ama', 'ise', 'olan', 'olarak', 'bu', 'şu', 'o', 'bir', 'en', 'çok',
  'fazla', 'az', 'tüm', 'bütün', 'son', 'ilk', 'yeni', 'eski',
  'türkiye', 'türkiyede', 'türkiyedeki', 'turkiye', 'turkiyede', 'turkiyedeki', 'turkey', 'anadolu', 'anadoluda',
  'küresel', 'kuresel', 'dünya', 'dunya', 'dünyada', 'dunyada', 'dünyadaki', 'global', 'worldwide', 'world',
  'tür', 'türü', 'türün', 'türünün', 'türünü', 'türler', 'türleri', 'türlerini', 'türlerin', 'species',
  'canlı', 'canlısı', 'canlısının', 'canlılar', 'canlıların', 'hayvan', 'hayvanı', 'hayvanın', 'hayvanlar',
  'kayıt', 'kaydı', 'kayıtlar', 'kayıtları', 'kayıtlarını', 'kayıtlarında', 'records', 'occurrences',
  'gözlem', 'gözlemi', 'gözlemler', 'gözlemleri', 'gözlemlerini', 'gözlemlerinin', 'gözlemlenen', 'observations',
  'dağılım', 'dağılımı', 'dağılımını', 'dağılımının', 'yayılış', 'yayılışı', 'yayılışını', 'distribution',
  'analiz', 'analizi', 'analizini', 'incele', 'araştır', 'göster', 'getir', 'bul', 'listele', 'açıkla', 'belirle',
  'ver', 'veri', 'verileri', 'verilerini', 'bilgi', 'rapor', 'raporu', 'özet', 'özeti',
  'karşılaştır', 'kıyasla', 'kıyas', 'fark', 'farkı', 'farkları', 'vs', 'versus', 'arasında',
  'yıl', 'yılı', 'yılın', 'yıllar', 'yıllara', 'yıllık', 'yıllardaki', 'yılda', 'yıldaki', 'yılından', 'sonra', 'itibaren',
  'il', 'ili', 'iller', 'illeri', 'illerde', 'bölge', 'bölgesi', 'bölgeler', 'bölgelerde', 'nerede', 'hangi', 'nedir',
  'yoğunluk', 'yoğunluğu', 'trend', 'değişim', 'değişimi', 'artış', 'azalış', 'sıcak', 'nokta', 'noktalar',
  'gbif', 'inaturalist', 'iucn', 'harita', 'atlas', 'durum', 'durumu', 'koruma', 'statü', 'statüsü',
  'the', 'and', 'for', 'with', 'in', 'of', 'on', 'to', 'show', 'analyze', 'compare', 'data', 'et', 'yap', 'ol',
  'daki', 'deki', 'taki', 'teki', 'nın', 'nin', 'nun', 'nün', 'dan', 'den', 'tan', 'ten', 'lar', 'ler',
  'lara', 'lere', 'ların', 'lerin', 'ları', 'leri', 'ya', 'ye', 'yı', 'yi',
]);

const AMBIGUOUS_GENERIC_ANIMALS: Array<{
  pattern: RegExp;
  qualifierPattern?: RegExp;
  label: string;
  suggestions: string[];
}> = [
  {
    pattern: /(?:^|[^\p{L}])kartal(?:lar|ları|ların|ı|ın|a|da)?(?=[^\p{L}]|$)/iu,
    qualifierPattern: /(?:^|[^\p{L}])(kaya\s+kartal[ıi]?|[sş]ah\s+kartal[ıi]?|bal[ıi]k\s+kartal[ıi]?|y[ıi]lan\s+kartal[ıi]?|bozk[ıi]r\s+kartal[ıi]?|ak\s+kuyruklu\s+kartal|c[üu]ce\s+kartal|alt[ıi]n\s+kartal)(?=[^\p{L}]|$)/iu,
    label: 'Kartal',
    suggestions: ['Kaya Kartalı (Aquila chrysaetos)', 'Şah Kartal (Aquila heliaca)'],
  },
  {
    pattern: /(?:^|[^\p{L}])geyik(?:ler|leri|lerin|i|in|e|te)?(?=[^\p{L}]|$)/iu,
    qualifierPattern: /(?:^|[^\p{L}])(k[ıi]z[ıi]l\s+geyik|ala\s*geyik|ren\s+geyi[gğ]i|kafkas\s+geyi[gğ]i)(?=[^\p{L}]|$)/iu,
    label: 'Geyik',
    suggestions: ['Kızıl Geyik (Cervus elaphus)', 'Alageyik (Dama dama)', 'Karaca (Capreolus capreolus)'],
  },
  {
    pattern: /(?:^|[^\p{L}])ay[ıi](?:lar|ları|ların|y[ıi]|n[ıi]n|da)?(?=[^\p{L}]|$)/iu,
    qualifierPattern: /(?:^|[^\p{L}])(boz\s*ay[ıi]|kutup\s+ay[ıi]s[ıi]|kara\s+ay[ıi]|g[öo]zl[üu]kl[üu]\s+ay[ıi]|malay\s+ay[ıi]s[ıi]|panda\s+ay[ıi]s[ıi])(?=[^\p{L}]|$)/iu,
    label: 'Ayı',
    suggestions: ['Bozayı (Ursus arctos)', 'Kutup Ayısı (Ursus maritimus)'],
  },
  {
    pattern: /(?:^|[^\p{L}])kaplumba[gğ]a(?:lar|ları|ların|y[ıi]|n[ıi]n|da)?(?=[^\p{L}]|$)/iu,
    qualifierPattern: /(?:^|[^\p{L}])(caretta|deniz\s+kaplumba[gğ]as[ıi]|ye[sş]il\s+deniz\s+kaplumba[gğ]as[ıi]|iriba[sş]|tosba[gğ]a|nil\s+kaplumba[gğ]as[ıi])(?=[^\p{L}]|$)/iu,
    label: 'Kaplumbağa',
    suggestions: ['İribaş Deniz Kaplumbağası (Caretta caretta)', 'Yeşil Deniz Kaplumbağası (Chelonia mydas)', 'Adi Tosbağa (Testudo graeca)'],
  },
  {
    pattern: /(?:^|[^\p{L}])fok(?:lar|ları|ların|u|un|ta)?(?=[^\p{L}]|$)/iu,
    qualifierPattern: /(?:^|[^\p{L}])(akdeniz\s+foku|deniz\s+foku|ke[sş]i[sş]\s+foku)(?=[^\p{L}]|$)/iu,
    label: 'Fok',
    suggestions: ['Akdeniz Foku (Monachus monachus)'],
  },
  {
    pattern: /(?:^|[^\p{L}])(ku[sş]|bal[ıi]k|y[ıi]lan|b[öo]cek|[öo]r[üu]mcek|kertenkele|kurba[gğ]a)(?:lar|ler|ları|leri|ların|lerin|u|ü|ı|i)?(?=[^\p{L}]|$)/iu,
    qualifierPattern: /(?:^|[^\p{L}])(toy\s+ku[sş]u|toros\s+kurba[gğ]as[ıi]|k[öo]pekbal[ıi][gğ][ıi]|balina\s+k[öo]pekbal[ıi][gğ][ıi]|y[ıi]lan\s+kartal[ıi]?)(?=[^\p{L}]|$)/iu,
    label: 'Genel hayvan grubu',
    suggestions: ['Kelaynak (Geronticus eremita)', 'Toros Kurbağası (Rana holtzi)', 'Büyük Beyaz Köpekbalığı (Carcharodon carcharias)'],
  },
];

function stripTurkishNounSuffixes(word: string): string[] {
  const lower = word.toLocaleLowerCase('tr-TR').trim();
  const variants = new Set<string>([lower]);

  // Türkçe iyelik / hal / çoğul ekleri için kademeli temizleme
  const suffixes = [
    'larının', 'lerinin', 'larından', 'lerinden', 'larına', 'lerine',
    'ların', 'lerin', 'ları', 'leri', 'lar', 'ler',
    'sının', 'sinin', 'sunun', 'sünün', 'sını', 'sini', 'sunu', 'sünü',
    'nın', 'nin', 'nun', 'nün', 'ın', 'in', 'un', 'ün',
    'daki', 'deki', 'taki', 'teki', 'dan', 'den', 'tan', 'ten',
    'da', 'de', 'ta', 'te', 'ya', 'ye', 'yı', 'yi', 'yu', 'yü',
    'a', 'e', 'ı', 'i', 'u', 'ü', 's',
  ];

  for (const sfx of suffixes) {
    if (lower.length > sfx.length + 2 && lower.endsWith(sfx)) {
      const stem = lower.slice(0, -sfx.length);
      variants.add(stem);
      if (stem.endsWith('ğ')) {
        variants.add(stem.slice(0, -1) + 'k');
      }
      if (stem.endsWith('d')) {
        variants.add(stem.slice(0, -1) + 't');
      }
      if (stem.endsWith('b')) {
        variants.add(stem.slice(0, -1) + 'p');
      }
      if (stem.endsWith('c')) {
        variants.add(stem.slice(0, -1) + 'ç');
      }
    }
  }

  return Array.from(variants);
}

function extractLatinBinomials(text: string): string[] {
  // Kesme işaretlerini (') boşluğa çevirme; "Türkiye'deki" gibi eklerin "deki" olarak sahte Latince token üretmesini önle
  const tokens = text
    .replace(/["`.,;:!?()[\]{}]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);

  const candidates: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length - 1; i++) {
    const w1 = tokens[i];
    const w2Raw = tokens[i + 1];
    // Cins adı kesme işareti içeremez; tür epiteti sonunda Türkçe ek varsa ("arctos'un") temizle
    const w2 = w2Raw.replace(/['’][a-zA-ZçğıöşüÇĞİÖŞÜ]+$/u, '');
    // Latince ikili ad: yalnızca ASCII harflerden oluşmalı ve durak kelime olmamalı
    if (!/^[a-zA-Z]{3,25}$/.test(w1) || !/^[a-zA-Z]{3,25}$/.test(w2)) continue;
    const l1 = w1.toLowerCase();
    const l2 = w2.toLowerCase();
    if (AGENT_STOP_WORDS.has(l1) || AGENT_STOP_WORDS.has(l2)) continue;

    const formatted = `${l1.charAt(0).toUpperCase()}${l1.slice(1)} ${l2}`;
    if (!seen.has(formatted)) {
      seen.add(formatted);
      candidates.push(formatted);
    }
  }

  return candidates;
}

function extractSegmentCandidates(segment: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (c: string) => {
    const clean = c.trim();
    if (!clean || clean.length < 2) return;
    const key = clean.toLocaleLowerCase('tr-TR');
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(clean);
    }
  };

  // 1. Önce Latince ikili ad adayları (küçük harf dahil)
  for (const b of extractLatinBinomials(segment)) {
    addCandidate(b);
  }

  // 2. Uzunluk sırasına göre COMMON_TURKISH_SPECIES eşleşmeleri (örn. "su samuru", "akdeniz foku")
  const segmentLower = segment.toLocaleLowerCase('tr-TR');
  const dictEntries = Object.entries(COMMON_TURKISH_SPECIES).sort((a, b) => b[0].length - a[0].length);
  for (const [key, val] of dictEntries) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^\\p{L}])${escaped}(?:lar|ler|ları|leri|nın|nin|nun|nün|ın|in|un|ün|u|ü|ı|i|a|e|da|de)?(?:[^\\p{L}]|$)`, 'iu');
    if (regex.test(segmentLower)) {
      addCandidate(val.scientificName);
    }
  }

  // 3. Mevcut extractSpeciesAndParameters kural tabanlı yakalaması
  const legacyRuleHint = extractSpeciesAndParameters(segment, 'TR');
  if (legacyRuleHint.foundSpecies && legacyRuleHint.resolvedScientificName) {
    addCandidate(legacyRuleHint.resolvedScientificName);
  }

  // 4. Durak kelimeleri ve ekleri temizleyerek kalan ifadelerden dinamik aday üret
  const rawTokens = segment
    .replace(/['’"`.,;:!?()[\]{}]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !/^\d+$/.test(t));

  const contentTokens: string[] = [];
  for (const token of rawTokens) {
    const lowerToken = token.toLocaleLowerCase('tr-TR');
    if (AGENT_STOP_WORDS.has(lowerToken)) continue;
    // Gövdeye indirilmiş formu da durak kelime mi kontrol et (örn. "gözlemlerini")
    const stems = stripTurkishNounSuffixes(lowerToken);
    if (stems.some(st => AGENT_STOP_WORDS.has(st))) continue;
    contentTokens.push(token);
  }

  if (contentTokens.length > 0) {
    // Çok kelimeli içerik öbeğini ve 2'li/1'li pencereleri dene
    if (contentTokens.length <= 4) {
      addCandidate(contentTokens.join(' '));
    }
    for (let len = Math.min(3, contentTokens.length); len >= 1; len--) {
      for (let i = 0; i <= contentTokens.length - len; i++) {
        const slice = contentTokens.slice(i, i + len);
        if (len === 1) {
          for (const stem of stripTurkishNounSuffixes(slice[0])) {
            if (!AGENT_STOP_WORDS.has(stem) && stem.length >= 3) {
              addCandidate(stem);
            }
          }
        } else {
          // Son kelimenin çekim ekini de soyarak dene (örn: "su samurunu" -> "su samuru")
          const lastStems = stripTurkishNounSuffixes(slice[slice.length - 1]);
          addCandidate(slice.join(' '));
          for (const ls of lastStems) {
            if (!AGENT_STOP_WORDS.has(ls)) {
              addCandidate([...slice.slice(0, -1), ls].join(' '));
            }
          }
        }
      }
    }
  }

  return candidates;
}

export async function resolveAgentResearchQuery(
  rawQuery: string,
  defaultCountry: string = 'TR'
): Promise<AgentQueryResolution> {
  const text = (rawQuery || '').trim();
  if (!text) {
    return {
      foundSpecies: false,
      requiresClarification: true,
      isComparison: false,
      error: 'Lütfen bir araştırma görevi veya soru girin.',
    };
  }

  const normalized = text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035']/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Ülke / Coğrafya parametresi
  let country = defaultCountry === 'TR' ? 'Türkiye' : 'Küresel / Tüm Dünya';
  let countryCode = defaultCountry === 'TR' ? 'TR' : '';

  if (/\b(küresel|kuresel|dünya(?:'da|da|'daki|daki|\s+genelinde)?|global|worldwide|tüm\s+dünya)\b/iu.test(normalized)) {
    country = 'Küresel / Tüm Dünya';
    countryCode = '';
  } else if (/\b(türkiye(?:'deki|deki|'de|de|'ye|ye|'yi|yi)?|turkey|anadolu(?:'da|da)?)\b/iu.test(normalized)) {
    country = 'Türkiye';
    countryCode = 'TR';
  }

  // 2. Tarih aralığı
  const currentYear = new Date().getFullYear();
  let startYear: number | undefined;
  let endYear: number | undefined;
  let dateRangeText = 'Tüm Tarihsel Kayıtlar (GBIF Arşivi)';

  const lastNYearsMatch = normalized.match(/\bson\s+(\d+|on|beş|yirmi|üç|iki)\s+yıl(?:lık|da|daki|dan|den|ın|in|ı|i)?\b/iu);
  if (lastNYearsMatch) {
    let numYears = 10;
    const word = lastNYearsMatch[1].toLocaleLowerCase('tr-TR');
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

  if (!startYear) {
    const rangeMatch = normalized.match(/\b(19\d\d|20\d\d)\s*(?:[-–—/]|ile|ve)\s*(19\d\d|20\d\d)\b/iu);
    if (rangeMatch) {
      startYear = parseInt(rangeMatch[1], 10);
      endYear = parseInt(rangeMatch[2], 10);
      if (startYear > endYear) [startYear, endYear] = [endYear, startYear];
      dateRangeText = `${startYear} – ${endYear} Yılları Arası`;
    }
  }

  if (!startYear) {
    const afterMatch = normalized.match(/\b(19\d\d|20\d\d)\s*(?:yılından\s+sonra|sonrası|itibaren)\b/iu);
    if (afterMatch) {
      startYear = parseInt(afterMatch[1], 10);
      endYear = currentYear;
      dateRangeText = `${startYear} Yılından Günümüze`;
    }
  }

  // 3. Analiz tipi ve karşılaştırma niyeti
  const isComparison = /(?:^|[^\p{L}])(karşılaştır|kıyasla|kıyas|farkı|farkları|vs|versus)(?=[^\p{L}]|$)/iu.test(normalized);
  const analysisType = isComparison
    ? 'Karşılaştırmalı tür ve dağılım analizi'
    : /(?:^|[^\p{L}])(yıllara\s+göre|zamansal|yıllık|değişim|trend|artış|azalış)(?=[^\p{L}]|$)/iu.test(normalized)
      ? 'Yıllık gözlem sayıları ve zamansal trend analizi'
      : 'Genel biyoçeşitlilik ve arşiv kayıt analizi';

  const geographicScope = /(?:^|[^\p{L}])(il|iller|bölge|bölgeler|dağılım|nerede|yoğunluk|sıcak\s+nokta)(?=[^\p{L}]|$)/iu.test(normalized)
    ? 'En fazla kayıt bulunan iller ve coğrafi sıcak noktalar'
    : 'Ulusal ve bölgesel coğrafi dağılım';

  // 4. Belirsiz genel yaygın ad kontrolü (Latince binominal yoksa)
  const rawBinomials = extractLatinBinomials(normalized);
  if (rawBinomials.length === 0) {
    for (const amb of AMBIGUOUS_GENERIC_ANIMALS) {
      if (amb.pattern.test(normalized) && (!amb.qualifierPattern || !amb.qualifierPattern.test(normalized))) {
        return {
          foundSpecies: false,
          requiresClarification: true,
          isComparison,
          error: `"${amb.label}" ifadesi birden fazla farklı türü kapsayabilir. Yanlış bir türe yönlendirmemek için lütfen incelemek istediğiniz türü netleştirin. Örnekler: ${amb.suggestions.join(', ')}.`,
        };
      }
    }
  }

  // 5. Çoklu tür/karşılaştırma cümlelerini segmentlere ayırarak adayları GBIF Backbone ile doğrula
  const clauses = normalized
    .split(/(?:,|\s+(?:ve|ile|vs|versus)\s+|\/)/iu)
    .map(c => c.trim())
    .filter(Boolean);

  const resolvedList: ResolvedAgentSpecies[] = [];
  const seenKeys = new Set<number>();

  const verifyAndCollect = async (candidates: string[], maxForClause = 1) => {
    let foundInClause = 0;
    for (const cand of candidates) {
      if (foundInClause >= maxForClause) break;
      const matched = await matchSpecies(cand);
      if (matched && matched.isMatched === true && matched.usageKey) {
        if (!seenKeys.has(matched.usageKey)) {
          seenKeys.add(matched.usageKey);
          resolvedList.push({
            scientificName: matched.scientificName,
            canonicalName: matched.canonicalName,
            turkishName: matched.turkishName || matched.canonicalName,
            usageKey: matched.usageKey,
          });
          foundInClause++;
        }
      }
    }
  };

  if (clauses.length > 1) {
    for (const clause of clauses) {
      const clauseCandidates = extractSegmentCandidates(clause);
      await verifyAndCollect(clauseCandidates, 1);
      if (resolvedList.length >= 2) break;
    }
  }

  if (resolvedList.length === 0 || (isComparison && resolvedList.length < 2)) {
    const fullCandidates = extractSegmentCandidates(normalized);
    await verifyAndCollect(fullCandidates, isComparison ? 2 - resolvedList.length : 1);
  }

  // 6. Eşleşme bulunamadıysa kesinlikle sahte taxonKey/bilimsel ad üretme!
  if (resolvedList.length === 0) {
    return {
      foundSpecies: false,
      requiresClarification: true,
      isComparison,
      error:
        'Sorgunuzdaki canlı türü GBIF Backbone taksonomisinde doğrulanamadı. Lütfen geçerli bir Türkçe, İngilizce veya bilimsel tür adı belirtin (Örn: Bozayı, Kızıl Tilki, Su samuru, Panthera tigris, Lynx lynx).',
    };
  }

  const primarySpecies = resolvedList[0];
  const secondarySpecies = resolvedList.length >= 2 ? resolvedList[1] : undefined;

  return {
    foundSpecies: true,
    requiresClarification: false,
    isComparison: Boolean(secondarySpecies),
    primarySpecies,
    secondarySpecies,
    parameters: {
      speciesName: primarySpecies.turkishName,
      scientificName: primarySpecies.canonicalName || primarySpecies.scientificName,
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

// Research Agent API Endpoint
app.post('/api/agent/research', async (req: Request, res: Response): Promise<void> => {
  const { query, country = 'TR' } = req.body;

  if (!query || typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'Lütfen bir araştırma görevi veya soru girin.' });
    return;
  }

  const userQuery = query.trim();
  const steps: AgentExecutionStep[] = [];

  const addStep = (title: string, detail: string, status: AgentExecutionStep['status'] = 'completed') => {
    steps.push({
      id: `step-${steps.length + 1}`,
      title,
      detail,
      status,
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
  };

  addStep('Görev Analizi Başlatıldı', `Kullanıcı sorgusu: "${userQuery}" inceleniyor.`, 'in_progress');

  // Adım 1: Doğal dil sorgusundan parametreleri ayıkla ve GBIF Backbone ile doğrula
  let resolution: AgentQueryResolution;
  try {
    resolution = await resolveAgentResearchQuery(userQuery, country);
  } catch (resolveErr: any) {
    console.error('Query resolution error:', resolveErr);
    addStep('Tür Doğrulama Hatası', 'GBIF Backbone doğrulaması sırasında bir hata oluştu.', 'failed');
    res.status(500).json({
      success: false,
      error: 'Tür doğrulama servisine erişilirken bir hata oluştu: ' + (resolveErr?.message || 'Bilinmeyen hata'),
      steps,
    });
    return;
  }

  // Kural: Tür tespit edilemiyorsa veya belirsizse uydurma taxonKey / rapor üretme!
  if (!resolution.foundSpecies || !resolution.parameters || !resolution.primarySpecies) {
    addStep('Tür Netleştirme Gerekiyor', resolution.error || 'Canlı türü doğrulanamadı.', 'failed');
    res.json({
      success: false,
      requiresClarification: true,
      error: resolution.error,
      steps,
      analysis: null,
      speciesName: null,
      parameters: null,
      agentMode: 'input_validation',
    });
    return;
  }

  const params: ResearchParameters = resolution.parameters;
  const targetDetail = resolution.secondarySpecies
    ? `1. Tür: ${resolution.primarySpecies.turkishName} (${resolution.primarySpecies.canonicalName} · #${resolution.primarySpecies.usageKey}) & 2. Tür: ${resolution.secondarySpecies.turkishName} (${resolution.secondarySpecies.canonicalName} · #${resolution.secondarySpecies.usageKey})`
    : `Tür: ${params.speciesName} (${params.scientificName} · #${resolution.primarySpecies.usageKey})`;

  addStep(
    'GBIF Backbone ile Parametreler Doğrulandı',
    `${targetDetail} | Coğrafya: ${params.country} (${params.countryCode || 'Global'}) | Tarih: ${params.dateRangeText}`
  );

  // Adım 2: GBIF'ten gerçek verileri çek
  let primaryAnalysis: SpeciesAnalysis | null = null;
  let secondaryAnalysis: SpeciesAnalysis | null = null;

  try {
    addStep(
      'GBIF Açık Bilim Sorgusu Yapılıyor',
      `GBIF API üzerinden ${params.scientificName} için veriler getiriliyor (Filtre: ${params.dateRangeText}, Coğrafya: ${params.countryCode || 'Global'})...`,
      'in_progress'
    );

    primaryAnalysis = await fetchSpeciesAnalysis(params.scientificName, {
      countryCode: params.countryCode,
      startYear: params.startYear,
      endYear: params.endYear,
      fetchExtraPages: true,
    });

    addStep(
      'GBIF Açık Bilim Verileri Alındı',
      `Toplam ${primaryAnalysis.totalRecords} kayıt, ${primaryAnalysis.mappedRecordsCount} haritalanabilir GPS koordinatı, ${primaryAnalysis.regionalStats.length} il verisi arşivlendi.`
    );

    // Çoklu tür karşılaştırma desteği (birden fazla tür tespit edildiyse birbirine karıştırmadan ayrı çek)
    if (resolution.secondarySpecies) {
      const secSci = resolution.secondarySpecies.canonicalName || resolution.secondarySpecies.scientificName;
      try {
        addStep(
          'Karşılaştırmalı 2. Tür Analizi Başlatıldı',
          `2. Tür: ${resolution.secondarySpecies.turkishName} (${secSci}) için GBIF kayıtları getiriliyor...`,
          'in_progress'
        );
        secondaryAnalysis = await fetchSpeciesAnalysis(secSci, {
          countryCode: params.countryCode,
          startYear: params.startYear,
          endYear: params.endYear,
          fetchExtraPages: true,
        });
        addStep(
          '2. Tür Verileri Hazırlandı',
          `${secondaryAnalysis.species.turkishName || secSci}: ${secondaryAnalysis.totalRecords} kayıt, ${secondaryAnalysis.mappedRecordsCount} GPS koordinatı.`
        );
      } catch (secErr) {
        console.warn('İkinci tür çekilemedi:', secErr);
        addStep('2. Tür Verisi Alınamadı', `${secSci} için GBIF verileri çekilemedi.`, 'failed');
      }
    }
  } catch (gbifErr: any) {
    console.error('GBIF fetch error:', gbifErr);
    addStep('GBIF Bağlantı Hatası', 'GBIF API sunucularına bağlanırken bir sorun oluştu.', 'failed');
    res.status(500).json({
      success: false,
      error: 'GBIF açık bilim verilerine erişilirken bir hata oluştu: ' + (gbifErr.message || 'Bilinmeyen hata'),
      steps,
    });
    return;
  }

  // Kural: İncelenen tür(ler)de sıfır (0) kayıt bulunursa sahte rapor üretme!
  if (primaryAnalysis.totalRecords === 0 && (!secondaryAnalysis || secondaryAnalysis.totalRecords === 0)) {
    addStep('Sıfır Kayıt Bildirimi', 'GBIF arşivinde belirtilen kriterlere uygun gözlem kaydı bulunamadı.');

    const zeroRecordReport = `### ⚠️ GBIF Açık Bilim Arşivinde Kayıt Bulunamadı

- **İncelenen Tür:** ${primaryAnalysis.species.turkishName || primaryAnalysis.species.canonicalName} (*${primaryAnalysis.species.scientificName}*)
- **Hedef Coğrafya:** ${primaryAnalysis.countryName} (${params.countryCode || 'Tüm Dünya'})
- **Sorgulanan Tarih Aralığı:** ${params.dateRangeText}
- **Bulunan Toplam Kayıt:** **0 adet**

---

### 🔍 Durum ve Veri Sınırları Değerlendirmesi
GBIF (Global Biodiversity Information Facility) açık gözlem arşivinde belirtilen filtre kriterlerinde dijitalleştirilmiş gözlem kaydı bulunmamaktadır. Bu sonuç bilimsel literatür taraması veya kesin popülasyon yokluğu anlamı taşımaz; yalnızca mevcut açık veri tabanı kayıtlarını yansıtır.

**Olası Nedenler:**
1. **Coğrafi Kapsam:** Canlı türü seçilen coğrafyada doğal olarak yayılış göstermiyor olabilir.
2. **Dijital Veri Eksikliği:** Bölgedeki saha araştırmaları henüz GBIF veritabanına aktarılmamış veya vatandaş bilimi gözlemleri doğrulanmamış olabilir.
3. **Tarih Aralığı Kısıtı:** Belirtilen yıllar arasında bu canlıya ait gözlem seferi kaydedilmemiş olabilir.

---

### 💡 Çözüm ve Tavsiyeler
- Arama kapsamını sağ üstteki filtreden **"Tüm Dünya (Global)"** olarak genişleterek küresel yayılımı inceleyebilirsiniz.
- Tarih filtresini kaldırarak tüm arşiv geçmişine bakabilirsiniz.`;

    res.json({
      success: true,
      isZeroRecords: true,
      report: zeroRecordReport,
      steps,
      analysis: primaryAnalysis,
      secondaryAnalysis,
      speciesName: params.speciesName,
      parameters: params,
      agentMode: 'gbif_verified',
    });
    return;
  }

  // Adım 3: Gerçek verileri sentezle (Gemini 2.5 Flash veya GBIF Analitik Motoru)
  const rawApiKey = process.env.GEMINI_API_KEY?.trim();
  const isValidApiKey = Boolean(rawApiKey && rawApiKey.length > 15 && !rawApiKey.includes('MY_GEMINI_API_KEY'));

  if (isValidApiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: rawApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const systemInstruction = `Sen "Canlı Atlası" biyoçeşitlilik platformunun kıdemli Biyoçeşitlilik Araştırma Ajanısın (AI Research Agent).
Görevin: GBIF açık bilim veritabanından çekilmiş gerçek verileri analiz edip kullanıcıya anlaşılır, Türkçe ve dengeli bir araştırma raporu sunmaktır.

KURALLAR:
1. Asla veri, il, taxonKey, bilimsel ad veya koordinat uydurma. Yalnızca sana sağlanan gerçek GBIF analiz verilerini kullan.
2. Veri Kaynağı ve Sınırlar İlkesi: Sunulan sayılar GBIF açık gözlem ve müze kayıtlarıdır; hakemli bilimsel literatür taraması veya kesin/mutlak canlı popülasyon sayımı değildir. Vatandaş bilimi, örnekleme çabası, dijitalleşme, örneklem sınırı (en fazla 1200 kayıt indirilmesi) ve koordinatsız kayıt sayısı gibi veri sınırlarını raporda açıkça belirt.
3. Raporu şu başlıklar altında Markdown formatında ve akıcı Türkçe ile sun:
   - **🔬 1. Yönetici Özeti & Tür Kimliği** (Türkçe adı, bilimsel adı, familyası ve IUCN Kırmızı Liste statüsü)
   - **📊 2. GBIF Gözlem Trendleri & Zaman Dağılımı** (Toplam arşiv kaydı, indirilen örneklem, GPS koordinatlı sayısı, en çok gözlem yapılan zirve yılı)
   - **📍 3. Coğrafi Yayılım & Bölgesel Sıcak Noktalar** (En yoğun kayıt bulunan iller/bölgeler)
   - **🛡️ 4. Koruma Statüsü & Veri Sınırları** (IUCN durumu, GBIF açık veri sınırları ve popülasyon sayımı olmadığı notu)
   - **📌 5. Kaynaklar & Metodoloji Notu** (GBIF API v1 ve iNaturalist atıfları)
4. Eğer kullanıcı iki türü kıyaslamışsa raporuna karşılaştırma tablosu ekle.
5. Kısa, teknik ve güvenilir ol.`;

      // Helper to execute with timeout
      const withTimeout = <T>(promise: Promise<T>, ms = 12000): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('AI zaman aşımı (Timeout)')), ms)),
        ]);
      };

      const topProvinces = primaryAnalysis.regionalStats.slice(0, 5).map(r => `${r.region} (%${r.percentage.toFixed(1)})`).join(', ');

      let promptForGemini = `Araştırma Görevi: ${userQuery}
Parametreler:
- Canlı Türü: ${params.speciesName} (${params.scientificName})
- Coğrafya: ${primaryAnalysis.countryName}
- Tarih Aralığı: ${params.dateRangeText}

GBIF Gerçek Verileri (1. Tür):
- Toplam Arşiv Kaydı: ${primaryAnalysis.totalRecords}
- İndirilen Örneklem: ${primaryAnalysis.downloadedRecordsCount}
- Haritalanabilir GPS Koordinatlı: ${primaryAnalysis.mappedRecordsCount}
- Koordinatsız / Kapsam Dışı (Örneklemde): ${primaryAnalysis.unmappedRecordsCount}
- İl/Konum Bilgisi Eksik Kayıt (Arşiv): ${primaryAnalysis.unlocatedCount}
- En Çok Gözlem Yapılan Zirve Yılı: ${primaryAnalysis.peakYear ? `${primaryAnalysis.peakYear.year} (${primaryAnalysis.peakYear.count} kayıt)` : 'Belirtilmemiş'}
- En Düşük Gözlem Yılı: ${primaryAnalysis.lowestYear ? `${primaryAnalysis.lowestYear.year} (${primaryAnalysis.lowestYear.count} kayıt)` : 'Belirtilmemiş'}
- En Çok Kayıt Bulunan İller: ${topProvinces || 'Bölgesel veri kısıtlı'}
- IUCN Koruma Durumu: ${primaryAnalysis.species.iucnStatus || 'NE'} (${primaryAnalysis.species.iucnCategoryName || 'Değerlendirilmemiş'})`;

      if (secondaryAnalysis) {
        const secProvinces = secondaryAnalysis.regionalStats.slice(0, 5).map(r => `${r.region} (%${r.percentage.toFixed(1)})`).join(', ');
        promptForGemini += `\n\nGBIF Gerçek Verileri (2. Tür Karşılaştırma):
- Tür: ${secondaryAnalysis.species.turkishName || secondaryAnalysis.species.canonicalName} (${secondaryAnalysis.species.scientificName})
- Toplam Arşiv Kaydı: ${secondaryAnalysis.totalRecords}
- İndirilen Örneklem: ${secondaryAnalysis.downloadedRecordsCount}
- Haritalanabilir GPS Koordinatlı: ${secondaryAnalysis.mappedRecordsCount}
- En Çok Gözlem Yapılan Zirve Yılı: ${secondaryAnalysis.peakYear ? `${secondaryAnalysis.peakYear.year} (${secondaryAnalysis.peakYear.count} kayıt)` : 'Belirtilmemiş'}
- En Çok Kayıt Bulunan İller: ${secProvinces || 'Bölgesel veri kısıtlı'}
- IUCN Durumu: ${secondaryAnalysis.species.iucnStatus || 'NE'} (${secondaryAnalysis.species.iucnCategoryName || 'Değerlendirilmemiş'})`;
      }

      promptForGemini += `\n\nLütfen yalnızca bu doğrulanmış verilere dayanarak ve veri sınırlarını açıkça belirterek raporu oluştur.`;

      const aiResponse = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: promptForGemini }] }],
          config: { 
            systemInstruction,
            tools: [{ 
              functionDeclarations: [
                fetchGbifDataDeclaration, 
                searchSpeciesTaxonomyDeclaration, 
                compareTwoSpeciesDeclaration
              ] 
            }],
          },
        })
      );

      // Check if function calls were triggered
      if (aiResponse.functionCalls && aiResponse.functionCalls.length > 0) {
        addStep('Yapay Zekâ Araç Çağrısı Gerçekleştirildi', `${aiResponse.functionCalls.map(f => f.name).join(', ')} araçları çalıştırıldı.`);
        
        const functionResponses = await Promise.all(
          aiResponse.functionCalls.map(async (call) => {
            let resData: any = {};
            if (call.name === 'searchSpeciesTaxonomy') {
              const spName = (call.args as any)?.speciesName || params.scientificName;
              resData = await matchSpecies(spName);
            } else if (call.name === 'fetchGbifSpeciesData') {
              const spName = (call.args as any)?.scientificOrCommonName || params.scientificName;
              resData = await fetchSpeciesAnalysis(spName, {
                countryCode: (call.args as any)?.countryCode || params.countryCode,
                startYear: (call.args as any)?.startYear,
                endYear: (call.args as any)?.endYear,
              });
            } else if (call.name === 'compareTwoSpecies') {
              const spA = (call.args as any)?.speciesA || params.scientificName;
              const spB = (call.args as any)?.speciesB || 'Canis lupus';
              const [dA, dB] = await Promise.all([
                fetchSpeciesAnalysis(spA, { countryCode: params.countryCode }),
                fetchSpeciesAnalysis(spB, { countryCode: params.countryCode }),
              ]);
              resData = {
                speciesA: { name: spA, records: dA.totalRecords, mapped: dA.mappedRecordsCount },
                speciesB: { name: spB, records: dB.totalRecords, mapped: dB.mappedRecordsCount },
              };
            }
            return {
              name: call.name,
              response: { result: resData },
            };
          })
        );

        const candidateContent = aiResponse.candidates?.[0]?.content || {
          role: 'model',
          parts: [{ text: '' }],
        };

        // Turn 2
        const secondTurn = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              { role: 'user', parts: [{ text: promptForGemini }] },
              candidateContent,
              {
                role: 'user',
                parts: functionResponses.map(fr => ({
                  functionResponse: {
                    name: fr.name,
                    response: fr.response,
                  },
                })),
              },
            ],
            config: { systemInstruction },
          })
        );

        if (secondTurn.text && secondTurn.text.trim().length > 100) {
          addStep('Akademik Sentez Tamamlandı', 'Gemini 2.5 Flash çok adımlı fonksiyon çağırma (Function Calling) ile raporu derledi.');
          res.json({
            success: true,
            report: secondTurn.text,
            steps,
            analysis: primaryAnalysis,
            secondaryAnalysis,
            speciesName: params.speciesName,
            parameters: params,
            agentMode: 'gemini_function_calling',
          });
          return;
        }
      }

      const aiText = aiResponse.text;
      if (aiText && aiText.trim().length > 100) {
        addStep('Bilimsel Araştırma Raporu Sentezlendi', 'Gemini 2.5 Flash yapay zekâ modeli ile akademik sentez tamamlandı.');
        res.json({
          success: true,
          report: aiText,
          steps,
          analysis: primaryAnalysis,
          secondaryAnalysis,
          speciesName: params.speciesName,
          parameters: params,
          agentMode: 'gemini_function_calling',
        });
        return;
      }
    } catch (aiError) {
      console.warn('Gemini generation fallback triggered:', aiError);
      addStep('GBIF Analitik Motoru Devreye Alındı', 'Doğrudan GBIF bilimsel veri analiz motoru ile rapor derleniyor.');
    }
  }

  // Fallback Engine: Deterministic scientific report directly from live GBIF verified data
  const s = primaryAnalysis.species;
  const name = params.speciesName;
  const topRegionsText = primaryAnalysis.regionalStats.slice(0, 5)
    .map((r, i) => `${i + 1}. **${r.region}** (${r.count} kayıt - %${r.percentage.toFixed(1)})`)
    .join('\n');
  const peakText = primaryAnalysis.peakYear 
    ? `${primaryAnalysis.peakYear.year} yılı (${primaryAnalysis.peakYear.count} gözlem)` 
    : 'Veri yetersiz';

  const mappedRatePct = primaryAnalysis.downloadedRecordsCount > 0
    ? Math.round((primaryAnalysis.mappedRecordsCount / primaryAnalysis.downloadedRecordsCount) * 100)
    : 0;

  let deterministicReport = `### 🔬 1. Yönetici Özeti & Tür Kimliği
- **Türkçe Adı:** ${name}
- **Bilimsel Adı:** *${s.scientificName}*
- **Sınıflandırma:** ${s.kingdom || 'Animalia'} › ${s.phylum || 'Chordata'} › ${s.family || 'Familya'}
- **IUCN Kırmızı Liste Durumu:** **${s.iucnStatus || 'NE'}** (${s.iucnCategoryName || 'Değerlendirilmemiş'})
- **Birincil Veri Kaynakları:** GBIF Açık Bilim Ağı (API v1) & iNaturalist Taksonomi Arşivi

---

### 📊 2. GBIF Gözlem Trendleri & Zaman Dağılımı (${primaryAnalysis.countryName})
- **Sorgulanan Tarih Aralığı:** ${params.dateRangeText}
- **Toplam GBIF Arşiv Kaydı:** ${primaryAnalysis.totalRecords.toLocaleString('tr-TR')} adet
- **İndirilen Örneklem:** ${primaryAnalysis.downloadedRecordsCount.toLocaleString('tr-TR')} adet (${primaryAnalysis.mappedRecordsCount.toLocaleString('tr-TR')} haritalanabilir GPS · %${mappedRatePct}, ${primaryAnalysis.unmappedRecordsCount.toLocaleString('tr-TR')} koordinatsız/kapsam dışı)
- **Konum/İl Bilgisi Eksik Kayıt (Arşiv):** ${primaryAnalysis.unlocatedCount.toLocaleString('tr-TR')} adet
- **En Yüksek Gözlem Kaydı (Zirve):** **${peakText}**

---

### 📍 3. Coğrafi Yayılım & Bölgesel Sıcak Noktalar
${primaryAnalysis.countryName} genelinde en fazla gözlem kaydı bulunan ilk 5 il/bölge:
${topRegionsText || 'Bölgesel veri bulunamadı.'}`;

  if (secondaryAnalysis) {
    const s2 = secondaryAnalysis.species;
    const name2 = s2.turkishName || s2.canonicalName;
    const topRegions2 = secondaryAnalysis.regionalStats.slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.region} (${r.count} kayıt)`)
      .join(', ');

    deterministicReport += `\n\n---

### ⚖️ 4. Karşılaştırmalı Biyoçeşitlilik Özeti (${name} vs ${name2})
- **Toplam Kayıt Karşılaştırması:** ${name}: **${primaryAnalysis.totalRecords.toLocaleString('tr-TR')} adet** | ${name2}: **${secondaryAnalysis.totalRecords.toLocaleString('tr-TR')} adet**
- **GPS Koordinatlı Kayıt (Örneklem):** ${name}: ${primaryAnalysis.mappedRecordsCount} / ${primaryAnalysis.downloadedRecordsCount} | ${name2}: ${secondaryAnalysis.mappedRecordsCount} / ${secondaryAnalysis.downloadedRecordsCount}
- **IUCN Durumu:** ${name}: ${s.iucnStatus || 'NE'} | ${name2}: ${s2.iucnStatus || 'NE'}
- **Öne Çıkan İller (${name2}):** ${topRegions2 || 'Veri kısıtlı'}`;
  }

  deterministicReport += `\n\n---

### 🛡️ ${secondaryAnalysis ? '5' : '4'}. Koruma Statüsü & Ekolojik Değerlendirme
*${s.scientificName}* türü, habitat bütünlüğü ve ekolojik koruma koridorları açısından izlenmesi gereken bir taksondur. Doğrulanmış GPS noktaları etkileşimli harita üzerinde incelenebilir.

---

### 📌 ${secondaryAnalysis ? '6' : '5'}. Veri Kaynakları, Sınırlar ve Metodoloji Notu
- **Kapsam Sınırı:** Bu rapor hakemli bilimsel literatür taraması veya kesin canlı popülasyon sayımı değildir; yalnızca GBIF açık veri tabanına aktarılmış gözlem ve müze kayıtlarını özetler.
- **Örnekleme & Yanlılık:** Yıllık ve bölgesel farklar doğal popülasyon büyüklüğünün yanı sıra vatandaş bilimi katılımı, saha seferlerinin sıklığı ve dijital veri paylaşımına bağlıdır.
- **Örneklem Sınırı:** Arşivde 1.200'den fazla kayıt olduğunda ayrıntılı GPS ve tablo incelemesi ilk 1.200 kayıtlık örneklem üzerinden yürütülür; yıllık ve bölgesel özetler GBIF arşiv facet verisinden hesaplanır.`;

  addStep('Analitik Sentez Raporu Tamamlandı', 'Tüm parametreler ve bölgesel yoğunluklar GBIF motoruyla hesaplandı.');

  res.json({
    success: true,
    report: deterministicReport,
    steps,
    analysis: primaryAnalysis,
    secondaryAnalysis,
    speciesName: name,
    parameters: params,
    agentMode: 'deterministic_gbif',
  });
});

// Direct Species Query Endpoint
app.get('/api/species/:name', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  const country = (req.query.country as string) || 'TR';
  const startYear = req.query.startYear ? parseInt(req.query.startYear as string, 10) : undefined;
  const endYear = req.query.endYear ? parseInt(req.query.endYear as string, 10) : undefined;

  try {
    const analysis = await fetchSpeciesAnalysis(name, {
      countryCode: country === 'GLOBAL' ? '' : country,
      startYear,
      endYear,
      fetchExtraPages: true,
    });
    res.json(analysis);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Tür verileri alınamadı.' });
  }
});

// Direct Species Taxonomy Match Endpoint
app.get('/api/species/match/:name', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.params;
  try {
    const matched = await matchSpecies(name);
    res.json(matched);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Tür eşleştirilemedi.' });
  }
});

// Direct Side-by-Side Species Comparison Endpoint
app.post('/api/species/compare', async (req: Request, res: Response): Promise<void> => {
  const { speciesA, speciesB, country = 'TR' } = req.body;
  if (!speciesA || !speciesB) {
    res.status(400).json({ error: 'Lütfen karşılaştırılacak iki canlı türünü belirtin.' });
    return;
  }
  try {
    const [analysisA, analysisB] = await Promise.all([
      fetchSpeciesAnalysis(speciesA, { countryCode: country === 'GLOBAL' ? '' : country }),
      fetchSpeciesAnalysis(speciesB, { countryCode: country === 'GLOBAL' ? '' : country }),
    ]);
    res.json({
      success: true,
      speciesA: analysisA,
      speciesB: analysisB,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Karşılaştırma verisi alınamadı.' });
  }
});

function isSafeExternalImageUrl(rawUrl: string): boolean {
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

// Server-side Image Verification (status + Content-Type + magic bytes, zero browser CORS errors)
app.get('/api/media/verify', async (req: Request, res: Response): Promise<void> => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!rawUrl || !isSafeExternalImageUrl(rawUrl)) {
    res.json({
      verified: false,
      status: 0,
      contentType: null,
      magicType: null,
      reason: 'INVALID_OR_UNSAFE_URL',
    } satisfies ImageAssetVerificationResult);
    return;
  }
  try {
    const result = await verifyImageAssetUrl(rawUrl, 5500, isSafeExternalImageUrl);
    res.json(result);
  } catch {
    res.json({
      verified: false,
      status: 0,
      contentType: null,
      magicType: null,
      reason: 'VERIFY_ERROR',
    } satisfies ImageAssetVerificationResult);
  }
});

app.post('/api/media/verify-batch', async (req: Request, res: Response): Promise<void> => {
  const urlsInput: unknown[] = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const filteredUrls: string[] = urlsInput
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map((u) => u.trim());
  const uniqueUrls: string[] = Array.from(new Set<string>(filteredUrls)).slice(0, 24);

  const results: Record<string, ImageAssetVerificationResult> = {};
  const validUrls: string[] = [];

  for (const u of uniqueUrls) {
    if (!isSafeExternalImageUrl(u)) {
      results[u] = {
        verified: false,
        status: 0,
        contentType: null,
        magicType: null,
        reason: 'INVALID_OR_UNSAFE_URL',
      };
    } else {
      validUrls.push(u);
    }
  }

  const concurrency = 8;
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, validUrls.length) }, async () => {
    while (idx < validUrls.length) {
      const current = validUrls[idx++];
      try {
        results[current] = await verifyImageAssetUrl(current, 5500, isSafeExternalImageUrl);
      } catch {
        results[current] = {
          verified: false,
          status: 0,
          contentType: null,
          magicType: null,
          reason: 'VERIFY_ERROR',
        };
      }
    }
  });

  await Promise.all(workers);
  res.json({ results });
});

// Start Full-Stack Server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Development mode: Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve static build
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Canlı Atlası] Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
  });
}

// Export Express app for Vercel serverless runtime
export default app;

// Only start standalone HTTP server when not in serverless Vercel environment
if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Server başlatılamadı:', err);
  });
}

