import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useState, useEffect, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiTone } from "@/types";
import type { ComposePolishLabels } from "@/lib/aiUi";
import { plainTextToHtml } from "@/lib/plainTextToHtml";
import {
  streamPolishCompose,
  onAiStream,
  onAiStreamError,
} from "@/lib/api";
import AiThinkingStrip from "@/components/ai/AiThinkingStrip";
import { getAiThinkingLabels } from "@/lib/aiUi";
import type { AiOutputLanguage } from "@/types";

interface ComposeEditorProps {
  accountId: number;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  initialBodyHtml?: string;
  inReplyTo?: string;
  references?: string[];
  aiEnabled?: boolean;
  aiTone?: AiTone;
  outputLanguage?: AiOutputLanguage;
  polishLabels?: ComposePolishLabels;
  onSend: (params: {
    accountId: number;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    inReplyTo?: string;
    references?: string[];
  }) => void;
  onCancel: () => void;
  sending?: boolean;
}

export default function ComposeEditor({
  accountId,
  to: initialTo,
  cc: initialCc,
  bcc: initialBcc,
  subject: initialSubject,
  initialBodyHtml,
  inReplyTo,
  references,
  aiEnabled,
  aiTone = "Professional",
  outputLanguage = "en",
  polishLabels,
  onSend,
  onCancel,
  sending,
}: ComposeEditorProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState(initialBcc);
  const [subject, setSubject] = useState(initialSubject);
  const [showCc, setShowCc] = useState(!!initialCc || !!initialBcc);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [polishThinking, setPolishThinking] = useState("");
  const [polishHasContent, setPolishHasContent] = useState(false);

  const polishStreamIdRef = useRef<string | null>(null);
  const polishAccumRef = useRef({ thinking: "", content: "" });
  const thinkingLabels = getAiThinkingLabels(outputLanguage);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialBodyHtml || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[200px] focus:outline-none px-3 py-2",
      },
    },
  });

  useEffect(() => {
    if (editor && initialBodyHtml && editor.getText().trim() === "") {
      editor.commands.setContent(initialBodyHtml);
    }
  }, [editor, initialBodyHtml]);

  useEffect(() => {
    if (!aiEnabled) return;

    let cancelled = false;
    let unlistenStream: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    (async () => {
      [unlistenStream, unlistenError] = await Promise.all([
        onAiStream((event) => {
          if (event.streamId !== polishStreamIdRef.current) return;
          if (event.done) {
            setPolishing(false);
            polishStreamIdRef.current = null;
            return;
          }
          if (event.tokenKind === "thinking") {
            polishAccumRef.current.thinking += event.token;
            setPolishThinking(polishAccumRef.current.thinking);
          } else if (editor) {
            polishAccumRef.current.content += event.token;
            setPolishHasContent(true);
            editor.commands.setContent(
              plainTextToHtml(polishAccumRef.current.content),
              { emitUpdate: false },
            );
          }
        }),
        onAiStreamError((event) => {
          if (event.streamId !== polishStreamIdRef.current) return;
          setPolishError(event.token);
          setPolishing(false);
          polishStreamIdRef.current = null;
        }),
      ]);
      if (cancelled) {
        unlistenStream?.();
        unlistenError?.();
      }
    })();

    return () => {
      cancelled = true;
      unlistenStream?.();
      unlistenError?.();
    };
  }, [aiEnabled, editor]);

  const handlePolish = useCallback(async () => {
    if (!editor || !polishLabels) return;
    const draft = editor.getText().trim();
    if (draft.length < 3) {
      setPolishError(polishLabels.minDraftError);
      return;
    }

    setPolishing(true);
    setPolishError(null);
    setPolishThinking("");
    setPolishHasContent(false);
    polishAccumRef.current = { thinking: "", content: "" };

    const streamId = crypto.randomUUID();
    polishStreamIdRef.current = streamId;

    try {
      await streamPolishCompose(streamId, subject, draft, aiTone);
    } catch (e) {
      setPolishError(String(e));
      setPolishing(false);
      polishStreamIdRef.current = null;
    }
  }, [editor, polishLabels, subject, aiTone]);

  const handleSend = useCallback(() => {
    if (!editor) return;
    const bodyHtml = editor.getHTML();
    const bodyText = editor.getText();
    onSend({
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      inReplyTo,
      references,
    });
  }, [editor, accountId, to, cc, bcc, subject, inReplyTo, references, onSend]);

  return (
    <div className="flex flex-col h-full border-l border-border">
      <div className="border-b border-border px-3 py-2 flex items-center justify-between shrink-0 gap-2">
        <h3 className="text-sm font-semibold shrink-0">Compose</h3>
        <div className="flex gap-2 flex-wrap justify-end">
          {aiEnabled && polishLabels && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePolish}
              disabled={sending || polishing}
              className="h-8 gap-1.5 border-violet-500/25 hover:bg-violet-500/10"
              title={polishLabels.polishTitle}
            >
              {polishing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              )}
              {polishing ? polishLabels.polishing : polishLabels.polish}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={sending || polishing}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || polishing || !to}
          >
            {sending ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
      <div className="px-3 py-2 space-y-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium w-10 shrink-0">To</label>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="h-7 text-sm flex-1"
          />
          <button
            type="button"
            onClick={() => setShowCc(!showCc)}
            className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            {showCc ? "Hide CC" : "CC/BCC"}
          </button>
        </div>
        {showCc && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium w-10 shrink-0">Cc</label>
              <Input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
                className="h-7 text-sm flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium w-10 shrink-0">Bcc</label>
              <Input
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="bcc@example.com"
                className="h-7 text-sm flex-1"
              />
            </div>
          </>
        )}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium w-10 shrink-0">Subj</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-7 text-sm flex-1"
          />
        </div>
        {aiEnabled && polishLabels && (
          <p className="text-[11px] text-muted-foreground pl-12">
            {polishLabels.polishHint}
          </p>
        )}
      </div>
      {polishError && (
        <div className="px-3 py-2 text-xs text-destructive bg-destructive/5 border-b border-destructive/20 shrink-0">
          {polishError}
        </div>
      )}
      <AiThinkingStrip
        thinkingLabel={thinkingLabels.thinking}
        thinking={polishThinking}
        loading={polishing && !polishThinking}
      />
      <div className="flex-1 overflow-y-auto relative min-h-0">
        {polishing && !polishHasContent && !polishThinking && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
            <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
