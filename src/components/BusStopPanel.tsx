import React, { useState, useEffect, useRef } from 'react';
import { Bus, Clock, AlertTriangle, Radio, Settings2, ArrowRight, MapPin } from 'lucide-react';
import { BusStopResult, BusStopConfig } from '../types';

export interface BusStopPanelProps {
  configuredStops?: BusStopConfig[];
  triggerRefreshCounter?: number;
  onOpenSettings?: () => void;
}

export const BusStopPanel: React.FC<BusStopPanelProps> = ({
  configuredStops,
  triggerRefreshCounter = 0,
  onOpenSettings
}) => {
  const [stopsData, setStopsData] = useState<BusStopResult[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  const fetchDepartures = async (isManual = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      let res: Response;

      // If configuredStops array prop is explicitly passed
      if (Array.isArray(configuredStops)) {
        if (configuredStops.length === 0) {
          setStopsData([]);
          setIsLoading(false);
          isFetchingRef.current = false;
          return;
        }

        // Request departures for all configured stops in the prop array
        res = await fetch(`/api/bus/departures?all=true&t=${Date.now()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stops: configuredStops })
        });
      } else {
        // Fallback: request default/server configured stops
        res = await fetch(`/api/bus/departures?all=true&t=${Date.now()}`);
      }

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const data = await res.json();

      if (Array.isArray(data.stops) && data.stops.length > 0) {
        setStopsData(data.stops);
      } else if (data.departures) {
        // Single stop shape fallback
        setStopsData([data]);
      } else {
        setStopsData([]);
      }
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.warn("Notice querying bus departures API:", err.message || err);
      setErrorMessage(err.message || "Failed to load bus departures");
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  };

  // Trigger fetch when triggerRefreshCounter changes or configuredStops prop changes
  useEffect(() => {
    fetchDepartures();

    // Auto refresh every 45 seconds (matching cache duration)
    const interval = setInterval(() => {
      fetchDepartures();
    }, 45 * 1000);

    return () => clearInterval(interval);
  }, [triggerRefreshCounter, JSON.stringify(configuredStops)]);

  const hasMockFeed = stopsData.some(s => s._isMockFallback);

  return (
    <div className="w-full max-w-[700px] bg-white border border-gray-200 rounded-2xl p-3 sm:p-3.5 shadow-sm transition-all">
      {/* Main Content Area: Stacked List of All Configured Bus Stops */}
      <div>
        {errorMessage && stopsData.length === 0 ? (
          <div className="py-6 text-center text-gray-500 text-xs flex flex-col items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <p className="font-semibold text-gray-700">{errorMessage}</p>
            <button
              onClick={() => fetchDepartures(true)}
              className="mt-1 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : stopsData.length === 0 && !isLoading ? (
          <div className="py-8 text-center text-gray-500 text-xs flex flex-col items-center gap-2">
            <Bus className="w-6 h-6 text-gray-400 mb-1" />
            <p className="font-semibold text-gray-700">No Bus Stops Configured</p>
            <p className="text-gray-400 text-[11px] max-w-sm">
              Add your local stops in settings to view live Bee Network departures in this list.
            </p>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="mt-2 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Configure Stops
              </button>
            )}
          </div>
        ) : (
          /* Stacked Vertical List: Every configured stop is stacked vertically without requiring user selection */
          <div className="flex flex-col gap-3.5 w-full">
            {stopsData.map((stop, stopIdx) => {
              const nameLower = (stop.stopName || '').toLowerCase();
              const isInbound = nameLower.includes('inbound');
              const isOutbound = nameLower.includes('outbound');

              // Clean display title
              let cleanTitle = (stop.stopName || '')
                .replace(/\(inbound\)/gi, '')
                .replace(/\(outbound\)/gi, '')
                .trim();

              return (
                <div
                  key={stop.atcoCode || stop.id || stopIdx}
                  className="w-full bg-gray-50/70 border border-gray-200/80 rounded-xl p-3 sm:p-3.5 flex flex-col shadow-2xs hover:border-amber-200 transition-colors"
                >
                  {/* Stop Card Header */}
                  <div className="flex items-start justify-between gap-2 pb-2.5 mb-2.5 border-b border-gray-200/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <MapPin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="text-xs font-black text-gray-800 truncate" title={stop.stopName}>
                          {cleanTitle || stop.stopName}
                        </span>

                        {isInbound && (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 border border-sky-200 shrink-0">
                            Inbound
                          </span>
                        )}
                        {isOutbound && (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 border border-purple-200 shrink-0">
                            Outbound
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 mt-1">
                        {stop.atcoCode && (
                          <span className="text-[9px] font-mono text-gray-500 bg-white px-1.5 py-0.2 rounded border border-gray-200">
                            {stop.atcoCode}
                          </span>
                        )}
                        {stop.routeFilter && (
                          <span className="text-[9px] font-bold text-amber-800 bg-amber-100/70 px-1.5 py-0.2 rounded border border-amber-200">
                            Route {stop.routeFilter}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="text-[10px] font-black text-gray-600 bg-white px-2 py-0.5 rounded-full border border-gray-200 shadow-2xs">
                        {stop.departures.length} {stop.departures.length === 1 ? 'departure' : 'departures'}
                      </span>
                    </div>
                  </div>

                  {/* Stop Departures List (Stacked rows) */}
                  {stop.departures.length === 0 ? (
                    <div className="py-5 text-center text-gray-400 text-xs flex flex-col items-center justify-center gap-1 bg-white/70 rounded-lg border border-dashed border-gray-200 my-0.5">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="font-semibold text-gray-600 text-[11px]">No upcoming departures</span>
                      <span className="text-[10px] text-gray-400">Services concluded or not yet commenced</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 w-full">
                      {stop.departures.map((dep, depIdx) => {
                        const isDue = dep.dueInMins === 0;
                        return (
                          <div
                            key={`${dep.route}-${dep.tripId || depIdx}-${dep.dueAtClock || dep.dueInMins}`}
                            className="flex items-center justify-between p-2 sm:px-2.5 rounded-lg bg-white border border-gray-200/70 hover:border-amber-300 transition-colors shadow-2xs gap-2"
                          >
                            {/* Route Pill + Destination */}
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {/* Bee Network Yellow Route Pill */}
                              <div className="shrink-0 bg-[#FFCC00] text-black font-black text-xs px-2 py-0.5 rounded-md shadow-2xs min-w-[36px] text-center border border-amber-300">
                                {dep.route}
                              </div>

                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-bold text-gray-800 truncate block leading-tight" title={dep.destination}>
                                  {dep.destination}
                                </span>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {dep.isRealtime ? (
                                    <span className="inline-flex items-center gap-0.5 text-[8.5px] font-black px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                      Live
                                    </span>
                                  ) : (
                                    <span className="text-[8.5px] font-medium text-gray-400">
                                      Sched
                                    </span>
                                  )}
                                  {dep.hasDisruption && (
                                    <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                      <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                                      Alert
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Departure Due Time */}
                            <div className="shrink-0 text-right pl-2">
                              {dep.dueInMins !== null ? (
                                isDue ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 animate-pulse">
                                    Due now
                                  </span>
                                ) : (
                                  <div className="flex items-baseline gap-0.5 justify-end">
                                    <span className="text-sm font-black text-emerald-600">
                                      {dep.dueInMins}
                                    </span>
                                    <span className="text-[10px] font-bold text-gray-500">
                                      mins
                                    </span>
                                  </div>
                                )
                              ) : dep.dueAtClock ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-[11px] font-bold text-gray-700 font-mono">
                                  <Clock className="w-3 h-3 text-gray-500" />
                                  {dep.dueAtClock}
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium text-gray-400">Sched</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Subtle footer info */}
        <div className="mt-3.5 pt-2.5 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-500">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Radio className="w-3 h-3 text-amber-500" />
            <span>TfGM Bee Network Live</span>
            {lastRefreshed && (
              <span className="font-mono text-gray-400">
                · {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {hasMockFeed && (
              <span className="text-amber-600 font-medium">(Simulated feed)</span>
            )}
          </div>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="hover:text-amber-600 transition-colors flex items-center gap-0.5 cursor-pointer text-gray-500"
            >
              <span>Add / edit stops</span>
              <ArrowRight className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
