import React, { useEffect, useState, useRef } from 'react';
import { TrafficItem, CommuteDestination } from '../types';
import { ShieldAlert, Sparkles, AlertCircle } from 'lucide-react';

interface TrafficPanelProps {
  origin: string;
  destinations: CommuteDestination[];
  onUpdated: (timeString: string) => void;
  triggerRefreshCounter: number;
  isLiveAllowed: boolean;
  tempBypassExpiry?: number;
}

export default function TrafficPanel({ origin, destinations, onUpdated, triggerRefreshCounter, isLiveAllowed, tempBypassExpiry }: TrafficPanelProps) {
  const [trafficItems, setTrafficItems] = useState<TrafficItem[]>(() => 
    destinations.map(d => ({
      id: d.id,
      name: d.name,
      address: d.address,
      durationText: 'Connecting...',
      colorClass: 'text-gray-400'
    }))
  );
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usageInfo, setUsageInfo] = useState<{ monthlyElementCount?: number; monthlyLimit?: number } | null>(null);

  const isQueryingRef = useRef(false);

  // Stable string key for destinations so array reference changes don't trigger effects
  const destinationsKey = JSON.stringify(destinations.map(d => ({ id: d.id, name: d.name, address: d.address })));
  const isBypassActive = tempBypassExpiry !== undefined && tempBypassExpiry > Date.now();

  // Helper to establish estimated fallback timings if offline or key is missing
  const setFallbackTimes = (reason: string) => {
    setIsUsingFallback(true);
    const updatedItems = destinations.map(d => {
      const randomShift = Math.floor(Math.random() * 5) - 2; 
      const mockMinutes = Math.max(1, d.defaultMins + randomShift);

      let colorClass = 'text-emerald-500';
      if (mockMinutes > d.defaultMins + 1) {
        colorClass = 'text-amber-500';
      }

      return {
        id: d.id,
        name: d.name,
        address: d.address,
        durationText: `${mockMinutes} mins (est.)`,
        colorClass,
        isFallback: true
      };
    });
    setTrafficItems(updatedItems);
    
    const now = new Date();
    onUpdated(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  };

  // Only update item labels if destinations change, preserving existing duration text
  useEffect(() => {
    setTrafficItems(prev => {
      const existingMap = new Map<string, TrafficItem>(prev.map(item => [item.id, item]));
      return destinations.map(d => {
        const existing = existingMap.get(d.id);
        if (existing) {
          return { ...existing, name: d.name, address: d.address };
        }
        return {
          id: d.id,
          name: d.name,
          address: d.address,
          durationText: 'Connecting...',
          colorClass: 'text-gray-400'
        };
      });
    });
  }, [destinationsKey]);

  useEffect(() => {
    if (isQueryingRef.current) return;

    const queryTraffic = async () => {
      isQueryingRef.current = true;

      try {
        setErrorMessage(null);
        const res = await fetch('/api/traffic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin,
            destinations,
            bypass: isLiveAllowed || isBypassActive
          })
        });

        if (res.ok) {
          const json = await res.json();
          if (json.usage) {
            setUsageInfo({
              monthlyElementCount: json.usage.monthlyElementCount,
              monthlyLimit: json.usage.monthlyLimit
            });
          }

          if (json.items && Array.isArray(json.items)) {
            setTrafficItems(json.items);
            setIsUsingFallback(!!json.isFallback);
            if (json.quotaExceeded) {
              setErrorMessage('Monthly Google Maps limit (5,000 calls) reached. Using estimates.');
            } else if (json.isFallback && json.fallbackReason) {
              setErrorMessage(json.fallbackReason);
            } else {
              setErrorMessage(null);
            }

            const now = new Date();
            onUpdated(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          } else {
            setFallbackTimes('Invalid response');
          }
        } else {
          setFallbackTimes(`HTTP error ${res.status}`);
        }
      } catch (err: any) {
        console.warn('Notice querying traffic API:', err?.message || err);
        setFallbackTimes('Network issue');
      } finally {
        isQueryingRef.current = false;
      }
    };

    queryTraffic();

  }, [triggerRefreshCounter, origin, destinationsKey, isLiveAllowed, isBypassActive]);

  return (
    <div className="w-[436px]">
      <div className="flex justify-between items-center mb-3">
        {tempBypassExpiry && tempBypassExpiry > Date.now() && !isUsingFallback ? (
          <span className="flex items-center gap-1 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-bold">
            <Sparkles className="w-2.5 h-2.5 text-emerald-600 animate-pulse" />
            <span>LIVE OVERRIDE PASS ({Math.ceil((tempBypassExpiry - Date.now()) / 60000)}m left)</span>
          </span>
        ) : isUsingFallback ? (
          <span className="flex items-center gap-1 text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-bold">
            <AlertCircle className="w-2.5 h-2.5" />
            <span>ESTIMATES ACTIVE</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-bold">
            <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
            <span>LIVE COMMUTE TRACKING</span>
          </span>
        )}

        {usageInfo && (
          <span className="text-[9px] font-extrabold text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded">
            API Cap: {usageInfo.monthlyElementCount ?? 0} / {usageInfo.monthlyLimit ?? 5000} mo
          </span>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm w-[436px] h-[210px] flex flex-col justify-between overflow-hidden">
        {trafficItems.map((item, index) => (
          <React.Fragment key={item.id}>
            {index > 0 && <div className="h-[1px] bg-gray-100"></div>}
            <div className="flex justify-between items-center">
              <div>
                <span className="text-sm font-semibold text-gray-700 block">
                  {item.name}
                </span>
              </div>
              <div className="text-right">
                <span className={`text-base font-black uppercase tracking-tight block ${item.colorClass}`}>
                  {item.durationText.toUpperCase()}
                </span>
                <span className="text-[9px] text-gray-400 uppercase font-bold">
                  {item.colorClass.includes('rose') ? 'Heavy Delay' : item.colorClass.includes('amber') ? 'Moderate' : 'Optimal'}
                </span>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      {errorMessage && (
        <div className="mt-2 text-[9px] text-gray-500 font-medium flex items-center gap-1 px-1">
          <ShieldAlert className="w-3 h-3 text-amber-500 shrink-0" />
          <span>Notice: {errorMessage}</span>
        </div>
      )}
    </div>
  );
}
