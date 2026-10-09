// busStopRule.ts
//
// Live bus departures for Bee Network / TfGM stops, scraped from
// the server-rendered stop page:
//
//   https://tfgm.com/travel-updates/live-departures/bus/{ATCO_CODE}
//
// Confirmed (Sept 2026) that this page renders the full departures list
// server-side with no JS required — the page's own no-JS fallback message
// ("Limited page functionality... JavaScript is turned off") only affects
// the live map and auto-refresh, not the initial departures list. That
// means a plain fetch() + cheerio parse is enough; no headless browser,
// which matters because Puppeteer/Playwright cannot run on the Pi 1B's
// ARMv6 chip at all.
//
// Selector strategy: prefer `data-testid` attributes and the `aria-label`
// on the timings block over the hashed vanilla-extract CSS classes
// (e.g. "_1dyw6pu24") — those hashes will change on every TfGM deploy,
// the testids and aria-labels are far more likely to survive.
//
// Multi-stop support: supports multiple configured stops defined either
// via the Dashboard Settings page (persisted in bus_stops_config.json) or
// via query parameters / environment variables.
//
// Env vars (lazy getters — read only at request time, per project
// convention, since eager module-level reads can capture empty values
// before dotenv.config() runs):
//   BUS_STOP_ATCO_CODE   e.g. "1800NC33691" — optional default stop
//   BUS_ROUTE_FILTER     Optional. e.g. "98" — passed through as
//                          ?serviceName= to only fetch one route.

import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { dataPath } from "./dataDir";

// ---- Lazy env getters ---------------------------------------------------
function getAtcoCode(): string {
  return process.env.BUS_STOP_ATCO_CODE || "1800NC33691";
}
function getRouteFilter(): string {
  return process.env.BUS_ROUTE_FILTER || "";
}

// ---- Types ----------------------------------------------------------------
export interface BusStopConfig {
  id: string;             // e.g. "stop-1"
  name: string;           // e.g. "Stand Lane / opp Clough St"
  atcoCode: string;       // e.g. "1800NC33691"
  routeFilter?: string;   // optional, e.g. "98"
  enabled?: boolean;
}

export interface BusDeparture {
  route: string;             // e.g. "98"
  destination: string;       // e.g. "Manchester Shudehill via Prestwich"
  dueInMins: number | null;  // null when only a clock time was available
  dueAtClock: string | null; // e.g. "21:33", set when dueInMins is null
  isRealtime: boolean;       // false if status text wasn't "Live"
  hasDisruption: boolean;
  tripId?: string;
  isMocked?: boolean;
}

export interface BusStopResult {
  id?: string;
  stopName: string;
  atcoCode: string;
  routeFilter?: string;
  departures: BusDeparture[];
  _isMockFallback: boolean;
  _fetchedAt: string;
  _mockError?: string;
  _fromCache?: boolean;
}

// ---- Default Bus Stops ---------------------------------------------------
export const DEFAULT_BUS_STOPS: BusStopConfig[] = [
  {
    id: "stop-1",
    name: "Stand Lane / opp Clough St (Inbound)",
    atcoCode: "1800NC33691",
    routeFilter: "98",
    enabled: true,
  },
  {
    id: "stop-2",
    name: "Stand Lane / nr Clough St (Outbound)",
    atcoCode: "1800NC33681",
    routeFilter: "",
    enabled: true,
  }
];

const CONFIG_PATH = dataPath("bus_stops_config.json");

export function getBusStopsConfig(): BusStopConfig[] {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      if (parsed.stops && Array.isArray(parsed.stops) && parsed.stops.length > 0) {
        return parsed.stops;
      }
    }
  } catch (err: any) {
    console.warn("Could not read bus_stops_config.json:", err.message);
  }

  // Fallback to env or defaults
  const envAtco = process.env.BUS_STOP_ATCO_CODE;
  if (envAtco) {
    return [
      {
        id: "stop-env",
        name: "Primary Bus Stop",
        atcoCode: envAtco,
        routeFilter: process.env.BUS_ROUTE_FILTER || "",
        enabled: true,
      }
    ];
  }

  return DEFAULT_BUS_STOPS;
}

export function saveBusStopsConfig(stops: BusStopConfig[]): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ stops }, null, 2), "utf-8");
  } catch (err: any) {
    console.error("Could not write bus_stops_config.json:", err.message);
  }
}

// ---- In-memory TTL cache (SD-card hygiene: no disk writes) ----------------
interface CacheEntry {
  data: BusStopResult;
  timestamp: number;
}
const cache: Record<string, CacheEntry> = {};
const CACHE_DURATION_MS = 45 * 1000; // bus times churn fast — much shorter than the 5 min solar cache

