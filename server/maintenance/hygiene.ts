import fs from "fs";
import path from "path";
import { db, SCREENSHOTS_DIR } from "../db/schema";
import { EMBEDDED_ASSETS } from "../embeddedAssets";

// ============================================================================
// 1. Pre-Decoded In-Memory Static Asset Cache (Zero Per-Request Base64 Decode)
// ============================================================================
interface DecodedAsset {
  bytes: Buffer;
  mime: string;
}

const decodedAssetCache = new Map<string, DecodedAsset>();

export function initStaticAssetCache(): void {
  if (decodedAssetCache.size > 0) return;
  for (const [key, entry] of Object.entries(EMBEDDED_ASSETS)) {
    decodedAssetCache.set(key, {
      bytes: Buffer.from(entry.base64, "base64"),
      mime: entry.mime,
    });
  }
}

export function getDecodedStaticAsset(pathname: string): DecodedAsset | undefined {
  if (decodedAssetCache.size === 0) initStaticAssetCache();
  const assetKey = pathname === "/" ? "/index.html" : pathname;
  return decodedAssetCache.get(assetKey) || decodedAssetCache.get("/index.html");
}

// ============================================================================
// 2. Storage & Log Auto-Pruner (Retain Latest 50 Runs & Prune Orphan PNGs)
// ============================================================================
export function pruneOldRunsAndScreenshots(maxRunsToKeep = 50): void {
  try {
    const cutoffRow = db
      .query(
        "SELECT id FROM crawl_runs WHERE status != 'running' ORDER BY id DESC LIMIT 1 OFFSET ?"
      )
      .get(maxRunsToKeep) as any;

    if (cutoffRow && Number(cutoffRow.id) > 0) {
      const cutoffId = Number(cutoffRow.id);
      db.prepare("DELETE FROM pipeline_node_logs WHERE crawl_run_id <= ?").run(cutoffId);
      db.prepare("DELETE FROM crawl_runs WHERE id <= ? AND status != 'running'").run(cutoffId);
    }

    // Prune orphan screenshots not referenced in pipeline_node_logs
    if (fs.existsSync(SCREENSHOTS_DIR)) {
      const files = fs.readdirSync(SCREENSHOTS_DIR);
      if (files.length > 40) {
        const activeRows = db
          .query(
            "SELECT DISTINCT screenshot_filename FROM pipeline_node_logs WHERE screenshot_filename IS NOT NULL"
          )
          .all() as any[];
        const activeSet = new Set(activeRows.map((r) => String(r.screenshot_filename)));
        const nowMs = Date.now();

        for (const f of files) {
          if (!f.endsWith(".png")) continue;
          if (activeSet.has(f)) continue;
          const fullPath = path.join(SCREENSHOTS_DIR, f);
          try {
            const stat = fs.statSync(fullPath);
            // Only delete unreferenced screenshots older than 10 minutes
            if (nowMs - stat.mtimeMs > 10 * 60 * 1000) {
              fs.unlinkSync(fullPath);
            }
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore pruning errors
  }
}

// ============================================================================
// 3. Idle Headless Browser Watchdog (Frees ~400MB RAM after 90s of Inactivity)
// ============================================================================
let lastChromeActivityTs = Date.now();

export function touchChromeActivity(): void {
  lastChromeActivityTs = Date.now();
}

export function startMaintenanceWatchdog(
  getActiveTabCount: () => number,
  closeIdleChrome: () => void
): void {
  // Run initial storage prune on startup
  pruneOldRunsAndScreenshots(50);

  setInterval(() => {
    try {
      const activeTabs = getActiveTabCount();
      if (activeTabs === 0 && Date.now() - lastChromeActivityTs > 90_000) {
        closeIdleChrome();
      }
    } catch {
      // ignore watchdog error
    }
  }, 30_000);
}
