import React, { useState, useEffect } from "react";
import { Coins, RotateCcw, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface FamilyMember {
  id: string;
  name: string;
  role: "adult" | "child";
  color?: string;
}

interface SwearJarProps {
  embedded?: boolean;
}

export default function SwearJar({ embedded = false }: SwearJarProps) {
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [coinCost, setCoinCost] = useState<number>(10);
  const [animatingCoin, setAnimatingCoin] = useState<{ memberId: string; key: number } | null>(null);
  const [isLidPopped, setIsLidPopped] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch family members and swear jar balances
  const fetchData = async () => {
    try {
      const [configRes, jarRes] = await Promise.all([
        fetch("/api/closedown/config"),
        fetch("/api/swearjar")
      ]);
      if (configRes.ok) {
        const configData = await configRes.json();
        const combined = [...(configData.adults || []), ...(configData.children || [])];
        setFamilyMembers(combined);
        if (typeof configData.coinCost === "number") {
          setCoinCost(configData.coinCost);
        }
      }
      if (jarRes.ok) {
        const jarData = await jarRes.json();
        setBalances(jarData.balances || {});
      }
    } catch (e) {
      console.error("Failed to load swear jar data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCoinDrop = async (memberId: string) => {
    setIsLidPopped(true);
    setAnimatingCoin({ memberId, key: Date.now() });

    setTimeout(() => {
      setIsLidPopped(false);
    }, 600);

    try {
      const res = await fetch("/api/swearjar/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, amount: coinCost })
      });
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || {});
      }
    } catch (e) {
      console.error("Failed to add coin to swear jar:", e);
    }
  };

  const handleReset = async (memberId?: string) => {
    try {
      const res = await fetch("/api/swearjar/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: memberId || null })
      });
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || {});
      }
    } catch (e) {
      console.error("Failed to reset swear jar:", e);
    }
  };

  const totalPence = Object.values(balances).reduce((acc: number, curr: any) => acc + (typeof curr === "number" ? curr : Number(curr) || 0), 0);
  const totalPounds = (Number(totalPence) / 100).toFixed(2);

  const getLayerColorBg = (color?: string) => {
    switch (color) {
      case "blue": return "bg-blue-500/85 border-blue-400";
      case "rose": return "bg-rose-400/85 border-rose-300";
      case "amber": return "bg-amber-400/85 border-amber-300";
      case "cyan": return "bg-cyan-500/85 border-cyan-400";
      case "emerald": return "bg-emerald-500/85 border-emerald-400";
      default: return "bg-indigo-500/85 border-indigo-400";
    }
  };

  const getDotColor = (color?: string) => {
    switch (color) {
      case "blue": return "bg-blue-600";
      case "rose": return "bg-rose-500";
      case "amber": return "bg-amber-500";
      case "cyan": return "bg-cyan-600";
      case "emerald": return "bg-emerald-600";
      default: return "bg-indigo-600";
    }
  };

  // Split family members into left and right groups
  const midIndex = Math.ceil(familyMembers.length / 2);
  const leftMembers = familyMembers.slice(0, midIndex);
  const rightMembers = familyMembers.slice(midIndex);

  const coinDisplayLabel = coinCost >= 100 ? `£${coinCost / 100}` : `${coinCost}p`;

  return (
    <div className={`w-full ${embedded ? "" : "max-w-4xl mx-auto p-4 sm:p-6"}`}>
      <div className="bg-gradient-to-br from-amber-50/60 via-white to-orange-50/40 border border-amber-200/80 rounded-3xl p-5 sm:p-8 shadow-sm space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-amber-100">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/20 flex items-center justify-center">
              <Coins className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                Family Swear Jar 🫙
                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-900 rounded-full font-extrabold">
                  £{totalPounds} Total Pot
                </span>
              </h3>
              <p className="text-xs text-gray-500">
                Click a {coinDisplayLabel} coin button on either side whenever a swear word slips!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleReset()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-amber-50 text-gray-600 hover:text-amber-900 border border-amber-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
              title="Reset all fines"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
              <span>Empty Jar</span>
            </button>
          </div>
        </div>

        {/* Main Layout: Left Coin Buttons | Center Jar | Right Coin Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          
          {/* Left Side Coin Buttons */}
          <div className="md:col-span-3 flex flex-col gap-3 justify-center">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 text-center md:text-left px-1">
              Household
            </span>
            {leftMembers.map((member) => {
              const pence = balances[member.id] || 0;
              const pounds = (pence / 100).toFixed(2);
              return (
                <div
                  key={member.id}
                  className="bg-white border border-gray-200/90 rounded-2xl p-2.5 flex items-center justify-between gap-2 shadow-2xs hover:border-amber-300 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-black text-gray-800 block truncate">
                      {member.name}
                    </span>
                    <span className="text-[11px] font-extrabold text-amber-700">
                      £{pounds}
                    </span>
                  </div>

                  {/* Coin Button (No dot in middle) */}
                  <button
                    type="button"
                    onClick={() => handleCoinDrop(member.id)}
                    className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-200 via-slate-100 to-amber-400 border-2 border-amber-500 shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center cursor-pointer select-none shrink-0"
                    title={`Add ${coinDisplayLabel} for ${member.name}`}
                  >
                    <span className="text-[9px] font-black text-amber-950 tracking-tighter uppercase leading-none">
                      {coinDisplayLabel}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Center: The Jar Visual with Stacked Liquid Layers */}
          <div className="md:col-span-6 flex flex-col items-center justify-center relative py-2">
            <div className="relative w-52 sm:w-60 h-72 sm:h-80 flex flex-col items-center select-none">
              
              {/* Lid */}
              <motion.div
                animate={isLidPopped ? { y: -35, rotate: -12, scale: 1.05 } : { y: 0, rotate: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="w-36 h-10 bg-gradient-to-r from-amber-700 via-amber-600 to-amber-800 rounded-t-2xl shadow-md border-2 border-amber-900 z-20 flex items-center justify-center cursor-pointer relative"
              >
                <div className="w-12 h-2 bg-amber-950/40 rounded-full" />
                {isLidPopped && (
                  <span className="absolute -top-6 text-[10px] font-black text-amber-800 bg-amber-200 px-2 py-0.5 rounded-full shadow-xs animate-bounce">
                    Pop! 🪙
                  </span>
                )}
              </motion.div>

              {/* Jar Neck */}
              <div className="w-32 h-6 bg-amber-50/40 backdrop-blur-md border-x-4 border-amber-200/80 z-10 -mt-1" />

              {/* Jar Body (Stacked Liquid Layers) */}
              <div className="relative w-full flex-1 bg-white/70 backdrop-blur-sm border-4 border-amber-200/90 rounded-b-3xl rounded-t-xl shadow-inner overflow-hidden flex flex-col justify-end z-10">
                
                {/* Glass reflection highlight */}
                <div className="absolute top-3 left-3 w-3 h-36 bg-white/60 rounded-full blur-[1px] pointer-events-none z-30" />

                {totalPence === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-amber-800/40 italic px-4 text-center">
                    Jar is empty! Click a {coinDisplayLabel} coin to fill.
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col-reverse justify-end w-full h-full">
                    {familyMembers.map((member) => {
                      const pence = Number(balances[member.id]) || 0;
                      const tp = Number(totalPence) || 1;
                      if (pence <= 0) return null;
                      const percentage = Math.round((pence / tp) * 100);
                      const heightPercent = (pence / tp) * 100;

                      return (
                        <motion.div
                          key={`layer-${member.id}`}
                          initial={{ height: 0 }}
                          animate={{ height: `${heightPercent}%` }}
                          transition={{ duration: 0.4, ease: "easeOut" }}
                          className={`w-full relative flex items-center justify-center border-t border-white/40 ${getLayerColorBg(member.color)} overflow-hidden`}
                          style={{ minHeight: '28px' }}
                        >
                          {/* Floating Pill Badge inside layer */}
                          <div className="bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-full shadow-xs text-[10px] font-black text-gray-800 flex items-center gap-1.5 shrink-0 z-20 border border-white/60">
                            <span className={`w-2 h-2 rounded-full ${getDotColor(member.color)}`} />
                            <span>{member.name}</span>
                            <span className="text-gray-500 font-bold">({percentage}%)</span>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Flying Coin Animation */}
              <AnimatePresence>
                {animatingCoin && (
                  <motion.div
                    key={animatingCoin.key}
                    initial={{ opacity: 1, scale: 0.5, y: 80, x: 0 }}
                    animate={{
                      opacity: [1, 1, 0],
                      scale: [0.8, 1.2, 0.9],
                      y: [-20, -120, -40],
                      x: [0, (Math.random() - 0.5) * 40, 0],
                      rotate: [0, 360, 720]
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.55, ease: "easeOut" }}
                    className="absolute top-12 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 via-yellow-200 to-amber-500 border-2 border-amber-600 shadow-lg flex items-center justify-center text-[9px] font-black text-amber-950 z-40 pointer-events-none"
                  >
                    {coinDisplayLabel}
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          </div>

          {/* Right Side Coin Buttons */}
          <div className="md:col-span-3 flex flex-col gap-3 justify-center">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 text-center md:text-right px-1">
              Household
            </span>
            {rightMembers.map((member) => {
              const pence = balances[member.id] || 0;
              const pounds = (pence / 100).toFixed(2);
              return (
                <div
                  key={member.id}
                  className="bg-white border border-gray-200/90 rounded-2xl p-2.5 flex items-center justify-between gap-2 shadow-2xs hover:border-amber-300 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-black text-gray-800 block truncate">
                      {member.name}
                    </span>
                    <span className="text-[11px] font-extrabold text-amber-700">
                      £{pounds}
                    </span>
                  </div>

                  {/* Coin Button (No dot in middle) */}
                  <button
                    type="button"
                    onClick={() => handleCoinDrop(member.id)}
                    className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-200 via-slate-100 to-amber-400 border-2 border-amber-500 shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center cursor-pointer select-none shrink-0"
                    title={`Add ${coinDisplayLabel} for ${member.name}`}
                  >
                    <span className="text-[9px] font-black text-amber-950 tracking-tighter uppercase leading-none">
                      {coinDisplayLabel}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

        </div>

      </div>
    </div>
  );
}
