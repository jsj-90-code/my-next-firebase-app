// 부분 시간(15~익일10시, 11~14시 없음)으로 하루 평균·일주일 평균을 얼마나 맞히나 — 되짚기
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
process.loadEnvFile(".env.local");
const nl = String.fromCharCode(92) + "n";
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.split(nl).join("\n") }) });
const db = getFirestore();
const stores = new Map((await db.collection("pingMonitorStores").get()).docs.map((d) => [d.id, d.data()]));
const daily = await db.collection("pingMonitorDaily").get();
const byStore = {};
for (const d of daily.docs) { const [id, date] = [d.id.slice(0, d.id.lastIndexOf("_")), d.id.slice(d.id.lastIndexOf("_") + 1)]; (byStore[id] ??= {})[date] = d.get("hours") ?? {}; }
const rate = (hrs, keep) => { let a = 0, t = 0, n = 0; for (const [h, v] of Object.entries(hrs)) if (keep(+h) && v?.t > 0) { a += v.a; t += v.t; n++; } return { r: t ? a / t : null, n }; };
const PART = (h) => h >= 15 || h <= 10;
const isWeekday = (date) => { const g = new Date(date + "T00:00:00Z").getUTCDay(); return g >= 1 && g <= 5; };
const rows = [];
for (const [id, dates] of Object.entries(byStore)) {
  const s = stores.get(id); if (!s || s.excludeFromStats || s.ipCheck) continue;
  const full = Object.entries(dates).filter(([date, h]) => Object.keys(h).length >= 22 && date >= (process.env.FROM ?? "0"));
  if (full.length < +(process.env.MIN ?? 5)) continue;
  const fullRates = full.map(([date, h]) => ({ date, all: rate(h, () => true).r, part: rate(h, PART).r }));
  const week = fullRates.reduce((x, y) => x + y.all, 0) / fullRates.length;
  if (week < 0.03) continue; // 늘 0대 근처(측정 안 되는 곳) 제외
  for (const f of fullRates) if (isWeekday(f.date)) rows.push({ id, name: s.name, ...f, week });
}
// 비율 k = 하루 평균 / 부분 평균 (전체 중앙값)
const med = (xs) => { const a = [...xs].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
const k = med(rows.map((r) => r.all / r.part));
const pctl = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; };
const show = (label, errs) => console.log(label.padEnd(34), "중앙", (100 * med(errs.map(Math.abs))).toFixed(1) + "%p", " 90%", (100 * pctl(errs.map(Math.abs), 0.9)).toFixed(1) + "%p", " 평균편향", (100 * errs.reduce((x, y) => x + y, 0) / errs.length).toFixed(1) + "%p");
console.log(`매장 ${new Set(rows.map((r) => r.id)).size}곳, 평일 하루 ${rows.length}건, k=${k.toFixed(3)}`);
show("부분시간 그대로 → 그날 하루평균", rows.map((r) => r.part - r.all));
show("부분시간×k → 그날 하루평균", rows.map((r) => r.part * k - r.all));
show("그날 하루평균(완전) → 일주일 평균", rows.map((r) => r.all - r.week));
show("부분시간×k → 일주일 평균", rows.map((r) => r.part * k - r.week));
// 상대 오차(가동률 대비 %)
const rel = rows.map((r) => (r.part * k - r.week) / r.week);
console.log("부분시간×k → 일주일 평균, 상대오차 중앙", (100 * med(rel.map(Math.abs))).toFixed(0) + "%", " 90%", (100 * pctl(rel.map(Math.abs), 0.9)).toFixed(0) + "%");
