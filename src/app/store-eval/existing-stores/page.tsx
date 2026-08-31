"use client";

// 기존 가맹점 관리 화면.
// 신규 가맹점이 오픈하면 이 화면에서 등록하고, 매달 실적(월매출)과 회원 스냅샷을 계속
// 쌓아나간다. Google Sheet 없이도 이 화면 하나로 기존 가맹점 데이터가 계속 축적되도록 만든
// "구조"다 — storeEvalExistingStores/storeEvalExistingStoreSales/storeEvalExistingStoreMembers를
// 그대로 사용한다(src/lib/storeEval/store.ts).

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime, formatNumber, formatPercent, formatWon } from "@/lib/storeEval/format";
import {
  linkExistingStoreToCandidate,
  listExistingStoreMembers,
  listExistingStores,
  listExistingStoreSales,
  upsertExistingStore,
  upsertExistingStoreMemberSnapshot,
  upsertExistingStoreSales,
} from "@/lib/storeEval/store";
import type { ExistingStore, ExistingStoreMemberSnapshot, ExistingStoreMonthlySales } from "@/lib/storeEval/types";
import {
  BooleanSelectField,
  DateField,
  NumberField,
  SelectField,
  TextField,
  gridClass,
  sectionClass,
  sectionTitleClass,
} from "../candidates/[code]/formFields";

const FRANCHISE_STATUS_OPTIONS = [
  { value: "정상", label: "정상" },
  { value: "가맹해지", label: "가맹해지" },
  { value: "폐업", label: "폐업" },
];
const BRAND_OPTIONS = [
  { value: "블랙라벨", label: "블랙라벨" },
  { value: "리그PC방", label: "리그PC방" },
  { value: "확인필요", label: "확인필요" },
];
const GROUND_LEVEL_OPTIONS = [
  { value: "지상", label: "지상" },
  { value: "지하", label: "지하" },
];

function blankStore(): ExistingStore {
  const now = Date.now();
  return {
    storeCode: "",
    storeName: "",
    pcCount: null,
    evaluationPcCount: null,
    floor: null,
    groundLevel: null,
    openedAt: null,
    franchiseStatus: "정상",
    excludedFromModel: false,
    excludedReason: null,
    v61Predicted: null,
    referenceMarketDemand: null,
    brandType: "블랙라벨",
    specialDemandType: null,
    specialDemandIntensity: null,
    validationUse: null,
    hourlyRate: null,
    ownDemand: null,
    marketDemand: null,
    competitorIp: null,
    competitivenessScore: null,
    actualMonthlyRevenueAvg: null,
    completedMonths: 0,
    address: null,
    hasElevator: null,
    demographicsYear: null,
    renovationYear: null,
    ownCpu: null,
    ownCpuTop1: null,
    ownCpuTop2: null,
    ownRam: null,
    ownRamTop: null,
    ownVgaBase: null,
    ownVgaTop: null,
    ownVgaTop2: null,
    ownSingleSeatCount: null,
    ownRoom1: null,
    ownRoom2: null,
    ownTeamRoom: null,
    ownCoupleZone: null,
    ownVipZone: null,
    ownFriendsZone: null,
    ownFirstClassZone: null,
    ownTeamRoomTotalSeats: null,
    ownTeamRoomTotalSeatsBasis: null,
    ownFoodScore: null,
    ownInteriorScore: null,
    ownManagementScore: null,
    ownMonitorBase: null,
    ownMonitorTop: null,
    ownFoodBrand: null,
    ownInteriorLevelScore: null,
    ownInteriorConditionScore: null,
    ownSeatZoneScore: null,
    ownComfortScore: null,
    pop500m: null,
    area1kmKm2: null,
    pop1km: null,
    male1kmRatio: null,
    age1km_0_9: null,
    age1km_10_19: null,
    age1km_20_29: null,
    age1km_30_39: null,
    age1km_40_49: null,
    age1km_50_59: null,
    age1km_60_69: null,
    age1km_70_79: null,
    age1km_80plus: null,
    floating500Avg: null,
    floating500Male: null,
    floating500_10s: null,
    floating500_20s: null,
    floating500_30s: null,
    floating500_40s: null,
    floating500_50s: null,
    floating500_60plus: null,
    operatingPcStores500m: null,
    originCandidateCode: null,
    predictedAtConversion: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  };
}

