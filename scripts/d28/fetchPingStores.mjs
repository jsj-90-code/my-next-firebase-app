// 측정기 매장 문서(일별 합계 days 포함)를 Firebase에서 읽어 .local-tools/d28/pingStores.json에 사본으로 둔다(읽기만, git 밖 — 경쟁점 IP가 들어 있음).
// 주의: 11-04 07시 뒤 기록은 사내 저장소에만 있다 → 회사 PC에선 rivalSurge.mjs --live를 쓴다.
import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "./env.mjs";
const d = db();
const snap = await d.collection("pingMonitorStores").get();
const docs = snap.docs.map((x) => ({ id: x.id, ...x.data() }));
mkdirSync(new URL("../../.local-tools/d28/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../.local-tools/d28/pingStores.json", import.meta.url), JSON.stringify({ fetchedAt: new Date().toISOString(), docs }, (k, v) => (v && v._seconds != null ? new Date(v._seconds * 1000).toISOString() : v)));
const keys = new Map();
for (const x of docs) for (const k of Object.keys(x)) keys.set(k, (keys.get(k) || 0) + 1);
console.log([...keys].map(([k, n]) => `${k}:${n}`).join(" "));
const own = docs.filter((x) => x.isOwnStore);
console.log("우리매장", own.length, own.slice(0, 3).map((x) => [x.id, x.name, x.ownCode, x.storeCode]));
const s = docs.find((x) => !x.isOwnStore && x.days && Object.keys(x.days).length > 20);
console.log(JSON.stringify({ ...s, days: Object.fromEntries(Object.entries(s.days).slice(0, 3)), recent: undefined }).slice(0, 1500));
const allDays = new Set(); for (const x of docs) for (const k of Object.keys(x.days || {})) allDays.add(k);
console.log("날짜", [...allDays].sort()[0], "~", [...allDays].sort().at(-1), allDays.size);
