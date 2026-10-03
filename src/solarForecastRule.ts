// solarForecastRule.ts
//
// Computes tomorrow's expected solar generation using Open-Meteo's
// tilt-corrected irradiance data (global_tilted_irradiance), compares it
// against the household's off-peak charging threshold, and publishes an
// overnight charging recommendation ahead of the 1am-2am off-peak window.
//
// Automatically auto-discovers site location (latitude, longitude), system
// peak capacity (array kWp), and battery size directly from SolarEdge API
// (details & inventory endpoints) to minimize manual env variables.

import { setAlert } from "./alertsStore";

// ---- Site configuration & default fallbacks ----
const DEFAULT_SOLAR_LAT = parseFloat(process.env.SOLAR_LAT || "53.4808");
const DEFAULT_SOLAR_LON = parseFloat(process.env.SOLAR_LON || "-2.2426");
const DEFAULT_ARRAY_KWP = parseFloat(process.env.SOLAR_ARRAY_KWP || "9.3");
const DEFAULT_BATTERY_USABLE_KWH = parseFloat(process.env.SOLAR_BATTERY_USABLE_KWH || "10.3");

// Roof geometry & rule thresholds (optional overrides via env)
const SOLAR_TILT_DEG = parseFloat(process.env.SOLAR_TILT_DEG || "35");
const SOLAR_AZIMUTH_DEG = parseFloat(process.env.SOLAR_AZIMUTH_DEG || "0");
const PERFORMANCE_RATIO = parseFloat(process.env.SOLAR_PERFORMANCE_RATIO || "0.8");
const CHARGE_THRESHOLD_KWH = parseFloat(process.env.SOLAR_CHARGE_THRESHOLD_KWH || "8.2");
const BATTERY_FULL_SKIP_PCT = parseFloat(process.env.SOLAR_BATTERY_FULL_SKIP_PCT || "90");

const SOLAREDGE_API_KEY = process.env.SOLAREDGE_API_KEY || "";
const SOLAREDGE_SITE_ID = process.env.SOLAREDGE_SITE_ID || "";

// Rule scheduling: fires ahead of the 1am-2am off-peak window
const RULE_TRIGGER_HOUR = 0;
const RULE_TRIGGER_MINUTE = 30;

interface SolarEdgeSiteMetadata {
  lat?: number;
  lon?: number;
  peakPowerKwp?: number;
  batteryCapacityKwh?: number;
}

let cachedMetadata: SolarEdgeSiteMetadata | null = null;
let metadataFetchedAt = 0;

/**
 * Automatically fetch site location, array size (kWp), and battery capacity from
 * SolarEdge details and inventory API endpoints. Caches metadata in memory for 12 hours.
 */
export async function getSolarEdgeSiteMetadata(): Promise<SolarEdgeSiteMetadata | null> {
  if (!SOLAREDGE_API_KEY || !SOLAREDGE_SITE_ID) return null;

  const now = Date.now();
  if (cachedMetadata && now - metadataFetchedAt < 12 * 60 * 60 * 1000) {
    return cachedMetadata;
  }

  const metadata: SolarEdgeSiteMetadata = {};

  try {
    // 1. Fetch site details (location & peak power)
    const detailsUrl = `https://monitoringapi.solaredge.com/site/${SOLAREDGE_SITE_ID}/details?api_key=${SOLAREDGE_API_KEY}`;
    const detailsRes = await fetch(detailsUrl, { headers: { Accept: "application/json" } });
    if (detailsRes.ok) {
      const data: any = await detailsRes.json();
      const details = data?.details;
      if (details) {
        if (typeof details.peakPower === "number" && details.peakPower > 0) {
          metadata.peakPowerKwp = details.peakPower > 100 ? details.peakPower / 1000 : details.peakPower;
        }
        if (details.location) {
          if (typeof details.location.latitude === "number") {
            metadata.lat = details.location.latitude;
          }
          if (typeof details.location.longitude === "number") {
            metadata.lon = details.location.longitude;
          }
        }
      }
    }
  } catch (err) {
    console.error("solarForecastRule: failed to fetch site details", err);
  }

  try {
    // 2. Fetch inventory for battery capacity
    const invUrl = `https://monitoringapi.solaredge.com/site/${SOLAREDGE_SITE_ID}/inventory?api_key=${SOLAREDGE_API_KEY}`;
    const invRes = await fetch(invUrl, { headers: { Accept: "application/json" } });
    if (invRes.ok) {
      const invData: any = await invRes.json();
      const batteries = invData?.ReporterInventory?.batteries;
      if (Array.isArray(batteries) && batteries.length > 0) {
        let totalWh = 0;
        for (const bat of batteries) {
          if (typeof bat.nameplateCapacity === "number" && bat.nameplateCapacity > 0) {
            totalWh += bat.nameplateCapacity;
          }
        }
        if (totalWh > 0) {
          metadata.batteryCapacityKwh = Math.round((totalWh / 1000) * 10) / 10;
        }
      }
    }
  } catch (err) {
    console.error("solarForecastRule: failed to fetch site inventory", err);
  }

  if (Object.keys(metadata).length > 0) {
    cachedMetadata = metadata;
    metadataFetchedAt = now;
    return metadata;
  }

  return null;
}

