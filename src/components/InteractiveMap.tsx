import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GBIFOccurrence, SpeciesInfo } from '../types/biodiversity';
import { isOccurrenceMappable, parseValidCoordinates } from '../services/gbif';
import { Compass, RotateCcw, Info, MapPin } from 'lucide-react';

interface InteractiveMapProps {
  occurrences: GBIFOccurrence[];
  totalRecords: number;
  species: SpeciesInfo;
  countryCode?: string;
  secondaryOccurrences?: GBIFOccurrence[];
  secondarySpecies?: SpeciesInfo;
}

type TileTheme = 'topo' | 'dark' | 'satellite' | 'osm';

/**
 * XSS Koruması için HTML etiket ve özel karakter temizleyici
 */
function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

type MappableOccurrence = GBIFOccurrence & {
  decimalLatitude: number;
  decimalLongitude: number;
};

function toMappableOccurrences(
  list: GBIFOccurrence[] | undefined,
  countryCode: string
): MappableOccurrence[] {
  if (!Array.isArray(list)) return [];
  const result: MappableOccurrence[] = [];
  for (const occ of list) {
    const coords = parseValidCoordinates(occ.decimalLatitude, occ.decimalLongitude);
    if (!coords) continue;
    if (!isOccurrenceMappable({ ...occ, decimalLatitude: coords.lat, decimalLongitude: coords.lon }, countryCode)) {
      continue;
    }
    result.push({
      ...occ,
      decimalLatitude: coords.lat,
      decimalLongitude: coords.lon,
    });
  }
  return result;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  occurrences,
  totalRecords,
  species,
  countryCode = '',
  secondaryOccurrences,
  secondarySpecies,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | null>(null);

  // Default to Topographic Nature Map (Esri World Topo - 100% free, no API key required)
  const [tileTheme, setTileTheme] = useState<TileTheme>('topo');
  const [, setSelectedRecord] = useState<GBIFOccurrence | null>(null);

  const validOccurrences = useMemo(
    () => toMappableOccurrences(occurrences, countryCode),
    [occurrences, countryCode]
  );

  const validSecondary = useMemo(
    () => toMappableOccurrences(secondaryOccurrences, countryCode),
    [secondaryOccurrences, countryCode]
  );

  const unmappedSampleCount = Math.max(0, occurrences.length - validOccurrences.length);

  // 1. Initialize Map Instance ONCE on mount
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if ((mapContainerRef.current as any)._leaflet_id) {
      delete (mapContainerRef.current as any)._leaflet_id;
    }

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      center: [39.0, 35.2],
      zoom: 6,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    mapInstanceRef.current = map;

    const markersGroup = L.layerGroup().addTo(map);
    markersLayerRef.current = markersGroup;

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (resizeObserver) resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Handle Tile Layer updates smoothly without requiring any API keys
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (currentTileLayerRef.current) {
      map.removeLayer(currentTileLayerRef.current);
      currentTileLayerRef.current = null;
    }

    let url: string;
    let options: L.TileLayerOptions;

    switch (tileTheme) {
      case 'dark':
        url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
        options = {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
          className: 'dark-nature-tiles',
          maxZoom: 19,
        };
        break;

      case 'satellite':
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
        options = {
          attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, USDA, USGS',
          maxZoom: 18,
        };
        break;

      case 'osm':
        url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
        options = {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
          maxZoom: 19,
        };
        break;

      case 'topo':
      default:
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
        options = {
          attribution: 'Tiles &copy; Esri, GEBCO, Garmin, FAO, NOAA, USGS',
          maxZoom: 19,
        };
        break;
    }

    const tileLayer = L.tileLayer(url, options).addTo(map);
    currentTileLayerRef.current = tileLayer;

    map.invalidateSize();
  }, [tileTheme]);

  // 3. Update Markers when occurrences or comparison change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    const bounds: [number, number][] = [];

    validOccurrences.forEach((occ) => {
      bounds.push([occ.decimalLatitude, occ.decimalLongitude]);

      const primaryName = escapeHtml(species.turkishName || species.canonicalName);
      const primarySci = escapeHtml(species.scientificName);
      const locText = escapeHtml(occ.stateProvince || occ.locality || 'Belirtilmemiş');
      const yearText = escapeHtml(occ.year ? String(occ.year) : (occ.eventDate ? occ.eventDate.slice(0, 4) : 'Belirtilmemiş'));
      const basisText = escapeHtml(occ.basisOfRecord || 'Saha Gözlemi');
      const occKey = encodeURIComponent(String(occ.key));

      const popupHtml = `
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; line-height: 1.45; color: #1E332B;">
          <div style="font-weight: 700; color: #247A63; font-size: 13px; margin-bottom: 2px;">
            ${primaryName}
          </div>
          <div style="font-style: italic; color: #556B62; font-size: 11px; margin-bottom: 6px;">
            ${primarySci}
          </div>
          <div style="border-top: 1px solid #E6EFEA; padding-top: 6px; display: flex; flex-direction: column; gap: 3px;">
            <div><strong>Konum:</strong> ${locText}</div>
            <div><strong>Yıl:</strong> ${yearText}</div>
            <div><strong>Kayıt Türü:</strong> ${basisText}</div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #1B6884; margin-top: 2px;">
              ${occ.decimalLatitude.toFixed(4)}°K, ${occ.decimalLongitude.toFixed(4)}°D
            </div>
          </div>
          <a href="https://www.gbif.org/occurrence/${occKey}" target="_blank" rel="noopener noreferrer" style="display: inline-block; margin-top: 6px; color: #247A63; font-weight: 600; text-decoration: underline; font-size: 11px;">
            GBIF Kayıt Ayrıntısı &rarr;
          </a>
        </div>
      `;

      const marker = L.circleMarker([occ.decimalLatitude, occ.decimalLongitude], {
        radius: 6,
        fillColor: '#247A63',
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.95,
        fillOpacity: 0.88,
      }).bindPopup(popupHtml);

      marker.on('click', () => setSelectedRecord(occ));
      layer.addLayer(marker);
    });

    if (secondarySpecies && validSecondary.length > 0) {
      validSecondary.forEach((occ) => {
        bounds.push([occ.decimalLatitude, occ.decimalLongitude]);

        const secName = escapeHtml(secondarySpecies.turkishName || secondarySpecies.canonicalName);
        const secSci = escapeHtml(secondarySpecies.scientificName);
        const locText = escapeHtml(occ.stateProvince || occ.locality || 'Belirtilmemiş');
        const yearText = escapeHtml(occ.year ? String(occ.year) : (occ.eventDate ? occ.eventDate.slice(0, 4) : 'Belirtilmemiş'));
        const basisText = escapeHtml(occ.basisOfRecord || 'Saha Gözlemi');
        const occKey = encodeURIComponent(String(occ.key));

        const popupHtml = `
          <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; line-height: 1.45; color: #1E332B;">
            <div style="font-weight: 700; color: #9A631A; font-size: 13px; margin-bottom: 2px;">
              ${secName}
            </div>
            <div style="font-style: italic; color: #556B62; font-size: 11px; margin-bottom: 6px;">
              ${secSci}
            </div>
            <div style="border-top: 1px solid #F3D9B5; padding-top: 6px; display: flex; flex-direction: column; gap: 3px;">
              <div><strong>Konum:</strong> ${locText}</div>
              <div><strong>Yıl:</strong> ${yearText}</div>
              <div><strong>Kayıt Türü:</strong> ${basisText}</div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #9A631A; margin-top: 2px;">
                ${occ.decimalLatitude.toFixed(4)}°K, ${occ.decimalLongitude.toFixed(4)}°D
              </div>
            </div>
            <a href="https://www.gbif.org/occurrence/${occKey}" target="_blank" rel="noopener noreferrer" style="display: inline-block; margin-top: 6px; color: #9A631A; font-weight: 600; text-decoration: underline; font-size: 11px;">
              GBIF Kayıt Ayrıntısı &rarr;
            </a>
          </div>
        `;

        const marker = L.circleMarker([occ.decimalLatitude, occ.decimalLongitude], {
          radius: 6,
          fillColor: '#D97706',
          color: '#ffffff',
          weight: 1.5,
          opacity: 0.95,
          fillOpacity: 0.88,
        }).bindPopup(popupHtml);

        marker.on('click', () => setSelectedRecord(occ));
        layer.addLayer(marker);
      });
    }

    if (bounds.length === 1) {
      map.setView(bounds[0], 8);
    } else if (bounds.length > 1) {
      try {
        map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 11 });
      } catch (e) {
        console.warn('Bounds fitting error:', e);
      }
    } else {
      map.setView([39.0, 35.2], 6);
    }

    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 200);

  }, [
    validOccurrences,
    validSecondary,
    species.scientificName,
    species.turkishName,
    species.canonicalName,
    secondarySpecies?.scientificName,
    secondarySpecies?.turkishName,
    secondarySpecies?.canonicalName,
  ]);

  const handleResetView = () => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.invalidateSize();
    if (validOccurrences.length > 1) {
      const bounds = validOccurrences.map(o => [o.decimalLatitude, o.decimalLongitude] as [number, number]);
      mapInstanceRef.current.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 11 });
    } else if (validOccurrences.length === 1) {
      mapInstanceRef.current.setView([validOccurrences[0].decimalLatitude, validOccurrences[0].decimalLongitude], 8);
    } else {
      mapInstanceRef.current.setView([39.0, 35.2], 6);
    }
  };

  return (
    <div id="harita" className="bg-white border border-[#D6E4DC] rounded-2xl p-6 lg:p-8 shadow-sm">
      {/* Map Header and Indicators */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-[#E6EFEA]">
        <div>
          <h3 className="text-xl font-bold text-[#1E332B] flex items-center gap-2">
            <Compass className="w-5 h-5 text-[#247A63]" />
            <span>Etkileşimli Gözlem Haritası</span>
          </h3>
          <p className="text-xs text-[#556B62] mt-1">
            Doğrulanmış gerçek GBIF GPS koordinatları ve coğrafi yayılım noktaları (Açık ve Ücretsiz Harita Altyapısı)
          </p>
        </div>

        {/* Action Controls & Tile Switchers */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#F5F9F4] rounded-xl border border-[#D6E4DC] text-xs">
            <button
              type="button"
              onClick={() => setTileTheme('topo')}
              className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                tileTheme === 'topo' ? 'bg-[#247A63] text-white shadow-xs' : 'text-[#556B62] hover:text-[#1E332B]'
              }`}
            >
              Doğa & Topoğrafya
            </button>
            <button
              type="button"
              onClick={() => setTileTheme('dark')}
              className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                tileTheme === 'dark' ? 'bg-[#247A63] text-white shadow-xs' : 'text-[#556B62] hover:text-[#1E332B]'
              }`}
            >
              Koyu Doğa
            </button>
            <button
              type="button"
              onClick={() => setTileTheme('satellite')}
              className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                tileTheme === 'satellite' ? 'bg-[#247A63] text-white shadow-xs' : 'text-[#556B62] hover:text-[#1E332B]'
              }`}
            >
              Uydu
            </button>
            <button
              type="button"
              onClick={() => setTileTheme('osm')}
              className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                tileTheme === 'osm' ? 'bg-[#247A63] text-white shadow-xs' : 'text-[#556B62] hover:text-[#1E332B]'
              }`}
            >
              Standart
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetView}
            title="Haritayı Odakla / Sıfırla"
            className="p-2 bg-[#F5F9F4] hover:bg-[#DDEFE3] text-[#247A63] rounded-xl border border-[#D6E4DC] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Map Canvas Stage */}
      <div className="relative w-full h-[460px] sm:h-[530px] rounded-xl overflow-hidden border border-[#D6E4DC] bg-[#EAF2EC]">
        <div 
          ref={mapContainerRef} 
          className="w-full h-full"
          style={{ minHeight: '460px', width: '100%', height: '100%' }}
        />

        {/* Floating Map HUD Legend Overlay */}
        <div className="absolute top-4 right-4 z-[500] bg-white/95 backdrop-blur-md p-3.5 rounded-xl border border-[#D6E4DC] text-xs shadow-md max-w-xs pointer-events-auto">
          <div className="font-bold text-[#1E332B] mb-2 flex items-center justify-between gap-3">
            <span>Harita Göstergeleri</span>
            <span className="font-mono text-[10px] text-[#247A63] font-bold bg-[#DDEFE3] px-2 py-0.5 rounded border border-[#8CCFB0]">
              {validOccurrences.length} / {occurrences.length} Nokta
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[#1E332B] font-medium">
              <span className="w-3 h-3 rounded-full bg-[#247A63] border border-white shadow-xs shrink-0" />
              <span className="truncate">
                {species.turkishName || species.canonicalName} ({validOccurrences.length} nokta)
              </span>
            </div>

            {secondarySpecies && (
              <div className="flex items-center gap-2 text-[#6E4716] pt-1.5 border-t border-[#E6EFEA] font-medium">
                <span className="w-3 h-3 rounded-full bg-[#D97706] border border-white shadow-xs shrink-0" />
                <span className="truncate">
                  {secondarySpecies.turkishName || secondarySpecies.canonicalName} ({validSecondary.length} nokta)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Informational overlay when no coordinates exist */}
        {validOccurrences.length === 0 && (
          <div className="absolute inset-0 z-[450] bg-[#F5F9F4]/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center pointer-events-none">
            <div className="p-5 rounded-2xl bg-white border border-[#D6E4DC] max-w-md shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#FDF6EC] border border-[#F3D9B5] text-[#9A631A] flex items-center justify-center mx-auto mb-2.5">
                <MapPin className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-bold text-[#1E332B] mb-1">
                Doğrulanmış GPS Koordinatı Bulunmuyor
              </h4>
              <p className="text-xs text-[#556B62] leading-relaxed mb-3">
                Bu tür için haritada gösterilebilecek konum verisi bulunmuyor.
              </p>
              <div className="text-[11px] font-mono text-[#247A63] font-medium">
                Bilimsel dürüstlük gereği konumu belirsiz kayıtlar için temsili veya sahte nokta üretilmez.
              </div>
            </div>
          </div>
        )}

        {/* Scientific Guarantee Notice */}
        <div className="absolute bottom-4 left-4 z-[500] bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[#D6E4DC] text-[11px] text-[#556B62] shadow-sm hidden sm:flex items-center gap-2 pointer-events-none">
          <Info className="w-3.5 h-3.5 text-[#247A63] shrink-0" />
          <span>Yalnızca doğrulanmış gerçek GPS koordinatları işaretlenir; koordinatı olmayan kayıtlar için yer uydurulmaz.</span>
        </div>
      </div>

      {/* Under-Map Metrics */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[#556B62] pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <span>Haritada Gösterilen: <strong className="text-[#1E332B] font-bold">{validOccurrences.length} kayıt</strong></span>
          <span aria-hidden="true">·</span>
          <span>Koordinatsız / Hariç: <strong className="text-[#9A631A] font-bold">{unmappedSampleCount} kayıt</strong></span>
          {totalRecords > occurrences.length && (
            <>
              <span aria-hidden="true">·</span>
              <span>Arşiv Toplamı: <strong className="text-[#247A63] font-bold">{totalRecords.toLocaleString('tr-TR')}</strong></span>
            </>
          )}
        </div>
        <div className="text-[#556B62] hidden sm:block">
          Yakınlaştırmak için haritaya çift tıklayın veya fare tekerini kullanın
        </div>
      </div>
    </div>
  );
};
