import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { MAX_IPS_PER_STORE, parseIpRanges } from "@/lib/pingMonitor/ipRange";
import { PING_STORES } from "@/lib/pingMonitor/summary";

// 우리 매장 IP 등록(2026-10-28 사용자 "만드셈" — 울산삼산점 IP를 넣으려는데 화면에 칸이 없었다). 그전엔 스크립트로만 넣었다.
// 보안 규칙이 화면에서 isOwnStore를 못 쓰게 막아 두었으므로(경쟁점을 우리 매장으로 바꾸는 걸 막으려고) 여기(admin)서 만든다.
// 개점한 기존점만(후보지는 개점 전이라 잴 우리 매장이 없다), 매장마다 한 줄만. 이미 있으면 그 줄의 "정보 수정"에서 고친다.
// 대역은 한 덩어리 원칙(사용자 10-10) — 측정기 대수 = IP 수로 저장한다. 웹 대수와 다르면 응답에 알려 화면이 경고한다.

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정으로 로그인해 주세요." }, { status: 401 });
  if (!adminDb) return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { ownCode?: unknown; ipRanges?: unknown } | null;
  const ownCode = typeof body?.ownCode === "string" ? body.ownCode.trim() : "";
  const ipRanges = typeof body?.ipRanges === "string" ? body.ipRanges.trim() : "";
  if (!ownCode || ownCode.includes("/")) return NextResponse.json({ error: "매장 코드가 없습니다." }, { status: 400 });

  const parsed = parseIpRanges(ipRanges);
  if (parsed.errors.length) return NextResponse.json({ error: parsed.errors.join(" ") }, { status: 400 });
  if (parsed.ips.length === 0) return NextResponse.json({ error: "IP대역을 적어 주세요." }, { status: 400 });
  if (parsed.ips.length > MAX_IPS_PER_STORE) return NextResponse.json({ error: `IP가 너무 많습니다(${parsed.ips.length}개).` }, { status: 400 });

  const storeSnap = await adminDb.collection("storeEvalExistingStores").doc(ownCode).get();
  if (!storeSnap.exists) return NextResponse.json({ error: "점포평가 기존점만 우리 매장 IP를 넣을 수 있습니다(후보지는 개점 후 기존점 전환 뒤에)." }, { status: 400 });
  const store = storeSnap.data() ?? {};

  const all = await adminDb.collection(PING_STORES).get();
  if (all.docs.some((d) => d.get("ownCode") === ownCode && d.get("isOwnStore") === true))
    return NextResponse.json({ error: "이미 우리 매장 등록이 있습니다 — 우리 매장 줄을 눌러 \"정보 수정\"에서 고쳐 주세요." }, { status: 409 });

  // 다른 등록과 IP가 겹치면 같은 PC를 두 번 잰다 — 측정 중지된 등록은 폐업 자리일 수 있어 막지 않는다(StoreForm 중복 검사와 같은 기준).
  const mine = new Set(parsed.ips);
  const clash = all.docs
    .filter((d) => d.get("active") !== false && String(d.get("ipRanges") ?? "").trim())
    .filter((d) => parseIpRanges(String(d.get("ipRanges"))).ips.some((ip) => mine.has(ip)))
    .map((d) => String(d.get("name") ?? d.id));
  if (clash.length) return NextResponse.json({ error: `다른 등록과 IP가 겹칩니다: ${clash.join(", ")}` }, { status: 409 });

  const storeName = String(store.storeName ?? ownCode);
  const count = parsed.ips.length;
  const webPcCount = typeof store.pcCount === "number" ? store.pcCount : null;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const ref = await adminDb.collection(PING_STORES).add({
    name: `${storeName} (우리 매장)`,
    address: "",
    lat: typeof store.lat === "number" ? store.lat : null,
    lng: typeof store.lng === "number" ? store.lng : null,
    ownCode,
    ownName: storeName,
    isOwnStore: true,
    active: true,
    competitorId: null,
    distanceM: 0,
    ipRanges,
    ipCount: count,
    pcCount: count,
    memo: `우리 매장 · 화면 등록 ${today} ${ipRanges} 손님 PC 대역 ${count}대${webPcCount != null && webPcCount !== count ? `(웹 대수 ${webPcCount})` : ""}`,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: user.email ?? null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.email ?? null,
  });
  return NextResponse.json({ id: ref.id, ipCount: count, webPcCount });
}
