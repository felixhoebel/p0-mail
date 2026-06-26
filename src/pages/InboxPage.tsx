import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Loader2, Settings, Search, RefreshCw, Archive, Trash2, MailOpen, Mail, PenSquare, Reply, ReplyAll, Forward, CornerDownLeft, Sparkles, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listAccounts,
  listThreads,
  listFolders,
  triggerSync,
  searchEmails,
  markRead,
  markAllRead,
  archiveEmail,
  deleteEmail,
  queueEmail,
  processSendQueue,
  cancelSend,
  getSendQueue,
  fetchEmailBody,
  fetchRecentBodies,
  fetchThreadBodies,
  getAiConfig,
  streamSummarizeThread,
  streamDraftReply,
  onAiStream,
  onAiStreamError,
  onMailSynced,
  onAiConfigChanged,
} from "@/lib/api";
import type { Account, Folder, Thread, Email, SendQueueItem, AiConfig, AiTone, AttachmentPayload } from "@/types";
import EmailViewer from "@/components/email/EmailViewer";
import ComposeEditor from "@/components/email/ComposeEditor";
import VirtualizedThreadList from "@/components/email/VirtualizedThreadList";
import AiSummaryPanel from "@/components/ai/AiSummaryPanel";
import AiActionButtons from "@/components/ai/AiActionButtons";
import AiThinkingStrip from "@/components/ai/AiThinkingStrip";
import AiInlineToolbar from "@/components/ai/AiInlineToolbar";
import EmailChatPanel from "@/components/ai/EmailChatPanel";
import { useContextMenu, ContextMenuView } from "@/components/ui/context-menu";
import { CommandPalette, type PaletteAction } from "@/components/ui/command-palette";
import {
  getAiActionLabels,
  getAiPanelLabels,
  getAiThinkingLabels,
} from "@/lib/aiUi";
import { plainTextToHtml } from "@/lib/plainTextToHtml";
import { buildForwardBody, buildReplyQuoteBody } from "@/lib/quote";
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

