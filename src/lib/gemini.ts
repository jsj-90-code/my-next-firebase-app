import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }

  return client;
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
}

// 좌석번호 인식(존-피난안내도 위치 대응)은 매장당 한 번 정도만 쓰는 대신 여러 이미지를 놓고
// 정교한 공간 추론을 해야 해서, 자주 호출되는 다른 기능들과 달리 무료 할당량이 빠듯해도
// 정확도가 더 높은 모델을 기본값으로 쓴다. 필요하면 GEMINI_MODEL_SEAT_NUMBERS로 덮어쓸 수 있다.
export function getSeatNumberGeminiModel() {
  return process.env.GEMINI_MODEL_SEAT_NUMBERS ?? "gemini-3.6-flash";
}

// 구역 초안 제안도 매장당 한두 번만 쓰는 기능인데, flash-lite로는 화장실/싱크대처럼 책상이
// 아닌 공간을 구역으로 잘못 잡거나 책상 줄을 통째로 빠뜨리는 문제가 있어 좌석번호 인식과
// 같은 이유로 더 정확한 모델을 기본값으로 쓴다. 필요하면 GEMINI_MODEL_SUGGEST_ZONES로 덮어쓸 수 있다.
export function getSuggestZonesGeminiModel() {
  return process.env.GEMINI_MODEL_SUGGEST_ZONES ?? "gemini-3.6-flash";
}

// 입지동선평가 AI 초안(3단계, ai-location-eval 라우트)도 후보지당 한두 번만 쓰지만, 웹검색 조사와
// 다중 필드 판단을 함께 해야 해서 다른 store-eval 기능(예전 Claude 라우트)처럼 더 정확한 모델을
// 기본값으로 둔다. 필요하면 GEMINI_MODEL_LOCATION_EVAL로 덮어쓸 수 있다.
export function getLocationEvalGeminiModel() {
  return process.env.GEMINI_MODEL_LOCATION_EVAL ?? "gemini-3.6-flash";
}

// 2026-08-25 — 웹검색(googleSearch) 그라운딩 도구는 무료 티어에서 아예 제공 안 되고 결제(유료
// 티어) 연결이 필요하다. 그런데 구글 과금은 "키" 단위가 아니라 "프로젝트" 단위라, 결제를 연결하는
// 순간 그 프로젝트에 속한 다른 모든 호출(예: 좌석배치도 자동화의 이미지 인식)도 함께 무료 티어에서
// 유료 티어로 넘어가서 토큰 1개부터 바로 과금 대상이 된다(유료 티어엔 "기본 생성"용 별도 무료
// 할당량이 없음 — 그라운딩만 월 5,000건 무료가 별도로 붙어있는 예외). 그래서 입지동선평가 전용
// 프로젝트/키를 따로 만들어 결제를 연결하고, 좌석배치도 자동화가 쓰는 기존 GEMINI_API_KEY(무료
// 티어)는 절대 건드리지 않는다 — 두 기능이 클라이언트/키 레벨에서 완전히 분리돼 있어야
// 좌석배치도 쪽에 실수로 과금이 번질 수 없다. GEMINI_API_KEY_LOCATION_EVAL을 별도로 설정해야
// 하며, 폴백 없이 명시적으로만 동작한다(기존 공유 키로 조용히 대체되면 이 분리 원칙이 무너진다).
let locationEvalClient: GoogleGenAI | null = null;

export function getLocationEvalGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY_LOCATION_EVAL;
  if (!apiKey) return null;
  if (!locationEvalClient) {
    locationEvalClient = new GoogleGenAI({ apiKey });
  }
  return locationEvalClient;
}
