import { Sparkles, Loader2, Reply } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiActionLabels } from "@/lib/aiUi";

type AiActionButtonsProps = {
  labels: AiActionLabels;
  onSummarize: () => void;
  onDraftReply: () => void;
  summarizeLoading: boolean;
  draftLoading: boolean;
  disabled?: boolean;
};

export default function AiActionButtons({
  labels,
  onSummarize,
  onDraftReply,
  summarizeLoading,
  draftLoading,
  disabled,
}: AiActionButtonsProps) {
  const busy = summarizeLoading || draftLoading;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={onSummarize}
        disabled={disabled || busy}
        className="h-8 gap-1.5 border-violet-500/25 hover:bg-violet-500/10 hover:border-violet-500/40"
        title={labels.summarizeTitle}
      >
        {summarizeLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
        )}
        {summarizeLoading ? labels.summarizing : labels.summarize}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onDraftReply}
        disabled={disabled || busy}
        className="h-8 gap-1.5 border-violet-500/25 hover:bg-violet-500/10 hover:border-violet-500/40"
        title={labels.replyTitle}
      >
        {draftLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Reply className="h-3.5 w-3.5 text-violet-400" />
        )}
        {draftLoading ? labels.drafting : labels.aiReply}
      </Button>
    </div>
  );
}
