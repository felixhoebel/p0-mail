import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, CornerDownLeft, Mail, Inbox, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Account, Thread } from "@/types";
import { searchEmails } from "@/lib/api";
import { fuzzyMatch, highlightSegments } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  run: () => void;
  disabled?: boolean;
}

type ItemKind = "action" | "account" | "thread";

interface BaseItem {
  key: string;
  kind: ItemKind;
  score: number;
  matches: number[];
  disabled?: boolean;
}

interface ActionItem extends BaseItem {
  kind: "action";
  action: PaletteAction;
  label: string;
}

interface AccountItem extends BaseItem {
  kind: "account";
  account: Account;
  label: string;
}

interface ThreadItem extends BaseItem {
  kind: "thread";
  thread: Thread;
  label: string;
  accountLabel: string;
}

type Item = ActionItem | AccountItem | ThreadItem;

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  recentThreads: Thread[];
  actions: PaletteAction[];
  onSelectThread: (thread: Thread) => void;
  onSelectAccount: (account: Account) => void;
}

const RECENT_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 150;

export function CommandPalette({
  open,
  onClose,
  accounts,
  recentThreads,
  actions,
  onSelectThread,
  onSelectAccount,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remoteThreads, setRemoteThreads] = useState<Thread[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setRemoteThreads([]);
      setSearching(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const trimmed = query.trim();

  useEffect(() => {
    if (!open || !trimmed) return;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchEmails(trimmed)
        .then((results) => {
          if (cancelled) return;
          setRemoteThreads(results);
        })
        .catch(() => {
          if (!cancelled) setRemoteThreads([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, trimmed]);

  const accountMap = useMemo(() => {
    const m = new Map<number, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const accountLabel = useCallback(
    (id: number) => {
      const a = accountMap.get(id);
      return a ? a.display_name || a.email_address : "Unknown";
    },
    [accountMap],
  );

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];

    for (const action of actions) {
      const res = fuzzyMatch(trimmed, action.label);
      if (!res) continue;
      out.push({
        key: `action:${action.id}`,
        kind: "action",
        action,
        label: action.label,
        score: res.score + 1000,
        matches: res.matches,
        disabled: action.disabled,
      });
    }

    for (const account of accounts) {
      const label = account.display_name || account.email_address;
      const res = fuzzyMatch(trimmed, `${label} ${account.email_address}`);
      if (!res) continue;
      out.push({
        key: `account:${account.id}`,
        kind: "account",
        account,
        label,
        score: res.score + 500,
        matches: highlightIndexFor(label, res.matches),
      });
    }

    const threadSource = trimmed ? remoteThreads : recentThreads.slice(0, RECENT_LIMIT);
    for (const thread of threadSource) {
      const subject = thread.subject || "(no subject)";
      out.push({
        key: `thread:${thread.id}`,
        kind: "thread",
        thread,
        label: subject,
        accountLabel: accountLabel(thread.account_id),
        score: trimmed ? 250 - thread.latest_date / 1e12 : -thread.latest_date / 1e12,
        matches: substringIndices(trimmed, subject),
      });
    }

    out.sort((a, b) => b.score - a.score);
    return out;
  }, [trimmed, actions, accounts, remoteThreads, recentThreads, accountLabel]);

  useEffect(() => {
    setActive(0);
  }, [items.length, query]);

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const choose = (item: Item | undefined) => {
    if (!item || item.disabled) return;
    if (item.kind === "action") item.action.run();
    else if (item.kind === "account") onSelectAccount(item.account);
    else onSelectThread(item.thread);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(items.length - 1);
    }
  };

  let lastKind: ItemKind | null = null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mt-[12vh] w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground/70" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search threads, accounts, or actions…"
            className="h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
          />
          {searching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
          )}
          <kbd className="hidden shrink-0 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {searching ? "Searching…" : trimmed ? "No results" : "Nothing here yet"}
            </div>
          )}
          {items.map((item, i) => {
            const showHeader = item.kind !== lastKind;
            lastKind = item.kind;
            const header = item.kind === "action" ? "Actions" : item.kind === "account" ? "Accounts" : "Threads";
            return (
              <div key={item.key}>
                {showHeader && (
                  <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {header}
                  </div>
                )}
                <button
                  ref={i === active ? activeRef : undefined}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => choose(item)}
                  disabled={item.disabled}
                  className={cn(
                    "flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors disabled:opacity-40",
                    i === active ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                    {renderIcon(item)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {renderLabel(item)}
                    </span>
                    {item.kind === "thread" && (
                      <span className="truncate text-[11px] text-muted-foreground/70">
                        {item.accountLabel}
                        {item.thread.message_count > 1
                          ? ` · ${item.thread.message_count} msgs`
                          : ""}
                      </span>
                    )}
                    {item.kind === "action" && item.action.hint && (
                      <span className="truncate text-[11px] text-muted-foreground/70">
                        {item.action.hint}
                      </span>
                    )}
                    {item.kind === "account" && (
                      <span className="truncate text-[11px] text-muted-foreground/70">
                        {item.account.email_address}
                      </span>
                    )}
                  </span>
                  {i === active && !item.disabled && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );

  function renderIcon(item: Item) {
    if (item.kind === "action") {
      const Icon = item.action.icon || CornerDownLeft;
      return <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />;
    }
    if (item.kind === "account") {
      return <Inbox className="h-3.5 w-3.5" strokeWidth={1.75} />;
    }
    return <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />;
  }

  function renderLabel(item: Item) {
    const segs = highlightSegments(item.label, item.matches);
    return segs.map((s, i) =>
      s.match ? (
        <span key={i} className="font-semibold text-foreground">
          {s.text}
        </span>
      ) : (
        <span key={i}>{s.text}</span>
      ),
    );
  }
}

function highlightIndexFor(label: string, allMatches: number[]): number[] {
  const matches: number[] = [];
  for (const idx of allMatches) {
    if (idx < label.length) matches.push(idx);
  }
  return matches;
}

function substringIndices(query: string, text: string): number[] {
  if (!query) return [];
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return [];
  return Array.from({ length: query.length }, (_, i) => idx + i);
}
