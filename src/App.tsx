import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { 
  Clock, 
  Calendar as CalendarIcon, 
  Activity, 
  RefreshCw, 
  Navigation, 
  Maximize2, 
  Minimize2,
  Tv,
  Settings,
  Settings2,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  Sun,
  BatteryCharging,
  CloudRain,
  Battery,
  AlertTriangle,
  AlertCircle,
  Lightbulb,
  Home,
  Plus,
  Trash2,
  Users,
  ListChecks,
  MapPin,
  Check,
  Music,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Bus,
  Train,
  Sparkles,
  Coins
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import WeatherPanel from './components/WeatherPanel';
import TrafficPanel from './components/TrafficPanel';
import NextEventTile from './components/NextEventTile';
import { BusStopPanel } from './components/BusStopPanel';
import { WeatherData, SystemStatus, CommuteDestination, FamilyMember, TaskConfig, BusStopConfig } from './types';
import HomePowerFlow from './components/HomePowerFlow';
import HomeDashboard from './components/HomeDashboard';

const MEMBER_COLOR_OPTIONS = [
  { id: 'blue', name: 'Blue', colorClass: 'bg-blue-600 text-white' },
  { id: 'rose', name: 'Rose', colorClass: 'bg-rose-500 text-white' },
  { id: 'emerald', name: 'Emerald', colorClass: 'bg-emerald-600 text-white' },
  { id: 'amber', name: 'Amber', colorClass: 'bg-amber-500 text-white' },
  { id: 'purple', name: 'Purple', colorClass: 'bg-purple-600 text-white' },
  { id: 'cyan', name: 'Cyan', colorClass: 'bg-cyan-500 text-white' },
  { id: 'orange', name: 'Orange', colorClass: 'bg-orange-500 text-white' },
  { id: 'fuchsia', name: 'Fuchsia', colorClass: 'bg-fuchsia-500 text-white' },
];


// Google Maps API Key Setup
const API_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY || '';

// WMO code weather mapping
const WMO_CODES: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Foggy with Rime',
  51: 'Light Drizzle',
  53: 'Moderate Drizzle',
  55: 'Dense Drizzle',
  61: 'Slight Rain',
  63: 'Moderate Rain',
  65: 'Heavy Rain',
  71: 'Slight Snowfall',
  73: 'Moderate Snowfall',
  75: 'Heavy Snowfall',
  77: 'Snow Grains',
  80: 'Slight Rain Showers',
  81: 'Moderate Rain Showers',
  82: 'Violent Rain Showers',
  85: 'Slight Snow Showers',
  86: 'Heavy Snow Showers',
  95: 'Thunderstorm',
  96: 'Slight Hail Thunderstorm',
  99: 'Heavy Hail Thunderstorm',
};

// Weather Helpers
const findMaxIdx = (arr: number[]) => {
  if (arr.length === 0) return 0;
  let max = arr[0];
  let idx = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > max) {
      max = arr[i];
      idx = i;
    }
  }
  return idx;
};

const getWHOUVMetadata = (uv: number) => {
  if (uv < 3) return { desc: 'Low', colorClass: 'text-[#4ade80]' };
  if (uv < 6) return { desc: 'Moderate', colorClass: 'text-[#fbbf24]' };
  if (uv < 8) return { desc: 'High', colorClass: 'text-[#f97316]' };
  if (uv < 11) return { desc: 'Very High', colorClass: 'text-[#f87171]' };
  return { desc: 'Extreme', colorClass: 'text-[#a855f7]' };
};

const getBeaufort = (mph: number): string => {
  if (mph < 1) return 'Calm';
  if (mph <= 3) return 'Light Air';
  if (mph <= 7) return 'Light Breeze';
  if (mph <= 12) return 'Gentle Breeze';
  if (mph <= 18) return 'Moderate Breeze';
  if (mph <= 24) return 'Fresh Breeze';
  if (mph <= 31) return 'Strong Breeze';
  if (mph <= 38) return 'Near Gale';
  if (mph <= 46) return 'Gale';
  if (mph <= 54) return 'Strong Gale';
  if (mph <= 63) return 'Storm';
  return 'Violent Storm';
};

const getWMORainDesc = (mm: number): string => {
  if (mm <= 0) return 'Dry';
  if (mm < 0.5) return 'Trace';
  if (mm < 2.5) return 'Slight Rain';
  if (mm < 10.0) return 'Moderate Rain';
  if (mm < 50.0) return 'Heavy Rain';
  return 'Violent Rain';
};

const DEFAULT_ORIGIN = '250 Stand Lane, Radcliffe, Manchester, M26 1JP';
const DEFAULT_DESTINATIONS: CommuteDestination[] = [
  { id: 'time-work', name: 'Work (Stockport)', address: 'Ashurst Drive, Stockport', defaultMins: 34 },
  { id: 'time-chethams', name: "Chetham's School", address: 'Long Millgate, Manchester', defaultMins: 22 },
  { id: 'time-moorbank', name: 'Moorbank', address: 'BL9 6UT', defaultMins: 16 },
  { id: 'time-bury', name: 'Bury', address: 'Bury Music Service. 99 The Rock. Bury. BL9 0NB', defaultMins: 12 }
];

