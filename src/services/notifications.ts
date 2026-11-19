import { AtlasNotification, NotificationType } from '../types/notifications';

const STORAGE_KEY = 'canli_atlasi_notifications_v1';

const INITIAL_NOTIFICATIONS: AtlasNotification[] = [
  {
    id: 'notif-1',
    type: 'NEW_SPECIES',
    title: 'Yeni Doğrulanmış Tür Keşfi',
    message: 'GBIF Backbone arşivinde Anadolu kuşağı için yeni bir endemik tür kaydı (*Vipera anatolica*) doğrulanarak eklendi.',
    timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    read: false,
    scientificName: 'Vipera anatolica',
    severity: 'success',
  },
  {
    id: 'notif-2',
    type: 'NEW_OBSERVATION',
    title: 'Yeni Gözlem Kayıtları Geldi',
    message: 'Takip edilen türlerden Bozayı (*Ursus arctos*) için Artvin bölgesinde son 24 saat içinde 12 yeni GPS gözlem kaydı işlendi.',
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    read: false,
    scientificName: 'Ursus arctos',
    severity: 'info',
  },
  {
    id: 'notif-3',
    type: 'CONSERVATION_STATUS',
    title: 'IUCN Koruma Kategorisi Güncellendi',
    message: 'Akdeniz Foku (*Monachus monachus*) için IUCN Kırmızı Liste değerlendirmesi güncellendi; bölgesel koruma önlemleri artırıldı.',
    timestamp: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
    read: true,
    scientificName: 'Monachus monachus',
    severity: 'warning',
  },
  {
    id: 'notif-4',
    type: 'NEW_DATA',
    title: 'Bölgesel Veri Seti Senkronize Edildi',
    message: 'Türkiye (TR) bütününde il bazlı STATE_PROVINCE faset istatistikleri ve koordinat normalizasyonları güncellendi.',
    timestamp: new Date(Date.now() - 1000 * 60 * 720).toISOString(),
    read: true,
    severity: 'accent',
  },
  {
    id: 'notif-5',
    type: 'NEW_DISCOVERY',
    title: 'Genel Hayvan Grubunda Yeni Keşifler',
    message: 'Kuşlar (Aves) ve Memeliler (Mammalia) alt grup arama indeksine 48 yeni doğrulanmış takson eklendi.',
    timestamp: new Date(Date.now() - 1000 * 60 * 1440).toISOString(),
    read: true,
    severity: 'success',
  },
];

export function getStoredNotifications(): AtlasNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_NOTIFICATIONS));
      return INITIAL_NOTIFICATIONS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_NOTIFICATIONS;
  }
}

export function saveStoredNotifications(notifications: AtlasNotification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  } catch (e) {
    console.warn('Failed to save notifications to localStorage:', e);
  }
}

export async function requestBrowserNotificationPermission(): Promise<{ granted: boolean; message: string }> {
  if (!('Notification' in window)) {
    return { granted: false, message: 'Tarayıcınız masaüstü bildirimlerini desteklemiyor.' };
  }

  if (Notification.permission === 'granted') {
    return { granted: true, message: 'Tarayıcı bildirim izni zaten verilmiş.' };
  }

  if (Notification.permission === 'denied') {
    return { 
      granted: false, 
      message: 'Bildirim izni tarayıcı ayarlarından engellenmiş. Lütfen tarayıcı site ayarlarından izni etkinleştirin.' 
    };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showBrowserPushNotification('Canlı Atlası Bildirimleri Aktif', 'Yeni tür keşifleri ve gözlem güncellemeleri anlık olarak bildirilecektir.');
      return { granted: true, message: 'Tarayıcı bildirim izni başarıyla verildi.' };
    }
    return { granted: false, message: 'Bildirim izni reddedildi.' };
  } catch (e: any) {
    return { granted: false, message: e?.message || 'Bildirim izni istenirken bir hata oluştu.' };
  }
}

export function showBrowserPushNotification(title: string, body: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    // Service Worker registration push fallback or standard Notification API
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'canli-atlasi-notification',
        } as NotificationOptions);
      }).catch(() => {
        new Notification(title, { body, icon: '/favicon.ico' });
      });
    } else {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  } catch (err) {
    console.warn('Browser push notification display failed:', err);
  }
}
