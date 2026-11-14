"use client";

// 경쟁점 가동률 측정기 — 화면에서 Firestore 읽기·쓰기(2026-10-06 신설). 2026-11-03부터 사내 저장소로도(아래 "저장소 고르기").
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
import { auth, db } from "@/lib/firebase";
import { listCandidates, listCompetitors, listExistingStores } from "@/lib/storeEval/store";
import type { Competitor } from "@/lib/storeEval/types";
import { parseIpRanges } from "./ipRange";
import { toPingStore } from "./storeDoc";
import { hasNoIp, PASTED_IP_CHECK, PING_DAILY, PING_STORES, type PingDaily, type PingStore } from "./summary";
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

const toStore = (id: string, d: DocumentData): PingStore => toPingStore(id, d);

function requireDb() {
  if (!db) throw new Error("Firebase 설정이 없습니다.");
  return db;
}

// ---------- 저장소 고르기(2026-11-03) ----------
// NEXT_PUBLIC_PING_STORE_API=1이면 사내 저장소(/api/ping-monitor/db — 로그인 확인·규칙은 거기서), 아니면 예전처럼 Firebase 직접.
// 아래 도우미만 두 갈래이고, 나머지 함수는 도우미만 부른다. 문서는 {id, data} 한 모양으로 다룬다.
const VIA_API = process.env.NEXT_PUBLIC_PING_STORE_API === "1";
type RawDoc = { id: string; data: DocumentData };
type WhereClause = [string, "==" | "in" | ">=" | "<", unknown];

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const ts = (v as { __ts?: unknown }).__ts;
    if (typeof ts === "string" && Object.keys(v).length === 1) return new Date(ts);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}
async function api<T>(body: unknown): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("로그인이 필요합니다.");
  const res = await fetch("/api/ping-monitor/db", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "측정기 저장소 요청에 실패했습니다.");
  return decode(json) as T;
}
/** 서버 시각 칸 — Firebase는 serverTimestamp(), 사내 저장소는 창구가 지금 시각을 넣는다. */
const nowValue = () => (VIA_API ? { __now: true } : serverTimestamp());

async function storesWhere(clauses: WhereClause[] = []): Promise<RawDoc[]> {
  if (VIA_API) return (await api<{ docs: RawDoc[] }>({ op: "list", c: PING_STORES, where: clauses })).docs;
  const base = collection(requireDb(), PING_STORES);
  const snap = await getDocs(clauses.length ? query(base, ...clauses.map(([f, op, v]) => where(f, op, v))) : base);
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}
async function storeGet(id: string): Promise<RawDoc | null> {
  if (VIA_API) {
    const { doc: data } = await api<{ doc: DocumentData | null }>({ op: "get", c: PING_STORES, id });
    return data ? { id, data } : null;
  }
  const snap = await getDoc(doc(requireDb(), PING_STORES, id));
  return snap.exists() ? { id: snap.id, data: snap.data() } : null;
}
async function storeAdd(data: DocumentData): Promise<string> {
  if (VIA_API) return (await api<{ id: string }>({ op: "add", c: PING_STORES, data })).id;
  return (await addDoc(collection(requireDb(), PING_STORES), data)).id;
}
async function storeUpdates(list: { id: string; data: DocumentData }[]): Promise<void> {
  if (list.length === 0) return;
  if (VIA_API) {
    await api({ op: "commit", writes: list.map((u) => ({ op: "update", c: PING_STORES, id: u.id, data: u.data })) });
    return;
  }
  if (list.length === 1) return updateDoc(doc(requireDb(), PING_STORES, list[0].id), list[0].data);
  const batch = writeBatch(requireDb());
  for (const u of list) batch.update(doc(requireDb(), PING_STORES, u.id), u.data);
  await batch.commit();
}
async function storeDelete(id: string): Promise<void> {
  if (VIA_API) {
    await api({ op: "commit", writes: [{ op: "delete", c: PING_STORES, id }] });
    return;
  }
  await deleteDoc(doc(requireDb(), PING_STORES, id));
}

