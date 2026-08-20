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
