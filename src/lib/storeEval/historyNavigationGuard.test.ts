import { describe, expect, it, vi } from "vitest";
import { installHistoryNavigationGuard } from "./historyNavigationGuard";

function navigate(overrides: Record<string, unknown> = {}, cancelable = true) {
  return Object.assign(new Event("navigate", { cancelable }), {
    navigationType: "traverse",
    destination: { url: "https://example.com/store-eval/candidates", key: "list-entry", sameDocument: true },
    ...overrides,
  });
}

describe("편집 중 뒤로·앞으로 이동 보호", () => {
  const currentUrl = () => "https://example.com/store-eval/candidates/N001";
  function mockNavigation() {
    const target = new EventTarget();
    const traverseTo = vi.fn(() => ({ finished: Promise.resolve() }));
    return Object.assign(target, { traverseTo });
  }
  it("이동을 취소하면 브라우저 이동을 중단하며 확인하면 이동한다", () => {
    const navigation = mockNavigation();
    const requestLeave = vi.fn();
    installHistoryNavigationGuard(navigation, currentUrl, requestLeave, vi.fn());
    const cancelled = navigate();
    navigation.dispatchEvent(cancelled);
    expect(cancelled.defaultPrevented).toBe(true);
    expect(navigation.traverseTo).not.toHaveBeenCalled();
    requestLeave.mock.calls[0][0]();
    expect(navigation.traverseTo).toHaveBeenCalledWith("list-entry");
    const resumed = navigate();
    navigation.dispatchEvent(resumed);
    expect(resumed.defaultPrevented).toBe(false);
    expect(requestLeave).toHaveBeenCalledTimes(1);
  });
  it("앵커·일반 링크 이동·새로고침에는 이중 확인을 띄우지 않는다", () => {
    const navigation = mockNavigation();
    const canLeave = vi.fn(() => false);
    installHistoryNavigationGuard(navigation, currentUrl, canLeave, vi.fn());
    navigation.dispatchEvent(navigate({ destination: { url: currentUrl() + "#notes", sameDocument: true } }));
    for (const navigationType of ["push", "replace", "reload"]) navigation.dispatchEvent(navigate({ navigationType }));
    navigation.dispatchEvent(navigate({ destination: { url: "https://example.com/", sameDocument: false } }));
    expect(canLeave).not.toHaveBeenCalled();
  });
  it("브라우저가 취소를 허용하지 않을 때는 막거나 이력을 추가하지 않는다", () => {
    const navigation = mockNavigation();
    const canLeave = vi.fn(() => false);
    installHistoryNavigationGuard(navigation, currentUrl, canLeave, vi.fn());
    navigation.dispatchEvent(navigate({}, false));
    expect(canLeave).not.toHaveBeenCalled();
  });
  it("미지원 브라우저에서도 오류 없이 설치하며 정리 후에는 개입하지 않는다", () => {
    installHistoryNavigationGuard(undefined, currentUrl, () => {}, () => {})();
    const navigation = mockNavigation();
    const canLeave = vi.fn(() => false);
    const dispose = installHistoryNavigationGuard(navigation, currentUrl, canLeave, vi.fn());
    dispose();
    navigation.dispatchEvent(navigate());
    expect(canLeave).not.toHaveBeenCalled();
  });
  it("이동 재개가 실패하면 오류를 알리고 다음 이동도 다시 보호한다", async () => {
    const navigation = mockNavigation();
    navigation.traverseTo.mockImplementationOnce(() => ({ finished: Promise.reject(new Error("missing entry")) }));
    const requestLeave = vi.fn();
    const onError = vi.fn();
    installHistoryNavigationGuard(navigation, currentUrl, requestLeave, onError);
    navigation.dispatchEvent(navigate());
    requestLeave.mock.calls[0][0]();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    const retry = navigate();
    navigation.dispatchEvent(retry);
    expect(retry.defaultPrevented).toBe(true);
    expect(requestLeave).toHaveBeenCalledTimes(2);
  });
});
