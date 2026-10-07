// 경쟁점 가동률 측정기 — 경쟁점마다 "무엇이 문제인지" 판정해 2차 확인표를 만든다 (2026-10-07 사용자:
// "네이버지도·카카오맵으로 문제 있는 것만 내가 2차 검증 · 잘못 입력된 IP도 보려 했는데 뭐가 문제인지 판단이 안 됨").
//
// 재료: 측정기 문서(대답 수·대수·IP 범위) + 날짜별 시간대 기록(pingMonitorDaily) + 카카오 대조 결과(checkClosed.mjs가 만든 .local-tools/ping-closed-check.json).
// 판정(위에서부터 먼저 걸리는 것):
//   이미 사람이 확인(openCheck)          → 그 결과
//   IP 없음                              → 카카오 있으면 "영업 중 · IP만 없음", 없으면 "폐업/상호변경 의심"
//   대답 0~3대(12시간 넘게 잼)            → 카카오 있으면 "IP 틀림·차단", 없으면 "폐업 의심"
//   대답 수 > 대수 · 평균 60% 넘음 · 새벽도 저녁만큼 켜짐 → "IP 틀림 — 다른 기기·사업장 섞임"
//   하루 넘게 쟀는데 최대 대답이 대수의 20% 미만 → "IP 범위 일부만 맞을 수 있음"(주의)
//   그 밖 → 정상(대답이 낮·밤으로 오르내리면 그 IP 뒤에 실제 PC방이 돌고 있다는 뜻 — 카카오 이름이 달라도 상호 표기 차이)
// 읽기만 한다. 결과: 바탕화면·.local-tools에 CSV(엑셀에서 지도 링크가 눌림).
//   node scripts/pingMonitor/checkClosed.mjs && node scripts/pingMonitor/diagnose.mjs
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();
const kakao = new Map(JSON.parse(readFileSync(".local-tools/ping-closed-check.json", "utf8")).map((r) => [r.id, r]));

const stores = (await db.collection("pingMonitorStores").get()).docs.filter(
  (d) => !d.get("isOwnStore") && d.get("ownCode") && !/^N\d/.test(String(d.get("ownCode"))),
);
const NIGHT = ["04", "05", "06", "07"], EVENING = ["19", "20", "21", "22"];
const rows = [];
for (const d of stores) {
  const s = d.data();
  const pc = s.pcCount ?? null;
  const k = kakao.get(d.id);
  // 카카오가 상호로 검색해 돌려준 PC방이 등록 거리와 150m 안으로 맞으면 같은 곳(영어·한글 표기 차이 — geekstar=긱스타, 쓰리팝=3pop)
  const regM = s.distanceM ?? k?.regDistanceM ?? null;
  const kakaoFound = k?.kakao === "있음" || (k?.best && (k.best.sim >= 0.3 || (regM != null && Math.abs(k.best.m - regM) <= 150)));
  // 시간대 기록 — 문서 id `{매장id}_{날짜}`
  const daily = s.ipRanges
    ? (await db.collection("pingMonitorDaily").where(FieldPath.documentId(), ">=", `${d.id}_`).where(FieldPath.documentId(), "<=", `${d.id}_`).get()).docs
    : [];
  const samples = [];
  for (const q of daily) for (const [h, v] of Object.entries(q.get("hours") ?? {})) if (v?.t > 0) samples.push({ h: h.padStart(2, "0"), a: v.a ?? 0, t: v.t });
  const n = samples.length;
  const maxA = n ? Math.max(...samples.map((x) => x.a)) : 0;
  const util = n ? samples.reduce((x, y) => x + y.a, 0) / samples.reduce((x, y) => x + y.t, 0) : null;
  const avgAt = (hs) => { const xs = samples.filter((x) => hs.includes(x.h)); return xs.length ? xs.reduce((p, x) => p + x.a, 0) / xs.length : null; };
  const night = avgAt(NIGHT), evening = avgAt(EVENING);

  let level, problem, todo;
  const oc = s.openCheck;
  if (oc?.status === "폐업") { level = "확인 끝"; problem = `폐업(사람 확인 ${oc.at})`; todo = "-"; }
  else if (!s.ipRanges) {
    if (kakaoFound) { level = "참고"; problem = "영업 중(카카오 있음) · IP가 없어 측정 안 됨"; todo = "IP를 구하면 등록"; }
    else { level = "확인 필요"; problem = "IP 없음 + 카카오에 같은 이름 없음 → 폐업 또는 상호 변경 의심"; todo = "지도로 영업 여부 확인"; }
  } else if (n < 12) { level = "참고"; problem = `측정 ${n}시간뿐 — 판정하기엔 짧음`; todo = "하루 뒤 다시"; }
  else if (maxA <= 3) {
    if (kakaoFound) { level = "확인 필요"; problem = `영업 중(카카오 있음)인데 ${n}시간 동안 대답 최대 ${maxA}대 → 등록 IP가 틀렸거나 낡음(또는 바깥 확인 차단)`; todo = "IP 다시 확인"; }
    else { level = "확인 필요"; problem = `대답 최대 ${maxA}대 + 카카오에 같은 이름 없음 → 폐업 의심`; todo = "지도로 영업 여부 확인"; }
  } else if (pc && maxA > pc) { level = "확인 필요"; problem = `대답 ${maxA}대가 대수 ${pc}대보다 많음 → IP 범위에 다른 기기·사업장이 섞임`; todo = "IP 범위 다시 확인"; }
  else if (util > 0.6) { level = "확인 필요"; problem = `평균 ${(util * 100).toFixed(0)}%로 비정상적으로 높음 → 손님과 상관없이 늘 켜진 기기(공유기·다른 사업장)가 대답`; todo = "IP 범위 다시 확인"; }
  else if (night != null && evening != null && evening >= 5 && night >= evening * 0.8) { level = "확인 필요"; problem = `새벽(${night.toFixed(0)}대)도 저녁(${evening.toFixed(0)}대)만큼 켜짐 → 늘 켜진 기기가 대답, IP가 다른 곳일 수 있음`; todo = "IP 범위 다시 확인"; }
  else if (pc && n >= 24 && maxA < pc * 0.2) { level = "주의"; problem = `하루 넘게 쟀는데 최대 ${maxA}/${pc}대(${Math.round((maxA / pc) * 100)}%) → IP 범위 일부만 맞을 수 있음`; todo = "여유 있을 때 IP 범위 확인"; }
  else { level = "정상"; problem = `낮·밤으로 오르내림(최대 ${maxA}/${pc ?? "?"}대) — 실제 PC방이 돌고 있음`; todo = "-"; }
  // 2026-10-07 사용자 "대수랑 IP대역 안 맞는 거" — 등록 범위 크기(ipCount)와 대수가 다르면 범위를 잘못 적었을 수 있다.
  const ipCount = s.ipCount ?? null;
  const rangeMismatch = s.ipRanges && ipCount && pc && Math.abs(ipCount - pc) > Math.max(5, pc * 0.1);
  if (rangeMismatch) { problem += ` · IP 범위 ${ipCount}개 vs 대수 ${pc}대로 안 맞음`; if (level === "정상" || level === "참고") { level = "주의"; todo = "IP 범위·대수 확인"; } }
  if (oc && oc.status !== "폐업") problem += ` · 영업은 사람 확인(${oc.at})`;
  const confirmedOpen = oc && oc.status !== "폐업";
  const group = confirmedOpen && /폐업/.test(problem) ? "" : /폐업/.test(problem) && level === "확인 필요" ? (s.ipRanges ? "폐점 예상" : "폐점 예상(약함 · IP 없음)") : /IP가 틀렸|범위에 다른|높음|새벽|일부만/.test(problem) ? "가동률 이상" : rangeMismatch ? "대수·IP범위 불일치" : "";

  const area = String(s.address || "").split(" ").slice(0, 2).join(" ") || String(s.ownName ?? "").replace(/점.*$/, "");
  const q = encodeURIComponent(`${s.name} ${area}`);
  rows.push({
    level, group, rangeMismatch: !!rangeMismatch, ipCount, own: s.ownName, name: s.name, problem, todo, pc, maxA: s.ipRanges ? maxA : "", util: util == null ? "" : (util * 100).toFixed(1),
    hours: n, ip: s.ipRanges ?? "", kakaoNear: k?.best ? `${k.best.place} (${k.best.m}m)` : "",
    naver: `https://map.naver.com/p/search/${q}`, kakaoUrl: `https://map.kakao.com/?q=${q}`,
  });
}

