// 경쟁점 가동률 측정기 — IP대역 글자를 IP 목록으로 푼다(2026-10-06 신설).
//
// 사람이 적는 모양이 제각각이라 넓게 받는다:
//   118.128.168.1~110 · 118.128.168.1 ~ 110 · 118.128.168.1-118.128.168.110 · 118.128.168.7(한 개)
// 여러 대역은 쉼표·줄바꿈·세미콜론으로 나눈다. 같은 IP는 한 번만 센다.

export const MAX_IPS_PER_STORE = 1024;

export type IpRangeParse = {
  ips: string[];
  errors: string[];
};

function parseIp(text: string): number[] | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

function toNumber(ip: number[]): number {
  return ((ip[0] << 24) >>> 0) + (ip[1] << 16) + (ip[2] << 8) + ip[3];
}

function toText(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function parseIpRanges(input: string): IpRangeParse {
  const ips: string[] = [];
  const seen = new Set<number>();
  const errors: string[] = [];

  for (const raw of input.split(/[,;\n\r]+/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const [startText, endText] = chunk.split(/\s*[~\-]\s*/);
    const start = parseIp(startText ?? "");
    if (!start) {
      errors.push(`"${chunk}" — IP 모양이 아닙니다.`);
      continue;
    }
    let endNum = toNumber(start);
    if (endText != null && endText !== "") {
      // 끝이 숫자 하나면 마지막 자리만 바꾼 것으로 본다(118.128.168.1~110).
      const end = /^\d{1,3}$/.test(endText) ? [start[0], start[1], start[2], Number(endText)] : parseIp(endText);
      if (!end || end[3] > 255) {
        errors.push(`"${chunk}" — 끝 IP를 읽지 못했습니다.`);
        continue;
      }
      endNum = toNumber(end);
    }
    const startNum = toNumber(start);
    if (endNum < startNum) {
      errors.push(`"${chunk}" — 끝이 시작보다 작습니다.`);
      continue;
    }
    if (endNum - startNum + 1 > MAX_IPS_PER_STORE) {
      errors.push(`"${chunk}" — 한 매장에 IP ${MAX_IPS_PER_STORE}개까지만 됩니다.`);
      continue;
    }
    for (let n = startNum; n <= endNum; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      ips.push(toText(n));
    }
  }

  if (ips.length > MAX_IPS_PER_STORE) {
    errors.push(`IP가 모두 ${ips.length}개입니다 — 한 매장에 ${MAX_IPS_PER_STORE}개까지만 됩니다.`);
  }
  return { ips, errors };
}
