// alertsStore.ts
interface AlertItem {
  key: string;
  payload: any;
  expiresAt: number;
}

const alertsStore = new Map<string, AlertItem>();

export function setAlert(key: string, payload: any, ttlMs: number): void {
  const expiresAt = Date.now() + ttlMs;
  alertsStore.set(key, { key, payload, expiresAt });
}

export function getAlert(key: string): any | null {
  const item = alertsStore.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    alertsStore.delete(key);
    return null;
  }
  return item.payload;
}

export function getAllAlerts(): Record<string, any> {
  const result: Record<string, any> = {};
  const now = Date.now();
  for (const [key, item] of alertsStore.entries()) {
    if (now > item.expiresAt) {
      alertsStore.delete(key);
    } else {
      result[key] = item.payload;
    }
  }
  return result;
}
