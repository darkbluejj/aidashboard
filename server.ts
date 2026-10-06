import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import nodeIcal from "node-ical";
import { startSonosCleardownRule, runTrigger, runRevert, rescheduleSonosRule } from "./src/sonosRule";
import { setAlert, getAlert, getAllAlerts } from "./src/alertsStore";
import { startSolarForecastRule, evaluateSolarForecastRule } from "./src/solarForecastRule";
import { getMapsUsage, checkAndRecordUsage, isQuotaAvailable, recordUsage } from "./src/mapsUsageStore";
import { handleBusDeparturesRequest, handleBusConfigRequest } from "./busStopRule";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = 3000;

// Simple memory cache for APIs to prevent rate limit issues
interface CacheEntry {
  data: any;
  timestamp: number;
}
const cache: { [key: string]: CacheEntry } = {};
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache

// API proxy route for SolarEdge Current Power Flow
app.get("/api/solaredge/powerflow", async (req, res) => {
  const apiKey = process.env.SOLAREDGE_API_KEY || "";
  const siteId = process.env.SOLAREDGE_SITE_ID || "";
  const cacheKey = `${siteId || "default"}-powerflow`;

  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_DURATION_MS) {
    return res.json({ ...cache[cacheKey].data, _fromCache: true });
  }

  try {
    if (!siteId || !apiKey) {
      throw new Error("SolarEdge credentials not configured");
    }

    const url = `https://monitoringapi.solaredge.com/site/${siteId}/currentPowerFlow?api_key=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`SolarEdge API responded with status: ${response.status}`);
    }

    const data = await response.json();
    
    // Validate that we got a valid response containing siteCurrentPowerFlow
    if (data && data.siteCurrentPowerFlow) {
      cache[cacheKey] = { data, timestamp: now };
      return res.json({ ...data, _fromCache: false });
    } else {
      throw new Error("Invalid response format from SolarEdge API");
    }
  } catch (error: any) {
    // Fallback operation - silently serving mock data instead of crashing
    const timeOfDay = new Date().getHours();
    let pvPower = 0;
    let gridPower = 0;
    let loadPower = 1.2;
    let storagePower = 0;
    let storageLevel = 68;
    let storageStatus = "Idle";
    const connections: any[] = [];

    if (timeOfDay >= 6 && timeOfDay < 18) {
      const peakFactor = Math.sin(((timeOfDay - 6) / 12) * Math.PI);
      pvPower = parseFloat((4.5 * peakFactor).toFixed(2));
      loadPower = parseFloat((0.8 + Math.random() * 0.6).toFixed(2));
      
      if (pvPower > loadPower) {
        const excess = pvPower - loadPower;
        storageLevel = Math.min(100, Math.round(50 + (timeOfDay - 6) * 4));
        if (storageLevel < 100) {
          storagePower = parseFloat(Math.min(excess, 2.5).toFixed(2));
          storageStatus = "Charging";
          connections.push({ from: "PV", to: "STORAGE" });
          
          const remainingExcess = excess - storagePower;
          if (remainingExcess > 0) {
            gridPower = parseFloat((-remainingExcess).toFixed(2));
            connections.push({ from: "PV", to: "Grid" });
          }
        } else {
          gridPower = parseFloat((-excess).toFixed(2));
          connections.push({ from: "PV", to: "Grid" });
        }
        connections.push({ from: "PV", to: "Load" });
      } else {
        const deficit = loadPower - pvPower;
        storagePower = parseFloat(deficit.toFixed(2));
        storageStatus = "Discharging";
        connections.push({ from: "PV", to: "Load" });
        connections.push({ from: "STORAGE", to: "Load" });
      }
    } else {
      pvPower = 0;
      loadPower = parseFloat((0.5 + Math.random() * 0.4).toFixed(2));
      storageLevel = Math.max(10, Math.round(90 - (timeOfDay >= 18 ? timeOfDay - 18 : timeOfDay + 6) * 5));
      
      if (storageLevel > 15) {
        storagePower = loadPower;
        storageStatus = "Discharging";
        connections.push({ from: "STORAGE", to: "Load" });
      } else {
        gridPower = loadPower;
        storagePower = 0;
        storageStatus = "Idle";
        connections.push({ from: "GRID", to: "Load" });
      }
    }

    const fallbackData = {
      siteCurrentPowerFlow: {
        updateRefreshRate: 3,
        unit: "kW",
        connections,
        GRID: { status: gridPower !== 0 ? "Active" : "Idle", currentPower: Math.abs(gridPower) },
        LOAD: { status: "Active", currentPower: loadPower },
        PV: { status: pvPower > 0 ? "Active" : "Idle", currentPower: pvPower },
        STORAGE: { status: storageStatus, currentPower: storagePower, chargeLevel: storageLevel, critical: false }
      },
      _isMockFallback: true,
      _mockError: error.message
    };

    return res.json(fallbackData);
  }
});

// Weather Proxy Route
app.get("/api/weather", async (req, res) => {
  const cacheKey = "weather-open-meteo";
  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].timestamp < 5 * 60 * 1000) {
    return res.json(cache[cacheKey].data);
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=53.4808&longitude=-2.2426&current_weather=true&hourly=temperature_2m,precipitation_probability,precipitation,uv_index,wind_speed_10m&forecast_days=2&wind_speed_unit=mph`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }

    const data = await response.json();
    cache[cacheKey] = { data, timestamp: now };
    return res.json(data);
  } catch (error) {
    if (cache[cacheKey]) {
      return res.json(cache[cacheKey].data);
    }
    const fallbackData = {
      current_weather: { temperature: 16, weathercode: 3 },
      hourly: {
        time: Array.from({ length: 48 }, (_, i) => new Date(now + i * 3600000).toISOString()),
        temperature_2m: Array.from({ length: 48 }, (_, i) => 14 + Math.sin(i / 3) * 5),
        precipitation_probability: Array.from({ length: 48 }, () => 20),
        precipitation: Array.from({ length: 48 }, () => 0.1),
        uv_index: Array.from({ length: 48 }, (_, i) => Math.max(0, Math.sin((i % 24) / 4) * 4)),
        wind_speed_10m: Array.from({ length: 48 }, () => 10)
      }
    };
    return res.json(fallbackData);
  }
});

