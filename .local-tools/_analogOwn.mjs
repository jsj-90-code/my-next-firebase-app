// 신규 경쟁점(측정 하루 미만)의 일주일 평균 가동률 추정 — 같은 시간대에 비슷하게 바쁜 "우리 가맹점"의 일주일 평균과 대조
// 사용: node .local-tools/_analogOwn.mjs [후보지코드=N022] [시작일=2026-10-14] [시작시=15]
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
process.loadEnvFile(".env.local");
const nl = String.fromCharCode(92) + "n";
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.split(nl).join("\n") }) });
const db = getFirestore();
const [code = "N022", d0 = "2026-10-14", h0 = "15"] = process.argv.slice(2);
const d1 = new Date(Date.parse(d0 + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
const all = (await db.collection("pingMonitorStores").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const hoursOf = async (id) => {
  const [a, b] = await Promise.all([d0, d1].map((dt) => db.collection("pingMonitorDaily").doc(`${id}_${dt}`).get()));
  const out = {};
  for (const [h, v] of Object.entries(a.get("hours") ?? {})) if (+h >= +h0 && v?.t > 0) out[`${d0} ${h}`] = v;
  for (const [h, v] of Object.entries(b.get("hours") ?? {})) if (+h < +h0 && v?.t > 0) out[`${d1} ${h}`] = v;
  return out;
};
// 일주일 평균: 시작일 전 7일 중 다 찬 날(n>=20)
const weekAvg = (s) => { let a = 0, t = 0, n = 0; for (const [dt, v] of Object.entries(s.days ?? {})) { if (dt >= d0 || dt < new Date(Date.parse(d0) - 7 * 864e5).toISOString().slice(0, 10)) continue; if (v.n >= 20 && v.t > 0) { a += v.a; t += v.t; n++; } } return n >= 5 ? { r: a / t, n } : null; };
const targets = all.filter((s) => s.ownCode === code && !s.isOwnStore && s.recent);
const tH = {}; for (const t of targets) tH[t.id] = await hoursOf(t.id);
const keys = Object.keys(tH[targets[0].id]).filter((k) => targets.every((t) => tH[t.id][k])).sort();
const winRate = (hrs) => { let a = 0, t = 0; for (const k of keys) { const v = hrs[k]; if (!v) return null; a += v.a; t += v.t; } return a / t; };
console.log(`대조 시간대 ${keys.length}칸: ${keys[0]}시 ~ ${keys.at(-1)}시`);
const own = all.filter((s) => s.isOwnStore && s.active && !s.excludeFromStats && !s.ipCheck);
const ownRows = [];
for (const s of own) { const w = weekAvg(s); if (!w) continue; const r = winRate(await hoursOf(s.id)); if (r == null) continue; ownRows.push({ name: s.ownName ?? s.name, pc: s.pcCount, win: r, week: w.r }); }
const med = (xs) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const pct = (x) => (100 * x).toFixed(1) + "%";
const kAll = med(ownRows.map((r) => r.week / r.win));
console.log(`우리 가맹점 ${ownRows.length}곳 — 일주일평균 ÷ 이 시간대 가동률 중앙 ${kAll.toFixed(2)}`);
for (const t of targets) {
  const w = winRate(tH[t.id]);
  const near = ownRows.filter((r) => r.pc && Math.abs(r.pc - t.pcCount) / t.pcCount <= 0.35)
    .sort((x, y) => Math.abs(x.win - w) - Math.abs(y.win - w)).slice(0, 5);
  const kNear = med(near.map((r) => r.week / r.win));
  console.log(`\n■ ${t.name} ${t.pcCount}대 · 이 시간대 ${pct(w)}`);
  for (const r of near) console.log(`   ${r.name} ${r.pc}대  이 시간대 ${pct(r.win)} → 일주일 ${pct(r.week)}`);
  console.log(`   추정 일주일 평균: 비슷한 매장 기준 ${pct(w * kNear)} · 가맹점 전체 비율 기준 ${pct(w * kAll)}`);
}
