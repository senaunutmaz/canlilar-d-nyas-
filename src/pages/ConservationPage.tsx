import React from 'react';
import { ConservationGuide } from '../components/ConservationGuide';
import { Shield, BookOpen } from 'lucide-react';

export const ConservationPage: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      <div className="bg-[#111e17] rounded-3xl p-6 sm:p-8 border border-emerald-800/50 shadow-2xl">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-2 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-800/40">
          <Shield className="w-3.5 h-3.5" />
          <span>IUCN Red List & Ekolojik Kriterler</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          Koruma & Metodoloji Rehberi
        </h1>
        <p className="text-sm text-emerald-100/75 mt-1 max-w-xl">
          Dünya Doğa ve Doğal Kaynakları Koruma Birliği (IUCN) kategorileri, kritik tehlike altındaki türler ve bilimsel gözlem verisi metodolojisi.
        </p>
      </div>

      <ConservationGuide />
    </div>
  );
};