// GET /api/traffic/usage - Check Google Maps API monthly usage status
app.get("/api/traffic/usage", (req, res) => {
  const usage = getMapsUsage();
  res.json(usage);
});

// POST /api/traffic - Server-side proxy for Google Routes / Distance Matrix API with quota tracking and resilient fallback
app.post("/api/traffic", async (req, res) => {
  const { origin, destinations, bypass } = req.body || {};
  const mapsApiKey = process.env.VITE_GOOGLE_MAPS_PLATFORM_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
  const usageData = getMapsUsage();

  if (!origin || !Array.isArray(destinations) || destinations.length === 0) {
    return res.status(400).json({ error: "Missing origin or destinations array" });
  }

  // 1. Time gating check
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const timeVal = hour * 100 + min;
  const isWeekday = now.getDay() > 0 && now.getDay() < 6;
  const isWithinCoreHours = isWeekday && (timeVal >= 630 && timeVal <= 930);
  const isLiveAllowed = isWithinCoreHours || !!bypass;

  // 2. Cache Check (30 minutes in-memory cache)
  const destString = destinations.map((d: any) => d.address || d.name || '').join('_');
  const cacheKey = `traffic_${origin}_${destString}`;
  const nowMs = Date.now();

  // Helper for simulated fallback response
  const returnFallback = (reason: string, isQuotaError = false, cacheDurationMs = 15 * 60 * 1000) => {
    const items = destinations.map((d: any) => {
      const defaultMins = typeof d.defaultMins === 'number' ? d.defaultMins : 20;
      const randomShift = Math.floor(Math.random() * 5) - 2;
      const mockMins = Math.max(1, defaultMins + randomShift);
      return {
        id: d.id,
        name: d.name,
        address: d.address,
        durationText: `${mockMins} mins (est.)`,
        durationValueSec: mockMins * 60,
        colorClass: mockMins > defaultMins + 1 ? 'text-amber-500' : 'text-emerald-500',
        isFallback: true,
        fallbackReason: reason
      };
    });

    const payload = {
      items,
      isFallback: true,
      fallbackReason: reason,
      quotaExceeded: isQuotaError,
      usage: getMapsUsage(),
      updatedAt: new Date().toISOString()
    };

    if (cacheDurationMs > 0) {
      cache[cacheKey] = { data: payload, timestamp: nowMs };
    }

    return res.json(payload);
  };

  if (cache[cacheKey] && (nowMs - cache[cacheKey].timestamp < 30 * 60 * 1000)) {
    return res.json({
      ...cache[cacheKey].data,
      fromCache: true,
      usage: getMapsUsage()
    });
  }

  if (!isLiveAllowed) {
    return returnFallback("Outside core hours (06:30-09:30)", false, 5 * 60 * 1000);
  }

  if (!mapsApiKey) {
    return returnFallback("Google Maps API key not configured", false, 30 * 60 * 1000);
  }

  // 3. HARD QUOTA CHECK: Ensure elements <= 5,000 per month without premature deduction
  const numElementsRequested = destinations.length;
  if (!isQuotaAvailable(numElementsRequested)) {
    console.warn(`[Google Maps Traffic] Monthly limit of 5,000 elements reached! (${usageData.monthlyElementCount}/${usageData.monthlyLimit}). Serving fallback estimates.`);
    return returnFallback("Monthly Google Maps API hard quota limit reached (5,000 calls/mo)", true, 30 * 60 * 1000);
  }

  // 4. Attempt Google Maps Routes API (modern standard) first, falling back to Distance Matrix
  try {
    const clientReferer = (req.headers['referer'] as string) || (req.headers['origin'] as string) || '';

    // Step 4a: Try modern Routes API (ComputeRouteMatrix)
    let routesSucceeded = false;
    let itemsResult: any[] = [];

    try {
      const routesUrl = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
      const routesController = new AbortController();
      const routesTimeout = setTimeout(() => routesController.abort(), 6000);

      const routesRes = await fetch(routesUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": mapsApiKey,
          "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
          "X-Goog-Maps-Solution-ID": "gmp_mcp_codeassist_v1_aistudio"
        },
        body: JSON.stringify({
          origins: [{ waypoint: { address: origin } }],
          destinations: destinations.map((d: any) => ({ waypoint: { address: d.address || d.name } })),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE"
        }),
        signal: routesController.signal
      });
      clearTimeout(routesTimeout);

      if (routesRes.ok) {
        const routesData = await routesRes.json();
        if (Array.isArray(routesData) && routesData.length > 0 && !routesData[0]?.error) {
          const elementsMap = new Map<number, any>();
          routesData.forEach((el: any) => {
            if (typeof el.destinationIndex === 'number') {
              elementsMap.set(el.destinationIndex, el);
            }
          });

          itemsResult = destinations.map((d: any, idx: number) => {
            const el = elementsMap.get(idx);
            if (el && el.duration) {
              const seconds = parseInt(el.duration.replace("s", ""), 10) || 0;
              const mins = Math.max(1, Math.round(seconds / 60));
              const defaultMins = typeof d.defaultMins === 'number' ? d.defaultMins : 20;

              let colorClass = 'text-emerald-500';
              if (mins > defaultMins + 5) {
                colorClass = 'text-rose-500';
              } else if (mins > defaultMins + 1) {
                colorClass = 'text-amber-500';
              }

              return {
                id: d.id,
                name: d.name,
                address: d.address,
                durationText: `${mins} mins`,
                durationValueSec: seconds,
                distanceText: el.distanceMeters ? `${(el.distanceMeters / 1609.34).toFixed(1)} mi` : '',
                colorClass,
                isFallback: false
              };
            } else {
              const defaultMins = typeof d.defaultMins === 'number' ? d.defaultMins : 20;
              return {
                id: d.id,
                name: d.name,
                address: d.address,
                durationText: `${defaultMins} mins (est.)`,
                durationValueSec: defaultMins * 60,
                colorClass: 'text-gray-500',
                isFallback: true,
                fallbackReason: 'Route not found'
              };
            }
          });

          routesSucceeded = true;
        }
      }
    } catch {
      // Routes API didn't succeed, proceed to Distance Matrix fallback
    }

    if (routesSucceeded && itemsResult.length > 0) {
      const updatedUsage = recordUsage(destinations.length);
      const responsePayload = {
        items: itemsResult,
        isFallback: false,
        quotaExceeded: false,
        usage: updatedUsage,
        updatedAt: new Date().toISOString()
      };
      cache[cacheKey] = { data: responsePayload, timestamp: nowMs };
      return res.json(responsePayload);
    }

    // Step 4b: Distance Matrix API fallback
    const destAddresses = destinations.map((d: any) => d.address || d.name).join("|");
    const mapsUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destAddresses)}&mode=driving&departure_time=now&traffic_model=best_guess&key=${mapsApiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (clientReferer) {
      headers["Referer"] = clientReferer;
    }

    const googleRes = await fetch(mapsUrl, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!googleRes.ok) {
      console.warn(`[Google Maps Traffic] Distance Matrix HTTP ${googleRes.status}`);
      return returnFallback("Unable to connect to Google Maps — showing commute estimates", false, 10 * 60 * 1000);
    }

    const data = await googleRes.json();

    if (data.status === "REQUEST_DENIED") {
      console.warn(`[Google Maps Traffic] API request denied: ${data.error_message || "API key restriction active"}`);
      return returnFallback("Google Maps API key is restricted in Google Cloud Console — showing commute estimates", false, 15 * 60 * 1000);
    }

    if (data.status === "OVER_QUERY_LIMIT") {
      console.warn("[Google Maps Traffic] Over query limit. Serving commute estimates.");
      return returnFallback("Google Maps query limit reached — showing commute estimates", true, 30 * 60 * 1000);
    }

    if (data.status !== "OK" || !data.rows?.[0]?.elements) {
      console.warn(`[Google Maps Traffic] Distance Matrix status (${data.status}). Serving commute estimates.`);
      return returnFallback(`Google Maps status (${data.status}) — showing commute estimates`, false, 10 * 60 * 1000);
    }

    const elements = data.rows[0].elements;
    const items = destinations.map((d: any, idx: number) => {
      const el = elements[idx];
      if (el && el.status === "OK" && el.duration_in_traffic) {
        const liveSecs = el.duration_in_traffic.value;
        const standardSecs = el.duration?.value || liveSecs;
        const ratio = liveSecs / standardSecs;

        let colorClass = 'text-emerald-500';
        if (ratio > 1.35) {
          colorClass = 'text-rose-500';
        } else if (ratio > 1.15) {
          colorClass = 'text-amber-500';
        }

        return {
          id: d.id,
          name: d.name,
          address: d.address,
          durationText: el.duration_in_traffic.text,
          durationValueSec: liveSecs,
          distanceText: el.distance?.text || '',
          colorClass,
          isFallback: false
        };
      } else {
        const defaultMins = typeof d.defaultMins === 'number' ? d.defaultMins : 20;
        return {
          id: d.id,
          name: d.name,
          address: d.address,
          durationText: `${defaultMins} mins (est.)`,
          durationValueSec: defaultMins * 60,
          colorClass: 'text-gray-500',
          isFallback: true,
          fallbackReason: el?.status || 'Route not found'
        };
      }
    });

    const updatedUsage = recordUsage(destinations.length);
    const responsePayload = {
      items,
      isFallback: false,
      quotaExceeded: false,
      usage: updatedUsage,
      updatedAt: new Date().toISOString()
    };

    cache[cacheKey] = { data: responsePayload, timestamp: nowMs };
    return res.json(responsePayload);
  } catch (err: any) {
    console.warn("[Google Maps Traffic] Service unavailable:", err.message);
    return returnFallback("Unable to reach Google Maps service — showing commute estimates", false, 5 * 60 * 1000);
  }
});

