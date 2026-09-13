/** Apply only this editor's changes; preserve independent changes made since it opened. */
export function mergeInputChanges<T extends object>(latest: T, baseline: T, edited: T): T {
  const next = { ...latest };
  for (const key of Object.keys(edited) as (keyof T)[]) {
    if (["code", "createdAt", "updatedAt", "updatedBy"].includes(String(key))) continue;
    const same = (a: unknown, b: unknown) => Object.is(a ?? null, b ?? null);
    if (same(edited[key], baseline[key])) continue;
    if (!same(latest[key], baseline[key]) && !same(latest[key], edited[key])) {
      throw new Error("다른 화면에서 같은 항목이 수정되었습니다. 입력 내용을 복사해 보관한 뒤 새로고침해주세요.");
    }
    next[key] = edited[key];
  }
  return next;
}
