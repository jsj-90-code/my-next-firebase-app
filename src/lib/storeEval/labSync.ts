// 운영 컬렉션 -> 실험실 전용 복제본 동기화 — 06:00 크론용 (2026-09-28).
//
// scripts/syncLabCollections.mjs와 **같은 규칙**을 서버에서 매일 돈다. 사용자 2026-09-28: "신규후보지 등록할 때
// 실험실 산식이 같이 안 뜨는 게 불편하네. 따로 얘기해야 하는 게" — 전에는 사람이 스크립트를 돌려야 실험실 화면에
// 새 후보지가 떴다. 이제 크론이 후보지·경쟁점·입지평가·기존점·설정을 운영 -> 실험실 한 방향으로 복사한다.
//
// ⚠️ 한 방향(운영 -> 실험실)뿐이다. 실험실 전용 컬렉션(QSC·고리·주거 반경·항아리·로드뷰)은 건드리지 않는다.
// ⚠️ 바뀐 문서만 쓴다(updatedAt·createdAt·updatedBy 차이는 무시) — 스크립트의 needsWrite와 같다.
// ⚠️ 월매출은 복제하지 않는다(실측 사실, 실험실도 운영 것을 읽는다).
import type { Firestore } from "firebase-admin/firestore";

export const LAB_SYNC_PAIRS = [
  { key: "existingStores", from: "storeEvalExistingStores", to: "storeEvalLabExistingStores" },
  { key: "candidates", from: "storeEvalCandidates", to: "storeEvalLabCandidates" },
  { key: "competitors", from: "storeEvalCompetitors", to: "storeEvalLabCompetitors" },
  { key: "locationEvaluations", from: "storeEvalLocationEvaluations", to: "storeEvalLabLocationEvaluations" },
  { key: "settings", from: "storeEvalSettings", to: "storeEvalLabSettings" },
] as const;

const IGNORE_KEYS = new Set(["updatedAt", "createdAt", "updatedBy"]);

/** 두 문서가 뜻 있는 값에서 다른가 — 시각·작성자 필드만 다른 건 같은 것으로 본다. */
export function labDocNeedsWrite(existing: Record<string, unknown> | undefined, data: Record<string, unknown>): boolean {
  if (!existing) return true;
  const keys = new Set([...Object.keys(data), ...Object.keys(existing)]);
  for (const key of keys) {
    if (IGNORE_KEYS.has(key)) continue;
    const a = JSON.stringify(data[key] ?? null);
    const b = JSON.stringify(existing[key] ?? null);
    if (a !== b) return true;
  }
  return false;
}

export type LabSyncSummary = {
  written: number;
  byCollection: { key: string; source: number; lab: number; written: number }[];
};

export async function runLabSync(db: Firestore): Promise<LabSyncSummary> {
  const byCollection: LabSyncSummary["byCollection"] = [];
  let written = 0;
  for (const pair of LAB_SYNC_PAIRS) {
    const [srcSnap, dstSnap] = await Promise.all([db.collection(pair.from).get(), db.collection(pair.to).get()]);
    const dst = new Map(dstSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
    let n = 0;
    for (const d of srcSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      if (!labDocNeedsWrite(dst.get(d.id), data)) continue;
      await db.collection(pair.to).doc(d.id).set(data);
      n++;
    }
    written += n;
    byCollection.push({ key: pair.key, source: srcSnap.size, lab: dstSnap.size, written: n });
  }
  return { written, byCollection };
}
