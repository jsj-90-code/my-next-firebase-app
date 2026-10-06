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
import { PING_DAILY, PING_STORES, type DayTotals, type PingDaily, type PingStore } from "./summary";

export type PingStoreInput = {
  name: string;
  address: string;
  ipRanges: string;
  ipCount: number;
  pcCount: number | null;
  memo: string;
  active: boolean;
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

export async function updatePingStore(id: string, input: PingStoreInput, email: string | null): Promise<void> {
  await updateDoc(doc(requireDb(), PING_STORES, id), { ...input, updatedAt: serverTimestamp(), updatedBy: email });
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
