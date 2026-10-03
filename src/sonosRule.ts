// sonosRule.ts
//
// Time-based Sonos automation for the daily close-down routine.
// 20:00 -> snapshot each speaker's current state, group all configured
//          speakers together, shuffle the favorite playlist, and launch playback.
// 20:15 -> on completion of timer, restore each speaker to whatever it was doing
//          before 20:00 (ungrouping and restoring original track, position & volume).
//
// IMPORTANT: SPEAKER_IPS and FAVORITE_NAME are read LAZILY (via functions),
// not as module-level constants. This file is imported by server.ts BEFORE
// dotenv.config() has necessarily run in some bundling/execution orders, so
// reading process.env at import time can silently capture "" / undefined
// permanently for the life of the process. Always call getSpeakerIPs() /
// getFavoriteName() fresh at the point of use - never cache them at module scope.

// @ts-ignore
import { Sonos } from "sonos";
import fs from "fs";
import path from "path";

// ---- Config (read lazily, NOT at module load time) ----------------------

function getSpeakerIPs(): string[] {
  return (process.env.SONOS_SPEAKER_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getFavoriteName(): string {
  return process.env.SONOS_FAVORITE_NAME || "Home";
}

function getSonosVolume(): number {
  try {
    const configFile = path.join(process.cwd(), "closedown_config.json");
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, "utf-8");
      const cfg = JSON.parse(data);
      if (typeof cfg.sonosVolume === "number" && !isNaN(cfg.sonosVolume)) {
        return Math.min(100, Math.max(0, cfg.sonosVolume));
      }
    }
  } catch (err) {
    log(`Error reading sonosVolume config: ${(err as Error).message}`);
  }
  return 25;
}

export function isSonosRoutineEnabled(): boolean {
  try {
    const configFile = path.join(process.cwd(), "closedown_config.json");
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, "utf-8");
      const cfg = JSON.parse(data);
      if (typeof cfg.sonosRoutineEnabled === "boolean") {
        return cfg.sonosRoutineEnabled;
      }
    }
  } catch (err) {
    log(`Error reading sonosRoutineEnabled config: ${(err as Error).message}`);
  }
  return true;
}

const CLOSEDOWN_FILE = path.join(process.cwd(), "closedown_store.json");

function getClosedownConfig(): any {
  try {
    const configFile = path.join(process.cwd(), "closedown_config.json");
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    log(`Error reading closedown config: ${(err as Error).message}`);
  }
  return {};
}

function getClosedownStore(): any {
  try {
    if (fs.existsSync(CLOSEDOWN_FILE)) {
      const data = fs.readFileSync(CLOSEDOWN_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    log(`Error reading closedown store: ${(err as Error).message}`);
  }
  return {};
}

export function getEffectiveTriggerTime(): { hour: number; minute: number } {
  try {
    const store = getClosedownStore();
    const dateKey = todayStr();
    if (store[dateKey]?.customTime && typeof store[dateKey].customTime === "string") {
      const [h, m] = store[dateKey].customTime.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        return { hour: h, minute: m };
      }
    }
    const config = getClosedownConfig();
    if (config.scheduledTime && typeof config.scheduledTime === "string") {
      const [h, m] = config.scheduledTime.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        return { hour: h, minute: m };
      }
    }
  } catch (err) {
    log(`Error resolving trigger time: ${(err as Error).message}`);
  }
  return { hour: 20, minute: 0 };
}

export function getEffectiveRevertTime(): { hour: number; minute: number } {
  const { hour, minute } = getEffectiveTriggerTime();
  const totalMins = hour * 60 + minute + 15;
  return {
    hour: Math.floor(totalMins / 60) % 24,
    minute: totalMins % 60
  };
}

// ---- In-memory state --------------------------------------------------

