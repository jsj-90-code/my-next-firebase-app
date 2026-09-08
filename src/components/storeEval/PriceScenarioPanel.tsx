"use client";

import { useState } from "react";
import { computeFixedUsagePriceScenario } from "@/lib/storeEval/priceScenario";
import { formatWon } from "@/lib/storeEval/format";

type Baseline = { id:string; label:string; revenue:number | null; hourlyRate:number | null; pcRevenue?:number; productRevenue?:number };

function ScenarioInputs({ baseline, productRatio }: {baseline:Baseline; productRatio:number}) {
  const [pcRevenue, setPcRevenue] = useState(String(baseline.pcRevenue ?? Math.round(baseline.revenue! * (1-productRatio))));
  const [productRevenue, setProductRevenue] = useState(String(baseline.productRevenue ?? baseline.revenue! - Math.round(baseline.revenue! * (1-productRatio))));
  const [currentRate, setCurrentRate] = useState(String(baseline.hourlyRate));
  const [nextRate, setNextRate] = useState(String(baseline.hourlyRate));
  const numeric = (s:string) => s.trim() === "" ? NaN : Number(s);
  const result = computeFixedUsagePriceScenario({pcRevenue:numeric(pcRevenue),productRevenue:numeric(productRevenue),
    currentHourlyRate:numeric(currentRate),nextHourlyRate:numeric(nextRate)});
  const fields = [
    {label:"기준 PC매출 (원)",value:pcRevenue,set:setPcRevenue,min:0},
    {label:"기준 먹거리 매출 (원)",value:productRevenue,set:setProductRevenue,min:0},
    {label:"기준 시간당요금 (원)",value:currentRate,set:setCurrentRate,min:1},
    {label:"변경 시간당요금 (원)",value:nextRate,set:setNextRate,min:0},
  ];
  return <div className="mt-3 space-y-3">
    <p className="text-xs leading-5 text-[#8a8072]">
      {baseline.pcRevenue != null ? "초기 매출은 분리 모형이 예측한 PC·먹거리 매출입니다." : `초기 매출은 현재 예측값을 설정상 먹거리 비중 ${Math.round(productRatio*100)}%로 나눈 가정입니다.`}
      실제 매출 구성을 알고 있다면 기준 PC매출·먹거리 매출과 해당 기간의 요금으로 바꿔 계산하세요.
    </p>
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(field => <label key={field.label} className="block text-sm">
        {field.label}
        <input type="number" min={field.min} step="any" value={field.value} onChange={event=>field.set(event.target.value)}
          className="app-input mt-1 w-full rounded-lg border p-2" />
      </label>)}
    </div>
    {result ? <div aria-live="polite" className="rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
      <p>변경 후 월매출: <strong>{formatWon(result.nextRevenue)}</strong></p>
      <p>PC {formatWon(result.nextPcRevenue)} + 먹거리 {formatWon(result.nextProductRevenue)}</p>
      <p>기준 대비 {result.revenueChange < 0 ? "감소" : result.revenueChange > 0 ? "증가" : "변동"}: {formatWon(Math.abs(result.revenueChange))}</p>
    </div> : <p role="status" className="text-sm">매출과 변경요금은 0 이상, 기준요금은 0보다 큰 숫자를 입력하세요. 계산 가능한 금액 범위를 넘는 경우 입력값을 줄여 주세요.</p>}
    <p className="text-xs leading-5 text-[#8a8072]">
      PC 이용시간과 먹거리 매출을 고정한 계산입니다. 할인에 따른 고객 증감은 추정하지 않습니다.
      기준 PC매출 × 변경요금 ÷ 기준요금 + 기준 먹거리 매출로 계산하며, 입력값은 저장되지 않습니다.
      표시 금액은 항목별로 원 단위 반올림한 뒤 합산합니다.
    </p>
  </div>;
}

export function PriceScenarioPanel({ baselines, productRatio }: {baselines:Baseline[]; productRatio:number}) {
  const [selectedId, setSelectedId] = useState("");
  const available = baselines.filter(b => b.revenue != null && Number.isFinite(b.revenue) && b.revenue >= 0
    && b.hourlyRate != null && Number.isFinite(b.hourlyRate) && b.hourlyRate > 0);
  const selected = available.find(b=>b.id===selectedId) ?? available[0];
  if (!selected || !Number.isFinite(productRatio) || productRatio < 0 || productRatio > 1) return null;
  return <details className="app-card mt-3 rounded-xl p-4">
    <summary className="cursor-pointer text-sm font-semibold">요금 변경 영향 계산 — 이용시간 고정</summary>
    <p className="mt-2 text-xs leading-5 text-[#8a8072]">같은 이용시간에서 요금만 바꿀 때의 PC매출과 총매출을 비교합니다.</p>
    {available.length > 1 && <label className="mt-3 block text-sm">비교할 점포
      <select value={selected.id} onChange={event=>setSelectedId(event.target.value)} className="app-input ml-2 rounded-lg border p-2">
        {available.map(b=><option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
    </label>}
    <ScenarioInputs key={`${selected.id}:${selected.revenue}:${selected.hourlyRate}:${selected.pcRevenue}:${selected.productRevenue}:${productRatio}`} baseline={selected} productRatio={productRatio} />
  </details>;
}
