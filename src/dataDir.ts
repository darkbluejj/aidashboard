import "dotenv/config"; // ensure DATA_DIR from .env is loaded before any module-level path is built
import fs from "fs";
import path from "path";

// Persistent data dir (a mounted volume in Docker). Falls back to cwd so the Pi 1B deploy is unchanged.
export const DATA_DIR = process.env.DATA_DIR || process.cwd();

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error("Could not create DATA_DIR:", err);
}

export const dataPath = (file: string) => path.join(DATA_DIR, file);
