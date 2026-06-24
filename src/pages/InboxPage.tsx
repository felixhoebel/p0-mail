import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Loader2, Settings } from "lucide-react";
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
import {
  getAiActionLabels,
  getAiPanelLabels,
  getAiThinkingLabels,
  getComposePolishLabels,
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

function formatAddresses(addrs: { name: string; address: string }[]): string {
  return addrs
    .map((a) => a.name || a.address)
    .join(", ");
}

function LabelPill({ label }: { label: string }) {
  if (label === "\\Flagged") {
    return <span className="text-yellow-500 text-xs" title="Flagged">&#9733;</span>;
  }
  if (label === "\\Answered") {
    return (
      <span className="inline-flex items-center px-1 py-0 rounded text-[10px] font-medium bg-green-100 text-green-700" title="Answered">
        &#8617;
      </span>
    );
  }
  if (label === "\\Draft") {
    return (
      <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
        Draft
      </span>
    );
  }
  if (label === "\\Deleted") {
    return null;
  }
  if (label.startsWith("\\")) return null;
  return (
    <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
      {label}
    </span>
  );
}

function ThreadLabels({ thread }: { thread: Thread }) {
  if (!thread.is_flagged) return null;
  return <LabelPill label="\\Flagged" />;
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
    <div className="border-b border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Send Queue</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleProcess} disabled={processing}>
            {processing ? "Processing..." : "Retry All"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Queue is empty.</p>
      ) : (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-xs border rounded px-2 py-1"
            >
              <span className="truncate flex-1">{item.subject}</span>
              <span
                className={`ml-2 px-1 rounded text-[10px] ${
                  item.status === "sent"
                    ? "bg-green-100 text-green-800"
                    : item.status === "failed"
                      ? "bg-red-100 text-red-800"
                      : "bg-yellow-100 text-yellow-800"
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
}) {
  const [toVal, setToVal] = useState(to);
  const [ccVal, setCcVal] = useState(cc);
  const [subjectVal, setSubjectVal] = useState(subject);
  const [showCc, setShowCc] = useState(!!cc);

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
    <div className="border-t border-border bg-background">
      <div className="px-4 py-2 space-y-1.5 border-b border-border/60">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium w-12 shrink-0">Subject</label>
          <Input
            value={subjectVal}
            onChange={(e) => setSubjectVal(e.target.value)}
            placeholder="Re: …"
            className="h-7 text-sm flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium w-12 shrink-0">To</label>
          <Input
            value={toVal}
            onChange={(e) => setToVal(e.target.value)}
            placeholder="recipient@example.com"
            className="h-7 text-sm flex-1"
          />
          <button
            type="button"
            onClick={() => setShowCc(!showCc)}
            className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            {showCc ? "Hide CC" : "CC"}
          </button>
        </div>
        {showCc && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium w-12 shrink-0">Cc</label>
            <Input
              value={ccVal}
              onChange={(e) => setCcVal(e.target.value)}
              placeholder="cc@example.com"
              className="h-7 text-sm"
            />
          </div>
        )}
      </div>
      <div className="px-4 pb-2">
        <div className="relative border border-border rounded-md overflow-hidden min-h-[140px]">
          {generating && !streamingBody && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/85 backdrop-blur-[1px]">
              <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
              <span className="text-xs text-muted-foreground">Drafting reply…</span>
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
      <div className="px-4 pb-3 flex items-center gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={sending || generating}>
          Discard
        </Button>
        <Button
          size="sm"
          onClick={handleSend}
          disabled={sending || generating || !toVal || !subjectVal.trim()}
        >
          {sending ? "Sending..." : "Send"}
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

  const aiTone = (aiConfig?.default_tone || "Professional") as AiTone;
  const aiLanguage = aiConfig?.output_language || "en";
  const aiActionLabels = getAiActionLabels(aiLanguage);
  const aiPanelLabels = getAiPanelLabels(aiLanguage);
  const aiThinkingLabels = getAiThinkingLabels(aiLanguage);

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
        if (!list[list.length - 1].is_read) {
          markRead(focusId, true).catch(console.error);
        }
        for (const email of list) {
          if (!email.body_html && !email.body_text) {
            fetchEmailBody(email.id)
              .then(async () => {
                const updated = await getEmails(thread.id);
                setEmails(updated);
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

  return (
    <div className="flex h-full">
      {/* Thread list */}
      <div className="w-80 border-r border-border overflow-y-auto flex flex-col shrink-0">
        <div className="flex items-center gap-2 p-2 border-b border-border">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search emails..."
            className="h-7 text-sm flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "..." : "Sync"}
          </Button>
        </div>
        <div className="flex flex-col gap-1 px-2 py-1 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${online ? "bg-green-500" : "bg-red-500"}`}
              />
              {online ? "Online" : "Offline"}
            </span>
            <span className="text-xs text-muted-foreground">&#183;</span>
            <button
              type="button"
              onClick={() => setShowQueue(!showQueue)}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Outbox
              {pendingQueueCount > 0 ? ` (${pendingQueueCount})` : ""}
            </button>
          </div>
          {statusMessage && (
            <p className="text-xs text-muted-foreground break-words">{statusMessage}</p>
          )}
        </div>
        {accounts.length > 0 && (
          <div className="flex gap-1 p-1 border-b border-border overflow-x-auto">
            <button
              onClick={() => setSelectedAccount(null)}
              className={`px-2 py-1 text-xs rounded-md whitespace-nowrap ${
                selectedAccount === null
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              All
            </button>
            {accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => setSelectedAccount(account.id)}
                className={`px-2 py-1 text-xs rounded-md whitespace-nowrap ${
                  selectedAccount === account.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {account.email_address !== "unknown@unknown.com"
                  ? account.email_address
                  : account.display_name}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {isSearching ? (
            searchResults.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No results.</p>
            ) : (
              searchResults.map((email) => (
                <div
                  key={email.id}
                  onClick={() => {
                    setSelectedThread(email.thread_id);
                    setEmails([email]);
                    setSelectedEmail(email.id);
                    setIsSearching(false);
                  }}
                  className="px-3 py-2 border-b border-border cursor-pointer hover:bg-accent"
                >
                  <p className="text-sm truncate">
                    {email.subject || "(no subject)"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {formatAddresses(email.from)}
                  </p>
                </div>
              ))
            )
          ) : accounts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No accounts yet. Add one in Settings.
            </p>
          ) : threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No threads. Sync to fetch emails.
            </p>
          ) : (
            threads.map((thread) => (
              <div
                key={thread.id}
                onClick={() => handleSelectThread(thread)}
                className={`px-3 py-2 border-b border-border cursor-pointer hover:bg-accent ${
                  selectedThread === thread.id ? "bg-accent" : ""
                } ${!thread.is_read ? "font-medium" : ""}`}
              >
                <div className="flex items-center gap-1.5">
                  <ThreadLabels thread={thread} />
                  <p className="text-sm truncate flex-1">
                    {thread.subject || "(no subject)"}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {thread.message_count} msg
                    {thread.message_count !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(thread.latest_date)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Reading pane / Compose */}
      <div className="flex-1 flex flex-col overflow-hidden">
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
            outputLanguage={aiLanguage}
            polishLabels={getComposePolishLabels(aiLanguage)}
            onSend={handleSend}
            onCancel={() => {
              setComposing(false);
              setAiDraftBody(null);
            }}
            sending={sending}
          />
        ) : selectedEmailData ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b border-border px-4 py-1 flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (selectedEmailData)
                    archiveEmail(selectedEmailData.id).catch(console.error);
                }}
              >
                Archive
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (selectedEmailData)
                    deleteEmail(selectedEmailData.id).catch(console.error);
                }}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (selectedEmailData) {
                    markRead(selectedEmailData.id, !selectedEmailData.is_read).catch(
                      console.error,
                    );
                  }
                }}
              >
                {selectedEmailData.is_read ? "Unread" : "Read"}
              </Button>
              <div className="flex-1" />
              {!online && (
                <span className="text-xs text-yellow-600">Offline</span>
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
              {online && lastEmail && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleManualReply}
                  disabled={aiSummaryLoading || aiDraftLoading}
                >
                  Reply
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setComposing(true)}
              >
                Compose
              </Button>
            </div>
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto min-h-0">
                  {online && selectedThread && !aiConfig && (
                    <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-3 bg-muted/20">
                      <p className="text-sm text-muted-foreground">
                        Connect AI in Settings to summarize threads and draft replies.
                      </p>
                      <Link
                        to="/settings"
                        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300"
                      >
                        <Settings className="h-3.5 w-3.5" />
                        Settings
                      </Link>
                    </div>
                  )}
                  {emails.map((email, idx) => (
                    <div
                      key={email.id}
                      className={`${idx > 0 ? "border-t border-border" : ""} ${
                        email.id === selectedEmail
                          ? ""
                          : "cursor-pointer hover:bg-accent/50"
                      }`}
                      onClick={() => setSelectedEmail(email.id)}
                    >
                      <EmailViewer email={email} />
                    </div>
                  ))}
                </div>
                {showInlineReply && (
                  <div className="shrink-0 border-t border-border">
                    {aiDraftError && !aiDraftLoading && (
                      <div className="px-4 py-2 bg-destructive/5 text-sm text-destructive">
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
                    />
                  </div>
                )}
              </div>
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
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center space-y-2">
              <p>Select a thread to read</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setComposing(true)}
              >
                Compose
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
