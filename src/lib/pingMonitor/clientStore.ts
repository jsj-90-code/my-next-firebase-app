"use client";

// 경쟁점 가동률 측정기 — 화면에서 Firestore 읽기·쓰기(2026-10-06 신설).
// 화면이 쓰는 칸은 상호·주소·IP대역·대수·메모·측정여부뿐이다. 측정 기록(days·lastSample)은 서버만 쓴다(firestore.rules).
// Firebase 무료 요금제라 읽기를 아낀다: 목록은 매장 문서만(매장당 1번), 시간대별은 상세 화면에서 고른 기간만.

import {
  deleteDoc,
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listCandidates, listCompetitors, listExistingStores } from "@/lib/storeEval/store";
import type { Competitor } from "@/lib/storeEval/types";
import { parseIpRanges } from "./ipRange";
import { hasNoIp, PASTED_IP_CHECK, PING_DAILY, PING_STORES, type DayTotals, type PingDaily, type PingStore } from "./summary";
export { PASTED_IP_CHECK };

export type PingStoreInput = {
  name: string;
  address: string;
  ipRanges: string;
  ipCount: number;
  pcCount: number | null;
  memo: string;
  active: boolean;
  ownCode: string | null;
  ownName: string | null;
  competitorId: string | null;
  distanceM: number | null;
  lat?: number | null; // 2026-10-16 — 주소 좌표(지도·거리 자동 계산)
  lng?: number | null;
};

function toDate(v: unknown): Date | null {
  return v && typeof v === "object" && "toDate" in v ? (v as { toDate: () => Date }).toDate() : null;
}

function toStore(id: string, d: DocumentData): PingStore {
  const ls = d.lastSample;
  return {
    id,
    name: String(d.name ?? ""),
    address: String(d.address ?? ""),
    ipRanges: String(d.ipRanges ?? ""),
    ipCount: Number(d.ipCount ?? 0),
    pcCount: typeof d.pcCount === "number" ? d.pcCount : null,
    memo: String(d.memo ?? ""),
    active: d.active !== false,
    ownCode: typeof d.ownCode === "string" && d.ownCode ? d.ownCode : null,
    ownName: typeof d.ownName === "string" && d.ownName ? d.ownName : null,
    competitorId: typeof d.competitorId === "string" && d.competitorId ? d.competitorId : null,
    distanceM: typeof d.distanceM === "number" ? d.distanceM : null,
    lat: typeof d.lat === "number" ? d.lat : null,
    lng: typeof d.lng === "number" ? d.lng : null,
    isOwnStore: d.isOwnStore === true,
    ipCheck: typeof d.ipCheck === "string" && d.ipCheck ? d.ipCheck : null,
    portSwitchDate: typeof d.portSwitchDate === "string" && d.portSwitchDate ? d.portSwitchDate : null,
    excludeFromStats: d.excludeFromStats === true,
    createdAt: toDate(d.createdAt),
    createdBy: d.createdBy ?? null,
    lastSample: ls
      ? {
          at: toDate(ls.at),
          date: String(ls.date ?? ""),
          hour: String(ls.hour ?? ""),
          alive: Number(ls.alive ?? 0),
          total: Number(ls.total ?? 0),
          aliveIps: Array.isArray(ls.aliveIps) ? ls.aliveIps.map(String) : [],
          method: typeof ls.method === "string" ? ls.method : undefined,
        }
      : null,
    days: (d.days ?? {}) as Record<string, DayTotals>,
    recent: Object.fromEntries(
      Object.entries((d.recent ?? {}) as Record<string, { a?: number; t?: number; at?: unknown }>).map(([h, v]) => [
        h,
        { a: Number(v.a ?? 0), t: Number(v.t ?? 0), at: toDate(v.at) },
      ]),
    ),
  };
}

function requireDb() {
  if (!db) throw new Error("Firebase 설정이 없습니다.");
  return db;
}

