import { describe, expect, it } from "vitest";
import { applyAffine, fitPlateTransform, mapRect, type Affine } from "./plateOverlay";

// 피난안내도 = 도면을 0.8배 줄이고 (0.1, 0.05) 옮긴 그림이라고 하자.
const truth: Affine = [0.8, 0, 0.1, 0, 0.8, 0.05];
const zone = (x: number, y: number, w = 0.1, h = 0.2) => ({ x, y, w, h });
const onPlate = (r: ReturnType<typeof zone>) => {
  const [x0, y0] = applyAffine(truth, r.x, r.y);
  const [x1, y1] = applyAffine(truth, r.x + r.w, r.y + r.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

describe("fitPlateTransform", () => {
  const zones = [zone(0.1, 0.1), zone(0.5, 0.1), zone(0.1, 0.6), zone(0.6, 0.6), zone(0.3, 0.35)];

  it("존 상자로 도면 → 피난안내도 변환을 찾는다", () => {
    const fit = fitPlateTransform(zones.map((z) => ({ src: z, dst: onPlate(z) })))!;
    fit.transform.forEach((v, i) => expect(v).toBeCloseTo(truth[i], 6));
    expect(mapRect(fit.transform, zones[0])[0][0]).toBeCloseTo(0.18, 6);
  });

  it("크게 틀린 존 하나는 빼고 맞춘다", () => {
    const pairs = zones.map((z) => ({ src: z, dst: onPlate(z) }));
    pairs[4] = { src: zones[4], dst: { ...pairs[4].dst, x: pairs[4].dst.x + 0.3 } };
    const fit = fitPlateTransform(pairs)!;
    expect(fit.dropped).toBe(1);
    fit.transform.forEach((v, i) => expect(v).toBeCloseTo(truth[i], 6));
  });

  it("존이 3개 미만이면 null", () => {
    expect(fitPlateTransform(zones.slice(0, 2).map((z) => ({ src: z, dst: onPlate(z) })))).toBeNull();
  });
});
