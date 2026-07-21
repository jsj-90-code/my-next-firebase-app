// 아이센스 좌석배치도 작업 툴 - Firestore / Storage 데이터 접근 레이어
//
// 앱스크립트 v15는 스프레드시트 한 장을 "시트 전체 읽기 → 찾기 → 쓰기" 방식으로 다뤄서
// 여러 명이 동시에 저장하면 서로 덮어쓸 위험이 있었다. Firestore는 프로젝트마다 문서(id)가
// 따로 있어서, 서로 다른 매장을 동시에 저장해도 절대 충돌하지 않는다.

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
import {
  getDownloadURL,
  ref,
  uploadBytes,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type {
  GalleryEntry,
  ProjectSummary,
  SeatLayoutProject,
  TabKey,
} from "./types";

const PROJECTS_COLLECTION = "seatLayoutProjects";
const GALLERY_COLLECTION = "seatLayoutGallery";

function requireDb() {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다.");
  return db;
}

function requireStorage() {
  if (!storage) throw new Error("Firebase Storage가 설정되지 않았습니다.");
  return storage;
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

// 도면 이미지를 Storage에 업로드하고 { path, url }을 반환한다.
export async function uploadFloorPlanImage(
  projectId: string,
  dataUrl: string,
  filename: string,
): Promise<{ path: string; url: string }> {
  const blob = await (await fetch(dataUrl)).blob();
  const safeName = filename.replace(/[^\w.\-가-힣]/g, "_");
  const path = `seat-layout/${projectId}/floorplan-${Date.now()}-${safeName}`;
  const storageRef = ref(requireStorage(), path);
  await uploadBytes(storageRef, blob);
  const url = await getDownloadURL(storageRef);
  return { path, url };
}

export async function getFloorPlanUrl(path: string): Promise<string> {
  return getDownloadURL(ref(requireStorage(), path));
}

// ---- 매장 전체보기(갤러리): 구글 슬라이드 자동 등록 기능의 대체 ----

export async function publishToGallery(
  project: SeatLayoutProject,
  tab: TabKey,
  compositeDataUrl: string,
  uid: string,
): Promise<GalleryEntry> {
  const entryId = `${project.id}_${tab}`;
  const blob = await (await fetch(compositeDataUrl)).blob();
  const path = `seat-layout/gallery/${entryId}.png`;
  const storageRef = ref(requireStorage(), path);
  await uploadBytes(storageRef, blob);
  const url = await getDownloadURL(storageRef);

  const entry: GalleryEntry = {
    id: entryId,
    projectId: project.id,
    projectName: project.name || "이름없음",
    tab,
    imagePath: path,
    imageUrl: url,
    updatedAt: Date.now(),
    updatedBy: uid,
  };

  await setDoc(doc(requireDb(), GALLERY_COLLECTION, entryId), sanitize(entry));
  return entry;
}

export async function listGalleryEntries(): Promise<GalleryEntry[]> {
  const snapshot = await getDocs(
    query(collection(requireDb(), GALLERY_COLLECTION), orderBy("updatedAt", "desc")),
  );
  return snapshot.docs.map((d) => d.data() as GalleryEntry);
}

export async function deleteGalleryEntry(entry: GalleryEntry): Promise<void> {
  await deleteDoc(doc(requireDb(), GALLERY_COLLECTION, entry.id));
  try {
    await deleteObject(ref(requireStorage(), entry.imagePath));
  } catch {
    // 이미지가 이미 없어도 메타데이터 삭제는 성공한 것으로 처리
  }
}
