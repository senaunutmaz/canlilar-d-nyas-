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
  activeCommonName?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ activeSpecies, activeCountry, activeCommonName }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const speciesParams = (() => {
    if (!activeSpecies) return '';
    const params = new URLSearchParams({
      species: activeSpecies,
      country: activeCountry ?? 'TR',
    });
    if (activeCommonName) {
      params.set('commonName', activeCommonName);
    }
    return `?${params.toString()}`;
  })();
  const exploreParams = activeCountry !== undefined
    ? `?country=${encodeURIComponent(activeCountry)}`
    : '';

  const handleLinkClick = () => {
    setMobileMenuOpen(false);
  };

  const desktopLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3.5 py-2 rounded-xl transition-all whitespace-nowrap shrink-0 ${
      isActive
        ? 'bg-[#247A63] text-white font-semibold shadow-sm'
        : 'text-[#556B62] hover:text-[#1E332B] hover:bg-[#DDEFE3]/60 font-medium'
    }`;

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block px-4 py-2.5 rounded-xl text-sm transition-colors ${
      isActive
        ? 'bg-[#247A63] text-white font-semibold shadow-sm'
        : 'text-[#1E332B] hover:bg-[#DDEFE3]/60 font-medium'
    }`;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#D6E4DC] px-6 py-3.5 shadow-2xs transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
        
        {/* Wordmark */}
        <NavLink 
          to="/" 
          onClick={handleLinkClick}
          className="text-lg font-bold tracking-tight text-[#1E332B] hover:text-[#247A63] transition-colors whitespace-nowrap shrink-0 flex items-center gap-2.5"
        >
          <div className="w-8 h-8 rounded-xl bg-[#DDEFE3] border border-[#8CCFB0] flex items-center justify-center text-[#247A63]">
            <Compass className="w-4 h-4" />
          </div>
          <span>Canlı Atlası</span>
        </NavLink>

        {/* Desktop Navigation Links */}
        <nav className="hidden xl:flex items-center gap-2 text-xs">
          <NavLink to="/" end className={desktopLinkClass}>
            Ana Sayfa
          </NavLink>
          <NavLink to={`/kesfet${exploreParams}`} className={desktopLinkClass}>
            Tür Keşfi
          </NavLink>
          <NavLink to={`/analiz${speciesParams}`} className={desktopLinkClass}>
            Veri Analizi
          </NavLink>
          <NavLink to={`/harita${speciesParams}`} className={desktopLinkClass}>
            Gözlem Haritası
          </NavLink>
          <NavLink to={`/karsilastir${speciesParams}`} className={desktopLinkClass}>
            Tür Karşılaştır
          </NavLink>
          <NavLink to="/koruma" className={desktopLinkClass}>
            IUCN Koruma
          </NavLink>
        </nav>

        {/* Actions & Mobile Hamburger Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              handleLinkClick();
              navigate(`/karsilastir${speciesParams}`);
            }}
            className="hidden sm:flex px-4 py-2 text-xs font-semibold rounded-xl bg-[#247A63] hover:bg-[#1D6350] text-white shadow-xs transition-all items-center gap-1.5 whitespace-nowrap cursor-pointer"
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
            className="xl:hidden p-2 rounded-xl bg-[#F5F9F4] border border-[#D6E4DC] text-[#247A63] hover:bg-[#DDEFE3] transition-colors cursor-pointer"
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
          className="xl:hidden absolute top-full left-0 right-0 bg-white border-b border-[#D6E4DC] px-6 py-5 shadow-xl space-y-2 z-50"
        >
          <NavLink to="/" end onClick={handleLinkClick} className={mobileLinkClass}>
            Ana Sayfa
          </NavLink>
          <NavLink to={`/kesfet${exploreParams}`} onClick={handleLinkClick} className={mobileLinkClass}>
            Tür Keşfi
          </NavLink>
          <NavLink to={`/analiz${speciesParams}`} onClick={handleLinkClick} className={mobileLinkClass}>
            Veri Analizi
          </NavLink>
          <NavLink to={`/harita${speciesParams}`} onClick={handleLinkClick} className={mobileLinkClass}>
            Gözlem Haritası
          </NavLink>
          <NavLink to={`/karsilastir${speciesParams}`} onClick={handleLinkClick} className={mobileLinkClass}>
            Tür Karşılaştır
          </NavLink>
          <NavLink to="/koruma" onClick={handleLinkClick} className={mobileLinkClass}>
            IUCN Koruma
          </NavLink>
        </nav>
      )}
    </header>
  );
};
