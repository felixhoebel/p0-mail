import { useState } from "react";
import {
  Sparkles,
  X,
  Loader2,
  RefreshCw,
  ChevronDown,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiPanelLabels } from "@/lib/aiUi";

type AiSummaryPanelProps = {
  labels: AiPanelLabels;
  summary: string | null;
  thinking: string;
  loading: boolean;
  error: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
};

export default function AiSummaryPanel({
  labels,
  summary,
  thinking,
  loading,
  error,
  onDismiss,
  onRetry,
}: AiSummaryPanelProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(true);

  if (summary === null && !loading && !error && !thinking) return null;

  const hasSummary = (summary?.length ?? 0) > 0;
  const hasThinking = thinking.length > 0;
  const showThinking = hasThinking || (loading && !hasSummary);

  return (
    <aside className="flex h-full w-[min(100%,22rem)] shrink-0 flex-col border-l border-border bg-card/50">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground leading-tight">
              {labels.title}
            </p>
            {loading && (
              <p className="text-[10px] text-muted-foreground truncate">
                {hasThinking && !hasSummary
                  ? labels.thinkingStatus
                  : labels.writingStatus}
              </p>
            )}
          </div>
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400 shrink-0" />
          )}
        </div>
        {!loading && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close summary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-3 space-y-3">
          {error && !loading && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="text-xs text-destructive leading-relaxed">{error}</p>
              {onRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 text-xs w-full"
                  onClick={onRetry}
                >
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  Try again
                </Button>
              )}
            </div>
          )}

          {!error && showThinking && (
            <div className="rounded-lg border border-border/80 bg-muted/30 overflow-hidden">
              <button
                type="button"
                onClick={() => setThinkingExpanded((v) => !v)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/50 transition-colors"
              >
                <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex-1">
                  {labels.thinking}
                </span>
                {loading && !hasSummary && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                    thinkingExpanded ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </button>
              {thinkingExpanded && (
                <div className="px-2.5 pb-2.5 max-h-36 overflow-y-auto border-t border-border/50">
                  <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
                    {hasThinking ? thinking : "…"}
                    {loading && !hasSummary && (
                      <span className="inline-block w-0.5 h-3 bg-muted-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {!error && (hasSummary || (loading && hasThinking)) && (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] px-3 py-2.5">
              <p className="text-[11px] font-medium text-violet-400/90 uppercase tracking-wider mb-2">
                {labels.summary}
              </p>
              <div
                className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90"
                aria-live="polite"
                aria-busy={loading && hasSummary}
              >
                {hasSummary ? summary : null}
                {loading && hasSummary && (
                  <span className="inline-block w-0.5 h-4 bg-violet-400/80 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            </div>
          )}

          {!error && loading && !hasSummary && !hasThinking && (
            <div className="space-y-1.5" aria-live="polite" aria-busy="true">
              <p className="text-xs text-muted-foreground">{labels.analyzing}</p>
              <div className="h-2.5 rounded bg-muted/80 animate-pulse w-full" />
              <div className="h-2.5 rounded bg-muted/80 animate-pulse w-[90%]" />
              <div className="h-2.5 rounded bg-muted/80 animate-pulse w-[75%]" />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