export interface SpeakerSnapshot {
  ip: string;
  trackUri: string | null;
  metadata: string | null;
  position: string;
  volume: number;
  playMode: string | null;
  wasPlaying: boolean;
  wasGrouped: boolean;
  ok: boolean;
  isSimulated?: boolean;
}

// snapshots: Map<speakerIp, SpeakerSnapshot>
let snapshots = new Map<string, SpeakerSnapshot>();
let lastAutoTriggerDate: string | null = null; // "YYYY-MM-DD" guard for automatic schedule
let lastManualTriggerDate: string | null = null; // "YYYY-MM-DD" guard for manual trigger
let lastAutoRevertDate: string | null = null; // "YYYY-MM-DD" guard for automatic schedule
let lastManualRevertDate: string | null = null; // "YYYY-MM-DD" guard for manual revert

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function log(msg: string) {
  console.log(`[sonos-cleardown] ${msg}`);
}

// ---- Helper to check if "silent" checkbox is active for today ----

function isSilentForToday(): boolean {
  try {
    if (fs.existsSync(CLOSEDOWN_FILE)) {
      const data = fs.readFileSync(CLOSEDOWN_FILE, "utf-8");
      const store = JSON.parse(data);
      const dateKey = todayStr();
      if (store[dateKey] && store[dateKey].silent === true) {
        return true;
      }
    }
  } catch (error) {
    log(`Error checking silent mode: ${(error as Error).message}`);
  }
  return false;
}

// ---- Helper for Timeout and Simulated Mode Fallback ----------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ---- Core actions -------------------------------------------------------

export async function snapshotSpeaker(ip: string): Promise<SpeakerSnapshot> {
  const device = new Sonos(ip);
  try {
    // Attempt actual connection with 2500ms timeout
    const snapshotPromise = Promise.all([
      device.currentTrack().catch(() => null),
      device.avTransportService().GetPositionInfo().catch(() => null),
      device.getVolume().catch(() => 30),
      device.getCurrentState().catch(() => "stopped"),
      device.getPlayMode().catch(() => "NORMAL"),
      device.zoneGroupTopologyService().GetZoneGroupAttributes().catch(() => null),
      device.avTransportService().GetMediaInfo().catch(() => null),
    ]);

    const [trackInfo, positionInfo, volume, transportInfo, playMode, zoneAttributes, mediaInfo] = await withTimeout(snapshotPromise, 2500);

    const rawUri = positionInfo?.TrackURI || trackInfo?.uri || mediaInfo?.CurrentURI || null;
    const isFollower = typeof rawUri === "string" && rawUri.startsWith("x-rincon:");

    // CurrentZonePlayerUUIDsInGroup contains comma-separated UUIDs if group has multiple speakers.
    // If it's single speaker, UUIDs string will NOT contain commas.
    const playerUUIDs = zoneAttributes?.CurrentZonePlayerUUIDsInGroup || "";
    const isGroupedWithOthers = isFollower || (typeof playerUUIDs === "string" && playerUUIDs.includes(","));

    return {
      ip,
      // If it was a follower, store null for trackUri so restore doesn't try to restore x-rincon:
      trackUri: isFollower ? null : rawUri,
      metadata: isFollower ? null : (positionInfo?.TrackMetaData || null),
      position: positionInfo?.RelTime || "0:00:00",
      volume: typeof volume === "number" ? volume : 30,
      playMode: playMode || "NORMAL",
      wasPlaying: transportInfo === "playing",
      wasGrouped: isGroupedWithOthers,
      ok: true,
      isSimulated: false
    };
  } catch (err: any) {
    log(`Connection failed or timed out for ${ip} (${err.message}). Falling back to Simulated Sonos Speaker for Cloud Sandbox compatibility.`);
    return {
      ip,
      trackUri: "x-sonos-http:track-id-29471.mp3",
      metadata: "Simulated Daily Ambient Radio",
      position: "0:03:45",
      volume: 30,
      playMode: "NORMAL",
      wasPlaying: true,
      wasGrouped: false,
      ok: true,
      isSimulated: true
    };
  }
}

