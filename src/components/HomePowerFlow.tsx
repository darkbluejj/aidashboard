import React, { useState, useEffect } from "react";
import { 
  Sun, 
  Battery as BatteryIcon, 
  Home as HomeIcon, 
  Zap, 
  RefreshCw, 
  Sliders,
  Sparkles,
  AlertTriangle
} from "lucide-react";

interface PowerFlowItem {
  status: string;
  currentPower: number;
  chargeLevel?: number;
}

interface PowerFlowData {
  GRID: PowerFlowItem;
  LOAD: PowerFlowItem;
  PV: PowerFlowItem;
  STORAGE: PowerFlowItem;
  connections: Array<{ from: string; to: string }>;
  unit: string;
}

interface HomePowerFlowProps {
  compact?: boolean;
  embedded?: boolean;
}

export default function HomePowerFlow({ compact = false, embedded = false }: HomePowerFlowProps) {
  const [data, setData] = useState<PowerFlowData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("--:--:--");

  const fetchPowerFlow = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/solaredge/powerflow");
      if (res.ok) {
        const json = await res.json();
        if (json && json.siteCurrentPowerFlow) {
          setData(json.siteCurrentPowerFlow);
        }
      }
      setLastUpdated(new Date().toLocaleTimeString([], { hour12: false }));
    } catch (err: any) {
      // Fallback data if offline or unreachable
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPowerFlow();
    const interval = setInterval(fetchPowerFlow, 300000); // 5 mins auto-refresh
    return () => clearInterval(interval);
  }, []);

  // Derive active values based on Live API
  const activePV = data?.PV?.currentPower || 0;
  const activeBatteryPct = data?.STORAGE?.chargeLevel || 0;
  const activeBatteryPower = data?.STORAGE?.currentPower || 0;
  const activeBatteryStatus = data?.STORAGE?.status || "Idle";
  const activeHomeLoad = data?.LOAD?.currentPower || 0;
  
  // Grid calculation: in SolarEdge, if we are exporting to grid, we look at connections
  const hasExport = data?.connections?.some(c => c.to.toLowerCase() === "grid") || false;
  const gridVal = data?.GRID?.currentPower || 0;
  const activeGridPower = hasExport ? -gridVal : gridVal;

  // Check which flows are active
  const isSolarToInverter = activePV > 0;
  const isBatteryToInverter = activeBatteryPower > 0 && activeBatteryStatus.toLowerCase() === "discharging";
  const isInverterToBattery = activeBatteryPower > 0 && activeBatteryStatus.toLowerCase() === "charging";
  const isGridToInverter = activeGridPower > 0;
  const isInverterToGrid = activeGridPower < 0;
  const isInverterToHome = activeHomeLoad > 0;

  if (compact) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm w-[450px] h-[320px] flex flex-col justify-between overflow-hidden relative">
        {/* Status and last updated */}
        <div className="flex justify-between items-center shrink-0">
          <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">
            Last updated: {lastUpdated}
          </span>
          {error && (
            <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[8px] font-bold flex items-center gap-1">
              <AlertTriangle className="w-2 h-2" /> Offline Fallback
            </span>
          )}
        </div>

        {/* Core Interactive Diagram SVG (scaled down for compact mode) */}
        <div className="flex-1 flex items-center justify-center scale-[0.75] origin-center -my-8">
          <div className="relative w-full max-w-[500px] h-[340px]">
            {/* Dynamic Animated Flow Particles SVG Container */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 500 340">
              <defs>
                <marker id="blue-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 2 2 L 8 5 L 2 8" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </marker>
              </defs>

              {/* Flow lines passing through central inverter coordinate (250, 170) */}
              {/* 1. Solar to Inverter */}
              <path 
                d="M 100 80 Q 150 140 250 170" 
                fill="none" 
                stroke={isSolarToInverter ? "#fbbf24" : "#e5e7eb"} 
                strokeWidth={isSolarToInverter ? "3" : "1.5"}
                strokeDasharray={isSolarToInverter ? "4,4" : "none"} 
              />
              
              {/* 2. Battery to Inverter / Inverter to Battery */}
              <path 
                d="M 100 260 Q 150 200 250 170" 
                fill="none" 
                stroke={isBatteryToInverter || isInverterToBattery ? "#34d399" : "#e5e7eb"} 
                strokeWidth={isBatteryToInverter || isInverterToBattery ? "3" : "1.5"}
                strokeDasharray={isBatteryToInverter || isInverterToBattery ? "4,4" : "none"}
              />

              {/* 4. Inverter to Grid / Grid to Inverter */}
              <path 
                d="M 250 170 Q 350 200 400 260" 
                fill="none" 
                stroke={isGridToInverter || isInverterToGrid ? "#9ca3af" : "#e5e7eb"} 
                strokeWidth={isGridToInverter || isInverterToGrid ? "3" : "1.5"}
                strokeDasharray={isGridToInverter || isInverterToGrid ? "4,4" : "none"}
              />

              {/* Blue arrows matching the screenshot annotations */}
              <path 
                d="M 170 120 L 120 155" 
                fill="none" 
                stroke="#3b82f6" 
                strokeWidth="2.5" 
                strokeLinecap="round"
                markerEnd="url(#blue-arrow)" 
              />
              <path 
                d="M 140 220 L 210 115" 
                fill="none" 
                stroke="#3b82f6" 
                strokeWidth="2.5" 
                strokeLinecap="round"
                markerEnd="url(#blue-arrow)" 
              />
              <path 
                d="M 360 250 L 415 175" 
                fill="none" 
                stroke="#3b82f6" 
                strokeWidth="2.5" 
                strokeLinecap="round"
                markerEnd="url(#blue-arrow)" 
              />

              {/* Pulsing circular flow markers on active streams */}
              {isSolarToInverter && (
                <circle r="4" fill="#f59e0b">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M 100 80 Q 150 140 250 170" />
                </circle>
              )}
              {isInverterToBattery && (
                <circle r="4" fill="#10b981">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M 250 170 Q 150 200 100 260" />
                </circle>
              )}
              {isBatteryToInverter && (
                <circle r="4" fill="#10b981">
                  <animateMotion dur="3s" repeatCount="indefinite" path="M 100 260 Q 150 200 250 170" />
                </circle>
              )}
              {isGridToInverter && (
                <circle r="4" fill="#4b5563">
                  <animateMotion dur="4s" repeatCount="indefinite" path="M 400 260 Q 350 200 250 170" />
                </circle>
              )}
              {isInverterToGrid && (
                <circle r="4" fill="#4b5563">
                  <animateMotion dur="4s" repeatCount="indefinite" path="M 250 170 Q 350 200 400 260" />
                </circle>
              )}
            </svg>

            {/* 1. Solar Node (Top Left) */}
            <div className="absolute top-[30px] left-[50px] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                activePV > 0 
                  ? "bg-amber-500 text-white shadow-lg shadow-amber-500/30 scale-105 border-none" 
                  : "bg-white border border-gray-200 text-gray-400"
              }`}>
                <Sun className={`w-7 h-7`} />
              </div>
              <div className="mt-2 text-center bg-white/90 px-2 py-0.5 rounded-lg border border-gray-100 shadow-sm">
                <span className="text-[10px] font-black uppercase text-gray-400">Solar</span>
                <div className="text-xs font-black text-gray-900">{activePV} kW</div>
              </div>
            </div>

            {/* 2. Battery Node (Bottom Left) */}
            <div className="absolute bottom-[30px] left-[50px] -translate-x-1/2 +translate-y-1/2 flex flex-col items-center">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                activeBatteryPower > 0 
                  ? activeBatteryStatus.toLowerCase() === "charging"
                    ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-105"
                    : "bg-teal-500 text-white shadow-lg shadow-teal-500/30 scale-105"
                  : "bg-white border border-gray-200 text-gray-400"
              }`}>
                <BatteryIcon className="w-7 h-7" />
              </div>
              <div className="mt-2 text-center bg-white/90 px-2 py-0.5 rounded-lg border border-gray-100 shadow-sm min-w-[70px]">
                <span className="text-[10px] font-black uppercase text-gray-400">Battery</span>
                <div className="text-xs font-black text-gray-900">{activeBatteryPct}%</div>
                {activeBatteryPower > 0 && (
                  <div className="text-[9px] font-bold text-emerald-600">
                    {activeBatteryStatus.toLowerCase() === "charging" ? "+" : "-"}{activeBatteryPower} kW
                  </div>
                )}
              </div>
            </div>

            {/* Dashed Home Component Placeholder */}
            <div className="absolute top-[30px] right-[50px] +translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <div className="w-[45px] h-[75px] border-2 border-dashed border-blue-400 rounded-lg flex items-center justify-center bg-blue-50/5">
                {/* empty inside */}
              </div>
              <span className="mt-2 text-[10px] font-bold text-blue-400 whitespace-nowrap">Home component</span>
            </div>

            {/* 5. National Grid Node (Bottom Right) */}
            <div className="absolute bottom-[30px] right-[50px] +translate-x-1/2 +translate-y-1/2 flex flex-col items-center">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                activeGridPower !== 0 
                  ? activeGridPower > 0
                    ? "bg-gray-600 text-white shadow-lg shadow-gray-500/30"
                    : "bg-emerald-600 text-white shadow-lg shadow-emerald-500/30"
                  : "bg-white border border-gray-200 text-gray-400"
              }`}>
                <Zap className="w-7 h-7" />
              </div>
              <div className="mt-2 text-center bg-white/90 px-2 py-0.5 rounded-lg border border-gray-100 shadow-sm min-w-[70px]">
                <span className="text-[10px] font-black uppercase text-gray-400">Grid</span>
                <div className="text-xs font-black text-gray-900">
                  {activeGridPower === 0 ? "0 kW" : `${Math.abs(activeGridPower)} kW`}
                </div>
                {activeGridPower !== 0 && (
                  <div className={`text-[9px] font-bold ${activeGridPower > 0 ? 'text-gray-500' : 'text-emerald-600'}`}>
                    {activeGridPower > 0 ? "Import" : "Export"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Flow Summary Footer */}
        <div className="border-t border-gray-100 pt-2 flex justify-between items-center text-[10px] text-gray-500 shrink-0">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
            <span>Solar: <strong>{activePV} kW</strong></span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full inline-block ${activeBatteryStatus.toLowerCase() === "charging" ? "bg-emerald-500" : "bg-teal-500"}`}></span>
            <span>Battery: <strong>{activeBatteryPct}%</strong></span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full inline-block ${activeGridPower !== 0 ? activeGridPower > 0 ? "bg-gray-500" : "bg-emerald-500" : "bg-gray-300"}`}></span>
            <span>Grid: <strong>{activeGridPower === 0 ? "0 kW" : `${Math.abs(activeGridPower)} kW`}</strong></span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "w-full flex flex-col" : "w-full h-full flex flex-col bg-gray-50 p-6 overflow-y-auto"}>
      {!embedded && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-gray-900 tracking-tight">SolarEdge Smart Energy</h1>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> Site Active
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Real-time power flows to/from Solar Panels, Battery, Household, and National Grid.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchPowerFlow}
              disabled={loading}
              className="p-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-800 shadow-sm cursor-pointer transition-all duration-200"
              title="Force Refresh Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Main layout area */}
      <div className={embedded ? "w-full flex flex-col" : "flex-1 flex flex-col min-h-[480px]"}>
        {/* Flow Visualization Tiles */}
        <div className={`w-full bg-white border border-gray-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between relative ${embedded ? 'h-[230px] min-h-[230px]' : 'min-h-[420px]'}`}>
          {/* Header Row */}
          <div className="flex justify-between items-center mb-6 shrink-0">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">
                Live Smart Metrics
              </span>
              <h3 className="text-sm font-black text-gray-900 tracking-tight">System Performance</h3>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                Last updated: {lastUpdated}
              </span>
              {error && (
                <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-bold flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" /> Api Offline: Showing Fallback Data
                </span>
              )}
            </div>
          </div>

          {/* 4 Tiles Grid */}
          <div className={embedded ? "grid grid-cols-4 gap-3 flex-1 justify-center sm:justify-start" : "grid grid-cols-[repeat(auto-fill,190px)] gap-3 flex-1 justify-center sm:justify-start"} style={embedded ? { height: '160px', width: '790px' } : undefined}>
            {/* Tile 1: Solar Production */}
            <div 
              className="bg-amber-50/40 border border-amber-100 rounded-2xl p-3.5 flex flex-col justify-between transition-all hover:bg-amber-50/70 hover:shadow-sm h-[130px] shrink-0"
              style={embedded ? { width: '181px' } : { width: '190px' }}
            >
              <div className="flex justify-between items-start">
                <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-md shadow-amber-500/10">
                  <Sun className="w-5 h-5" />
                </div>
                <span className="text-[9px] font-extrabold uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full animate-pulse whitespace-nowrap">
                  {activePV > 0 ? "Generating" : "Inactive"}
                </span>
              </div>
              <div className="mt-3">
                <span className="text-[10px] font-bold uppercase text-amber-600 tracking-wider block whitespace-nowrap">Solar Production</span>
                <span className="text-2xl font-black text-gray-900 tracking-tight">{activePV} kW</span>
                <span className="text-[9px] text-gray-500 block mt-0.5 leading-tight">Direct panels output</span>
              </div>
            </div>

            {/* Tile 2: Battery State */}
            <div 
              className="bg-emerald-50/40 border border-emerald-100 rounded-2xl p-3.5 flex flex-col justify-between transition-all hover:bg-emerald-50/70 hover:shadow-sm h-[130px] shrink-0"
              style={embedded ? { width: '180px' } : { width: '190px' }}
            >
              <div className="flex justify-between items-start">
                <div className={`p-2.5 text-white rounded-xl shadow-md ${
                  activeBatteryStatus.toLowerCase() === "charging" 
                    ? "bg-emerald-500 shadow-emerald-500/10" 
                    : "bg-teal-500 shadow-teal-500/10"
                }`}>
                  <BatteryIcon className="w-5 h-5" />
                </div>
                <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                  activeBatteryStatus.toLowerCase() === "charging" 
                    ? "bg-emerald-100 text-emerald-800" 
                    : "bg-teal-100 text-teal-800"
                }`}>
                  {activeBatteryStatus}
                </span>
              </div>
              <div className="mt-3">
                <span className="text-[10px] font-bold uppercase text-emerald-600 tracking-wider block whitespace-nowrap">Battery State</span>
                <span className="text-2xl font-black text-gray-900 tracking-tight">{activeBatteryPct}%</span>
                <span className="text-[9px] text-gray-500 block mt-0.5 leading-tight truncate">
                  {activeBatteryPower > 0 
                    ? `${activeBatteryStatus.toLowerCase() === "charging" ? "Charging" : "Discharging"} at ${activeBatteryPower} kW` 
                    : "Idle / Fully Charged"}
                </span>
              </div>
            </div>

            {/* Tile 3: Grid Import/Export */}
            <div 
              className={`rounded-2xl p-3.5 flex flex-col justify-between transition-all hover:shadow-sm h-[130px] shrink-0 ${
                activeGridPower !== 0 
                  ? activeGridPower > 0 
                    ? "bg-slate-50 border border-slate-200 hover:bg-slate-100/50" 
                    : "bg-emerald-50/10 border border-emerald-100 hover:bg-emerald-50/20"
                  : "bg-gray-50/30 border border-gray-100 hover:bg-gray-50/50"
              }`}
              style={embedded ? { width: '180px' } : { width: '190px' }}
            >
              <div className="flex justify-between items-start">
                <div className={`p-2.5 text-white rounded-xl shadow-md ${
                  activeGridPower !== 0 
                    ? activeGridPower > 0 
                      ? "bg-slate-700 shadow-slate-700/10" 
                      : "bg-emerald-600 shadow-emerald-600/10"
                    : "bg-gray-400"
                }`}>
                  <Zap className="w-5 h-5" />
                </div>
                {activeGridPower !== 0 ? (
                  <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                    activeGridPower > 0 ? "bg-slate-100 text-slate-800" : "bg-emerald-100 text-emerald-800"
                  }`}>
                    {activeGridPower > 0 ? "Importing" : "Exporting"}
                  </span>
                ) : (
                  <span className="text-[9px] font-extrabold uppercase bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    Balanced
                  </span>
                )}
              </div>
              <div className="mt-3">
                <span className="text-[10px] font-bold uppercase text-slate-600 tracking-wider block whitespace-nowrap">Grid Import / Export</span>
                <span className="text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {activeGridPower === 0 ? "0.0 kW" : `${Math.abs(activeGridPower)} kW`}
                </span>
                <span className="text-[9px] text-gray-500 block mt-0.5 leading-tight truncate">
                  {activeGridPower > 0 
                    ? "Importing from grid" 
                    : activeGridPower < 0 
                      ? "Exporting solar into grid" 
                      : "Energy balanced"}
                </span>
              </div>
            </div>

            {/* Tile 4: Home Usage */}
            <div 
              className="bg-blue-50/40 border border-blue-100 rounded-2xl p-3.5 flex flex-col justify-between transition-all hover:bg-blue-50/70 hover:shadow-sm h-[130px] shrink-0"
              style={embedded ? { width: '180px' } : { width: '190px' }}
            >
              <div className="flex justify-between items-start">
                <div className="p-2.5 bg-blue-500 text-white rounded-xl shadow-md shadow-blue-500/10">
                  <HomeIcon className="w-5 h-5" />
                </div>
                <span className="text-[9px] font-extrabold uppercase bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  Active Load
                </span>
              </div>
              <div className="mt-3">
                <span className="text-[10px] font-bold uppercase text-blue-600 tracking-wider block whitespace-nowrap">Home Usage</span>
                <span className="text-2xl font-black text-gray-900 tracking-tight">{activeHomeLoad} kW</span>
                <span className="text-[9px] text-gray-500 block mt-0.5 leading-tight text-ellipsis overflow-hidden whitespace-nowrap">Active household load</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