export default function App() {
  const [activeView, setActiveView] = useState<'live' | 'agenda' | 'home'>('live');
  const [calendarMode, setCalendarMode] = useState<'AGENDA' | 'WEEK'>('AGENDA');
  const [clockString, setClockString] = useState<string>('--:--:--');
  const [dateString, setDateString] = useState<string>('');
  
  // Commute locations and settings state
  const [homeLocation, setHomeLocation] = useState<string>(() => {
    return localStorage.getItem('dashboard_home_location') || localStorage.getItem('evohome_home_location') || DEFAULT_ORIGIN;
  });

  const [destinations, setDestinations] = useState<CommuteDestination[]>(() => {
    const saved = localStorage.getItem('dashboard_destinations') || localStorage.getItem('evohome_destinations');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse destinations', e);
      }
    }
    return DEFAULT_DESTINATIONS;
  });

  const [locationsCount, setLocationsCount] = useState<number>(() => {
    const saved = localStorage.getItem('dashboard_locations_count');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) return parsed;
    }
    return 4;
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Form states for settings
  const [activeSettingsTab, setActiveSettingsTab] = useState<'traffic' | 'bus' | 'tasks' | 'family' | 'sonos'>('traffic');
  const [formHomeLocation, setFormHomeLocation] = useState<string>('');
  const [formDestinations, setFormDestinations] = useState<CommuteDestination[]>([]);
  const [formLocationsCount, setFormLocationsCount] = useState<number>(4);
  const [formManualBypass, setFormManualBypass] = useState<boolean>(false);
  const [formTasks, setFormTasks] = useState<TaskConfig[]>([]);
  const [formAdults, setFormAdults] = useState<FamilyMember[]>([]);
  const [formChildren, setFormChildren] = useState<FamilyMember[]>([]);
  const [formSonosVolume, setFormSonosVolume] = useState<number>(25);
  const [formSonosRoutineEnabled, setFormSonosRoutineEnabled] = useState<boolean>(true);
  const [formCoinCost, setFormCoinCost] = useState<number>(10);
  const [formScheduledTime, setFormScheduledTime] = useState<string>('20:00');
  const [formTodayCustomTime, setFormTodayCustomTime] = useState<string>('20:00');
  const [formUseTodayOverride, setFormUseTodayOverride] = useState<boolean>(false);
  const [formBusStops, setFormBusStops] = useState<BusStopConfig[]>([]);
  const [configuredBusStops, setConfiguredBusStops] = useState<BusStopConfig[]>([]);
  const [sonosTesting, setSonosTesting] = useState<boolean>(false);
  const [sonosStatusMsg, setSonosStatusMsg] = useState<string | null>(null);

  const formEffectiveTime = formUseTodayOverride ? (formTodayCustomTime || formScheduledTime) : formScheduledTime;

  const formRevertTime = useMemo(() => {
    const [h, m] = (formEffectiveTime || '20:00').split(':').map(Number);
    const total = (isNaN(h) ? 20 : h) * 60 + (isNaN(m) ? 0 : m) + 15;
    const rh = Math.floor(total / 60) % 24;
    const rm = total % 60;
    return `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
  }, [formEffectiveTime]);

  // Initial load of bus stops config
  useEffect(() => {
    fetch('/api/bus/config')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.stops)) {
          setConfiguredBusStops(data.stops);
        }
      })
      .catch(err => console.warn('Failed to load initial bus stops config', err));
  }, []);

  // When settings modal opens, initialize form state
  const handleOpenSettings = async () => {
    setFormHomeLocation(homeLocation);
    setFormDestinations(JSON.parse(JSON.stringify(destinations)));
    setFormManualBypass(isManualBypass);
    setFormLocationsCount(locationsCount);
    setActiveSettingsTab('traffic');
    setSonosStatusMsg(null);

    try {
      const res = await fetch('/api/closedown/config');
      if (res.ok) {
        const config = await res.json();
        setFormAdults(config.adults || []);
        setFormChildren(config.children || []);
        setFormTasks(config.tasks || []);
        setFormSonosVolume(typeof config.sonosVolume === 'number' ? config.sonosVolume : 25);
        setFormSonosRoutineEnabled(config.sonosRoutineEnabled !== false);
        setFormCoinCost(typeof config.coinCost === 'number' ? config.coinCost : 10);
        const sched = config.scheduledTime || '20:00';
        setFormScheduledTime(sched);
        if (config.todayCustomTime) {
          setFormTodayCustomTime(config.todayCustomTime);
          setFormUseTodayOverride(true);
        } else {
          setFormTodayCustomTime(sched);
          setFormUseTodayOverride(false);
        }
      }
    } catch (e) {
      console.error('Failed to fetch closedown config for settings', e);
    }

    try {
      const busRes = await fetch('/api/bus/config');
      if (busRes.ok) {
        const busData = await busRes.json();
        const stopsList = busData.stops || [];
        setFormBusStops(stopsList);
        setConfiguredBusStops(stopsList);
      }
    } catch (e) {
      console.error('Failed to fetch bus config for settings', e);
    }

    setIsSettingsOpen(true);
  };

  const handleSaveSettings = async () => {
    localStorage.setItem('dashboard_home_location', formHomeLocation);
    localStorage.setItem('dashboard_destinations', JSON.stringify(formDestinations));
    localStorage.setItem('dashboard_maps_bypass', formManualBypass ? 'true' : 'false');
    localStorage.setItem('dashboard_locations_count', formLocationsCount.toString());

    setHomeLocation(formHomeLocation);
    setDestinations(formDestinations);
    setIsManualBypass(formManualBypass);
    setLocationsCount(formLocationsCount);

    try {
      await fetch('/api/closedown/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adults: formAdults,
          children: formChildren,
          tasks: formTasks,
          sonosVolume: formSonosVolume,
          sonosRoutineEnabled: formSonosRoutineEnabled,
          coinCost: Number(formCoinCost) || 10,
          scheduledTime: formScheduledTime || '20:00',
          todayCustomTime: formUseTodayOverride ? formTodayCustomTime : null
        })
      });
    } catch (e) {
      console.error('Failed to save closedown config', e);
    }

    try {
      await fetch('/api/bus/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops: formBusStops })
      });
      setConfiguredBusStops(formBusStops);
      setBusRefreshCounter(prev => prev + 1);
    } catch (e) {
      console.error('Failed to save bus config', e);
    }

    setIsSettingsOpen(false);
    setTrafficRefreshCounter(prev => prev + 1);
  };

  const handleTestTrigger = async () => {
    if (!formSonosRoutineEnabled) {
      setSonosStatusMsg("Cannot test: Sonos routine is currently turned off.");
      setTimeout(() => setSonosStatusMsg(null), 5000);
      return;
    }

    try {
      setSonosTesting(true);
      setSonosStatusMsg("Testing Sonos Trigger (Snapshot, volume & play)...");

      // Save current config first so test uses chosen volume, enabled state, and timing
      await fetch('/api/closedown/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adults: formAdults,
          children: formChildren,
          tasks: formTasks,
          sonosVolume: formSonosVolume,
          sonosRoutineEnabled: formSonosRoutineEnabled,
          coinCost: Number(formCoinCost) || 10,
          scheduledTime: formScheduledTime || '20:00',
          todayCustomTime: formUseTodayOverride ? formTodayCustomTime : null
        })
      });

      const res = await fetch('/api/closedown/test-trigger', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setSonosStatusMsg(`Success: ${formEffectiveTime} Sonos Close-down triggered successfully!`);
      } else {
        setSonosStatusMsg(`Error: ${data.error || "Failed to trigger"}`);
      }
    } catch (err: any) {
      setSonosStatusMsg(`Error: ${err.message || "Failed to trigger"}`);
    } finally {
      setSonosTesting(false);
      setTimeout(() => setSonosStatusMsg(null), 8000);
    }
  };

  const handleTestRevert = async () => {
    if (!formSonosRoutineEnabled) {
      setSonosStatusMsg("Cannot test: Sonos routine is currently turned off.");
      setTimeout(() => setSonosStatusMsg(null), 5000);
      return;
    }

    try {
      setSonosTesting(true);
      setSonosStatusMsg("Testing Sonos Revert (Restore state)...");
      const res = await fetch('/api/closedown/test-revert', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setSonosStatusMsg(`Success: ${formRevertTime} Sonos Reverted state successfully!`);
      } else {
        setSonosStatusMsg(`Error: ${data.error || "Failed to revert"}`);
      }
    } catch (err: any) {
      setSonosStatusMsg(`Error: ${err.message || "Failed to revert"}`);
    } finally {
      setSonosTesting(false);
      setTimeout(() => setSonosStatusMsg(null), 8000);
    }
  };

  const handleResetDefaults = () => {
    setFormHomeLocation(DEFAULT_ORIGIN);
    setFormDestinations(JSON.parse(JSON.stringify(DEFAULT_DESTINATIONS)));
    setFormManualBypass(false);
    setFormLocationsCount(4);
    setFormSonosVolume(25);
    setFormSonosRoutineEnabled(true);
    setFormAdults([
      { id: "dad", name: "Dad", role: "adult", color: "blue" },
      { id: "mum", name: "Mum", role: "adult", color: "rose" }
    ]);
    setFormChildren([
      { id: "el", name: "El", role: "child", color: "cyan" },
      { id: "alex", name: "Alex", role: "child", color: "amber" }
    ]);
    setFormTasks([
      { id: "bags", name: "Bags packed for next day", category: "baggage" },
      { id: "clothes", name: "Clothes layed out", category: "clothes" },
      { id: "kitchen", name: "Kitchen cleared", category: "cleaning" },
      { id: "family_room", name: "Family room cleared", category: "cleaning" },
      { id: "bathroom", name: "Bathroom cleared", category: "cleaning" },
      { id: "alex_room", name: "Alex's Room cleared", category: "cleaning" },
      { id: "el_room", name: "Eleanor's room cleared", category: "cleaning" },
      { id: "parents_room", name: "Mum and Dad's room cleared", category: "cleaning" }
    ]);
  };
  
  // Weather & traffic hooks
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [isWeatherLoading, setIsWeatherLoading] = useState<boolean>(true);
  const [trafficRefreshCounter, setTrafficRefreshCounter] = useState<number>(0);
  const [isManualBypass, setIsManualBypass] = useState<boolean>(() => {
    return localStorage.getItem('dashboard_maps_bypass') === 'true';
  });
  const [tempBypassExpiry, setTempBypassExpiry] = useState<number>(() => {
    const saved = localStorage.getItem('traffic_bypass_until');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed > Date.now()) {
        return parsed;
      }
    }
    return 0;
  });
  const tempBypassExpiryRef = useRef<number>(tempBypassExpiry);
  useEffect(() => {
    tempBypassExpiryRef.current = tempBypassExpiry;
  }, [tempBypassExpiry]);

  // Collapsible sections state
  // After 0930, collapse traffic and commutes, and expand weather and overnight charging optimiser divisions.
  const [nextEventTitle, setNextEventTitle] = useState<string>("Next Event");
  const [nextEventCountdown, setNextEventCountdown] = useState<string>("");
  const handleEventLoaded = useCallback((evt: any, countdown?: string) => {
    if (evt?.title) {
      setNextEventTitle(prev => prev !== evt.title ? evt.title : prev);
    } else if (evt === null) {
      setNextEventTitle("No Upcoming Events");
    }
    if (countdown !== undefined) {
      setNextEventCountdown(prev => prev !== countdown ? countdown : prev);
    }
  }, []);
  const [isMetrolinkExpanded, setIsMetrolinkExpanded] = useState<boolean>(true);
  const [isBusExpanded, setIsBusExpanded] = useState<boolean>(false);
  const [busRefreshCounter, setBusRefreshCounter] = useState<number>(0);

  const handleToggleMetrolink = () => {
    setIsMetrolinkExpanded(prev => {
      const willOpen = !prev;
      if (willOpen) {
        setIsBusExpanded(false);
      }
      return willOpen;
    });
  };

  const handleToggleBus = () => {
    setIsBusExpanded(prev => {
      const willOpen = !prev;
      if (willOpen) {
        setIsMetrolinkExpanded(false);
      }
      return willOpen;
    });
  };
  const [isNextEventExpanded, setIsNextEventExpanded] = useState<boolean>(true);
  const [isTrafficExpanded, setIsTrafficExpanded] = useState<boolean>(() => {
    const now = new Date();
    const timeVal = now.getHours() * 100 + now.getMinutes();
    return timeVal < 930;
  });
  const [isWeatherExpanded, setIsWeatherExpanded] = useState<boolean>(true);
  const [isOptimizerExpanded, setIsOptimizerExpanded] = useState<boolean>(() => {
    const now = new Date();
    const timeVal = now.getHours() * 100 + now.getMinutes();
    return timeVal >= 930;
  });
  const [hasTriggeredAfter930, setHasTriggeredAfter930] = useState<boolean>(() => {
    const today = new Date().toISOString().split('T')[0];
    return localStorage.getItem(`layout_930_triggered_${today}`) === 'true';
  });

  // SolarEdge state for smaller status components in Optimizer
  const [powerData, setPowerData] = useState<any>(null);
  const [loadingPower, setLoadingPower] = useState<boolean>(true);
  const [powerError, setPowerError] = useState<string | null>(null);

  // Solar Forecast Alert state (from solarForecastRule)
  const [solarForecastAlert, setSolarForecastAlert] = useState<any>(null);

  const fetchSolarForecastAlert = async () => {
    try {
      const res = await fetch("/api/alerts/solar-forecast");
      if (res.ok) {
        const json = await res.json();
        setSolarForecastAlert(json);
      }
    } catch (err: any) {
      // Clean fallback if network connection drops
    }
  };

  useEffect(() => {
    fetchSolarForecastAlert();
    const interval = setInterval(fetchSolarForecastAlert, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchPowerFlow = async () => {
    try {
      setLoadingPower(true);
      const res = await fetch("/api/solaredge/powerflow");
      if (res.ok) {
        const json = await res.json();
        if (json && json.siteCurrentPowerFlow) {
          setPowerData(json.siteCurrentPowerFlow);
          setPowerError(null);
        }
      }
    } catch (err: any) {
      // Clean fallback if network connection drops
    } finally {
      setLoadingPower(false);
    }
  };
  
  // Status hooks
  const [lastTrafficUpdated, setLastTrafficUpdated] = useState<string>('--:--');
  const [systemMode, setSystemMode] = useState<'Peak (Fast Refresh)' | 'Standard'>('Standard');
  const [isPeak, setIsPeak] = useState<boolean>(false);
  const [isTramFullscreen, setIsTramFullscreen] = useState<boolean>(false);
  const tramIframeRef = useRef<HTMLIFrameElement>(null);

  // Core hours constants for Google Maps Distance Matrix gating (06:30 - 09:30)
  const MAPS_CORE_HOURS_START = 630; // 06:30
  const MAPS_CORE_HOURS_END = 930;   // 09:30

  // Scheduled refresh timers (using refs to survive state changes)
  const weatherTimerRef = useRef<NodeJS.Timeout | null>(null);
  const trafficTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tramTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to check if now is within Maps core hours on weekdays
  const isWithinMapsCoreHours = (now: Date) => {
    const hour = now.getHours();
    const min = now.getMinutes();
    const timeVal = hour * 100 + min;
    const isWeekday = now.getDay() > 0 && now.getDay() < 6;
    return isWeekday && (timeVal >= MAPS_CORE_HOURS_START && timeVal <= MAPS_CORE_HOURS_END);
  };

  const isLiveAllowed = isWithinMapsCoreHours(new Date()) || isManualBypass || (tempBypassExpiry > Date.now());

  // Stable destinations slice and update callback for TrafficPanel to avoid 1s re-renders
  const activeDestinations = useMemo(() => {
    return destinations.slice(0, locationsCount);
  }, [destinations, locationsCount]);

  const handleTrafficUpdated = useCallback((timeStr: string) => {
    setLastTrafficUpdated(prev => prev !== timeStr ? timeStr : prev);
  }, []);

  // 1. Realtime clock ticking (updated every second)
  useEffect(() => {
    const clockInterval = setInterval(() => {
      const now = new Date();
      setClockString(now.toLocaleTimeString([], { hour12: false }));
      setDateString(
        now.toLocaleDateString([], { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        })
      );

      const hour = now.getHours();
      const min = now.getMinutes();
      const timeVal = hour * 100 + min;
      const today = now.toISOString().split('T')[0];

      // After 0930, collapse traffic and commutes, and expand weather and overnight charging optimiser divisions
      if (timeVal >= 930 && !hasTriggeredAfter930) {
        setIsTrafficExpanded(false);
        setIsWeatherExpanded(true);
        setIsOptimizerExpanded(true);
        setHasTriggeredAfter930(true);
        localStorage.setItem(`layout_930_triggered_${today}`, 'true');
      }

      // Check if temporary bypass expired to trigger state update
      const saved = localStorage.getItem('traffic_bypass_until');
      if (saved) {
        const expiry = parseInt(saved, 10);
        if (!isNaN(expiry)) {
          if (Date.now() >= expiry) {
            localStorage.removeItem('traffic_bypass_until');
            setTempBypassExpiry(0);
            setTrafficRefreshCounter(prev => prev + 1); // trigger refresh to go back to fallback/estimates
            setIsTrafficExpanded(false); // Automatically collapse traffic and commutes once the timer has expired
          } else {
            // Keep state updated so UI countdown updates nicely without triggering unnecessary re-renders
            setTempBypassExpiry(prev => prev !== expiry ? expiry : prev);
          }
        }
      } else if (tempBypassExpiryRef.current > 0) {
        setTempBypassExpiry(0);
        setIsTrafficExpanded(false); // Automatically collapse traffic and commutes once the timer has expired
      }
    }, 1000);

    return () => clearInterval(clockInterval);
  }, [hasTriggeredAfter930]);

  // Trigger the 5min live bypass should the traffic and commutes division be expanded outside core hours
  useEffect(() => {
    if (isTrafficExpanded) {
      const now = new Date();
      if (!isWithinMapsCoreHours(now)) {
        const expiry = Date.now() + 5 * 60 * 1000;
        localStorage.setItem('traffic_bypass_until', expiry.toString());
        setTempBypassExpiry(expiry);
        setTrafficRefreshCounter(prev => prev + 1);
      }
    }
  }, [isTrafficExpanded]);

  // 2. Scheduled Weather / Peak hours controller
  const getApiUpdateInterval = (now: Date) => {
    const hour = now.getHours();
    const min = now.getMinutes();
    const timeVal = hour * 100 + min;
    
    // Peak Mode: 06:30 - 09:00, Monday to Friday (1-5)
    const peakCheck = (timeVal >= 630 && timeVal <= 900) && (now.getDay() > 0 && now.getDay() < 6);
    setIsPeak(peakCheck);
    setSystemMode(peakCheck ? 'Peak (Fast Refresh)' : 'Standard');
    
    // Return ms: Peak = 5 minutes (300,000 ms), Standard = 15 minutes (900,000 ms)
    return peakCheck ? 300000 : 900000;
  };

  const executeWeatherUpdate = async () => {
    await updateWeatherStats();
  };

  const executeTrafficUpdate = (isManual: boolean = false) => {
    const now = new Date();
    const inCoreHours = isWithinMapsCoreHours(now);
    const isBypassed = tempBypassExpiryRef.current > Date.now();
    
    if (inCoreHours || isManual || isBypassed) {
      setTrafficRefreshCounter((prev) => prev + 1);
    } else {
      console.log("Traffic update gated (outside core hours)");
    }
  };

  const executeTramUpdates = () => {
    if (tramIframeRef.current) {
      tramIframeRef.current.src = "https://mltracker.co.uk/index.html#Whitefield";
    }
  };

  // Main scheduler cycle for Weather (always polls on peak/standard cadence)
  const scheduleNextWeatherUpdate = () => {
    if (weatherTimerRef.current) clearTimeout(weatherTimerRef.current);

    const intervalMs = getApiUpdateInterval(new Date());
    
    weatherTimerRef.current = setTimeout(async () => {
      await executeWeatherUpdate();
      scheduleNextWeatherUpdate();
    }, intervalMs);
  };

  // Main scheduler cycle for Traffic (gated window scheduler)
  const scheduleNextTrafficUpdate = () => {
    if (trafficTimerRef.current) clearTimeout(trafficTimerRef.current);

    const now = new Date();
    const inCoreHours = isWithinMapsCoreHours(now);
    
    let intervalMs: number;
    if (inCoreHours) {
      const hour = now.getHours();
      const min = now.getMinutes();
      const timeVal = hour * 100 + min;
      const isPeakActive = (timeVal >= 630 && timeVal <= 900) && (now.getDay() > 0 && now.getDay() < 6);
      intervalMs = isPeakActive ? 300000 : 900000;
    } else {
      // Quietly re-check the clock every 5 minutes at zero API cost
      intervalMs = 300000;
    }

    trafficTimerRef.current = setTimeout(() => {
      executeTrafficUpdate(false);
      scheduleNextTrafficUpdate();
    }, intervalMs);
  };

  // Main scheduler cycle for Metrolink Tracker (constant 30s refresh throughout the day)
  const scheduleNextTramUpdate = () => {
    if (tramTimerRef.current) clearTimeout(tramTimerRef.current);

    tramTimerRef.current = setTimeout(() => {
      executeTramUpdates();
      scheduleNextTramUpdate();
    }, 30000);
  };

  // Initial trigger & timer hook setup
  useEffect(() => {
    executeWeatherUpdate();
    executeTrafficUpdate(false);
    executeTramUpdates();
    fetchPowerFlow();

    scheduleNextWeatherUpdate();
    scheduleNextTrafficUpdate();
    scheduleNextTramUpdate();

    const powerInterval = setInterval(fetchPowerFlow, 300000); // 5 min interval

    return () => {
      if (weatherTimerRef.current) clearTimeout(weatherTimerRef.current);
      if (trafficTimerRef.current) clearTimeout(trafficTimerRef.current);
      if (tramTimerRef.current) clearTimeout(tramTimerRef.current);
      clearInterval(powerInterval);
    };
  }, []);

  // Weather fetch details callback
  const updateWeatherStats = async () => {
    try {
      setIsWeatherLoading(true);
      const res = await fetch("/api/weather");
      const data = await res.json();

      if (data && data.hourly && data.current_weather) {
        // Temperature profiles
        const tempIdx = findMaxIdx(data.hourly.temperature_2m.slice(0, 24));
        const maxTemp = Math.round(data.hourly.temperature_2m[tempIdx] || 18);
        const currentTemp = Math.round(data.current_weather.temperature || 16);
        const condition = WMO_CODES[data.current_weather.weathercode] || 'Variable';
        const rawTempTime = data.hourly.time[tempIdx];
        const maxTempPeakTime = rawTempTime ? rawTempTime.split('T')[1] : '--:--';

        // UV indexing
        const uvIdx = findMaxIdx(data.hourly.uv_index.slice(0, 24));
        const uvVal = data.hourly.uv_index[uvIdx] || 3.5;
        const uvMeta = getWHOUVMetadata(uvVal);
        const rawUvTime = data.hourly.time[uvIdx];
        const uvPeakTime = rawUvTime ? rawUvTime.split('T')[1] : '--:--';

        // Wind profile
        const windIdx = findMaxIdx(data.hourly.wind_speed_10m.slice(0, 24));
        const windVal = data.hourly.wind_speed_10m[windIdx] || 10;
        const windBeaufort = getBeaufort(windVal);
        const rawWindTime = data.hourly.time[windIdx];
        const windPeakTime = rawWindTime ? rawWindTime.split('T')[1] : '--:--';

        // Rain profile
        const rainIdx = findMaxIdx(data.hourly.precipitation.slice(0, 24));
        const rainMm = data.hourly.precipitation[rainIdx] || 0;
        const rainProb = data.hourly.precipitation_probability[rainIdx] || 20;
        const rainDesc = getWMORainDesc(rainMm);
        const rawRainTime = data.hourly.time[rainIdx];
        const rainPeakTime = rawRainTime ? rawRainTime.split('T')[1] : '--:--';

        // Tomorrow's profile (indices 24 to 47)
        const tomorrowTemps = data.hourly.temperature_2m?.slice(24, 48) || [];
        const tomorrowRainProbs = data.hourly.precipitation_probability?.slice(24, 48) || [];
        const tomorrowRains = data.hourly.precipitation?.slice(24, 48) || [];

        const tomorrowMaxTemp = tomorrowTemps.length > 0 ? Math.round(Math.max(...tomorrowTemps)) : 14;
        const tomorrowRainProb = tomorrowRainProbs.length > 0 ? Math.max(...tomorrowRainProbs) : 0;
        const tomorrowTotalRain = tomorrowRains.length > 0 ? tomorrowRains.reduce((a: number, b: number) => a + b, 0) : 0;

        let tomorrowCondition = "Partly Cloudy";
        if (tomorrowRainProb > 50 || tomorrowTotalRain > 1.5) {
          tomorrowCondition = "Rainy & Showers";
        } else if (tomorrowRainProb > 25) {
          tomorrowCondition = "Mostly Cloudy";
        } else if (tomorrowMaxTemp > 18) {
          tomorrowCondition = "Sunny & Clear";
        } else {
          tomorrowCondition = "Mainly Clear";
        }

        setWeatherData({
          maxTemp,
          currentTemp,
          condition,
          uvVal,
          uvDesc: uvMeta.desc,
          uvColorClass: uvMeta.colorClass,
          uvPeakTime,
          windVal,
          windBeaufort,
          windPeakTime,
          rainMm,
          rainProb,
          rainDesc,
          rainPeakTime,
          maxTempPeakTime,
          isMocked: false,
          tomorrowMaxTemp,
          tomorrowRainProb,
          tomorrowCondition,
          tomorrowTotalRain,
        });
      }
    } catch (err) {
      // Construct default weather values smoothly if network issues occur
      setWeatherData({
        maxTemp: 19,
        currentTemp: 16,
        condition: 'Variable rain',
        uvVal: 4.2,
        uvDesc: 'Moderate',
        uvColorClass: 'text-[#fbbf24]',
        uvPeakTime: '13:00',
        windVal: 12,
        windBeaufort: 'Gentle Breeze',
        windPeakTime: '15:00',
        rainMm: 1.5,
        rainProb: 65,
        rainDesc: 'Slight Rain',
        rainPeakTime: '14:00',
        maxTempPeakTime: '16:00',
        isMocked: true,
        tomorrowMaxTemp: 13,
        tomorrowRainProb: 75,
        tomorrowCondition: 'Overcast & Rainy',
        tomorrowTotalRain: 4.2,
      });
    } finally {
      setIsWeatherLoading(false);
    }
  };

  // Fast manual reload trigger (bypasses Maps core hours gate entirely)
  const handleManualRefresh = async () => {
    const now = new Date();
    const isCore = isWithinMapsCoreHours(now);
    if (!isCore) {
      // User is outside core hours, so activate a 5-minute live bypass
      const expiry = Date.now() + 5 * 60 * 1000;
      localStorage.setItem('traffic_bypass_until', expiry.toString());
      setTempBypassExpiry(expiry);
    }

    setIsManualBypass(true);
    
    await executeWeatherUpdate();
    executeTrafficUpdate(true);
    executeTramUpdates();

    setTimeout(() => {
      setIsManualBypass(false);
    }, 1500);

    // Restart automatic refresh cycles safely
    scheduleNextWeatherUpdate();
    scheduleNextTrafficUpdate();
    scheduleNextTramUpdate();
  };

  // Extract SolarEdge variables for Overnight Charging Optimizer
  const activePV = powerData?.PV?.currentPower || 0;
  const activeBatteryPct = powerData?.STORAGE?.chargeLevel || 0;
  const activeBatteryPower = powerData?.STORAGE?.currentPower || 0;
  const activeBatteryStatus = powerData?.STORAGE?.status || "Idle";
  const activeHomeLoad = powerData?.LOAD?.currentPower || 0;
  
  const hasExport = powerData?.connections?.some((c: any) => c.to.toLowerCase() === "grid") || false;
  const gridVal = powerData?.GRID?.currentPower || 0;
  const activeGridPower = hasExport ? -gridVal : gridVal;

  // Tomorrow's Forecast & Recommendation Logic (integrated with solarForecastRule)
  const chargeOvernight = solarForecastAlert ? !!solarForecastAlert.chargeOvernight : true;
  const solarForecastKwh = solarForecastAlert?.forecastKwh ?? null;
  const solarForecastReason = solarForecastAlert?.reason ?? "";

  return (
    <APIProvider apiKey={API_KEY} version="weekly">
      <div className="h-screen overflow-hidden bg-[#F5F5F5] text-[#1A1A1A] flex flex-col font-sans select-none antialiased">
        
        {/* Header Navigation matching the Clean Minimalism spec */}
        <header className="h-[54px] flex items-center justify-between px-8 bg-white border-b border-gray-200 shrink-0 z-50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
              <span className="text-[11px] uppercase tracking-widest font-black text-gray-400">System Live</span>
            </div>
          </div>

          <div className="flex items-center gap-8">
            {/* Live Clock / Title displays */}
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
                {dateString}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Layout view buttons matching the styled selectors */}
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <button
                  id="btn-live"
                  onClick={() => setActiveView('live')}
                  className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeView === 'live'
                      ? 'bg-white text-gray-950 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  id="btn-home"
                  onClick={() => setActiveView('home')}
                  className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeView === 'home'
                      ? 'bg-white text-gray-950 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Home
                </button>
                <button
                  id="btn-agenda"
                  onClick={() => setActiveView('agenda')}
                  className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeView === 'agenda'
                      ? 'bg-white text-gray-950 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Agenda
                </button>
              </div>

              {/* Force refresh indicator */}
              <button
                onClick={handleManualRefresh}
                title="Force Sync Update"
                className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 hover:text-gray-950 cursor-pointer transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              {/* Commute Settings Config */}
              <button
                onClick={handleOpenSettings}
                title="Commute Settings"
                className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 hover:text-gray-950 cursor-pointer transition-all"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Dashboard Viewport Area */}
        <main className="flex-1 w-full relative overflow-hidden bg-[#F5F5F5]">
          {/* A. Live Data Layout: Dual column grid matching the flex layout */}
          <div 
            id="live-view" 
            className={`w-full h-full flex flex-row gap-0 p-0 transition-all duration-300 ${
              activeView === 'live' ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
            }`}
          >
            {/* Left panel: Collapsible Metrolink Tracker & Collapsible Bus Stop */}
            <section 
              className={`flex flex-col transition-all duration-500 h-full relative border-r border-gray-200 bg-gray-50 shrink-0 pt-[13px] pb-[12px] px-[15px] ${
                isBusExpanded ? 'overflow-y-auto' : 'overflow-hidden'
              } ${isTramFullscreen ? 'w-full' : 'flex-1'}`}
            >
              {isTramFullscreen ? (
                /* Full Station View */
                <div className="w-full h-full relative overflow-hidden bg-white border border-gray-200 rounded-2xl shadow-sm">
                  <div className="absolute top-4 right-4 z-40">
                    <button
                      onClick={() => setIsTramFullscreen(false)}
                      className="p-2.5 rounded-xl bg-white/90 backdrop-blur-md hover:bg-white border border-gray-200 text-gray-700 hover:text-gray-900 shadow-md cursor-pointer transition-all duration-200 flex items-center gap-1.5 text-xs font-bold"
                      title="Exit Full Station View"
                    >
                      <Minimize2 className="w-4 h-4 text-gray-600" />
                      <span>Exit Full Station View</span>
                    </button>
                  </div>
                  <iframe
                    id="tram-frame-fullscreen"
                    ref={tramIframeRef}
                    src="https://mltracker.co.uk/index.html#Whitefield"
                    allow="storage-access"
                    className="border-none bg-white w-full h-full"
                    title="Whitefield Tram departure monitors (Fullscreen)"
                  />
                </div>
              ) : (
                <div className={`w-full h-full flex flex-col items-center min-h-0 ${
                  isMetrolinkExpanded && !isBusExpanded ? 'justify-between' : 'justify-start gap-3 overflow-y-auto'
                }`}>
                  {/* 1. Metrolink Tracker Collapsible Division */}
                  <div className={`w-full max-w-[700px] flex flex-col items-center ${
                    isMetrolinkExpanded && !isBusExpanded ? 'flex-1 min-h-0' : 'shrink-0'
                  }`}>
                    <div className="flex items-center justify-between w-full px-2 py-2 mb-1 hover:bg-gray-100 rounded-xl transition-all select-none cursor-pointer shrink-0">
                      <button
                        type="button"
                        onClick={handleToggleMetrolink}
                        className="flex items-center gap-2 flex-1 text-left cursor-pointer"
                        id="btn-collapse-metrolink"
                      >
                        <Train className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                          Metrolink Tracker
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200">
                          Whitefield Live Trams
                        </span>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setIsTramFullscreen(true)}
                          className="p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                          title="Focus Full Station View"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleToggleMetrolink}
                          className="p-1 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                        >
                          {isMetrolinkExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Scalable Iframe Container */}
                    <div className={`w-full transition-all duration-200 overflow-hidden ${
                      isMetrolinkExpanded 
                        ? (!isBusExpanded ? 'flex-1 min-h-0 h-full flex flex-col' : 'h-[360px] flex flex-col') 
                        : 'hidden'
                    }`}>
                      <div className="w-full flex-1 min-h-0 border border-gray-200 rounded-2xl shadow-sm overflow-hidden bg-white relative">
                        <iframe
                          id="tram-frame"
                          ref={tramIframeRef}
                          src="https://mltracker.co.uk/index.html#Whitefield"
                          allow="storage-access"
                          className="border-none bg-white w-full h-full pl-5 pt-2.5"
                          title="Whitefield Tram departure monitors"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 2. Bus Stop Collapsible Division */}
                  <div className="w-full max-w-[700px] flex flex-col items-center shrink-0">
                    <div className="flex items-center justify-between w-full px-2 py-2 mb-1 hover:bg-gray-100 rounded-xl transition-all select-none cursor-pointer shrink-0">
                      <button
                        type="button"
                        onClick={handleToggleBus}
                        className="flex items-center gap-2 flex-1 text-left cursor-pointer"
                        id="btn-collapse-bus"
                      >
                        <Bus className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                          Bus Stop
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200">
                          Bee Network Live
                        </span>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBusRefreshCounter(prev => prev + 1);
                          }}
                          className="p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                          title="Refresh Bus Departures"
                          id="btn-bus-refresh"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSettings();
                            setActiveSettingsTab('bus');
                          }}
                          className="p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                          title="Configure Bus Stops in Settings"
                          id="btn-bus-settings-header"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleToggleBus}
                          className="p-1 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                        >
                          {isBusExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <motion.div
                      initial={false}
                      animate={{ 
                        height: isBusExpanded ? "auto" : 0, 
                        opacity: isBusExpanded ? 1 : 0,
                      }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden w-full flex justify-center"
                    >
                      <BusStopPanel 
                        configuredStops={configuredBusStops}
                        triggerRefreshCounter={busRefreshCounter}
                        onOpenSettings={() => {
                          handleOpenSettings();
                          setActiveSettingsTab('bus');
                        }}
                      />
                    </motion.div>
                  </div>
                </div>
              )}
            </section>

            {/* Right panel: Data Metrics container */}
            <section 
              className={`flex-col gap-6 overflow-y-auto transition-all duration-500 items-center p-[15px] bg-[#F9FAFB] shrink-0 h-full w-[500px] border-l border-gray-200 ${
                isTramFullscreen ? 'hidden w-0 max-w-0 p-0 overflow-hidden' : 'flex'
              }`}
            >
              {/* Next Event Division */}
              <div className="w-full flex flex-col items-center">
                <button
                  onClick={() => setIsNextEventExpanded(!isNextEventExpanded)}
                  className="flex items-center justify-between w-[436px] px-2 py-2 mb-1 hover:bg-gray-100 rounded-xl transition-all cursor-pointer select-none"
                  id="btn-collapse-next-event"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                    <CalendarIcon className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700 truncate">
                      {nextEventTitle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {nextEventCountdown && (
                      <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {nextEventCountdown}
                      </span>
                    )}
                    <div className="text-gray-400 hover:text-gray-700 transition-colors">
                      {isNextEventExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </button>

                <motion.div
                  initial={false}
                  animate={{ 
                    height: isNextEventExpanded ? "auto" : 0, 
                    opacity: isNextEventExpanded ? 1 : 0,
                  }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden w-full flex justify-center"
                >
                  <NextEventTile 
                    origin={homeLocation}
                    triggerRefreshCounter={trafficRefreshCounter}
                    isLiveAllowed={isLiveAllowed}
                    onRefresh={handleManualRefresh}
                    onEventLoaded={handleEventLoaded}
                  />
                </motion.div>
              </div>

              {/* Traffic Division */}
              <div className="w-full flex flex-col items-center">
                <button
                  onClick={() => setIsTrafficExpanded(!isTrafficExpanded)}
                  className="flex items-center justify-between w-[436px] px-2 py-2 mb-1 hover:bg-gray-100 rounded-xl transition-all cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                      Traffic & Commutes
                    </span>
                  </div>
                  <div className="text-gray-400 hover:text-gray-700 transition-colors">
                    {isTrafficExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                <motion.div
                  initial={false}
                  animate={{ 
                    height: isTrafficExpanded ? "auto" : 0, 
                    opacity: isTrafficExpanded ? 1 : 0,
                  }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden w-full flex justify-center"
                >
                  <TrafficPanel 
                    origin={homeLocation}
                    destinations={activeDestinations}
                    onUpdated={handleTrafficUpdated} 
                    triggerRefreshCounter={trafficRefreshCounter} 
                    isLiveAllowed={isLiveAllowed}
                    tempBypassExpiry={tempBypassExpiry}
                  />
                </motion.div>
              </div>

              {/* Weather Division */}
              <div className="w-full flex flex-col items-center">
                <button
                  onClick={() => setIsWeatherExpanded(!isWeatherExpanded)}
                  className="flex items-center justify-between w-[436px] px-2 py-2 mb-1 hover:bg-gray-100 rounded-xl transition-all cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                      Weather Forecast
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-sky-50 text-sky-700 border border-sky-200">
                      Manchester, UK
                    </span>
                  </div>
                  <div className="text-gray-400 hover:text-gray-700 transition-colors">
                    {isWeatherExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                <motion.div
                  initial={false}
                  animate={{ 
                    height: isWeatherExpanded ? "auto" : 0, 
                    opacity: isWeatherExpanded ? 1 : 0,
                  }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden w-full flex justify-center"
                >
                  <WeatherPanel 
                    weather={weatherData} 
                    loading={isWeatherLoading} 
                  />
                </motion.div>
              </div>

              {/* Overnight Charging Optimizer Division */}
              <div className="w-full flex flex-col items-center">
                <button
                  onClick={() => setIsOptimizerExpanded(!isOptimizerExpanded)}
                  className="flex items-center justify-between w-[436px] px-2 py-2 mb-1 hover:bg-gray-100 rounded-xl transition-all cursor-pointer select-none"
                  id="btn-collapse-optimizer"
                >
                  <div className="flex items-center gap-2">
                    <BatteryCharging className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-2">
                      Overnight Charging Optimizer
                      {chargeOvernight && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      )}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase ml-2 ${
                      chargeOvernight ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                    }`}>
                      {chargeOvernight ? "🔌 Charge" : "☀️ Solar"}
                    </span>
                  </div>
                  <div className="text-gray-400 hover:text-gray-700 transition-colors">
                    {isOptimizerExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                <motion.div
                  initial={false}
                  animate={{ 
                    height: isOptimizerExpanded ? "auto" : 0, 
                    opacity: isOptimizerExpanded ? 1 : 0,
                  }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden w-full flex justify-center"
                >
                  <div className="w-[436px] bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
                    <div className="flex flex-col gap-3">
                      {/* Line 1: Mini Status Monitor Title & Cards */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Mini Status Monitor</h4>
                          {powerError && (
                            <span className="text-[8px] text-amber-600 font-bold flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" /> Offline
                            </span>
                          )}
                        </div>
                        
                        {/* Flex row of 4 mini cards, each exactly 85px wide */}
                        <div className="flex flex-row justify-between gap-1.5">
                          {/* 1. Solar Mini */}
                          <div className="w-[85px] bg-amber-50/20 border border-amber-100 rounded-xl p-2 flex flex-col justify-between transition-all hover:bg-amber-50/50">
                            <div className="flex justify-between items-center">
                              <span className="text-[8px] font-black uppercase text-amber-600 tracking-wider">Solar</span>
                              <Sun className="w-3 h-3 text-amber-500" />
                            </div>
                            <div className="mt-1">
                              <span className="text-xs font-black text-gray-900">{activePV} kW</span>
                            </div>
                          </div>

                          {/* 2. Battery Mini */}
                          <div className="w-[85px] bg-emerald-50/20 border border-emerald-100 rounded-xl p-2 flex flex-col justify-between transition-all hover:bg-emerald-50/50">
                            <div className="flex justify-between items-center">
                              <span className="text-[8px] font-black uppercase text-emerald-600 tracking-wider">Battery</span>
                              <Battery className="w-3 h-3 text-emerald-500" />
                            </div>
                            <div className="mt-1">
                              <span className="text-xs font-black text-gray-900">{activeBatteryPct}%</span>
                              <span className="text-[7px] text-gray-400 block truncate leading-none mt-0.5">
                                {activeBatteryPower > 0 ? `${activeBatteryStatus} (${activeBatteryPower}kW)` : "Idle"}
                              </span>
                            </div>
                          </div>

                          {/* 3. Grid Mini */}
                          <div className={`w-[85px] rounded-xl p-2 flex flex-col justify-between border transition-all ${
                            activeGridPower !== 0 
                              ? activeGridPower > 0 
                                ? "bg-slate-50 border-slate-200 hover:bg-slate-100/50" 
                                : "bg-emerald-50/10 border-emerald-100 hover:bg-emerald-50/20"
                              : "bg-gray-50/30 border-gray-100 hover:bg-gray-50/50"
                          }`}>
                            <div className="flex justify-between items-center">
                              <span className="text-[8px] font-black uppercase text-slate-600 tracking-wider">Grid</span>
                              <Zap className="w-3 h-3 text-slate-500" />
                            </div>
                            <div className="mt-1">
                              <span className="text-xs font-black text-gray-900">
                                {activeGridPower === 0 ? "0.0 kW" : `${Math.abs(activeGridPower)} kW`}
                              </span>
                              <span className="text-[7px] text-gray-400 block truncate leading-none mt-0.5">
                                {activeGridPower > 0 ? "Import" : activeGridPower < 0 ? "Export" : "Balanced"}
                              </span>
                            </div>
                          </div>

                          {/* 4. Home Mini */}
                          <div className="w-[85px] bg-blue-50/20 border border-blue-100 rounded-xl p-2 flex flex-col justify-between transition-all hover:bg-blue-50/50">
                            <div className="flex justify-between items-center">
                              <span className="text-[8px] font-black uppercase text-blue-600 tracking-wider">Home</span>
                              <Home className="w-3 h-3 text-blue-500" />
                            </div>
                            <div className="mt-1">
                              <span className="text-xs font-black text-gray-900">{activeHomeLoad} kW</span>
                            </div>
                          </div>
                        </div>

                        {/* Solar Forecast Recommendation Details */}
                        {solarForecastAlert && (
                          <div className="mt-3 bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-[10px]">
                            <div className="flex items-center justify-between font-bold text-gray-800 mb-0.5">
                              <span>Tomorrow Solar Forecast</span>
                              {solarForecastKwh !== null && (
                                <span className="font-black text-indigo-600">{solarForecastKwh} kWh</span>
                              )}
                            </div>
                            <p className="text-gray-500 leading-tight text-[9.5px]">
                              {solarForecastReason}
                            </p>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </motion.div>
              </div>


            </section>
          </div>

          {/* B. Calendar Agenda Layout: High readability Embed */}
          <div 
            id="agenda-view" 
            className={`w-full h-full transition-all duration-300 absolute inset-0 bg-white flex flex-col ${
              activeView === 'agenda' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* View Mode Toggle Bar */}
            <div className="flex items-center justify-between px-6 py-2 bg-white border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Calendar Schedule
                </span>
              </div>
              <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl border border-gray-200">
                <button
                  id="btn-calendar-agenda"
                  onClick={() => setCalendarMode('AGENDA')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    calendarMode === 'AGENDA'
                      ? 'bg-white text-indigo-700 shadow-sm border border-gray-200/80'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Agenda View
                </button>
                <button
                  id="btn-calendar-week"
                  onClick={() => setCalendarMode('WEEK')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    calendarMode === 'WEEK'
                      ? 'bg-white text-indigo-700 shadow-sm border border-gray-200/80'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Weekly View
                </button>
              </div>
            </div>

            {/* Calendar Embed */}
            <div className="flex-1 w-full h-full relative">
              <iframe
                key={calendarMode}
                src={`https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=Europe%2FLondon&showPrint=0&showNav=0&showTitle=0&showDate=0&showTabs=0&mode=${calendarMode}&showTz=0&src=cmlja2FyZGpqQGdtYWlsLmNvbQ&src=ZmFtaWx5MDIwNDAwMjI5NzMwMzMxMTg1MjRAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=ZmFtaWx5NDA0OTk2MjQ0NjEyMzYyOTkzMEBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=Z2Fycmlja21qQGdtYWlsLmNvbQ&src=dGhyb2dib3R0bGVAZ21haWwuY29t&src=Y24wbGs5aHI4NzBlcWFzcm9pMXI0NGtzMzBAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=bW5kM2htMmtsdmQwMHVnbTR2OG5ha291Y2NAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=ZHFiODMzYjRvMGJqNmI0NDFtMGl2YjV0ZXYwMmJqcDhAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23039be5&color=%239e69af&color=%237986cb&color=%23a79b8e&color=%238e24aa&color=%23ef6c00&color=%237cb342`}
                className="w-full h-full border-none"
                scrolling="no"
                title="Google Calendar Embed"
              />
            </div>
          </div>

          {/* C. Home Dashboard with Collapsible Solar & Close Down views */}
          <div
            id="home-view"
            className={`w-full h-full transition-all duration-300 absolute inset-0 bg-white ${
              activeView === 'home' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'
            }`}
          >
            <HomeDashboard weatherData={weatherData} />
          </div>
        </main>

        {/* Footer Status Bar with clean minimal specs */}
        <footer className="h-8 bg-white border-t border-gray-200 px-8 flex items-center justify-between shrink-0">
          <div className="text-[9px] font-bold text-gray-400 tracking-widest uppercase">
            Dashboard Mode: <span className="text-emerald-500 font-black">{isPeak ? 'PEAK REFRESH (5M / API • 30S / TRAM)' : 'STANDARD (15M / API • 30S / TRAM)'}</span>
          </div>
          <div className="text-[9px] font-bold text-gray-400 tracking-widest uppercase">
            Version 6.1.4 Build 882 • OpenMeteo & Google Maps Active
          </div>
        </footer>

        {/* Settings Dialog Modal */}
        <AnimatePresence>
          {isSettingsOpen && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsSettingsOpen(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />

              {/* Modal Box */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="relative bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[88vh] z-10"
              >
                {/* Header */}
                <div className="flex flex-col border-b border-gray-100 shrink-0">
                  <div className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Settings className="w-5 h-5 text-emerald-600" />
                      <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Dashboard Settings</h3>
                    </div>
                    <button
                      onClick={() => setIsSettingsOpen(false)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-all cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Navigation Tabs */}
                  <div className="flex px-6 gap-2 bg-gray-50/50 pt-1 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('traffic')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                        activeSettingsTab === 'traffic'
                          ? 'bg-white text-emerald-700 border-emerald-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900 border-transparent'
                      }`}
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Commute & Locations
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('bus')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                        activeSettingsTab === 'bus'
                          ? 'bg-white text-amber-700 border-amber-500 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900 border-transparent'
                      }`}
                    >
                      <Bus className="w-3.5 h-3.5 text-amber-500" />
                      Bus Stops
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('tasks')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                        activeSettingsTab === 'tasks'
                          ? 'bg-white text-emerald-700 border-emerald-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900 border-transparent'
                      }`}
                    >
                      <ListChecks className="w-3.5 h-3.5" />
                      Daily Tasks
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('family')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                        activeSettingsTab === 'family'
                          ? 'bg-white text-emerald-700 border-emerald-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900 border-transparent'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      Family & Colors
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSettingsTab('sonos')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                        activeSettingsTab === 'sonos'
                          ? 'bg-white text-indigo-700 border-indigo-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900 border-transparent'
                      }`}
                    >
                      <Music className={`w-3.5 h-3.5 ${formSonosRoutineEnabled ? 'text-indigo-500' : 'text-gray-400'}`} />
                      <span>Sonos Routine</span>
                      {!formSonosRoutineEnabled && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-bold uppercase tracking-wider">
                          Off
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Body (scrollable) */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* TAB 1: COMMUTE & LOCATIONS */}
                  {activeSettingsTab === 'traffic' && (
                    <div className="space-y-6">
                      {/* Number of Traffic Locations Selector (1 to 4) */}
                      <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-100 space-y-2">
                        <label className="text-[11px] font-black uppercase tracking-wider text-emerald-800 block">
                          Number of Traffic Locations (1 to 4)
                        </label>
                        <p className="text-[11px] text-emerald-700">
                          Choose how many commute destinations to include on the live dashboard.
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          {[1, 2, 3, 4].map((count) => (
                            <button
                              key={count}
                              type="button"
                              onClick={() => setFormLocationsCount(count)}
                              className={`flex-1 py-2 rounded-xl text-xs font-black transition-all border cursor-pointer ${
                                formLocationsCount === count
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              {count} {count === 1 ? 'Location' : 'Locations'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Home Location */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                          Home Location (Origin)
                        </label>
                        <input
                          type="text"
                          value={formHomeLocation}
                          onChange={(e) => setFormHomeLocation(e.target.value)}
                          placeholder="Enter full home address or postcode"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        />
                        <p className="text-[10px] text-gray-400">
                          Used as the starting address for all travel time queries.
                        </p>
                      </div>

                      {/* Google Maps Gating Bypass */}
                      <div className="space-y-2 border-t border-gray-100 pt-4">
                        <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                          Google Maps Core Hours Gating
                        </label>
                        <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                          <input
                            type="checkbox"
                            id="bypass-checkbox"
                            checked={formManualBypass}
                            onChange={(e) => setFormManualBypass(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                          <label htmlFor="bypass-checkbox" className="text-xs text-gray-700 font-bold select-none cursor-pointer">
                            Always Use Live API (Bypass 06:30 - 09:30 Weekdays Restriction)
                          </label>
                        </div>
                        <p className="text-[10px] text-gray-400">
                          When disabled, real-time Google Maps queries are restricted to weekday commute core hours (06:30 - 09:30 AM) to optimize API usage. Turn this ON to force live traffic data at all times.
                        </p>
                      </div>

                      {/* Destinations List */}
                      <div className="border-t border-gray-100 pt-4 space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                          Commute Destinations ({formLocationsCount} Active)
                        </h4>
                        <div className="space-y-4">
                          {formDestinations.slice(0, formLocationsCount).map((dest, idx) => (
                            <div key={dest.id} className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest flex items-center gap-1.5">
                                  <MapPin className="w-3 h-3" />
                                  Location {idx + 1}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="sm:col-span-1 space-y-1">
                                  <label className="text-[9px] font-bold text-gray-400 uppercase">Label</label>
                                  <input
                                    type="text"
                                    value={dest.name}
                                    onChange={(e) => {
                                      const updated = [...formDestinations];
                                      updated[idx].name = e.target.value;
                                      setFormDestinations(updated);
                                    }}
                                    className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all font-bold"
                                  />
                                </div>
                                <div className="sm:col-span-2 space-y-1">
                                  <label className="text-[9px] font-bold text-gray-400 uppercase">Address / Postcode</label>
                                  <input
                                    type="text"
                                    value={dest.address}
                                    onChange={(e) => {
                                      const updated = [...formDestinations];
                                      updated[idx].address = e.target.value;
                                      setFormDestinations(updated);
                                    }}
                                    className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                                  />
                                </div>
                              </div>
                              <div className="space-y-1 max-w-[120px]">
                                <label className="text-[9px] font-bold text-gray-400 uppercase block">Est. Mins (Fallback)</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="180"
                                  value={dest.defaultMins}
                                  onChange={(e) => {
                                    const updated = [...formDestinations];
                                    updated[idx].defaultMins = parseInt(e.target.value) || 0;
                                    setFormDestinations(updated);
                                  }}
                                  className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB: BUS STOPS */}
                  {activeSettingsTab === 'bus' && (
                    <div className="space-y-6">
                      <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200/80 space-y-1">
                        <div className="flex items-center gap-2">
                          <Bus className="w-4 h-4 text-amber-600" />
                          <h4 className="text-xs font-black uppercase tracking-wider text-amber-900">
                            Bee Network Live Bus Stops
                          </h4>
                        </div>
                        <p className="text-xs text-amber-800 leading-relaxed">
                          Configure one or more local bus stops to scrape live TfGM departures without requiring a headless browser. You can find the ATCO code from the URL on <span className="font-mono font-bold">tfgm.com/travel-updates/live-departures/bus/{"{ATCO_CODE}"}</span>.
                        </p>
                      </div>

                      {/* List of configured stops */}
                      <div className="space-y-4">
                        {formBusStops.map((stop, index) => (
                          <div 
                            key={stop.id || index}
                            className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 space-y-3 relative group hover:border-amber-200 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-black">
                                  {index + 1}
                                </span>
                                Bus Stop #{index + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setFormBusStops(prev => prev.filter((_, i) => i !== index));
                                }}
                                className="text-gray-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Remove this bus stop"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[11px] font-bold text-gray-700 block mb-1">
                                  Display Name
                                </label>
                                <input
                                  type="text"
                                  value={stop.name}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFormBusStops(prev => prev.map((s, i) => i === index ? { ...s, name: val } : s));
                                  }}
                                  placeholder="e.g. Stand Lane / opp Clough St"
                                  className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                                />
                              </div>

                              <div>
                                <label className="text-[11px] font-bold text-gray-700 block mb-1">
                                  TfGM ATCO Code <span className="text-amber-600">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={stop.atcoCode}
                                  onChange={(e) => {
                                    const val = e.target.value.trim().toUpperCase();
                                    setFormBusStops(prev => prev.map((s, i) => i === index ? { ...s, atcoCode: val } : s));
                                  }}
                                  placeholder="e.g. 1800NC33691"
                                  className="w-full text-xs font-mono font-semibold px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="text-[11px] font-bold text-gray-700 block mb-1">
                                Route Filter <span className="text-gray-400 font-normal">(Optional — e.g. "98", leave blank for all routes)</span>
                              </label>
                              <input
                                type="text"
                                value={stop.routeFilter || ''}
                                onChange={(e) => {
                                  const val = e.target.value.trim();
                                  setFormBusStops(prev => prev.map((s, i) => i === index ? { ...s, routeFilter: val } : s));
                                }}
                                placeholder="All routes (or e.g. 98, 471)"
                                className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Add stop button */}
                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFormBusStops(prev => [
                              ...prev,
                              {
                                id: `stop-${Date.now()}`,
                                name: `Stop ${prev.length + 1}`,
                                atcoCode: '',
                                routeFilter: '',
                                enabled: true
                              }
                            ]);
                          }}
                          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                        >
                          <Plus className="w-4 h-4" />
                          Add Another Bus Stop
                        </button>

                        {formBusStops.length === 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setFormBusStops([
                                {
                                  id: 'stop-1',
                                  name: 'Stand Lane / opp Clough St (Inbound)',
                                  atcoCode: '1800NC33691',
                                  routeFilter: '98',
                                  enabled: true
                                },
                                {
                                  id: 'stop-2',
                                  name: 'Stand Lane / nr Clough St (Outbound)',
                                  atcoCode: '1800NC33681',
                                  routeFilter: '',
                                  enabled: true
                                }
                              ]);
                            }}
                            className="text-xs text-amber-700 hover:underline font-bold cursor-pointer"
                          >
                            Load Default Local Stops
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 2: DAILY TASKS */}
                  {activeSettingsTab === 'tasks' && (
                    <div className="space-y-6">
                      {/* Daily Close Down Timing & Schedule Card */}
                      <div className="bg-gradient-to-br from-indigo-50/70 via-white to-gray-50/70 p-4 rounded-2xl border border-indigo-100/90 shadow-2xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-indigo-100/60">
                          <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
                              <Clock className="w-4 h-4" />
                            </div>
                            <div>
                              <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                                Daily Close Down Schedule & Timing
                              </h4>
                              <p className="text-[11px] text-gray-500">
                                Configure when the close-down routine triggers across dashboard focus mode and Sonos.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                            <span className="text-[10px] font-bold uppercase text-gray-400">Effective Tonight:</span>
                            <span className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-black tracking-wide shadow-2xs flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              {formEffectiveTime}
                            </span>
                            {formUseTodayOverride && (
                              <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-200 text-[9px] font-black uppercase tracking-wider">
                                Override
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Option 1: Overall Scheduled Time */}
                          <div className="bg-white p-3.5 rounded-xl border border-gray-200/90 shadow-2xs space-y-2.5">
                            <div className="flex items-center justify-between">
                              <label className="text-[11px] font-black uppercase tracking-wide text-gray-800 flex items-center gap-1.5">
                                <span>Overall Scheduled Time</span>
                              </label>
                              <span className="text-[10px] font-bold text-gray-400 uppercase">Regular Schedule</span>
                            </div>
                            <p className="text-[10px] text-gray-500 leading-relaxed">
                              Standard time applied every day unless a one-off override is set for today.
                            </p>

                            <div className="flex items-center gap-2 pt-1 flex-wrap">
                              <input
                                type="time"
                                value={formScheduledTime}
                                onChange={(e) => setFormScheduledTime(e.target.value)}
                                className="px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 cursor-pointer"
                              />
                              <div className="flex items-center gap-1 flex-wrap">
                                {['19:30', '20:00', '20:30', '21:00'].map((preset) => (
                                  <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setFormScheduledTime(preset)}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                                      formScheduledTime === preset
                                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-extrabold shadow-2xs'
                                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                  >
                                    {preset}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Option 2: Today's Override */}
                          <div className={`p-3.5 rounded-xl border transition-all ${
                            formUseTodayOverride 
                              ? 'bg-amber-50/40 border-amber-200 shadow-2xs' 
                              : 'bg-white border-gray-200/90'
                          } space-y-2.5`}>
                            <div className="flex items-center justify-between">
                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={formUseTodayOverride}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFormUseTodayOverride(checked);
                                    if (checked && !formTodayCustomTime) {
                                      setFormTodayCustomTime(formScheduledTime);
                                    }
                                  }}
                                  className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer accent-amber-600"
                                />
                                <span className="text-[11px] font-black uppercase tracking-wide text-gray-800">
                                  Change Time for Today Only
                                </span>
                              </label>
                              {formUseTodayOverride && (
                                <button
                                  type="button"
                                  onClick={() => setFormUseTodayOverride(false)}
                                  className="text-[10px] font-bold text-amber-800 hover:underline cursor-pointer"
                                >
                                  Reset to Standard
                                </button>
                              )}
                            </div>

                            <p className="text-[10px] text-gray-500 leading-relaxed">
                              {formUseTodayOverride 
                                ? "Applies tonight only. Tomorrow will automatically revert back to your standard scheduled time."
                                : "Enable this if you need close down to run earlier or later just for this evening."}
                            </p>

                            {formUseTodayOverride ? (
                              <div className="flex items-center gap-2 pt-1 flex-wrap">
                                <input
                                  type="time"
                                  value={formTodayCustomTime}
                                  onChange={(e) => setFormTodayCustomTime(e.target.value)}
                                  className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-sm font-bold text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-600 cursor-pointer"
                                />
                                <div className="flex items-center gap-1 flex-wrap">
                                  {['19:30', '20:00', '20:30', '21:00', '21:30'].map((preset) => (
                                    <button
                                      key={preset}
                                      type="button"
                                      onClick={() => setFormTodayCustomTime(preset)}
                                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                                        formTodayCustomTime === preset
                                          ? 'bg-amber-600 border-amber-600 text-white font-extrabold shadow-2xs'
                                          : 'bg-white border-amber-200 text-amber-800 hover:bg-amber-100/60'
                                      }`}
                                    >
                                      {preset}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFormUseTodayOverride(true);
                                    setFormTodayCustomTime(formScheduledTime);
                                  }}
                                  className="px-3 py-1.5 rounded-lg border border-dashed border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-gray-100 text-gray-600 text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                                >
                                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                                  Set Custom Time for Tonight
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Quick Sonos Automation Routine Toggle in Schedule Card */}
                        <div className="pt-3 border-t border-indigo-100/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/70 p-3 rounded-xl border border-gray-100">
                          <div className="flex items-center gap-2.5">
                            <div className={`p-1.5 rounded-lg text-white shrink-0 ${
                              formSonosRoutineEnabled ? 'bg-indigo-600' : 'bg-gray-400'
                            }`}>
                              <Music className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-black text-gray-900 uppercase tracking-wide">
                                  Sonos Routine Automation
                                </span>
                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded border ${
                                  formSonosRoutineEnabled 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                    : 'bg-gray-100 text-gray-500 border-gray-200'
                                }`}>
                                  {formSonosRoutineEnabled ? 'Enabled' : 'Turned Off'}
                                </span>
                              </div>
                              <p className="text-[10px] text-gray-500">
                                {formSonosRoutineEnabled
                                  ? `Automatically triggers Sonos playlist at ${formEffectiveTime} and restores at ${formRevertTime}.`
                                  : "Sonos routine is turned off. Speakers will not play automatically."}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                            <button
                              type="button"
                              onClick={() => setFormSonosRoutineEnabled(!formSonosRoutineEnabled)}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                                formSonosRoutineEnabled ? 'bg-emerald-600' : 'bg-gray-300'
                              }`}
                              role="switch"
                              aria-checked={formSonosRoutineEnabled}
                              title={formSonosRoutineEnabled ? "Turn off Sonos routine" : "Turn on Sonos routine"}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-xs ${
                                  formSonosRoutineEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Swear Jar Coin Cost Setting Card */}
                      <div className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-xl bg-amber-500 text-white shadow-xs">
                            <Coins className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                              Family Swear Jar - Cost Per Coin
                            </h4>
                            <p className="text-[10px] text-gray-500">
                              Configure the fine amount added each time a coin button is clicked in the swear jar (e.g., 10p, 20p, 50p, £1).
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={formCoinCost}
                            onChange={(e) => setFormCoinCost(parseInt(e.target.value, 10) || 10)}
                            className="px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm font-bold text-gray-800 w-32 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          />
                          <span className="text-xs font-bold text-gray-600">p (£{(formCoinCost / 100).toFixed(2)} per coin)</span>
                          <div className="flex items-center gap-1.5 ml-2 flex-wrap">
                            {[5, 10, 20, 50, 100, 200].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setFormCoinCost(preset)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                                  formCoinCost === preset
                                    ? 'bg-amber-600 border-amber-600 text-white font-extrabold shadow-2xs'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {preset >= 100 ? `£${preset / 100}` : `${preset}p`}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                          <div>
                            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                              Daily Close Down Tasks ({formTasks.length})
                            </h4>
                            <p className="text-[10px] text-gray-400">
                              Edit task descriptions or add extra custom checklist items.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const newId = `task_${Date.now()}`;
                              setFormTasks([...formTasks, { id: newId, name: 'New Task', category: 'cleaning' }]);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Extra Task
                          </button>
                        </div>

                      <div className="space-y-2.5">
                        {formTasks.map((task, idx) => (
                          <div key={task.id} className="flex items-center gap-2 p-2.5 bg-gray-50 border border-gray-200 rounded-xl">
                            <span className="text-[10px] font-black text-gray-400 w-6 text-center">#{idx + 1}</span>
                            <input
                              type="text"
                              value={task.name}
                              onChange={(e) => {
                                const updated = [...formTasks];
                                updated[idx].name = e.target.value;
                                setFormTasks(updated);
                              }}
                              placeholder="Task name"
                              className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setFormTasks(formTasks.filter((_, i) => i !== idx));
                              }}
                              className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                              title="Delete Task"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Rules and Exemptions Banner */}
                      <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl text-xs space-y-1.5 text-gray-600">
                        <div className="font-extrabold text-indigo-900 flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          Task Allocation Rules & Exemptions
                        </div>
                        <ul className="text-[11px] space-y-1 text-gray-600 list-disc list-inside">
                          <li><strong>Bags & Clothes:</strong> Unassigned (applies to everyone).</li>
                          <li><strong>Mum & Dad's Room:</strong> Always assigned to all adults (no children).</li>
                          <li><strong>Children's Rooms:</strong> Children are always matched to their own room (e.g. Alex to Alex's Room, El to El's room).</li>
                          <li><strong>General Tasks:</strong> 1 Adult + 1 Child with automatic workload balancing.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                  {/* TAB 3: FAMILY & COLORS */}
                  {activeSettingsTab === 'family' && (
                    <div className="space-y-6">
                      {/* Adults Section */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                          <div>
                            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                              Adults ({formAdults.length})
                            </h4>
                            <p className="text-[10px] text-gray-400">
                              Configure adult names and badge color associations.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const newId = `adult_${Date.now()}`;
                              setFormAdults([...formAdults, { id: newId, name: 'Adult Name', role: 'adult', color: 'blue' }]);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Adult
                          </button>
                        </div>

                        <div className="space-y-3">
                          {formAdults.map((adult, idx) => (
                            <div key={adult.id} className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={adult.name}
                                  onChange={(e) => {
                                    const updated = [...formAdults];
                                    updated[idx].name = e.target.value;
                                    setFormAdults(updated);
                                  }}
                                  className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-black text-gray-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  placeholder="Adult Name"
                                />
                                <button
                                  type="button"
                                  onClick={() => setFormAdults(formAdults.filter((_, i) => i !== idx))}
                                  className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>

                              {/* Color selector */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                <span className="text-[9px] font-bold text-gray-400 uppercase mr-1">Badge Color:</span>
                                {MEMBER_COLOR_OPTIONS.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      const updated = [...formAdults];
                                      updated[idx].color = c.id;
                                      setFormAdults(updated);
                                    }}
                                    className={`w-5 h-5 rounded-full ${c.colorClass} flex items-center justify-center transition-transform cursor-pointer ${
                                      adult.color === c.id ? 'ring-2 ring-offset-1 ring-gray-800 scale-110' : 'opacity-70 hover:opacity-100'
                                    }`}
                                    title={c.name}
                                  >
                                    {adult.color === c.id && <Check className="w-3 h-3 text-white" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Children Section */}
                      <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                          <div>
                            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                              Children ({formChildren.length})
                            </h4>
                            <p className="text-[10px] text-gray-400">
                              Configure child names and badge color associations.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const newId = `child_${Date.now()}`;
                              setFormChildren([...formChildren, { id: newId, name: 'Child Name', role: 'child', color: 'teal' }]);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Child
                          </button>
                        </div>

                        <div className="space-y-3">
                          {formChildren.map((child, idx) => (
                            <div key={child.id} className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={child.name}
                                  onChange={(e) => {
                                    const updated = [...formChildren];
                                    updated[idx].name = e.target.value;
                                    setFormChildren(updated);
                                  }}
                                  className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-black text-gray-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  placeholder="Child Name"
                                />
                                <button
                                  type="button"
                                  onClick={() => setFormChildren(formChildren.filter((_, i) => i !== idx))}
                                  className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>

                              {/* Color selector */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                <span className="text-[9px] font-bold text-gray-400 uppercase mr-1">Badge Color:</span>
                                {MEMBER_COLOR_OPTIONS.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      const updated = [...formChildren];
                                      updated[idx].color = c.id;
                                      setFormChildren(updated);
                                    }}
                                    className={`w-5 h-5 rounded-full ${c.colorClass} flex items-center justify-center transition-transform cursor-pointer ${
                                      child.color === c.id ? 'ring-2 ring-offset-1 ring-gray-800 scale-110' : 'opacity-70 hover:opacity-100'
                                    }`}
                                    title={c.name}
                                  >
                                    {child.color === c.id && <Check className="w-3 h-3 text-white" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 4: SONOS ROUTINE */}
                  {activeSettingsTab === 'sonos' && (
                    <div className="space-y-6">
                      {/* Master Routine Enable/Disable Card & Toggle */}
                      <div className={`p-4 rounded-2xl border transition-all ${
                        formSonosRoutineEnabled 
                          ? 'bg-gradient-to-r from-emerald-50 via-teal-50/40 to-white border-emerald-200 shadow-xs' 
                          : 'bg-gray-100/90 border-gray-300 shadow-none'
                      }`}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-start sm:items-center gap-3">
                            <div className={`p-2.5 rounded-xl text-white shrink-0 transition-colors ${
                              formSonosRoutineEnabled ? 'bg-emerald-600 shadow-xs' : 'bg-gray-400'
                            }`}>
                              <Music className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                                  Sonos Close-Down Routine
                                </h4>
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${
                                  formSonosRoutineEnabled 
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                                    : 'bg-gray-200 text-gray-600 border-gray-300'
                                }`}>
                                  {formSonosRoutineEnabled ? 'Routine Active' : 'Routine Turned Off'}
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">
                                {formSonosRoutineEnabled
                                  ? `Speakers automatically group and play close-down playlist at ${formEffectiveTime}, reverting at ${formRevertTime}.`
                                  : "Sonos routine is turned off. Automatic triggers and all associated buttons are disabled and greyed out."}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0">
                            <span className="text-xs font-black uppercase text-gray-600">
                              {formSonosRoutineEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setFormSonosRoutineEnabled(!formSonosRoutineEnabled)}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 ${
                                formSonosRoutineEnabled ? 'bg-emerald-600' : 'bg-gray-300'
                              }`}
                              role="switch"
                              aria-checked={formSonosRoutineEnabled}
                              title={formSonosRoutineEnabled ? "Click to turn off Sonos routine" : "Click to turn on Sonos routine"}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-xs ${
                                  formSonosRoutineEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Offline Warning Banner */}
                      {!formSonosRoutineEnabled && (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2.5 text-xs text-amber-900">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                          <p className="leading-snug">
                            <strong>Sonos Routine is turned off.</strong> Volume presets, schedule time adjustments, and test trigger buttons are greyed out until turned back on.
                          </p>
                        </div>
                      )}

                      {/* Timing Summary Banner */}
                      <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs transition-all ${
                        formSonosRoutineEnabled 
                          ? 'bg-indigo-50/80 border-indigo-200' 
                          : 'bg-gray-100 border-gray-200 opacity-60'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`p-1.5 rounded-lg text-white shrink-0 ${
                            formSonosRoutineEnabled ? 'bg-indigo-600' : 'bg-gray-400'
                          }`}>
                            <Clock className="w-4 h-4" />
                          </div>
                          <div>
                            <span className={`font-black uppercase tracking-wide text-[11px] flex items-center gap-1.5 ${
                              formSonosRoutineEnabled ? 'text-indigo-950' : 'text-gray-600'
                            }`}>
                              Tonight's Close-Down Time: {formEffectiveTime}
                              {formUseTodayOverride ? (
                                <span className="text-[9px] bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.2 rounded font-black">
                                  Today's Override
                                </span>
                              ) : (
                                <span className="text-[9px] text-gray-400 font-bold uppercase">
                                  Daily Scheduled
                                </span>
                              )}
                            </span>
                            <p className={`text-[11px] mt-0.5 ${
                              formSonosRoutineEnabled ? 'text-indigo-700' : 'text-gray-500'
                            }`}>
                              {formSonosRoutineEnabled
                                ? `Routine triggers at ${formEffectiveTime} and restores after 15 minutes at ${formRevertTime}. Adjust timing in the Daily Tasks tab.`
                                : `Routine is turned off. Sonos speakers will not automatically trigger at ${formEffectiveTime}.`}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={!formSonosRoutineEnabled}
                          onClick={() => setActiveSettingsTab('tasks')}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide shrink-0 transition-colors ${
                            formSonosRoutineEnabled 
                              ? 'bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-800 cursor-pointer' 
                              : 'bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed opacity-50'
                          }`}
                        >
                          Change Time
                        </button>
                      </div>

                      {/* Volume Settings Section */}
                      <div className={`p-4 rounded-xl border space-y-4 transition-all ${
                        formSonosRoutineEnabled 
                          ? 'bg-indigo-50/60 border-indigo-100' 
                          : 'bg-gray-50 border-gray-200 opacity-60'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className={`text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${
                              formSonosRoutineEnabled ? 'text-indigo-900' : 'text-gray-500'
                            }`}>
                              <Volume2 className={`w-4 h-4 ${formSonosRoutineEnabled ? 'text-indigo-600' : 'text-gray-400'}`} />
                              Routine Playback Volume
                            </h4>
                            <p className={`text-[11px] mt-0.5 ${
                              formSonosRoutineEnabled ? 'text-indigo-700' : 'text-gray-400'
                            }`}>
                              Set the volume level for speakers during the {formEffectiveTime} daily close-down routine.
                            </p>
                          </div>
                          <span className={`text-sm font-black px-3 py-1 rounded-lg border shadow-sm ${
                            formSonosRoutineEnabled
                              ? 'text-indigo-700 bg-white border-indigo-200'
                              : 'text-gray-400 bg-gray-100 border-gray-200'
                          }`}>
                            {formSonosVolume}%
                          </span>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <VolumeX className="w-4 h-4 text-gray-400 shrink-0" />
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              disabled={!formSonosRoutineEnabled}
                              value={formSonosVolume}
                              onChange={(e) => setFormSonosVolume(parseInt(e.target.value, 10))}
                              className={`w-full h-2 rounded-lg appearance-none ${
                                formSonosRoutineEnabled 
                                  ? 'bg-indigo-200 accent-indigo-600 cursor-pointer' 
                                  : 'bg-gray-200 accent-gray-400 cursor-not-allowed opacity-50'
                              }`}
                            />
                            <Volume2 className={`w-4 h-4 ${formSonosRoutineEnabled ? 'text-indigo-600' : 'text-gray-400'} shrink-0`} />
                          </div>

                          {/* Quick Volume Preset Buttons */}
                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                            <span className="text-[10px] font-bold text-gray-400 uppercase mr-1">Presets:</span>
                            {[
                              { label: 'Quiet (15%)', val: 15 },
                              { label: 'Gentle (25%)', val: 25 },
                              { label: 'Medium (35%)', val: 35 },
                              { label: 'Loud (50%)', val: 50 },
                            ].map((preset) => (
                              <button
                                key={preset.val}
                                type="button"
                                disabled={!formSonosRoutineEnabled}
                                onClick={() => setFormSonosVolume(preset.val)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all border ${
                                  !formSonosRoutineEnabled
                                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed opacity-60 shadow-none'
                                    : formSonosVolume === preset.val
                                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm cursor-pointer'
                                      : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-100 cursor-pointer'
                                }`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <p className={`text-[10px] italic ${
                          formSonosRoutineEnabled ? 'text-indigo-600/80' : 'text-gray-400'
                        }`}>
                          Note: When the {formRevertTime} restore routine runs, speaker volumes are automatically returned to their original pre-routine levels.
                        </p>
                      </div>

                      {/* Test Sonos Controls Section */}
                      <div className={`p-4 rounded-xl border space-y-4 transition-all ${
                        formSonosRoutineEnabled 
                          ? 'bg-gray-50 border-gray-200' 
                          : 'bg-gray-50/60 border-gray-200 opacity-60'
                      }`}>
                        <div>
                          <h4 className={`text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${
                            formSonosRoutineEnabled ? 'text-gray-900' : 'text-gray-500'
                          }`}>
                            <Music className={`w-4 h-4 ${formSonosRoutineEnabled ? 'text-indigo-500' : 'text-gray-400'}`} />
                            Test Sonos Automation
                          </h4>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            {formSonosRoutineEnabled 
                              ? `Manually test triggering the ${formEffectiveTime} close-down routine or reverting to pre-routine state.`
                              : "Buttons are disabled and greyed out because the Sonos routine is turned off."}
                          </p>
                        </div>

                        {/* Action Buttons */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={handleTestTrigger}
                            disabled={!formSonosRoutineEnabled || sonosTesting}
                            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                              !formSonosRoutineEnabled
                                ? 'bg-gray-200 text-gray-400 border border-gray-300 cursor-not-allowed shadow-none'
                                : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white shadow-sm cursor-pointer'
                            }`}
                          >
                            <Play className={`w-3.5 h-3.5 ${!formSonosRoutineEnabled ? 'fill-gray-400 text-gray-400' : 'fill-white'} ${sonosTesting ? 'animate-spin' : ''}`} />
                            <span>Trigger ({formEffectiveTime} Close-Down)</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleTestRevert}
                            disabled={!formSonosRoutineEnabled || sonosTesting}
                            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                              !formSonosRoutineEnabled
                                ? 'bg-gray-200 text-gray-400 border border-gray-300 cursor-not-allowed shadow-none'
                                : 'bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white shadow-sm cursor-pointer'
                            }`}
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${sonosTesting ? 'animate-spin' : ''}`} />
                            <span>Revert ({formRevertTime} Restore)</span>
                          </button>
                        </div>

                        {/* Status Output Banner */}
                        {sonosStatusMsg && (
                          <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs font-extrabold ${
                            sonosStatusMsg.startsWith("Success") 
                              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                              : sonosStatusMsg.startsWith("Error") || sonosStatusMsg.startsWith("Cannot test")
                                ? "bg-rose-50 border-rose-200 text-rose-800"
                                : "bg-indigo-50 border-indigo-200 text-indigo-800 animate-pulse"
                          }`}>
                            <div className="flex items-center gap-2">
                              <Music className="w-4 h-4 text-indigo-500 animate-bounce" />
                              <span>{sonosStatusMsg}</span>
                            </div>
                            <button 
                              type="button"
                              onClick={() => setSonosStatusMsg(null)}
                              className="text-[10px] uppercase font-black tracking-wider text-gray-400 hover:text-gray-700 bg-white border border-gray-100 rounded-lg px-2 py-1 shadow-sm transition cursor-pointer"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row gap-2 justify-between items-center shrink-0">
                  <button
                    type="button"
                    onClick={handleResetDefaults}
                    className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 transition-all cursor-pointer text-left sm:text-center"
                  >
                    Reset to Defaults
                  </button>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(false)}
                      className="w-1/2 sm:w-auto px-4 py-2 border border-gray-200 bg-white rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSettings}
                      className="w-1/2 sm:w-auto px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                    >
                      Save Settings
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </APIProvider>
  );
}