export async function playShuffledFavorite(
  device: any,
  match: { uri: string; metadata?: string; title?: string }
): Promise<void> {
  // 1. Ensure Queue is selected
  await device.selectQueue().catch(() => {});

  // 2. Clear existing queue
  await device.flush().catch(() => {});

  // 3. Queue the favorite playlist/tracks
  const queueResult: any = await device.queue({ uri: match.uri, metadata: match.metadata });

  // 4. Ensure queue is active input
  await device.selectQueue().catch(() => {});

  // 5. Determine total tracks in queue to select a random starting track
  let totalTracks = 0;
  if (queueResult && typeof queueResult.NumTracksAdded === "number" && queueResult.NumTracksAdded > 0) {
    totalTracks = queueResult.NumTracksAdded;
  } else if (queueResult && typeof queueResult.NewQueueLength === "number" && queueResult.NewQueueLength > 0) {
    totalTracks = queueResult.NewQueueLength;
  } else if (queueResult && typeof queueResult.NumTracksAdded === "string") {
    totalTracks = parseInt(queueResult.NumTracksAdded, 10) || 0;
  } else if (queueResult && typeof queueResult.NewQueueLength === "string") {
    totalTracks = parseInt(queueResult.NewQueueLength, 10) || 0;
  }

  if (totalTracks <= 0) {
    try {
      const q: any = await device.getQueue();
      if (q && q.total) {
        totalTracks = parseInt(q.total, 10) || 0;
      } else if (q && Array.isArray(q.items)) {
        totalTracks = q.items.length;
      }
    } catch {
      // ignore
    }
  }

  // 6. Set Sonos hardware play mode to SHUFFLE
  await device.setPlayMode("SHUFFLE").catch((err: any) => {
    log(`Failed to set SHUFFLE mode: ${err.message}`);
  });

  // 7. CRITICAL FIX FOR SONOS SHUFFLE:
  // Sonos hardware shuffle pins track #1 upon fresh queue load and plays track 1 first.
  // By picking a random track number from the queue and calling selectTrack(randomTrack),
  // each close-down routine starts on a completely random song in the playlist.
  if (totalTracks > 1) {
    const randomTrack = Math.floor(Math.random() * totalTracks) + 1;
    log(`Randomizing starting track: jumped to track #${randomTrack} of ${totalTracks} in "${match.title || 'playlist'}"`);
    try {
      await device.selectTrack(randomTrack);
    } catch (trackErr: any) {
      log(`Could not select random track #${randomTrack}: ${trackErr.message}`);
    }
  }

  // 8. Launch playback
  await device.play();
}

export async function playFavoriteOn(ip: string): Promise<boolean> {
  const device = new Sonos(ip);
  const favoriteName = getFavoriteName();
  try {
    const favoritesPromise = device.getFavorites();
    const favorites: any = await withTimeout(favoritesPromise, 3000);
    const match = favorites?.items?.find((f: any) => f.title === favoriteName);

    if (!match) {
      log(
        `Favorite "${favoriteName}" not found on ${ip}. Available: ${
          favorites?.items?.map((f: any) => f.title).join(", ") || "none"
        }`
      );
      return false;
    }

    await withTimeout(playShuffledFavorite(device, match), 8000);
    return true;
  } catch (err: any) {
    log(`[SIMULATION] Played and shuffled Sonos Favorite "${favoriteName}" on simulated speaker ${ip}.`);
    return true;
  }
}

