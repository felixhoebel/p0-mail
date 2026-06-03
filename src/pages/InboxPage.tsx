import { useState, useEffect, useCallback } from "react";
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
  summarizeThread,
  draftReply,
} from "@/lib/api";
import type { Account, Thread, Email, SendQueueItem, AiConfig, AiTone } from "@/types";
import EmailViewer from "@/components/email/EmailViewer";
import ComposeEditor from "@/components/email/ComposeEditor";
import { getEmails } from "@/lib/api";

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
  const [aiLoading, setAiLoading] = useState(false);

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
      setComposing(false);
    } catch (e) {
      setStatusMessage(String(e));
    } finally {
      setSending(false);
    }
  };

  const selectedEmailData = emails.find((e) => e.id === selectedEmail);

  const handleSummarize = async () => {
    if (!selectedThread) return;
    setAiLoading(true);
    setAiSummary(null);
    try {
      const tone = aiConfig?.default_tone || "Professional";
      const result = await summarizeThread(selectedThread, tone as AiTone);
      setAiSummary(result);
    } catch (e) {
      setAiSummary(`Error: ${e}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleDraftReply = async () => {
    if (!selectedThread) return;
    setAiLoading(true);
    try {
      const tone = aiConfig?.default_tone || "Professional";
      const result = await draftReply(selectedThread, tone as AiTone);
      setComposing(true);
      setAiDraftBody(result);
    } catch (e) {
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  };

  const [aiDraftBody, setAiDraftBody] = useState<string | null>(null);

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
            <span className="text-xs text-muted-foreground">·</span>
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
                <p className="text-sm truncate">
                  {thread.subject || "(no subject)"}
                </p>
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
              {aiConfig && online && selectedThread && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSummarize}
                    disabled={aiLoading}
                  >
                    {aiLoading && !aiSummary ? "..." : "Summarize"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDraftReply}
                    disabled={aiLoading}
                  >
                    AI Reply
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setComposing(true)}
              >
                Compose
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {aiSummary && (
                <div className="border-b border-border p-3 bg-accent/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">AI Summary</span>
                    <button
                      onClick={() => setAiSummary(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{aiSummary}</div>
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
