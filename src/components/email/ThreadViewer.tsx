import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import EmailViewer from "@/components/email/EmailViewer";
import ComposeEditor from "@/components/email/ComposeEditor";
import { getEmails, markRead, sendEmail } from "@/lib/api";
import type { Email } from "@/types";

interface ThreadViewerProps {
  threadId: number;
  accountId: number;
  onClose: () => void;
}

export default function ThreadViewer({
  threadId,
  accountId,
  onClose,
}: ThreadViewerProps) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState<"reply" | "forward" | null>(null);
  const [replyTo, setReplyTo] = useState<Email | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    getEmails(threadId)
      .then((list) => {
        setEmails(list);
        if (list.length > 0 && !list[list.length - 1].is_read) {
          markRead(list[list.length - 1].id, true).catch(console.error);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [threadId]);

  const handleReply = useCallback((email: Email) => {
    setReplyTo(email);
    setComposing("reply");
  }, []);

  const handleForward = useCallback((email: Email) => {
    setReplyTo(email);
    setComposing("forward");
  }, []);

  const handleSend = useCallback(
    async (params: {
      accountId: number;
      to: string;
      cc: string;
      bcc: string;
      subject: string;
      bodyHtml: string;
      bodyText: string;
      attachments?: import("@/types").AttachmentPayload[];
      inReplyTo?: string;
      references?: string[];
    }) => {
      setSending(true);
      try {
        await sendEmail(params);
        setComposing(null);
        setReplyTo(null);
      } catch (e) {
        console.error(e);
      } finally {
        setSending(false);
      }
    },
    [],
  );

  const lastEmail = emails[emails.length - 1];
  const replySubject = replyTo
    ? replyTo.subject?.startsWith("Re: ")
      ? replyTo.subject
      : `Re: ${replyTo.subject || ""}`
    : "";
  const forwardSubject = replyTo
    ? `Fwd: ${replyTo.subject || ""}`
    : "";

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (composing && replyTo) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <ComposeEditor
          accountId={accountId}
          to={composing === "reply" ? replyTo.from[0]?.address || "" : ""}
          cc={composing === "reply" ? replyTo.to.map((a) => a.address).join(", ") : ""}
          bcc=""
          subject={composing === "reply" ? replySubject : forwardSubject}
          inReplyTo={composing === "reply" ? replyTo.message_id : undefined}
          references={
            composing === "reply"
              ? [
                  ...(replyTo.references || []),
                  replyTo.message_id,
                ]
              : undefined
          }
          onSend={handleSend}
          onCancel={() => {
            setComposing(null);
            setReplyTo(null);
          }}
          sending={sending}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-4 py-2 flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back
        </Button>
        {lastEmail && (
          <div className="flex gap-1 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleReply(lastEmail)}
            >
              Reply
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleForward(lastEmail)}
            >
              Forward
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {emails.map((email, idx) => (
          <div key={email.id} className={idx > 0 ? "border-t border-border" : ""}>
            <EmailViewer email={email} />
          </div>
        ))}
      </div>
    </div>
  );
}
