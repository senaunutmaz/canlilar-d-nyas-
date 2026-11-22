import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Compass, Scale, MapPin, BarChart3, Shield, BookOpen } from 'lucide-react';

interface NavbarProps {
  onQuickSearch: (query: string) => void;
  isCompareMode: boolean;
  onToggleCompare: () => void;
  onSelectSpecies?: (scientificName: string) => void;
}

export const Navbar: React.FC<NavbarProps> = () => {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 bg-[#0b1510]/90 backdrop-blur-md border-b border-emerald-950/60 px-6 py-3.5 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
        
        {/* Wordmark */}
        <NavLink 
          to="/" 
          className="text-lg font-bold tracking-tight text-white hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2.5"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Compass className="w-4 h-4" />
          </div>
          <span>Canlı Atlası</span>
        </NavLink>

        {/* Navigation Links */}
        <nav className="hidden xl:flex items-center gap-4 text-xs font-medium text-emerald-100/70">
          <NavLink 
            to="/" 
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Ana Sayfa
          </NavLink>
          <NavLink 
            to="/kesfet" 
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Tür Keşfi
          </NavLink>
          <NavLink 
            to="/analiz" 
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Veri Analizi
          </NavLink>
          <NavLink 
            to="/harita" 
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Gözlem Haritası
          </NavLink>
          <NavLink 
            to="/karsilastir" 
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Tür Karşılaştır
          </NavLink>
          <NavLink 
            to="/koruma" 
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            IUCN Koruma
          </NavLink>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => navigate('/karsilastir')}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/40 transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Karşılaştır</span>
          </button>
        </div>

      </div>
    </header>
  );
};
