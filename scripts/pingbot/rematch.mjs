// 옛 핑봇 재매칭 — 이름 대신 "같은 자리"로 맞춘다(2026-10-07).
// 10-06 매칭(_pingbotIpMatch·_pingbotIpPlan)에서 "핑봇에 없음"·"좌표가 먼 후보뿐"으로 남은 경쟁점을
// 핑봇 목록의 지번 주소를 카카오로 좌표로 바꿔, 점포평가 경쟁점 좌표와 가까운 순으로 다시 고른다.
// 상호가 바뀌었거나 오타("레벌업")여도 자리는 그대로라 잡힌다. 이름 닮음·대수는 판정 보조.
//
// 입력: .local-tools/pingbot-all.json, pingbot-ip-targets.json, pingbot-ip-plan.json, validation-snapshot.json
// 캐시: .local-tools/pingbot-geocode.json (핑봇 idx → {lat,lng} | null)
// 출력: .local-tools/pingbot-rematch.json — 경쟁점마다 가까운 핑봇 후보 3곳과 판정
// 실행: node scripts/pingbot/rematch.mjs   (KAKAO_REST_API_KEY 필요, .env.local)
import { existsSync, readFileSync, writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const KEY = process.env.KAKAO_REST_API_KEY;
const read = (f) => { let x = JSON.parse(readFileSync(f, "utf8")); return typeof x === "string" ? JSON.parse(x) : x; };
const all = read(".local-tools/pingbot-all.json").rows;
const targets = read(".local-tools/pingbot-ip-targets.json");
const plan = read(".local-tools/pingbot-ip-plan.json");
const snap = read(".local-tools/validation-snapshot.json");
const compById = new Map(snap.competitors.map((c) => [c.id, c]));
const CACHE = ".local-tools/pingbot-geocode.json";
const geo = existsSync(CACHE) ? read(CACHE) : {};

const SIDO = { 서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 경기도: "경기", 강원도: "강원", 강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남", 전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주" };
const region = (addr) => { const t = String(addr ?? "").trim().split(/\s+/); return { sido: SIDO[t[0]] ?? t[0] ?? "", sgg: (t[1] ?? "").replace(/(시|군|구)$/, "") }; };
const meters = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
const norm = (t) => String(t ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/pc방|pc|피시방|피씨방|피시|피씨|카페|cafe|클럽|존|아레나|스토리|점$|\s+|[-_.·&/]/g, "");
// 글자쌍(bigram) 겹침 비율 — 오타 하나("레벌업"↔"레벨업")에도 0이 되지 않는다.
const dice = (a, b) => {
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  if (a.length < 2 || b.length < 2) return a && a === b ? 1 : 0;
  const A = bg(a), B = bg(b); let hit = 0;
  for (const [k, n] of A) hit += Math.min(n, B.get(k) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
};

// 핑봇 제목 "이름 / 70대 / 담당자" — 대수는 PC가 아니라 핑봇 등록 장비 수일 때도 있어 참고만.
const rows = all.map((r) => {
  const m = r.title.match(/^(.*?)\s*\/\s*(\d+)대\s*\/\s*(.*)$/);
  const name = m ? m[1].trim() : r.title;
  return { idx: r.idx, title: r.title, name, n: norm(name), pc: m ? Number(m[2]) : null, addr: r.addr, util: r.util, closed: /폐|휴업|이전/.test(r.title), reg: region(r.addr) };
});

const tByKey = new Map(targets.map((t) => [`${t.ownCode}|${t.name}`, t]));
const todo = plan.hold
  .filter((h) => /핑봇에 없음|좌표가 먼/.test(h.reason))
  .map((h) => { const t = tByKey.get(`${h.ownCode}|${h.compName}`); const c = compById.get(t?.id); return { ...h, id: t?.id, comp: c, n: norm(h.compName), reg: region(c?.address) }; });

// 같은 시·도 + 시·군·구 이름이 주소에 들어 있는 핑봇 행만 좌표로 바꾼다.
const inArea = (r, t) => r.reg.sido === t.reg.sido && t.reg.sgg && r.addr.replace(/\s/g, "").includes(t.reg.sgg);
const need = new Set();
for (const t of todo) if (t.comp?.lat) for (const r of rows) if (inArea(r, t) && !(r.idx in geo)) need.add(r);
console.log(`재매칭 대상 ${todo.length}곳 · 새로 좌표 바꿀 핑봇 행 ${need.size}개 (캐시 ${Object.keys(geo).length})`);

// 지번 주소에서 층·호수 같은 꼬리를 떼고 카카오 주소 검색. 안 되면 키워드 검색으로 한 번 더.
const cleanAddr = (a) => {
  const t = String(a).replace(/\(.*?\)/g, " ").trim();
  const m = t.match(/^(.*?(?:동|리|가|로|길)\s*\d+(?:-\d+)?)/);
  return (m ? m[1] : t).replace(/\s+/g, " ");
};
async function kakao(path, q) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}.json?query=${encodeURIComponent(q)}&size=1`, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!res.ok) throw new Error(`카카오 ${res.status}`);
  const d = (await res.json()).documents?.[0];
  return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
}
let done = 0;
for (const r of need) {
  const q = cleanAddr(r.addr);
  geo[r.idx] = (await kakao("address", q)) ?? (await kakao("keyword", q));
  if (++done % 200 === 0) { writeFileSync(CACHE, JSON.stringify(geo)); console.log(`  ${done}/${need.size}`); }
  await new Promise((s) => setTimeout(s, 40));
}
writeFileSync(CACHE, JSON.stringify(geo));

// 판정: 60m 안 + (이름 닮음 0.3 이상 또는 대수 ±10%) → "자리 확정", 60m 안이지만 이름·대수 다 다르면 "자리만 같음"(같은 건물 다른 매장일 수 있음).
const out = [];
for (const t of todo) {
  if (!t.comp?.lat) { out.push({ ...pick(t), verdict: "경쟁점 좌표 없음", cands: [] }); continue; }
  const here = { lat: t.comp.lat, lng: t.comp.lng };
  const cands = rows
    .filter((r) => inArea(r, t) && geo[r.idx])
    .map((r) => ({ idx: r.idx, title: r.title, addr: r.addr, util: r.util, closed: r.closed, gap: meters(here, geo[r.idx]), sim: Math.round(dice(r.n, t.n) * 100) / 100, pcOk: r.pc != null && t.compPc != null && Math.abs(r.pc - t.compPc) <= Math.max(5, t.compPc * 0.1) }))
    .filter((c) => c.gap <= 300)
    .sort((a, b) => a.gap - b.gap);
  const near = cands.filter((c) => c.gap <= 60 && !c.closed);
  const strong = near.filter((c) => c.sim >= 0.3 || c.pcOk).sort((a, b) => b.sim + (b.pcOk ? 0.5 : 0) - (a.sim + (a.pcOk ? 0.5 : 0)));
  const verdict = strong.length ? "자리 확정" : near.length ? "자리만 같음" : cands.some((c) => c.sim >= 0.5) ? "이름은 닮았으나 먼 곳" : "핑봇에 없음";
  out.push({ ...pick(t), verdict, best: strong[0] ?? near[0] ?? null, cands: cands.slice(0, 4) });
}
function pick(t) { return { ownCode: t.ownCode, ownName: t.ownName, kind: t.kind, id: t.id, compName: t.compName, compPc: t.compPc, compAddr: t.comp?.address ?? "", before: t.reason.replace(/\(.*$/, "") }; }
writeFileSync(".local-tools/pingbot-rematch.json", JSON.stringify(out, null, 1));
const cnt = {};
for (const o of out) cnt[o.verdict] = (cnt[o.verdict] ?? 0) + 1;
console.log(cnt);
for (const o of out.filter((o) => o.verdict !== "핑봇에 없음"))
  console.log(`[${o.verdict}] ${o.ownName} ${o.compName}(${o.compPc ?? "?"}대) ← ${o.best ? `${o.best.title} · ${o.best.gap}m · 닮음 ${o.best.sim}${o.best.pcOk ? " · 대수OK" : ""} · 핑봇 ${o.best.util}` : o.cands.map((c) => `${c.title} ${c.gap}m`).join(" | ")}`);