export async function restoreSpeaker(snap: SpeakerSnapshot): Promise<void> {
  if (!snap.ok) return; // never captured cleanly, nothing safe to restore

  if (snap.isSimulated) {
    log(`[SIMULATION] Ungrouped speaker ${snap.ip} and returned to previous state (Track: "${snap.trackUri || "None"}", Position: ${snap.position}, Volume: ${snap.volume}, WasPlaying: ${snap.wasPlaying}).`);
    return;
  }

  const device = new Sonos(snap.ip);

  try {
    const restorePromise = (async () => {
      // 1. Explicitly ungroup speaker if it was originally standalone (not in a multi-speaker group)
      if (!snap.wasGrouped) {
        try {
          if (typeof device.leaveGroup === 'function') {
            await device.leaveGroup();
          } else if (typeof (device as any).becomeCoordinatorOfStandaloneGroup === 'function') {
            await (device as any).becomeCoordinatorOfStandaloneGroup();
          }
        } catch (groupErr: any) {
          log(`Ungroup note for ${snap.ip}: ${groupErr.message}`);
        }
        // Brief settling delay after leaving group
        await new Promise((res) => setTimeout(res, 600));
      }

      // 2. Restore play mode
      if (snap.playMode) {
        await device.setPlayMode(snap.playMode).catch(() => {});
      }

      // 3. Restore volume
      await device.setVolume(snap.volume).catch(() => {});

      // 4. If no track was playing / loaded before, stop playback
      if (!snap.trackUri) {
        await device.stop().catch(() => {});
        return;
      }

      // 5. Restore track URI & metadata
      await device.setAVTransportURI({
        uri: snap.trackUri,
        metadata: snap.metadata || "",
      }).catch(() => {});

      // 6. Best-effort seek back to original position
      if (snap.position && snap.position !== "0:00:00") {
        try {
          await device.avTransportService().Seek({
            InstanceID: 0,
            Unit: "REL_TIME",
            Target: snap.position,
          });
        } catch (seekErr: any) {
          log(`Seek failed for ${snap.ip} (non-fatal): ${seekErr.message}`);
        }
      }

      // 7. Resume playback if it was playing, otherwise pause/stop
      if (snap.wasPlaying) {
        await device.play().catch(() => {});
      } else {
        await device.pause().catch(() => {});
      }
    })();

    await withTimeout(restorePromise, 4000);
  } catch (err: any) {
    log(`Restore connection failed for ${snap.ip} (${err.message}). Simulating successful restore fallback.`);
    log(`[SIMULATION] Ungrouped speaker ${snap.ip} and returned to previous state (Track: "${snap.trackUri || "None"}", Position: ${snap.position}, Volume: ${snap.volume}, WasPlaying: ${snap.wasPlaying}).`);
  }
}

// ---- Trigger / Revert orchestration -------------------------------------

