import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useState, useEffect, useRef } from "react";
import { Sparkles, X, CornerDownLeft, Paperclip, Check, Clock, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiTone, AttachmentPayload } from "@/types";
import { saveDraft, deleteDraft } from "@/lib/api";
import AiInlineToolbar from "@/components/ai/AiInlineToolbar";

interface ComposeEditorProps {
  accountId: number;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  initialBodyHtml?: string;
  draftId?: number;
  initialScheduleAt?: number;
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
    attachments?: AttachmentPayload[];
    inReplyTo?: string;
    references?: string[];
    sendAt?: number;
  }) => void;
  onCancel: () => void;
  onDraftSaved?: (draftId: number) => void;
  sending?: boolean;
}

export default function ComposeEditor({
  accountId,
  to: initialTo,
  cc: initialCc,
  bcc: initialBcc,
  subject: initialSubject,
  initialBodyHtml,
  draftId: initialDraftId,
  initialScheduleAt,
  inReplyTo,
  references,
  aiEnabled,
  aiTone = "Professional",
  onSend,
  onCancel,
  onDraftSaved,
  sending,
}: ComposeEditorProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState(initialBcc);
  const [subject, setSubject] = useState(initialSubject);
  const [showCc, setShowCc] = useState(!!initialCc || !!initialBcc);
  const [aiBusy, setAiBusy] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [draftId, setDraftId] = useState<number | undefined>(initialDraftId);
  const [draftSaved, setDraftSaved] = useState(false);
  const [showSchedule, setShowSchedule] = useState(
    !!initialScheduleAt && initialScheduleAt > Date.now(),
  );
  const [scheduleAt, setScheduleAt] = useState<string>(() => {
    if (initialScheduleAt && initialScheduleAt > Date.now()) {
      const d = new Date(initialScheduleAt);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return "";
  });
  const toRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ to, cc, bcc, subject, draftId });

  useEffect(() => {
    toRef.current?.focus();
  }, []);

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

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAtts: AttachmentPayload[] = [];
    for (const file of Array.from(files)) {
      const buf = await file.arrayBuffer();
      newAtts.push({
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        data: Array.from(new Uint8Array(buf)),
      });
    }
    setAttachments((prev) => [...prev, ...newAtts]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toLocalDatetimeInput = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openScheduler = useCallback(() => {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    next.setMinutes(0, 0, 0);
    setScheduleAt(toLocalDatetimeInput(next));
    setShowSchedule(true);
  }, []);

  const applyPreset = useCallback((ms: number) => {
    setScheduleAt(toLocalDatetimeInput(new Date(ms)));
  }, []);

  const handleScheduleSend = useCallback(() => {
    if (!editor) return;
    const ts = new Date(scheduleAt).getTime();
    if (!ts || Number.isNaN(ts)) return;
    const minTs = Date.now() + 30 * 1000;
    if (ts < minTs) {
      setScheduleAt(toLocalDatetimeInput(new Date(minTs)));
      return;
    }
    const bodyHtml = editor.getHTML();
    const bodyText = editor.getText();
    if (draftId) {
      deleteDraft(draftId).catch(console.error);
    }
    onSend({
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      attachments: attachments.length > 0 ? attachments : undefined,
      inReplyTo,
      references,
      sendAt: ts,
    });
    setShowSchedule(false);
  }, [editor, accountId, to, cc, bcc, subject, attachments, inReplyTo, references, onSend, draftId, scheduleAt]);

  const handleSend = useCallback(() => {
    if (!editor) return;
    const bodyHtml = editor.getHTML();
    const bodyText = editor.getText();
    if (draftId) {
      deleteDraft(draftId).catch(console.error);
    }
    onSend({
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      attachments: attachments.length > 0 ? attachments : undefined,
      inReplyTo,
      references,
    });
  }, [editor, accountId, to, cc, bcc, subject, attachments, inReplyTo, references, onSend, draftId]);

  useEffect(() => {
    latestRef.current = { to, cc, bcc, subject, draftId };
  }, [to, cc, bcc, subject, draftId]);

  useEffect(() => {
    if (!editor) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      const bodyHtml = editor.getHTML();
      const bodyText = editor.getText();
      if (!bodyText.trim() && !latestRef.current.to.trim() && !latestRef.current.subject.trim()) {
        return;
      }
      try {
        const id = await saveDraft({
          accountId,
          to: latestRef.current.to,
          cc: latestRef.current.cc || undefined,
          bcc: latestRef.current.bcc || undefined,
          subject: latestRef.current.subject,
          bodyHtml,
          bodyText,
          draftId: latestRef.current.draftId,
        });
        setDraftId(id);
        setDraftSaved(true);
        onDraftSaved?.(id);
        if (draftSavedTimerRef.current) clearTimeout(draftSavedTimerRef.current);
        draftSavedTimerRef.current = setTimeout(() => setDraftSaved(false), 2000);
      } catch (e) {
        console.error("Autosave failed:", e);
      }
    }, 3000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (draftSavedTimerRef.current) clearTimeout(draftSavedTimerRef.current);
    };
  }, [editor, to, cc, bcc, subject, accountId]);

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
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Message</h3>
          {draftSaved && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-500">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
        </div>
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
            ref={toRef}
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

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="px-5 py-2 border-t border-border shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <div
                key={`${att.filename}-${i}`}
                className="inline-flex items-center gap-1.5 border border-border rounded-md px-2 py-1 text-[11px]"
              >
                <Paperclip className="h-3 w-3 text-muted-foreground" />
                <span className="truncate max-w-[140px]">{att.filename}</span>
                <span className="text-muted-foreground">
                  {(att.data.length / 1024).toFixed(0)}KB
                </span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="text-muted-foreground hover:text-foreground ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer toolbar */}
      <div className="relative flex items-center gap-2 px-5 py-2 border-t border-border shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || aiBusy}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Attach files"
        >
          <Paperclip className="h-4 w-4" />
          Attach
        </button>
        <button
          onClick={openScheduler}
          disabled={sending || aiBusy || !to}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Schedule send"
        >
          <Clock className="h-4 w-4" />
          Send later
        </button>

        {showSchedule && (
          <div className="absolute bottom-full left-3 mb-2 z-20 w-72 rounded-lg border border-border bg-popover shadow-lg p-3 space-y-2.5 animate-in fade-in slide-in-from-bottom-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule send
            </div>
            <div className="flex flex-wrap gap-1">
              {(() => {
                const now = Date.now();
                const presets: { label: string; ms: number }[] = [];
                const in1h = now + 60 * 60 * 1000;
                presets.push({ label: "In 1 hour", ms: in1h });
                const tonight = new Date();
                tonight.setHours(20, 0, 0, 0);
                if (tonight.getTime() <= now) tonight.setDate(tonight.getDate() + 1);
                presets.push({ label: "Tonight 8pm", ms: tonight.getTime() });
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(9, 0, 0, 0);
                presets.push({ label: "Tomorrow 9am", ms: tomorrow.getTime() });
                const monday = new Date();
                const dow = monday.getDay();
                const daysUntilMon = ((1 + 7 - dow) % 7) || 7;
                monday.setDate(monday.getDate() + daysUntilMon);
                monday.setHours(9, 0, 0, 0);
                presets.push({ label: "Mon 9am", ms: monday.getTime() });
                return presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p.ms)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  >
                    {p.label}
                  </button>
                ));
              })()}
            </div>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              min={toLocalDatetimeInput(new Date(Date.now() + 30 * 1000))}
              className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:border-foreground/40"
            />
            <div className="flex justify-end gap-1.5 pt-0.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSchedule(false)}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleScheduleSend}
                disabled={!scheduleAt}
                className="h-8 text-xs gap-1.5"
              >
                <Clock className="h-3 w-3" />
                Schedule
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
