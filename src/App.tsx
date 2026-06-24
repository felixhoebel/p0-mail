import { useState, useEffect, Suspense, lazy } from "react";
import { Link, useLocation } from "react-router-dom";
import { Mail, Settings, Moon, Sun, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import InboxPage from "@/pages/InboxPage";
import { listAccounts } from "@/lib/api";

const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const OnboardingFlow = lazy(() => import("@/components/onboarding/OnboardingFlow"));

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <button
      onClick={toggle}
      title={dark ? "Light mode" : "Dark mode"}
      className="flex items-center justify-center rounded-lg p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {dark ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}
    </button>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-center rounded-lg p-2.5 transition-colors ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </Link>
  );
}

function App() {
  const { pathname } = useLocation();
  const onInbox = pathname === "/";
  const [onboarding, setOnboarding] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const onboarded = localStorage.getItem("p0mail:onboarded") === "true";
    if (!onboarded) {
      listAccounts()
        .then((accounts) => {
          if (accounts.length === 0) {
            setOnboarding(true);
          } else {
            localStorage.setItem("p0mail:onboarded", "true");
          }
        })
        .catch(() => setOnboarding(true))
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  if (checking) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (onboarding) {
    return (
      <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-background"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
        <OnboardingFlow onComplete={() => setOnboarding(false)} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="w-12 shrink-0 border-r border-border bg-sidebar flex flex-col items-center">
        <div className="h-11 flex items-center justify-center border-b border-border w-full">
          <span className="text-[13px] font-bold tracking-tighter">p0</span>
        </div>
        <nav className="flex-1 flex flex-col items-center gap-1 p-2 w-full">
          <NavItem to="/" label="Inbox" icon={Mail} active={onInbox} />
          <NavItem to="/settings" label="Settings" icon={Settings} active={!onInbox} />
        </nav>
        <div className="p-2 w-full flex justify-center border-t border-border">
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        <div className={onInbox ? "h-full" : "hidden"}>
          <InboxPage />
        </div>
        {!onInbox && (
          <div className="h-full">
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <SettingsPage />
            </Suspense>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
