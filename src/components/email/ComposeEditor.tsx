import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useState, useEffect } from "react";
import { Sparkles, X, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiTone } from "@/types";
import AiInlineToolbar from "@/components/ai/AiInlineToolbar";

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
  onSend,
  onCancel,
  sending,
}: ComposeEditorProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState(initialBcc);
  const [subject, setSubject] = useState(initialSubject);
  const [showCc, setShowCc] = useState(!!initialCc || !!initialBcc);
  const [aiBusy, setAiBusy] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialBodyHtml || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[300px] focus:outline-none px-6 py-4",
      },
    },
  });

  useEffect(() => {
    if (editor && initialBodyHtml && editor.getText().trim() === "") {
      editor.commands.setContent(initialBodyHtml);
    }
  }, [editor, initialBodyHtml]);

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
    <div className="flex flex-col h-full bg-background animate-fade-in">
      {aiEnabled && (
        <AiInlineToolbar
          editor={editor}
          subject={subject}
          tone={aiTone}
          onBusyChange={setAiBusy}
        />
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Message</h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCancel}
            disabled={sending || aiBusy}
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
            title="Cancel"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || aiBusy || !to}
            className="h-8 text-xs gap-1.5"
          >
            {sending ? "Sending…" : "Send"}
            {!sending && !aiBusy && (
              <CornerDownLeft className="h-3 w-3 opacity-50" />
            )}
          </Button>
        </div>
      </div>

      {/* Recipients */}
      <div className="px-5 py-2 space-y-1 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <label className="text-[11px] font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wider">To</label>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="h-7 text-sm flex-1 border-transparent bg-transparent focus-visible:border-transparent px-0"
          />
          <button
            type="button"
            onClick={() => setShowCc(!showCc)}
            className="text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            {showCc ? "Hide CC" : "CC/BCC"}
          </button>
        </div>
        {showCc && (
          <>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wider">Cc</label>
              <Input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
                className="h-7 text-sm flex-1 border-transparent bg-transparent focus-visible:border-transparent px-0"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wider">Bcc</label>
              <Input
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="bcc@example.com"
                className="h-7 text-sm flex-1 border-transparent bg-transparent focus-visible:border-transparent px-0"
              />
            </div>
          </>
        )}
        <div className="flex items-center gap-3">
          <label className="text-[11px] font-medium text-muted-foreground w-10 shrink-0 uppercase tracking-wider">Subj</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-7 text-sm flex-1 border-transparent bg-transparent focus-visible:border-transparent px-0"
          />
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto relative min-h-0 scrollbar-thin">
        <EditorContent editor={editor} />
        {aiEnabled && !aiBusy && (
          <button
            onClick={() => editor?.chain().focus().selectAll().run()}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-ai hover:border-ai/30 hover:bg-ai/5 transition-all shadow-sm"
            title="Select all text to transform with AI"
          >
            <Sparkles className="h-3 w-3 text-ai" />
            AI
          </button>
        )}
      </div>
    </div>
  );
}
