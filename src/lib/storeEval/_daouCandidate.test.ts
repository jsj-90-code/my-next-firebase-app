// 다우오피스 전략점포 심사글 → 신규 후보지 등록을 한 번에 돌린다(2026-10-15, 사용자 "링크 주면 알아서 등록").
// 스킬 .claude/skills/daou-candidate/SKILL.md가 부른다. 화면에서 사람이 누르는 순서를 그대로 따른다:
//   create      — 기본정보 저장(코드 발급 · 변경기록). 기본값은 화면과 같은 blankCandidate.
//   collect     — "상권자료 수집"(좌표 · 카카오 경쟁점 · 수요거점 · 2km) = collectMarketDataForCandidate(라우트와 같은 함수)
//   population  — 수집 직후 화면이 자동으로 부르는 SGIS 주거인구 · 소상공인365 유동인구. 화면은 폼에 채우고 사람이 저장하지만
//                 여기선 바로 저장한다(업로드 이력 · 변경기록은 화면과 같은 모양으로 남긴다).
//   competitors — 다우 "경쟁점 설명"을 화면의 붙여넣기 해석기(parseCompetitorNotes · applyParsedNote)로 읽어 카카오 경쟁점에 얹는다.
//                 IP는 "시작 IP + 다우 전체 대수"(사용자 2026-10-15). 이름이 하나로 안 맞으면 쓰지 않고 후보를 보여 준다.
//   elevator    — 건축물대장 엘리베이터만 다시(키 없이 collect를 돌렸을 때). 기본 단계엔 없다 — collect가 이미 한다.
//   ping        — 후보지 경쟁점 전부를 측정기에 올린다(화면 경쟁점 탭이 여는 순간 하는 것과 같은 규칙, registerCompetitorsToPing).
//
// 실행: DAOU_SPEC=<spec.json> npx vitest run src/lib/storeEval/_daouCandidate.test.ts --disable-console-intercept
//   spec.json — { actor, code?, candidate?, competitorText?, competitors?: [{ note, target?, ipStart? }], steps?, dryRun? }
//   결과는 spec 옆 <spec>.result.json에도 남는다. DAOU_SPEC이 없으면 건너뛴다(npm test에서 안 돈다).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it, vi } from "vitest";

// 측정기 사내 저장소(internalStore.ts)가 "server-only"를 부른다 — 하네스에선 막을 이유가 없다(2026-11-03).
vi.mock("server-only", () => ({}));

const SPEC_PATH = process.env.DAOU_SPEC;

