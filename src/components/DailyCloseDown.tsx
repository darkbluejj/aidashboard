import React, { useState, useEffect } from "react";
import { FamilyMember } from "../types";
import { 
  Moon, 
  Clock, 
  CheckCircle, 
  Circle, 
  RefreshCw, 
  User, 
  Users, 
  Shuffle,
  Briefcase,
  Sparkles,
  Bath,
  Tv,
  Utensils,
  Home,
  AlertCircle,
  VolumeX
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const MEMBER_COLOR_CLASSES: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  // Fallbacks for saved legacy keys
  teal: "bg-cyan-50 text-cyan-700 border-cyan-200",
  sky: "bg-blue-50 text-blue-700 border-blue-200",
  indigo: "bg-purple-50 text-purple-700 border-purple-200",
  pink: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
};


interface DailyTask {
  id: string;
  name: string;
  category: string;
  assignedAdults: string[];
  assignedChildren: string[];
  done: boolean;
  updatedAt?: string;
}

interface DailyCloseDownProps {
  onFocusChange?: (isFocus: boolean) => void;
}

export default function DailyCloseDown({ onFocusChange }: DailyCloseDownProps) {
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [silent, setSilent] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [lastSynced, setLastSynced] = useState<string>("--:--:--");
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [effectiveTime, setEffectiveTime] = useState<string>("20:00");
  const [scheduledTime, setScheduledTime] = useState<string>("20:00");
  const [todayCustomTime, setTodayCustomTime] = useState<string | null>(null);
  const [sonosRoutineEnabled, setSonosRoutineEnabled] = useState<boolean>(true);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/closedown/config");
      if (res.ok) {
        const data = await res.json();
        const combined = [...(data.adults || []), ...(data.children || [])];
        setFamilyMembers(combined);
        if (data.scheduledTime) setScheduledTime(data.scheduledTime);
        if (data.effectiveTime) setEffectiveTime(data.effectiveTime);
        setTodayCustomTime(data.todayCustomTime || null);
        if (typeof data.sonosRoutineEnabled === "boolean") {
          setSonosRoutineEnabled(data.sonosRoutineEnabled);
        }
      }
    } catch (e) {
      console.error("Error fetching closedown config:", e);
    }
  };


  // Get local YYYY-MM-DD date string
  const getLocalDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const currentDateStr = getLocalDateString();
  const currentHour = currentTime.getHours();

  // Helper to check if current time is within active focus window
  const isTimeInFocusWindow = (timeStr: string, date: Date) => {
    const [h, m] = (timeStr || "20:00").split(":").map(Number);
    const targetMins = (isNaN(h) ? 20 : h) * 60 + (isNaN(m) ? 0 : m);
    const nowMins = date.getHours() * 60 + date.getMinutes();
    return nowMins >= targetMins || nowMins < 5 * 60;
  };

  const isCloseDownFocus = isTimeInFocusWindow(effectiveTime, currentTime);

  useEffect(() => {
    if (onFocusChange) {
      onFocusChange(isCloseDownFocus);
    }
  }, [isCloseDownFocus]);

  // Keep track of current time for live indicators
  useEffect(() => {
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // refresh every minute
    return () => clearInterval(timeInterval);
  }, []);

  // Fetch checklist data
  const fetchChecklist = async (silentModeFetch = false) => {
    try {
      if (!silentModeFetch) setLoading(true);
      const res = await fetch(`/api/closedown?date=${currentDateStr}&hour=${currentHour}`);
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }
      const data = await res.json();
      if (data) {
        if (data.tasks) setTasks(data.tasks);
        if (data.silent !== undefined) setSilent(data.silent);
        if (data.effectiveTime) setEffectiveTime(data.effectiveTime);
        if (data.scheduledTime) setScheduledTime(data.scheduledTime);
        setTodayCustomTime(data.todayCustomTime || null);
        setError(null);
      }
      setLastSynced(new Date().toLocaleTimeString([], { hour12: false }));
    } catch (err: any) {
      console.error("Error fetching close down checklist:", err);
      setError("Failed to sync close down checklist");
    } finally {
      if (!silentModeFetch) setLoading(false);
    }
  };

  // Initial load and periodic polling (every 5 seconds for real-time central sync)
  useEffect(() => {
    fetchChecklist();
    fetchConfig();
    const pollInterval = setInterval(() => {
      fetchChecklist(true); // silent fetch for background polling
      fetchConfig();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [currentHour, currentDateStr]);


  // Toggle checklist task status
  const handleToggleTask = async (taskId: string, currentStatus: boolean) => {
    try {
      // Optimistic update
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, done: !currentStatus } : t));

      const res = await fetch("/api/closedown/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: currentDateStr,
          taskId,
          done: !currentStatus,
          hour: currentHour
        })
      });

      if (!res.ok) throw new Error("Failed to save checkbox change");
      const data = await res.json();
      if (data && data.tasks) {
        setTasks(data.tasks);
      }
      setLastSynced(new Date().toLocaleTimeString([], { hour12: false }));
    } catch (err: any) {
      console.error("Error toggling task:", err);
      // Revert on error
      fetchChecklist();
    }
  };

  // Trigger reshuffle
  const handleReshuffle = async () => {
    if (!window.confirm("Are you sure you want to reshuffle tonight's family chores?")) {
      return;
    }
    try {
      setLoading(true);
      const res = await fetch("/api/closedown/reshuffle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          date: currentDateStr,
          hour: currentHour
        })
      });
      if (!res.ok) throw new Error("Failed to reshuffle assignments");
      const data = await res.json();
      if (data && data.tasks) {
        setTasks(data.tasks);
      }
      setLastSynced(new Date().toLocaleTimeString([], { hour12: false }));
    } catch (err: any) {
      console.error("Error reshuffling:", err);
      setError("Reshuffle failed");
    } finally {
      setLoading(false);
    }
  };

  // Toggle silent mode
  const handleToggleSilent = async (checked: boolean) => {
    try {
      setSilent(checked);
      const res = await fetch("/api/closedown/silent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: currentDateStr,
          silent: checked,
          hour: currentHour
        })
      });
      if (!res.ok) throw new Error("Failed to save silent status");
      const data = await res.json();
      if (data && data.silent !== undefined) {
        setSilent(data.silent);
      }
    } catch (err: any) {
      console.error("Error toggling silent mode:", err);
      fetchChecklist();
    }
  };

  // Get matching icon for each task category / ID
  const getTaskIcon = (id: string) => {
    switch (id) {
      case "bags":
        return <Briefcase className="w-5 h-5 text-indigo-500" />;
      case "clothes":
        return <Sparkles className="w-5 h-5 text-pink-500" />;
      case "kitchen":
        return <Utensils className="w-5 h-5 text-amber-500" />;
      case "family_room":
        return <Tv className="w-5 h-5 text-blue-500" />;
      case "bathroom":
        return <Bath className="w-5 h-5 text-teal-500" />;
      case "alex_room":
        return <Home className="w-5 h-5 text-orange-500" />;
      case "el_room":
        return <Home className="w-5 h-5 text-rose-500" />;
      case "parents_room":
        return <Home className="w-5 h-5 text-purple-500" />;
      default:
        return <CheckCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  // Style helper for person tags
  const renderMemberBadge = (name: string) => {
    const member = familyMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
    const colorKey = member?.color || 'blue';
    const colors = MEMBER_COLOR_CLASSES[colorKey] || "bg-gray-100 text-gray-700 border-gray-200";

    return (
      <span 
        key={name} 
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black border ${colors}`}
      >
        <User className="w-2.5 h-2.5" />
        {name}
      </span>
    );
  };

  const completedCount = tasks.filter(t => t.done).length;
  const totalCount = tasks.length;
  const percentComplete = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 p-6 overflow-y-auto" id="daily-close-down-panel">
      {/* Progress Bar Header with integrated Live Sync Controls */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        {/* Sync Controls (First child for CSS selector targeting) */}
        <div className="flex items-center gap-2.5 md:order-last shrink-0" style={{ height: "32px" }}>
          {/* Scheduled / Effective Time Indicator */}
          <div 
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-2.5 py-1.5 bg-gray-50 text-[11px] font-extrabold text-gray-700 select-none"
            title={`Routine time: ${effectiveTime}${todayCustomTime ? ' (Custom override for today)' : ' (Overall daily schedule)'}`}
          >
            <Clock className="w-3.5 h-3.5 text-indigo-600" />
            <span>{effectiveTime}</span>
            {todayCustomTime ? (
              <span className="text-[9px] px-1 bg-amber-100 text-amber-800 border border-amber-200 rounded font-black">
                Today
              </span>
            ) : (
              <span className="text-[9px] text-gray-400 font-bold uppercase">
                Daily
              </span>
            )}
          </div>

          {/* Silent Sonos Checkbox */}
          <label 
            className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-all duration-200 ${
              sonosRoutineEnabled
                ? "cursor-pointer text-[11px] font-extrabold text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100"
                : "cursor-not-allowed text-[11px] font-bold text-gray-400 border border-gray-200/70 bg-gray-100/80 opacity-50 select-none"
            }`} 
            title={sonosRoutineEnabled ? "Check to silence Sonos automation tonight" : "Sonos routine is turned off in Settings"}
          >
            <input 
              type="checkbox" 
              checked={silent && sonosRoutineEnabled} 
              disabled={!sonosRoutineEnabled}
              onChange={(e) => {
                if (!sonosRoutineEnabled) return;
                handleToggleSilent(e.target.checked);
              }}
              className={`rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 accent-indigo-600 ${
                sonosRoutineEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-40"
              }`}
              id="chk-silent-sonos"
            />
            <span className="whitespace-nowrap flex items-center gap-1">
              <VolumeX className={`w-3.5 h-3.5 ${sonosRoutineEnabled ? "text-rose-500" : "text-gray-400"}`} />
              {sonosRoutineEnabled ? "Silent Sonos" : "Sonos Off"}
            </span>
          </label>

          <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">
            Live Synced: {lastSynced}
          </span>
          <button
            onClick={() => fetchChecklist()}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-800 shadow-sm cursor-pointer transition-all duration-200"
            title="Manual Sync Status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleReshuffle}
            disabled={loading}
            className="p-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-600 shadow-sm cursor-pointer transition-all duration-200 flex items-center gap-1.5 text-xs font-black"
            title="Reshuffle Daily Assignments"
          >
            <Shuffle className="w-3.5 h-3.5" />
            Reshuffle
          </button>
        </div>

        {/* Progress Info */}
        <div className="flex-1 w-full md:order-first">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-black uppercase text-gray-400">Night Checklist Progress</span>
            <span className="text-xs font-black text-indigo-600">{percentComplete}% Done ({completedCount}/{totalCount})</span>
          </div>
          <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${percentComplete}%` }}
              transition={{ duration: 0.4 }}
              className="h-full bg-indigo-500 rounded-full"
            />
          </div>
        </div>
      </div>

      {/* Task Error Notice */}
      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tasks Grid */}
      <div className="grid grid-cols-[repeat(auto-fill,190px)] gap-3 flex-1 justify-center sm:justify-start">
        {tasks.map((task) => {
          return (
            <motion.div
              key={task.id}
              layoutId={`task-${task.id}`}
              className={`border rounded-xl p-3 transition-all duration-200 flex items-start gap-2.5 bg-white w-[190px] h-[90px] shrink-0 ${
                task.done 
                  ? "border-emerald-200 bg-emerald-50/10 opacity-75" 
                  : "border-gray-200 hover:border-indigo-200 hover:shadow-sm"
              }`}
            >
              {/* Custom Checkbox on the Left */}
              <button
                onClick={() => handleToggleTask(task.id, task.done)}
                className="mt-0.5 focus:outline-none cursor-pointer shrink-0"
                id={`btn-toggle-task-${task.id}`}
              >
                {task.done ? (
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-300 hover:text-indigo-400 transition-colors" />
                )}
              </button>

              {/* Task Title & Assignments */}
              <div className="flex-1 flex flex-col justify-between h-full min-w-0">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    {getTaskIcon(task.id)}
                    <span className={`font-black text-xs text-gray-900 leading-tight min-w-0 break-words ${task.done ? "line-through text-gray-400" : ""}`}>
                      {task.name}
                    </span>
                  </div>
                </div>

                {/* Assigned People Badges */}
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {task.assignedAdults.map(name => renderMemberBadge(name))}
                  {task.assignedChildren.map(name => renderMemberBadge(name))}
                  {task.assignedAdults.length === 0 && task.assignedChildren.length === 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black border bg-indigo-50 text-indigo-700 border-indigo-100">
                      <Users className="w-2.5 h-2.5 text-indigo-500" />
                      Everyone
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