interface ForecastResult {
  forecastKwh: number;
  hourlyIrradianceWm2: number[];
  usedFallbackIrradiance: boolean;
  computedAt: string;
}

interface RuleResult extends ForecastResult {
  currentBatteryPct: number | null;
  batteryHeadroomKwh: number | null;
  chargeOvernight: boolean;
  reason: string;
}

/**
 * Fetch tomorrow's tilt-corrected irradiance from Open-Meteo and integrate
 * it into an expected generation figure (kWh) for the array.
 *
 * Uses auto-discovered site coordinates and array kWp when available.
 */
export async function computeTomorrowForecastKwh(meta?: SolarEdgeSiteMetadata | null): Promise<ForecastResult> {
  const lat = meta?.lat ?? DEFAULT_SOLAR_LAT;
  const lon = meta?.lon ?? DEFAULT_SOLAR_LON;
  const arrayKwp = meta?.peakPowerKwp ?? DEFAULT_ARRAY_KWP;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=global_tilted_irradiance,shortwave_radiation` +
    `&tilt=${SOLAR_TILT_DEG}&azimuth=${SOLAR_AZIMUTH_DEG}` +
    `&forecast_days=2`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status}`);
  }
  const data: any = await res.json();

  // Hours 24-47 in the hourly array correspond to "tomorrow"
  const gti: number[] = data?.hourly?.global_tilted_irradiance?.slice(24, 48) || [];
  const shortwave: number[] = data?.hourly?.shortwave_radiation?.slice(24, 48) || [];

  const usedFallbackIrradiance = gti.length !== 24;
  const hourlyIrradianceWm2 = usedFallbackIrradiance ? shortwave : gti;

  const forecastKwh = hourlyIrradianceWm2.reduce((sum, wm2) => {
    // W/m^2 sustained over one hour -> kWh contribution for the whole array
    return sum + (wm2 / 1000) * arrayKwp * PERFORMANCE_RATIO;
  }, 0);

  return {
    forecastKwh: Math.round(forecastKwh * 100) / 100,
    hourlyIrradianceWm2,
    usedFallbackIrradiance,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Pull current battery state of charge directly from SolarEdge (bypassing
 * the Express /api/solaredge/powerflow proxy and its cache, since this
 * runs server-side already) so the rule can skip charging if the battery
 * is already well stocked, regardless of tomorrow's forecast.
 */
async function getCurrentBatteryPct(): Promise<number | null> {
  if (!SOLAREDGE_API_KEY || !SOLAREDGE_SITE_ID) return null;

  try {
    const url = `https://monitoringapi.solaredge.com/site/${SOLAREDGE_SITE_ID}/currentPowerFlow?api_key=${SOLAREDGE_API_KEY}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.siteCurrentPowerFlow?.STORAGE?.chargeLevel ?? null;
  } catch (err) {
    console.error("solarForecastRule: failed to read battery state", err);
    return null;
  }
}

/**
 * Full evaluation: forecast tomorrow's generation, check current battery
 * headroom, and decide whether to recommend an overnight off-peak charge.
 */
export async function evaluateSolarForecastRule(): Promise<RuleResult> {
  const siteMeta = await getSolarEdgeSiteMetadata();
  const batteryCapacityKwh = siteMeta?.batteryCapacityKwh ?? DEFAULT_BATTERY_USABLE_KWH;

  const forecast = await computeTomorrowForecastKwh(siteMeta);
  const currentBatteryPct = await getCurrentBatteryPct();

  const batteryHeadroomKwh =
    currentBatteryPct !== null
      ? Math.round(((100 - currentBatteryPct) / 100) * batteryCapacityKwh * 100) / 100
      : null;

  const batteryAlreadyFull =
    currentBatteryPct !== null && currentBatteryPct >= BATTERY_FULL_SKIP_PCT;

  const forecastShortfall = forecast.forecastKwh < CHARGE_THRESHOLD_KWH;

  const chargeOvernight = forecastShortfall && !batteryAlreadyFull;

  let reason: string;
  if (batteryAlreadyFull) {
    reason = `Battery already at ${currentBatteryPct}% (>= ${BATTERY_FULL_SKIP_PCT}%) - skipping charge regardless of forecast.`;
  } else if (forecastShortfall) {
    reason = `Forecast ${forecast.forecastKwh} kWh < ${CHARGE_THRESHOLD_KWH} kWh threshold - charging overnight.`;
  } else {
    reason = `Forecast ${forecast.forecastKwh} kWh >= ${CHARGE_THRESHOLD_KWH} kWh threshold - relying on solar tomorrow.`;
  }

  if (forecast.usedFallbackIrradiance) {
    reason += " (Note: GTI unavailable, used flat GHI as fallback.)";
  }

  return {
    ...forecast,
    currentBatteryPct,
    batteryHeadroomKwh,
    chargeOvernight,
    reason,
  };
}

/**
 * Runs the rule and publishes the result into the in-memory alerts store
 * so the dashboard's Overnight Charging Optimizer panel can display it via
 * the existing /api/alerts polling endpoint, instead of re-deriving its
 * own guess client-side.
 */
async function runAndPublish(): Promise<void> {
  try {
    const result = await evaluateSolarForecastRule();

    setAlert(
      "solar-forecast",
      {
        type: "solar-forecast",
        chargeOvernight: result.chargeOvernight,
        forecastKwh: result.forecastKwh,
        thresholdKwh: CHARGE_THRESHOLD_KWH,
        currentBatteryPct: result.currentBatteryPct,
        batteryHeadroomKwh: result.batteryHeadroomKwh,
        reason: result.reason,
        computedAt: result.computedAt,
      },
      // Covers the off-peak window plus buffer; next day's 00:30 run
      // replaces it regardless.
      6 * 60 * 60 * 1000 // 6 hours
    );

    console.log(`[solarForecastRule] ${result.reason}`);
  } catch (err) {
    console.error("[solarForecastRule] evaluation failed", err);
  }
}

/**
 * Schedules runAndPublish() to fire at 00:30 daily (ahead of the 1am-2am
 * off-peak window), then reschedules itself every 24h. Also runs once on
 * startup so a Pi reboot or service restart after 00:30 doesn't leave the
 * dashboard without a recommendation until the following night.
 */
export function startSolarForecastRule(): void {
  const msUntilNextTrigger = (): number => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(RULE_TRIGGER_HOUR, RULE_TRIGGER_MINUTE, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    const delay = msUntilNextTrigger();
    setTimeout(async () => {
      await runAndPublish();
      scheduleNext();
    }, delay);
    console.log(
      `[solarForecastRule] next run in ${Math.round(delay / 60000)} min (00:30 trigger)`
    );
  };

  // Run once immediately on boot so the alert store always has a current
  // value, then settle into the daily 00:30 cadence.
  runAndPublish();
  scheduleNext();
}
