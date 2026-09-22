// 소상공인365 상권분석 리포트에서 **반경 유동인구**를 받는다. (주소만 초기평가 도구 전용 · 서버)
//
// `scripts/collectSbizFloatingPopulation.mjs`의 3단계를 그대로 옮긴 것이다:
//   1) POST /gis/com/report/capture.json           -> analyNo 발급 (radius가 자유 파라미터)
//   2) GET  /gis/bizonAnls/report/sg/sang_gwon1.sg -> 응답 HTML의 aACd/aANm(행정동) 확보
//   3) GET  /gis/bizonAnls/report/sg/sang_gwon4.sg -> 월별 유동인구 + 성별/연령표
//
// ⚠️ **공식 API가 아니라 스크래핑이다.** 사이트가 바뀌면 깨진다. 깨졌을 때 조용히 0이나
//    추정값을 넣지 않고 에러로 올린다 — 유동인구가 빠지면 수요가 낮게 나오는데, 그걸
//    "장사가 안 될 자리"로 읽으면 후보지를 잘못 버린다.
// ⚠️ 남의 공개 사이트를 여러 번 부른다. 간격(DELAY_MS)을 줄이지 말 것.
// ⚠️ 12개월 평균·성별연령 환산 규칙은 `scripts/writeFloatingPopulationToFirestore.mjs`와
//    **같아야 한다** — 운영 자료가 그 규칙으로 들어가 있어서, 여기서 다르게 계산하면
//    같은 이름의 필드에 다른 자로 잰 값이 섞인다.

import { to5181 } from "./tm";

const BASE = "https://bigdata.sbiz.or.kr";
const PCBANG_UPJONG = "R10406"; // 예술·스포츠 > 유원지·오락 > PC방
const DELAY_MS = Number(process.env.SBIZ_DELAY_MS || 1200);
const HEADERS = {
  Referer: `${BASE}/gis/locAnls`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (s: unknown) => Number(String(s).replace(/,/g, ""));

/**
 * 네트워크 단계 실패의 **원인을 드러낸다.**
 *
 * undici(Node fetch)는 DNS 실패·연결 거부·TLS 오류·타임아웃을 전부 `fetch failed`라는 한 문장으로
 * 뭉갠다. 2026-09-22에 배포 서버에서 정확히 그 메시지만 보고 원인을 못 짚었다 — 로컬(한국 IP)은
 * 200이었으니 "어디서 어떻게 막혔나"가 유일한 단서인데 그게 안 보였다.
 *
 * 그래서 `cause.code`(ENOTFOUND·ECONNREFUSED·ETIMEDOUT·CERT_*)와 **어느 리전에서 돌았는지**를
 * 같이 싣는다. 진단 문구를 화면에 그대로 띄우는 게 목적이다.
 */
export function describeFetchFailure(err: unknown, label: string): string {
  const region = process.env.VERCEL_REGION ?? "로컬";
  const base = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  const code = cause?.code ? ` [${cause.code}]` : "";
  const detail = cause?.message && cause.message !== base ? ` (${cause.message})` : "";
  return `${label}: ${base}${code}${detail} · 실행 위치 ${region}`;
}

export type SbizFloatingDemographics = {
  total: number;
  male: number;
  female: number;
  age10s: number;
  age20s: number;
  age30s: number;
  age40s: number;
  age50s: number;
  age60plus: number;
};

export type SbizFloatingResult = {
  radiusM: number;
  /** 최근 12개월 평균 일평균 유동인구 */
  avg: number;
  /** 월 라벨과 월별 값 — 화면에 추이를 보여주고, 값이 튀는지 사람이 볼 수 있게 같이 넘긴다 */
  months: string[];
  monthly: number[];
  /** 최근월 기준 성별·연령을 12개월 평균 축척으로 환산한 값 */
  scaled: SbizFloatingDemographics;
  /** 환산 배율(평균÷최근월). 1에서 많이 벗어나면 최근월이 튄 달이다 */
  scale: number;
  admiCd: string;
  admiNm: string;
};

async function issueAnalyNo(input: { lat: number; lng: number; tm: { x: number; y: number }; radius: number }) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/gis/com/report/capture.json`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({
        type: "circleRadius",
        analyType: "bizonAnls",
        centerX: input.lat, // 이름과 달리 centerX가 위도다 (원본 앱이 그렇게 보낸다)
        centerY: input.lng,
        transformX: input.tm.x,
        transformY: input.tm.y,
        upjongCd: PCBANG_UPJONG,
        kakaoPathStr: "",
        pathStr: "",
        radius: input.radius,
        mapLevelDecision: input.radius,
        apiLogin: "N",
        sprNo: 0,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    // 네트워크 단계 실패 — `fetch failed` 한 줄로 뭉개지지 않게 원인과 실행 리전을 싣는다.
    throw new Error(describeFetchFailure(err, "소상공인365 접속 실패(capture.json)"));
  }
  if (!res.ok) throw new Error(`소상공인365 capture.json HTTP ${res.status}`);
  const json = (await res.json()) as { analyNo?: string; analyDate?: string };
  if (!json.analyNo) throw new Error("소상공인365가 analyNo를 주지 않았다(사이트 구조 변경 가능)");
  return { analyNo: json.analyNo, analyDate: json.analyDate ?? "" };
}

async function fetchTab(tab: number, params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetch(`${BASE}/gis/bizonAnls/report/sg/sang_gwon${tab}.sg?${qs}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(describeFetchFailure(err, `소상공인365 접속 실패(sang_gwon${tab})`));
  }
  if (!res.ok) throw new Error(`소상공인365 sang_gwon${tab} HTTP ${res.status}`);
  return res.text();
}

