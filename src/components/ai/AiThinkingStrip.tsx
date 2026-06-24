import { useState } from "react";
import { Brain, ChevronDown, Loader2 } from "lucide-react";

type AiThinkingStripProps = {
  thinkingLabel: string;
  thinking: string;
  loading?: boolean;
};

export default function AiThinkingStrip({
  thinkingLabel,
  thinking,
  loading,
}: AiThinkingStripProps) {
  const [expanded, setExpanded] = useState(true);

  if (!thinking && !loading) return null;

  return (
    <div className="mx-4 mt-2 rounded-lg border border-border/80 bg-muted/25 overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex-1">
          {thinkingLabel}
        </span>
        {loading && !thinking && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
            expanded ? "rotate-0" : "-rotate-90"
          }`}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 max-h-28 overflow-y-auto border-t border-border/50">
          <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {thinking || "…"}
            {loading && (
              <span className="inline-block w-0.5 h-3 bg-muted-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </p>
        </div>
      )}
    </div>
  );
}
