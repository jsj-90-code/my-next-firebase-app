// 다우오피스 전략점포 심사글 → 신규 후보지 등록을 한 번에 돌린다(2026-10-15, 사용자 "링크 주면 알아서 등록").
// 스킬 .claude/skills/daou-candidate/SKILL.md가 부른다. 화면에서 사람이 누르는 순서를 그대로 따른다:
//   create      — 기본정보 저장(코드 발급 · 변경기록). 기본값은 화면과 같은 blankCandidate.
//   collect     — "상권자료 수집"(좌표 · 카카오 경쟁점 · 수요거점 · 2km) = collectMarketDataForCandidate(라우트와 같은 함수)
//   population  — 수집 직후 화면이 자동으로 부르는 SGIS 주거인구 · 소상공인365 유동인구. 화면은 폼에 채우고 사람이 저장하지만
//                 여기선 바로 저장한다(업로드 이력 · 변경기록은 화면과 같은 모양으로 남긴다).
//   competitors — 다우 "경쟁점 설명"을 화면의 붙여넣기 해석기(parseCompetitorNotes · applyParsedNote)로 읽어 카카오 경쟁점에 얹는다.
//                 IP는 "시작 IP + 다우 전체 대수"(사용자 2026-10-15). 이름이 하나로 안 맞으면 쓰지 않고 후보를 보여 준다.
//   ping        — 후보지 경쟁점 전부를 측정기에 올린다(화면 경쟁점 탭이 여는 순간 하는 것과 같은 규칙, registerCompetitorsToPing).
//
// 실행: DAOU_SPEC=<spec.json> npx vitest run src/lib/storeEval/_daouCandidate.test.ts --disable-console-intercept
//   spec.json — { actor, code?, candidate?, competitorText?, competitors?: [{ note, target?, ipStart? }], steps?, dryRun? }
//   결과는 spec 옆 <spec>.result.json에도 남는다. DAOU_SPEC이 없으면 건너뛴다(npm test에서 안 돈다).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const SPEC_PATH = process.env.DAOU_SPEC;

type CompetitorDirective = { note: string; target?: string | null; ipStart?: string | null };
type Spec = {
  actor: string | null;
  code?: string | null;
  candidate?: Record<string, unknown>;
  competitorText?: string | null;
  competitors?: CompetitorDirective[];
  steps?: string[];
  /** true면 경쟁점 단계에서 쓰지 않고 무엇을 쓸지만 보여 준다. */
  dryRun?: boolean;
};

function loadEnv() {
  const p = new URL("../../../.env.local", import.meta.url);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue;
    let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[t.slice(0, eq).trim()] ??= v;
  }
}

/** 상호 비교용 핵심어 — "레벨업PC방 전북군산점" → "레벨업", "티티PC (전북군산)" → "티티". */
function nameCore(name: string): string {
  const first = name.replace(/\(.*?\)/g, " ").trim().split(/\s+/)[0] ?? "";
  return first.toLowerCase().replace(/(pc방|pc|피씨방|피시방|게임존|존)$/g, "").replace(/(pc방|pc)/g, "");
}

/** "시작 IP + 대수" → "a.b.c.d~e". 같은 /24 안을 넘으면 null(사람이 확인). */
function ipRangeFrom(start: string, count: number): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/.exec(start.trim());
  if (!m || !(count >= 1)) return null;
  const first = Number(m[2]);
  const last = first + count - 1;
  return last <= 255 ? `${m[1]}.${first}~${last}` : null;
}