export default function InboxPage({ active }: { active: boolean }) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<number | null>(null);
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<number | null>(null);
  const selectedThreadRef = useRef<number | null>(null);
  selectedThreadRef.current = selectedThread;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Thread[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [threadOffset, setThreadOffset] = useState(0);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const THREAD_PAGE_SIZE = 100;
  const [online, setOnline] = useState(true);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [undoSend, setUndoSend] = useState<{ queueId: number; subject: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [inlineReplyQuoteHtml, setInlineReplyQuoteHtml] = useState<string | undefined>();

  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBodyHtml, setComposeBodyHtml] = useState<string | undefined>();
  const [composeInReplyTo, setComposeInReplyTo] = useState<string | undefined>();
  const [composeReferences, setComposeReferences] = useState<string[] | undefined>();

  const [aiDraftBody, setAiDraftBody] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatEmailIds, setChatEmailIds] = useState<number[]>([]);
  const [busyThreadIds, setBusyThreadIds] = useState<Set<number>>(new Set());
  const [busyEmailIds, setBusyEmailIds] = useState<Set<number>>(new Set());

  const searchInputRef = useRef<HTMLInputElement>(null);
  const ctxMenu = useContextMenu();

  const UNDO_WINDOW_MS = 8000;

  const aiTone = (aiConfig?.default_tone || "Professional") as AiTone;
  const aiLanguage = aiConfig?.output_language || "en";
  const aiActionLabels = getAiActionLabels(aiLanguage);
  const aiPanelLabels = getAiPanelLabels(aiLanguage);
  const aiThinkingLabels = getAiThinkingLabels(aiLanguage);
  const unreadCount = threads.filter((t) => !t.is_read).length;

  const activeStreamIdRef = useRef<string | null>(null);
  const activeStreamKindRef = useRef<"summary" | "reply" | null>(null);

  const kbStateRef = useRef<Record<string, unknown>>({});

  const hydrateEmailBodies = useCallback(async (list: Email[]) => {
    const needsFetch = list.filter((e) => !e.body_html && !e.body_text);
    if (needsFetch.length === 0) return list;
    if (selectedThread && selectedThread > 0) {
      await fetchThreadBodies(selectedThread).catch(() => {});
      return getEmails(selectedThread);
    }
    await Promise.all(needsFetch.map((e) => fetchEmailBody(e.id).catch(() => {})));
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
    setOnline(navigator.onLine);
    getAiConfig().then(setAiConfig).catch(() => setAiConfig(null));
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
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
      folder: selectedFolder || undefined,
      limit: THREAD_PAGE_SIZE,
    })
      .then((fetched) => {
        setThreads(fetched);
        setThreadOffset(fetched.length);
        setHasMoreThreads(fetched.length === THREAD_PAGE_SIZE);
      })
      .catch(console.error);
  }, [selectedAccount, selectedFolder]);

  const loadMoreThreads = useCallback(() => {
    if (loadingMore || !hasMoreThreads) return;
    setLoadingMore(true);
    const offset = threadOffset;
    listThreads({
      accountId: selectedAccount || undefined,
      folder: selectedFolder || undefined,
      limit: THREAD_PAGE_SIZE,
      offset,
    })
      .then((fetched) => {
        setThreads((prev) => [...prev, ...fetched]);
        setThreadOffset((prev) => prev + fetched.length);
        setHasMoreThreads(fetched.length === THREAD_PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  }, [loadingMore, hasMoreThreads, threadOffset, selectedAccount, selectedFolder]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      listFolders(selectedAccount)
        .then(setFolders)
        .catch(console.error);
    } else {
      setFolders([]);
    }
    setSelectedFolder(null);
  }, [selectedAccount]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let alive = true;
    onMailSynced((event) => {
      if (event.new_count > 0) {
        loadThreads();
        setStatusMessage(`${event.new_count} new email${event.new_count === 1 ? "" : "s"}`);
      }
    }).then((fn) => {
      if (!alive) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [loadThreads]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let alive = true;
    onAiConfigChanged(() => {
      getAiConfig().then(setAiConfig).catch(() => setAiConfig(null));
    }).then((fn) => {
      if (!alive) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const resetAiStream = useCallback(() => {
    activeStreamIdRef.current = null;
    activeStreamKindRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenStream: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    (async () => {
      const [s, e] = await Promise.all([
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
        s();
        e();
        return;
      }
      unlistenStream = s;
      unlistenError = e;
    })();
    return () => {
      cancelled = true;
      unlistenStream?.();
      unlistenError?.();
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
    selectedThreadRef.current = thread.id;
    clearAiState();
    setShowInlineReply(false);
    try {
      const list = await getEmails(thread.id);
      if (selectedThreadRef.current !== thread.id) return;
      setEmails(list);
      if (list.length > 0) {
        const focusId = list[list.length - 1].id;
        setSelectedEmail(focusId);

        const unread = list.filter((e) => !e.is_read);
        if (unread.length > 0) {
          await Promise.all(unread.map((e) => markRead(e.id, true).catch(console.error)));
          if (selectedThreadRef.current !== thread.id) return;
          const updated = list.map((e) => ({ ...e, is_read: true }));
          setEmails(updated);
          setThreads((prev) =>
            prev.map((t) => (t.id === thread.id ? { ...t, is_read: true } : t)),
          );
        }

        for (const email of list) {
          if (!email.body_html && !email.body_text) {
            fetchThreadBodies(thread.id)
              .then(async () => {
                if (selectedThreadRef.current !== thread.id) return;
                const refreshed = await getEmails(thread.id);
                if (selectedThreadRef.current !== thread.id) return;
                setEmails(refreshed);
              })
              .catch((e) => setStatusMessage(String(e)));
            break;
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const closeComposeAfterSend = () => {
    setShowInlineReply(false);
    setComposing(false);
    setAiReplyBody("");
    setAiReplyThinking("");
    setAiDraftBody(null);
    setAiDraftLoading(false);
    setAiDraftError(null);
  };

  const commitQueuedSend = useCallback(async (queueId: number, subject: string) => {
    try {
      await processSendQueue();
      setStatusMessage(`"${subject || "(no subject)"}" sent.`);
    } catch (e) {
      setStatusMessage(String(e));
    } finally {
      setUndoSend((prev) => (prev && prev.queueId === queueId ? null : prev));
    }
  }, []);

  const startUndoWindow = useCallback((queueId: number, subject: string) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoSend({ queueId, subject });
    setStatusMessage("Sending…");
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
      void commitQueuedSend(queueId, subject);
    }, UNDO_WINDOW_MS);
  }, [commitQueuedSend]);

  const handleUndoSend = useCallback(async () => {
    const current = undoSend;
    if (!current) return;
    const { queueId, subject } = current;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    try {
      const canceled = await cancelSend(queueId);
      if (canceled) {
        setStatusMessage(`"${subject || "(no subject)"}" — send canceled, saved to Drafts.`);
      } else {
        setStatusMessage("Couldn't cancel — message already sending.");
      }
    } catch (e) {
      setStatusMessage(String(e));
    } finally {
      setUndoSend(null);
    }
  }, [undoSend]);

  const handleSend = async (params: {
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
  }) => {
    setSending(true);
    setStatusMessage(null);
    try {
      if (online) {
        if (undoSend) {
          if (undoTimerRef.current) {
            clearTimeout(undoTimerRef.current);
            undoTimerRef.current = null;
          }
          await processSendQueue().catch(console.error);
          setUndoSend(null);
        }
        const queueId = await queueEmail({ ...params, deferSeconds: UNDO_WINDOW_MS / 1000 });
        closeComposeAfterSend();
        startUndoWindow(queueId, params.subject);
      } else {
        await queueEmail(params);
        setStatusMessage("Offline — email queued for later.");
        const items = await getSendQueue();
        setPendingQueueCount(items.filter((i) => i.status === "pending").length);
        closeComposeAfterSend();
      }
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
    try {
      await archiveEmail(emailId).catch(console.error);
      if (threadId) {
        const remaining = await getEmails(threadId).catch(() => []);
        if (selectedThreadRef.current !== threadId) return;
        if (remaining.length === 0) {
          setThreads((prev) => prev.filter((t) => t.id !== threadId));
          setSelectedThread(null);
          selectedThreadRef.current = null;
          setSelectedEmail(null);
          setEmails([]);
        } else {
          setEmails(remaining);
          setSelectedEmail(remaining[remaining.length - 1].id);
        }
      }
    } finally {
      setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(emailId); return n; });
      setBusyThreadIds((prev) => { const n = new Set(prev); if (threadId) n.delete(threadId); return n; });
      loadThreads();
    }
  }, [selectedThread, loadThreads]);

  const handleDelete = useCallback(async (emailId: number) => {
    const threadId = selectedThread;
    if (threadId) setBusyThreadIds((prev) => new Set(prev).add(threadId));
    setBusyEmailIds((prev) => new Set(prev).add(emailId));
    try {
      await deleteEmail(emailId).catch(console.error);
      if (threadId) {
        const remaining = await getEmails(threadId).catch(() => []);
        if (selectedThreadRef.current !== threadId) return;
        if (remaining.length === 0) {
          setThreads((prev) => prev.filter((t) => t.id !== threadId));
          setSelectedThread(null);
          selectedThreadRef.current = null;
          setSelectedEmail(null);
          setEmails([]);
        } else {
          setEmails(remaining);
          setSelectedEmail(remaining[remaining.length - 1].id);
        }
      }
    } finally {
      setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(emailId); return n; });
      setBusyThreadIds((prev) => { const n = new Set(prev); if (threadId) n.delete(threadId); return n; });
      loadThreads();
    }
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
    setInlineReplyQuoteHtml(buildReplyQuoteBody(email));
    setShowInlineReply(true);
  }, []);

  const selfAddress = useCallback(
    (email: Email): string => {
      const acct = accounts.find((a) => a.id === email.account_id);
      return (acct?.email_address || "").toLowerCase();
    },
    [accounts],
  );

  const openReplyAllComposer = useCallback(
    (email: Email) => {
      const self = selfAddress(email);
      const fromAddrs = email.from.map((a) => a.address);
      const toAddrs = email.to.map((a) => a.address);
      const recipients = [...fromAddrs, ...toAddrs]
        .filter((addr) => addr.toLowerCase() !== self)
        .filter((addr, idx, arr) => arr.indexOf(addr) === idx);
      const replyCc = (email.cc || [])
        .map((a) => a.address)
        .filter((addr) => addr.toLowerCase() !== self)
        .filter((addr, idx, arr) => arr.indexOf(addr) === idx)
        .join(", ");
      const replySubject = email.subject
        ? email.subject.startsWith("Re:") || email.subject.startsWith("re:")
          ? email.subject
          : `Re: ${email.subject}`
        : "";
      setInlineReplyTo(recipients.join(", "));
      setInlineReplyCc(replyCc);
      setInlineReplySubject(replySubject);
      setInlineReplyInReplyTo(email.message_id);
      setInlineReplyReferences(
        [...(email.references || []), email.message_id].filter(Boolean),
      );
      setInlineReplyQuoteHtml(buildReplyQuoteBody(email));
      setShowInlineReply(true);
    },
    [selfAddress],
  );

  const openForwardComposer = useCallback(
    (email: Email) => {
      const fwdSubject = email.subject
        ? email.subject.startsWith("Fwd:") || email.subject.startsWith("fwd:")
          ? email.subject
          : `Fwd: ${email.subject}`
        : "";
      setComposeTo("");
      setComposeCc("");
      setComposeSubject(fwdSubject);
      setComposeBodyHtml(buildForwardBody(email));
      setComposeInReplyTo(undefined);
      setComposeReferences(undefined);
      setAiDraftBody(null);
      setShowInlineReply(false);
      setComposing(true);
    },
    [],
  );

  const openNewComposer = useCallback(() => {
    setComposeTo("");
    setComposeCc("");
    setComposeSubject("");
    setComposeBodyHtml(undefined);
    setComposeInReplyTo(undefined);
    setComposeReferences(undefined);
    setAiDraftBody(null);
    setShowInlineReply(false);
    setComposing(true);
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      const count = await markAllRead({
        accountId: selectedAccount || undefined,
        folder: selectedFolder || undefined,
      });
      setThreads((prev) => prev.map((t) => ({ ...t, is_read: true })));
      if (count > 0) {
        setStatusMessage(`Marked ${count} email${count === 1 ? "" : "s"} as read.`);
      } else {
        setStatusMessage("No unread emails.");
      }
    } catch (e) {
      setStatusMessage(String(e));
    }
  }, [selectedAccount, selectedFolder]);

  const handlePaletteSelectThread = useCallback(
    (thread: Thread) => {
      navigate("/");
      setSelectedThread(thread.id);
      selectedThreadRef.current = thread.id;
      handleSelectThread(thread);
    },
    [navigate, handleSelectThread],
  );

  const handlePaletteSelectAccount = useCallback(
    (account: Account) => {
      navigate("/");
      setSelectedAccount(account.id);
    },
    [navigate],
  );

  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "compose",
        label: "New compose",
        hint: "⌘N",
        icon: PenSquare,
        run: () => openNewComposer(),
      },
      {
        id: "sync",
        label: "Sync mail",
        hint: "Refresh now",
        icon: RefreshCw,
        run: () => void handleSync(),
      },
      {
        id: "settings",
        label: "Settings",
        icon: Settings,
        run: () => navigate("/settings"),
      },
      {
        id: "mark-all-read",
        label: "Mark all as read",
        icon: MailOpen,
        run: () => void handleMarkAllRead(),
      },
      {
        id: "archive-selected",
        label: "Archive selected email",
        icon: Archive,
        disabled: !selectedEmailData,
        run: () => {
          if (selectedEmailData) void handleArchive(selectedEmailData.id);
        },
      },
    ],
    [openNewComposer, handleSync, navigate, handleMarkAllRead, selectedEmailData, handleArchive],
  );

  const handleSummarize = async () => {
    if (!selectedThread || !aiConfig || emails.length === 0) return;
    const threadId = selectedThread;
    resetAiStream();
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    setAiSummary("");
    setAiSummaryThinking("");

    try {
      const hydrated = await hydrateEmailBodies(emails);
      if (selectedThreadRef.current !== threadId) return;
      setEmails(hydrated);
      const emailIds = hydrated.map((e) => e.id);
      const streamId = crypto.randomUUID();
      activeStreamIdRef.current = streamId;
      activeStreamKindRef.current = "summary";
      await streamSummarizeThread(streamId, threadId, emailIds, aiTone);
    } catch (e) {
      setAiSummaryError(String(e));
      setAiSummaryLoading(false);
      resetAiStream();
    }
  };

  const runDraftReply = async (summary?: string) => {
    if (!selectedThread || !lastEmail || !aiConfig || emails.length === 0) return;
    const threadId = selectedThread;
    resetAiStream();
    setAiDraftError(null);
    setAiReplyBody("");
    setAiReplyThinking("");
    openReplyComposer(lastEmail);
    setReplyEditorKey("drafting");
    setAiDraftLoading(true);

    try {
      const hydrated = await hydrateEmailBodies(emails);
      if (selectedThreadRef.current !== threadId) return;
      setEmails(hydrated);
      const emailIds = hydrated.map((e) => e.id);
      const streamId = crypto.randomUUID();
      activeStreamIdRef.current = streamId;
      activeStreamKindRef.current = "reply";
      await streamDraftReply(streamId, selectedThread, emailIds, aiTone, summary);
    } catch (e) {
      setAiDraftError(String(e));
      setStatusMessage(String(e));
      setAiDraftLoading(false);
      resetAiStream();
    }
  };

  const handleDraftReply = () => {
    void runDraftReply();
  };

  const handleDraftReplyWithSummary = () => {
    if (!aiSummary) return;
    void runDraftReply(aiSummary);
  };

  const handleForwardSummary = useCallback(() => {
    if (!aiSummary) return;
    const base = lastEmail ?? emails[emails.length - 1];
    const fwdSubject = base?.subject
      ? base.subject.startsWith("Fwd:") || base.subject.startsWith("fwd:")
        ? base.subject
        : `Fwd: ${base.subject}`
      : "";
    const summaryHtml = plainTextToHtml(aiSummary);
    const quote = base ? buildReplyQuoteBody(base) : "";
    const body = quote ? `${summaryHtml}<br>${quote}` : summaryHtml;
    setComposeTo("");
    setComposeCc("");
    setComposeSubject(fwdSubject);
    setComposeBodyHtml(body);
    setComposeInReplyTo(undefined);
    setComposeReferences(undefined);
    setAiDraftBody(null);
    setShowInlineReply(false);
    setComposing(true);
  }, [aiSummary, lastEmail, emails]);

  const handleSendSummaryAsNew = useCallback(() => {
    if (!aiSummary) return;
    const base = lastEmail ?? emails[emails.length - 1];
    const subject = base?.subject ? `Summary: ${base.subject}` : "Summary";
    setComposeTo("");
    setComposeCc("");
    setComposeSubject(subject);
    setComposeBodyHtml(plainTextToHtml(aiSummary));
    setComposeInReplyTo(undefined);
    setComposeReferences(undefined);
    setAiDraftBody(null);
    setShowInlineReply(false);
    setComposing(true);
  }, [aiSummary, lastEmail, emails]);

  const handleCopySummary = useCallback(() => {
    if (!aiSummary) return;
    navigator.clipboard?.writeText(aiSummary).catch(() => {});
  }, [aiSummary]);

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
            try {
              for (const em of fetched) {
                setBusyEmailIds((prev) => new Set(prev).add(em.id));
                await archiveEmail(em.id).catch(console.error);
                setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(em.id); return n; });
              }
              if (selectedThreadRef.current === thread.id) {
                setSelectedThread(null);
                selectedThreadRef.current = null;
                setSelectedEmail(null);
                setEmails([]);
              }
            } finally {
              setBusyThreadIds((prev) => { const n = new Set(prev); n.delete(thread.id); return n; });
              loadThreads();
            }
          },
        },
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          onClick: async () => {
            setBusyThreadIds((prev) => new Set(prev).add(thread.id));
            const fetched = await getEmails(thread.id).catch(() => []);
            try {
              for (const em of fetched) {
                setBusyEmailIds((prev) => new Set(prev).add(em.id));
                await deleteEmail(em.id).catch(console.error);
                setBusyEmailIds((prev) => { const n = new Set(prev); n.delete(em.id); return n; });
              }
              if (selectedThreadRef.current === thread.id) {
                setSelectedThread(null);
                selectedThreadRef.current = null;
                setSelectedEmail(null);
                setEmails([]);
              }
            } finally {
              setBusyThreadIds((prev) => { const n = new Set(prev); n.delete(thread.id); return n; });
              loadThreads();
            }
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
          label: "Reply",
          icon: <Reply className="h-3.5 w-3.5" />,
          onClick: () => {
            setEmails((prev) => prev.map((em) => em.id === email.id ? { ...em } : em));
            setSelectedEmail(email.id);
            const replyTo = email.from.map((a) => a.address).join(", ");
            const replyCc = email.cc?.map((a) => a.address).join(", ") || "";
            const replySubject = email.subject
              ? email.subject.startsWith("Re:") || email.subject.startsWith("re:")
                ? email.subject
                : `Re: ${email.subject}`
              : "";
            setReplyEditorKey(`manual-${Date.now()}`);
            setInlineReplyTo(replyTo);
            setInlineReplyCc(replyCc);
            setInlineReplySubject(replySubject);
            setInlineReplyInReplyTo(email.message_id);
            setInlineReplyReferences(
              [...(email.references || []), email.message_id].filter(Boolean),
            );
            setInlineReplyQuoteHtml(buildReplyQuoteBody(email));
            setShowInlineReply(true);
          },
        },
        {
          label: "Reply All",
          icon: <ReplyAll className="h-3.5 w-3.5" />,
          onClick: () => openReplyAllComposer(email),
        },
        {
          label: "Forward",
          icon: <Forward className="h-3.5 w-3.5" />,
          onClick: () => openForwardComposer(email),
        },
        { separator: true },
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
            const newRead = !email.is_read;
            await markRead(email.id, newRead).catch(console.error);
            setEmails((prev) => prev.map((em) => em.id === email.id ? { ...em, is_read: newRead } : em));
            setThreads((prev) => prev.map((t) => {
              if (t.id !== email.thread_id) return t;
              if (!newRead) return { ...t, is_read: false };
              const allRead = emails.every((em) => em.id === email.id ? newRead : em.is_read);
              return { ...t, is_read: allRead };
            }));
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
    [ctxMenu, aiConfig, online, handleChatAbout, handleArchive, handleDelete, openReplyAllComposer, openForwardComposer],
  );

  kbStateRef.current = {
    threads, selectedThread, selectedEmailData, composing, showInlineReply,
    aiDraftLoading, aiSummaryLoading, aiConfig, handleManualReply, openNewComposer,
    handleSelectThread, handleSummarize, handleArchive, handleDelete,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const s = kbStateRef.current;
      if (s.composing || s.showInlineReply || s.aiDraftLoading || s.aiSummaryLoading) return;

      const threads = s.threads as Thread[];
      const selectedThread = s.selectedThread as number | null;
      const selectedEmailData = s.selectedEmailData as Email | null;
      const aiConfig = s.aiConfig as unknown;
      const handleSelectThread = s.handleSelectThread as (t: Thread) => void;
      const handleManualReply = s.handleManualReply as () => void;
      const openNewComposer = s.openNewComposer as () => void;
      const handleSummarize = s.handleSummarize as () => void;
      const handleArchive = s.handleArchive as (id: number) => void;
      const handleDelete = s.handleDelete as (id: number) => void;

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
        openNewComposer();
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
  }, []);

  return (
    <div className="flex h-full">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        accounts={accounts}
        recentThreads={threads}
        actions={paletteActions}
        onSelectThread={handlePaletteSelectThread}
        onSelectAccount={handlePaletteSelectAccount}
      />
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
                title={account.sync_error ?? undefined}
                className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md whitespace-nowrap transition-colors ${
                  selectedAccount === account.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {account.sync_error && (
                  <span
                    title={account.sync_error}
                    className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0"
                  />
                )}
                {account.email_address !== "unknown@unknown.com"
                  ? account.email_address
                  : account.display_name}
              </button>
            ))}
          </div>
        )}

        {/* Folder filter */}
        {folders.length > 1 && (
          <div className="flex gap-1 px-2 py-1.5 border-b border-border overflow-x-auto scrollbar-none">
            <button
              onClick={() => setSelectedFolder(null)}
              className={`px-2 py-0.5 text-[11px] rounded-md whitespace-nowrap transition-colors ${
                selectedFolder === null
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              All
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setSelectedFolder(folder.imap_name)}
                className={`px-2 py-0.5 text-[11px] rounded-md whitespace-nowrap transition-colors ${
                  selectedFolder === folder.imap_name
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {folder.name}
              </button>
            ))}
          </div>
        )}

        {/* Thread items */}
        <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col">
          {isSearching ? (
            searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Search className="h-5 w-5 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No results</p>
              </div>
            ) : (
              searchResults.map((thread) => {
                const selected = selectedThread === thread.id;
                return (
                  <div
                    key={thread.id}
                    onClick={() => handleSelectThread(thread)}
                    className={`relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors group ${
                      selected ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    {selected && (
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {!thread.is_read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-ai shrink-0" />
                        )}
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
            <VirtualizedThreadList
              threads={threads}
              selectedThreadId={selectedThread}
              busyThreadIds={busyThreadIds}
              onSelectThread={handleSelectThread}
              onContextMenu={handleThreadContextMenu}
              hasMore={hasMoreThreads}
              onLoadMore={loadMoreThreads}
              loadingMore={loadingMore}
              active={active}
            />
          )}
        </div>
      </div>

      {/* Reading pane / Compose */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {showQueue && <SendQueuePanel onClose={() => setShowQueue(false)} />}
        {composing ? (
          <ComposeEditor
            accountId={selectedAccount || accounts[0]?.id || 0}
            to={composeTo}
            cc={composeCc}
            bcc=""
            subject={composeSubject}
            initialBodyHtml={composeBodyHtml ?? aiDraftBody ?? undefined}
            inReplyTo={composeInReplyTo}
            references={composeReferences}
            aiEnabled={!!aiConfig && online}
            aiTone={aiTone}
            onSend={handleSend}
            onCancel={() => {
              setComposing(false);
              setAiDraftBody(null);
              setComposeBodyHtml(undefined);
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
                <>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openReplyAllComposer(lastEmail)}
                    disabled={aiSummaryLoading || aiDraftLoading}
                    className="h-8 text-xs gap-1.5"
                    title="Reply to all recipients"
                  >
                    <ReplyAll className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openForwardComposer(lastEmail)}
                    disabled={aiSummaryLoading || aiDraftLoading}
                    className="h-8 text-xs gap-1.5"
                    title="Forward"
                  >
                    <Forward className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={openNewComposer}
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
                          : inlineReplyQuoteHtml
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
                  onForwardSummary={handleForwardSummary}
                  onSendAsNew={handleSendSummaryAsNew}
                  onReplyWithSummary={handleDraftReplyWithSummary}
                  onCopySummary={handleCopySummary}
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
                onClick={openNewComposer}
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

      {undoSend && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-foreground px-4 py-2.5 shadow-lg text-background text-sm animate-in fade-in slide-in-from-bottom-2">
          <span className="truncate max-w-[260px]">
            Sending &ldquo;{undoSend.subject || "(no subject)"}&rdquo;…
          </span>
          <button
            type="button"
            onClick={handleUndoSend}
            className="font-medium underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
