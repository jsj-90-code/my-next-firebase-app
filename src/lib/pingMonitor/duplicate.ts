// 경쟁점 가동률 측정기 — 중복 등록 막기(2026-10-24 사용자 요청).
// 점포 담당자가 여럿이고 신규 입사자도 있어, 이미 측정기에 있는 매장을 모르고 또 등록한다.
// 사용자 결정: "IP대역·주소가 겹치면 등록 안 되게. 뭐가 겹치는지 알려주고, 잘못 들어간 쪽을 고칠 수 있게."
// 상호로는 판정하지 않는다(표기가 제각각) — IP와 주소로만 본다. 상호·묶음 이름 정리는 검색·제안용이다.

import { parseIpRanges } from "./ipRange";

type StoreLike = { id: string; name: string; address: string; ipRanges: string; ownCode: string | null; ownName: string | null; isOwnStore?: boolean };

const SIDO: [RegExp, string][] = [
  [/^서울(특별)?시?$/, "서울"], [/^부산(광역)?시?$/, "부산"], [/^대구(광역)?시?$/, "대구"], [/^인천(광역)?시?$/, "인천"],
  [/^광주(광역)?시?$/, "광주"], [/^대전(광역)?시?$/, "대전"], [/^울산(광역)?시?$/, "울산"], [/^세종(특별자치)?시?$/, "세종"],
  [/^경기도?$/, "경기"], [/^강원(특별자치)?도?$/, "강원"], [/^(충청북도|충북)$/, "충북"], [/^(충청남도|충남)$/, "충남"],
  [/^(전북특별자치도|전라북도|전북)$/, "전북"], [/^(전라남도|전남)$/, "전남"], [/^(경상북도|경북)$/, "경북"], [/^(경상남도|경남)$/, "경남"],
  [/^제주(특별자치)?도?$/, "제주"],
];

export type AddressKey = { building: string; detail: string | null };

/**
 * 주소 → 건물 단위 열쇠 + 층·호수. 도로명("대암로 36")이든 지번("삼산동 1476-2")이든 앞부분 글자를 그대로 쓰므로,
 * 도로명↔지번 차이는 화면에서 카카오가 돌려준 두 모양을 같이 비교해 메운다(newAddressKeys).
 * 시·도는 줄임말로 맞춘다("경상남도"="경남"). 건물을 못 읽으면 null — 그 주소는 비교하지 않는다(추측 금지).
 */
export function addressKey(address: string | null | undefined): AddressKey | null {
  let a = String(address ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!a) return null;
  const [first, ...rest] = a.split(" ");
  const sido = SIDO.find(([re]) => re.test(first));
  if (sido) a = [sido[1], ...rest].join(" ");
  const m =
    a.match(/^(.*?[가-힣A-Za-z0-9]+(?:로|길))\s*(\d+(?:-\d+)?)(?=$|[\s,])(.*)$/) ??
    a.match(/^(.*?[가-힣0-9]+(?:동|리|가|읍|면))\s*((?:산\s*)?\d+(?:-\d+)?)(?=$|[\s,])(.*)$/);
  if (!m) return null;
  const building = `${m[1].replace(/\s/g, "")}|${m[2].replace(/\s/g, "")}`;
  const details = (m[3].match(/지하\s*\d+\s*층|B\d+\s*층?|\d+\s*층|\d+(?:\s*[~,]\s*\d+)*\s*호/gi) ?? []).map((d) => d.replace(/\s/g, "").toUpperCase());
  return { building, detail: details.length ? details.join("|") : null };
}

/** 새로 적는 주소의 열쇠들 — 적은 글자 + 카카오가 찾은 도로명·지번(층·호수는 적은 글자에서). */
export function newAddressKeys(typed: string, geo?: { roadAddress?: string | null; jibunAddress?: string | null } | null): AddressKey[] {
  const own = addressKey(typed);
  const detail = own?.detail ?? null;
  const keys = [own, addressKey(geo?.roadAddress), addressKey(geo?.jibunAddress)].filter((k): k is AddressKey => !!k).map((k) => ({ building: k.building, detail }));
  return keys.filter((k, i) => keys.findIndex((x) => x.building === k.building) === i);
}

