import { Routes, Route, Link, useLocation } from "react-router-dom";
import InboxPage from "@/pages/InboxPage";
import SettingsPage from "@/pages/SettingsPage";

function NavItem({ to, label }: { to: string; label: string }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold tracking-tight">p0mail</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <NavItem to="/" label="Inbox" />
          <NavItem to="/settings" label="Settings" />
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
