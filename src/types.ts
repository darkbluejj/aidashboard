/**
 * Shared Type Definitions for Commute Dashboard
 */

export interface TrafficItem {
  id: string;
  name: string;
  address: string;
  durationText: string;
  colorClass: string;
  isFallback?: boolean;
}

export interface CommuteDestination {
  id: string;
  name: string;
  address: string;
  defaultMins: number;
}

export interface WeatherData {
  maxTemp: number;
  currentTemp: number;
  condition: string;
  uvVal: number;
  uvDesc: string;
  uvColorClass: string;
  uvPeakTime: string;
  windVal: number;
  windBeaufort: string;
  windPeakTime: string;
  rainMm: number;
  rainProb: number;
  rainDesc: string;
  rainPeakTime: string;
  maxTempPeakTime: string;
  isMocked?: boolean;
  // Tomorrow's forecast details for Battery Charging Optimizer
  tomorrowMaxTemp?: number;
  tomorrowRainProb?: number;
  tomorrowCondition?: string;
  tomorrowTotalRain?: number;
}

export interface SystemStatus {
  lastUpdated: string;
  updateMode: "Peak (Fast Refresh)" | "Standard";
  isPeak: boolean;
}

export interface CalendarEvent {
  id?: string;
  title: string;
  location?: string;
  start: string;
  end?: string;
  calendarName?: string;
  description?: string;
  allDay?: boolean;
}

export interface FamilyMember {
  id: string;
  name: string;
  role: 'adult' | 'child';
  color: string;
}

export interface TaskConfig {
  id: string;
  name: string;
  category?: string;
}

export interface BusDeparture {
  route: string;
  destination: string;
  dueInMins: number | null;
  dueAtClock: string | null;
  isRealtime: boolean;
  hasDisruption: boolean;
  tripId?: string;
  isMocked?: boolean;
}

export interface BusStopConfig {
  id: string;
  name: string;
  atcoCode: string;
  routeFilter?: string;
  enabled?: boolean;
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

