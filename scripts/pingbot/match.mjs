// 핑봇 행 ↔ 우리 핑봇 대상 경쟁점(값이 이미 있는 곳) 매칭. 사람이 볼 표를 찍고 .local-tools/pingbot-match.json 에 남긴다.
// 지역은 **우리 매장 주소**의 시·군·구로 본다 — 경쟁점은 500m 안이라 같은 시·군·구이고, 경쟁점 주소(도로명)는 핑봇 지번과 안 맞는다.
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const d = JSON.parse(readFileSync(new URL(".local-tools/pingbot-all.json", root), "utf8"));
const s = JSON.parse(readFileSync(new URL(".local-tools/validation-snapshot.json", root), "utf8"));
const SIDO = { "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "울산시": "울산", "경기도": "경기", "강원도": "강원", "강원특별자치도": "강원", "충청북도": "충북", "충청남도": "충남", "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주" };
const regionOf = (addr) => { const t = String(addr ?? "").trim().split(/\s+/); return { sido: SIDO[t[0]] ?? t[0]?.slice(0, 2) ?? "", sigungu: (t[1] ?? "").replace(/(특별자치)?시$|군$|구$/, "") }; };
const storeAddr = new Map([...s.existingStores.map((x) => [x.storeCode, { name: x.storeName, addr: x.address }]), ...s.candidates.map((x) => [x.code, { name: x.name, addr: x.address }])]);
export const norm = (t) => String(t ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/pc방|pc|피시방|피씨방|피시|피씨|카페|cafe|클럽|존|아레나|스토리|점$|\s+|[-_.·&]/g, "");
const rows = d.rows.map((r) => {
  const m = r.title.match(/^(.*?)\s*\/\s*(\d+)대\s*\/\s*(.*)$/);
  const name = m ? m[1].trim() : r.title;
  return { ...r, name, pc: m ? Number(m[2]) : null, n: norm(name), utilNum: Number(String(r.util).replace("%", "")), closed: /폐|휴업/.test(r.title), addrN: String(r.addr).replace(/\s+/g, "") };
});
const targets = s.competitors.filter((c) => c.pingbotUtilization > 0).map((c) => { const st = storeAddr.get(c.candidateCode) ?? {}; return { store: (st.name ?? c.candidateCode).trim(), code: c.candidateCode, id: c.id, name: c.name, n: norm(c.name), pc: c.totalPcCount ?? c.appliedPcCount ?? null, old: c.pingbotUtilization, oldP: c.pingbotPeriod, region: regionOf(st.addr) }; });
const nameMatch = (r, t) => { if (!r.n || !t.n) return false; if (t.n.length <= 2) return r.n === t.n || r.n.startsWith(t.n); return r.n.includes(t.n) || (r.n.length >= 3 && t.n.includes(r.n)); };
const regionMatch = (r, t) => !!t.region.sigungu && r.addrN.includes(t.region.sigungu);
const out = [];
for (const t of targets) {
  const pool = rows.filter((r) => nameMatch(r, t) && regionMatch(r, t) && !r.closed);
  const scored = pool.map((r) => ({ r, pcOk: r.pc != null && t.pc != null && Math.abs(r.pc - t.pc) <= Math.max(5, t.pc * 0.1), live: r.utilNum > 0 }))
    .map((x) => ({ ...x, score: (x.pcOk ? 2 : 0) + (x.r.pc === t.pc ? 1 : 0) + (x.live ? 1 : 0) + (x.r.n === t.n ? 1 : 0) })).sort((a, b) => b.score - a.score);
  const best = scored[0] ?? null, second = scored[1] ?? null;
  const ambiguous = best && second && second.score === best.score && second.r.utilNum !== best.r.utilNum;
  const status = !best ? "없음" : !best.live ? "핑제로" : ambiguous ? "동점" : best.pcOk ? "확정" : "대수불일치";
  out.push({ t, best: best?.r ?? null, second: second?.r ?? null, status, all: scored.map((x) => x.r) });
}
const fmt = (r) => r ? `${r.name} / ${r.pc}대 / ${r.addr} → ${r.util}` : "-";
console.log(`핑봇 창 ${d.period} · 대상 ${targets.length}곳`);
for (const st of ["확정", "대수불일치", "동점", "핑제로", "없음"]) {
  const g = out.filter((o) => o.status === st);
  if (!g.length) continue;
  console.log(`\n[${st}] ${g.length}곳`);
  for (const o of g) {
    console.log(`  ${o.t.store.padEnd(9)} ${o.t.name.padEnd(18)} ${String(o.t.pc ?? "?").padStart(3)}대 옛 ${String(o.t.old).padStart(5)}%  → ${fmt(o.best)}`);
    if (st !== "확정") for (const r of o.all.slice(1, 3)) console.log(`      · ${fmt(r)}`);
  }
}
writeFileSync(new URL(".local-tools/pingbot-match.json", root), JSON.stringify(out.map((o) => ({ store: o.t.store, code: o.t.code, name: o.t.name, pc: o.t.pc, old: o.t.old, oldP: o.t.oldP, status: o.status, best: o.best, second: o.second })), null, 1));
