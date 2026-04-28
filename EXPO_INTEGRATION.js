// ═══════════════════════════════════════════════════════════════
// TCG TRACKER — Expo App Integration
// Drop these files into your Expo/React Native project
// ═══════════════════════════════════════════════════════════════

// ─── services/stockApi.js ─────────────────────────────────────
// Replace with your actual server IP or deployed URL.
// When testing on a real phone, use your computer's local IP (not localhost).
// e.g. http://192.168.1.50:3001  (find with `ipconfig` or `ifconfig`)

const API_BASE = 'http://YOUR_SERVER_IP:3001/api';

export async function getAllInStock(game = null) {
  const url = game ? `${API_BASE}/stock?game=${game}` : `${API_BASE}/stock`;
  const res = await fetch(url);
  const data = await res.json();
  return data.data || [];
}

export async function getProducts() {
  const res = await fetch(`${API_BASE}/products`);
  const data = await res.json();
  return data.data || [];
}

export async function registerPushToken(token, zipCode, games = []) {
  await fetch(`${API_BASE}/register-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, zip_code: zipCode, games }),
  });
}

// ─── hooks/usePushNotifications.js ────────────────────────────
// Add to your App.js root to register for alerts.
// npm install expo-notifications expo-device

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications({ zipCode, games }) {
  useEffect(() => {
    registerForPushNotifications();
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const { productId, retailer, url } = response.notification.request.content.data;
      console.log('Notification tapped:', { productId, retailer, url });
      // navigation.navigate('ProductDetail', { productId });
    });
    return () => sub.remove();
  }, []);

  async function registerForPushNotifications() {
    if (!Device.isDevice) return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('stock-alerts', {
        name: 'Stock Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: 'YOUR_EXPO_PROJECT_ID',
    });

    await registerPushToken(token, zipCode, games);
  }
}
