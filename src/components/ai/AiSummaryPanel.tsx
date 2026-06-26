import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  X,
  Loader2,
  RefreshCw,
  ChevronDown,
  Brain,
  Forward,
  Send,
  Reply,
  Copy,
  Check,
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
  onForwardSummary?: () => void;
  onSendAsNew?: () => void;
  onReplyWithSummary?: () => void;
  onCopySummary?: () => void;
};

export default function AiSummaryPanel({
  labels,
  summary,
  thinking,
  loading,
  error,
  onDismiss,
  onRetry,
  onForwardSummary,
  onSendAsNew,
  onReplyWithSummary,
  onCopySummary,
}: AiSummaryPanelProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopy = () => {
    onCopySummary?.();
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  if (summary === null && !loading && !error && !thinking) return null;

  const hasSummary = (summary?.length ?? 0) > 0;
  const hasThinking = thinking.length > 0;
  const showThinking = hasThinking || (loading && !hasSummary);

  return (
    <aside className="flex h-full w-[min(100%,22rem)] shrink-0 flex-col border-l border-border bg-sidebar animate-fade-in">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai/10 text-ai">
            <Sparkles className="h-3.5 w-3.5" />
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
            <Loader2 className="h-3.5 w-3.5 animate-spin text-ai shrink-0" />
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

      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
        <div className="p-4 space-y-3">
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
            <div className="rounded-lg border border-ai/15 bg-ai/[0.03] px-3.5 py-3">
              <p className="text-[10px] font-medium text-ai/80 uppercase tracking-wider mb-2">
                {labels.summary}
              </p>
              <div
                className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90"
                aria-live="polite"
                aria-busy={loading && hasSummary}
              >
                {hasSummary ? summary : null}
                {loading && hasSummary && (
                  <span className="inline-block w-0.5 h-4 bg-ai/80 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            </div>
          )}

          {!error && hasSummary && !loading && (
            <div className="flex flex-wrap gap-1.5">
              {onForwardSummary && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 px-2"
                  onClick={onForwardSummary}
                  title={labels.forwardSummary}
                >
                  <Forward className="h-3 w-3" />
                  {labels.forwardSummary}
                </Button>
              )}
              {onSendAsNew && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 px-2"
                  onClick={onSendAsNew}
                  title={labels.sendAsNew}
                >
                  <Send className="h-3 w-3" />
                  {labels.sendAsNew}
                </Button>
              )}
              {onReplyWithSummary && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 px-2"
                  onClick={onReplyWithSummary}
                  title={labels.replyWithSummary}
                >
                  <Reply className="h-3 w-3" />
                  {labels.replyWithSummary}
                </Button>
              )}
              {onCopySummary && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 px-2"
                  onClick={handleCopy}
                  title={labels.copy}
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-ai" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied ? labels.copied : labels.copy}
                </Button>
              )}
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
