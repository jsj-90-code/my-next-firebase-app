// Offline audit. No network, database writes, or production setting changes.
// Fixed scenarios, not parameter search. Cached AI provenance is reported explicitly.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareRecomputeInputs, recomputeCandidates } from "./dailyRecompute";
import { recomputeSourceFromSnapshot } from "./validationSnapshot";
import { computeStabilizedPerformance, computeCompetitorInvestigationSummary, type ValidationStoreInput } from "./calc";
import { PAID_GAME_SURCHARGE, existingStoreSourceCode } from "./existingStoreEvaluation";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { qscInWindowAverage } from "./labInput";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import type { KakaoPcBangPlace } from "./quickEval/kakaoPcBangs";
import { buildQuickCandidate, buildQuickLocationEvaluation, blankCompetitorForTraining, type QuickEvalPlanInput } from "./quickEval/buildQuickCandidate";
import { QUICK_EVAL_ENTRY_THRESHOLD_WON, withQuickEvalSettings } from "./quickEval/quickEvalDefaults";
import { quickEvalFinalEstimate } from "./quickEval/quickEvalVerdict";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { labCandidateBreakdown, rangeFlagsFor, v62TrainingRange } from "./dualEstimate";
import type { Competitor, ExistingStore, LocationEvaluation } from "./types";