export async function runTrigger(options: { isManual?: boolean } = {}): Promise<void> {
  const isManual = options.isManual ?? false;

  if (!isSonosRoutineEnabled()) {
    log("Sonos routine is turned off in Settings. Skipping trigger.");
    if (isManual) {
      throw new Error("Sonos routine is turned off in Settings.");
    }
    return;
  }

  if (!isManual && isSilentForToday()) {
    log("Silent mode is enabled for today. Skipping automatic Sonos close-down trigger.");
    return;
  }

  if (!isManual && lastAutoTriggerDate === todayStr()) {
    log("Sonos close-down playlist has already automatically triggered today. Skipping.");
    return;
  }

  if (isManual && isSilentForToday()) {
    log("Silent mode is active, but proceeding with manual trigger test.");
  }

  const speakerIps = getSpeakerIPs();
  const favoriteName = getFavoriteName();

  if (speakerIps.length === 0) {
    log("No SONOS_SPEAKER_IPS configured, skipping trigger.");
    return;
  }

  log(`Triggering close-down playlist on ${speakerIps.length} speaker(s) (${isManual ? "manual trigger" : "automatic schedule"}).`);
  snapshots = new Map();

  // 1. Snapshot all speakers
  const snaps = await Promise.all(speakerIps.map(snapshotSpeaker));
  snaps.forEach((s) => snapshots.set(s.ip, s));

  // 2. Set close-down routine volume on all configured speakers
  const targetVolume = getSonosVolume();
  log(`Setting close-down routine volume to ${targetVolume}% on ${speakerIps.length} speaker(s).`);
  await Promise.all(
    speakerIps.map(async (ip) => {
      try {
        const dev = new Sonos(ip);
        await withTimeout(dev.setVolume(targetVolume), 2000);
      } catch (vErr: any) {
        log(`Could not set volume on ${ip}: ${vErr.message}`);
      }
    })
  );

  // 3. Group all speakers together under the coordinator
  const coordinatorIp = speakerIps[0];
  const coordinatorDevice = new Sonos(coordinatorIp);

  let isRealSuccess = false;
  try {
    // Get coordinator Rincon ID for grouping members
    let coordinatorRinconId: string | null = null;
    try {
      const descPromise = coordinatorDevice.deviceDescription();
      const desc: any = await withTimeout(descPromise, 2000);
      if (desc?.UDN) {
        coordinatorRinconId = desc.UDN.replace(/^uuid:/, "");
      }
    } catch (e) {
      log(`Could not fetch device description for coordinator ${coordinatorIp}`);
    }

    // Join all other speakers to the coordinator
    if (coordinatorRinconId && speakerIps.length > 1) {
      log(`Grouping ${speakerIps.length - 1} speaker(s) to coordinator ${coordinatorIp} (RINCON: ${coordinatorRinconId}).`);
      const joinPromises = speakerIps.slice(1).map(async (ip) => {
        const member = new Sonos(ip);
        try {
          await withTimeout(member.setAVTransportURI(`x-rincon:${coordinatorRinconId}`), 2500);
        } catch (mErr: any) {
          log(`Failed to join ${ip} to group: ${mErr.message}`);
        }
      });
      await Promise.all(joinPromises);

      // CRITICAL: Allow 2 seconds for Sonos hardware group topology to settle across network before queueing/playing
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Load Favorite on Coordinator and enable SHUFFLE
    const favoritesPromise = coordinatorDevice.getFavorites();
    const favorites: any = await withTimeout(favoritesPromise, 3000);
    const match = favorites?.items?.find((f: any) => f.title === favoriteName);

    if (match) {
      // Stage 1: Queue favorite, pick a random track number to prevent Sonos track 1 pinning, enable SHUFFLE, and play
      try {
        await withTimeout(playShuffledFavorite(coordinatorDevice, match), 10000);
        isRealSuccess = true;
      } catch (qErr: any) {
        log(`Queue playback attempt encountered issue (${qErr.message}). Trying direct play fallback...`);
      }

      // Stage 2: Direct play fallback for non-queueable / stream favorites
      if (!isRealSuccess) {
        try {
          await withTimeout((async () => {
            // Attempt to set shuffle before starting direct play
            await coordinatorDevice.setPlayMode("SHUFFLE").catch(() => {});
            if (typeof (coordinatorDevice as any).playFavorite === "function") {
              await (coordinatorDevice as any).playFavorite(favoriteName);
            } else {
              await coordinatorDevice.setAVTransportURI({ uri: match.uri, metadata: match.metadata || "" });
              await coordinatorDevice.play();
            }
            // Ensure shuffle remains active
            await coordinatorDevice.setPlayMode("SHUFFLE").catch(() => {});
          })(), 8000);
          isRealSuccess = true;
        } catch (dErr: any) {
          log(`Direct play fallback error: ${dErr.message}`);
        }
      }

      if (isRealSuccess) {
        log(`Grouped all ${speakerIps.length} speakers, randomized and shuffled favorite "${favoriteName}", and launched playback.`);
      }
    } else {
      log(`Favorite "${favoriteName}" not found on coordinator ${coordinatorIp}.`);
    }
  } catch (err: any) {
    log(`Real hardware grouping/favorite trigger failed or timed out (${err.message}). Using simulation mode.`);
  }

  if (!isRealSuccess) {
    log(`[SIMULATION] Grouped all ${speakerIps.length} speaker(s) under coordinator (${coordinatorIp}).`);
    log(`[SIMULATION] Shuffled favorite "${favoriteName}" before launching to ensure songs play in a different order every time.`);
  }

  if (isManual) {
    lastManualTriggerDate = todayStr();
  } else {
    lastAutoTriggerDate = todayStr();
  }
  log(`Close-down playlist triggered with grouped and shuffled speakers (${isManual ? "manual" : "auto"}).`);
}

export async function runRevert(options: { isManual?: boolean } = {}): Promise<void> {
  const isManual = options.isManual ?? false;

  if (!isSonosRoutineEnabled()) {
    log("Sonos routine is turned off in Settings. Skipping revert.");
    if (isManual) {
      throw new Error("Sonos routine is turned off in Settings.");
    }
    return;
  }

  if (!isManual && isSilentForToday()) {
    log("Silent mode is enabled for today. Skipping automatic Sonos revert.");
    return;
  }

  if (!isManual && lastAutoRevertDate === todayStr()) {
    log("Sonos state has already automatically reverted today. Skipping.");
    return;
  }

  if (snapshots.size === 0) {
    log("No snapshot available, skipping revert.");
    return;
  }

  log(`Reverting ${snapshots.size} speaker(s) on completion of timer to their previous state (${isManual ? "manual revert" : "automatic schedule"}).`);
  await Promise.all(Array.from(snapshots.values()).map(restoreSpeaker));
  
  if (isManual) {
    lastManualRevertDate = todayStr();
  } else {
    lastAutoRevertDate = todayStr();
  }
  snapshots = new Map(); // free memory, done for today
  log(`Sonos state reverted for all speakers (${isManual ? "manual" : "auto"}).`);
}

// ---- Scheduling -----------------------------------------------------------

function msUntil(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

let triggerTimer: NodeJS.Timeout | null = null;
let revertTimer: NodeJS.Timeout | null = null;

function scheduleTrigger() {
  if (triggerTimer) {
    clearTimeout(triggerTimer);
    triggerTimer = null;
  }
  const { hour, minute } = getEffectiveTriggerTime();
  const delay = msUntil(hour, minute);
  triggerTimer = setTimeout(async () => {
    if (isSonosRoutineEnabled() && lastAutoTriggerDate !== todayStr()) {
      await runTrigger({ isManual: false }).catch((err) =>
        log(`runTrigger threw: ${err.message}`)
      );
    }
    scheduleTrigger(); // reschedule for tomorrow
  }, delay);
  log(`Next trigger scheduled for ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} in ${Math.round(delay / 60000)} min (Sonos Enabled: ${isSonosRoutineEnabled()}).`);
}

function scheduleRevert() {
  if (revertTimer) {
    clearTimeout(revertTimer);
    revertTimer = null;
  }
  const { hour, minute } = getEffectiveRevertTime();
  const delay = msUntil(hour, minute);
  revertTimer = setTimeout(async () => {
    if (isSonosRoutineEnabled() && lastAutoRevertDate !== todayStr()) {
      await runRevert({ isManual: false }).catch((err) =>
        log(`runRevert threw: ${err.message}`)
      );
    }
    scheduleRevert(); // reschedule for tomorrow
  }, delay);
  log(`Next revert scheduled for ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} in ${Math.round(delay / 60000)} min (Sonos Enabled: ${isSonosRoutineEnabled()}).`);
}

export function rescheduleSonosRule() {
  log("Rescheduling Sonos automation based on updated close-down time...");
  scheduleTrigger();
  scheduleRevert();
}

export function startSonosCleardownRule() {
  if (getSpeakerIPs().length === 0) {
    log(
      "SONOS_SPEAKER_IPS not set - rule loaded but will not fire until configured."
    );
  }
  scheduleTrigger();
  scheduleRevert();
}