export async function listPingStores(): Promise<PingStore[]> {
  return (await storesWhere()).map((d) => toStore(d.id, d.data)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 우리 매장 하나(기존점 가맹점코드·후보지 N0xx)에 붙은 등록 전부 — 매장별 비교 화면(2026-10-07). */
export async function listPingStoresByOwn(ownCode: string): Promise<PingStore[]> {
  return (await storesWhere([["ownCode", "==", ownCode]])).map((d) => toStore(d.id, d.data));
}

export async function getPingStore(id: string): Promise<PingStore | null> {
  const d = await storeGet(id);
  return d ? toStore(d.id, d.data) : null;
}

export async function createPingStore(input: PingStoreInput, email: string | null, extra: { ipCheck?: string | null } = {}): Promise<string> {
  return storeAdd({
    ...input,
    ...(extra.ipCheck ? { ipCheck: extra.ipCheck } : {}),
    createdAt: nowValue(),
    createdBy: email,
    updatedAt: nowValue(),
    updatedBy: email,
  });
}

/** IP대역을 바꿔 저장하면 "IP 확인 필요" 표시를 지운다(clearIpCheck). */
export async function updatePingStore(id: string, input: PingStoreInput, email: string | null, opts: { clearIpCheck?: boolean } = {}): Promise<void> {
  await storeUpdates([{ id, data: { ...input, ...(opts.clearIpCheck ? { ipCheck: null } : {}), updatedAt: nowValue(), updatedBy: email } }]);
}

/** from~to(포함) 날짜의 시간별 기록. 문서 id가 `{매장id}_{날짜}`라 id 범위로 한 번에 읽는다(색인 불필요). */
export async function listPingDaily(storeId: string, from: string, to: string): Promise<PingDaily[]> {
  if (VIA_API) {
    // 창구의 ID 범위는 [idFrom, idTo) — "<= 매장_to"를 맞추려고 끝에 \u0000을 붙인다.
    const { docs } = await api<{ docs: RawDoc[] }>({ op: "list", c: PING_DAILY, idFrom: `${storeId}_${from}`, idTo: `${storeId}_${to}\u0000` });
    return docs.map(({ data }) => ({ storeId: String(data.storeId ?? storeId), date: String(data.date ?? ""), hours: data.hours ?? {} }));
  }
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
/** address — 좌표가 비어 있을 때(9-16 좌표 채우기 뒤에 연 평택소사벌점처럼) 화면이 주소로 찾는다(2026-10-24). */
export type OwnStoreOption = { code: string; name: string; kind: "기존점" | "후보지"; custom?: boolean; lat?: number | null; lng?: number | null; address?: string | null };

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
    storesWhere([["ownCode", ">=", "직접"], ["ownCode", "<", "직접\uf8ff"]]),
  ]);
  const existingNames = new Set(existing.map((s) => s.storeName.replace(/\s/g, "")));
  const customNames = new Map(custom.map((d) => [String(d.data.ownCode), String(d.data.ownName ?? "") || String(d.data.ownCode)]));
  return [
    ...[...customNames]
      .map(([code, name]) => ({ code, name, kind: isCustomCandidateCode(code) ? ("후보지" as const) : ("기존점" as const), custom: true }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    ...existing
      .map((s) => ({ code: s.storeCode, name: s.storeName, kind: "기존점" as const, lat: s.lat ?? null, lng: s.lng ?? null, address: s.address ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    ...candidates
      .filter((c) => c.reviewStatus !== "종료" && !existingNames.has(c.name.replace(/\s/g, "")))
      .map((c) => ({ code: c.code, name: c.name, kind: "후보지" as const, lat: c.lat ?? null, lng: c.lng ?? null, address: c.address ?? null }))
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
  const updates: { id: string; data: DocumentData }[] = [];
  for (const s of rows) {
    const same = competitors.filter((c) => key(c.name) === key(s.name));
    const link = !s.competitorId && same.length === 1 && !taken.has(same[0].id) ? same[0] : null;
    if (link) {
      taken.add(link.id);
      result.linked.push(s.name);
    }
    updates.push({
      id: s.id,
      data: {
        ownCode: to.code,
        ownName: to.name,
        ...(link ? { competitorId: link.id, ...(s.distanceM == null && link.distanceM != null ? { distanceM: link.distanceM } : {}) } : {}),
        updatedAt: nowValue(),
        updatedBy: email,
      },
    });
    result.moved++;
  }
  await storeUpdates(updates);
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
    for (const d of await storesWhere([["competitorId", "in", chunk]])) {
      const s = toStore(d.id, d.data);
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
  await Promise.all(empty.map((s) => storeDelete(s.id)));
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
    await storeUpdates([{ id: p.id, data: { competitorId: c.id, ...(p.distanceM == null && c.distanceM != null ? { distanceM: c.distanceM } : {}), updatedAt: nowValue(), updatedBy: email } }]);
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
        await storeUpdates([{ id: blank.id, data: { ...ip, ipCheck: verifiedIds.has(c.id) ? null : PASTED_IP_CHECK, updatedAt: nowValue(), updatedBy: email } }]);
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
