// 아이센스 좌석배치도 작업 툴 - 사양 설정(드롭다운 옵션/기본값) 저장소
//
// SPEC_FIELDS/PC_SPEC_FIELDS/FIELD_SUGGESTIONS/TYPE_DEFAULTS/PC_TYPE_DEFAULTS(constants.ts)는
// 코드에 박혀있는 "초기값"일 뿐이고, 실제로 화면에서 쓰는 값은 이 파일이 Firestore
// (seatLayoutSettings/config 문서 1개)에서 불러온 설정이다. 매장 운영 정책이 바뀔 때마다
// 코드를 고쳐 배포하지 않고도, 작업자가 화면에서 드롭다운 항목/기본값을 직접 관리할 수 있게 하기 위함.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  FIELD_SUGGESTIONS,
  PC_SPEC_FIELDS,
  PC_TYPE_DEFAULTS,
  SPEC_FIELDS,
  TYPE_DEFAULTS,
} from "./constants";
import type { PcSpecFieldId, ZoneTypeKey } from "./types";
import type { SpecFieldId } from "./constants";

export type SeatLayoutSettings = {
  // 책상 탭: 필드별 드롭다운 옵션 목록 + 기본값
  specOptions: Record<SpecFieldId, string[]>;
  specDefaults: Record<SpecFieldId, string>;
  // PC 탭: 필드별 자동완성/드롭다운 후보 목록 + 전역 기본값
  pcSuggestions: Record<PcSpecFieldId, string[]>;
  pcDefaults: Record<PcSpecFieldId, string>;
  // 존 유형별 기본값 재정의 (빈 값이면 위 기본값을 그대로 사용)
  typeDefaults: Partial<Record<ZoneTypeKey, Partial<Record<SpecFieldId, string>>>>;
  pcTypeDefaults: Partial<Record<ZoneTypeKey, Partial<Record<PcSpecFieldId, string>>>>;
  updatedAt: number | null;
  updatedBy: string | null;
};

const SETTINGS_DOC_PATH = ["seatLayoutSettings", "config"] as const;

function requireDb() {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다.");
  return db;
}

function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultSeatLayoutSettings(): SeatLayoutSettings {
  const specOptions = {} as Record<SpecFieldId, string[]>;
  const specDefaults = {} as Record<SpecFieldId, string>;
  SPEC_FIELDS.forEach((f) => {
    specOptions[f.id] = [...f.options];
    specDefaults[f.id] = f.def;
  });

  const pcSuggestions = {} as Record<PcSpecFieldId, string[]>;
  const pcDefaults = {} as Record<PcSpecFieldId, string>;
  PC_SPEC_FIELDS.forEach((f) => {
    pcSuggestions[f.id] = [...(FIELD_SUGGESTIONS[f.id] ?? [])];
    pcDefaults[f.id] = f.def;
  });

  return {
    specOptions,
    specDefaults,
    pcSuggestions,
    pcDefaults,
    typeDefaults: sanitize(TYPE_DEFAULTS),
    pcTypeDefaults: sanitize(PC_TYPE_DEFAULTS),
    updatedAt: null,
    updatedBy: null,
  };
}

// Firestore 문서에 새로 추가된 필드가 없거나(구버전 문서), 코드에 새 필드/존 유형이 추가된
// 경우를 대비해, 기본값 위에 저장된 값을 얹어 병합한다 (저장된 값이 항상 우선).
function mergeSettings(base: SeatLayoutSettings, saved: Partial<SeatLayoutSettings>): SeatLayoutSettings {
  return {
    specOptions: { ...base.specOptions, ...saved.specOptions },
    specDefaults: { ...base.specDefaults, ...saved.specDefaults },
    pcSuggestions: { ...base.pcSuggestions, ...saved.pcSuggestions },
    pcDefaults: { ...base.pcDefaults, ...saved.pcDefaults },
    typeDefaults: { ...base.typeDefaults, ...saved.typeDefaults },
    pcTypeDefaults: { ...base.pcTypeDefaults, ...saved.pcTypeDefaults },
    updatedAt: saved.updatedAt ?? null,
    updatedBy: saved.updatedBy ?? null,
  };
}

// 현재 기본값이 옵션 목록에 없으면(예: 옵션이 아예 비어있고 기본값만 있는 CPU/CPU쿨러/
// 무선충전기 등) 사양설정 화면에서 그 값이 칩으로 보이지 않아 수정할 수 없었다. 기본값을
// 항상 옵션 목록에 포함시켜, 다른 항목처럼 클릭해서 이름을 수정하거나 삭제할 수 있게 한다.
function withDefaultsRegistered(s: SeatLayoutSettings): SeatLayoutSettings {
  const specOptions: Record<SpecFieldId, string[]> = { ...s.specOptions };
  SPEC_FIELDS.forEach((f) => {
    const def = s.specDefaults[f.id];
    const list = specOptions[f.id] ?? [];
    if (def && !list.includes(def)) specOptions[f.id] = [...list, def];
  });

  const pcSuggestions: Record<PcSpecFieldId, string[]> = { ...s.pcSuggestions };
  PC_SPEC_FIELDS.forEach((f) => {
    const def = s.pcDefaults[f.id];
    const list = pcSuggestions[f.id] ?? [];
    if (def && !list.includes(def)) pcSuggestions[f.id] = [...list, def];
  });

  return { ...s, specOptions, pcSuggestions };
}

export async function loadSeatLayoutSettings(): Promise<SeatLayoutSettings> {
  const base = defaultSeatLayoutSettings();
  const snap = await getDoc(doc(requireDb(), ...SETTINGS_DOC_PATH));
  if (!snap.exists()) return withDefaultsRegistered(base);
  return withDefaultsRegistered(mergeSettings(base, snap.data() as Partial<SeatLayoutSettings>));
}

export async function saveSeatLayoutSettings(
  settings: SeatLayoutSettings,
  uid: string,
): Promise<SeatLayoutSettings> {
  const toSave: SeatLayoutSettings = { ...settings, updatedAt: Date.now(), updatedBy: uid };
  await setDoc(doc(requireDb(), ...SETTINGS_DOC_PATH), sanitize(toSave));
  return toSave;
}
