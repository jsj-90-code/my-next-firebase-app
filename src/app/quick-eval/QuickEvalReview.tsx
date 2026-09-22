"use client";

// AI 평가문을 **읽을 수 있게** 그린다. (2026-09-23 신설)
//
// ── 왜 만들었나 ───────────────────────────────────────────────────────────
// 사용자: *"가시성이 좀 떨어지니까 가시성좀 개선해주고. 헤더를 굵은글씨로 하는등의"*
//
// 그전엔 `<pre className="whitespace-pre-wrap">`로 통째로 뿌렸다. 프롬프트가 마크다운을
// 요구하는데(`## 제목`, `**굵게**`) 렌더링을 안 하니 **`##`와 `**`가 글자 그대로 보였다.**
// 제목과 본문이 구분이 안 돼서 한 덩이 벽처럼 읽혔다.
//
// ⚠️ 마크다운 라이브러리를 새로 넣지 않았다. 이 평가문이 실제로 쓰는 문법은 넷뿐이고
//    (`## 제목` · `**굵게**` · `- 목록` · `1. 목록`), 그것만 다루면 충분하다. 의존성 하나를
//    더 지고 갈 이유가 없다.
// ⚠️ `dangerouslySetInnerHTML`을 쓰지 않는다 — AI가 만든 글이라 HTML을 그대로 넣으면 안 된다.
//    전부 React 요소로 만든다.
// ⚠️ 문법을 못 알아본 줄은 **버리지 않고** 그냥 문단으로 그린다. AI가 형식을 벗어나도
//    내용이 사라지면 안 된다.

import type { ReactNode } from "react";

/** `**굵게**`만 처리한다. 나머지는 글자 그대로 둔다. */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[#171310] dark:text-[#f2ede2]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[]; ordered: boolean }
  | { kind: "para"; text: string };

/** 평가문을 블록으로 자른다. 제목은 `##`(또는 `#`/`###`), 목록은 `-`/`*`/`1.`. */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { items: string[]; ordered: boolean } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "para", text: para.join(" ").trim() });
      para = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push({ kind: "list", items: list.items, ordered: list.ordered });
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (heading) {
      flushAll();
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const item = (bullet ? bullet[1] : numbered![1]).trim();
      const ordered = !bullet;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { items: [], ordered };
      }
      list.items.push(item);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return blocks;
}

/**
 * ⭐ **맨 앞 섹션은 눈에 띄게 그린다.**
 *
 * 사용자 지시(2026-09-23)로 프롬프트의 형식 순서를 바꿔 **예상매출을 맨 위**로 올렸다
 * (`QUICK_EVAL_REVIEW_SYSTEM_PROMPT`). 그게 담당자가 제일 먼저 보는 것이므로, 첫 제목
 * 블록만 카드로 감싸 강조한다.
 * ⚠️ "첫 번째 제목"을 기준으로 잡는다 — 제목 **이름**으로 찾지 않는다. 프롬프트의 문구가
 *    바뀌어도 안 깨지게 하려는 것이다.
 */
export function QuickEvalReview({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  const firstHeadingIndex = blocks.findIndex((b) => b.kind === "heading");
  const secondHeadingIndex = blocks.findIndex(
    (b, i) => b.kind === "heading" && firstHeadingIndex >= 0 && i > firstHeadingIndex,
  );

  const renderBlock = (block: Block, i: number, lead: boolean) => {
    if (block.kind === "heading") {
      return (
        <h3
          key={i}
          className={
            lead
              ? "text-base font-bold text-[#171310] dark:text-[#f2ede2]"
              : "mt-5 border-t border-[var(--sl-line)] pt-4 text-sm font-bold text-[#171310] dark:text-[#f2ede2]"
          }
        >
          {block.text}
        </h3>
      );
    }
    if (block.kind === "list") {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={i}
          className={`mt-2 space-y-1 pl-5 text-sm leading-relaxed ${block.ordered ? "list-decimal" : "list-disc"}`}
        >
          {block.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </Tag>
      );
    }
    return (
      <p key={i} className={`${lead ? "mt-2 text-sm" : "mt-2 text-sm"} leading-relaxed`}>
        {renderInline(block.text)}
      </p>
    );
  };

  // 첫 제목부터 두 번째 제목 직전까지가 "머리 섹션"이다.
  const leadEnd = secondHeadingIndex >= 0 ? secondHeadingIndex : blocks.length;
  const lead = firstHeadingIndex >= 0 ? blocks.slice(firstHeadingIndex, leadEnd) : [];
  const beforeLead = firstHeadingIndex > 0 ? blocks.slice(0, firstHeadingIndex) : [];
  const rest = blocks.slice(leadEnd);

  return (
    <div className="mt-3 text-[var(--sl-ink)]">
      {beforeLead.map((b, i) => renderBlock(b, i, false))}
      {lead.length ? (
        <div className="app-card-sm relative overflow-hidden rounded-xl p-4">
          <span className="app-stripe-info absolute inset-y-0 left-0 w-[3px]" />
          {lead.map((b, i) => renderBlock(b, 1000 + i, true))}
        </div>
      ) : null}
      {rest.map((b, i) => renderBlock(b, 2000 + i, false))}
    </div>
  );
}
