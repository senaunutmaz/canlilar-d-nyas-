import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Compass, Scale, Menu, X } from 'lucide-react';

interface NavbarProps {
  onQuickSearch: (query: string) => void;
  isCompareMode: boolean;
  onToggleCompare: () => void;
  onSelectSpecies?: (scientificName: string) => void;
  activeSpecies?: string;
  activeCountry?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ activeSpecies, activeCountry }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const speciesParams = activeSpecies
    ? `?species=${encodeURIComponent(activeSpecies)}&country=${encodeURIComponent(activeCountry ?? 'TR')}`
    : '';
  const exploreParams = activeCountry !== undefined
    ? `?country=${encodeURIComponent(activeCountry)}`
    : '';

  const handleLinkClick = () => {
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#0b1510]/90 backdrop-blur-md border-b border-emerald-950/60 px-6 py-3.5 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
        
        {/* Wordmark */}
        <NavLink 
          to="/" 
          onClick={handleLinkClick}
          className="text-lg font-bold tracking-tight text-white hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2.5"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Compass className="w-4 h-4" />
          </div>
          <span>Canlı Atlası</span>
        </NavLink>

        {/* Desktop Navigation Links */}
        <nav className="hidden xl:flex items-center gap-4 text-xs font-medium text-emerald-100/70">
          <NavLink 
            to="/" 
            end
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Ana Sayfa
          </NavLink>
          <NavLink 
            to={`/kesfet${exploreParams}`}
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Tür Keşfi
          </NavLink>
          <NavLink 
            to={`/analiz${speciesParams}`}
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Veri Analizi
          </NavLink>
          <NavLink 
            to={`/harita${speciesParams}`}
            className={({ isActive }) => 
              `px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:text-white hover:bg-emerald-950/40'}`
            }
          >
            Gözlem Haritası
          </NavLink>
          <NavLink 
            to={`/karsilastir${speciesParams}`}
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

        {/* Actions & Mobile Hamburger Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => {
              handleLinkClick();
              navigate(`/karsilastir${speciesParams}`);
            }}
            className="hidden sm:flex px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/40 transition-all items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Karşılaştır</span>
          </button>

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-menu"
            className="xl:hidden p-2 rounded-xl bg-emerald-950/50 border border-emerald-800/50 text-emerald-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Mobil Menü"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <nav
          id="mobile-navigation-menu"
          aria-label="Mobil Navigasyon"
          className="xl:hidden absolute top-full left-0 right-0 bg-[#0b1510] border-b border-emerald-900/80 px-6 py-5 shadow-2xl space-y-3 animate-fadeIn z-50"
        >
          <NavLink 
            to="/" 
            end
            onClick={handleLinkClick}
            className={({ isActive }) => 
              `block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-emerald-100/80 hover:bg-emerald-950/50 hover:text-white'}`
            }
          >
            Ana Sayfa
          </NavLink>
          <NavLink 
            to={`/kesfet${exploreParams}`}
            onClick={handleLinkClick}
            className={({ isActive }) => 
              `block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-emerald-100/80 hover:bg-emerald-950/50 hover:text-white'}`
            }
          >
            Tür Keşfi
          </NavLink>
          <NavLink 
            to={`/analiz${speciesParams}`}
            onClick={handleLinkClick}
            className={({ isActive }) => 
              `block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-emerald-100/80 hover:bg-emerald-950/50 hover:text-white'}`
            }
          >
            Veri Analizi
          </NavLink>
          <NavLink 
            to={`/harita${speciesParams}`}
            onClick={handleLinkClick}
            className={({ isActive }) => 
              `block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-emerald-100/80 hover:bg-emerald-950/50 hover:text-white'}`
            }
          >
            Gözlem Haritası
          </NavLink>
          <NavLink 
            to={`/karsilastir${speciesParams}`}
            onClick={handleLinkClick}
            className={({ isActive }) => 
              `block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-emerald-100/80 hover:bg-emerald-950/50 hover:text-white'}`
            }
          >
            Tür Karşılaştır
          </NavLink>
          <NavLink 
            to="/koruma" 
            onClick={handleLinkClick}
            className={({ isActive }) => 
              `block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-emerald-100/80 hover:bg-emerald-950/50 hover:text-white'}`
            }
          >
            IUCN Koruma
          </NavLink>
        </nav>
      )}
    </header>
  );
};
