import React from 'react';
import { Info, BookOpen, ExternalLink } from 'lucide-react';

export const ConservationGuide: React.FC = () => {
  // IUCN koruma kategorilerinin kendi anlamlı renkleri açık temada yüksek kontrastla korunur
  const iucnCategories = [
    {
      code: 'EX',
      name: 'Tükenmiş (Extinct)',
      desc: 'Son bireyin de öldüğüne dair hiçbir şüphe kalmamış türler.',
      color: 'border-zinc-300 bg-zinc-50 text-zinc-800',
      badge: 'bg-zinc-200 text-zinc-900',
    },
    {
      code: 'EW',
      name: 'Doğada Tükenmiş (Extinct in the Wild)',
      desc: 'Yalnızca esaret altında, botanik bahçelerinde veya doğal yaşam alanı dışında yaşayan türler.',
      color: 'border-purple-200 bg-purple-50 text-purple-900',
      badge: 'bg-purple-200 text-purple-950',
    },
    {
      code: 'CR',
      name: 'Kritik Tehlikede (Critically Endangered)',
      desc: 'Doğada neslinin tükenmesi konusunda aşırı derecede yüksek risk altında olan türler (Örn: Toros Kurbağası).',
      color: 'border-rose-200 bg-rose-50 text-rose-900',
      badge: 'bg-rose-200 text-rose-950',
    },
    {
      code: 'EN',
      name: 'Tehlikede (Endangered)',
      desc: 'Doğada neslinin tükenme riski çok yüksek olan türler (Örn: Akdeniz Foku, Kelaynak, Yeşil Kaplumbağa).',
      color: 'border-orange-200 bg-orange-50 text-orange-900',
      badge: 'bg-orange-200 text-orange-950',
    },
    {
      code: 'VU',
      name: 'Hassas (Vulnerable)',
      desc: 'Doğada tükenme tehlikesiyle karşı karşıya olan ve koruma önlemleri gerektiren türler (Örn: Toy Kuşu, Caretta caretta).',
      color: 'border-amber-200 bg-amber-50 text-amber-900',
      badge: 'bg-amber-200 text-amber-950',
    },
    {
      code: 'NT',
      name: 'Tehdite Yakın (Near Threatened)',
      desc: 'Şu anda tehlike altında olmayan fakat yakın gelecekte tehlike sınırına girebilecek türler (Örn: Çizgili Sırtlan).',
      color: 'border-yellow-300 bg-yellow-50 text-yellow-900',
      badge: 'bg-yellow-200 text-yellow-950',
    },
    {
      code: 'LC',
      name: 'Asgari Endişe (Least Concern)',
      desc: 'Yaygın ve geniş popülasyonlara sahip, yakın gelecekte tükenme riski bulunmayan türler (Örn: Bozayı, Bozkurt).',
      color: 'border-[#8CCFB0] bg-[#DDEFE3]/70 text-[#1E5E4C]',
      badge: 'bg-[#247A63] text-white',
    },
    {
      code: 'DD',
      name: 'Veri Yetersiz (Data Deficient)',
      desc: 'Dağılımı veya popülasyon durumu hakkında doğrudan ya da dolaylı yeterli bilgi bulunmayan türler.',
      color: 'border-slate-300 bg-slate-50 text-slate-800',
      badge: 'bg-slate-200 text-slate-900',
    }
  ];

  return (
    <section id="metodoloji" className="my-8 bg-white border border-[#D6E4DC] rounded-3xl p-6 lg:p-8 shadow-sm">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-5 border-b border-[#E6EFEA]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#247A63] font-semibold mb-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Bilimsel Rehber</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E332B] tracking-tight">
            IUCN Koruma Kategorileri & Bilimsel Metodoloji
          </h2>
          <p className="text-xs text-[#556B62] mt-1 max-w-2xl leading-relaxed">
            Canlı Atlası, küresel biyoçeşitlilik açık verilerini ve IUCN Kırmızı Liste ölçütlerini bilimsel metodoloji ilkelerine sadık kalarak sunar.
          </p>
        </div>

        <a
          href="https://www.iucnredlist.org"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-[#F5F9F4] hover:bg-[#DDEFE3] border border-[#D6E4DC] text-[#247A63] hover:text-[#1D6350] rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0"
        >
          <span>IUCN Red List Resmi Sitesi</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Critical Scientific Clarification Box */}
      <div className="mb-8 p-5 rounded-2xl bg-gradient-to-r from-[#DDEFE3]/65 to-[#ECF6FA]/80 border border-[#8CCFB0]/60 flex flex-col md:flex-row items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#247A63] text-white flex items-center justify-center shrink-0">
          <Info className="w-5 h-5" />
        </div>
        <div className="text-xs text-[#1E332B] leading-relaxed space-y-2">
          <h4 className="text-sm font-bold text-[#1E332B]">
            Gözlem Sayısı ile Canlı Popülasyonu Arasındaki Temel Fark
          </h4>
          <p className="text-[#556B62]">
            GBIF üzerindeki <strong className="text-[#1E332B]">gözlem kayıtlarının sayısı</strong> (occurrence count), o canlı türünün doğadaki toplam nüfusunu (popülasyonunu) ifade etmez. Bir türün son yıllarda daha çok kaydedilmesi, türün çoğaldığını değil; doğa gözlemcilerinin, fotokapanların ve dijital vatandaş bilimi (iNaturalist vb.) platformlarının kullanımının arttığını gösterir.
          </p>
          <p className="text-[#247A63] font-semibold">
            Örnek: Bozayı (Ursus arctos) Türkiye genelinde "Asgari Endişe" (LC) küresel statüsündedir ancak yerel yaşam alanlarının bölünmesi gibi tehditler bağımsız bilimsel raporlarla takip edilir.
          </p>
        </div>
      </div>

      {/* IUCN Categories Grid */}
      <h3 className="text-sm font-bold text-[#1E332B] uppercase tracking-wider font-mono mb-4">
        IUCN Kırmızı Liste Koruma Dereceleri
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {iucnCategories.map((cat) => (
          <div
            key={cat.code}
            className={`p-4 rounded-xl border transition-all ${cat.color}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`font-mono text-xs font-black tracking-widest px-2.5 py-0.5 rounded ${cat.badge}`}>
                {cat.code}
              </span>
            </div>
            <h4 className="text-xs font-bold mb-1.5">
              {cat.name}
            </h4>
            <p className="text-[11px] opacity-90 leading-relaxed">
              {cat.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
};
