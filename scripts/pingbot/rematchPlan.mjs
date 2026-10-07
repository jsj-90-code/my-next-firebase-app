// 재매칭(rematch.mjs) 결과 → 경쟁점 가동률 측정기 등록 계획(2026-10-07).
// 사람이 본 판단을 아래 ACCEPT/HOLD에 적는다(자리만 같은 곳은 같은 건물 다른 매장이 많아 기본 제외).
// 입력: .local-tools/pingbot-rematch.json, pingbot-ip-detail.json(핑봇 편집 화면 IP — fetchDetail.mjs로 채움)
// 출력: .local-tools/pingbot-rematch-plan.json → precheck.mjs(대역 안에서만 한 번 재기) → importPlan.mjs --file=
import { readFileSync, writeFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const read = (f) => { let x = JSON.parse(readFileSync(f, "utf8")); return typeof x === "string" ? JSON.parse(x) : x; };
const rematch = read(".local-tools/pingbot-rematch.json");
const detail = read(".local-tools/pingbot-ip-detail.json");
const compById = new Map(read(".local-tools/validation-snapshot.json").competitors.map((c) => [c.id, c]));

// 2026-10-07 판단. 키 = "우리매장|경쟁점 이름"
const ACCEPT = {
  "구미산동점|앤유PC": "nupc방 구미산동점 82대=82대 · 18m",
  "시흥은계점|스타바이브": "스타파이브pc(오타) 111대=111대 · 1m",
  "부경대점|옥스": "핑봇 '수/경성대/옥스' 88대 · 7m",
  "동탄북광장점|제로100 pc방": "제로백 화성북광장점 116대 · 30m",
  "발산역점|라이즈 pc방(3POP)": "3POP(발산점)에서 상호 변경 · 8m",
  "강릉교동점(신)|용포pc방": "옹포pc방(오타) 95대 · 0m",
  "장산점|아이린PC방": "핑봇 '수/장산역/아이파크/80' 80대≈81대 · 45m (이름 달라 확인 필요)",
  "신중동점|스타일pc방": "스타일pc방 신중동점(최신) · 47m",
  "울산삼산점|레벨업PC방 울산삼산점": "레벌업 삼산점(오타) 101대 · 2m",
  "울산삼산점|레드포스PC아레나 삼산점": "같은 이름 158대 · 0m (10-06엔 핑봇 좌표가 0이라 빠짐)",
  "울산삼산점|피에스타스토리 PC CAFE": "같은 이름 101대 · 6m (10-06엔 핑봇 좌표가 0이라 빠짐)",
  "평내호평점|샹떼PC방": "쌍떼 호평점(오타) · 21m · 대수 100 vs 80",
};
// 맞춰 봤지만 안 넣는 곳(이유는 문서 docs/ping-monitor.md에 옮김)
// 강릉 오셀롯 ← 크레인 47m(대수 81 vs 95) · 울산삼산 욜로 ← 레벌업(레벨업이 2m로 더 가까움) · 청주대 락피씨방 = 이미 등록된 오엑스와 같은 IP

process.loadEnvFile(".env.local");
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") }) });
const registered = (await getFirestore().collection("pingMonitorStores").get()).docs.map((d) => d.data());

const toNum = (ip) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const spans = (s) => String(s).split(/[,\n]+/).map((r) => r.trim()).filter(Boolean).map((r) => { const [a, e] = r.split("~"); const pre = a.slice(0, a.lastIndexOf(".") + 1); return [toNum(a), toNum(pre + (e || a.split(".").at(-1)))]; });
const used = registered.map((r) => ({ who: `${r.ownName ?? r.ownCode} ${r.name}`, sp: spans(r.ipRanges ?? "") }));

const register = [], hold = [];
const seenIdx = new Set();
for (const o of rematch) {
  const why = ACCEPT[`${o.ownName}|${o.compName}`];
  if (!why || !o.best) continue;
  if (seenIdx.has(o.best.idx)) continue; // 같은 경쟁점이 두 문서로 있는 경우(발산 라이즈)
  const d = detail[o.best.idx];
  if (!d) { hold.push({ ownName: o.ownName, compName: o.compName, idx: o.best.idx, reason: "핑봇 IP 아직 안 읽음(fetchDetail.mjs)" }); continue; }
  const ok = d.ranges.filter((r) => { const [s, e] = r.split("~"); const a = Number(s.split(".").at(-1)), b = Number(e); return e && b > a && b <= 255; });
  if (!ok.length) { hold.push({ ownName: o.ownName, compName: o.compName, idx: o.best.idx, reason: `핑봇 IP를 못 씀(${d.ranges.join(", ") || "없음"})` }); continue; }
  const sp = spans(ok.join(","));
  const clash = used.filter((u) => u.sp.some(([a, b]) => sp.some(([x, y]) => a <= y && x <= b)));
  if (clash.length) { hold.push({ ownName: o.ownName, compName: o.compName, idx: o.best.idx, reason: `이미 등록된 IP와 겹침: ${clash.map((u) => u.who).join(", ")}` }); continue; }
  seenIdx.add(o.best.idx);
  used.push({ who: `${o.ownName} ${o.compName}`, sp });
  register.push({
    ownCode: o.ownCode, ownName: o.ownName, name: o.compName, address: o.compAddr, ipRanges: ok.join(", "),
    pcCount: o.compPc ?? null, distanceM: compById.get(o.id)?.distanceM ?? null, competitorId: o.id,
    memo: `옛 핑봇 IP — 좌표 재매칭(${o.best.title.split(" / ")[0]} · ${why})`, _pingbotUtil: o.best.util,
  });
}
writeFileSync(".local-tools/pingbot-rematch-plan.json", JSON.stringify({ register, hold }, null, 1));
console.log(`등록 후보 ${register.length} · 보류 ${hold.length}`);
for (const h of hold) console.log(`  보류 ${h.ownName} ${h.compName}: ${h.reason}`);