// Calendar Next Event Endpoint
const DEFAULT_CALENDAR_URLS = [
  "https://calendar.google.com/calendar/ical/rickardjj%40gmail.com/public/basic.ics",
  "https://calendar.google.com/calendar/ical/family02040022973033118524%40group.calendar.google.com/public/basic.ics",
  "https://calendar.google.com/calendar/ical/family4049962446123629930%40group.calendar.google.com/public/basic.ics",
  "https://calendar.google.com/calendar/ical/garrickmj%40gmail.com/public/basic.ics",
  "https://calendar.google.com/calendar/ical/throgbottle%40gmail.com/public/basic.ics",
  "https://calendar.google.com/calendar/ical/cn0lk9hr870eqasroi1r44ks30%40group.calendar.google.com/public/basic.ics",
  "https://calendar.google.com/calendar/ical/mnd3hm2klvd0ugm4v8nakoucc%40group.calendar.google.com/public/basic.ics",
  "https://calendar.google.com/calendar/ical/dqb833b4o0bj6b441m0ivb5tev02bjp8%40import.calendar.google.com/public/basic.ics"
];

app.get("/api/calendar/next-event", async (req, res) => {
  const cacheKey = "next-calendar-event";
  const now = Date.now();

  try {
    const forceRefresh = req.query.refresh === "true";
    if (!forceRefresh && cache[cacheKey] && now - cache[cacheKey].timestamp < 60 * 1000) {
      return res.json(cache[cacheKey].data);
    }

    const configuredUrls = process.env.CALENDAR_ICAL_URLS 
      ? process.env.CALENDAR_ICAL_URLS.split(",").map(u => u.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : DEFAULT_CALENDAR_URLS;

    const fetchFeed = async (url: string) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // 8 second timeout for Google Calendar feeds
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return [];
        const text = await res.text();
        const parsed = nodeIcal.parseICS(text);
        const items: any[] = [];
        
        const nowObj = new Date(now - 15 * 60 * 1000); // allow events starting up to 15m ago
        const maxFuture = new Date(now + 60 * 24 * 60 * 60 * 1000);

        for (const k in parsed) {
          const item = parsed[k];
          if (item && item.type === "VEVENT") {
            const calName = typeof item.organizer === 'object' ? (item.organizer as any)?.params?.CN || "Google Calendar" : (item.organizer || "Google Calendar");

            // Handle recurring events (RRULE)
            if (item.rrule) {
              try {
                const occurrences = item.rrule.between(nowObj, maxFuture);
                const duration = item.end ? new Date(item.end).getTime() - new Date(item.start).getTime() : 3600000;
                for (const occDate of occurrences) {
                  items.push({
                    title: item.summary || "Scheduled Event",
                    location: item.location || "",
                    start: occDate.toISOString(),
                    end: new Date(occDate.getTime() + duration).toISOString(),
                    calendarName: calName,
                    description: item.description || ""
                  });
                }
              } catch (err) {
                // fallback if rrule calculation fails
              }
            } else if (item.start) {
              // Single non-recurring occurrence
              const startDate = new Date(item.start);
              if (startDate.getTime() >= now - 15 * 60 * 1000) {
                items.push({
                  title: item.summary || "Scheduled Event",
                  location: item.location || "",
                  start: startDate.toISOString(),
                  end: item.end ? new Date(item.end).toISOString() : undefined,
                  calendarName: calName,
                  description: item.description || ""
                });
              }
            }
          }
        }
        return items;
      } catch (e) {
        return [];
      }
    };

    const results = await Promise.all(configuredUrls.map(fetchFeed));
    let events = results.flat();

    // Sort strictly by start time ascending
    events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    let nextEvent = events[0] || null;

    if (nextEvent) {
      cache[cacheKey] = { data: nextEvent, timestamp: now };
      return res.json(nextEvent);
    } else {
      const emptyState = {
        title: "No upcoming events",
        location: "",
        start: null,
        end: null,
        calendarName: "",
        description: ""
      };
      // Don't cache empty state for long so it re-checks quickly if feeds were temporary unavailable
      cache[cacheKey] = { data: emptyState, timestamp: now - 50 * 1000 };
      return res.json(emptyState);
    }
  } catch (err) {
    console.error("Error in /api/calendar/next-event:", err);
    return res.json({
      title: "No upcoming events",
      location: "",
      start: null,
      end: null,
      calendarName: "",
      description: ""
    });
  }
});

