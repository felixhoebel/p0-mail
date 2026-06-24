import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, X, Loader2, Send, MessageSquare } from "lucide-react";
import {
  streamChatAboutEmails,
  onAiStream,
  onAiStreamError,
  type ChatMessage,
} from "@/lib/api";
import type { AiTone, Email } from "@/types";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface EmailChatPanelProps {
  emailIds: number[];
  emails: Email[];
  tone: AiTone;
  onClose: () => void;
}

export default function EmailChatPanel({
  emailIds,
  emails,
  tone,
  onClose,
}: EmailChatPanelProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let unlistenStream: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    (async () => {
      [unlistenStream, unlistenError] = await Promise.all([
        onAiStream((event) => {
          if (event.streamId !== streamIdRef.current) return;
          if (event.done) {
            setStreaming(false);
            streamIdRef.current = null;
            return;
          }
          if (event.tokenKind === "content") {
            setTurns((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: last.content + event.token }];
              }
              return [...prev, { role: "assistant", content: event.token }];
            });
          }
        }),
        onAiStreamError((event) => {
          if (event.streamId !== streamIdRef.current) return;
          setError(event.token);
          setStreaming(false);
          streamIdRef.current = null;
        }),
      ]);
    })();

    return () => {
      unlistenStream?.();
      unlistenError?.();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming || emailIds.length === 0) return;

    setError(null);
    setInput("");

    const history: ChatMessage[] = turns.map((t) => ({
      role: t.role,
      content: t.content,
    }));

    setTurns((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setStreaming(true);

    const streamId = crypto.randomUUID();
    streamIdRef.current = streamId;

    try {
      await streamChatAboutEmails(streamId, emailIds, question, history, tone);
    } catch (e) {
      setError(String(e));
      setStreaming(false);
      streamIdRef.current = null;
      setTurns((prev) => {
        if (prev.length >= 2 && prev[prev.length - 1]?.role === "assistant" && prev[prev.length - 1]?.content === "") {
          return prev.slice(0, -2);
        }
        return prev;
      });
    }
  }, [input, streaming, emailIds, turns, tone]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const subjectPreview = emails
    .map((e) => e.subject || "(no subject)")
    .slice(0, 2)
    .join(", ");

  return (
    <aside className="flex h-full w-[min(100%,24rem)] shrink-0 flex-col border-l border-border bg-sidebar animate-fade-in">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai/10 text-ai">
            <MessageSquare className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground leading-tight">Chat</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {emailIds.length} email{emailIds.length !== 1 ? "s" : ""} · {subjectPreview}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close chat"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
        <div className="p-4 space-y-3">
          {turns.length === 0 && !error && (
            <div className="text-center py-8">
              <Sparkles className="h-5 w-5 text-ai/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Ask anything about these emails</p>
              <div className="mt-3 space-y-1.5">
                {["Summarize the key points", "What needs my response?", "Extract action items"].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="block w-full text-left text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, i) => (
            <div
              key={i}
              className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                  turn.role === "user"
                    ? "bg-ai/10 text-foreground"
                    : "bg-muted/50 text-foreground/90"
                }`}
              >
                {turn.content}
                {streaming && i === turns.length - 1 && turn.role === "assistant" && (
                  <span className="inline-block w-0.5 h-3.5 bg-ai/80 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            </div>
          ))}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="text-xs text-destructive leading-relaxed">{error}</p>
              <button
                onClick={() => setError(null)}
                className="mt-1.5 text-[11px] text-destructive/70 hover:text-destructive"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about these emails…"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ai/30 max-h-32"
            style={{ minHeight: "36px" }}
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="flex shrink-0 items-center justify-center rounded-lg bg-ai text-white h-9 w-9 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ai/90 transition-colors"
            aria-label="Send message"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/50">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </aside>
  );
}