// ---- Mock fallback (mirrors the SolarEdge route's approach) --------------
export function generateMockDepartures(atco: string, customName?: string, routeFilter?: string): BusStopResult {
  const sample = [
    { route: routeFilter || "98", destination: "Manchester Shudehill via Prestwich", mins: 4 },
    { route: "471", destination: "Bolton Interchange", mins: 12 },
    { route: "512", destination: "Farnworth via Radcliffe", mins: 19 },
    { route: routeFilter || "98", destination: "Bury Interchange", mins: 28 },
  ];

  const departures: BusDeparture[] = sample.map((s) => ({
    route: s.route,
    destination: s.destination,
    dueInMins: s.mins,
    dueAtClock: null,
    isRealtime: false,
    hasDisruption: false,
    isMocked: true,
  }));

  return {
    stopName: customName || (atco ? `Stop ${atco}` : "Local Stop"),
    atcoCode: atco,
    routeFilter,
    departures,
    _isMockFallback: true,
    _fetchedAt: new Date().toISOString(),
  };
}

// ---- Live fetch + parse ----------------------------------------------------
export async function fetchDeparturesHtml(atco: string, routeFilter?: string): Promise<string> {
  const params = new URLSearchParams();
  const filter = routeFilter !== undefined ? routeFilter : getRouteFilter();
  if (filter) params.set("serviceName", filter);

  const qs = params.toString();
  const url = `https://tfgm.com/travel-updates/live-departures/bus/${encodeURIComponent(atco)}${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PersonalDashboard/1.0; non-commercial home use)",
      "Accept": "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`TfGM stop page responded with status ${response.status}`);
  }

  return response.text();
}

export function parseDeparturesHtml(html: string, atco: string, customName?: string, routeFilter?: string): BusStopResult {
  const $ = cheerio.load(html);

  const pageTitle = $("h1").first().text().trim();
  const stopName = customName || pageTitle || "Local Stop";

  const departures: BusDeparture[] = [];

  $('a[data-testid="departure-link"]').each((_i: number, el: any) => {
    const $el = $(el);

    // Route + destination come from the h3, formatted "98: Manchester Shudehill via Prestwich"
    const headsignRaw = $el.find("h3").first().text().trim();
    const colonIdx = headsignRaw.indexOf(":");
    const route = colonIdx > -1 ? headsignRaw.slice(0, colonIdx).trim() : "";
    const destination = colonIdx > -1 ? headsignRaw.slice(colonIdx + 1).trim() : headsignRaw;

    // The single most reliable field: aria-label on the timings block,
    // e.g. "Departs in 5 minutes, status: Live" or "Departs at 21:33, status: Live"
    const timingsEl = $el.find('[data-testid="bus-timings"]').first();
    const ariaLabel = (timingsEl.attr("aria-label") || "").trim();

    let dueInMins: number | null = null;
    let dueAtClock: string | null = null;

    const minsMatch = ariaLabel.match(/departs in (\d+)\s*minutes?/i);
    const clockMatch = ariaLabel.match(/departs at (\d{1,2}:\d{2})/i);

    if (minsMatch) {
      dueInMins = parseInt(minsMatch[1], 10);
    } else if (clockMatch) {
      dueAtClock = clockMatch[1];
    } else if (/due/i.test(ariaLabel)) {
      dueInMins = 0;
    } else {
      // Fallback: parse the visible "<p>5 mins</p>" text if aria-label
      // format ever changes underneath us.
      const visibleText = $el.find('[data-testid="bus-timings"] p').first().text().trim();
      const visibleMinsMatch = visibleText.match(/(\d+)\s*mins?/i);
      const visibleClockMatch = visibleText.match(/^(\d{1,2}:\d{2})$/);
      if (visibleMinsMatch) {
        dueInMins = parseInt(visibleMinsMatch[1], 10);
      } else if (visibleClockMatch) {
        dueAtClock = visibleClockMatch[1];
      } else if (/due/i.test(visibleText)) {
        dueInMins = 0;
      }
    }

    const isRealtime = /status:\s*live/i.test(ariaLabel);
    const hasDisruption = /service disruptions/i.test($el.text());

    const href = $el.attr("href") || "";
    const tripIdMatch = href.match(/tripId=([^&]+)/);
    const tripId = tripIdMatch ? decodeURIComponent(tripIdMatch[1]) : undefined;

    if (route && destination) {
      departures.push({
        route,
        destination,
        dueInMins,
        dueAtClock,
        isRealtime,
        hasDisruption,
        tripId,
      });
    }
  });

  // Page already returns departures in chronological order, but sort
  // defensively — items with only a clock time sort after timed-minute ones.
  departures.sort((a, b) => {
    const aVal = a.dueInMins ?? 9999;
    const bVal = b.dueInMins ?? 9999;
    return aVal - bVal;
  });

  return {
    stopName,
    atcoCode: atco,
    routeFilter,
    departures,
    _isMockFallback: false,
    _fetchedAt: new Date().toISOString(),
  };
}

// Helper to fetch and parse a single stop with caching
export async function getStopDepartures(
  atco: string,
  routeFilter?: string,
  customName?: string
): Promise<BusStopResult> {
  const effectiveFilter = routeFilter !== undefined ? routeFilter : getRouteFilter();
  const cacheKey = `${atco}:${effectiveFilter}`;

  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_DURATION_MS) {
    return { ...cache[cacheKey].data, _fromCache: true } as BusStopResult;
  }

  if (!atco) {
    const mock = generateMockDepartures("", customName, effectiveFilter);
    return { ...mock, _mockError: "BUS_STOP_ATCO_CODE not set" };
  }

  try {
    const html = await fetchDeparturesHtml(atco, effectiveFilter);
    const result = parseDeparturesHtml(html, atco, customName, effectiveFilter);

    if (result.departures.length === 0) {
      // Return the result with empty departures or throw to trigger fallback
      console.warn(`[Bus Stop ${atco}] Parsed 0 departures from TfGM live page.`);
    }

    cache[cacheKey] = { data: result, timestamp: now };
    return { ...result, _fromCache: false };
  } catch (error: any) {
    console.warn(`[Bus Stop ${atco}] Fetch/parse warning: ${error.message}. Serving fallback.`);
    const mock = generateMockDepartures(atco, customName, effectiveFilter);
    return { ...mock, _mockError: error.message };
  }
}

// ---- Express route handler --------------------------------------------
// Wireable directly into server.ts:
// app.get("/api/bus/departures", handleBusDeparturesRequest);
export async function handleBusDeparturesRequest(req: Request, res: Response) {
  const reqAtco = (req.query.atco as string) || (req.body?.atco as string) || "";
  const reqRoute = (req.query.route as string) || (req.body?.route as string) || "";
  const fetchAll = req.query.all === "true" || (!reqAtco && !req.query.single);
  const bodyStops = Array.isArray(req.body?.stops) ? req.body.stops.filter((s: any) => s && s.atcoCode) : null;

  // 1. If a specific single stop is explicitly requested:
  if (reqAtco && !fetchAll && !bodyStops) {
    const result = await getStopDepartures(reqAtco, reqRoute);
    return res.json(result);
  }

  // 2. Fetch all configured stops (supports stops array passed via body, or saved server config)
  const configuredStops = bodyStops && bodyStops.length > 0
    ? bodyStops.filter((s: any) => s.enabled !== false)
    : getBusStopsConfig().filter((s) => s.enabled !== false);

  const targetStops = configuredStops.length > 0 ? configuredStops : [
    {
      id: "stop-default",
      name: "Local Bus Stop",
      atcoCode: getAtcoCode(),
      routeFilter: getRouteFilter(),
      enabled: true,
    }
  ];

  try {
    const results = await Promise.all(
      targetStops.map(async (stop) => {
        const stopResult = await getStopDepartures(stop.atcoCode, stop.routeFilter, stop.name);
        return {
          ...stopResult,
          id: stop.id,
          stopName: stop.name || stopResult.stopName,
        };
      })
    );

    // Provide multi-stop response payload with backward-compatible single stop fields
    const primary = results[0] || generateMockDepartures(getAtcoCode());
    return res.json({
      stops: results,
      totalStops: results.length,
      // Backward-compatibility properties matching single BusStopResult
      stopName: primary.stopName,
      atcoCode: primary.atcoCode,
      departures: primary.departures,
      _isMockFallback: primary._isMockFallback,
      _fetchedAt: primary._fetchedAt,
      _mockError: primary._mockError,
    });
  } catch (error: any) {
    console.error("Bus departures multi-stop handler failed:", error.message);
    const mock = generateMockDepartures(getAtcoCode());
    return res.json({
      stops: [mock],
      totalStops: 1,
      ...mock,
      _mockError: error.message,
    });
  }
}

// Config endpoints for settings page
export async function handleBusConfigRequest(req: Request, res: Response) {
  if (req.method === "POST") {
    const { stops } = req.body || {};
    if (!Array.isArray(stops)) {
      return res.status(400).json({ error: "Invalid payload: 'stops' must be an array" });
    }
    saveBusStopsConfig(stops);
    return res.json({ success: true, stops });
  }

  // GET
  const stops = getBusStopsConfig();
  return res.json({ stops });
}
