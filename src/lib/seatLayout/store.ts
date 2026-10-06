// 아이센스 좌석배치도 작업 툴 - Firestore 데이터 접근 레이어
//
// 앱스크립트 v15는 스프레드시트 한 장을 "시트 전체 읽기 → 찾기 → 쓰기" 방식으로 다뤄서
// 여러 명이 동시에 저장하면 서로 덮어쓸 위험이 있었다. Firestore는 프로젝트마다 문서(id)가
// 따로 있어서, 서로 다른 매장을 동시에 저장해도 절대 충돌하지 않는다.
//
// Firebase Storage는 쓰지 않는다 (유료 요금제 필요). 도면 이미지는 압축한 데이터 URL 그대로
// 프로젝트 문서 안에 저장한다 — client 쪽에서 Firestore 문서 크기 제한(1MiB)에 맞게 압축한다.
//
// 그래서 프로젝트 문서는 건당 수백 KB다. 목록(작업 화면·홈 상태 카드)은 이름과 수정 시각만
// 필요하므로 목차 문서(seatLayoutSettings/projectIndex) 하나만 읽는다. 클라이언트 SDK는 필드만
// 골라 읽을 수 없어서, 예전엔 목록을 열 때마다 모든 도면을 통째로 내려받았다(2026-10-06 수정).
// 목차는 saveProject/deleteProject가 프로젝트 문서와 같은 배치(한 번에 성공/실패)로 고친다.

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ProjectSummary, SeatLayoutProject } from "./types";

const PROJECTS_COLLECTION = "seatLayoutProjects";
// 기존 seatLayoutSettings 보안규칙을 그대로 쓰려고 그 컬렉션 안에 둔다(설정 문서는 "config").
const INDEX_DOC_PATH = ["seatLayoutSettings", "projectIndex"] as const;

type IndexEntry = { name: string; updatedAt: number | null };

function requireDb() {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다.");
  return db;
}

function indexRef() {
  return doc(requireDb(), ...INDEX_DOC_PATH);
}

// Firestore는 undefined 값을 저장할 수 없으므로 깊은 복사로 제거한다.
function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toSortedSummaries(entries: Record<string, IndexEntry>): ProjectSummary[] {
  return Object.entries(entries)
    .map(([id, e]) => ({ id, name: e.name ?? "(이름없음)", updatedAt: e.updatedAt ?? null }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const snap = await getDoc(indexRef());
  if (snap.exists()) {
    return toSortedSummaries((snap.data().projects ?? {}) as Record<string, IndexEntry>);
  }

  // 목차가 아직 없다(목차 도입 전 프로젝트들) — 이번 한 번만 통째로 읽어 목차를 만든다.
  const all = await getDocs(collection(requireDb(), PROJECTS_COLLECTION));
  const projects: Record<string, IndexEntry> = {};
  for (const d of all.docs) {
    const data = d.data();
    projects[d.id] = {
      name: (data.name as string) ?? "(이름없음)",
      updatedAt: (data.updatedAt as number) ?? null,
    };
  }
  await setDoc(indexRef(), { projects }, { merge: true });
  return toSortedSummaries(projects);
}

/**
 * 백업 전용 — 프로젝트 문서를 내용까지 통째로 가져온다(listProjects는 목록용 요약만 준다).
 * 도면 이미지가 들어 있어 건당 수백 KB다. 화면에서 쓰지 말고 백업에서만 쓴다.
 */
export async function listAllProjects(): Promise<SeatLayoutProject[]> {
  const snapshot = await getDocs(collection(requireDb(), PROJECTS_COLLECTION));
  return snapshot.docs.map((d) => ({ ...(d.data() as Omit<SeatLayoutProject, "id">), id: d.id }));
}

export async function loadProject(id: string): Promise<SeatLayoutProject | null> {
  const snap = await getDoc(doc(requireDb(), PROJECTS_COLLECTION, id));
  if (!snap.exists()) return null;
  const data = snap.data();
  return { ...(data as Omit<SeatLayoutProject, "id">), id: snap.id };
}

export async function saveProject(
  project: SeatLayoutProject,
  uid: string,
): Promise<SeatLayoutProject> {
  const id = project.id || crypto.randomUUID();
  const now = Date.now();
  const toSave: SeatLayoutProject = {
    ...project,
    id,
    name: project.name || "이름없음",
    updatedAt: now,
    updatedBy: uid,
  };

  const entry: IndexEntry = { name: toSave.name, updatedAt: now };
  const batch = writeBatch(requireDb());
  batch.set(doc(requireDb(), PROJECTS_COLLECTION, id), sanitize(toSave));
  batch.set(indexRef(), { projects: { [id]: entry } }, { merge: true });
  await batch.commit();
  return toSave;
}

export async function deleteProject(id: string): Promise<void> {
  const batch = writeBatch(requireDb());
  batch.delete(doc(requireDb(), PROJECTS_COLLECTION, id));
  batch.set(indexRef(), { projects: { [id]: deleteField() } }, { merge: true });
  await batch.commit();
}
