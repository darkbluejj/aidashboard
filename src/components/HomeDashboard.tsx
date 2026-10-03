import React, { useState, useEffect } from "react";
import { 
  Zap, 
  Moon, 
  ChevronUp, 
  ChevronDown, 
  Clock,
  Coins
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import HomePowerFlow from "./HomePowerFlow";
import DailyCloseDown from "./DailyCloseDown";
import SwearJar from "./SwearJar";
import { WeatherData } from "../types";

interface HomeDashboardProps {
  weatherData: WeatherData | null;
}

export default function HomeDashboard({ weatherData }: HomeDashboardProps) {
  const [isEnergyExpanded, setIsEnergyExpanded] = useState<boolean>(true);
  const [isSwearJarExpanded, setIsSwearJarExpanded] = useState<boolean>(true);
  const [isCloseDownExpanded, setIsCloseDownExpanded] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [effectiveTime, setEffectiveTime] = useState<string>("20:00");
  const [scheduledTime, setScheduledTime] = useState<string>("20:00");
  const [todayCustomTime, setTodayCustomTime] = useState<string | null>(null);

  // Helper to check if current time is within active focus window
  const isTimeInFocusWindow = (timeStr: string, date: Date) => {
    const [h, m] = (timeStr || "20:00").split(":").map(Number);
    const targetMins = (isNaN(h) ? 20 : h) * 60 + (isNaN(m) ? 0 : m);
    const nowMins = date.getHours() * 60 + date.getMinutes();
    return nowMins >= targetMins || nowMins < 5 * 60;
  };

  const isCloseDownFocus = isTimeInFocusWindow(effectiveTime, currentTime);

  // Fetch closedown timing config on mount and periodically
  const fetchTiming = async () => {
    try {
      const res = await fetch("/api/closedown");
      if (res.ok) {
        const data = await res.json();
        if (data.effectiveTime) setEffectiveTime(data.effectiveTime);
        if (data.scheduledTime) setScheduledTime(data.scheduledTime);
        setTodayCustomTime(data.todayCustomTime || null);
      }
    } catch (err) {
      console.warn("Failed to fetch closedown timing:", err);
    }
  };

  useEffect(() => {
    fetchTiming();
    const interval = setInterval(fetchTiming, 30000);
    return () => clearInterval(interval);
  }, []);

  // Initial auto-expand based on focus
  useEffect(() => {
    const inFocus = isTimeInFocusWindow(effectiveTime, new Date());
    setIsCloseDownExpanded(inFocus);
    setIsEnergyExpanded(!inFocus);
  }, [effectiveTime]);

  // Update current time occasionally to support live state shifts
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-full h-full bg-gray-50 flex flex-col overflow-y-auto">
      {/* Main Collapsible Sections */}
      <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto w-full flex-1">
        
        {/* Section 1: SolarEdge Smart Energy Flow */}
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
          <button
            onClick={() => setIsEnergyExpanded(!isEnergyExpanded)}
            className="w-full h-[50px] flex items-center justify-between px-6 bg-white hover:bg-gray-50/50 transition-colors border-b border-gray-100 cursor-pointer select-none text-left"
            id="btn-collapse-energy"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-amber-50 text-amber-500 border border-amber-100 flex items-center justify-center">
                <Zap className="w-4 h-4" />
              </div>
              <span className="text-sm font-black uppercase tracking-wider text-gray-800">
                SolarEdge Smart Energy Flow
              </span>
            </div>
            <div className="p-1 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 transition-colors bg-white">
              {isEnergyExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          <AnimatePresence initial={false}>
            {isEnergyExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="p-6 bg-white border-t border-gray-100">
                  <HomePowerFlow embedded={true} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Section 2: Family Swear Jar */}
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
          <button
            onClick={() => setIsSwearJarExpanded(!isSwearJarExpanded)}
            className="w-full h-[50px] flex items-center justify-between px-6 bg-white hover:bg-gray-50/50 transition-colors border-b border-gray-100 cursor-pointer select-none text-left"
            id="btn-collapse-swearjar"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center">
                <Coins className="w-4 h-4" />
              </div>
              <span className="text-sm font-black uppercase tracking-wider text-gray-800">
                Family Swear Jar 🫙
              </span>
            </div>
            <div className="p-1 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 transition-colors bg-white">
              {isSwearJarExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          <AnimatePresence initial={false}>
            {isSwearJarExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="p-6 bg-white border-t border-gray-100">
                  <SwearJar embedded={true} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Section 3: Daily Close Down Checklist */}
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
          <button
            onClick={() => setIsCloseDownExpanded(!isCloseDownExpanded)}
            className="w-full h-[50px] flex items-center justify-between px-6 bg-white hover:bg-gray-50/50 transition-colors border-b border-gray-100 cursor-pointer select-none text-left"
            id="btn-collapse-closedown"
          >
            <div className="flex items-center gap-3">
              <div className={`p-1.5 rounded-lg border flex items-center justify-center ${
                isCloseDownFocus
                  ? "bg-indigo-50 text-indigo-600 border-indigo-100"
                  : "bg-gray-50 text-gray-500 border-gray-200"
              }`}>
                <Moon className="w-4 h-4" />
              </div>
              <span className="text-sm font-black uppercase tracking-wider text-gray-800 flex items-center gap-2">
                Daily Close Down
                {isCloseDownFocus && (
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                )}
              </span>

              {isCloseDownFocus ? (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-indigo-100 text-indigo-800 flex items-center gap-1.5 animate-pulse ml-2">
                  <Clock className="w-3 h-3 text-indigo-600" /> Active Focus ({effectiveTime}+)
                  {todayCustomTime && (
                    <span className="bg-amber-200 text-amber-900 px-1 py-0.2 rounded font-black text-[8px]">
                      Today
                    </span>
                  )}
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-gray-100 text-gray-500 flex items-center gap-1.5 ml-2">
                  <Clock className="w-3 h-3 text-gray-400" /> Scheduled for {effectiveTime}
                  {todayCustomTime && (
                    <span className="bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded font-black text-[8px]">
                      Today Only
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="p-1 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 transition-colors bg-white">
              {isCloseDownExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          <AnimatePresence initial={false}>
            {isCloseDownExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="bg-white border-t border-gray-100">
                  <DailyCloseDown />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