/** 탭1 HTML에서 행정동코드/이름을 캔다. 탭2~8이 이걸 요구한다(없으면 전부 500). */
export function parseAdmin(html: string): { admiCd: string; admiNm: string } {
  const cd = html.match(/var\s+aACd\s*=\s*"([^"]*)"/);
  const nm = html.match(/var\s+aANm\s*=\s*"([^"]*)"/);
  if (!cd?.[1]) throw new Error("소상공인365 응답에서 aACd를 못 찾았다 — 구조가 바뀌었을 수 있다");
  return { admiCd: cd[1], admiNm: nm?.[1] ?? "" };
}

/**
 * 탭4의 "성별/연령대별 일평균 유동인구" 표에서 선택 영역 행을 캔다.
 *
 * ⚠️ 같은 모양의 표가 주거인구·직장인구에도 있다. 그래서 제목을 앵커로 잡고 그 뒤 첫 표만
 *    본다 — 앵커 없이 첫 표를 집으면 **에러 없이 엉뚱한 값**이 들어온다(2026-09-15에 실제로
 *    그럴 뻔했다).
 */
export function parseDemographics(html: string): SbizFloatingDemographics | null {
  const anchor = html.indexOf("성별/연령대별 일평균 유동인구");
  if (anchor === -1) return null;
  const section = html.slice(anchor, anchor + 20000);
  const row = section.match(
    /<th[^>]*rowspan="2"[^>]*>\s*선택 영역\s*<\/th>[\s\S]{0,200}?<td[^>]*rowspan="2"[^>]*>([\d,]+)<\/td>((?:[\s\S]{0,40}?<td[^>]*>[\d,.]+<\/td>){8})/,
  );
  if (!row) return null;
  const cells = [...row[2].matchAll(/<td[^>]*>([\d,.]+)<\/td>/g)].map((m) => num(m[1]));
  if (cells.length < 8) return null;
  return {
    total: num(row[1]),
    male: cells[0],
    female: cells[1],
    age10s: cells[2],
    age20s: cells[3],
    age30s: cells[4],
    age40s: cells[5],
    age50s: cells[6],
    age60plus: cells[7],
  };
}

/** 탭4에서 월 라벨과 "선택 영역" 계열을 캔다. 선택 영역이 우리가 준 반경 원이다. */
export function parseFlowPopulation(html: string): { months: string[]; selected: number[] | null } {
  const months = [...html.matchAll(/flowByMnth\.push\("([^"]*)"\)/g)].map((m) => m[1]);
  const series: Record<string, number[]> = {};
  for (const b of html.matchAll(/flowPopCnt\.push\(\{\s*name\s*:\s*"([^"]*)"\s*,\s*data\s*:\s*\[([\s\S]*?)\]/g)) {
    series[b[1]] = [...b[2].matchAll(/Number\("([^"]*)"\)/g)].map((m) => Number(m[1]));
  }
  // 사이트가 "선택 영역"과 "선택영역"을 섞어 쓴다(collectSbizReportTabs.mjs 주석).
  const selected = series["선택 영역"] ?? series["선택영역"] ?? null;
  return { months, selected };
}

const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

/**
 * 한 지점·한 반경의 유동인구를 받는다.
 *
 * 12개월 평균과 성별·연령 환산은 `writeFloatingPopulationToFirestore.mjs`의 규칙 그대로다:
 *   avg   = 최근 12개월 평균
 *   scale = avg ÷ 최근월          (연령·성별표는 최근월 기준이라 평균 축척으로 옮긴다)
 */
export async function collectSbizFloating(
  origin: { lat: number; lng: number },
  radiusM: number,
): Promise<SbizFloatingResult> {
  const tm = to5181(origin.lng, origin.lat);
  const issued = await issueAnalyNo({ ...origin, tm, radius: radiusM });
  await sleep(DELAY_MS);

  const tab1 = await fetchTab(1, {
    analyNo: issued.analyNo,
    kmAnalyNo: "",
    upjongCd: PCBANG_UPJONG,
    xcnts: String(tm.x),
    ydnts: String(tm.y),
    center_x: String(tm.x),
    center_y: String(tm.y),
    analyDate: issued.analyDate,
    a: "01",
    b: "01",
    c: "01",
    apiLogin: "",
    lKey: "",
    xtLoginId: "",
  });
  const admin = parseAdmin(tab1);
  await sleep(DELAY_MS);

  const tab4 = await fetchTab(4, {
    analyNo: issued.analyNo,
    analyDate: issued.analyDate,
    upjongCd: PCBANG_UPJONG,
    admiCd: admin.admiCd,
    admiNm: admin.admiNm,
    kmAnalyNo: "",
    xtLoginId: "",
  });

  const flow = parseFlowPopulation(tab4);
  const demographics = parseDemographics(tab4);
  if (!flow.selected?.length) throw new Error("소상공인365 응답에서 월별 유동인구를 못 찾았다");
  if (!demographics) throw new Error("소상공인365 응답에서 성별/연령 유동인구 표를 못 찾았다");

  const last12 = flow.selected.slice(-12);
  const avg = Math.round(mean(last12));
  const recent = flow.selected[flow.selected.length - 1];
  const scale = recent > 0 ? avg / recent : 1;
  const s = (v: number) => Math.round(v * scale);

  return {
    radiusM,
    avg,
    months: flow.months,
    monthly: flow.selected,
    scale,
    scaled: {
      total: avg,
      male: s(demographics.male),
      female: s(demographics.female),
      age10s: s(demographics.age10s),
      age20s: s(demographics.age20s),
      age30s: s(demographics.age30s),
      age40s: s(demographics.age40s),
      age50s: s(demographics.age50s),
      age60plus: s(demographics.age60plus),
    },
    admiCd: admin.admiCd,
    admiNm: admin.admiNm,
  };
}
