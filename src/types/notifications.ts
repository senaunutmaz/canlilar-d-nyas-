export type NotificationType = 
  | 'NEW_SPECIES' 
  | 'NEW_OBSERVATION' 
  | 'CONSERVATION_STATUS' 
  | 'NEW_DATA' 
  | 'NEW_DISCOVERY';

export interface AtlasNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  scientificName?: string;
  category?: string;
  severity?: 'info' | 'success' | 'warning' | 'accent';
}

export interface PushNotificationSettings {
  enabled: boolean;
  permissionState: NotificationPermission | 'default';
  vapidConfigured: boolean;
}
