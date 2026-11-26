import React, { useState } from 'react';
import { DISCOVERY_SPECIMENS } from '../services/gbif';
import { ArrowUpRight } from 'lucide-react';

interface SpeciesDiscoveryProps {
  onSelectSpecies: (scientificName: string) => void;
  activeScientificName?: string;
}

export const SpeciesDiscovery: React.FC<SpeciesDiscoveryProps> = ({
  onSelectSpecies,
  activeScientificName
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('mammals');

  const categories = [
    { id: 'mammals', label: 'Memeliler', icon: '🐻', count: 5 },
    { id: 'birds', label: 'Kuşlar', icon: '🦅', count: 4 },
    { id: 'reptiles', label: 'Sürüngenler', icon: '🐢', count: 4 },
    { id: 'marine', label: 'Deniz Canlıları', icon: '🐬', count: 3 },
    { id: 'amphibians', label: 'Amfibiler', icon: '🐸', count: 2 },
    { id: 'endangered', label: 'Tehlike Altındaki Türler', icon: '⚠️', count: 3 }
  ];

  const filteredSpecimens = DISCOVERY_SPECIMENS.filter(
    s => s.category === selectedCategory
  );

  // IUCN koruma kategorilerinin anlamlı renkleri korunur (açık tema kontrastıyla)
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CR': return 'bg-rose-50 border-rose-300 text-rose-800';
      case 'EN': return 'bg-orange-50 border-orange-300 text-orange-800';
      case 'VU': return 'bg-amber-50 border-amber-300 text-amber-800';
      case 'NT': return 'bg-yellow-50 border-yellow-300 text-yellow-800';
      case 'LC': return 'bg-[#DDEFE3] border-[#8CCFB0] text-[#1E5E4C]';
      default: return 'bg-slate-100 border-slate-300 text-slate-700';
    }
  };

  return (
    <section id="kesif" className="my-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#247A63] font-semibold block mb-2">
            Türkiye & Dünya Biyoçeşitliliği
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E332B] tracking-tight">
            Canlı Türleri Keşif Alanı
          </h2>
          <p className="text-sm text-[#556B62] mt-1.5 max-w-xl leading-relaxed">
            Anadolu'nun endemik, simgesel ve nesli tehlike altındaki canlılarını kategoriler bazında keşfedin; bir türe tıklayarak gerçek gözlem arşivini başlatın.
          </p>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-6 scrollbar-none">
        {categories.map((cat) => {
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-[#247A63] text-white shadow-sm font-bold'
                  : 'bg-white text-[#556B62] hover:text-[#1E332B] hover:bg-[#DDEFE3]/50 border border-[#D6E4DC]'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                isActive ? 'bg-white/20 text-white' : 'bg-[#F5F9F4] text-[#247A63]'
              }`}>
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Specimens Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredSpecimens.map((item) => {
          const isSelected = activeScientificName?.toLowerCase() === item.scientificName.toLowerCase();

          return (
            <div
              key={item.id}
              onClick={() => onSelectSpecies(item.scientificName)}
              className={`group bg-white hover:bg-[#F9FCF8] rounded-2xl p-6 border transition-all duration-200 flex flex-col justify-between cursor-pointer relative ${
                isSelected
                  ? 'border-[#247A63] ring-2 ring-[#247A63]/20 shadow-md'
                  : 'border-[#D6E4DC] hover:border-[#8CCFB0] shadow-xs hover:shadow-md'
              }`}
            >
              <div>
                {/* Header: Names & IUCN Status */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-[#1E332B] group-hover:text-[#247A63] transition-colors">
                      {item.turkishName}
                    </h3>
                    <p className="text-xs italic font-serif text-[#556B62]">
                      {item.scientificName}
                    </p>
                  </div>

                  <span className={`px-2.5 py-1 rounded-md border text-[10px] font-mono font-bold whitespace-nowrap ${getStatusColor(item.iucnStatus)}`}>
                    {item.iucnStatus}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-[#556B62] leading-relaxed mb-4">
                  {item.description}
                </p>
              </div>

              {/* Habitat & Action */}
              <div className="pt-3 border-t border-[#E6EFEA] flex items-center justify-between text-xs">
                <span className="text-[11px] text-[#556B62] truncate max-w-[180px]">
                  Habitat: {item.habitat}
                </span>

                <span className="text-[#247A63] group-hover:text-[#1D6350] font-semibold flex items-center gap-1 shrink-0">
                  <span>Analiz Et</span>
                  <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
