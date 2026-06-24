import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Loader2, Settings, Search, RefreshCw, Archive, Trash2, MailOpen, Mail, PenSquare, Reply, CornerDownLeft, Sparkles, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listAccounts,
  listThreads,
  triggerSync,
  searchEmails,
  markRead,
  archiveEmail,
  deleteEmail,
  sendEmail,
  queueEmail,
  processSendQueue,
  getSendQueue,
  fetchEmailBody,
  fetchRecentBodies,
  isOnline,
  getAiConfig,
  streamSummarizeThread,
  streamDraftReply,
  onAiStream,
  onAiStreamError,
} from "@/lib/api";
import type { Account, Thread, Email, SendQueueItem, AiConfig, AiTone } from "@/types";
import EmailViewer from "@/components/email/EmailViewer";
import ComposeEditor from "@/components/email/ComposeEditor";
import AiSummaryPanel from "@/components/ai/AiSummaryPanel";
import AiActionButtons from "@/components/ai/AiActionButtons";
import AiThinkingStrip from "@/components/ai/AiThinkingStrip";
import AiInlineToolbar from "@/components/ai/AiInlineToolbar";
import EmailChatPanel from "@/components/ai/EmailChatPanel";
import { useContextMenu, ContextMenuView } from "@/components/ui/context-menu";
import {
  getAiActionLabels,
  getAiPanelLabels,
  getAiThinkingLabels,
} from "@/lib/aiUi";
import { plainTextToHtml } from "@/lib/plainTextToHtml";
import { getEmails } from "@/lib/api";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
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

