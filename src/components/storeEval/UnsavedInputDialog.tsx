"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export function UnsavedInputDialog({ busy, onStay, onLeave }: {
  busy: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    stayButton.current?.focus();
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onStay(); }}
      className="app-card fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl p-6 text-[var(--sl-ink)] shadow-xl backdrop:bg-black/50">
      <h2 id={titleId} className="text-lg font-semibold">{busy ? "처리가 진행 중입니다" : "저장하지 않은 변경이 있습니다"}</h2>
      <p id={descriptionId} className="mt-3 text-sm leading-6 text-[var(--sl-ink-soft)]">
        {busy ? "완료될 때까지 잠시 기다려주세요. 입력 내용은 현재 화면에 유지됩니다." : "이동하면 방금 수정한 내용이 사라집니다. 계속 입력하거나, 변경 내용을 버리고 이동할 수 있습니다."}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button ref={stayButton} type="button" onClick={onStay} className="app-btn-outline rounded-lg px-4 py-2 text-sm">계속 입력하기</button>
        {!busy && <button type="button" onClick={onLeave} className="app-btn-primary rounded-lg px-4 py-2 text-sm">변경 버리고 이동</button>}
      </div>
    </dialog>, document.querySelector(".app-theme") ?? document.body,
  );
}