// create: 카카오에 없는 다우 경쟁점을 새로 만든다(2026-11-04 사용자 "카카오에 없어도 다우에 있음 올려야"). 다우 주소로 좌표·거리를 잡고,
// 주소를 못 찾으면 만들지 않고 보고한다(거리 없는 경쟁점은 계산에서 조용히 빠지므로).
type CompetitorDirective = { note: string; target?: string | null; ipStart?: string | null; create?: boolean };
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
    const warnings: string[] = [];
    if ((steps.has("collect") || steps.has("elevator")) && !process.env.BUILDING_REGISTRY_API_KEY)
      warnings.push("BUILDING_REGISTRY_API_KEY가 이 PC .env.local에 없어 건축물대장 엘리베이터 추천값이 비게 된다 — 키를 넣고 steps [\"elevator\"]로 다시");
    report.warnings = warnings;
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

    // 3-1) 건축물대장만 다시 — collectMarketData와 같은 규칙: 근거(basis)는 늘 쓰고, 엘리베이터 칸은 비어 있을 때만 "있음"으로.
    if (steps.has("elevator")) {
      const { lookupBuildingElevator } = await import("./buildingElevator");
      const cand = (await candRef.get()).data()!;
      const elev: Record<string, unknown> = {};
      if (cand.lat != null && cand.lng != null) {
        try {
          const e = await lookupBuildingElevator({ lat: cand.lat, lng: cand.lng });
          const after = { ...cand, elevatorBasis: e.basis, ...(e.hasElevator === true && cand.hasElevator == null ? { hasElevator: true } : {}), updatedAt: now(), updatedBy: actor };
          await candRef.set(after);
          await audit("candidate", code, "수정", cand, after);
          elev.candidate = e.basis;
        } catch (err) { elev.candidate = `실패: ${err instanceof Error ? err.message : String(err)}`; }
      }
      const comps = (await db.collection("storeEvalCompetitors").where("candidateCode", "==", code).get()).docs;
      const byComp: Record<string, string> = {};
      for (const d of comps) {
        const c = d.data();
        if (c.lat == null || c.lng == null) continue;
        try {
          const e = await lookupBuildingElevator({ lat: c.lat, lng: c.lng });
          const after = { ...c, elevatorBasis: e.basis, ...(e.hasElevator === true && c.hasElevator == null ? { hasElevator: true } : {}), updatedAt: now() };
          await d.ref.set(after);
          await audit("competitor", d.id, "수정", c, after);
          byComp[String(c.name)] = e.basis;
        } catch (err) { byComp[String(c.name)] = `실패: ${err instanceof Error ? err.message : String(err)}`; }
      }
      elev.competitors = byComp;
      report.elevator = elev;
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
        // 상호가 아예 다른 같은 가게(다우 "스타디움" ↔ 카카오 "윈드 PC방" — 간판만 바뀐 경우, 11-04 사용자): 이름으로 못 찾았고
        // 다우 주소가 있으면 그 주소에서 50m 안의 카카오 경쟁점이 딱 하나일 때 같은 가게로 본다. 이름은 카카오 것을 둔다(보고에 둘 다).
        let addrGeo: { lat: number; lng: number; roadAddress?: string | null; jibunAddress?: string | null } | null = null;
        if (!target && !dir?.create && candidates.length === 0 && note.addressLine) {
          const { geocodeAddress } = await import("@/lib/kakao");
          const { haversineDistanceMeters } = await import("./geo");
          addrGeo = await geocodeAddress(note.addressLine);
          if (addrGeo) {
            const g = addrGeo;
            const near = comps.filter((c) => c.lat != null && c.lng != null && haversineDistanceMeters({ lat: Number(c.lat), lng: Number(c.lng) }, g) <= 50);
            if (near.length === 1) {
              target = near[0];
              out.push({ note: note.name, matchedBy: `다우 주소와 같은 자리(50m 안)의 카카오 경쟁점 "${near[0].name}"` });
            }
          }
        }
        let created = false;
        if (!target && dir?.create) {
          const { blankCompetitor } = await import("./blankCompetitor");
          const { geocodeAddress } = await import("@/lib/kakao");
          const { haversineDistanceMeters } = await import("./geo");
          const cand = (await candRef.get()).data()!;
          // 위치: 다우 블록 머리의 주소 줄 → 없거나 못 찾으면 후보지 3km 안에서 상호로 카카오 키워드 검색(PC방 분류에 안 걸린 가게용,
          // 다우 글엔 주소가 없을 때가 많다 — 11-04 사용자). 키워드 결과는 상호 앞말이 맞는 가장 가까운 곳만 쓴다.
          let geo: { lat: number; lng: number; roadAddress?: string | null; jibunAddress?: string | null } | null =
            note.addressLine ? await geocodeAddress(note.addressLine) : null;
          let locatedBy = geo ? "다우 주소" : null;
          if (!geo && cand.lat != null && cand.lng != null) {
            const { searchByKeyword } = await import("@/lib/kakao");
            const core = nameCore(note.name);
            const hits = core.length >= 2
              ? (await searchByKeyword(Number(cand.lat), Number(cand.lng), note.name, 3000))
                  .filter((p) => nameCore(p.name).includes(core))
                  .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9))
              : [];
            const p = hits[0];
            if (p) {
              geo = { lat: p.lat, lng: p.lng };
              locatedBy = `카카오 키워드(${p.name})`;
            }
          }
          if (!geo || cand.lat == null || cand.lng == null) {
            out.push({ note: note.name, written: false, why: `새로 만들기 실패 — 다우 주소(${note.addressLine ?? "없음"})·카카오 상호 검색 둘 다 위치를 못 찾음` });
            continue;
          }
          out.push({ note: note.name, locatedBy });
          target = {
            ...blankCompetitor(code),
            id: `${code}_${Date.now()}`,
            source: "manual",
            address: geo.roadAddress ?? geo.jibunAddress ?? note.addressLine,
            lat: geo.lat,
            lng: geo.lng,
            distanceM: Math.round(haversineDistanceMeters({ lat: Number(cand.lat), lng: Number(cand.lng) }, geo)),
          };
          created = true;
        }
        if (!target) {
          out.push({ note: note.name, written: false, why: candidates.length ? "후보가 여럿" : "같은 상호 없음",
            daouAddress: note.addressLine ?? null, daouPcCount: note.totalPcCount ?? null,
            candidates: (candidates.length ? candidates : comps).map((c) => ({ id: c.id, name: c.name, distanceM: c.distanceM, address: c.address ?? null, totalPcCount: c.totalPcCount })) });
          continue;
        }
        const filled = applyParsedNote(target, note, { overwriteName: created });
        const start = dir?.ipStart ?? (note.ipRanges ? parseIpRanges(note.ipRanges).ips[0] ?? null : null);
        const ip = start && filled.totalPcCount ? ipRangeFrom(start, filled.totalPcCount) : null;
        if (start && !ip) out.push({ note: note.name, ipWarning: `IP ${start} + ${filled.totalPcCount}대가 한 대역(…255)을 넘거나 읽을 수 없어 IP는 원문대로 둠` });
        const after = { ...filled, ipRanges: ip ?? filled.ipRanges ?? null, updatedAt: now() };
        const errors = validateCompetitorInput(after);
        if (errors.length) { out.push({ note: note.name, written: false, why: errors.join(" / ") }); continue; }
        if (!spec.dryRun) {
          await db.collection("storeEvalCompetitors").doc(target.id).set(JSON.parse(JSON.stringify(after)));
          await audit("competitor", target.id, created ? "생성" : "수정", created ? null : target, after);
        }
        out.push({ note: note.name, written: !spec.dryRun, created, id: target.id, kakaoName: target.name, distanceM: target.distanceM,
          totalPcCount: after.totalPcCount, ipRanges: after.ipRanges, interiorScore: after.interiorScore, managementScore: after.managementScore,
          foodBrand: after.foodBrand, foodScore: after.foodScore, hourlyRateConverted: after.hourlyRateConverted });
      }
      report.competitors = { parsed: notes.length, results: out };
    }

    // 5) 측정기 — clientStore.registerCompetitorsToPing과 같은 규칙(경쟁점 전부, IP 있으면 "IP 확인 필요" 표시)
    if (steps.has("ping")) {
      // 측정기 저장소가 사내로 옮겨졌으면(PING_STORE_BACKEND=internal, 2026-11-03) 거기에 쓴다 — 규칙은 같다.
      const internal = process.env.PING_STORE_BACKEND === "internal";
      const { istore } = await import("@/lib/pingMonitor/internalStore");
      const stamp = () => (internal ? { __now: true } : FieldValue.serverTimestamp());
      const pingByOwn = async (ownCode: string) =>
        internal
          ? (await istore.list(PING_STORES, { where: [["ownCode", "==", ownCode]] })).map((d) => ({ id: d.id, ...d.data }))
          : (await db.collection(PING_STORES).where("ownCode", "==", ownCode).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
      const pingUpdate = async (id: string, data: Record<string, unknown>) =>
        internal ? istore.commit([{ op: "update", c: PING_STORES, id, data }]) : void (await db.collection(PING_STORES).doc(id).update(data));
      const pingAdd = async (data: Record<string, unknown>) => (internal ? istore.add(PING_STORES, data) : (await db.collection(PING_STORES).add(data)).id);
      const ownName = ((await candRef.get()).data()?.name as string | undefined) ?? null;
      const comps = (await listComps()).filter((c) => c.investigationStatus !== "경쟁점없음" && !/^경쟁점 없음/.test(c.name) && c.name.trim() !== "");
      const existing = (await pingByOwn(code)) as ({ id: string } & Record<string, unknown>)[];
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
            await pingUpdate(loose.id, { competitorId: c.id, ...(loose.distanceM == null && c.distanceM != null ? { distanceM: c.distanceM } : {}), updatedAt: stamp(), updatedBy: actor });
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
            await pingUpdate(blank.id, { ...ip, ipCheck: PASTED_IP_CHECK, updatedAt: stamp(), updatedBy: actor });
            res.ipFilled.push(c.name);
          }
          continue;
        }
        await pingAdd({
          name: c.name.trim(), address: c.address ?? "", ipRanges: ip?.ipRanges ?? "", ipCount: ip?.ipCount ?? 0,
          pcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
          memo: ip ? "점포평가 경쟁점 · 경쟁점 정보의 IP" : "점포평가 경쟁점 · IP 미등록",
          active: true, ownCode: code, ownName, competitorId: c.id, distanceM: c.distanceM ?? null,
          ...(ip ? { ipCheck: PASTED_IP_CHECK } : {}),
          createdAt: stamp(), createdBy: actor, updatedAt: stamp(), updatedBy: actor,
        });
        res.created.push(c.name);
      }
      report.ping = res;
    }

    writeFileSync(`${SPEC_PATH}.result.json`, JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report, null, 1));
  });
});