describe.skipIf(!SPEC_PATH)("다우 심사글 → 신규 후보지", () => {
  it("등록", { timeout: 15 * 60_000 }, async () => {
    loadEnv();
    const spec = JSON.parse(readFileSync(SPEC_PATH!, "utf8")) as Spec;
    const steps = new Set(spec.steps ?? ["create", "collect", "population", "competitors", "ping"]);
    const { adminDb } = await import("@/lib/firebase-admin");
    if (!adminDb) throw new Error("Firebase Admin 환경변수가 없다(.env.local)");
    const db = adminDb;
    const { FieldValue } = await import("firebase-admin/firestore");
    const { blankCandidate } = await import("./blankCandidate");
    const { validateCandidateInput, validateCompetitorInput } = await import("./inputValidation");
    const { collectMarketDataForCandidate } = await import("./collectMarketData");
    const { applyParsedNote, parseCompetitorNotes } = await import("./competitorNoteParse");
    const { parseIpRanges } = await import("@/lib/pingMonitor/ipRange");
    const { PASTED_IP_CHECK, PING_STORES } = await import("@/lib/pingMonitor/summary");
    const now = () => Date.now();
    const actor = spec.actor ?? null;
    const report: Record<string, unknown> = {};
    const audit = (entityType: string, entityId: string, action: string, before: unknown, after: unknown) =>
      db.collection("storeEvalAuditLog").doc().set(JSON.parse(JSON.stringify({ entityType, entityId, action, before, after, actor, at: now() })));

    // 1) 기본정보 저장 — 코드 발급 규칙은 store.ts generateNextCandidateCode와 같다(카운터 · 실제 쓰인 최대 번호 중 큰 쪽 + 1).
    let code = spec.code ?? null;
    if (steps.has("create") && !code) {
      const all = (await db.collection("storeEvalCandidates").get()).docs.map((d) => d.data() as { code: string; name?: string; address?: string });
      const input = { ...blankCandidate("new"), ...(spec.candidate ?? {}) } as ReturnType<typeof blankCandidate>;
      const errors = validateCandidateInput(input);
      if (errors.length) throw new Error(`저장 불가: ${errors.join(" / ")}`);
      const key = (s?: string) => (s ?? "").replace(/\s/g, "");
      const dup = all.filter((c) => key(c.address) === key(input.address) || key(c.name) === key(input.name));
      if (dup.length) throw new Error(`이미 같은 이름·주소 후보지: ${dup.map((d) => `${d.code} ${d.name}`).join(", ")} — spec.code로 이어서 돌릴 것`);
      const usedMax = Math.max(0, ...all.map((c) => Number(/^N(\d+)$/.exec(c.code)?.[1] ?? 0)));
      const counterRef = db.collection("storeEvalMeta").doc("candidateCodeCounter");
      code = await db.runTransaction(async (tx) => {
        const snap = await tx.get(counterRef);
        const next = Math.max(snap.exists ? (snap.data()!.value as number) ?? 0 : 0, usedMax) + 1;
        const newCode = `N${String(next).padStart(3, "0")}`;
        const ref = db.collection("storeEvalCandidates").doc(newCode);
        if ((await tx.get(ref)).exists) throw new Error(`${newCode} 이미 있음`);
        const t = now();
        const cand = JSON.parse(JSON.stringify({ ...input, code: newCode, isDraft: false, createdAt: t, updatedAt: t, updatedBy: actor }));
        tx.set(counterRef, { value: next });
        tx.set(ref, cand);
        tx.set(db.collection("storeEvalAuditLog").doc(), { entityType: "candidate", entityId: newCode, action: "생성", before: null, after: cand, actor, at: t });
        return newCode;
      });
      report.created = code;
    }
    if (!code) throw new Error("후보지 코드가 없다(spec.code 또는 create 단계 필요)");
    report.code = code;
    const candRef = db.collection("storeEvalCandidates").doc(code);

    // 2) 상권자료 수집 — 라우트와 같은 함수
    if (steps.has("collect")) {
      const r = await collectMarketDataForCandidate(db, code);
      report.collect = { status: r.status, ...r.body };
      if (r.status !== 200 || r.body.error) throw new Error(`상권자료 수집 실패: ${String(r.body.error)}`);
    }

    // 3) SGIS 주거인구 · 소상공인365 유동인구 — 화면 handleFetchSgisResident / handleFetchSbizFloating과 같은 값·같은 이력
    if (steps.has("population")) {
      const cand = (await candRef.get()).data()!;
      if (cand.lat == null || cand.lng == null) throw new Error("좌표가 없다 — collect 먼저");
      const coords = { lat: cand.lat as number, lng: cand.lng as number };
      const pop: Record<string, unknown> = {};
      const saveUpload = async (sourceType: string, fileName: string, patch: Record<string, number>, records: unknown[]) => {
        const before = (await candRef.get()).data()!;
        const after = { ...before, ...patch, updatedAt: now(), updatedBy: actor };
        await candRef.set(after);
        await audit("candidate", code!, "수정", before, after);
        const id = `${code}_${sourceType}_${now()}`;
        await db.collection("storeEvalMarketDataUploads").doc(id).set(JSON.parse(JSON.stringify({
          id, candidateCode: code, sourceType, coordAtUpload: coords, fileName, fileHash: null, pastedTable: false,
          extractedFields: records, uploadedAt: now(), uploadedBy: actor,
        })));
      };
      try {
        const { collectSgisRadiusPopulation } = await import("./quickEval/sgisRadiusPopulation");
        const { residentPatchFromSgis } = await import("./residentPopulationFromSgis");
        const result = await collectSgisRadiusPopulation(coords, [500, 1000]);
        const { patch, records, warnings } = residentPatchFromSgis(result);
        if (Object.keys(patch).length) await saveUpload("sgis_life_area", `SGIS API 자동(${result.baseYear}년 기준)`, patch, records);
        pop.sgis = { filled: Object.keys(patch).length, baseYear: result.baseYear, warnings };
      } catch (err) {
        pop.sgis = { error: err instanceof Error ? err.message : String(err) };
      }
      try {
        const { collectSbizFloating } = await import("./quickEval/sbizFloating");
        const { floatingPatchFromSbiz, SBIZ_FLOATING_RADII } = await import("./floatingPopulationFromSbiz");
        type R = (typeof SBIZ_FLOATING_RADII)[number];
        const byRadius: Partial<Record<R, Awaited<ReturnType<typeof collectSbizFloating>>>> = {};
        const errors: Partial<Record<R, string>> = {};
        for (const radius of SBIZ_FLOATING_RADII) {
          try { byRadius[radius] = await collectSbizFloating(coords, radius); } catch (e) { errors[radius] = e instanceof Error ? e.message : String(e); }
        }
        // 소상공인365는 가끔 시간 초과가 난다(N024 첫 실행 때 500m — V62가 읽는 반경). 빠진 반경만 한 번 더.
        for (const radius of SBIZ_FLOATING_RADII.filter((r) => errors[r])) {
          await new Promise((r) => setTimeout(r, 3000));
          try { byRadius[radius] = await collectSbizFloating(coords, radius); delete errors[radius]; } catch (e) { errors[radius] = e instanceof Error ? e.message : String(e); }
        }
        const { patch, records, warnings } = floatingPatchFromSbiz(byRadius, errors);
        if (Object.keys(patch).length) await saveUpload("sosangongin365", "소상공인365 자동(반경 100·200·300·400·500m·1km, 최근 12개월 평균)", patch, records);
        pop.sbiz = { filled: Object.keys(patch).length, warnings, errors };
      } catch (err) {
        pop.sbiz = { error: err instanceof Error ? err.message : String(err) };
      }
      report.population = pop;
    }

    // 4) 경쟁점 — 붙여넣기 해석기로 읽어 카카오 경쟁점에 얹는다
    type Comp = import("./types").Competitor;
    const listComps = async () => (await db.collection("storeEvalCompetitors").where("candidateCode", "==", code).get()).docs.map((d) => d.data() as Comp);
    if (steps.has("competitors") && spec.competitorText?.trim()) {
      const comps = await listComps();
      const notes = parseCompetitorNotes(spec.competitorText);
      const out: unknown[] = [];
      for (const note of notes) {
        const dir = spec.competitors?.find((d) => nameCore(d.note) === nameCore(note.name) || d.note === note.name);
        let target: Comp | null = null;
        let candidates: Comp[] = [];
        if (dir?.target) target = comps.find((c) => c.id === dir.target) ?? null;
        else {
          const core = nameCore(note.name);
          candidates = core.length >= 2 ? comps.filter((c) => nameCore(c.name).startsWith(core) || c.name.toLowerCase().replace(/\s/g, "").includes(core)) : [];
          if (candidates.length === 1) target = candidates[0];
        }
        if (!target) {
          out.push({ note: note.name, written: false, why: candidates.length ? "후보가 여럿" : "같은 상호 없음",
            candidates: (candidates.length ? candidates : comps).map((c) => ({ id: c.id, name: c.name, distanceM: c.distanceM })) });
          continue;
        }
        const filled = applyParsedNote(target, note, { overwriteName: false });
        const start = dir?.ipStart ?? (note.ipRanges ? parseIpRanges(note.ipRanges).ips[0] ?? null : null);
        const ip = start && filled.totalPcCount ? ipRangeFrom(start, filled.totalPcCount) : null;
        if (start && !ip) out.push({ note: note.name, ipWarning: `IP ${start} + ${filled.totalPcCount}대가 한 대역(…255)을 넘거나 읽을 수 없어 IP는 원문대로 둠` });
        const after = { ...filled, ipRanges: ip ?? filled.ipRanges ?? null, updatedAt: now() };
        const errors = validateCompetitorInput(after);
        if (errors.length) { out.push({ note: note.name, written: false, why: errors.join(" / ") }); continue; }
        if (!spec.dryRun) {
          await db.collection("storeEvalCompetitors").doc(target.id).set(JSON.parse(JSON.stringify(after)));
          await audit("competitor", target.id, "수정", target, after);
        }
        out.push({ note: note.name, written: !spec.dryRun, id: target.id, kakaoName: target.name, distanceM: target.distanceM,
          totalPcCount: after.totalPcCount, ipRanges: after.ipRanges, interiorScore: after.interiorScore, managementScore: after.managementScore,
          foodBrand: after.foodBrand, foodScore: after.foodScore, hourlyRateConverted: after.hourlyRateConverted });
      }
      report.competitors = { parsed: notes.length, results: out };
    }

    // 5) 측정기 — clientStore.registerCompetitorsToPing과 같은 규칙(경쟁점 전부, IP 있으면 "IP 확인 필요" 표시)
    if (steps.has("ping")) {
      const ownName = ((await candRef.get()).data()?.name as string | undefined) ?? null;
      const comps = (await listComps()).filter((c) => c.investigationStatus !== "경쟁점없음" && !/^경쟁점 없음/.test(c.name) && c.name.trim() !== "");
      const existing = (await db.collection(PING_STORES).where("ownCode", "==", code).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
      const nameKey = (s: string) => s.replace(/\s/g, "").toLowerCase();
      const res = { created: [] as string[], linked: [] as string[], ipFilled: [] as string[], ipConflict: [] as string[], ipInvalid: [] as string[], already: [] as string[] };
      for (const c of comps) {
        const ipText = c.ipRanges?.trim() ?? "";
        const parsed = ipText ? parseIpRanges(ipText) : null;
        const ip = parsed && parsed.errors.length === 0 && parsed.ips.length > 0 ? { ipRanges: ipText, ipCount: parsed.ips.length } : null;
        if (ipText && !ip) res.ipInvalid.push(c.name);
        let mine = existing.filter((p) => p.competitorId === c.id && p.isOwnStore !== true);
        if (mine.length === 0) {
          const loose = existing.find((p) => !p.competitorId && p.isOwnStore !== true && nameKey(String(p.name)) === nameKey(c.name));
          if (loose) {
            await db.collection(PING_STORES).doc(loose.id).update({ competitorId: c.id, ...(loose.distanceM == null && c.distanceM != null ? { distanceM: c.distanceM } : {}), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor });
            loose.competitorId = c.id;
            mine = [loose];
            res.linked.push(c.name);
          }
        }
        if (mine.length > 0) {
          const blank = mine.find((p) => !String(p.ipRanges ?? "").trim());
          if (!ip) { res.already.push(c.name); continue; }
          if (mine.some((p) => String(p.ipRanges ?? "").trim())) {
            if (!mine.some((p) => String(p.ipRanges).replace(/\s/g, "") === ip.ipRanges.replace(/\s/g, ""))) res.ipConflict.push(c.name); else res.already.push(c.name);
            continue;
          }
          if (blank) {
            await db.collection(PING_STORES).doc(blank.id).update({ ...ip, ipCheck: PASTED_IP_CHECK, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor });
            res.ipFilled.push(c.name);
          }
          continue;
        }
        await db.collection(PING_STORES).add({
          name: c.name.trim(), address: c.address ?? "", ipRanges: ip?.ipRanges ?? "", ipCount: ip?.ipCount ?? 0,
          pcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
          memo: ip ? "점포평가 경쟁점 · 경쟁점 정보의 IP" : "점포평가 경쟁점 · IP 미등록",
          active: true, ownCode: code, ownName, competitorId: c.id, distanceM: c.distanceM ?? null,
          ...(ip ? { ipCheck: PASTED_IP_CHECK } : {}),
          createdAt: FieldValue.serverTimestamp(), createdBy: actor, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor,
        });
        res.created.push(c.name);
      }
      report.ping = res;
    }

    writeFileSync(`${SPEC_PATH}.result.json`, JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report, null, 1));
  });
});
