// 배후지 나눠 갖기(허프) 수집기 두 개가 같이 쓰는 "어느 자리를 볼 것인가" 목록.
//
// 기존점·후보지 좌표는 `.local-tools/geocoded-sites.json`이 정본이고, 거기 없는 새 후보지
// (N017~ 등록 이후분)는 검증 스냅샷의 lat/lng로 채운다.
import { readFileSync } from "node:fs";

export function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[t.slice(0, eq).trim()] ??= v;
  }
}

export function loadHuffSites() {
  const geo = Object.values(JSON.parse(readFileSync(".local-tools/geocoded-sites.json", "utf8")).sites);
  const sites = geo
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({ kind: s.kind, code: s.code, name: s.name, lat: s.lat, lng: s.lng }));
  const have = new Set(sites.map((s) => s.code));
  try {
    const snap = JSON.parse(readFileSync(".local-tools/validation-snapshot.json", "utf8"));
    for (const c of snap.candidates ?? []) {
      if (have.has(c.code) || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      sites.push({ kind: "candidate", code: c.code, name: c.name ?? c.code, lat: c.lat, lng: c.lng });
    }
  } catch {
    // 스냅샷이 없는 PC면 geocoded 목록만 쓴다.
  }
  return sites;
}

/** 위경도 → 미터 오프셋(작은 거리용 평면 근사). */
export function offsetLatLng(lat, lng, dxM, dyM) {
  const dLat = dyM / 111320;
  const dLng = dxM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

export function distanceM(a, b) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * SGIS 격자코드("다사3644") → EPSG:5179 좌하단(m). 첫 글자 x(가=700km …), 둘째 글자 y(가=1300km …),
 * 숫자 앞 2자리 = x km, 뒤 2자리 = y km. 1km 격자 기준.
 */
const GRID_LETTERS = ["가", "나", "다", "라", "마", "바", "사", "아"];
export function gridCodeToXY(code) {
  const xi = GRID_LETTERS.indexOf(code[0]);
  const yi = GRID_LETTERS.indexOf(code[1]);
  if (xi < 0 || yi < 0) return null;
  return { x: 700000 + xi * 100000 + Number(code.slice(2, 4)) * 1000, y: 1300000 + yi * 100000 + Number(code.slice(4, 6)) * 1000 };
}

/**
 * EPSG:5179 → 위경도. tm.mjs엔 정방향만 있어서, 정방향을 몇 번 되풀이해 맞춘다(오차 1cm 미만).
 * to5179를 인자로 받는다(순환 import를 피하려고).
 */
export function from5179(to5179, x, y, guess = { lat: 37, lng: 127 }) {
  let { lat, lng } = guess;
  for (let i = 0; i < 8; i++) {
    const p = to5179(lng, lat);
    lat += (y - p.y) / 111320;
    lng += (x - p.x) / (111320 * Math.cos((lat * Math.PI) / 180));
  }
  return { lat, lng };
}
