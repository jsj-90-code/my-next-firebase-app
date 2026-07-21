"use client";

import { FormEvent, useState } from "react";
import type { ChatMessage } from "@/lib/claude";

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || pending) {
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];

    setInput("");
    setError(null);
    setPending(true);
    setMessages(nextMessages);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = (await response.json()) as {
        reply?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Claude 응답을 받지 못했습니다.");
      }

      setMessages([
        ...nextMessages,
        { role: "assistant", content: data.reply ?? "" },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청에 실패했습니다.");
      setMessages(messages);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-6 py-4 text-left dark:border-zinc-800">
        <p className="text-sm uppercase tracking-wide text-zinc-500">Claude</p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          AI 채팅
        </h2>
      </div>

      <div className="flex max-h-[420px] min-h-[280px] flex-col gap-4 overflow-y-auto px-6 py-5 text-left">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
            무엇이든 물어보세요. Claude가 답변합니다.
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                message.role === "user"
                  ? "ml-8 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "mr-8 bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
              }`}
            >
              <p className="mb-1 text-xs font-medium uppercase tracking-wide opacity-70">
                {message.role === "user" ? "나" : "Claude"}
              </p>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          ))
        )}

        {pending ? (
          <p className="text-sm text-zinc-500">Claude가 답변 중...</p>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-200 px-6 py-4 dark:border-zinc-800"
      >
        {error ? (
          <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex gap-3">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="메시지를 입력하세요"
            disabled={pending}
            className="flex-1 rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none focus:border-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="rounded-full bg-zinc-900 px-5 py-3 font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            전송
          </button>
        </div>
      </form>
    </div>
  );
}