const cachePath = ".local-tools/ai-location-backtest.from-quickeval-drafts-20260928.json";
const available = hasValidationSnapshot() && existsSync(cachePath) && existsSync(".local-tools/kakao-neighborhood.json");
const describeIf = available ? describe : describe.skip;
describeIf("2026-09-29 offline decision audit", () => {
  if (!available) { it("requires local snapshot and cached observations", () => {}); return; }
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const raw: ExistingStore[] = snap.existingStores;
  const competitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const locations: LocationEvaluation[] = snap.locationEvaluations;
  const wanted = new Set(evaluationSalesIds(raw));
  const sales = snap.sales.filter((s: { storeCode: string; yearMonth: string }) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
  const qscScores = prepareRecomputeInputs(recomputeSourceFromSnapshot(snap)).qscByStoreCode;
  const kakao = JSON.parse(readFileSync(".local-tools/kakao-neighborhood.json", "utf8")).sites as Record<string, { pcRooms: { docs: { name: string; category?: string; lat: number; lng: number; distanceM: number; address?: string; id?: string }[] } }>;
  const core = raw.filter((s) => s.brandType === "블랙라벨" && !s.excludedFromModel && (s.actualMonthlyRevenueAvg ?? 0) > 0 && s.lat != null && s.lng != null);
  const humanLoc = (s: ExistingStore) => locations.find((l) => l.candidateCode === (s as unknown as { sourceCode?: string }).sourceCode || l.candidateCode === s.storeCode) ?? null;

  // _addressOnlyDual.test.ts buildFor와 같다(주소만 조건 재현).
  const pcBangsFor = (s: ExistingStore): KakaoPcBangPlace[] => (kakao[`existing:${s.storeCode}`]?.pcRooms?.docs ?? [])
    .filter((d) => d.distanceM <= 500 && !(d.distanceM < 30 && /블랙라벨/.test(d.name)))
    .map((d, i) => ({ id: d.id ?? `${s.storeCode}_${i}`, name: d.name, categoryName: d.category ?? null, address: d.address ?? null, lat: d.lat, lng: d.lng, distanceM: d.distanceM }));
  const planFor = (s: ExistingStore): QuickEvalPlanInput => ({
    name: s.storeName, address: s.address ?? "", expectedPcCount: s.evaluationPcCount ?? s.pcCount, hourlyRate: s.hourlyRate,
    floor: s.floor ?? null, groundLevel: s.groundLevel ?? null, hasElevator: s.hasElevator ?? null, ownFoodBrand: null, plannedOpenMonth: null,
  });
  const buildFor = (s: ExistingStore) => {
    const r = s as any;
    const ages = [r.age1km_0_9, r.age1km_10_19, r.age1km_20_29, r.age1km_30_39, r.age1km_40_49, r.age1km_50_59, r.age1km_60_69, r.age1km_70_79, r.age1km_80plus];
    const built = buildQuickCandidate(planFor(s), {
      geocode: { lat: s.lat as number, lng: s.lng as number, roadAddress: null, jibunAddress: null, buildingName: null },
      sgis: { baseYear: "2024", byRadius: {
        500: { radiusM: 500, totalPopulation: r.pop500m ?? null, malePopulation: null, femalePopulation: null, ageBands: [], areaSizeM2: null, areaOffRatio: 0 },
        1000: { radiusM: 1000, totalPopulation: r.pop1km ?? null, malePopulation: r.pop1km && r.male1kmRatio != null ? Math.round(r.pop1km * r.male1kmRatio) : null, femalePopulation: null, ageBands: ages, areaSizeM2: r.area1kmKm2 ? r.area1kmKm2 * 1e6 : null, areaOffRatio: 0 },
      } },
      floating: r.floating500Avg ? { radiusM: 500, avg: r.floating500Avg, months: [], monthly: [], scale: 1, admiCd: "", admiNm: "",
        scaled: { total: r.floating500Avg, male: r.floating500Male ?? 0, female: 0, age10s: r.floating500_10s ?? 0, age20s: r.floating500_20s ?? 0, age30s: r.floating500_30s ?? 0, age40s: r.floating500_40s ?? 0, age50s: r.floating500_50s ?? 0, age60plus: r.floating500_60plus ?? 0 } } : null,
      pcBangs: pcBangsFor(s), pcBangsPossiblyTruncated: false,
    });
    const cand = { ...built.candidate } as any;
    for (const rad of [100, 200, 300, 400]) for (const k of ["Avg", "Male", "_10s", "_20s", "_30s", "_40s", "_50s", "_60plus"]) cand[`floating${rad}${k}`] = r[`floating${rad}${k}`] ?? null;
    cand.floating1000Avg = r.floating1000Avg ?? null;
    return { candidate: cand, competitors: built.competitors };
  };


  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  const T = QUICK_EVAL_ENTRY_THRESHOLD_WON;
  const median = (xs: number[]) => { const a = [...xs].sort((a,b)=>a-b); return a.length ? (a[(a.length-1)>>1]+a[a.length>>1])/2 : null; };
  const stats = (rs: any[], key = "value") => {
    const valid = rs.filter(r => r[key] != null && Number.isFinite(r[key]));
    const fp = valid.filter(r => r[key] > T && r.actual <= T).length;
    const fn = valid.filter(r => r[key] <= T && r.actual > T).length;
    return { n: valid.length, missing: rs.length-valid.length, correct: valid.length-fp-fn, fp, fn,
      mape: valid.reduce((s,r)=>s+Math.abs(r[key]/r.actual-1),0)/valid.length*100 };
  };
  const run = (s: ExistingStore, mode: string, cutoff?: string) => {
    expect(cache[s.storeCode]?.fields).toBeTruthy();
    const built = buildFor(s);
    let loc = buildQuickLocationEvaluation(planFor(s), { fields: cache[s.storeCode].fields });
    if (mode === "human") loc = humanLoc(s) ? { ...humanLoc(s)!, candidateCode: built.candidate.code } : null;
    const field = mode.split(":")[1];
    if (mode.startsWith("human:") && loc) loc = { ...loc, [field]: (humanLoc(s) as any)?.[field] ?? (loc as any)[field] };
    if (mode.startsWith("score:") && loc) {
      const [, key, delta] = mode.split(":");
      loc = { ...loc, [key]: Math.max(1, Math.min(5, ((loc as any)[key] ?? 3) + Number(delta))) };
    }
    if (mode === "paid") built.candidate.hourlyRate = (s.hourlyRate ?? 0) + (PAID_GAME_SURCHARGE.get(s.storeCode) ?? 0);
    if (mode.startsWith("rival:")) built.competitors = built.competitors.map(c => ({ ...c, appliedPcCount: (c.appliedPcCount ?? 90) * Number(mode.split(":")[1]) }));
    let others = raw.filter(x => x.storeCode !== s.storeCode && (!cutoff || (x.openedAt && x.openedAt.slice(0,7) <= cutoff)));
    let salesO = sales.filter((x: any) => others.some(s=>s.storeCode===x.storeCode));
    let qsc = mode === "legacy" ? undefined : qscScores;
    if (cutoff && mode === "censored") {
      salesO = salesO.filter((r: any)=>r.yearMonth <= cutoff);
      others = others.map(st => {
        const [oy,om] = st.openedAt!.slice(0,7).split("-").map(Number);
        const perf = computeStabilizedPerformance(salesO.filter((r: any)=>r.storeCode===st.storeCode).map((r: any)=>{
          const [y,m] = r.yearMonth.split("-").map(Number);
          return {...r, elapsedMonths: (y-oy)*12+m-om};
        }));
        return {...st, ...perf};
      });
      qsc = new Map<string, number>();
      for (const d of snap.qscScores ?? []) {
        const rec = (d.records ?? []).filter((r: any)=>r.date.replace(/\./g,"-").slice(0,7)<=cutoff);
        const avg = qscInWindowAverage(rec, d.openedAt ?? null);
        if (avg != null) qsc.set(d.storeCode,avg);
      }
      expect(salesO.every((r: any)=>r.yearMonth<=cutoff)).toBe(true);
    }
    expect(others.some(x=>x.storeCode===s.storeCode)).toBe(false);
    expect(salesO.some((x: any)=>x.storeCode===s.storeCode)).toBe(false);
    const screen = evaluateCandidate({ candidate: built.candidate, competitors: built.competitors,
      locationEvaluation: loc, settings: withQuickEvalSettings(settings), existingStores: others,
      trainingLocationEvaluations: locations, trainingCompetitors: competitors.map(blankCompetitorForTraining),
      trainingSales: salesO, trainingQscScores: qsc });
    const preparedO = prepareExistingStoresForEvaluation(others,competitors,locations,settings);
    const range = v62TrainingRange(preparedO);
    // Keep historical lab wiring for controlled comparison; expose null instead of hiding failures.
    const lab = labCandidateBreakdown({candidate:built.candidate, preparedStores:preparedO,rawStores:others,
      competitors:[...competitors,...built.competitors],locations:loc?[...locations,loc]:locations,
      sales:salesO,settings})?.monthlyRevenue ?? null;
    const flags = range ? rangeFlagsFor(screen,range) : [];
    const fin = quickEvalFinalEstimate(screen.v62Final,lab,flags);
    const pool=others.filter(st=>st.brandType==="블랙라벨"&&!st.excludedFromModel&&(st.actualMonthlyRevenueAvg??0)>0);
    const perPc=median(pool.filter(st=>(st.evaluationPcCount??st.pcCount??0)>0).map(st=>st.actualMonthlyRevenueAvg!/(st.evaluationPcCount??st.pcCount)!));
    return {code:s.storeCode,name:s.storeName,opened:s.openedAt,actual:s.actualMonthlyRevenueAvg!,value:fin.value,
      v62:screen.v62Final,lab,source:fin.source,far:flags.some(f=>f.far),fallback:screen.v61IsFallback,
      train:screen.v61TrainedModelExplain?.sampleCount ?? null,
      baseline:perPc==null?null:perPc*(s.evaluationPcCount??s.pcCount??0),
      majority:pool.filter(st=>st.actualMonthlyRevenueAvg!>T).length>pool.length/2 ? T+1:T,
      futureSales:cutoff?salesO.filter((r:any)=>r.yearMonth>cutoff).length:0};
  };
  it("reproduce, isolate wiring effects, and evaluate prespecified inspection scenarios", () => {
    const modes=["legacy","current","paid","human","human:preemptionScore","human:visibilityScore","human:inflowRestriction",
      "score:preemptionScore:-1","score:preemptionScore:1","score:visibilityScore:-1","score:visibilityScore:1","rival:0.5","rival:1.5"];
    const results=Object.fromEntries(modes.map(m=>[m,core.map(s=>run(s,m))]));
    const summary=Object.fromEntries(modes.map(m=>[m,stats(results[m])]));
    const base=results.current;
    const flags=base.map((r,i)=>{
      const changed=modes.filter(m=>m.startsWith("score:")||m.startsWith("rival:")).filter(m=>results[m][i].value!=null&&(results[m][i].value!>T)!==(r.value!>T));
      return {...r,wrong:(r.value!>T)!==(r.actual>T),sensitive:changed,near5:r.value!=null&&Math.abs(r.value/T-1)<=0.05};
    });
    const inspections=["near5","sensitive"].map(k=>{
      const selected=flags.filter(r=>k==="near5"?r.near5:r.sensitive.length>0);
      return {rule:k,checked:selected.length,errorsCaught:selected.filter(r=>r.wrong).length,
        fpCaught:selected.filter(r=>r.wrong&&r.value!>T).length,correctFlagged:selected.filter(r=>!r.wrong).length};
    });
    const report={snapshot:snap.fetchedAt,cachePath,summary,baseline:stats(base,"baseline"),majority:stats(base,"majority"),inspections,rows:flags,results};
    writeFileSync(".local-tools/decision-audit-20260929.json",JSON.stringify(report,null,2));
    console.log(JSON.stringify({summary,baseline:report.baseline,majority:report.majority,inspections,wrong:flags.filter(r=>r.wrong)},null,2));
    expect(core.length).toBe(40);
    expect(base.every(r=>r.value!=null&&!r.fallback)).toBe(true);
  },120000);
  it("opening cohorts versus revenue/QSC censored at cutoff; current features remain retrospective", () => {
    const results=[];
    for(const cutoff of ["2024-06","2024-12","2025-06"]){
      const targets=core.filter(s=>s.openedAt&&s.openedAt.slice(0,7)>cutoff);
      for(const mode of ["current","censored"]){
        const rows=targets.map(s=>run(s,mode,cutoff));
        results.push({cutoff,mode,stats:stats(rows),baseline:stats(rows,"baseline"),majority:stats(rows,"majority"),rows});
      }
    }
    writeFileSync(".local-tools/decision-time-audit-20260929.json",JSON.stringify({snapshot:snap.fetchedAt,results},null,2));
    console.log(JSON.stringify(results.map(({rows,...rest})=>({...rest,fallbacks:rows.filter(r=>r.fallback).length,futureSales:rows[0]?.futureSales})),null,2));
    expect(results.every(r=>r.mode!=="censored"||r.rows.every(x=>x.futureSales===0))).toBe(true);
  },120000);
  it("precise V62: opening cohort split and censored training outcomes on identical target stores", () => {
    const reports=[];
    for (const cutoff of [null,"2024-06","2024-12","2025-06"]) for (const stage of cutoff?["none","sales","salesAndQsc"]:["none"]) {
      const censored=stage!=="none";
      const before = cutoff ? new Set(raw.filter(s=>s.openedAt && s.openedAt.slice(0,7)<=cutoff).map(s=>s.storeCode)) : undefined;
      const qs=new Map(qscScores);
      if(stage==="salesAndQsc") {
        qs.clear();
        for(const d of snap.qscScores??[]) {
          const avg=qscInWindowAverage((d.records??[]).filter((r:any)=>r.date.replace(/\./g,"-").slice(0,7)<=cutoff!),d.openedAt??null);
          if(avg!=null) qs.set(d.storeCode,avg);
        }
      }
      const trainSales=sales.filter((r:any)=>!censored||!before!.has(r.storeCode)||r.yearMonth<=cutoff!);
      const adjusted=raw.map(st=>{
        if(!censored||!before!.has(st.storeCode)) return st;
        const [oy,om]=st.openedAt!.slice(0,7).split("-").map(Number);
        const perf=computeStabilizedPerformance(trainSales.filter((r:any)=>r.storeCode===st.storeCode).map((r:any)=>{
          const [y,m]=r.yearMonth.split("-").map(Number);return {...r,elapsedMonths:(y-oy)*12+m-om};
        }));
        return {...st,...perf};
      });
      const ps=prepareExistingStoresForEvaluation(adjusted,competitors,locations,settings,qs);
      const inputs:ValidationStoreInput[]=ps.map(s=>{
        const lk=existingStoreSourceCode(s), loc=locations.find(l=>l.candidateCode===lk), cs=competitors.filter(c=>c.candidateCode===lk);
        return {storeCode:s.storeCode,storeName:s.storeName,brand:s.brandType,openedAt:s.openedAt,completedMonths:s.completedMonths??0,
          franchiseStatus:s.franchiseStatus,isPostOpenIssue:s.excludedFromModel,postOpenIssueReason:s.excludedReason,
          pcCount:s.pcCount,evaluationPcCount:s.evaluationPcCount,hourlyRate:s.hourlyRate,ownDemand:s.ownDemand,marketDemand:s.marketDemand,competitorIp:s.competitorIp,
          extraPcHours:computeOverflowPcHours(s.marketDemand,{pcCount:s.evaluationPcCount??s.pcCount,competitivenessScore:s.competitivenessScore},cs,settings),
          competitivenessScore:s.competitivenessScore,competitivenessGap:s.competitivenessGap,actualRevenueAvg:s.actualMonthlyRevenueAvg,
          specialDemandType:s.specialDemandType,specialDemandIntensity:s.specialDemandIntensity,inflowRestriction:loc?.inflowRestriction??null,
          visibilityScore:loc?.visibilityScore??null,preemptionScore:loc?.preemptionScore??null,hasLocationEvaluation:!!loc,
          floor:s.floor,groundLevel:s.groundLevel,hasElevator:s.hasElevator,competitorSummary:computeCompetitorInvestigationSummary(cs),sheetV61Predicted:s.v61Predicted};
      });
      const result=runUsageCohortValidation(inputs,trainSales,settings,new Date(snap.fetchedAt),undefined,undefined,1,undefined,before);
      const rows=result.rows.filter(r=>r.brand==="블랙라벨"&&r.includedInCoreAccuracy&&(!before||!before.has(r.storeCode))).map(r=>{
        const target=raw.find(s=>s.storeCode===r.storeCode)!;
        const pool=adjusted.filter(s=>s.storeCode!==r.storeCode&&s.brandType==="블랙라벨"&&!s.excludedFromModel&&(s.actualMonthlyRevenueAvg??0)>0&&(!before||before.has(s.storeCode)));
        const m=median(pool.filter(s=>(s.evaluationPcCount??s.pcCount??0)>0).map(s=>s.actualMonthlyRevenueAvg!/(s.evaluationPcCount??s.pcCount)!));
        return {code:r.storeCode,name:r.storeName,actual:r.actualRevenueAvg!,value:r.v62PredictedRevenueAvg,baseline:m==null?null:m*(target.evaluationPcCount??target.pcCount??0)};
      });
      reports.push({cutoff,stage,censored,stats:stats(rows),baseline:stats(rows,"baseline"),train:result.fullModel?.sampleCount,rows});
    }
    writeFileSync(".local-tools/decision-precise-audit-20260929.json",JSON.stringify({snapshot:snap.fetchedAt,reports},null,2));
    console.log(JSON.stringify(reports.map(r=>({cutoff:r.cutoff,stage:r.stage,censored:r.censored,stats:r.stats,baseline:r.baseline,train:r.train})),null,2));
    expect(reports[0].rows.length).toBe(40);
    expect(reports.every(r=>r.rows.every(x=>x.value!=null))).toBe(true);
  },120000);
  it("candidate inspection priorities from current production calculation, without writes", () => {
    const source=recomputeSourceFromSnapshot(snap);
    const original=JSON.stringify(source);
    const baseline=recomputeCandidates(source);
    const rows=baseline.map(b=>{
      const loc=source.locationEvaluations.find(l=>l.candidateCode===b.code);
      const variations=[];
      for(const field of ["preemptionScore","visibilityScore"] as const) for(const delta of [-1,1]) {
        if(loc?.[field]==null) continue;
        const score=Math.max(1,Math.min(5,loc[field]!+delta));
        const changed={...source,candidates:source.candidates.filter(c=>c.code===b.code),
          locationEvaluations:source.locationEvaluations.map(l=>l.candidateCode===b.code?{...l,[field]:score}:l)};
        const r=recomputeCandidates(changed)[0].after;
        const value=r.dualEstimate?.primaryValue??r.v62Final;
        const base=b.after.dualEstimate?.primaryValue??b.after.v62Final;
        variations.push({field,from:loc[field],to:score,value,source:r.dualEstimate?.primary,
          flip:base!=null&&value!=null&&(base>T)!==(value>T)});
      }
      return {code:b.code,name:b.name,value:b.after.dualEstimate?.primaryValue??b.after.v62Final,
        source:b.after.dualEstimate?.primary,variations};
    });
    writeFileSync(".local-tools/decision-candidate-audit-20260929.json",JSON.stringify({snapshot:snap.fetchedAt,rows},null,2));
    console.log(JSON.stringify(rows.filter(r=>r.variations.some(v=>v.flip)),null,2));
    expect(JSON.stringify(source)).toBe(original);
    expect(rows.length).toBe(15);
  },120000);
});