export async function listPingStores(): Promise<PingStore[]> {
  const snap = await getDocs(collection(requireDb(), PING_STORES));
  return snap.docs.map((d) => toStore(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 우리 매장 하나(기존점 가맹점코드·후보지 N0xx)에 붙은 등록 전부 — 매장별 비교 화면(2026-10-07). */
export async function listPingStoresByOwn(ownCode: string): Promise<PingStore[]> {
  const snap = await getDocs(query(collection(requireDb(), PING_STORES), where("ownCode", "==", ownCode)));
  return snap.docs.map((d) => toStore(d.id, d.data()));
}

export async function getPingStore(id: string): Promise<PingStore | null> {
  const snap = await getDoc(doc(requireDb(), PING_STORES, id));
  return snap.exists() ? toStore(snap.id, snap.data()) : null;
}

export async function createPingStore(input: PingStoreInput, email: string | null, extra: { ipCheck?: string | null } = {}): Promise<string> {
  const ref = await addDoc(collection(requireDb(), PING_STORES), {
    ...input,
    ...(extra.ipCheck ? { ipCheck: extra.ipCheck } : {}),
    createdAt: serverTimestamp(),
    createdBy: email,
    updatedAt: serverTimestamp(),
    updatedBy: email,
  });
  return ref.id;
}

/** IP대역을 바꿔 저장하면 "IP 확인 필요" 표시를 지운다(clearIpCheck). */
export async function updatePingStore(id: string, input: PingStoreInput, email: string | null, opts: { clearIpCheck?: boolean } = {}): Promise<void> {
  await updateDoc(doc(requireDb(), PING_STORES, id), {
    ...input,
    ...(opts.clearIpCheck ? { ipCheck: null } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: email,
  });
}

/** from~to(포함) 날짜의 시간별 기록. 문서 id가 `{매장id}_{날짜}`라 id 범위로 한 번에 읽는다(색인 불필요). */
export async function listPingDaily(storeId: string, from: string, to: string): Promise<PingDaily[]> {
  const q = query(
    collection(requireDb(), PING_DAILY),
    where(documentId(), ">=", `${storeId}_${from}`),
    where(documentId(), "<=", `${storeId}_${to}`),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return { storeId: String(data.storeId ?? storeId), date: String(data.date ?? ""), hours: data.hours ?? {} };
  });
}

export type CustomOwnKind = "기존점" | "후보지";
/** lat·lng — 점포평가 좌표(가까운 순 정렬·근처 묶음 찾기, 2026-10-24). 직접 입력 묶음은 좌표가 없어 화면이 소속 경쟁점 좌표로 메운다. */
export type OwnStoreOption = { code: string; name: string; kind: "기존점" | "후보지"; custom?: boolean; lat?: number | null; lng?: number | null };

/**
 * 점포평가에 없는 우리 매장을 이름만 적어 묶는 코드(2026-10-14 타부서 공유 — 점포평가엔 일부 매장만 있어서).
 * 기존점(숫자)·후보지(N0xx)와 안 겹치게 접두사를 붙이고, 기존점/신규후보지 칸을 접두사로 가른다.
 */
const CUSTOM_PREFIX: Record<CustomOwnKind, string> = { 기존점: "직접기존:", 후보지: "직접후보:" };
export const customOwnCode = (kind: CustomOwnKind, name: string) => CUSTOM_PREFIX[kind] + name.replace(/\s+/g, " ").trim();
export const isCustomOwnCode = (code: string) => code.startsWith("직접");
export const isCustomCandidateCode = (code: string) => code.startsWith(CUSTOM_PREFIX.후보지);

/** 우리 매장 고르기 목록 — 기존점(가맹점코드) + 진행 중인 후보지 + 누군가 직접 입력해 둔 매장명. 기존점으로 전환된 후보지는 기존점 쪽만 남긴다. */
export async function listOwnStoreOptions(): Promise<OwnStoreOption[]> {
  const [existing, candidates, custom] = await Promise.all([
    listExistingStores(),
    listCandidates(),
    getDocs(query(collection(requireDb(), PING_STORES), where("ownCode", ">=", "직접"), where("ownCode", "<", "직접\uf8ff"))),
  ]);
  const existingNames = new Set(existing.map((s) => s.storeName.replace(/\s/g, "")));
  const customNames = new Map(custom.docs.map((d) => [String(d.get("ownCode")), String(d.get("ownName") ?? "") || String(d.get("ownCode"))]));
  return [
    ...[...customNames]
      .map(([code, name]) => ({ code, name, kind: isCustomCandidateCode(code) ? ("후보지" as const) : ("기존점" as const), custom: true }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    ...existing
      .map((s) => ({ code: s.storeCode, name: s.storeName, kind: "기존점" as const, lat: s.lat ?? null, lng: s.lng ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    ...candidates
      .filter((c) => c.reviewStatus !== "종료" && !existingNames.has(c.name.replace(/\s/g, "")))
      .map((c) => ({ code: c.code, name: c.name, kind: "후보지" as const, lat: c.lat ?? null, lng: c.lng ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  ];
}

export type CompetitorOption = {
  id: string;
  name: string;
  address: string;
  distanceM: number | null;
  pcCount: number | null;
};

/** 그 매장에 점포평가로 등록된 경쟁점 — 등록 칸에서 골라 상호·대수·거리를 채운다. */
export async function listCompetitorOptions(ownCode: string): Promise<CompetitorOption[]> {
  const rows = await listCompetitors(ownCode);
  return rows
    .map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address ?? "",
      distanceM: c.distanceM,
      pcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
    }))
    .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
}

export type TransferResult = { moved: number; linked: string[] };

/**
 * 직접 입력 매장(직접기존:·직접후보:) 묶음을 점포평가 매장(기존점 가맹점코드·후보지 N0xx)으로 통째로 옮긴다(2026-10-14 사용자 —
 * 타부서가 먼저 측정기에 이름만 적어 둔 뒤 점포평가에 후보지를 등록하는 경우). 문서 id는 그대로라 측정 기록이 이어진다.
 * 같은 상호(띄어쓰기 무시)의 점포평가 경쟁점이 하나뿐이면 competitorId로 이어 준다 — 그래야 경쟁점 탭 "측정기에 등록"이 중복을 안 만든다.
 */
export async function transferCustomOwn(fromCode: string, to: { code: string; name: string }, email: string | null): Promise<TransferResult> {
  if (!isCustomOwnCode(fromCode)) throw new Error("직접 입력한 매장만 옮길 수 있습니다.");
  if (isCustomOwnCode(to.code)) throw new Error("점포평가에 등록된 매장을 골라 주세요.");
  const [rows, competitors, already] = await Promise.all([listPingStoresByOwn(fromCode), listCompetitors(to.code), listPingStoresByOwn(to.code)]);
  const key = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const taken = new Set(already.map((s) => s.competitorId).filter(Boolean));
  const result: TransferResult = { moved: 0, linked: [] };
  const batch = writeBatch(requireDb());
  for (const s of rows) {
    const same = competitors.filter((c) => key(c.name) === key(s.name));
    const link = !s.competitorId && same.length === 1 && !taken.has(same[0].id) ? same[0] : null;
    if (link) {
      taken.add(link.id);
      result.linked.push(s.name);
    }
    batch.update(doc(requireDb(), PING_STORES, s.id), {
      ownCode: to.code,
      ownName: to.name,
      ...(link ? { competitorId: link.id, ...(s.distanceM == null && link.distanceM != null ? { distanceM: link.distanceM } : {}) } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: email,
    });
    result.moved++;
  }
  await batch.commit();
  return result;
}

/**
 * 점포평가 경쟁점 id들에 이어진 측정기 문서만 읽는다(후보지 경쟁점 탭, 2026-10-07).
 * 전체 목록을 읽지 않으려고 competitorId in [...]으로 10개씩 나눠 묻는다. 결과는 경쟁점 id별로 묶는다.
 */
export async function listPingStoresByCompetitorIds(ids: string[]): Promise<Map<string, PingStore[]>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, PingStore[]>();
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const snap = await getDocs(query(collection(requireDb(), PING_STORES), where("competitorId", "in", chunk)));
    for (const d of snap.docs) {
      const s = toStore(d.id, d.data());
      if (!s.competitorId) continue;
      out.set(s.competitorId, [...(out.get(s.competitorId) ?? []), s]);
    }
  }
  return out;
}

/**
 * 점포평가에서 경쟁점을 지울 때 측정기 쪽 정리(2026-10-14 제주연동점 — 경쟁점은 지웠는데 탭 열 때 자동으로 올라간 빈 항목이 측정기에 남았다).
 * IP도 없고 한 번도 안 잰 빈 항목만 지운다(보안 규칙도 그것만 허용). IP·측정 기록이 있으면 아까운 자료라 남기고 이름을 돌려준다.
 * 반대 방향(측정기에서 지운다고 점포평가 경쟁점을 지우는 것)은 하지 않는다 — 개점 시점 평가 자료다.
 */
export async function removePingPlaceholdersForCompetitor(competitorId: string): Promise<{ deleted: number; kept: string[] }> {
  const linked = ((await listPingStoresByCompetitorIds([competitorId])).get(competitorId) ?? []).filter((s) => !s.isOwnStore);
  const empty = linked.filter((s) => hasNoIp(s) && Object.keys(s.days ?? {}).length === 0);
  await Promise.all(empty.map((s) => deleteDoc(doc(requireDb(), PING_STORES, s.id))));
  return { deleted: empty.length, kept: linked.filter((s) => !empty.includes(s)).map((s) => s.name) };
}

/** 측정기에 빈칸으로 올릴 수 있는 경쟁점인지 — "경쟁점 없음(독점상권 확인)" 표시용 문서는 실제 매장이 아니다. */
export function isRegistrableCompetitor(c: Competitor): boolean {
  return c.investigationStatus !== "경쟁점없음" && !/^경쟁점 없음/.test(c.name) && c.name.trim() !== "";
}


export type PingRegisterResult = { created: string[]; linked: string[]; ipFilled: string[]; ipConflict: string[]; ipInvalid: string[] };

/**
 * 후보지 경쟁점을 측정기에 올린다(2026-10-07 사용자 "신규후보지 등록할 때 가동률 웹에 경쟁점 추가").
 * 모양은 기존점 일괄 등록(scripts/pingMonitor/addNoIpCompetitors.mjs)과 같다. IP가 없으면 "IP 미등록" 빈칸.
 * ipById: 경쟁점 정보의 IP 대역(Competitor.ipRanges — 붙여넣기·직접 입력). 새로 올리면 그 IP로, 이미 빈칸으로
 * 올라가 있으면 IP만 채우고, 이미 다른 IP가 있으면 덮어쓰지 않고 ipConflict로 알린다.
 * verifiedIds: 경쟁점 폼에서 "지금 확인"으로 한 대라도 대답한 경쟁점 — 이 칸은 바로 재고, 나머지는 PASTED_IP_CHECK 표시.
 * 올리기 직전에 competitorId로 다시 찾아 중복을 막는다(다른 화면·다른 사람이 먼저 올렸을 수 있음).
 */
export async function registerCompetitorsToPing(
  competitors: Competitor[],
  own: { code: string; name: string | null },
  email: string | null,
  ipById: Record<string, string> = {},
  verifiedIds: Set<string> = new Set(),
): Promise<PingRegisterResult> {
  const result: PingRegisterResult = { created: [], linked: [], ipFilled: [], ipConflict: [], ipInvalid: [] };
  const targets = competitors.filter(isRegistrableCompetitor);
  if (targets.length === 0) return result;
  const linked = await listPingStoresByCompetitorIds(targets.map((c) => c.id));
  // 측정기에서 먼저 직접 등록해 둔 경쟁점(타부서 등록을 후보지로 불러온 경우, 2026-10-14)은 점포평가 경쟁점과 아직 안 이어져 있다 —
  // 같은 상호(띄어쓰기 무시)면 새로 만들지 않고 이어 준다. 그 뒤로는 아래 기존 규칙(IP 채우기·충돌 알림)을 그대로 탄다.
  const nameKey = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const unlinked = (await listPingStoresByOwn(own.code)).filter((p) => !p.isOwnStore && !p.competitorId);
  for (const c of targets) {
    if ((linked.get(c.id) ?? []).some((p) => !p.isOwnStore)) continue;
    const i = unlinked.findIndex((p) => nameKey(p.name) === nameKey(c.name));
    if (i < 0) continue;
    const p = unlinked.splice(i, 1)[0];
    await updateDoc(doc(requireDb(), PING_STORES, p.id), {
      competitorId: c.id,
      ...(p.distanceM == null && c.distanceM != null ? { distanceM: c.distanceM } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: email,
    });
    linked.set(c.id, [{ ...p, competitorId: c.id }]);
    result.linked.push(c.name);
  }
  for (const c of targets) {
    const ipText = ipById[c.id]?.trim() ?? "";
    const parsed = ipText ? parseIpRanges(ipText) : null;
    const ip = parsed && parsed.errors.length === 0 && parsed.ips.length > 0 ? { ipRanges: ipText, ipCount: parsed.ips.length } : null;
    if (ipText && !ip) result.ipInvalid.push(c.name);
    const existing = (linked.get(c.id) ?? []).filter((p) => !p.isOwnStore);
    if (existing.length > 0) {
      if (!ip) continue;
      const blank = existing.find((p) => hasNoIp(p));
      if (existing.some((p) => !hasNoIp(p))) {
        if (!existing.some((p) => p.ipRanges.replace(/\s/g, "") === ip.ipRanges)) result.ipConflict.push(c.name);
        continue;
      }
      if (blank) {
        await updateDoc(doc(requireDb(), PING_STORES, blank.id), {
          ...ip,
          ipCheck: verifiedIds.has(c.id) ? null : PASTED_IP_CHECK,
          updatedAt: serverTimestamp(),
          updatedBy: email,
        });
        result.ipFilled.push(c.name);
      }
      continue;
    }
    await createPingStore(
      {
        name: c.name.trim(),
        address: c.address ?? "",
        ipRanges: ip?.ipRanges ?? "",
        ipCount: ip?.ipCount ?? 0,
        pcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
        memo: ip ? "점포평가 경쟁점 · 경쟁점 정보의 IP" : "점포평가 경쟁점 · IP 미등록",
        active: true,
        ownCode: own.code,
        ownName: own.name,
        competitorId: c.id,
        distanceM: c.distanceM ?? null,
      },
      email,
      { ipCheck: ip && !verifiedIds.has(c.id) ? PASTED_IP_CHECK : null },
    );
    result.created.push(c.id);
  }
  return result;
}
