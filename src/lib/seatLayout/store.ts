// 아이센스 좌석배치도 작업 툴 - Firestore 데이터 접근 레이어
//
// 앱스크립트 v15는 스프레드시트 한 장을 "시트 전체 읽기 → 찾기 → 쓰기" 방식으로 다뤄서
// 여러 명이 동시에 저장하면 서로 덮어쓸 위험이 있었다. Firestore는 프로젝트마다 문서(id)가
// 따로 있어서, 서로 다른 매장을 동시에 저장해도 절대 충돌하지 않는다.
//
// Firebase Storage는 쓰지 않는다 (유료 요금제 필요). 도면 이미지는 압축한 데이터 URL 그대로
// 프로젝트 문서 안에 저장한다 — client 쪽에서 Firestore 문서 크기 제한(1MiB)에 맞게 압축한다.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ProjectSummary, SeatLayoutProject } from "./types";

const PROJECTS_COLLECTION = "seatLayoutProjects";

function requireDb() {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다.");
  return db;
}

// Firestore는 undefined 값을 저장할 수 없으므로 깊은 복사로 제거한다.
function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const snapshot = await getDocs(
    query(collection(requireDb(), PROJECTS_COLLECTION), orderBy("updatedAt", "desc")),
  );
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: (data.name as string) ?? "(이름없음)",
      updatedAt: (data.updatedAt as number) ?? null,
    };
  });
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

  await setDoc(doc(requireDb(), PROJECTS_COLLECTION, id), sanitize(toSave));
  return toSave;
}

export async function deleteProject(id: string): Promise<void> {
  await deleteDoc(doc(requireDb(), PROJECTS_COLLECTION, id));
}