// Daily Close Down Storage and Endpoints
// Persistent data dir (mounted volume in Docker); falls back to cwd for local/Pi use
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CLOSEDOWN_FILE = path.join(DATA_DIR, "closedown_store.json");
const CLOSEDOWN_CONFIG_FILE = path.join(DATA_DIR, "closedown_config.json");

const DEFAULT_CONFIG = {
  sonosRoutineEnabled: true,
  sonosVolume: 25,
  coinCost: 10,
  adults: [
    { id: "dad", name: "Dad", role: "adult", color: "blue" },
    { id: "mum", name: "Mum", role: "adult", color: "rose" }
  ],
  children: [
    { id: "el", name: "El", role: "child", color: "cyan" },
    { id: "alex", name: "Alex", role: "child", color: "amber" }
  ],
  tasks: [
    { id: "bags", name: "Bags packed for next day", category: "baggage" },
    { id: "clothes", name: "Clothes layed out", category: "clothes" },
    { id: "kitchen", name: "Kitchen cleared", category: "cleaning" },
    { id: "family_room", name: "Family room cleared", category: "cleaning" },
    { id: "bathroom", name: "Bathroom cleared", category: "cleaning" },
    { id: "alex_room", name: "Alex's Room cleared", category: "cleaning" },
    { id: "el_room", name: "Eleanor's room cleared", category: "cleaning" },
    { id: "parents_room", name: "Mum and Dad's room cleared", category: "cleaning" }
  ]
};

