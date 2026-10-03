import React from 'react';
import { WeatherData } from '../types';
import { Sun, Wind, CloudRain, ShieldAlert, Thermometer } from 'lucide-react';

interface WeatherPanelProps {
  weather: WeatherData | null;
  loading: boolean;
}

export default function WeatherPanel({ weather, loading }: WeatherPanelProps) {
  if (loading && !weather) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm h-64 flex items-center justify-center">
        <div className="text-center text-xs font-bold uppercase tracking-wider text-gray-400 animate-pulse">
          Retrieving Weather Forecast...
        </div>
      </div>
    );
  }

  if (!weather) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm h-64 flex flex-col items-center justify-center text-center">
        <ShieldAlert className="w-8 h-8 text-amber-500 mb-2" />
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Weather temporarily offline</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col w-[436px]">
      <div className="bg-white border border-gray-200 rounded-2xl p-3.5 shadow-sm w-[436px] flex flex-col justify-between overflow-hidden">
        {/* 4 Weather Tiles in one line */}
        <div className="grid grid-cols-4 gap-2 flex-1">
          {/* UV index card */}
          <div className="bg-[#F9FAFB] p-2 rounded-xl border border-gray-100 flex flex-col justify-between w-[95px] h-[85px]">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 uppercase font-black mb-0.5">
              <Sun className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="truncate">UV Index</span>
            </div>
            <div className={`font-bold text-xs ${weather.uvColorClass === 'text-[#4ade80]' ? 'text-emerald-600' : weather.uvColorClass === 'text-[#fbbf24]' ? 'text-amber-500' : 'text-red-600'}`}>
              {weather.uvVal.toFixed(1)} {weather.uvDesc}
            </div>
            <div className="text-[9px] text-gray-400 truncate">Peak @ {weather.uvPeakTime}</div>
          </div>

          {/* Wind card */}
          <div className="bg-[#F9FAFB] p-2 rounded-xl border border-gray-100 flex flex-col justify-between w-[95px] h-[85px]">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 uppercase font-black mb-0.5">
              <Wind className="w-3 h-3 text-sky-500 shrink-0" />
              <span className="truncate">Max Wind</span>
            </div>
            <div className="font-bold text-xs text-gray-900 truncate">
              {weather.windBeaufort}
            </div>
            <div className="text-[9px] text-gray-400 truncate">
              {Math.round(weather.windVal)}mph @ {weather.windPeakTime?.replace(':', '')}
            </div>
          </div>

          {/* Rain Forecast */}
          <div className="bg-[#F9FAFB] p-2 rounded-xl border border-gray-100 flex flex-col justify-between w-[95px] h-[85px]">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 uppercase font-black mb-0.5">
              <CloudRain className="w-3 h-3 text-blue-500 shrink-0" />
              <span className="truncate">Rain</span>
            </div>
            <div className="font-bold text-xs text-blue-600 truncate">
              {weather.rainProb}% Prob.
            </div>
            <div className="text-[9px] text-gray-400 truncate">
              {weather.rainMm.toFixed(1)}mm @ {weather.rainPeakTime}
            </div>
          </div>

          {/* Forecast Card */}
          <div className="bg-[#F9FAFB] p-2 rounded-xl border border-gray-100 flex flex-col justify-between w-[95px] h-[85px]">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 uppercase font-black mb-0.5">
              <Thermometer className="w-3 h-3 text-emerald-500 shrink-0" />
              <span className="truncate">Max Temp</span>
            </div>
            <div className="font-bold text-xs text-gray-900 truncate">
              {weather.maxTemp}°C
            </div>
            <div className="text-[9px] text-gray-400 truncate">
              @ {weather.maxTempPeakTime?.replace(':', '') || '1600'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
