import React from 'react';
import { Compass, ExternalLink } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-[#D6E4DC] bg-white text-[#556B62] py-12 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start justify-between gap-8 mb-8 pb-8 border-b border-[#E6EFEA]">
        {/* Brand statement */}
        <div className="max-w-md">
          <div className="flex items-center gap-2.5 text-[#1E332B] font-bold text-base mb-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#DDEFE3] border border-[#8CCFB0] flex items-center justify-center text-[#247A63]">
              <Compass className="w-4 h-4" />
            </div>
            <span>Canlı Atlası</span>
          </div>
          <p className="text-xs leading-relaxed text-[#556B62]">
            Kaybolan Canlıların İzinde – Biyoçeşitliliğin Dijital Hafızası. Türkiye ve dünyadaki canlı türlerinin bilimsel gözlem kayıtlarını, zamansal değişimini ve coğrafi yayılışını açık bilim verileriyle topluma ulaştıran eğitim ve analiz platformu.
          </p>
        </div>

        {/* Data Sources and Attribution */}
        <div className="flex flex-col sm:flex-row gap-8 text-xs font-mono">
          <div>
            <span className="text-[#247A63] font-bold block mb-2.5 uppercase tracking-wider text-[11px]">
              Açık Veri Kaynakları
            </span>
            <ul className="space-y-2 text-[#556B62]">
              <li>
                <a href="https://www.gbif.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#247A63] transition-colors flex items-center gap-1.5">
                  <span>GBIF (Global Biodiversity Info Facility)</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a href="https://www.inaturalist.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#247A63] transition-colors flex items-center gap-1.5">
                  <span>iNaturalist Açık Gözlem Ağı</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a href="https://www.iucnredlist.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#247A63] transition-colors flex items-center gap-1.5">
                  <span>IUCN Kırmızı Liste (Red List)</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#247A63] transition-colors flex items-center gap-1.5">
                  <span>OpenStreetMap & Leaflet</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>

          <div>
            <span className="text-[#247A63] font-bold block mb-2.5 uppercase tracking-wider text-[11px]">
              Etik İlke
            </span>
            <p className="text-xs text-[#556B62] max-w-xs font-sans leading-relaxed">
              Bu platformda sunulan veriler doğrudan açık bilim sunucularından çekilmekte olup uydurma veya tahmini koordinat barındırmaz.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-[#556B62]">
        <div>
          &copy; {new Date().getFullYear()} Canlı Atlası · Biyoçeşitlilik Bilgi Sistemi
        </div>
        <div>
          Açık Bilim ve Doğa Koruma İçin Geliştirildi
        </div>
      </div>
    </footer>
  );
};
