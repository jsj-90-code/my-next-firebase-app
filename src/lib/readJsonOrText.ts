/**
 * 응답 본문을 JSON으로 읽되, JSON이 아니면 그 텍스트를 오류 메시지로 돌려준다.
 *
 * **서버가 항상 JSON을 준다고 가정하면 안 된다.** 실제로 겪은 경우들:
 * - 게이트웨이가 요청 본문 크기 초과 시 순수 텍스트 `Request Entity Too Large`를 돌려준다.
 * - AI 호출처럼 오래 걸리는 라우트가 타임아웃되면 게이트웨이가 HTML 오류 페이지를 돌려준다.
 *
 * 이때 `res.json()`을 그대로 쓰면 파싱 에러(`Unexpected token 'R'...`)가 던져져서
 * **진짜 원인이 사용자에게 안 보인다.** 이 함수는 그 텍스트를 `error`에 담아 돌려주므로
 * 호출부의 `data.error ?? "기본 문구"` 패턴이 그대로 동작한다.
 *
 * 실패했을 때는 `error` 말고는 아무 필드도 없다. 호출부는 나머지를 전부
 * `?? 기본값`으로 받아야 한다.
 */
export async function readJsonOrText<T = Record<string, unknown>>(
  res: Response,
): Promise<Partial<T> & { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: describeNonJsonBody(text, res.status) } as Partial<T> & { error: string };
  }
}

/**
 * JSON이 아닌 본문을 사람이 읽을 한 줄로 만든다.
 *
 * 게이트웨이 오류는 보통 HTML 페이지째로 온다. 그걸 그대로 화면에 뿌리면
 * `<html><head><title>504 Gateway Time-out</title>...`이 통째로 노출된다 —
 * 파싱 에러보다는 낫지만 여전히 읽을 수 없다. `<title>`이 있으면 그걸 쓰고,
 * 없으면 태그를 걷어낸 첫 줄만 쓴다.
 */
function describeNonJsonBody(text: string, status: number): string {
  const fallback = `서버 오류 (HTTP ${status})`;
  const body = text.trim();
  if (!body) return fallback;

  if (/<\/?[a-z][\s\S]*>/i.test(body)) {
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    if (title) return `${fallback}: ${title}`;
    const stripped = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return stripped ? `${fallback}: ${stripped.slice(0, 120)}` : fallback;
  }

  // 순수 텍스트 오류("Request Entity Too Large" 등)는 그 자체가 이미 설명이다.
  return body.length > 200 ? `${body.slice(0, 200)}…` : body;
}