export type DuplicateHit<S extends StoreLike = StoreLike> =
  | { kind: "ip"; store: S; overlap: number; sample: string[] }
  | { kind: "address"; store: S }
  /** 같은 건물인데 층·호수가 다르다 — 다른 매장일 수 있어 막지 않고 알리기만 한다. */
  | { kind: "building"; store: S };

/** 이 IP·주소와 겹치는 기존 등록. selfId(수정 중인 자기 자신)는 뺀다. */
export function findDuplicates<S extends StoreLike>(input: { ipRanges: string; keys: AddressKey[] }, stores: S[], selfId?: string | null): DuplicateHit<S>[] {
  const mine = new Set(parseIpRanges(input.ipRanges).ips);
  const hits: DuplicateHit<S>[] = [];
  for (const s of stores) {
    if (s.id === selfId) continue;
    if (mine.size > 0 && s.ipRanges.trim()) {
      const shared = parseIpRanges(s.ipRanges).ips.filter((ip) => mine.has(ip));
      if (shared.length > 0) hits.push({ kind: "ip", store: s, overlap: shared.length, sample: shared.slice(0, 3) });
    }
    const theirs = addressKey(s.address);
    if (!theirs || input.keys.length === 0) continue;
    const same = input.keys.find((k) => k.building === theirs.building);
    if (!same) continue;
    const differentRoom = same.detail != null && theirs.detail != null && same.detail !== theirs.detail;
    hits.push({ kind: differentRoom ? "building" : "address", store: s });
  }
  return hits;
}

export type ExistingOverlap<S extends StoreLike = StoreLike> = { kind: "ip" | "address"; a: S; b: S; overlap?: number };

/** 이미 들어가 있는 등록끼리 겹치는 쌍 — 목록 화면에서 고치라고 알린다. */
export function findExistingOverlaps<S extends StoreLike>(stores: S[]): ExistingOverlap<S>[] {
  const out: ExistingOverlap<S>[] = [];
  const ipOwner = new Map<string, S>();
  const ipPairs = new Map<string, { a: S; b: S; n: number }>();
  for (const s of stores) {
    for (const ip of parseIpRanges(s.ipRanges).ips) {
      const o = ipOwner.get(ip);
      if (!o) ipOwner.set(ip, s);
      else if (o.id !== s.id) {
        const k = `${o.id}|${s.id}`;
        const p = ipPairs.get(k) ?? { a: o, b: s, n: 0 };
        p.n += 1;
        ipPairs.set(k, p);
      }
    }
  }
  for (const p of ipPairs.values()) out.push({ kind: "ip", a: p.a, b: p.b, overlap: p.n });
  const byBuilding = new Map<string, { s: S; key: AddressKey }[]>();
  for (const s of stores) {
    if (s.isOwnStore) continue;
    const key = addressKey(s.address);
    if (key) byBuilding.set(key.building, [...(byBuilding.get(key.building) ?? []), { s, key }]);
  }
  for (const list of byBuilding.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i].key.detail, y = list[j].key.detail;
        if (x == null || y == null || x === y) out.push({ kind: "address", a: list[i].s, b: list[j].s });
      }
  return out;
}

/** 이름 비교용 — 띄어쓰기·대소문자·"피시/피씨"↔PC 차이를 없앤다. 끝의 "점"·"PC방"은 묶음 이름 비교에서만 뗀다(stripSuffix). */
export function normalizeName(s: string | null | undefined, stripSuffix = false): string {
  let t = String(s ?? "").toLowerCase().replace(/\s/g, "").replace(/피시|피씨/g, "pc");
  if (stripSuffix) t = t.replace(/(pc방|pc)$/, "").replace(/점$/, "");
  return t;
}

/** 묶음 이름이 비슷한가 — 한쪽이 다른 쪽을 품으면("구로" ⊂ "구로디지털단지") 비슷하다고 본다. 두 글자 미만은 안 본다. */
export function similarGroupName(a: string, b: string): boolean {
  const x = normalizeName(a, true), y = normalizeName(b, true);
  if (x.length < 2 || y.length < 2) return false;
  return x.includes(y) || y.includes(x);
}