const ORDER = { "확인 필요": 0, "주의": 1, "참고": 2, "정상": 3, "확인 끝": 4 };
rows.sort((a, b) => ORDER[a.level] - ORDER[b.level] || String(a.own).localeCompare(String(b.own), "ko"));
const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const link = (url, label) => `"=HYPERLINK(""${url}"",""${label}"")"`;
const head = ["묶음", "판정", "우리 매장", "경쟁점", "무엇이 문제", "할 일", "대수", "최대 대답", "평균 가동률(%)", "잰 시간", "등록 IP", "카카오 근접", "네이버지도", "카카오맵", "확인 결과", "메모"];
const lines = [head.join(","), ...rows.map((r) => [r.group, r.level, r.own, r.name, r.problem, r.todo, r.pc, r.maxA, r.util, r.hours, r.ip, r.kakaoNear].map(esc).concat(link(r.naver, "네이버"), link(r.kakaoUrl, "카카오"), "", "").join(","))];
const file = ".local-tools/경쟁점_2차확인표.csv";
writeFileSync(file, "﻿" + lines.join("\r\n"));
try { copyFileSync(file, join(process.env.USERPROFILE ?? "", "Desktop", "경쟁점_2차확인표.csv")); } catch {}
const cnt = {}; for (const r of rows) cnt[r.level] = (cnt[r.level] ?? 0) + 1;
console.log(cnt);
for (const g of ["폐점 예상", "폐점 예상(약함 · IP 없음)", "가동률 이상", "대수·IP범위 불일치"]) {
  const xs = rows.filter((r) => r.group === g || (g === "대수·IP범위 불일치" && r.rangeMismatch && r.group !== g));
  console.log(`
■ ${g} ${xs.length}곳`);
  for (const r of xs) console.log(`  ${r.own} | ${r.name} | 대수 ${r.pc ?? "?"} · IP ${r.ipCount ?? "-"}개 · 최대 대답 ${r.maxA} · 평균 ${r.util}% — ${r.problem}`);
}
process.exit(0);
