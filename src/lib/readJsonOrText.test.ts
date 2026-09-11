import { describe, expect, it } from "vitest";
import { readJsonOrText } from "./readJsonOrText";

const res = (body: string, status = 200, type = "application/json") =>
  new Response(body, { status, headers: { "Content-Type": type } });

describe("readJsonOrText", () => {
  it("정상 JSON은 그대로 돌려준다", async () => {
    const data = await readJsonOrText<{ seats: number }>(res(JSON.stringify({ seats: 17 })));
    expect(data.seats).toBe(17);
    expect(data.error).toBeUndefined();
  });

  // 게이트웨이가 본문 크기 초과 시 실제로 돌려주는 형태. res.json()이면 여기서 던져진다.
  it("순수 텍스트 오류는 그 텍스트를 error로 준다", async () => {
    const data = await readJsonOrText(res("Request Entity Too Large", 413, "text/plain"));
    expect(data.error).toBe("Request Entity Too Large");
  });

  // AI 라우트가 타임아웃되면 HTML 페이지가 온다. 그대로 화면에 뿌리면 태그가 노출된다.
  it("HTML 오류 페이지는 title만 뽑아 한 줄로 만든다", async () => {
    const html = "<html><head><title>504 Gateway Time-out</title></head><body><h1>504</h1></body></html>";
    const data = await readJsonOrText(res(html, 504, "text/html"));
    expect(data.error).toBe("서버 오류 (HTTP 504): 504 Gateway Time-out");
    expect(data.error).not.toContain("<");
  });

  it("title이 없는 HTML은 태그를 걷어낸 본문을 쓴다", async () => {
    const data = await readJsonOrText(res("<html><body><h1>Bad Gateway</h1></body></html>", 502, "text/html"));
    expect(data.error).toBe("서버 오류 (HTTP 502): Bad Gateway");
  });

  it("빈 본문은 상태 코드로 설명한다", async () => {
    const data = await readJsonOrText(res("", 500, "text/plain"));
    expect(data.error).toBe("서버 오류 (HTTP 500)");
  });

  it("아주 긴 텍스트는 잘라서 준다", async () => {
    const data = await readJsonOrText(res("x".repeat(500), 500, "text/plain"));
    expect(data.error!.length).toBeLessThanOrEqual(201);
    expect(data.error!.endsWith("…")).toBe(true);
  });

  // 실패했을 때 error 말고는 아무 필드도 없다 — 호출부가 `?? 기본값`으로 받아야 하는 이유.
  it("실패 시 나머지 필드는 undefined다", async () => {
    const data = await readJsonOrText<{ seats: number }>(res("boom", 500, "text/plain"));
    expect(data.seats).toBeUndefined();
    expect(data.error).toBe("boom");
  });
});
