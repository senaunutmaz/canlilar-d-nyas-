import React, { useState } from 'react';
import { SpeciesAnalysis, ResearchParameters } from '../types/biodiversity';
import { 
  Bot, 
  Sparkles, 
  Send, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  ChevronRight, 
  Layers, 
  MapPin, 
  TrendingUp, 
  ShieldCheck, 
  ExternalLink, 
  RotateCcw, 
  Loader2,
  FileText,
  Compass,
  ArrowRight,
  HelpCircle,
  Calendar,
  Filter,
  Check
} from 'lucide-react';

interface AgentExecutionStep {
  id: string;
  title: string;
  detail: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: string;
}

interface AgentResearchResponse {
  success: boolean;
  requiresClarification?: boolean;
  isZeroRecords?: boolean;
  report?: string;
  error?: string;
  steps: AgentExecutionStep[];
  analysis: SpeciesAnalysis | null;
  secondaryAnalysis?: SpeciesAnalysis | null;
  speciesName: string | null;
  parameters?: ResearchParameters | null;
  agentMode: string;
}

interface ResearchAgentProps {
  onLoadSpeciesToAtlas: (scientificName: string, country?: string) => void;
  activeSpeciesName?: string;
}

const PRESET_QUERIES = [
  {
    label: 'Test 1: Bozayı 10 Yıllık GBIF Analizi',
    query: "Türkiye'deki boz ayıların son 10 yıllık GBIF gözlem kayıtlarını araştır. En fazla kayıt bulunan illeri belirle ve yıllara göre değişimi açıkla.",
  },
  {
    label: 'Test 2: Vaşak Yıllık Dağılımı',
    query: "Türkiye'de vaşak gözlemlerinin yıllara göre dağılımını incele.",
  },
  {
    label: 'Test 3: Caretta caretta Dağılımı',
    query: "Türkiye'deki Caretta caretta gözlem kayıtlarını ve coğrafi dağılımını araştır.",
  },
  {
    label: 'Test 4: Son 10 Yılda Bozayı Yoğunluğu',
    query: "Son 10 yılda Türkiye'de en fazla gözlemlenen bozayı kayıtlarının hangi bölgelerde olduğunu bul.",
  },
  {
    label: 'Akdeniz Foku Kıyı Kayıtları',
    query: "Kritik tehlikedeki Akdeniz Foku (Monachus monachus) için kıyı gözlem kayıtlarını ve koruma durumunu analiz et",
  },
];

const QUICK_SPECIES_OPTIONS = [
  { name: 'Bozayı', sci: 'Ursus arctos' },
  { name: 'Bayağı Vaşak', sci: 'Lynx lynx' },
  { name: 'Bozkurt', sci: 'Canis lupus' },
  { name: 'Caretta caretta', sci: 'Caretta caretta' },
  { name: 'Akdeniz Foku', sci: 'Monachus monachus' },
  { name: 'Toros Kurbağası', sci: 'Rana holtzi' },
  { name: 'Kelaynak', sci: 'Geronticus eremita' },
];

