// 경쟁점 가동률 측정기 — 우리 매장으로 핑 보정(2026-10-08, B1 준비. docs/handoff-20261007.md B1 1번).
// 우리 매장(isOwnStore) 측정기 값 vs 매출DB 가동률(storeEvalExistingStoreSales.utilizationRate, 실제 좌석 점유시간 — 건별 원장과 1%p 안).
// ⚠️ 매출DB는 **월 값만** 있고 그 달이 끝난 뒤 시트에 들어온다(10-08 확인: 10월 문서 0건). 같은 7일 비교는 못 한다 →
//    같은 달끼리 비교한다. 측정기 쪽은 그 달 안의 24시간 다 잰 날 일일평균(summary.ts와 같은 기준).
// 사용: node scripts/pingMonitor/ownCalibration.mjs 2026-10          (그 달 매출DB가 들어온 뒤 — 11월 초)
//       node scripts/pingMonitor/ownCalibration.mjs 2026-10 2026-09  (참고: 측정기 10월 vs 매출DB 9월 — 계절·요일이 달라 비율은 대략)
// 읽기만 한다. 결과: .local-tools/ping-own-calibration.csv(바탕화면 복사)
import { writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();

const pingMonth = process.argv[2];
const salesMonth = process.argv[3] ?? pingMonth;
if (!/^\d{4}-\d{2}$/.test(pingMonth ?? "")) throw new Error("달을 주세요: node scripts/pingMonitor/ownCalibration.mjs 2026-10 [매출DB 달]");

const FULL_DAY_MIN_SAMPLES = 24; // src/lib/pingMonitor/summary.ts와 같게(2026-10-08 22→24)
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const own = (await db.collection("pingMonitorStores").where("isOwnStore", "==", true).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const sales = new Map(
  (await db.collection("storeEvalExistingStoreSales").where("yearMonth", "==", salesMonth).get()).docs.map((d) => [d.get("storeCode"), d.get("utilizationRate")]),
);
if (sales.size === 0) console.log(`⚠️ 매출DB ${salesMonth} 문서가 아직 없다 — 그 달이 끝나고 시트에 들어온 뒤 다시.`);

const rows = own.map((s) => {
  const days = Object.entries(s.days ?? {}).filter(([d, v]) => d.startsWith(pingMonth) && d < today && v.n >= FULL_DAY_MIN_SAMPLES && v.t > 0);
  const ping = days.length ? days.reduce((a, [, v]) => a + v.a / v.t, 0) / days.length : null;
  const real = sales.get(s.ownCode) ?? null;
  const ratio = ping != null && real ? ping / real : null;
  const flag = s.ipCheck ? "IP 확인 필요" : ping === 0 ? "대답 0" : ratio != null && (ratio < 0.5 || ratio > 1.5) ? "비율 이상(IP 범위 의심)" : "";
  return { code: s.ownCode, name: s.ownName, days: days.length, ping, real, ratio, flag };
});
rows.sort((a, b) => (a.flag ? 1 : 0) - (b.flag ? 1 : 0) || (b.ratio ?? 0) - (a.ratio ?? 0));

const good = rows.filter((r) => !r.flag && r.ratio != null).map((r) => r.ratio).sort((a, b) => a - b);
const med = good.length ? good[Math.floor(good.length / 2)] : null;
const mean = good.length ? good.reduce((a, b) => a + b, 0) / good.length : null;
const sd = good.length > 1 ? Math.sqrt(good.reduce((a, b) => a + (b - mean) ** 2, 0) / (good.length - 1)) : null;
const p = (v) => (v == null ? "-" : (v * 100).toFixed(1));
console.log(`측정기 ${pingMonth} vs 매출DB ${salesMonth} — 비교 ${good.length}곳(뺀 곳 ${rows.filter((r) => r.flag).length}) · 측정기÷매출DB 중앙 ${med?.toFixed(2) ?? "-"} · 평균 ${mean?.toFixed(2) ?? "-"} · SD ${sd?.toFixed(2) ?? "-"}`);
for (const r of rows) console.log(`  ${r.name} | 잰 날 ${r.days} | 측정기 ${p(r.ping)}% | 매출DB ${p(r.real)}% | 비 ${r.ratio?.toFixed(2) ?? "-"} ${r.flag}`);

const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const lines = [["매장", "코드", `측정기 ${pingMonth} 잰 날`, "측정기 가동률(%)", `매출DB ${salesMonth}(%)`, "측정기÷매출DB", "뺀 이유"].join(","), ...rows.map((r) => [r.name, r.code, r.days, p(r.ping), p(r.real), r.ratio?.toFixed(2), r.flag].map(esc).join(","))];
const file = ".local-tools/ping-own-calibration.csv";
writeFileSync(file, "﻿" + lines.join("\r\n"));
try { copyFileSync(file, join(process.env.USERPROFILE ?? "", "Desktop", "측정기_우리매장_보정.csv")); } catch {}
process.exit(0);
