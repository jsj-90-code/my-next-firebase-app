import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/gemini", () => ({
  getLocationEvalGeminiClient: () => ({ models: { generateContent } }),
  getLocationEvalGeminiModel: () => "test-model",
}));

import { runLocationEvalDraft } from "./locationEvalAi";

const draft = {
  fields: {
    locationScore: 3,
    preemptionScore: 3,
    visibilityScore: 3,
    specialDemandType: "없음",
    specialDemandIntensity: "없음",
    inflowRestriction: "없음",
    marketStructureMemo: "테스트",
  },
  confidence: {
    locationScore: 0.8,
    preemptionScore: 0.8,
    visibilityScore: 0.8,
    specialDemandType: 0.8,
    specialDemandIntensity: 0.8,
    inflowRestriction: 0.8,
    marketStructureMemo: 0.8,
  },
  rationale: "테스트 근거",
};

describe("runLocationEvalDraft", () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce({ text: "조사 결과" }).mockResolvedValueOnce({ text: JSON.stringify(draft) });
  });

  it("검증된 지도 이미지 MIME 형식을 Gemini 요청까지 그대로 전달한다", async () => {
    await expect(
      runLocationEvalDraft({ contextText: "입지 자료", mapImageBase64: "aW1hZ2U=", mapImageMimeType: "image/jpeg" }),
    ).resolves.toEqual(draft);

    expect(generateContent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: "aW1hZ2U=" } },
              expect.objectContaining({ text: expect.stringContaining("입지 자료") }),
            ],
          },
        ],
      }),
    );
  });
});
