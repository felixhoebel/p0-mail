import { Routes, Route, Link, useLocation } from "react-router-dom";
import { Mail, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import InboxPage from "@/pages/InboxPage";
import SettingsPage from "@/pages/SettingsPage";

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
}) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-center rounded-md p-2.5 ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      <Icon className="h-5 w-5" strokeWidth={1.75} />
    </Link>
  );
}

function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="w-14 shrink-0 border-r border-border bg-card flex flex-col items-center">
        <div className="h-12 flex items-center justify-center border-b border-border w-full">
          <span className="text-sm font-bold tracking-tight">p0</span>
        </div>
        <nav className="flex-1 flex flex-col items-center gap-1 p-2 w-full">
          <NavItem to="/" label="Inbox" icon={Mail} />
          <NavItem to="/settings" label="Settings" icon={Settings} />
        </nav>
      </aside>
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
