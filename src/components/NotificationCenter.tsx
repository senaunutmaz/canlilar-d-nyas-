import React, { useState, useEffect, useRef } from 'react';
import { 
  AtlasNotification, 
  NotificationType 
} from '../types/notifications';
import { 
  getStoredNotifications, 
  saveStoredNotifications, 
  requestBrowserNotificationPermission, 
  showBrowserPushNotification 
} from '../services/notifications';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Trash2, 
  Globe2, 
  ShieldAlert, 
  Sparkles, 
  Compass, 
  BellRing, 
  BellOff, 
  Info, 
  X,
  Clock,
  ExternalLink
} from 'lucide-react';

interface NotificationCenterProps {
  onSelectSpecies?: (scientificName: string) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ onSelectSpecies }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<AtlasNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = getStoredNotifications();
    setNotifications(loaded);

    if ('Notification' in window && Notification.permission === 'granted') {
      setPushEnabled(true);
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAsRead = (id: string) => {
    const updated = notifications.map(n => n.id === id ? { ...n, read: true } : n);
    setNotifications(updated);
    saveStoredNotifications(updated);
  };

  const handleMarkAllAsRead = () => {
    const updated = notifications.map(n => ({ ...n, read: true }));
    setNotifications(updated);
    saveStoredNotifications(updated);
  };

  const handleClearAll = () => {
    setNotifications([]);
    saveStoredNotifications([]);
  };

  const handleTogglePush = async () => {
    if (!pushEnabled) {
      const res = await requestBrowserNotificationPermission();
      setPermissionMessage(res.message);
      if (res.granted) {
        setPushEnabled(true);
      }
    } else {
      setPushEnabled(false);
      setPermissionMessage('Tarayıcı bildirimleri devre dışı bırakıldı.');
    }
  };

  const getIconForType = (type: NotificationType) => {
    switch (type) {
      case 'NEW_SPECIES':
        return <Sparkles className="w-4 h-4 text-emerald-400" />;
      case 'NEW_OBSERVATION':
        return <Compass className="w-4 h-4 text-cyan-400" />;
      case 'CONSERVATION_STATUS':
        return <ShieldAlert className="w-4 h-4 text-amber-400" />;
      case 'NEW_DATA':
        return <Globe2 className="w-4 h-4 text-indigo-400" />;
      case 'NEW_DISCOVERY':
        return <BellRing className="w-4 h-4 text-emerald-300" />;
      default:
        return <Info className="w-4 h-4 text-emerald-400" />;
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    return true;
  });

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Bildirimler"
        className="relative p-2 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/40 transition-colors cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-[#0b1510] text-[10px] font-bold rounded-full flex items-center justify-center shadow-md animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-[#111e17] border border-emerald-800/60 rounded-2xl shadow-2xl z-50 overflow-hidden backdrop-blur-xl animate-fadeIn">
          
          {/* Header */}
          <div className="p-4 bg-[#0b1510]/80 border-b border-emerald-900/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Bildirim Merkezi</h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {unreadCount} yeni
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                title="Tümünü okundu işaretle"
                className="p-1.5 rounded-lg hover:bg-emerald-950 text-emerald-300 transition-colors cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-emerald-950 text-emerald-300 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Push Permission & Settings Banner */}
          <div className="p-3 bg-emerald-950/30 border-b border-emerald-900/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-emerald-200/90">
              {pushEnabled ? <BellRing className="w-3.5 h-3.5 text-emerald-400" /> : <BellOff className="w-3.5 h-3.5 text-amber-400" />}
              <span>Tarayıcı Bildirimleri: <strong>{pushEnabled ? 'Açık' : 'Kapalı'}</strong></span>
            </div>
            <button
              type="button"
              onClick={handleTogglePush}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                pushEnabled 
                  ? 'bg-rose-950/60 text-rose-300 border border-rose-800/40 hover:bg-rose-900/60'
                  : 'bg-emerald-500 text-[#0b1510] hover:bg-emerald-400 shadow-sm'
              }`}
            >
              {pushEnabled ? 'Kapat' : 'İzin İste'}
            </button>
          </div>

          {permissionMessage && (
            <div className="px-3 py-2 bg-emerald-950/60 border-b border-emerald-900/40 text-[11px] text-emerald-200">
              {permissionMessage}
            </div>
          )}

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0b1510]/40 border-b border-emerald-900/40 text-xs">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filter === 'all' ? 'bg-emerald-500 text-[#0b1510]' : 'text-emerald-300 hover:text-white'
              }`}
            >
              Tümü ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filter === 'unread' ? 'bg-emerald-500 text-[#0b1510]' : 'text-emerald-300 hover:text-white'
              }`}
            >
              Okunmamış ({unreadCount})
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-emerald-900/40 scrollbar-none">
            {filteredNotifications.length > 0 ? (
              filteredNotifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-4 transition-colors flex items-start gap-3 relative ${
                    n.read ? 'bg-transparent opacity-75' : 'bg-emerald-950/20 hover:bg-emerald-950/40'
                  }`}
                >
                  {!n.read && (
                    <span className="absolute top-4 left-2 w-2 h-2 rounded-full bg-emerald-400" />
                  )}

                  <div className="p-2 rounded-xl bg-emerald-950/60 border border-emerald-800/40 shrink-0 mt-0.5">
                    {getIconForType(n.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className="text-xs font-bold text-white truncate">{n.title}</h4>
                      <span className="text-[10px] text-emerald-400/70 font-mono whitespace-nowrap flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs text-emerald-100/80 leading-relaxed mb-2">
                      {n.message}
                    </p>

                    <div className="flex items-center justify-between gap-2">
                      {n.scientificName && onSelectSpecies && (
                        <button
                          type="button"
                          onClick={() => {
                            if (n.scientificName) {
                              onSelectSpecies(n.scientificName);
                              setIsOpen(false);
                            }
                          }}
                          className="text-[11px] text-emerald-400 hover:text-white font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <span>Türü İncele</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}

                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => handleMarkAsRead(n.id)}
                          className="text-[10px] text-emerald-300 hover:text-white ml-auto flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          <span>Okundu İşaretle</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 px-4 text-center">
                <Bell className="w-8 h-8 text-emerald-400/40 mx-auto mb-2" />
                <h5 className="text-xs font-bold text-white mb-1">Bildirim Bulunmuyor</h5>
                <p className="text-[11px] text-emerald-300/60">
                  {filter === 'unread' ? 'Okunmamış bildiriminiz yok.' : 'Henüz hiç bildirim kaydedilmedi.'}
                </p>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          {notifications.length > 0 && (
            <div className="p-3 bg-[#0b1510]/80 border-t border-emerald-900/60 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={handleClearAll}
                className="text-rose-400 hover:text-rose-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Geçmişi Temizle</span>
              </button>

              <span className="text-[10px] text-emerald-400/50 font-mono">
                Canlı Atlası Bildirim Motoru v1.0
              </span>
            </div>
          )}

        </div>
      )}
    </div>
  );
};
