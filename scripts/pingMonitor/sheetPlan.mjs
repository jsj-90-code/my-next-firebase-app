// 오픈바이저 경쟁점 조사 시트 → 경쟁점 가동률 측정기 등록 계획(2026-10-06).
// 입력: .local-tools/ping-sheet-parsed.json(_pingSheetDump → _pingSheetParse), .local-tools/validation-snapshot.json
// 출력: .local-tools/ping-sheet-plan.json — { register: [...], hold: [...] }. 쓰기는 importPlan.mjs가 한다.
// 시트엔 개점한 매장만 있다(사용자 2026-10-06 "신규후보지는 없으니까") → 기존점하고만 맞춘다.
import { readFileSync, writeFileSync } from "node:fs";

const parsed = JSON.parse(readFileSync(".local-tools/ping-sheet-parsed.json", "utf8"));
const snap = JSON.parse(readFileSync(".local-tools/validation-snapshot.json", "utf8"));
const normStore = (s) => String(s ?? "").replace(/\s/g, "").replace(/점$/, "");
const normComp = (s) => String(s ?? "").toLowerCase().replace(/\s|pc방|pc카페|피씨방|피시방|피씨|피시|pc|cafe|카페|\(.*?\)|[0-9]+호점|본점/g, "");
const toNum = (ip) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);

/** 시트 표기 → 측정기 IP대역 글자. 못 읽으면 { error }. */
function normalizeIp(raw, pc) {
  let t = String(raw).replace(/\n.*/s, "").replace(/대/g, "").trim();
  let m = t.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*\((\d{1,3})\)$/); // 1.2.3.217(87) — 시작+대수
  if (m) return { range: `${m[1]}${Number(m[2])}~${Number(m[2]) + Number(m[3]) - 1}` };
  m = t.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*[~\-]\s*$/); // 끝이 비었다 → 대수로 채운다
  if (m) return pc ? { range: `${m[1]}${Number(m[2])}~${Number(m[2]) + pc - 1}`, note: "끝 IP를 대수로 채움" } : { error: "끝 IP 없음" };
  m = t.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) return { error: "IP 하나뿐(공유기 하나로 묶인 매장 — 이 방식으론 못 잼)" };
  m = t.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*[~\-]\s*(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.)?(\d{1,3})$/);
  if (m) {
    const a = Number(m[2]), b = Number(m[3]);
    if (b < a || b > 255) return { error: `범위 이상(${t})` };
    return { range: `${m[1]}${a}~${b}` };
  }
  return { error: `못 읽음(${t})` };
}
function span(range) {
  const [s, e] = range.split("~");
  const pre = s.slice(0, s.lastIndexOf(".") + 1);
  return [toNum(s), toNum(pre + e)];
}

const own = snap.existingStores.map((s) => ({ code: s.storeCode, name: s.storeName }));
const entries = [];
const hold = [];
for (const tab of parsed) {
  if (!tab.comps.length) continue;
  const key = normStore(tab.store);
  if (key.length < 2) continue;
  const o = own.find((x) => normStore(x.name) === key) ?? own.find((x) => normStore(x.name).startsWith(key) && /\(/.test(x.name));
  if (!o) continue;
  for (const sc of tab.comps) {
    const ip = normalizeIp(sc.ip, sc.pc);
    const base = { ownCode: o.code, ownName: o.name, tab: tab.title, tabDate: tab.date, sheetName: sc.name, sheetIp: sc.ip, pc: sc.pc };
    if (ip.error) { hold.push({ ...base, reason: ip.error }); continue; }
    entries.push({ ...base, ipRanges: ip.range, ipNote: ip.note ?? null, span: span(ip.range) });
  }
}

// 같은 매장 안 같은 IP는 최신 탭 하나만(옛 조사와 겹침). 매장끼리 IP가 겹치면 시트 오기 → 보류.
entries.sort((a, b) => String(b.tabDate).localeCompare(String(a.tabDate)));
const kept = [];
for (const e of entries) {
  const same = kept.find((k) => k.ownCode === e.ownCode && k.span[0] <= e.span[1] && e.span[0] <= k.span[1]);
  if (same) continue;
  kept.push(e);
}
const clash = new Set();
for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
  const a = kept[i], b = kept[j];
  if (a.span[0] <= b.span[1] && b.span[0] <= a.span[1]) { clash.add(i); clash.add(j); }
}
const register = [];
kept.forEach((e, i) => {
  if (clash.has(i)) {
    const others = kept.filter((k, j) => j !== i && k.span[0] <= e.span[1] && e.span[0] <= k.span[1]).map((k) => `${k.ownName} ${k.sheetName}`);
    hold.push({ ...e, span: undefined, reason: `IP가 겹침: ${others.join(", ")}` });
    return;
  }
  const comps = snap.competitors.filter((c) => c.candidateCode === e.ownCode);
  const n = normComp(e.sheetName);
  const cands = comps.filter((c) => { const m = normComp(c.name); return n && m && (m.includes(n) || n.includes(m)); });
  const pcOf = (c) => c.totalPcCount ?? c.appliedPcCount ?? null;
  const match = cands.length === 1 ? cands[0] : cands.find((c) => e.pc && pcOf(c) && Math.abs(pcOf(c) - e.pc) <= e.pc * 0.1) ?? null;
  register.push({
    ownCode: e.ownCode, ownName: e.ownName,
    name: match?.name ?? e.sheetName,
    sheetName: e.sheetName,
    address: match?.address ?? "",
    ipRanges: e.ipRanges,
    pcCount: e.pc,
    distanceM: match?.distanceM ?? null,
    competitorId: match?.id ?? null,
    memo: `오픈바이저 시트 ${e.tab}${e.ipNote ? ` · ${e.ipNote}` : ""}`,
  });
});
writeFileSync(".local-tools/ping-sheet-plan.json", JSON.stringify({ register, hold }, null, 1));
console.log(`등록 ${register.length}곳(기존점 ${new Set(register.map((r) => r.ownCode)).size}곳 · 점포평가 경쟁점과 이어짐 ${register.filter((r) => r.competitorId).length}) · 보류 ${hold.length}`);
console.log("\n[보류]");
for (const h of hold) console.log(`  ${h.ownName} · ${h.sheetName} · ${String(h.sheetIp).replace(/\n/g, " ")} — ${h.reason}`);
const ipCount = register.reduce((s, r) => { const [a, b] = span(r.ipRanges); return s + b - a + 1; }, 0);
console.log(`\nIP 합계 ${ipCount}개`);
