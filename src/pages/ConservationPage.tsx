import React from 'react';
import { ConservationGuide } from '../components/ConservationGuide';
import { Shield } from 'lucide-react';

export const ConservationPage: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#D6E4DC] shadow-sm">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#247A63] font-semibold mb-2">
          <Shield className="w-3.5 h-3.5" />
          <span>IUCN Red List & Ekolojik Kriterler</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#1E332B] tracking-tight">
          Koruma & Metodoloji Rehberi
        </h1>
        <p className="text-sm text-[#556B62] mt-1.5 max-w-xl leading-relaxed">
          Dünya Doğa ve Doğal Kaynakları Koruma Birliği (IUCN) kategorileri, kritik tehlike altındaki türler ve bilimsel gözlem verisi metodolojisi.
        </p>
      </div>

      <ConservationGuide />
    </div>
  );
};
