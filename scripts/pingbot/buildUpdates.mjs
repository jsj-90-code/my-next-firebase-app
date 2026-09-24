// pingbot-match.json → pingbot-updates.json (writePingbotUpdates.mjs --file 용). 확정 + 사람이 정한 OVERRIDE만 싣고 HOLD·핑제로·없음은 뺀다.
// ⚠️ OVERRIDE/HOLD는 2026-09-25 새벽에 사람이 본 판단이다. 다시 돌릴 때 match 표를 보고 갱신할 것.
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const m = JSON.parse(readFileSync(new URL(".local-tools/pingbot-match.json", root), "utf8"));
const all = JSON.parse(readFileSync(new URL(".local-tools/pingbot-all.json", root), "utf8")).rows;
const num = (u) => Number(String(u).replace("%", ""));
const OVERRIDE = {
  "20251107426|레벨업": { pick: (r) => /야당점/.test(r.title) && /183대/.test(r.title), note: "핑봇 페이지 '레벨업pc방 파주 야당점 183대'" },
  "20230829399|피시태그": { pick: (r) => /청주강서점/.test(r.title), note: "핑봇 페이지 '피씨태그 청주강서점 200대'" },
  "20230928403|넥스트PC": { pick: (r) => /넥스트PC방 \/ 91대/.test(r.title), note: "핑봇 페이지 '넥스트PC방 91대 화명동 6층'(90대 '넥스트피시' 66.7%는 다른 등록)" },
  "20230928403|레인PC": { pick: (r) => /레인pc 2호점/.test(r.title), note: "핑봇 페이지 '레인pc 2호점 (화명동) 84대'" },
  "N005|피에스타스토리 PC CAFE": { pick: (r) => /^피에스타스토리 \/ 101대/.test(r.title) && /삼산동/.test(r.addr), note: "핑봇 페이지 '피에스타스토리 101대 삼산동'" },
  "20240621415|앤유": { pick: (r) => /^앤유pc방 \/ 130대/.test(r.title) && /대연동/.test(r.addr), note: "핑봇 페이지 '앤유pc방 130대 대연동'(우리 기록 100대 — 대수 차이 확인 필요)" },
  "20230908401|뉴애플": { pick: (r) => /뉴애플/.test(r.title) && /남양동/.test(r.addr), note: "핑봇 페이지 '뉴애플피씨존 120대 남양동'(우리 기록 90대)" },
  "20240628416|레벨업": { pick: (r) => /레벨업pc방 송내점/.test(r.title), note: "핑봇 페이지 '레벨업pc방 송내점 96대 상동'(우리 기록 112대)" },
  "20250124422|고트PC": { pick: (r) => /고트 PC방/.test(r.title) && /증평/.test(r.addr), note: "핑봇 페이지 '고트 PC방 215대 증평읍'(우리 기록 90대 — 대수 차이 확인 필요)" },
  "20260626435|더토랑pc": { pick: (r) => /더토랑/.test(r.title) && /충무공동/.test(r.addr), note: "핑봇 페이지 '더토랑 pc 102대 충무공동'(우리 기록 83대)" },
  "20260626436|퍼닛pc 호평점": { pick: (r) => /퍼닛pc 호평역점/.test(r.title), note: "핑봇 페이지 '퍼닛pc 호평역점 150대'(우리 기록 133대 · '호평점 138대'는 핑제로)" },
  // 핑봇에 '레벌업'(오타)으로 등록돼 이름 매칭이 안 된다 — 주소(삼산동 1476-2)로 집는다.
  "N005|레벨업PC방 울산삼산점": { pick: (r) => /레벌업|레벨업/.test(r.title) && /삼산동 1476-2/.test(r.addr), note: "핑봇 페이지 '레벌업 삼산점(오타) 101대 삼산동 1476-2'" },
  // 브리즈는 등록이 둘(등촌동 263대 · 마곡점 215대) — 사용자 2026-09-25 "마곡 데이터로".
  "20251121428|브리즈PC방": { pick: (r) => /브리즈/.test(r.title) && /마곡동 723-2/.test(r.addr), note: "핑봇 페이지 '브리즈 피씨 카페(마곡점) 215대 마곡동 723-2'(우리 기록 187대)" },
};
// 사용자 2026-09-25: 신뢰 불가는 뺀다 — 치즈(두 등록, 39.2 아님)·이로운('(현재)' 78.9 가짜)·구리 불독(3대 등록). 값은 비워 둔 상태.
const HOLD = new Set(["20240621415|치즈", "20231023405|이로운", "N015|불독PC방"]);
const out = [], skipped = [];
for (const x of m) {
  const key = `${x.code}|${x.name}`;
  if (HOLD.has(key)) { skipped.push(`${x.store}/${x.name} — 보류(사람 확인)`); continue; }
  const ov = OVERRIDE[key];
  let row = null, note = "";
  if (ov) { row = all.find(ov.pick) ?? null; note = ov.note; if (!row) { skipped.push(`${x.store}/${x.name} — override 행 못 찾음`); continue; } }
  else if (x.status === "확정") { row = x.best; note = `핑봇 페이지 '${row.title.split("/").slice(0, 2).join("/").trim()}'`; }
  else { skipped.push(`${x.store}/${x.name} — ${x.status}(옛 값 유지)`); continue; }
  const v = num(row.util);
  if (!(v > 0)) { skipped.push(`${x.store}/${x.name} — 핑제로(옛 값 유지)`); continue; }
  out.push({ candidateCode: x.code, name: x.name, value: v, note: `${note} · ${row.addr}` });
}
writeFileSync(new URL(".local-tools/pingbot-updates.json", root), JSON.stringify(out, null, 1));
console.log(`반영 ${out.length}곳 · 건너뜀 ${skipped.length}곳 → .local-tools/pingbot-updates.json`);
for (const s of skipped) console.log("  ·", s);
