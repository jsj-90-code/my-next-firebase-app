"use client";

// 기존 가맹점 관리 화면.
// 신규 가맹점이 오픈하면 이 화면에서 등록하고, 매달 실적(월매출)과 회원 스냅샷을 계속
// 쌓아나간다. Google Sheet 없이도 이 화면 하나로 기존 가맹점 데이터가 계속 축적되도록 만든
// "구조"다 — storeEvalExistingStores/storeEvalExistingStoreSales/storeEvalExistingStoreMembers를
// 그대로 사용한다(src/lib/storeEval/store.ts).

import { useCallback, useEffect, useState } from "react";
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
    competitivenessScore: null,
    actualMonthlyRevenueAvg: null,
    completedMonths: 0,
    address: null,
    hasElevator: null,
    demographicsYear: null,
    renovationYear: null,
    ownVgaBase: null,
    ownVgaTop: null,
    ownGameZoneCount: null,
    ownRoom1: null,
    ownRoom2: null,
    ownTeamRoom: null,
    ownCoupleZone: null,
    ownVipZone: null,
    ownFriendsZone: null,
    ownFoodScore: null,
    ownInteriorScore: null,
    ownMonitorScore: null,
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
    floating500Female: null,
    floating500_10s: null,
    floating500_20s: null,
    floating500_30s: null,
    floating500_40s: null,
    floating500_50s: null,
    floating500_60plus: null,
    licensedPcStores500m: null,
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
    <section className={`${sectionClass} border-zinc-300 dark:border-zinc-700`}>
      <h3 className={sectionTitleClass}>신규 가맹점 등록</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
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
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          취소
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {saving ? "저장 중..." : "등록"}
        </button>
      </div>
    </section>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
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
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {store.predictedAtConversion ? (
        <div className="mb-4 rounded-lg border border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
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
        <p className="mb-4 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
          후보지 {store.originCandidateCode}에서 연결됐지만, 예측값 스냅샷은 이미 재계산으로 덮어써져서 남아있지 않습니다.
        </p>
      ) : (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950">
          <TextField label="후보지코드 연결 (예: N001)" value={linkCandidateCode} onChange={setLinkCandidateCode} placeholder="N001" />
          <button
            type="button"
            disabled={busy || !linkCandidateCode.trim()}
            onClick={handleLink}
            className="h-fit rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            연결
          </button>
          {linkMessage && <p className="text-xs text-zinc-500 dark:text-zinc-400">{linkMessage}</p>}
        </div>
      )}

      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">운영 상태 (사후 운영이슈·가맹상태)</h4>
      <div className={`${gridClass} mt-2`}>
        <SelectField label="가맹상태" value={editStore.franchiseStatus} onChange={(v) => setEditStore((p) => ({ ...p, franchiseStatus: v }))} options={FRANCHISE_STATUS_OPTIONS} />
        <BooleanSelectField label="산식학습제외" value={editStore.excludedFromModel} onChange={(v) => setEditStore((p) => ({ ...p, excludedFromModel: v ?? false }))} />
        <TextField label="학습제외사유" value={editStore.excludedReason ?? ""} onChange={(v) => setEditStore((p) => ({ ...p, excludedReason: v || null }))} hint="예: 오픈 후 운영관리 문제, 경쟁점 가격전쟁" />
        <SelectField label="브랜드" value={editStore.brandType} onChange={(v) => setEditStore((p) => ({ ...p, brandType: v as ExistingStore["brandType"] }))} options={BRAND_OPTIONS} />
      </div>
      <button type="button" disabled={busy} onClick={saveStoreEdits} className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
        운영 상태 저장
      </button>

      <h4 className="mt-5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">월매출 기록 ({sales.length}건)</h4>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <TextField label="연월 (yyyy-MM)" value={yearMonth} onChange={setYearMonth} placeholder="2026-08" />
        <NumberField label="PC매출" value={pcSales} onChange={setPcSales} />
        <NumberField label="상품매출" value={productSales} onChange={setProductSales} />
        <button type="button" disabled={busy || !yearMonth} onClick={saveSales} className="h-fit rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          월매출 추가/수정
        </button>
      </div>
      {!loading && (
        <div className="mt-2 max-h-40 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
          {sales.map((s) => (
            <div key={s.yearMonth} className="flex justify-between border-b border-zinc-200 py-1 dark:border-zinc-800">
              <span>{s.yearMonth}</span>
              <span>{formatWon((s.pcSales ?? 0) + (s.productSales ?? 0))}</span>
            </div>
          ))}
          {sales.length === 0 && <p>기록 없음</p>}
        </div>
      )}

      <h4 className="mt-5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">회원 스냅샷 ({members.length}건) — 12개월 미만 매장 위주로 계속 갱신</h4>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <DateField label="회원자료기준일" value={snapshotDate} onChange={setSnapshotDate} />
        <NumberField label="총회원수_집계" value={totalMembers} onChange={setTotalMembers} />
        <button type="button" disabled={busy || !snapshotDate} onClick={saveMember} className="h-fit rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          회원 스냅샷 추가
        </button>
      </div>
      {!loading && (
        <div className="mt-2 max-h-32 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
          {members.map((m) => (
            <div key={m.snapshotDate} className="flex justify-between border-b border-zinc-200 py-1 dark:border-zinc-800">
              <span>{m.snapshotDate}</span>
              <span>{formatNumber(m.totalMembersReported)}명</span>
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">기존 가맹점 관리</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            신규 가맹점이 오픈하면 여기서 등록하고, 매달 매출과 회원 데이터를 계속 쌓습니다. V61 학습·검증(6. 기존 가맹점 검증)은 여기 쌓인
            데이터를 그대로 사용합니다. 블랙라벨 매장만 표시합니다
            {hiddenCount > 0 && ` (리그PC방·확인필요 ${hiddenCount}곳은 숨김)`}.
          </p>
        </div>
        {!showNew && (
          <button type="button" onClick={() => setShowNew(true)} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">불러오는 중...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
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
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {blackLabelStores.map((s) => (
                <>
                  <tr key={s.storeCode} className="text-zinc-800 dark:text-zinc-200">
                    <td className="px-3 py-2 font-medium">{s.storeCode}</td>
                    <td className="px-3 py-2">{s.storeName}</td>
                    <td className="px-3 py-2">{s.brandType ?? "확인필요"}</td>
                    <td className="px-3 py-2">{s.openedAt ?? "-"}</td>
                    <td className="px-3 py-2">{formatNumber(s.pcCount)}</td>
                    <td className="px-3 py-2">{s.completedMonths ?? 0}개월</td>
                    <td className="px-3 py-2">{formatWon(s.actualMonthlyRevenueAvg)}</td>
                    <td className="px-3 py-2">{s.franchiseStatus ?? "-"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === s.storeCode ? null : s.storeCode)}
                        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
                </>
              ))}
              {blackLabelStores.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                    {stores.length === 0
                      ? "등록된 기존 가맹점이 없습니다."
                      : "블랙라벨로 확인된 매장이 없습니다(브랜드가 리그PC방·확인필요인 매장뿐입니다)."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
