import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CalendarEvent } from '../types';
import { Calendar, MapPin, Car, RefreshCw, ExternalLink, Clock, Sparkles, AlertCircle } from 'lucide-react';
import { useApiIsLoaded } from '@vis.gl/react-google-maps';

interface NextEventTileProps {
  origin: string;
  triggerRefreshCounter: number;
  isLiveAllowed: boolean;
  onRefresh?: () => void;
  onEventLoaded?: (event: CalendarEvent | null, countdown?: string) => void;
}

export default function NextEventTile({ origin, triggerRefreshCounter, isLiveAllowed, onRefresh, onEventLoaded }: NextEventTileProps) {
  const isLoaded = useApiIsLoaded();
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loadingEvent, setLoadingEvent] = useState<boolean>(true);
  const [trafficText, setTrafficText] = useState<string>('Calculating live traffic...');
  const [trafficColor, setTrafficColor] = useState<string>('text-emerald-600 bg-emerald-50 border-emerald-200');
  const [distanceText, setDistanceText] = useState<string>('');
  const [isTrafficLoading, setIsTrafficLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const isQueryingRef = useRef<boolean>(false);
  const onEventLoadedRef = useRef(onEventLoaded);

  useEffect(() => {
    onEventLoadedRef.current = onEventLoaded;
  }, [onEventLoaded]);

  // Fetch event details from backend
  const fetchNextEvent = useCallback(async (forceRefresh = false) => {
    try {
      const res = await fetch(`/api/calendar/next-event${forceRefresh ? '?refresh=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.start) {
          setEvent(data);
          if (onEventLoadedRef.current) {
            onEventLoadedRef.current(data);
          }
        } else {
          setEvent(null);
          if (onEventLoadedRef.current) {
            onEventLoadedRef.current(data?.title ? data : null);
          }
        }
      } else {
        setEvent(null);
        if (onEventLoadedRef.current) {
          onEventLoadedRef.current(null);
        }
      }
    } catch (err) {
      console.warn('Network issue fetching next calendar event:', err);
    } finally {
      setLoadingEvent(false);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
  }, []);

  // Compute live traffic for event location using server traffic API
  const queryTrafficForLocation = useCallback(async (location: string) => {
    if (!location || isQueryingRef.current) return;

    if (!isLiveAllowed) {
      setTrafficText('18-22 mins (scheduled)');
      setTrafficColor('text-gray-700 bg-gray-50 border-gray-200');
      return;
    }

    isQueryingRef.current = true;
    setIsTrafficLoading(true);

    try {
      const res = await fetch('/api/traffic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destinations: [{ id: 'event_dest', name: 'Next Event', address: location, defaultMins: 20 }],
          bypass: isLiveAllowed
        })
      });

      isQueryingRef.current = false;
      setIsTrafficLoading(false);

      if (res.ok) {
        const json = await res.json();
        const item = json.items?.[0];

        if (item) {
          if (!json.isFallback && item.durationText) {
            let color = 'text-emerald-700 bg-emerald-50 border-emerald-200';
            if (item.colorClass?.includes('rose')) {
              color = 'text-rose-700 bg-rose-50 border-rose-200';
            } else if (item.colorClass?.includes('amber')) {
              color = 'text-amber-700 bg-amber-50 border-amber-200';
            }

            setTrafficText(`${item.durationText} in live traffic`);
            setDistanceText(item.distanceText || '');
            setTrafficColor(color);
          } else {
            setTrafficText(`${item.durationText || '22 mins (est.)'}`);
            setTrafficColor('text-amber-700 bg-amber-50 border-amber-200');
          }
        } else {
          setTrafficText('22 mins (est.)');
          setTrafficColor('text-gray-700 bg-gray-50 border-gray-200');
        }
      } else {
        setTrafficText('22 mins (est.)');
        setTrafficColor('text-gray-700 bg-gray-50 border-gray-200');
      }
    } catch (err) {
      isQueryingRef.current = false;
      setIsTrafficLoading(false);
      setTrafficText('22 mins (est.)');
      setTrafficColor('text-gray-700 bg-gray-50 border-gray-200');
    }
  }, [origin, isLiveAllowed]);

  // Handle trigger refresh and initial load
  useEffect(() => {
    fetchNextEvent(true);
  }, [triggerRefreshCounter, fetchNextEvent]);

  // When event is loaded or Google Maps API becomes ready or refresh counter changes
  useEffect(() => {
    if (event?.location) {
      queryTrafficForLocation(event.location);
    }
  }, [event, isLoaded, isLiveAllowed, triggerRefreshCounter, queryTrafficForLocation]);

  // Helper to format date / countdown
  const formatEventTime = (isoStart?: string, isoEnd?: string) => {
    if (!isoStart) return { fullTime: '', countdown: '' };
    const start = new Date(isoStart);
    const now = new Date();

    const isToday = start.toDateString() === now.toDateString();
    const timeStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fullTime = isToday ? `Today @ ${timeStr}` : `${start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} @ ${timeStr}`;

    const diffMins = Math.round((start.getTime() - now.getTime()) / (1000 * 60));
    let countdown = '';
    if (diffMins > 0) {
      if (diffMins < 60) {
        countdown = `in ${diffMins}min`;
      } else {
        const hrs = Math.floor(diffMins / 60);
        countdown = `in ${hrs}h`;
      }
    } else if (diffMins >= -60) {
      countdown = 'Happening now';
    } else {
      countdown = 'Completed';
    }

    return { fullTime, countdown };
  };

  const { fullTime, countdown } = formatEventTime(event?.start, event?.end);

  // Notify parent component about event and updated countdown
  useEffect(() => {
    if (event && onEventLoadedRef.current) {
      onEventLoadedRef.current(event, countdown);
    }
  }, [event, countdown]);

  const mapsUrl = event?.location 
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(event.location)}&travelmode=driving`
    : '#';

  return (
    <div className="w-[436px] bg-white border border-gray-200 rounded-2xl p-3 shadow-sm overflow-hidden flex flex-col gap-2.5">
      {/* Thinner Top Line: Clock/Date, Timestamp & Refresh */}
      {loadingEvent ? (
        <div className="py-2.5 flex items-center justify-center gap-2 text-xs text-gray-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
          <span>Fetching event details...</span>
        </div>
      ) : event ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="p-1.5 rounded-xl bg-indigo-50 text-indigo-600 shrink-0 flex items-center justify-center">
                <Calendar className="w-4 h-4 stroke-[2.2]" />
              </div>
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {fullTime}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {lastUpdated && (
                <span className="text-xs font-mono text-gray-400">
                  {lastUpdated}
                </span>
              )}
              <button
                onClick={() => {
                  fetchNextEvent(true);
                  if (onRefresh) onRefresh();
                }}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-all cursor-pointer"
                title="Refresh Next Event & Traffic"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingEvent || isTrafficLoading ? 'animate-spin text-indigo-600' : ''}`} />
              </button>
            </div>
          </div>

          {/* Bottom Section: Location Box + Live Traffic Box */}
          {event.location ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-gray-100/90 items-stretch">
              {/* Location Card */}
              <div className="bg-gray-50/90 border border-gray-100 rounded-2xl p-2.5 flex items-start gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span className="text-xs font-medium text-gray-700 leading-snug line-clamp-3">
                  {event.location}
                </span>
              </div>

              {/* Live Traffic Box */}
              <div className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 text-xs font-bold min-w-0 ${trafficColor}`}>
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <Car className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {isTrafficLoading ? 'Calculating live traffic...' : trafficText}
                  </span>
                </div>

                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-black tracking-wider uppercase hover:underline shrink-0 text-emerald-800"
                  title="Open in Google Maps"
                >
                  <span>ROUTE</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400 italic pt-1 border-t border-gray-100/80">
              No location specified for this event.
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-gray-400 py-3 italic text-center">
          No upcoming events found on calendar.
        </div>
      )}
    </div>
  );
}