function readConfig() {
  try {
    if (fs.existsSync(CLOSEDOWN_CONFIG_FILE)) {
      const data = fs.readFileSync(CLOSEDOWN_CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading config file:", err);
  }
  return DEFAULT_CONFIG;
}

function writeConfig(cfg: any) {
  try {
    fs.writeFileSync(CLOSEDOWN_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing config file:", err);
  }
}

function getRandomItem<T>(arr: T[]): T {
  if (!arr || arr.length === 0) return "" as any;
  return arr[Math.floor(Math.random() * arr.length)];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getChildForRoomTask(task: any, children: any[]): any | null {
  if (!task || !children || children.length === 0) return null;
  const taskId = (task.id || "").toLowerCase();
  const taskName = (task.name || "").toLowerCase();

  for (const child of children) {
    const childId = (child.id || "").toLowerCase().trim();
    const childName = (child.name || "").toLowerCase().trim();
    const aliases = [childId, childName].filter(Boolean);
    // Special family alias for Eleanor / El
    if (childId === "el" || childName === "el") {
      aliases.push("eleanor");
    }
    if (childId === "eleanor" || childName === "eleanor") {
      aliases.push("el");
    }

    for (const alias of aliases) {
      if (!alias) continue;
      // 1. Exact or prefix ID match, e.g. "alex_room", "el_room", "alexroom", "elroom"
      if (
        taskId === `${alias}_room` ||
        taskId === `${alias}room` ||
        taskId.startsWith(`${alias}_room`) ||
        taskId.startsWith(`${alias}room`)
      ) {
        return child;
      }

      // 2. Name match (e.g. "Alex's Room cleared", "El's room cleared", "Eleanor's room", "Alex bedroom")
      const safeAlias = escapeRegex(alias);
      const namePattern = new RegExp(`\\b${safeAlias}('s)?\\s*(room|bedroom)\\b`, "i");
      if (namePattern.test(taskName)) {
        return child;
      }
    }
  }
  return null;
}

function balanceAssignments(tasks: any[], config = readConfig()) {
  const adultsList = (config.adults || []).map((a: any) => a.name).filter(Boolean);
  const childrenList = (config.children || []).map((c: any) => c.name).filter(Boolean);

  if (adultsList.length === 0) adultsList.push("Adult");
  if (childrenList.length === 0) childrenList.push("Child");

  // --- EVEN OUT ADULTS ---
  let adultCounts = adultsList.map((adult: string) => ({
    name: adult,
    count: tasks.filter((t) => t.assignedAdults && t.assignedAdults.includes(adult)).length,
  }));
  let maxAdult = adultCounts.reduce((max: any, a: any) => (a.count > max.count ? a : max), adultCounts[0]);
  let minAdult = adultCounts.reduce((min: any, a: any) => (a.count < min.count ? a : min), adultCounts[0]);

  while (maxAdult && minAdult && maxAdult.count - minAdult.count > 1) {
    const candidateTask = tasks.find(
      (t) =>
        t.assignedAdults &&
        t.assignedAdults.length === 1 &&
        t.assignedAdults.includes(maxAdult.name) &&
        t.id !== "parents_room"
    );
    if (!candidateTask) break;
    candidateTask.assignedAdults = [minAdult.name];

    adultCounts = adultsList.map((adult: string) => ({
      name: adult,
      count: tasks.filter((t) => t.assignedAdults && t.assignedAdults.includes(adult)).length,
    }));
    maxAdult = adultCounts.reduce((max: any, a: any) => (a.count > max.count ? a : max), adultCounts[0]);
    minAdult = adultCounts.reduce((min: any, a: any) => (a.count < min.count ? a : min), adultCounts[0]);
  }

  // --- EVEN OUT CHILDREN ---
  let childCounts = childrenList.map((child: string) => ({
    name: child,
    count: tasks.filter((t) => t.assignedChildren && t.assignedChildren.includes(child)).length,
  }));
  let maxChild = childCounts.reduce((max: any, c: any) => (c.count > max.count ? c : max), childCounts[0]);
  let minChild = childCounts.reduce((min: any, c: any) => (c.count < min.count ? c : min), childCounts[0]);

  while (maxChild && minChild && maxChild.count - minChild.count > 1) {
    // Candidate task must NOT be a child's own room
    const candidateTask = tasks.find(
      (t) =>
        t.assignedChildren &&
        t.assignedChildren.length === 1 &&
        t.assignedChildren.includes(maxChild.name) &&
        !getChildForRoomTask(t, config.children || [])
    );
    if (!candidateTask) break;
    candidateTask.assignedChildren = [minChild.name];

    childCounts = childrenList.map((child: string) => ({
      name: child,
      count: tasks.filter((t) => t.assignedChildren && t.assignedChildren.includes(child)).length,
    }));
    maxChild = childCounts.reduce((max: any, c: any) => (c.count > max.count ? c : max), childCounts[0]);
    minChild = childCounts.reduce((min: any, c: any) => (c.count < min.count ? c : min), childCounts[0]);
  }

  return tasks;
}

function generateTasksForDate() {
  const config = readConfig();
  const adultNames = (config.adults || []).map((a: any) => a.name).filter(Boolean);
  const childNames = (config.children || []).map((c: any) => c.name).filter(Boolean);

  const initialTasks = (config.tasks || DEFAULT_CONFIG.tasks).map((t: any) => {
    let assignedAdults: string[] = [];
    let assignedChildren: string[] = [];

    const matchedChild = getChildForRoomTask(t, config.children || []);

    if (t.id === "bags" || t.id === "clothes") {
      assignedAdults = [];
      assignedChildren = [];
    } else if (t.id === "parents_room") {
      assignedAdults = [...adultNames];
      assignedChildren = [];
    } else if (matchedChild) {
      if (adultNames.length > 0) assignedAdults = [getRandomItem(adultNames)];
      assignedChildren = [matchedChild.name];
    } else {
      if (adultNames.length > 0) assignedAdults = [getRandomItem(adultNames)];
      if (childNames.length > 0) assignedChildren = [getRandomItem(childNames)];
    }

    return {
      id: t.id,
      name: t.name,
      category: t.category || "cleaning",
      assignedAdults,
      assignedChildren,
      done: false
    };
  });

  return balanceAssignments(initialTasks, config);
}



function readStore(): Record<string, any> {
  try {
    if (fs.existsSync(CLOSEDOWN_FILE)) {
      const data = fs.readFileSync(CLOSEDOWN_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error reading closedown store:", error);
  }
  return {};
}

function writeStore(store: Record<string, any>) {
  try {
    fs.writeFileSync(CLOSEDOWN_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing closedown store:", error);
  }
}

// Helper to clear previous days' records when the daily closedown is active (at/after effective time or before 05:00)
function cleanOldStoreEntries(store: Record<string, any>, currentDate: string, currentHour: number) {
  const config = readConfig();
  const effectiveTime = store[currentDate]?.customTime || config.scheduledTime || "20:00";
  const [triggerHour] = effectiveTime.split(":").map(Number);
  const cutoffHour = !isNaN(triggerHour) ? triggerHour : 20;

  if (currentHour >= cutoffHour || currentHour < 5) {
    let changed = false;
    for (const key of Object.keys(store)) {
      if (key < currentDate) {
        delete store[key];
        changed = true;
      }
    }
    if (changed) {
      writeStore(store);
    }
  }
}

// Helper to sanitize task assignments:
// 1. Bags and Clothes have no assignments
// 2. Parents room is assigned to all adults and no children
// 3. Children are always matched to their own room
function sanitizeStoreTasks(store: Record<string, any>, date: string) {
  if (store[date] && store[date].tasks) {
    const config = readConfig();
    const adultNames = (config.adults || []).map((a: any) => a.name).filter(Boolean);
    let modified = false;

    store[date].tasks = store[date].tasks.map((task: any) => {
      if (task.id === "bags" || task.id === "clothes") {
        if (task.assignedAdults.length > 0 || task.assignedChildren.length > 0) {
          task.assignedAdults = [];
          task.assignedChildren = [];
          modified = true;
        }
      } else if (task.id === "parents_room") {
        if (task.assignedChildren.length > 0) {
          task.assignedChildren = [];
          modified = true;
        }
        if (adultNames.length > 0 && JSON.stringify(task.assignedAdults.slice().sort()) !== JSON.stringify(adultNames.slice().sort())) {
          task.assignedAdults = [...adultNames];
          modified = true;
        }
      } else {
        const matchedChild = getChildForRoomTask(task, config.children || []);
        if (matchedChild) {
          if (!task.assignedChildren || task.assignedChildren.length !== 1 || task.assignedChildren[0] !== matchedChild.name) {
            task.assignedChildren = [matchedChild.name];
            modified = true;
          }
        }
      }
      return task;
    });
    if (modified) {
      writeStore(store);
    }
  }
}

// Get tasks for a specific date (or generate if none exist)
app.get("/api/closedown", (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
  const clientHourStr = req.query.hour as string;
  const currentHour = clientHourStr !== undefined ? parseInt(clientHourStr, 10) : new Date().getHours();

  const store = readStore();
  cleanOldStoreEntries(store, date, currentHour);

  if (!store[date]) {
    store[date] = {
      date,
      tasks: generateTasksForDate(),
      silent: false
    };
    writeStore(store);
  } else {
    sanitizeStoreTasks(store, date);
    if (store[date].silent === undefined) {
      store[date].silent = false;
      writeStore(store);
    }
  }

  const config = readConfig();
  const effectiveTime = store[date].customTime || config.scheduledTime || "20:00";

  res.json({
    ...store[date],
    scheduledTime: config.scheduledTime || "20:00",
    todayCustomTime: store[date].customTime || null,
    effectiveTime
  });
});

// Toggle task status
app.post("/api/closedown/toggle", (req, res) => {
  const { date, taskId, done, hour } = req.body;
  if (!date || !taskId) {
    return res.status(400).json({ error: "Missing date or taskId in request body" });
  }

  const currentHour = hour !== undefined ? parseInt(hour, 10) : new Date().getHours();

  const store = readStore();
  cleanOldStoreEntries(store, date, currentHour);

  if (!store[date]) {
    store[date] = {
      date,
      tasks: generateTasksForDate()
    };
  } else {
    sanitizeStoreTasks(store, date);
  }

  const tasks = store[date].tasks;
  const task = tasks.find((t: any) => t.id === taskId);
  if (task) {
    task.done = !!done;
    task.updatedAt = new Date().toISOString();
    writeStore(store);
  }

  res.json(store[date]);
});

// Force reshuffle/regenerate assignments for a specific date
app.post("/api/closedown/reshuffle", (req, res) => {
  const { date, hour } = req.body;
  if (!date) {
    return res.status(400).json({ error: "Missing date in request body" });
  }

  const currentHour = hour !== undefined ? parseInt(hour, 10) : new Date().getHours();

  const store = readStore();
  cleanOldStoreEntries(store, date, currentHour);

  store[date] = {
    date,
    tasks: generateTasksForDate(),
    silent: store[date]?.silent || false
  };
  writeStore(store);

  res.json(store[date]);
});

// Toggle silent mode for Sonos automation
app.post("/api/closedown/silent", (req, res) => {
  const { date, silent, hour } = req.body;
  if (!date) {
    return res.status(400).json({ error: "Missing date in request body" });
  }

  const currentHour = hour !== undefined ? parseInt(hour, 10) : new Date().getHours();

  const store = readStore();
  cleanOldStoreEntries(store, date, currentHour);

  if (!store[date]) {
    store[date] = {
      date,
      tasks: generateTasksForDate(),
      silent: !!silent
    };
  } else {
    sanitizeStoreTasks(store, date);
    store[date].silent = !!silent;
  }
  writeStore(store);

  res.json(store[date]);
});

// Test trigger for Sonos automation
app.post("/api/closedown/test-trigger", async (req, res) => {
  try {
    const config = readConfig();
    if (config.sonosRoutineEnabled === false) {
      return res.status(400).json({ success: false, error: "Sonos routine is turned off in Settings." });
    }
    await runTrigger({ isManual: true });
    res.json({ success: true, message: "Sonos close-down playlist trigger run finished." });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to trigger Sonos" });
  }
});

// Test revert for Sonos automation
app.post("/api/closedown/test-revert", async (req, res) => {
  try {
    const config = readConfig();
    if (config.sonosRoutineEnabled === false) {
      return res.status(400).json({ success: false, error: "Sonos routine is turned off in Settings." });
    }
    await runRevert({ isManual: true });
    res.json({ success: true, message: "Sonos restore pre-cleardown state run finished." });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to revert Sonos" });
  }
});

// Live Bus Departures (Bee Network / TfGM)
app.get("/api/bus/departures", handleBusDeparturesRequest);
app.post("/api/bus/departures", handleBusDeparturesRequest);
app.get("/api/bus/config", handleBusConfigRequest);
app.post("/api/bus/config", handleBusConfigRequest);

// Close Down Config endpoints (custom tasks, adult/child names and colors, and scheduled time)
app.get("/api/closedown/config", (req, res) => {
  const config = readConfig();
  const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
  const store = readStore();
  const effectiveTime = store[date]?.customTime || config.scheduledTime || "20:00";
  res.json({
    ...config,
    sonosRoutineEnabled: config.sonosRoutineEnabled !== false,
    coinCost: typeof config.coinCost === "number" ? config.coinCost : 10,
    scheduledTime: config.scheduledTime || "20:00",
    todayCustomTime: store[date]?.customTime || null,
    effectiveTime
  });
});

app.post("/api/closedown/config", (req, res) => {
  const { adults, children, tasks, sonosVolume, coinCost, sonosRoutineEnabled, date, hour, scheduledTime, todayCustomTime } = req.body;
  const currentConfig = readConfig();

  const newConfig = {
    ...currentConfig,
    scheduledTime: typeof scheduledTime === "string" && scheduledTime.trim() ? scheduledTime.trim() : (currentConfig.scheduledTime || "20:00"),
    sonosRoutineEnabled: typeof sonosRoutineEnabled === "boolean" ? sonosRoutineEnabled : (currentConfig.sonosRoutineEnabled !== false),
    sonosVolume: typeof sonosVolume === "number" ? sonosVolume : (currentConfig.sonosVolume ?? 25),
    coinCost: typeof coinCost === "number" ? coinCost : (currentConfig.coinCost ?? 10),
    adults: Array.isArray(adults) ? adults : currentConfig.adults,
    children: Array.isArray(children) ? children : currentConfig.children,
    tasks: Array.isArray(tasks) ? tasks : currentConfig.tasks
  };

  writeConfig(newConfig);

  // Update today's task store if present
  const currentDate = date || new Date().toISOString().split("T")[0];
  const currentHour = hour !== undefined ? parseInt(hour, 10) : new Date().getHours();
  const store = readStore();

  if (!store[currentDate]) {
    store[currentDate] = {
      date: currentDate,
      tasks: generateTasksForDate(),
      silent: false
    };
  }

  if (todayCustomTime !== undefined) {
    if (todayCustomTime === null || todayCustomTime === "") {
      delete store[currentDate].customTime;
    } else {
      store[currentDate].customTime = todayCustomTime;
    }
  }

  if (store[currentDate] && Array.isArray(store[currentDate].tasks)) {
    const existingTasksMap = new Map(store[currentDate].tasks.map((t: any) => [t.id, t]));
    const adultNames = newConfig.adults.map((a: any) => a.name).filter(Boolean);
    const childNames = newConfig.children.map((c: any) => c.name).filter(Boolean);

    const updatedTasks = newConfig.tasks.map((t: any) => {
      const existing = existingTasksMap.get(t.id) as any;
      const matchedChild = getChildForRoomTask(t, newConfig.children || []);

      if (t.id === "bags" || t.id === "clothes") {
        return {
          id: t.id,
          name: t.name,
          category: t.category || "baggage",
          assignedAdults: [],
          assignedChildren: [],
          done: existing?.done ?? false
        };
      } else if (t.id === "parents_room") {
        return {
          id: t.id,
          name: t.name,
          category: t.category || "cleaning",
          assignedAdults: [...adultNames],
          assignedChildren: [],
          done: existing?.done ?? false
        };
      } else if (matchedChild) {
        return {
          id: t.id,
          name: t.name,
          category: t.category || "cleaning",
          assignedAdults: existing?.assignedAdults?.length ? existing.assignedAdults : (adultNames.length > 0 ? [getRandomItem(adultNames)] : []),
          assignedChildren: [matchedChild.name],
          done: existing?.done ?? false
        };
      } else if (existing) {
        return {
          ...existing,
          name: t.name,
          category: t.category || existing.category
        };
      } else {
        return {
          id: t.id,
          name: t.name,
          category: t.category || "cleaning",
          assignedAdults: adultNames.length > 0 ? [getRandomItem(adultNames)] : [],
          assignedChildren: childNames.length > 0 ? [getRandomItem(childNames)] : [],
          done: false
        };
      }
    });

    store[currentDate].tasks = balanceAssignments(updatedTasks, newConfig);
  }

  writeStore(store);
  rescheduleSonosRule();

  const effectiveTime = store[currentDate]?.customTime || newConfig.scheduledTime || "20:00";
  res.json({
    config: newConfig,
    dateTasks: store[currentDate]?.tasks,
    todayCustomTime: store[currentDate]?.customTime || null,
    effectiveTime
  });
});

// Dedicated time endpoint to change today's override or overall scheduled time
app.post("/api/closedown/time", (req, res) => {
  const { date, scheduledTime, todayCustomTime } = req.body;
  const currentDate = date || new Date().toISOString().split("T")[0];
  const config = readConfig();

  if (scheduledTime && typeof scheduledTime === "string" && scheduledTime.trim()) {
    config.scheduledTime = scheduledTime.trim();
    writeConfig(config);
  }

  const store = readStore();
  if (!store[currentDate]) {
    store[currentDate] = {
      date: currentDate,
      tasks: generateTasksForDate(),
      silent: false
    };
  }

  if (todayCustomTime !== undefined) {
    if (todayCustomTime === null || todayCustomTime === "") {
      delete store[currentDate].customTime;
    } else {
      store[currentDate].customTime = todayCustomTime;
    }
  }

  writeStore(store);
  rescheduleSonosRule();

  const effectiveTime = store[currentDate]?.customTime || config.scheduledTime || "20:00";
  res.json({
    scheduledTime: config.scheduledTime || "20:00",
    todayCustomTime: store[currentDate]?.customTime || null,
    effectiveTime,
    tasks: store[currentDate]?.tasks
  });
});


// Alerts store endpoint
app.get("/api/alerts", (req, res) => {
  res.json(getAllAlerts());
});

app.get("/api/alerts/solar-forecast", async (req, res) => {
  const alert = getAlert("solar-forecast");
  if (alert) {
    return res.json(alert);
  }
  try {
    const result = await evaluateSolarForecastRule();
    const alertData = {
      type: "solar-forecast",
      chargeOvernight: result.chargeOvernight,
      forecastKwh: result.forecastKwh,
      thresholdKwh: 8.2,
      currentBatteryPct: result.currentBatteryPct,
      batteryHeadroomKwh: result.batteryHeadroomKwh,
      reason: result.reason,
      computedAt: result.computedAt,
    };
    setAlert("solar-forecast", alertData, 6 * 60 * 60 * 1000);
    return res.json(alertData);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to evaluate solar forecast" });
  }
});

// Swear Jar Storage and Endpoints
const SWEARJAR_FILE = path.join(process.cwd(), "swearjar_store.json");

function readSwearJar() {
  try {
    if (fs.existsSync(SWEARJAR_FILE)) {
      return JSON.parse(fs.readFileSync(SWEARJAR_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading swear jar store:", err);
  }
  return { balances: {}, history: [] };
}

function writeSwearJar(data: any) {
  try {
    fs.writeFileSync(SWEARJAR_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing swear jar store:", err);
  }
}

app.get("/api/swearjar", (req, res) => {
  res.json(readSwearJar());
});

app.post("/api/swearjar/add", (req, res) => {
  const { memberId, amount } = req.body;
  const config = readConfig();
  const inc = typeof amount === "number" ? amount : (config.coinCost || 10);
  const jar = readSwearJar();
  if (!jar.balances) jar.balances = {};
  jar.balances[memberId] = (jar.balances[memberId] || 0) + inc;
  if (!jar.history) jar.history = [];
  jar.history.unshift({
    memberId,
    amount: inc,
    timestamp: new Date().toISOString()
  });
  if (jar.history.length > 50) jar.history = jar.history.slice(0, 50);
  writeSwearJar(jar);
  res.json({ success: true, balances: jar.balances });
});

app.post("/api/swearjar/reset", (req, res) => {
  const { memberId } = req.body;
  const jar = readSwearJar();
  if (memberId) {
    if (jar.balances) jar.balances[memberId] = 0;
  } else {
    jar.balances = {};
    jar.history = [];
  }
  writeSwearJar(jar);
  res.json({ success: true, balances: jar.balances });
});

async function startServer() {
  // Vite middleware setup for local development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Start the Sonos cleardown automation rule
    startSonosCleardownRule();
    // Start the Solar Forecast & Overnight Charging automation rule
    startSolarForecastRule();
  });
}

startServer();