const AVATAR_COLORS = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.split(/[\s@]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function senderName(email: Email): string {
  const from = email.from?.[0];
  return from?.name || from?.address || "Unknown";
}

function ThreadLabels({ thread }: { thread: Thread }) {
  if (!thread.is_flagged) return null;
  return <span className="text-amber-500 text-[11px]">&#9733;</span>;
}

function SendQueuePanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SendQueueItem[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    getSendQueue().then(setItems).catch(console.error);
  }, []);

  const handleProcess = async () => {
    setProcessing(true);
    try {
      await processSendQueue();
      const updated = await getSendQueue();
      setItems(updated);
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="border-b border-border px-4 py-3 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outbox</h3>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={handleProcess} disabled={processing} className="h-7 text-xs">
            <RefreshCw className={`h-3 w-3 mr-1 ${processing ? "animate-spin" : ""}`} />
            Retry All
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 text-xs">
            Close
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Queue is empty.</p>
      ) : (
        <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-xs rounded-md px-2.5 py-1.5 bg-background/50"
            >
              <span className="truncate flex-1">{item.subject}</span>
              <span
                className={`ml-2 px-1.5 rounded text-[10px] font-medium ${
                  item.status === "sent"
                    ? "text-emerald-600"
                    : item.status === "failed"
                      ? "text-destructive"
                      : "text-amber-600"
                }`}
              >
                {item.status}
                {item.retry_count > 0 ? ` (${item.retry_count})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineReplyEditor({
  accountId,
  to,
  cc,
  subject,
  initialBodyHtml,
  inReplyTo,
  references,
  onSend,
  onCancel,
  sending,
  generating,
  streamingBody,
  bodyKey,
  aiEnabled,
  aiTone = "Professional",
}: {
  accountId: number;
  to: string;
  cc: string;
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
  generating?: boolean;
  streamingBody?: string;
  bodyKey?: string;
  aiEnabled?: boolean;
  aiTone?: AiTone;
}) {
  const [toVal, setToVal] = useState(to);
  const [ccVal, setCcVal] = useState(cc);
  const [subjectVal, setSubjectVal] = useState(subject);
  const [showCc, setShowCc] = useState(!!cc);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    setToVal(to);
    setCcVal(cc);
    setSubjectVal(subject);
    setShowCc(!!cc);
  }, [to, cc, subject]);

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: initialBodyHtml || "",
      editorProps: {
        attributes: {
          class: "prose prose-sm max-w-none min-h-[120px] focus:outline-none px-3 py-2",
        },
      },
    },
    [bodyKey],
  );

  const prevStreamRef = useRef("");

  useEffect(() => {
    if (editor && streamingBody !== undefined && streamingBody !== prevStreamRef.current) {
      editor.commands.setContent(plainTextToHtml(streamingBody), { emitUpdate: false });
      prevStreamRef.current = streamingBody;
    }
  }, [editor, streamingBody]);

  useEffect(() => {
    if (editor && initialBodyHtml && !streamingBody && editor.getText().trim() === "") {
      editor.commands.setContent(initialBodyHtml, { emitUpdate: false });
    }
  }, [editor, initialBodyHtml, streamingBody]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (generating) return;
      if (editor && editor.getText().trim() === "") {
        editor.commands.focus();
      }
    }, 50);
    return () => clearTimeout(t);
  }, [editor, generating]);

  const handleSend = useCallback(() => {
    if (!editor) return;
    const bodyHtml = editor.getHTML();
    const bodyText = editor.getText();
    onSend({
      accountId,
      to: toVal,
      cc: ccVal,
      bcc: "",
      subject: subjectVal,
      bodyHtml,
      bodyText,
      inReplyTo,
      references,
    });
  }, [editor, accountId, toVal, ccVal, subjectVal, inReplyTo, references, onSend]);

  return (
    <div className="border-t border-border bg-background animate-slide-up">
      {aiEnabled && (
        <AiInlineToolbar
          editor={editor}
          subject={subjectVal}
          tone={aiTone}
          disabled={generating}
          onBusyChange={setAiBusy}
        />
      )}
      <div className="px-5 py-2.5 space-y-1.5 border-b border-border/60">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-medium text-muted-foreground w-12 shrink-0 uppercase tracking-wider">Subj</label>
          <Input
            value={subjectVal}
            onChange={(e) => setSubjectVal(e.target.value)}
            placeholder="Re: …"
            className="h-7 text-sm flex-1 border-transparent bg-transparent focus-visible:border-border px-0"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-medium text-muted-foreground w-12 shrink-0 uppercase tracking-wider">To</label>
          <Input
            value={toVal}
            onChange={(e) => setToVal(e.target.value)}
            placeholder="recipient@example.com"
            className="h-7 text-sm flex-1 border-transparent bg-transparent focus-visible:border-border px-0"
          />
          <button
            type="button"
            onClick={() => setShowCc(!showCc)}
            className="text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            {showCc ? "Hide CC" : "CC"}
          </button>
        </div>
        {showCc && (
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium text-muted-foreground w-12 shrink-0 uppercase tracking-wider">Cc</label>
            <Input
              value={ccVal}
              onChange={(e) => setCcVal(e.target.value)}
              placeholder="cc@example.com"
              className="h-7 text-sm flex-1 border-transparent bg-transparent focus-visible:border-border px-0"
            />
          </div>
        )}
      </div>
      <div className="px-5 pb-2">
        <div className="relative border border-border/60 rounded-lg overflow-hidden min-h-[140px] bg-background">
          {generating && !streamingBody && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/90 backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin text-ai" />
              <span className="text-xs text-muted-foreground">Drafting reply…</span>
            </div>
          )}
          <EditorContent editor={editor} />
          {aiEnabled && !aiBusy && !generating && (
            <button
              onClick={() => editor?.chain().focus().selectAll().run()}
              className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-ai hover:border-ai/30 hover:bg-ai/5 transition-all shadow-sm"
              title="Select all text to transform with AI"
            >
              <Sparkles className="h-3 w-3 text-ai" />
              AI
            </button>
          )}
        </div>
      </div>
      <div className="px-5 pb-3 flex items-center gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={sending || generating || aiBusy} className="text-xs">
          Discard
        </Button>
        <Button
          size="sm"
          onClick={handleSend}
          disabled={sending || generating || aiBusy || !toVal || !subjectVal.trim()}
          className="text-xs"
        >
          {sending ? "Sending…" : "Send"}
          {!sending && !generating && !aiBusy && (
            <CornerDownLeft className="h-3 w-3 ml-1 opacity-50" />
          )}
        </Button>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<number | null>(null);
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Email[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryThinking, setAiSummaryThinking] = useState("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [aiDraftError, setAiDraftError] = useState<string | null>(null);
  const [aiReplyBody, setAiReplyBody] = useState<string>("");
  const [aiReplyThinking, setAiReplyThinking] = useState("");
  const [replyEditorKey, setReplyEditorKey] = useState("empty");
  const [showInlineReply, setShowInlineReply] = useState(false);
  const [inlineReplyTo, setInlineReplyTo] = useState("");
  const [inlineReplyCc, setInlineReplyCc] = useState("");
  const [inlineReplySubject, setInlineReplySubject] = useState("");
  const [inlineReplyInReplyTo, setInlineReplyInReplyTo] = useState<string | undefined>();
  const [inlineReplyReferences, setInlineReplyReferences] = useState<string[] | undefined>();

  const [aiDraftBody, setAiDraftBody] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatEmailIds, setChatEmailIds] = useState<number[]>([]);
  const [busyThreadIds, setBusyThreadIds] = useState<Set<number>>(new Set());
  const [busyEmailIds, setBusyEmailIds] = useState<Set<number>>(new Set());

  const searchInputRef = useRef<HTMLInputElement>(null);
  const ctxMenu = useContextMenu();

  const aiTone = (aiConfig?.default_tone || "Professional") as AiTone;
  const aiLanguage = aiConfig?.output_language || "en";
  const aiActionLabels = getAiActionLabels(aiLanguage);
  const aiPanelLabels = getAiPanelLabels(aiLanguage);
  const aiThinkingLabels = getAiThinkingLabels(aiLanguage);
  const unreadCount = threads.filter((t) => !t.is_read).length;

  const activeStreamIdRef = useRef<string | null>(null);
  const activeStreamKindRef = useRef<"summary" | "reply" | null>(null);

  const hydrateEmailBodies = useCallback(async (list: Email[]) => {
    const needsFetch = list.filter((e) => !e.body_html && !e.body_text);
    if (needsFetch.length === 0) return list;
    await Promise.all(needsFetch.map((e) => fetchEmailBody(e.id).catch(() => {})));
    if (selectedThread && selectedThread > 0) {
      return getEmails(selectedThread);
    }
    return Promise.all(
      list.map(async (e) => {
        if (e.body_html || e.body_text) return e;
        const refreshed = await getEmails(e.thread_id).catch(() => []);
        return refreshed.find((r) => r.id === e.id) ?? e;
      }),
    );
  }, [selectedThread]);

  useEffect(() => {
    listAccounts().then(setAccounts).catch(console.error);
    isOnline().then(setOnline).catch(() => setOnline(false));
    getAiConfig().then(setAiConfig).catch(() => setAiConfig(null));
    const interval = setInterval(() => {
      isOnline().then(setOnline).catch(() => setOnline(false));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const refreshQueue = () => {
      getSendQueue()
        .then((items) =>
          setPendingQueueCount(items.filter((i) => i.status === "pending").length)
        )
        .catch(() => setPendingQueueCount(0));
    };
    refreshQueue();
    if (online) {
      processSendQueue()
        .then(refreshQueue)
        .catch((e) => setStatusMessage(String(e)));
    }
  }, [online]);

  const loadThreads = useCallback(() => {
    listThreads({
      accountId: selectedAccount || undefined,
      limit: 100,
    })
      .then(setThreads)
      .catch(console.error);
  }, [selectedAccount]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const resetAiStream = useCallback(() => {
    activeStreamIdRef.current = null;
    activeStreamKindRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [unlistenStream, unlistenError] = await Promise.all([
        onAiStream((event) => {
          if (event.streamId !== activeStreamIdRef.current) return;
          const kind = activeStreamKindRef.current;
          if (!kind) return;
          if (event.done) {
            if (kind === "summary") setAiSummaryLoading(false);
            else setAiDraftLoading(false);
            resetAiStream();
            return;
          }
          if (kind === "summary") {
            if (event.tokenKind === "thinking") {
              setAiSummaryThinking((prev) => prev + event.token);
            } else {
              setAiSummary((prev) => (prev ?? "") + event.token);
            }
          } else if (event.tokenKind === "thinking") {
            setAiReplyThinking((prev) => prev + event.token);
          } else {
            setAiReplyBody((prev) => prev + event.token);
          }
        }),
        onAiStreamError((event) => {
          if (event.streamId !== activeStreamIdRef.current) return;
          const kind = activeStreamKindRef.current;
          if (kind === "summary") {
            setAiSummaryError(event.token);
            setAiSummaryLoading(false);
          } else {
            setAiDraftError(event.token);
            setAiDraftLoading(false);
            setStatusMessage(event.token);
          }
          resetAiStream();
        }),
      ]);
      if (cancelled) {
        unlistenStream();
        unlistenError();
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resetAiStream]);

  const clearAiState = useCallback(() => {
    setAiSummary(null);
    setAiSummaryThinking("");
    setAiSummaryLoading(false);
    setAiSummaryError(null);
    setAiDraftLoading(false);
    setAiDraftError(null);
    setAiReplyBody("");
    setAiReplyThinking("");
    resetAiStream();
  }, [resetAiStream]);

  const showSummaryPanel =
    aiSummary !== null || aiSummaryLoading || aiSummaryError !== null;

  const handleSync = async () => {
    setSyncing(true);
    setStatusMessage(null);
    try {
      await triggerSync(selectedAccount || undefined);
      const updated = await listAccounts();
      setAccounts(updated);
      loadThreads();
      if (selectedAccount) {
        await fetchRecentBodies(selectedAccount, 20);
      } else {
        for (const account of updated) {
          await fetchRecentBodies(account.id, 20);
        }
      }
      loadThreads();
      setStatusMessage("Sync complete.");
    } catch (e) {
      setStatusMessage(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setIsSearching(false);
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchEmails(searchQuery);
      setSearchResults(results);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectThread = async (thread: Thread) => {
    setSelectedThread(thread.id);
    clearAiState();
    setShowInlineReply(false);
    try {
      const list = await getEmails(thread.id);
      setEmails(list);
      if (list.length > 0) {
        const focusId = list[list.length - 1].id;
        setSelectedEmail(focusId);

        const unread = list.filter((e) => !e.is_read);
        if (unread.length > 0) {
          await Promise.all(unread.map((e) => markRead(e.id, true).catch(console.error)));
          const updated = list.map((e) => ({ ...e, is_read: true }));
          setEmails(updated);
          setThreads((prev) =>
            prev.map((t) => (t.id === thread.id ? { ...t, is_read: true } : t)),
          );
        }

        for (const email of list) {
          if (!email.body_html && !email.body_text) {
            fetchEmailBody(email.id)
              .then(async () => {
                const refreshed = await getEmails(thread.id);
                setEmails(refreshed);
              })
              .catch((e) => setStatusMessage(String(e)));
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async (params: {
    accountId: number;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    inReplyTo?: string;
    references?: string[];
  }) => {
    setSending(true);
    setStatusMessage(null);
    try {
      if (online) {
        await sendEmail(params);
        setStatusMessage("Email sent.");
      } else {
        await queueEmail(params);
        setStatusMessage("Offline — email queued for later.");
        const items = await getSendQueue();
        setPendingQueueCount(items.filter((i) => i.status === "pending").length);
      }
      setShowInlineReply(false);
      setComposing(false);
      setAiReplyBody("");
      setAiReplyThinking("");
      setAiDraftBody(null);
      setAiDraftLoading(false);
      setAiDraftError(null);
    } catch (e) {
      setStatusMessage(String(e));
    } finally {
      setSending(false);
    }
  };

  const selectedEmailData = emails.find((e) => e.id === selectedEmail);
  const lastEmail = emails[emails.length - 1];

  const handleArchive = useCallback(async (emailId: number) => {
    const threadId = selectedThread;
    if (threadId) setBusyThreadIds((prev) => new Set(prev).add(threadId));
    setBusyEmailIds((prev) => new Set(prev).add(emailId));
    await archiveEmail(emailId).catch(console.error);
    setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(emailId); return n; });
    if (threadId) {
      const remaining = await getEmails(threadId).catch(() => []);
      if (remaining.length === 0) {
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
        setSelectedThread(null);
        setSelectedEmail(null);
        setEmails([]);
      } else {
        setEmails(remaining);
        setSelectedEmail(remaining[remaining.length - 1].id);
      }
    }
    setBusyThreadIds((prev) => { const n = new Set(prev); if (threadId) n.delete(threadId); return n; });
    loadThreads();
  }, [selectedThread, loadThreads]);

  const handleDelete = useCallback(async (emailId: number) => {
    const threadId = selectedThread;
    if (threadId) setBusyThreadIds((prev) => new Set(prev).add(threadId));
    setBusyEmailIds((prev) => new Set(prev).add(emailId));
    await deleteEmail(emailId).catch(console.error);
    setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(emailId); return n; });
    if (threadId) {
      const remaining = await getEmails(threadId).catch(() => []);
      if (remaining.length === 0) {
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
        setSelectedThread(null);
        setSelectedEmail(null);
        setEmails([]);
      } else {
        setEmails(remaining);
        setSelectedEmail(remaining[remaining.length - 1].id);
      }
    }
    setBusyThreadIds((prev) => { const n = new Set(prev); if (threadId) n.delete(threadId); return n; });
    loadThreads();
  }, [selectedThread, loadThreads]);

  const openReplyComposer = useCallback((email: Email) => {
    const replyTo = email.from.map((a) => a.address).join(", ");
    const replyCc = email.cc?.map((a) => a.address).join(", ") || "";
    const replySubject = email.subject
      ? email.subject.startsWith("Re:") || email.subject.startsWith("re:")
        ? email.subject
        : `Re: ${email.subject}`
      : "";
    setInlineReplyTo(replyTo);
    setInlineReplyCc(replyCc);
    setInlineReplySubject(replySubject);
    setInlineReplyInReplyTo(email.message_id);
    setInlineReplyReferences(
      [...(email.references || []), email.message_id].filter(Boolean),
    );
    setShowInlineReply(true);
  }, []);

  const handleSummarize = async () => {
    if (!selectedThread || !aiConfig || emails.length === 0) return;
    resetAiStream();
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    setAiSummary("");
    setAiSummaryThinking("");

    try {
      const hydrated = await hydrateEmailBodies(emails);
      setEmails(hydrated);
      const emailIds = hydrated.map((e) => e.id);
      const streamId = crypto.randomUUID();
      activeStreamIdRef.current = streamId;
      activeStreamKindRef.current = "summary";
      await streamSummarizeThread(streamId, selectedThread, emailIds, aiTone);
    } catch (e) {
      setAiSummaryError(String(e));
      setAiSummaryLoading(false);
      resetAiStream();
    }
  };

  const handleDraftReply = async () => {
    if (!selectedThread || !lastEmail || !aiConfig || emails.length === 0) return;
    resetAiStream();
    setAiDraftError(null);
    setAiReplyBody("");
    setAiReplyThinking("");
    openReplyComposer(lastEmail);
    setReplyEditorKey("drafting");
    setAiDraftLoading(true);

    try {
      const hydrated = await hydrateEmailBodies(emails);
      setEmails(hydrated);
      const emailIds = hydrated.map((e) => e.id);
      const streamId = crypto.randomUUID();
      activeStreamIdRef.current = streamId;
      activeStreamKindRef.current = "reply";
      await streamDraftReply(streamId, selectedThread, emailIds, aiTone);
    } catch (e) {
      setAiDraftError(String(e));
      setStatusMessage(String(e));
      setAiDraftLoading(false);
      resetAiStream();
    }
  };

  const handleManualReply = () => {
    if (!lastEmail) return;
    setAiDraftError(null);
    setAiReplyBody("");
    setAiReplyThinking("");
    setReplyEditorKey(`manual-${Date.now()}`);
    openReplyComposer(lastEmail);
  };

  const handleChatAbout = useCallback(
    (emailIds: number[]) => {
      if (emailIds.length === 0) return;
      setChatEmailIds(emailIds);
      setShowChat(true);
    },
    [],
  );

  const handleThreadContextMenu = useCallback(
    (e: React.MouseEvent, thread: Thread) => {
      ctxMenu.show(e, [
        {
          label: "Open",
          onClick: () => handleSelectThread(thread),
        },
        {
          label: "Chat about thread",
          icon: <MessageSquare className="h-3.5 w-3.5" />,
          disabled: !aiConfig || !online,
          onClick: async () => {
            handleSelectThread(thread);
            const fetched = await getEmails(thread.id).catch(() => []);
            handleChatAbout(fetched.map((em) => em.id));
          },
        },
        { separator: true },
        {
          label: "Mark read",
          onClick: async () => {
            const fetched = await getEmails(thread.id).catch(() => []);
            await Promise.all(
              fetched.filter((em) => !em.is_read).map((em) => markRead(em.id, true).catch(() => {})),
            );
            loadThreads();
          },
        },
        {
          label: "Mark unread",
          onClick: async () => {
            const fetched = await getEmails(thread.id).catch(() => []);
            await Promise.all(
              fetched.filter((em) => em.is_read).map((em) => markRead(em.id, false).catch(() => {})),
            );
            loadThreads();
          },
        },
        { separator: true },
        {
          label: "Archive",
          icon: <Archive className="h-3.5 w-3.5" />,
          danger: true,
          onClick: async () => {
            setBusyThreadIds((prev) => new Set(prev).add(thread.id));
            const fetched = await getEmails(thread.id).catch(() => []);
            for (const em of fetched) {
              setBusyEmailIds((prev) => new Set(prev).add(em.id));
              await archiveEmail(em.id).catch(() => {});
              setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(em.id); return n; });
            }
            if (selectedThread === thread.id) {
              setSelectedThread(null);
              setSelectedEmail(null);
              setEmails([]);
            }
            setBusyThreadIds((prev) => { const n = new Set(prev); n.delete(thread.id); return n; });
            loadThreads();
          },
        },
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          onClick: async () => {
            setBusyThreadIds((prev) => new Set(prev).add(thread.id));
            const fetched = await getEmails(thread.id).catch(() => []);
            for (const em of fetched) {
              setBusyEmailIds((prev) => new Set(prev).add(em.id));
              await deleteEmail(em.id).catch(() => {});
              setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(em.id); return n; });
            }
            if (selectedThread === thread.id) {
              setSelectedThread(null);
              setSelectedEmail(null);
              setEmails([]);
            }
            setBusyThreadIds((prev) => { const n = new Set(prev); n.delete(thread.id); return n; });
            loadThreads();
          },
        },
      ]);
    },
    [ctxMenu, aiConfig, online, handleChatAbout, handleSelectThread, loadThreads, selectedThread],
  );

  const handleEmailContextMenu = useCallback(
    (e: React.MouseEvent, email: Email) => {
      ctxMenu.show(e, [
        {
          label: "Chat about this email",
          icon: <MessageSquare className="h-3.5 w-3.5" />,
          disabled: !aiConfig || !online,
          onClick: () => handleChatAbout([email.id]),
        },
        { separator: true },
        {
          label: email.is_read ? "Mark unread" : "Mark read",
          onClick: async () => {
            await markRead(email.id, !email.is_read).catch(console.error);
            setEmails((prev) => prev.map((em) => em.id === email.id ? { ...em, is_read: !email.is_read } : em));
          },
        },
        {
          label: "Archive",
          icon: <Archive className="h-3.5 w-3.5" />,
          danger: true,
          onClick: () => handleArchive(email.id),
        },
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          onClick: () => handleDelete(email.id),
        },
      ]);
    },
    [ctxMenu, aiConfig, online, handleChatAbout, handleArchive, handleDelete],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (composing || showInlineReply || aiDraftLoading || aiSummaryLoading) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = threads.findIndex((t) => t.id === selectedThread);
        const next = threads[Math.min(idx + 1, threads.length - 1)];
        if (next) handleSelectThread(next);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = threads.findIndex((t) => t.id === selectedThread);
        const prev = threads[Math.max(idx - 1, 0)];
        if (prev) handleSelectThread(prev);
      } else if (e.key === "r" && selectedEmailData) {
        e.preventDefault();
        handleManualReply();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setComposing(true);
      } else if (e.key === "s" && selectedThread && aiConfig) {
        e.preventDefault();
        handleSummarize();
      } else if (e.key === "e" && selectedEmailData) {
        e.preventDefault();
        handleArchive(selectedEmailData.id);
      } else if ((e.key === "#" || e.key === "Delete") && selectedEmailData) {
        e.preventDefault();
        handleDelete(selectedEmailData.id);
      } else if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [threads, selectedThread, selectedEmailData, composing, showInlineReply, aiDraftLoading, aiSummaryLoading, aiConfig]);

  return (
    <div className="flex h-full">
      {/* Thread list */}
      <div className="w-[340px] border-r border-border flex flex-col shrink-0 bg-sidebar">
        {/* Search + Sync */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search…"
              className="h-8 text-sm pl-8 bg-muted/50 border-transparent focus-visible:bg-background"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSync}
            disabled={syncing}
            className="h-8 w-8 p-0 shrink-0"
            title="Sync"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-red-500"}`} />
            {online ? "Online" : "Offline"}
          </span>
          {unreadCount > 0 && (
            <>
              <span className="text-[11px] text-muted-foreground/50">·</span>
              <span className="text-[11px] text-muted-foreground">
                {unreadCount} unread
              </span>
            </>
          )}
          {pendingQueueCount > 0 && (
            <>
              <span className="text-[11px] text-muted-foreground/50">·</span>
              <button
                type="button"
                onClick={() => setShowQueue(!showQueue)}
                className="text-[11px] text-amber-600 hover:text-amber-500"
              >
                Outbox ({pendingQueueCount})
              </button>
            </>
          )}
          {statusMessage && (
            <span className="text-[11px] text-muted-foreground truncate ml-auto">{statusMessage}</span>
          )}
        </div>

        {/* Account filter */}
        {accounts.length > 0 && (
          <div className="flex gap-1 px-2 py-1.5 border-b border-border overflow-x-auto scrollbar-none">
            <button
              onClick={() => setSelectedAccount(null)}
              className={`px-2 py-0.5 text-[11px] rounded-md whitespace-nowrap transition-colors ${
                selectedAccount === null
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              All
            </button>
            {accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => setSelectedAccount(account.id)}
                className={`px-2 py-0.5 text-[11px] rounded-md whitespace-nowrap transition-colors ${
                  selectedAccount === account.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {account.email_address !== "unknown@unknown.com"
                  ? account.email_address
                  : account.display_name}
              </button>
            ))}
          </div>
        )}

        {/* Thread items */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isSearching ? (
            searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Search className="h-5 w-5 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No results</p>
              </div>
            ) : (
              searchResults.map((email) => {
                const name = senderName(email);
                return (
                  <div
                    key={email.id}
                    onClick={() => {
                      setSelectedThread(email.thread_id);
                      setEmails([email]);
                      setSelectedEmail(email.id);
                      setIsSearching(false);
                    }}
                    className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors group"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${avatarColor(name)}`}>
                      {initials(name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{email.subject || "(no subject)"}</p>
                      <p className="text-xs text-muted-foreground truncate">{name}</p>
                    </div>
                  </div>
                );
              })
            )
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <Mail className="h-6 w-6 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No accounts yet</p>
              <Link to="/settings" className="text-xs text-ai hover:text-ai/80">
                Add one in Settings →
              </Link>
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <Mail className="h-6 w-6 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No threads yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Sync to fetch emails</p>
            </div>
          ) : (
            (() => {
              let currentGroup = "";
              return threads.map((thread) => {
                const group = dateGroup(thread.latest_date);
                const showHeader = group !== currentGroup;
                currentGroup = group;
                const selected = selectedThread === thread.id;
                const threadBusy = busyThreadIds.has(thread.id);
                return (
                  <div key={thread.id}>
                    {showHeader && (
                      <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                        {group}
                      </div>
                    )}
                    <div
                      onClick={() => !threadBusy && handleSelectThread(thread)}
                      onContextMenu={(e) => handleThreadContextMenu(e, thread)}
                      className={`relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors group ${
                        threadBusy ? "opacity-50 pointer-events-none" : ""
                      } ${selected
                          ? "bg-accent"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      {selected && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-foreground" />
                      )}
                      {threadBusy && (
                        <div className="absolute right-2 top-2.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {!thread.is_read && (
                            <span className="h-1.5 w-1.5 rounded-full bg-ai shrink-0" />
                          )}
                          <ThreadLabels thread={thread} />
                          <p className={`text-sm truncate flex-1 ${!thread.is_read ? "font-semibold" : "text-muted-foreground"}`}>
                            {thread.subject || "(no subject)"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[11px] text-muted-foreground/80">
                            {thread.message_count} {thread.message_count === 1 ? "msg" : "msgs"}
                          </p>
                          <span className="text-[11px] text-muted-foreground/40">·</span>
                          <p className="text-[11px] text-muted-foreground/80">
                            {formatDate(thread.latest_date)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>

      {/* Reading pane / Compose */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {showQueue && <SendQueuePanel onClose={() => setShowQueue(false)} />}
        {composing ? (
          <ComposeEditor
            accountId={selectedAccount || accounts[0]?.id || 0}
            to=""
            cc=""
            bcc=""
            subject=""
            initialBodyHtml={aiDraftBody || undefined}
            aiEnabled={!!aiConfig && online}
            aiTone={aiTone}
            onSend={handleSend}
            onCancel={() => {
              setComposing(false);
              setAiDraftBody(null);
            }}
            sending={sending}
          />
        ) : selectedEmailData ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Action toolbar */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
              <button
                onClick={() => handleArchive(selectedEmailData.id)}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Archive"
              >
                <Archive className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                onClick={() => handleDelete(selectedEmailData.id)}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                onClick={async () => {
                  const newRead = !selectedEmailData.is_read;
                  await markRead(selectedEmailData.id, newRead).catch(console.error);
                  setEmails((prev) => prev.map((e) => e.id === selectedEmailData.id ? { ...e, is_read: newRead } : e));
                  if (newRead) {
                    setThreads((prev) => prev.map((t) => t.id === selectedThread ? { ...t, is_read: true } : t));
                  } else {
                    loadThreads();
                  }
                }}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title={selectedEmailData.is_read ? "Mark unread" : "Mark read"}
              >
                {selectedEmailData.is_read ? <Mail className="h-4 w-4" strokeWidth={1.75} /> : <MailOpen className="h-4 w-4" strokeWidth={1.75} />}
              </button>
              <div className="flex-1" />
              {!online && (
                <span className="text-[11px] text-amber-600 px-2">Offline</span>
              )}
              {online && selectedThread && aiConfig && emails.length > 0 && (
                <AiActionButtons
                  labels={aiActionLabels}
                  onSummarize={handleSummarize}
                  onDraftReply={handleDraftReply}
                  summarizeLoading={aiSummaryLoading}
                  draftLoading={aiDraftLoading}
                  disabled={!lastEmail}
                />
              )}
              {online && aiConfig && emails.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleChatAbout(emails.map((e) => e.id))}
                  disabled={aiSummaryLoading || aiDraftLoading}
                  className="h-8 text-xs gap-1.5"
                  title="Chat about this thread"
                >
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Chat
                </Button>
              )}
              {online && lastEmail && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleManualReply}
                  disabled={aiSummaryLoading || aiDraftLoading}
                  className="h-8 text-xs gap-1.5"
                >
                  <Reply className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Reply
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setComposing(true)}
                className="h-8 text-xs gap-1.5"
              >
                <PenSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
                Compose
              </Button>
            </div>

            {/* AI nudge */}
            {online && selectedThread && !aiConfig && (
              <div className="border-b border-border px-5 py-2.5 flex items-center justify-between gap-3 bg-ai/[0.03]">
                <p className="text-sm text-muted-foreground">
                  Connect AI to summarize threads and draft replies.
                </p>
                <Link
                  to="/settings"
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-ai hover:text-ai/80"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Setup
                </Link>
              </div>
            )}

            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                {/* Email list */}
                <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
                  {emails.map((email, idx) => {
                    const emailBusy = busyEmailIds.has(email.id);
                    return (
                    <div
                      key={email.id}
                      className={`relative ${idx > 0 ? "border-t border-border" : ""} ${
                        emailBusy ? "opacity-50 pointer-events-none" : ""
                      } ${
                        email.id === selectedEmail
                          ? ""
                          : "cursor-pointer hover:bg-accent/30"
                      }`}
                      onClick={() => setSelectedEmail(email.id)}
                      onContextMenu={(e) => handleEmailContextMenu(e, email)}
                    >
                      {emailBusy && (
                        <div className="absolute right-3 top-3 z-10">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      <EmailViewer email={email} />
                    </div>
                    );
                  })}
                </div>

                {/* Inline reply */}
                {showInlineReply && (
                  <div className="shrink-0 border-t border-border">
                    {aiDraftError && !aiDraftLoading && (
                      <div className="px-5 py-2 bg-destructive/5 text-xs text-destructive">
                        {aiDraftError}
                      </div>
                    )}
                    <AiThinkingStrip
                      thinkingLabel={aiThinkingLabels.thinking}
                      thinking={aiReplyThinking}
                      loading={aiDraftLoading && !aiReplyBody}
                    />
                    <InlineReplyEditor
                      key={replyEditorKey}
                      accountId={selectedAccount || accounts[0]?.id || 0}
                      to={inlineReplyTo}
                      cc={inlineReplyCc}
                      subject={inlineReplySubject}
                      initialBodyHtml={
                        !aiDraftLoading && aiReplyBody
                          ? plainTextToHtml(aiReplyBody)
                          : undefined
                      }
                      streamingBody={aiDraftLoading ? aiReplyBody : undefined}
                      bodyKey={replyEditorKey}
                      generating={aiDraftLoading}
                      inReplyTo={inlineReplyInReplyTo}
                      references={inlineReplyReferences}
                      onSend={handleSend}
                      onCancel={() => {
                        setShowInlineReply(false);
                        setAiReplyBody("");
                        setAiReplyThinking("");
                        setAiDraftError(null);
                      }}
                      sending={sending}
                      aiEnabled={!!aiConfig && online}
                      aiTone={aiTone}
                    />
                  </div>
                )}
              </div>

              {/* AI Summary panel */}
              {showSummaryPanel && (
                <AiSummaryPanel
                  labels={aiPanelLabels}
                  summary={aiSummary}
                  thinking={aiSummaryThinking}
                  loading={aiSummaryLoading}
                  error={aiSummaryError}
                  onDismiss={() => {
                    setAiSummary(null);
                    setAiSummaryThinking("");
                    setAiSummaryError(null);
                    setAiSummaryLoading(false);
                  }}
                  onRetry={handleSummarize}
                />
              )}

              {/* Chat panel */}
              {showChat && (
                <EmailChatPanel
                  emailIds={chatEmailIds}
                  emails={emails.filter((e) => chatEmailIds.includes(e.id))}
                  tone={aiTone}
                  onClose={() => {
                    setShowChat(false);
                    setChatEmailIds([]);
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-background">
            <div className="text-center space-y-3">
              <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-accent">
                <Mail className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Nothing selected</p>
                <p className="text-xs text-muted-foreground">Pick a thread or compose a new email</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setComposing(true)}
                className="mt-2 text-xs gap-1.5"
              >
                <PenSquare className="h-3.5 w-3.5" />
                Compose
              </Button>
            </div>
          </div>
        )}
      </div>

      {ctxMenu.menu && (
        <ContextMenuView menu={ctxMenu.menu} onClose={ctxMenu.hide} />
      )}
    </div>
  );
}
