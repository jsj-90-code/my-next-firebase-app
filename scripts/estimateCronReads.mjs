// Offline estimate for the current cron-sync implementation. No credentials or network.
// Run from the repository root: node scripts/estimateCronReads.mjs [snapshot.json]
import { readFileSync } from "node:fs";

const snapshotPath = process.argv[2] ?? ".local-tools/validation-snapshot.json";
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const counts = {};
for (const key of ["existingStores", "sales", "competitors", "locationEvaluations"]) {
  if (!Array.isArray(snapshot[key])) {
    throw new Error(`Snapshot must contain the complete ${key} array.`);
  }
  counts[key] = snapshot[key].length;
}

// Each collection query reads all documents, with a minimum of one billed read.
// Revenue sync completes before profile sync reads existing stores again.
const collectionReads = (key) => Math.max(1, counts[key]);
const revenueSync = collectionReads("existingStores") + collectionReads("sales");
const profileSync = collectionReads("existingStores") + collectionReads("competitors")
  + collectionReads("locationEvaluations") + 1; // settings/current (also if missing)

console.log(JSON.stringify({
  snapshotDate: snapshot.fetchedAt ?? null,
  counts,
  estimatedDocumentReads: { revenueSync, profileSync, total: revenueSync + profileSync },
  assumptions: [
    "The snapshot contains complete collections, not a filtered validation cohort.",
    "One successful cron execution; no new stores registered between its two stages.",
    "No retries, index-entry reads, network usage, or other application activity included.",
    "Source: src/lib/storeEval/cronSync.ts; recheck this estimate if query paths change.",
    "Writes depend on source changes; the route additionally writes one status document.",
  ],
}, null, 2));
