// 경쟁점 가동률 측정기 — "완성된 상권" 표(2026-10-08, B1 준비. docs/handoff-20261007.md B1).
// 우리 매장(기존점·후보지)마다 반경 500m 경쟁점 중 측정기가 "정상"으로 재고 있는 비율.
// 1km는 못 낸다 — 점포평가 경쟁점 목록이 500m 안만 담는다(2026-10-08 확인: 57곳 전부 1km=500m). 2km 카카오 목록엔 대수·IP가 없다.
// 비율 = min(곳 비율, 대수 비율) — 대수 칸이 빈 경쟁점이 대수 비율에서 저절로 빠져 후해지는 걸 막는다(암사 제논처럼 IP·대수 둘 다 빈 곳).
// 정상 = diagnose.mjs 판정(ping-diagnose.json)의 "정상" — 대답 0·늘 켜진 기기·범위 일부만 등은 뺀다(인계 B1 규칙).
// 경쟁점 목록은 점포평가 경쟁점(storeEvalCompetitors, 기존점은 개점 시점 목록) — 측정기에서 폐업 처리한 곳도 목록엔 남는다.
// 읽기만 한다. 먼저 판정을 새로: node scripts/pingMonitor/diagnose.mjs && node scripts/pingMonitor/coverage.mjs
// 결과: .local-tools/ping-coverage.json·.csv(바탕화면 복사)
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();

const RADII = [500];
const THRESHOLDS = [0.8, 0.6];

const diag = JSON.parse(readFileSync(".local-tools/ping-diagnose.json", "utf8"));
const normalByCompetitor = new Map();
for (const r of diag) if (r.competitorId && r.level === "정상") normalByCompetitor.set(r.competitorId, r);
const anyByCompetitor = new Map();
for (const r of diag) if (r.competitorId) anyByCompetitor.set(r.competitorId, r);

const existing = (await db.collection("storeEvalExistingStores").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const candidates = (await db.collection("storeEvalCandidates").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const comps = (await db.collection("storeEvalCompetitors").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ownPing = new Set((await db.collection("pingMonitorStores").where("isOwnStore", "==", true).get()).docs.map((d) => d.get("ownCode")));

const converted = new Set(existing.map((s) => s.originCandidateCode).filter(Boolean));
const subjects = [
  ...existing.filter((s) => ownPing.has(s.storeCode ?? s.id)).map((s) => ({ kind: "기존점", code: s.storeCode ?? s.id, name: s.storeName ?? s.name ?? "", source: s.originCandidateCode ?? s.storeCode ?? s.id })),
  ...candidates.filter((c) => !converted.has(c.code ?? c.id)).map((c) => ({ kind: "후보지", code: c.code ?? c.id, name: c.name ?? "", source: c.code ?? c.id })),
];

const isReal = (c) => c.investigationStatus !== "경쟁점없음" && !/^경쟁점 없음/.test(c.name ?? "") && String(c.name ?? "").trim() !== "";
const pcOf = (c) => c.appliedPcCount ?? c.totalPcCount ?? null;

const rows = subjects.map((s) => {
  const mine = comps.filter((c) => c.candidateCode === s.source && isReal(c));
  const out = { kind: s.kind, code: s.code, name: s.name };
  for (const R of RADII) {
    const inR = mine.filter((c) => c.distanceM != null && c.distanceM <= R);
    const pcKnown = inR.filter((c) => pcOf(c) != null);
    const totalPc = pcKnown.reduce((a, c) => a + pcOf(c), 0);
    const okPc = pcKnown.filter((c) => normalByCompetitor.has(c.id)).reduce((a, c) => a + pcOf(c), 0);
    out[`n${R}`] = inR.length;
    out[`noPc${R}`] = inR.length - pcKnown.length;
    out[`okN${R}`] = inR.filter((c) => normalByCompetitor.has(c.id)).length;
    out[`pc${R}`] = totalPc;
    out[`okPc${R}`] = okPc;
    const okN = inR.filter((c) => normalByCompetitor.has(c.id)).length;
    out[`share${R}`] = inR.length === 0 ? null : Math.min(okN / inR.length, totalPc > 0 ? okPc / totalPc : 0);
    // 빠진 이유 — 측정기 미등록 / IP 없음·대답 없음 등(정상이 아닌 판정)
    out[`miss${R}`] = inR.filter((c) => !normalByCompetitor.has(c.id)).map((c) => `${c.name}(${anyByCompetitor.get(c.id)?.level ?? "미등록"})`).join(" / ");
  }
  return out;
});

const pct = (v) => (v == null ? "-" : `${Math.round(v * 100)}%`);
for (const kind of ["기존점", "후보지"]) {
  const xs = rows.filter((r) => r.kind === kind);
  const line = RADII.map((R) => {
    const withComp = xs.filter((r) => r[`n${R}`] > 0);
    return `${R}m: 경쟁점 있는 ${withComp.length}곳 중 ` + THRESHOLDS.map((t) => `${t * 100}%↑ ${withComp.filter((r) => (r[`share${R}`] ?? 0) >= t).length}곳`).join(" · ") + ` · 경쟁점 없음 ${xs.length - withComp.length}곳`;
  });
  console.log(`■ ${kind} ${xs.length}곳 — ${line.join(" | ")}`);
}

const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const head = ["구분", "코드", "매장", ...RADII.flatMap((R) => [`${R}m 경쟁점`, `${R}m 대수`, `${R}m 정상 측정 곳`, `${R}m 정상 측정 대수`, `${R}m 비율`, `${R}m 대수 빈칸`, `${R}m 빠진 곳(판정)`])];
const sorted = [...rows].sort((a, b) => a.kind.localeCompare(b.kind, "ko") || (b.share500 ?? -1) - (a.share500 ?? -1));
const lines = [head.join(","), ...sorted.map((r) => [r.kind, r.code, r.name, ...RADII.flatMap((R) => [r[`n${R}`], r[`pc${R}`], r[`okN${R}`], r[`okPc${R}`], pct(r[`share${R}`]), r[`noPc${R}`], r[`miss${R}`]])].map(esc).join(","))];
writeFileSync(".local-tools/ping-coverage.json", JSON.stringify(rows, null, 1));
const file = ".local-tools/측정기_완성된상권.csv";
writeFileSync(file, "﻿" + lines.join("\r\n"));
try { copyFileSync(file, join(process.env.USERPROFILE ?? "", "Desktop", "측정기_완성된상권.csv")); } catch {}
process.exit(0);