export const ResearchAgent: React.FC<ResearchAgentProps> = ({ onLoadSpeciesToAtlas, activeSpeciesName }) => {
  const [prompt, setPrompt] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('TR');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResearchResponse | null>(null);

  const handleExecuteResearch = async (queryToRun?: string) => {
    const finalQuery = (queryToRun || prompt).trim();
    if (!finalQuery) return;

    if (queryToRun) {
      setPrompt(queryToRun);
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/agent/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: finalQuery, country: selectedCountry }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Ajan araştırması yürütülemedi.');
      }

      const data: AgentResearchResponse = await response.json();
      setResult(data);
    } catch (err: any) {
      console.error('Agent research failed:', err);
      setErrorMessage(err.message || 'Ajan bağlantısında bir aksaklık oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  const getEngineBadge = (mode: string) => {
    switch (mode) {
      case 'gemini_function_calling':
        return {
          label: 'Gemini 2.5 Flash (Yapay Zekâ Ajanı - Function Calling)',
          color: 'text-[#1E5E4C] border-[#8CCFB0] bg-[#DDEFE3]',
        };
      case 'deterministic_gbif':
        return {
          label: 'GBIF Bilimsel Analitik Motoru (Doğrudan Çözümleyici)',
          color: 'text-[#1B576E] border-[#B9DDEB] bg-[#ECF6FA]',
        };
      case 'gbif_verified':
        return {
          label: 'GBIF Açık Bilim Doğrulanmış Kayıt Motoru',
          color: 'text-[#6E4716] border-[#F3D9B5] bg-[#FDF6EC]',
        };
      default:
        return {
          label: 'Canlı Atlası Analiz Motoru',
          color: 'text-[#1E5E4C] border-[#8CCFB0] bg-[#DDEFE3]',
        };
    }
  };

  return (
    <section id="ajan" className="bg-white border border-[#D6E4DC] rounded-3xl p-6 sm:p-8 lg:p-10 shadow-sm relative overflow-hidden">
      {/* Header with Agent Identity */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-[#E6EFEA]">
        <div className="flex items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#247A63] flex items-center justify-center text-white shadow-sm shrink-0">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-2xl font-extrabold text-[#1E332B] tracking-tight flex items-center gap-2">
                <span>Biyoçeşitlilik Araştırma Ajanı</span>
              </h2>
              <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#DDEFE3] text-[#247A63] border border-[#8CCFB0] flex items-center gap-1 font-semibold">
                <Sparkles className="w-3 h-3 text-[#247A63]" />
                <span>AI Agent & GBIF Engine</span>
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#556B62] max-w-2xl">
              Doğal dildeki araştırma talebinizi ayrıştırır; canlı türünü, hedef bölgeyi ve tarih aralığını tespit ederek GBIF açık bilim veritabanından doğrulanmış gözlem kayıtlarını çeker ve akademik sentez raporu üretir.
            </p>
          </div>
        </div>

        {/* Coğrafya Filtresi */}
        <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
          <span className="text-xs text-[#556B62] font-medium">Hedef Bölge:</span>
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            className="px-3 py-1.5 bg-[#F5F9F4] text-xs text-[#1E332B] rounded-xl border border-[#D6E4DC] focus:outline-none focus:border-[#247A63] font-medium cursor-pointer"
          >
            <option value="TR">Türkiye (TR)</option>
            <option value="">Tüm Dünya (Global)</option>
          </select>
        </div>
      </div>

      {/* Preset Quick Research Chips */}
      <div className="py-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[#247A63] flex items-center gap-1 shrink-0 mr-1">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Hazır Araştırma Görevleri:</span>
        </span>
        {PRESET_QUERIES.map((preset) => (
          <button
            key={preset.label}
            onClick={() => handleExecuteResearch(preset.query)}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded-xl bg-[#F5F9F4] hover:bg-[#DDEFE3] border border-[#D6E4DC] hover:border-[#8CCFB0] text-[#1E332B] hover:text-[#247A63] transition-all cursor-pointer disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Agent Search Console */}
      <div className="mt-2 mb-6">
        <div className="relative rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC] p-2 flex flex-col sm:flex-row items-stretch gap-2 focus-within:border-[#247A63] transition-colors">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleExecuteResearch();
              }
            }}
            placeholder="Ajan için araştırma görevi yazın... (Örn: Türkiye'deki boz ayıların son 10 yıllık GBIF gözlem kayıtlarını araştır. En fazla kayıt bulunan illeri belirle ve yıllara göre değişimi açıkla.)"
            rows={2}
            className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-[#1E332B] focus:outline-none placeholder-[#556B62]/65 resize-none font-sans"
          />

          <div className="flex sm:flex-col justify-end gap-2 shrink-0">
            <button
              onClick={() => handleExecuteResearch()}
              disabled={isLoading || !prompt.trim()}
              className="px-6 py-2.5 sm:py-0 rounded-xl bg-[#247A63] hover:bg-[#1D6350] text-white text-xs sm:text-sm font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Araştırılıyor...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Görevi Yürüt</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Clarification Alert */}
      {!isLoading && result && result.requiresClarification && (
        <div className="mb-6 p-6 rounded-2xl bg-[#FDF6EC] border border-[#F3D9B5] space-y-4">
          <div className="flex items-start gap-3">
            <HelpCircle className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-[#59380D] mb-1">Araştırılacak Canlı Türü Tespit Edilemedi</h4>
              <p className="text-xs text-[#6E4716] leading-relaxed">
                {result.error || 'Yazdığınız cümlede doğrulanmış bir canlı türü tespit edilemedi. Lütfen incelemek istediğiniz türü belirterek yeniden deneyin.'}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-[#F3D9B5]">
            <p className="text-xs font-semibold text-[#59380D] mb-2">Hızlıca araştırabileceğiniz yaygın türler:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_SPECIES_OPTIONS.map((spec) => (
                <button
                  key={spec.sci}
                  onClick={() => handleExecuteResearch(`Türkiye'deki ${spec.name} (${spec.sci}) gözlem kayıtlarını ve bölgesel dağılımını araştır.`)}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#DDEFE3]/60 border border-[#F3D9B5] text-[#1E332B] text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-[#9A631A]" />
                  <span>{spec.name}</span>
                  <span className="italic text-[10px] text-[#556B62]">({spec.sci})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading Animation HUD */}
      {isLoading && (
        <div className="py-12 px-6 rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC] flex flex-col items-center justify-center text-center space-y-4 my-6">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-[#DDEFE3] border-t-[#247A63] animate-spin" />
            <Bot className="w-7 h-7 text-[#247A63] absolute inset-0 m-auto" />
          </div>
          <div>
            <h4 className="text-base font-bold text-[#1E332B] mb-1">Ajan Araştırmayı Yürütüyor</h4>
            <p className="text-xs text-[#556B62] max-w-md">
              Doğal dil sorgusu ayrıştırılıyor, GBIF API'sinden canlı bilimsel veriler ve koordinatlar çekiliyor...
            </p>
          </div>
        </div>
      )}

      {/* Results View */}
      {!isLoading && result && !result.requiresClarification && (
        <div className="space-y-6 pt-2">
          
          {/* Agent Workflow Execution Audit Trail */}
          {result.steps && result.steps.length > 0 && (
            <div className="bg-[#F5F9F4] border border-[#D6E4DC] rounded-2xl p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <h3 className="text-xs font-mono uppercase tracking-wider text-[#247A63] font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#247A63]" />
                  <span>Ajan Çalışma Akışı & Doğrulama Adımları ({result.steps.length} Adım)</span>
                </h3>
                
                <span className={`text-[11px] font-mono px-3 py-1 rounded-full border font-semibold ${getEngineBadge(result.agentMode).color}`}>
                  {getEngineBadge(result.agentMode).label}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {result.steps.map((step, idx) => (
                  <div key={step.id} className="p-3 bg-white rounded-xl border border-[#D6E4DC] flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#247A63] font-semibold mb-1">
                        <span>Adım {idx + 1}</span>
                        <span>{step.timestamp}</span>
                      </div>
                      <p className="text-xs font-bold text-[#1E332B] mb-1">{step.title}</p>
                      <p className="text-[11px] text-[#556B62] leading-relaxed line-clamp-2">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extracted Research Parameters HUD Card */}
          {result.parameters && (
            <div className="bg-[#F5F9F4] border border-[#D6E4DC] rounded-2xl p-5">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#247A63] font-bold mb-3">
                <Filter className="w-4 h-4 text-[#247A63]" />
                <span>Ayrıştırılan Araştırma Parametreleri</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-white border border-[#D6E4DC]">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-0.5">
                    Hedef Canlı Türü
                  </span>
                  <p className="text-xs font-bold text-[#1E332B] truncate">
                    {result.parameters.speciesName}
                  </p>
                  <span className="text-[10px] italic font-serif text-[#556B62] block">
                    {result.parameters.scientificName}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-[#D6E4DC]">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-0.5">
                    Hedef Coğrafya
                  </span>
                  <p className="text-xs font-bold text-[#1E332B]">
                    {result.parameters.country}
                  </p>
                  <span className="text-[10px] font-mono text-[#556B62] block">
                    ISO Kodu: {result.parameters.countryCode || 'Global (Tüm Dünya)'}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-[#D6E4DC]">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-0.5">
                    Tarih Aralığı
                  </span>
                  <p className="text-xs font-bold text-[#247A63] truncate">
                    {result.parameters.dateRangeText}
                  </p>
                  <span className="text-[10px] text-[#556B62] block">
                    GBIF Yıl Filtresi
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-[#D6E4DC]">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-0.5">
                    İstenen Analiz Kapsamı
                  </span>
                  <p className="text-xs font-bold text-[#1E332B] truncate">
                    {result.parameters.analysisType}
                  </p>
                  <span className="text-[10px] text-[#556B62] block truncate">
                    {result.parameters.geographicScope}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Key Findings KPI Grid */}
          {result.analysis && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl bg-[#F5F9F4] border border-[#D6E4DC]">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-1">
                  İncelenen Canlı
                </span>
                <p className="text-sm font-bold text-[#1E332B] truncate">
                  {result.analysis.species.turkishName || result.analysis.species.canonicalName}
                </p>
                <span className="text-[10px] italic font-serif text-[#556B62] block mt-0.5">
                  {result.analysis.species.scientificName}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-[#DDEFE3]/55 border border-[#8CCFB0]/60">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#247A63] font-semibold block mb-1">
                  Toplam GBIF Kaydı
                </span>
                <p className="text-xl font-bold font-mono text-[#1E332B] tabular-nums">
                  {result.analysis.totalRecords.toLocaleString('tr-TR')}
                </p>
                <span className="text-[10px] text-[#556B62] block mt-0.5">
                  {result.analysis.countryName} ({result.analysis.mappedRecordsCount} koordinatlı)
                </span>
              </div>

              <div className="p-4 rounded-xl bg-[#ECF6FA] border border-[#B9DDEB]">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#1B6884] font-semibold block mb-1">
                  Zirve Gözlem Yılı
                </span>
                <p className="text-xl font-bold font-mono text-[#1E332B] tabular-nums">
                  {result.analysis.peakYear ? result.analysis.peakYear.year : 'Belirtilmemiş'}
                </p>
                <span className="text-[10px] text-[#556B62] block mt-0.5">
                  {result.analysis.peakYear ? `${result.analysis.peakYear.count} kayıt kaydedildi` : 'Veri yetersiz'}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-[#FDF6EC] border border-[#F3D9B5]">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#9A631A] font-semibold block mb-1">
                  En Yoğun İl / Bölge
                </span>
                <p className="text-sm font-bold text-[#6E4716] truncate">
                  {result.analysis.regionalStats[0]?.region || 'Genel Dağılım'}
                </p>
                <span className="text-[10px] text-[#6E4716]/80 block mt-0.5">
                  {result.analysis.regionalStats[0] ? `%${result.analysis.regionalStats[0].percentage.toFixed(1)} gözlem payı` : 'Bölgesel veri yok'}
                </span>
              </div>
            </div>
          )}

          {/* Zero Records Warning Notification */}
          {result.isZeroRecords && (
            <div className="p-4 rounded-2xl bg-[#FDF6EC] border border-[#F3D9B5] flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-700 shrink-0" />
              <p className="text-xs text-[#6E4716]">
                Belirtilen tarih veya coğrafya kriterlerinde GBIF açık bilim arşivinde kayıt bulunamadı. Lütfen sağ üstteki coğrafya filtresini <strong>"Tüm Dünya (Global)"</strong> yaparak veya tarih kısıtını kaldırarak tekrar deneyin.
              </p>
            </div>
          )}

          {/* Synthesis Report Content */}
          <div className="p-6 rounded-2xl bg-[#F5F9F4] border border-[#D6E4DC] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#D6E4DC]">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#247A63]" />
                <h3 className="text-base font-bold text-[#1E332B]">Ajan Araştırma ve Sentez Raporu</h3>
              </div>

              {result.analysis && result.analysis.totalRecords > 0 && (
                <button
                  onClick={() => {
                    onLoadSpeciesToAtlas(result.analysis!.species.scientificName, selectedCountry);
                    window.scrollTo({ top: 380, behavior: 'smooth' });
                  }}
                  className="px-4 py-2 rounded-xl bg-[#247A63] hover:bg-[#1D6350] text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs self-start sm:self-auto"
                  title="Bu canlıyı ana harita, yıllık grafik ve tür genel bakışına aktar"
                >
                  <Compass className="w-4 h-4" />
                  <span>Bu Canlıyı Ana Harita & Atlasa Aktar</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Report Body */}
            <div className="max-w-none text-xs sm:text-sm text-[#1E332B] leading-relaxed font-sans space-y-4 whitespace-pre-wrap">
              {result.report}
            </div>

            {/* Source citations footer */}
            <div className="pt-4 mt-4 border-t border-[#D6E4DC] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#556B62] font-mono">
              <div className="flex items-center gap-3">
                <span>Birincil Veri: Küresel GBIF API v1</span>
                <span>•</span>
                <span>Taksonomi: iNaturalist & Catalogue of Life</span>
              </div>
              <div className="text-[#247A63] font-semibold">
                Çalışan Motor: {getEngineBadge(result.agentMode).label}
              </div>
            </div>
          </div>

        </div>
      )}

    </section>
  );
};

