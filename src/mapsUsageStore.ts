import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(process.cwd(), 'maps_usage_store.json');
export const MONTHLY_HARD_LIMIT = 5000;

export interface MapsUsageData {
  currentMonth: string; // e.g. "2026-08"
  monthlyElementCount: number;
  monthlyLimit: number;
  history: Record<string, number>;
  lastUpdated: string;
}

function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getMapsUsage(): MapsUsageData {
  const currentMonthKey = getCurrentMonthKey();
  
  let store: MapsUsageData = {
    currentMonth: currentMonthKey,
    monthlyElementCount: 0,
    monthlyLimit: MONTHLY_HARD_LIMIT,
    history: {},
    lastUpdated: new Date().toISOString(),
  };

  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        store = { ...store, ...parsed };
      }
    }
  } catch (err) {
    console.error('Failed to read maps_usage_store.json, creating new store:', err);
  }

  // Handle month turnover
  if (store.currentMonth !== currentMonthKey) {
    if (store.currentMonth && store.monthlyElementCount > 0) {
      store.history[store.currentMonth] = store.monthlyElementCount;
    }
    store.currentMonth = currentMonthKey;
    store.monthlyElementCount = 0;
    store.monthlyLimit = MONTHLY_HARD_LIMIT;
    saveMapsUsage(store);
  }

  return store;
}

export function saveMapsUsage(store: MapsUsageData): void {
  try {
    store.lastUpdated = new Date().toISOString();
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write maps_usage_store.json:', err);
  }
}

export function isQuotaAvailable(elementsRequested: number): boolean {
  const usage = getMapsUsage();
  return usage.monthlyElementCount + elementsRequested <= MONTHLY_HARD_LIMIT;
}

export function recordUsage(elementsCount: number): MapsUsageData {
  const usage = getMapsUsage();
  usage.monthlyElementCount += elementsCount;
  usage.history[usage.currentMonth] = usage.monthlyElementCount;
  saveMapsUsage(usage);
  return usage;
}

export function checkAndRecordUsage(elementsRequested: number): { allowed: boolean; usage: MapsUsageData } {
  const usage = getMapsUsage();
  
  if (usage.monthlyElementCount + elementsRequested > MONTHLY_HARD_LIMIT) {
    return { allowed: false, usage };
  }

  usage.monthlyElementCount += elementsRequested;
  usage.history[usage.currentMonth] = usage.monthlyElementCount;
  saveMapsUsage(usage);

  return { allowed: true, usage };
}
