"use client";

// 4단계 — 기존 블랙라벨 매장 대상 AI 채점 정확도 검증 화면.
// 매장 1곳당 Gemini 2단계 호출(웹검색 조사+구조화 추출)에 30~45초가 걸려서, 서버 한 번의
// 요청 안에서 여러 매장을 순차 처리하면 Vercel 함수 타임아웃(300초)을 넘길 수 있다 — 그래서
// 이 화면이 매장 목록을 순차로 반복하며 /api/store-eval/ai-validation-run을 매장당 1번씩 호출한다.
// 결과는 화면에만 표시하고 아무것도 저장하지 않는다(1회성 진단).

import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  SCORE_FIELD_KEYS,
  SCORE_FIELD_LABELS,
  compareLocationScores,
  summarizeAccuracy,
  type StoreValidationResult,
} from "@/lib/storeEval/aiValidation";
import { listExistingStores } from "@/lib/storeEval/store";
import type { ExistingStore } from "@/lib/storeEval/types";

type RunStatus = "idle" | "running" | "done";

type PerStoreOutcome =
  | { status: "ok"; result: StoreValidationResult }
  | { status: "skipped"; storeCode: string; storeName: string; reason: string };

const TARGET_RATIO = 0.8;

export default function AiValidationPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState<ExistingStore[] | null>(null);
  const [sampleSize, setSampleSize] = useState(10);
  const [runAll, setRunAll] = useState(false);
  const [specificQuery, setSpecificQuery] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [outcomes, setOutcomes] = useState<PerStoreOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function ensureStoresLoaded(): Promise<ExistingStore[]> {
    if (stores) return stores;
    const list = await listExistingStores();
    setStores(list);
    return list;
  }

  function pickTargets(all: ExistingStore[]): ExistingStore[] {
    const pool = all.filter((s) => s.brandType === "블랙라벨");
    const query = specificQuery.trim();
    if (query) {
      // 특정 매장만 재검증하고 싶을 때(예: 버그 수정 후 재확인) — 매장코드/매장명 부분일치.
      return pool.filter((s) => s.storeCode.includes(query) || s.storeName.includes(query));
    }
    if (runAll) return pool;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(sampleSize, shuffled.length));
  }

  async function handleRun() {
    setError(null);
    setOutcomes([]);
    try {
      const all = await ensureStoresLoaded();
      const targets = pickTargets(all);
      if (targets.length === 0) {
        setError("검증할 블랙라벨 매장이 없습니다.");
        return;
      }
      setStatus("running");
      const token = await user?.getIdToken();
      const results: PerStoreOutcome[] = [];
      for (let i = 0; i < targets.length; i++) {
        const store = targets[i];
        setProgress({ done: i, total: targets.length, current: store.storeName });
        try {
          const response = await fetch("/api/store-eval/ai-validation-run", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ storeCode: store.storeCode }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "요청 실패");
          if (data.skipped) {
            results.push({ status: "skipped", storeCode: data.storeCode ?? store.storeCode, storeName: data.storeName ?? store.storeName, reason: data.reason ?? "알 수 없는 사유" });
          } else {
            const rows = compareLocationScores(data.groundTruth, data.aiFields);
            results.push({
              status: "ok",
              result: { storeCode: data.storeCode, storeName: data.storeName, address: data.address, rows },
            });
          }
        } catch (err) {
          results.push({
            status: "skipped",
            storeCode: store.storeCode,
            storeName: store.storeName,
            reason: err instanceof Error ? err.message : "요청 실패",
          });
        }
        setOutcomes([...results]);
      }
      setProgress({ done: targets.length, total: targets.length, current: "" });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "검증 중 오류가 발생했습니다.");
      setStatus("idle");
    }
  }

  const okResults = outcomes.filter((o): o is Extract<PerStoreOutcome, { status: "ok" }> => o.status === "ok");
  const skippedResults = outcomes.filter((o): o is Extract<PerStoreOutcome, { status: "skipped" }> => o.status === "skipped");
  const summary = useMemo(() => summarizeAccuracy(okResults.map((o) => o.result)), [okResults]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">AI 채점 검증</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          이미 문을 연 블랙라벨 매장은 오픈 전 사람이 직접 매긴 입지동선평가 점수(5개)가 정답지로
          남아있습니다. 같은 주소로 AI를 다시 돌려 사람 점수와 비교합니다(목표: ±1점 이내 80%).
          지도 이미지는 이 검증에서는 포함하지 않고 텍스트 컨텍스트+웹검색만 사용합니다. 결과는
          화면에만 표시되고 저장되지 않습니다.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            검증 매장 수
            <input
              type="number"
              min={1}
              value={sampleSize}
              disabled={runAll || status === "running" || specificQuery.trim() !== ""}
              onChange={(e) => setSampleSize(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={runAll}
              disabled={status === "running" || specificQuery.trim() !== ""}
              onChange={(e) => setRunAll(e.target.checked)}
            />
            전체 실행
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            특정 매장만 재검증(코드/이름, 선택)
            <input
              type="text"
              value={specificQuery}
              disabled={status === "running"}
              onChange={(e) => setSpecificQuery(e.target.value)}
              placeholder="예: 시흥배곧점"
              className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <button
            type="button"
            onClick={handleRun}
            disabled={status === "running"}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {status === "running" ? "검증 중..." : "검증 시작"}
          </button>
        </div>
        {progress && status === "running" && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {progress.done}/{progress.total} 처리 중{progress.current ? ` (${progress.current})` : ""}... 매장당 30~45초 정도 걸립니다.
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
        )}
      </section>

      {outcomes.length > 0 && (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">정확도 요약</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div
                className={`rounded-lg px-4 py-3 ${
                  summary.withinOneRatio >= TARGET_RATIO ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-amber-50 dark:bg-amber-950/30"
                }`}
              >
                <p className="text-xs text-zinc-500 dark:text-zinc-400">전체 ±1점 이내 적중률 (목표 {TARGET_RATIO * 100}%)</p>
                <p
                  className={`text-lg font-semibold ${
                    summary.withinOneRatio >= TARGET_RATIO ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {(summary.withinOneRatio * 100).toFixed(1)}% ({summary.withinOneCount}/{summary.totalPairs})
                </p>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                성공 {summary.storeCount}곳 · 실패/스킵 {skippedResults.length}곳
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {SCORE_FIELD_KEYS.map((key) => {
                const f = summary.perField[key];
                return (
                  <div key={key} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{SCORE_FIELD_LABELS[key]}</p>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {(f.ratio * 100).toFixed(0)}% ({f.withinOne}/{f.total})
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {okResults.length > 0 && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">매장별 비교 (AI/실제)</h2>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-900">
                    <tr className="text-left text-zinc-500 dark:text-zinc-400">
                      <th className="px-2 py-1.5">매장명</th>
                      <th className="px-2 py-1.5">주소</th>
                      {SCORE_FIELD_KEYS.map((key) => (
                        <th key={key} className="px-2 py-1.5">
                          {SCORE_FIELD_LABELS[key]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {okResults.map((o) => (
                      <tr key={o.result.storeCode} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">{o.result.storeName}</td>
                        <td className="px-2 py-1.5 text-zinc-400">{o.result.address}</td>
                        {o.result.rows.map((row) => (
                          <td
                            key={row.field}
                            className={`px-2 py-1.5 font-medium ${row.withinOne ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {row.ai ?? "-"}/{row.ground}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {skippedResults.length > 0 && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">실패/스킵된 매장</h2>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                {skippedResults.map((o, i) => (
                  <li key={`${o.storeCode}_${i}`}>
                    {o.storeName} — {o.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
