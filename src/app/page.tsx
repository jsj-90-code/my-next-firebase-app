import { HomeAuthStatus } from "@/components/HomeAuthStatus";
import { HomeToolStatus } from "@/components/HomeToolStatus";
import { ThemeToggle } from "@/components/ThemeToggle";

const TOOLS = [
  {
    href: "/seat-layout",
    label: "PC방 좌석배치도 작업 툴",
    description: "매장 도면에 존을 그리고, AI로 좌석 수를 인식하고, 발주용 FHD 이미지를 만듭니다.",
    icon: <path d="M3 3h18v18H3z M3 9h18 M9 9v12 M12 12h6v6h-6z" />,
  },
  {
    href: "/store-eval",
    label: "점포평가 시스템 (V62)",
    description:
      "신규후보지·경쟁점·입지동선을 입력하면 V62 예상매출과 최종판정을 계산하고, 기존 가맹점 실매출로 모델을 검증합니다.",
    icon: <path d="M4 19V9l8-5 8 5v10 M4 19h16 M9 19v-6h6v6" />,
  },
] as const;

export default function Home() {
  return (
    <div
      className="app-theme relative flex flex-1 flex-col items-center justify-center px-6 py-16"
      style={{
        backgroundImage:
          "linear-gradient(var(--sl-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--sl-grid-line) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    >
      <ThemeToggle className="app-btn-outline absolute right-4 top-4 rounded-full px-3 py-1.5 text-xs sm:right-6 sm:top-6" />
      <main className="flex w-full max-w-2xl flex-col items-center gap-10 text-center">
        <div className="max-w-xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8a8072]">ISENS</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-[#171310] dark:text-[#f2ede2]">
            아이센스 <span className="text-[#c05a2c]">사내 도구</span>
          </h1>
          <p className="text-sm leading-6 text-[#8a8072]">회사 구글 계정으로 로그인한 뒤 아래 도구를 이용하세요.</p>
        </div>

        <HomeAuthStatus />

        <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <a
              key={tool.href}
              href={tool.href}
              className="app-card group flex flex-col overflow-hidden rounded-2xl text-left transition hover:border-[#c05a2c]/40"
            >
              <div className="flex flex-1 items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#c05a2c]/10 text-[#c05a2c]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className="h-6 w-6">
                    {tool.icon}
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center justify-between text-base font-semibold text-[#171310] dark:text-[#f2ede2]">
                    {tool.label}
                    <span className="text-[#c9bfae] transition group-hover:translate-x-0.5 group-hover:text-[#c05a2c]">
                      →
                    </span>
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#8a8072]">{tool.description}</p>
                </div>
              </div>
              <HomeToolStatus tool={tool.href === "/seat-layout" ? "seat-layout" : "store-eval"} />
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
