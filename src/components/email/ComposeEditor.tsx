import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ComposeEditorProps {
  accountId: number;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  initialBodyHtml?: string;
  inReplyTo?: string;
  references?: string[];
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
  onSend,
  onCancel,
  sending,
}: ComposeEditorProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState(initialBcc);
  const [subject, setSubject] = useState(initialSubject);
  const [showCc, setShowCc] = useState(!!initialCc || !!initialBcc);

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
    if (editor && initialBodyHtml && editor.getText() === "") {
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
    <div className="flex flex-col h-full border-l border-border">
      <div className="border-b border-border px-3 py-2 flex items-center justify-between shrink-0">
        <h3 className="text-sm font-semibold">Compose</h3>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending || !to}>
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
            className="h-7 text-sm"
          />
          <button
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
                className="h-7 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium w-10 shrink-0">Bcc</label>
              <Input
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="bcc@example.com"
                className="h-7 text-sm"
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
            className="h-7 text-sm"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
