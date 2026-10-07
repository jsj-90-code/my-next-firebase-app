"use client";

// 경쟁점 가동률 측정기 — 화면에서 Firestore 읽기·쓰기(2026-10-06 신설).
// 화면이 쓰는 칸은 상호·주소·IP대역·대수·메모·측정여부뿐이다. 측정 기록(days·lastSample)은 서버만 쓴다(firestore.rules).
// Firebase 무료 요금제라 읽기를 아낀다: 목록은 매장 문서만(매장당 1번), 시간대별은 상세 화면에서 고른 기간만.

import {
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
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listCandidates, listCompetitors, listExistingStores } from "@/lib/storeEval/store";
import { PING_DAILY, PING_STORES, type DayTotals, type PingDaily, type PingStore } from "./summary";

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
    isOwnStore: d.isOwnStore === true,
    ipCheck: typeof d.ipCheck === "string" && d.ipCheck ? d.ipCheck : null,
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

export async function getPingStore(id: string): Promise<PingStore | null> {
  const snap = await getDoc(doc(requireDb(), PING_STORES, id));
  return snap.exists() ? toStore(snap.id, snap.data()) : null;
}

export async function createPingStore(input: PingStoreInput, email: string | null): Promise<string> {
  const ref = await addDoc(collection(requireDb(), PING_STORES), {
    ...input,
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

export type OwnStoreOption = { code: string; name: string; kind: "기존점" | "후보지" };

/** 우리 매장 고르기 목록 — 기존점(가맹점코드) + 진행 중인 후보지. 기존점으로 전환된 후보지는 기존점 쪽만 남긴다. */
export async function listOwnStoreOptions(): Promise<OwnStoreOption[]> {
  const [existing, candidates] = await Promise.all([listExistingStores(), listCandidates()]);
  const existingNames = new Set(existing.map((s) => s.storeName.replace(/\s/g, "")));
  return [
    ...existing
      .map((s) => ({ code: s.storeCode, name: s.storeName, kind: "기존점" as const }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    ...candidates
      .filter((c) => c.reviewStatus !== "종료" && !existingNames.has(c.name.replace(/\s/g, "")))
      .map((c) => ({ code: c.code, name: c.name, kind: "후보지" as const }))
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