function NewStoreForm({ onCancel, onSaved, actor }: { onCancel: () => void; onSaved: () => void; actor: string | null }) {
  const [form, setForm] = useState<ExistingStore>(blankStore());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ExistingStore>(key: K, value: ExistingStore[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    if (!form.storeCode.trim() || !form.storeName.trim()) {
      setError("가맹점코드와 가맹점명은 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      await upsertExistingStore({ ...form, updatedAt: Date.now(), updatedBy: actor });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`${sectionClass} app-card`}>
      <h3 className={sectionTitleClass}>신규 가맹점 등록</h3>
      <p className="mt-1 text-xs text-[#8a8072]">
        신규후보지 평가를 거쳐 오픈한 매장은 해당 후보지 화면의 &ldquo;기존 가맹점으로 전환&rdquo; 버튼을 쓰는 게 더 편합니다(경쟁점·입지평가를
        다시 입력할 필요가 없습니다). 이 폼은 평가 없이 바로 등록해야 하는 경우용입니다.
      </p>
      <div className={`${gridClass} mt-4`}>
        <TextField label="가맹점코드" value={form.storeCode} onChange={(v) => set("storeCode", v)} required />
        <TextField label="가맹점명" value={form.storeName} onChange={(v) => set("storeName", v)} required />
        <TextField label="주소" value={form.address ?? ""} onChange={(v) => set("address", v || null)} />
        <NumberField label="PC대수" value={form.pcCount} onChange={(v) => set("pcCount", v)} />
        <DateField label="오픈일" value={form.openedAt} onChange={(v) => set("openedAt", v)} />
        <SelectField label="브랜드" value={form.brandType} onChange={(v) => set("brandType", v as ExistingStore["brandType"])} options={BRAND_OPTIONS} />
        <SelectField label="가맹상태" value={form.franchiseStatus} onChange={(v) => set("franchiseStatus", v)} options={FRANCHISE_STATUS_OPTIONS} />
        <NumberField label="요금표_시간당원" value={form.hourlyRate} onChange={(v) => set("hourlyRate", v)} />
      </div>
      {error && <p className="mt-3 text-sm text-[var(--sl-danger)]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="app-btn-outline rounded-lg px-4 py-2 text-sm">
          취소
        </button>
        <button type="button" disabled={saving} onClick={handleSave} className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">
          {saving ? "저장 중..." : "등록"}
        </button>
      </div>
    </section>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="app-card-sm rounded-md px-2.5 py-1.5">
      <p className="text-[11px] text-[#8a8072]">{label}</p>
      <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">{value}</p>
    </div>
  );
}

function StoreDetailPanel({ store, actor, onChanged }: { store: ExistingStore; actor: string | null; onChanged: () => void }) {
  const [sales, setSales] = useState<ExistingStoreMonthlySales[]>([]);
  const [members, setMembers] = useState<ExistingStoreMemberSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearMonth, setYearMonth] = useState("");
  const [pcSales, setPcSales] = useState<number | null>(null);
  const [productSales, setProductSales] = useState<number | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [totalMembers, setTotalMembers] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [editStore, setEditStore] = useState<ExistingStore>(store);
  const [linkCandidateCode, setLinkCandidateCode] = useState("");
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, m] = await Promise.all([listExistingStoreSales(store.storeCode), listExistingStoreMembers(store.storeCode)]);
    setSales(s.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth)));
    setMembers(m.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate)));
    setLoading(false);
  }, [store.storeCode]);

  useEffect(() => {
    load();
    setEditStore(store);
  }, [load, store]);

  async function saveSales() {
    if (!yearMonth) return;
    setBusy(true);
    try {
      await upsertExistingStoreSales({
        storeCode: store.storeCode,
        yearMonth,
        pcSales,
        productSales,
        productRatio: null,
        utilizationRate: null,
        salesPerPcPerDay: null,
      });
      setYearMonth("");
      setPcSales(null);
      setProductSales(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveMember() {
    if (!snapshotDate) return;
    setBusy(true);
    try {
      await upsertExistingStoreMemberSnapshot({
        storeCode: store.storeCode,
        snapshotDate,
        totalMembersReported: totalMembers,
        age7under_male: null,
        age7under_female: null,
        age8to13_male: null,
        age8to13_female: null,
        age14to19_male: null,
        age14to19_female: null,
        age20to30_male: null,
        age20to30_female: null,
        age31to45_male: null,
        age31to45_female: null,
        age46plus_male: null,
        age46plus_female: null,
        enteredBy: actor,
        memo: null,
        updatedAt: Date.now(),
      });
      setSnapshotDate(null);
      setTotalMembers(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveStoreEdits() {
    setBusy(true);
    try {
      await upsertExistingStore({ ...editStore, updatedAt: Date.now(), updatedBy: actor });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleLink() {
    if (!linkCandidateCode.trim()) return;
    setBusy(true);
    setLinkMessage(null);
    try {
      const updated = await linkExistingStoreToCandidate(store.storeCode, linkCandidateCode.trim(), actor);
      setLinkMessage(
        updated.predictedAtConversion
          ? "연결했습니다. 후보지평가 당시 예측값도 함께 불러왔습니다."
          : "연결했습니다. 다만 그 후보지의 예측값 스냅샷은 이미 재계산으로 덮어써져서 남아있지 않습니다(연결만 됨).",
      );
      setLinkCandidateCode("");
      onChanged();
    } catch (err) {
      setLinkMessage(err instanceof Error ? err.message : "연결 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-card-sm mt-3 rounded-xl p-4">
      {store.predictedAtConversion ? (
        <div className="app-card mb-4 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
            후보지평가 당시 예측 vs 실제매출 — {store.predictedAtConversion.candidateCode} (
            {formatDateTime(store.predictedAtConversion.calculatedAt)} 계산)
          </h4>
          <div className={`${gridClass} mt-2`}>
            <StatBox label="예측 당시 V62 최종예상월매출" value={formatWon(store.predictedAtConversion.v62Final)} />
            <StatBox label="예측 당시 보수판단매출(85%)" value={formatWon(store.predictedAtConversion.conservativeSales)} />
            <StatBox label="예측 당시 상한참고매출(115%)" value={formatWon(store.predictedAtConversion.upperSales)} />
            <StatBox label="현재 실제매출평균" value={formatWon(store.actualMonthlyRevenueAvg)} />
            <StatBox
              label="오차율 (실제-예측)/예측"
              value={
                store.predictedAtConversion.v62Final && store.actualMonthlyRevenueAvg != null
                  ? formatPercent((store.actualMonthlyRevenueAvg - store.predictedAtConversion.v62Final) / store.predictedAtConversion.v62Final)
                  : "실제매출 입력 전"
              }
            />
          </div>
        </div>
      ) : store.originCandidateCode ? (
        <p className="app-card mb-4 rounded-lg px-3 py-2 text-xs text-[#5c5346] dark:text-[#c9bfae]">
          후보지 {store.originCandidateCode}에서 연결됐지만, 예측값 스냅샷은 이미 재계산으로 덮어써져서 남아있지 않습니다.
        </p>
      ) : (
        <div className="app-card mb-4 flex flex-wrap items-end gap-2 rounded-lg p-3">
          <TextField label="후보지코드 연결 (예: N001)" value={linkCandidateCode} onChange={setLinkCandidateCode} placeholder="N001" />
          <button type="button" disabled={busy || !linkCandidateCode.trim()} onClick={handleLink} className="app-btn-outline h-fit rounded-md px-3 py-1.5 text-xs disabled:opacity-50">
            연결
          </button>
          {linkMessage && <p className="text-xs text-[#8a8072]">{linkMessage}</p>}
        </div>
      )}

      <h4 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">운영 상태 (사후 운영이슈·가맹상태)</h4>
      <div className={`${gridClass} mt-2`}>
        <SelectField label="가맹상태" value={editStore.franchiseStatus} onChange={(v) => setEditStore((p) => ({ ...p, franchiseStatus: v }))} options={FRANCHISE_STATUS_OPTIONS} />
        <BooleanSelectField label="산식학습제외" value={editStore.excludedFromModel} onChange={(v) => setEditStore((p) => ({ ...p, excludedFromModel: v ?? false }))} />
        <TextField label="학습제외사유" value={editStore.excludedReason ?? ""} onChange={(v) => setEditStore((p) => ({ ...p, excludedReason: v || null }))} hint="예: 오픈 후 운영관리 문제, 경쟁점 가격전쟁" />
        <SelectField label="브랜드" value={editStore.brandType} onChange={(v) => setEditStore((p) => ({ ...p, brandType: v as ExistingStore["brandType"] }))} options={BRAND_OPTIONS} />
      </div>
      <button type="button" disabled={busy} onClick={saveStoreEdits} className="app-btn-outline mt-2 rounded-md px-3 py-1.5 text-xs disabled:opacity-50">
        운영 상태 저장
      </button>

      <h4 className="mt-5 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">월매출 기록 ({sales.length}건)</h4>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <TextField label="연월 (yyyy-MM)" value={yearMonth} onChange={setYearMonth} placeholder="2026-08" />
        <NumberField label="PC매출" value={pcSales} onChange={setPcSales} />
        <NumberField label="상품매출" value={productSales} onChange={setProductSales} />
        <button type="button" disabled={busy || !yearMonth} onClick={saveSales} className="app-btn-primary h-fit rounded-md px-3 py-1.5 text-xs disabled:opacity-50">
          월매출 추가/수정
        </button>
      </div>
      {!loading && (
        <div className="mt-2 max-h-40 overflow-y-auto text-xs text-[#5c5346] dark:text-[#c9bfae]">
          {sales.map((s) => (
            <div key={s.yearMonth} className="flex justify-between border-b border-[#171310]/[0.08] py-1 dark:border-white/[0.08]">
              <span>{s.yearMonth}</span>
              <span className="font-mono tabular-nums">{formatWon((s.pcSales ?? 0) + (s.productSales ?? 0))}</span>
            </div>
          ))}
          {sales.length === 0 && <p>기록 없음</p>}
        </div>
      )}

      <h4 className="mt-5 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">회원 스냅샷 ({members.length}건) — 12개월 미만 매장 위주로 계속 갱신</h4>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <DateField label="회원자료기준일" value={snapshotDate} onChange={setSnapshotDate} />
        <NumberField label="총회원수_집계" value={totalMembers} onChange={setTotalMembers} />
        <button type="button" disabled={busy || !snapshotDate} onClick={saveMember} className="app-btn-primary h-fit rounded-md px-3 py-1.5 text-xs disabled:opacity-50">
          회원 스냅샷 추가
        </button>
      </div>
      {!loading && (
        <div className="mt-2 max-h-32 overflow-y-auto text-xs text-[#5c5346] dark:text-[#c9bfae]">
          {members.map((m) => (
            <div key={m.snapshotDate} className="flex justify-between border-b border-[#171310]/[0.08] py-1 dark:border-white/[0.08]">
              <span>{m.snapshotDate}</span>
              <span className="font-mono tabular-nums">{formatNumber(m.totalMembersReported)}명</span>
            </div>
          ))}
          {members.length === 0 && <p>기록 없음</p>}
        </div>
      )}
    </div>
  );
}

export default function ExistingStoresPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState<ExistingStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const list = await listExistingStores();
    setStores(list.sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "")));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 요청사항 — 이 화면은 블랙라벨 매장만 보여준다. 브랜드는 매출DB!지점명 배경색(노란색=
  // 블랙라벨)으로 cron-sync가 채운 brandType 필드를 그대로 쓴다(추측하지 않음, 이미 존재하는
  // 판정 결과를 화면에서 걸러서 보여줄 뿐).
  const blackLabelStores = stores.filter((s) => s.brandType === "블랙라벨");
  const hiddenCount = stores.length - blackLabelStores.length;

  // 요청사항 — 블랙라벨 기준 총 매장 수 + 가맹상태별 분포(정상/해지/기타)를 요약 표시.
  // franchiseStatus는 자유 문자열(예: "정상"/"가맹해지"/"폐업"/"폐점(인허가문제)" 등)이라
  // 고정된 항목만 세지 않고 실제로 존재하는 값을 전부 그대로 집계한다(임의로 뭉개지 않음).
  const franchiseStatusCounts = new Map<string, number>();
  for (const s of blackLabelStores) {
    const key = s.franchiseStatus ?? "미확인";
    franchiseStatusCounts.set(key, (franchiseStatusCounts.get(key) ?? 0) + 1);
  }
  const franchiseStatusBreakdown = [...franchiseStatusCounts.entries()].sort((a, b) => {
    if (a[0] === "정상") return -1;
    if (b[0] === "정상") return 1;
    return b[1] - a[1];
  });

  // 2026-08-25 추가 — 133곳까지 늘어난 목록에서 코드/이름으로 바로 찾기(주소 필드는 이 타입에
  // 없음 - ExistingStore는 재무/운영 데이터 전용, 위치정보는 09_입지동선평가 쪽에 있음).
  const query = search.trim().toLowerCase();
  const visibleStores = query
    ? blackLabelStores.filter((s) => s.storeCode.toLowerCase().includes(query) || s.storeName.toLowerCase().includes(query))
    : blackLabelStores;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">기존 가맹점 관리</h1>
          <p className="mt-1 text-sm text-[#5c5346] dark:text-[#c9bfae]">
            신규 가맹점이 오픈하면 여기서 등록하고, 매달 매출과 회원 데이터를 계속 쌓습니다. V61 학습·검증(6. 기존 가맹점 검증)은 여기 쌓인
            데이터를 그대로 사용합니다. 블랙라벨 매장만 표시합니다
            {hiddenCount > 0 && ` (리그PC방·확인필요 ${hiddenCount}곳은 숨김)`}.
          </p>
        </div>
        {!showNew && (
          <button type="button" onClick={() => setShowNew(true)} className="app-btn-primary rounded-lg px-4 py-2 text-sm">
            + 신규 가맹점 등록
          </button>
        )}
      </div>

      {showNew && (
        <NewStoreForm
          actor={user?.email ?? null}
          onCancel={() => setShowNew(false)}
          onSaved={async () => {
            setShowNew(false);
            await load();
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-[#8a8072]">불러오는 중...</p>
      ) : (
        <div className="app-card-sm flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-4 py-3 text-sm">
          <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">블랙라벨 총 {blackLabelStores.length}개</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-[#5c5346] dark:text-[#c9bfae]">
            {franchiseStatusBreakdown.map(([status, count]) => (
              <span key={status}>
                {status} <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{count}개</span>
              </span>
            ))}
          </span>
        </div>
      )}

      {loading ? null : (
        <>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="가맹점코드·가맹점명으로 검색"
          className="app-input w-full max-w-xs px-3 py-1.5 text-sm"
        />
        <div className="app-card overflow-x-auto rounded-xl">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="app-card-sm text-left text-xs font-medium text-[#8a8072]">
              <tr>
                <th className="px-3 py-2">가맹점코드</th>
                <th className="px-3 py-2">가맹점명</th>
                <th className="px-3 py-2">브랜드</th>
                <th className="px-3 py-2">오픈일</th>
                <th className="px-3 py-2">PC대수</th>
                <th className="px-3 py-2">완료월수</th>
                <th className="px-3 py-2">실제매출평균</th>
                <th className="px-3 py-2">가맹상태</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
              {visibleStores.map((s) => (
                <Fragment key={s.storeCode}>
                  <tr key={s.storeCode} className="app-row text-[#5c5346] dark:text-[#c9bfae]">
                    <td className="px-3 py-2 font-mono font-medium">{s.storeCode}</td>
                    <td className="px-3 py-2">
                      <Link href={`/store-eval/existing-stores/${s.storeCode}`} className="hover:underline">
                        {s.storeName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{s.brandType ?? "확인필요"}</td>
                    <td className="px-3 py-2">{s.openedAt ?? "-"}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatNumber(s.pcCount)}</td>
                    <td className="px-3 py-2">{s.completedMonths ?? 0}개월</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatWon(s.actualMonthlyRevenueAvg)}</td>
                    <td className="px-3 py-2">{s.franchiseStatus ?? "-"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === s.storeCode ? null : s.storeCode)}
                        className="app-btn-outline rounded-md px-2.5 py-1 text-xs"
                      >
                        {expanded === s.storeCode ? "닫기" : "관리"}
                      </button>
                    </td>
                  </tr>
                  {expanded === s.storeCode && (
                    <tr>
                      <td colSpan={9} className="px-3 pb-3">
                        <StoreDetailPanel store={s} actor={user?.email ?? null} onChanged={load} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {visibleStores.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-[#8a8072]">
                    {stores.length === 0
                      ? "등록된 기존 가맹점이 없습니다."
                      : blackLabelStores.length === 0
                        ? "블랙라벨로 확인된 매장이 없습니다(브랜드가 리그PC방·확인필요인 매장뿐입니다)."
                        : `"${search}"와(과) 일치하는 매장이 없습니다.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
