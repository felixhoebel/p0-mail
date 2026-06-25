import { useRef, useCallback, useEffect, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import type { Thread } from "@/types";

export type ThreadRow =
  | { type: "header"; label: string }
  | { type: "thread"; thread: Thread };

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateGroup(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);
  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  if (d >= weekAgo) return "This Week";
  if (d >= monthAgo) return "This Month";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function buildThreadRows(threads: Thread[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let currentGroup = "";
  for (const thread of threads) {
    const group = dateGroup(thread.latest_date);
    if (group !== currentGroup) {
      rows.push({ type: "header", label: group });
      currentGroup = group;
    }
    rows.push({ type: "thread", thread });
  }
  return rows;
}

interface RowProps {
  rows: ThreadRow[];
  selectedThreadId: number | null;
  busyThreadIds: Set<number>;
  onSelectThread: (thread: Thread) => void;
  onContextMenu: (e: React.MouseEvent, thread: Thread) => void;
}

function ThreadRowItem({
  index,
  style,
  rows,
  selectedThreadId,
  busyThreadIds,
  onSelectThread,
  onContextMenu,
}: RowComponentProps<RowProps>) {
  const row = rows[index];
  if (row.type === "header") {
    return (
      <div
        style={style}
        className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center"
      >
        {row.label}
      </div>
    );
  }
  const { thread } = row;
  const selected = selectedThreadId === thread.id;
  const threadBusy = busyThreadIds.has(thread.id);
  return (
    <div
      style={style}
      onClick={() => !threadBusy && onSelectThread(thread)}
      onContextMenu={(e) => onContextMenu(e, thread)}
      className={`relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors group ${
        threadBusy ? "opacity-50 pointer-events-none" : ""
      } ${selected ? "bg-accent" : "hover:bg-accent/50"}`}
    >
      {selected && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-foreground" />}
      {threadBusy && (
        <div className="absolute right-2 top-2.5">
          <span className="block h-3.5 w-3.5 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {!thread.is_read && <span className="h-1.5 w-1.5 rounded-full bg-ai shrink-0" />}
          {thread.is_flagged && <span className="text-amber-500 text-[11px]">&#9733;</span>}
          <p className={`text-sm truncate flex-1 ${!thread.is_read ? "font-semibold" : "text-muted-foreground"}`}>
            {thread.subject || "(no subject)"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-[11px] text-muted-foreground/80">
            {thread.message_count} {thread.message_count === 1 ? "msg" : "msgs"}
          </p>
          <span className="text-[11px] text-muted-foreground/40">·</span>
          <p className="text-[11px] text-muted-foreground/80">{formatDate(thread.latest_date)}</p>
        </div>
      </div>
    </div>
  );
}

interface VirtualizedThreadListProps {
  threads: Thread[];
  selectedThreadId: number | null;
  busyThreadIds: Set<number>;
  onSelectThread: (thread: Thread) => void;
  onContextMenu: (e: React.MouseEvent, thread: Thread) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export default function VirtualizedThreadList({
  threads,
  selectedThreadId,
  busyThreadIds,
  onSelectThread,
  onContextMenu,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
}: VirtualizedThreadListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = buildThreadRows(threads);
  const rowCount = rows.length + (hasMore ? 1 : 0);

  const rowHeight = useCallback(
    (index: number) => {
      if (index >= rows.length) return 40;
      return rows[index].type === "header" ? 28 : 56;
    },
    [rows],
  );

  const handleRowsRendered = useCallback(
    ({ stopIndex }: { startIndex: number; stopIndex: number }) => {
      if (hasMore && onLoadMore && stopIndex >= rows.length - 5) {
        onLoadMore();
      }
    },
    [hasMore, onLoadMore, rows.length],
  );

  const rowProps: RowProps = {
    rows,
    selectedThreadId,
    busyThreadIds,
    onSelectThread,
    onContextMenu,
  };

  return (
    <div ref={containerRef} className="flex-1 min-h-0">
      <List
        rowCount={rowCount}
        rowHeight={rowHeight}
        rowComponent={ThreadRowItem}
        rowProps={rowProps}
        overscanCount={5}
        onRowsRendered={handleRowsRendered}
        style={{ height, width: "100%" }}
        className="scrollbar-thin"
      />
      {loadingMore && (
        <div className="flex items-center justify-center py-2">
          <span className="block h-3.5 w-3.5 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
        </div>
      )}
    </div>
  );
}
