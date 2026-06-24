import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { Sparkles, Loader2 } from "lucide-react";
import { streamAiTransform, onAiStream, onAiStreamError } from "@/lib/api";
import type { AiTone } from "@/types";
import { plainTextToHtml } from "@/lib/plainTextToHtml";

type Instruction = "polish" | "shorten" | "expand" | "friendly" | "professional" | "concise";

const ACTIONS: { id: Instruction; label: string }[] = [
  { id: "polish", label: "Polish" },
  { id: "shorten", label: "Shorten" },
  { id: "expand", label: "Expand" },
  { id: "friendly", label: "Friendly" },
  { id: "professional", label: "Professional" },
  { id: "concise", label: "Concise" },
];

interface AiInlineToolbarProps {
  editor: Editor | null;
  subject: string;
  tone: AiTone;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export default function AiInlineToolbar({ editor, subject, tone, disabled, onBusyChange }: AiInlineToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [transforming, setTransforming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamIdRef = useRef<string | null>(null);
  const startPosRef = useRef(0);
  const originalToRef = useRef(0);
  const accumRef = useRef("");
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!editor) return;

    const updatePosition = () => {
      if (transforming) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setVisible(false);
        setError(null);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, "\n");
      if (text.trim().length < 2) {
        setVisible(false);
        return;
      }
      const coords = editor.view.coordsAtPos(to);
      setPos({
        top: coords.top,
        left: (coords.left + coords.right) / 2,
      });
      setVisible(true);
    };

    const handleBlur = () => {
      if (!transforming) setVisible(false);
    };

    editor.on("selectionUpdate", updatePosition);
    editor.on("blur", handleBlur);

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("blur", handleBlur);
    };
  }, [editor, transforming]);

  useEffect(() => {
    if (!editor) return;

    let unlistenStream: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      [unlistenStream, unlistenError] = await Promise.all([
        onAiStream((event) => {
          if (event.streamId !== streamIdRef.current) return;
          if (event.done) {
            setTransforming(false);
            onBusyChange?.(false);
            streamIdRef.current = null;
            setVisible(false);
            return;
          }
          if (event.tokenKind === "thinking") return;

          accumRef.current += event.token;

          if (!hasStartedRef.current) {
            hasStartedRef.current = true;
            editor
              .chain()
              .focus()
              .deleteRange({
                from: startPosRef.current,
                to: originalToRef.current,
              })
              .run();
          }

          const currentTo = editor.state.selection.to;
          editor
            .chain()
            .deleteRange({ from: startPosRef.current, to: currentTo })
            .insertContent(plainTextToHtml(accumRef.current))
            .run();
        }),
        onAiStreamError((event) => {
          if (event.streamId !== streamIdRef.current) return;
          setError(event.token);
          setTransforming(false);
          onBusyChange?.(false);
          streamIdRef.current = null;
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
  }, [editor]);

  const handleAction = useCallback(
    (instruction: Instruction) => {
      if (!editor || transforming || disabled) return;

      const { from, to, empty } = editor.state.selection;
      if (empty) return;

      const selectedText = editor.state.doc.textBetween(from, to, "\n");
      if (selectedText.trim().length < 2) return;

      setError(null);
      setTransforming(true);
      onBusyChange?.(true);
      startPosRef.current = from;
      originalToRef.current = to;
      accumRef.current = "";
      hasStartedRef.current = false;

      const streamId = crypto.randomUUID();
      streamIdRef.current = streamId;

      streamAiTransform(streamId, instruction, subject, selectedText, tone).catch((e) => {
        setError(String(e));
        setTransforming(false);
        onBusyChange?.(false);
        streamIdRef.current = null;
      });
    },
    [editor, transforming, disabled, subject, tone, onBusyChange],
  );

  if (!visible || !editor) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        transform: "translate(-50%, calc(-100% - 8px))",
        zIndex: 50,
      }}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-popover shadow-lg shadow-black/5 px-1 py-1 animate-fade-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      {transforming ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ai" />
          <span className="text-[11px] text-muted-foreground">Transforming…</span>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-2.5 py-1">
          <span className="text-[11px] text-destructive truncate max-w-[220px]">{error}</span>
          <button
            onClick={() => {
              setError(null);
              setVisible(false);
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <span className="flex items-center px-1.5 text-ai">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="w-px h-4 bg-border mx-0.5" />
          <div className="flex items-center gap-0.5">
            {ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleAction(action.id)}
                className="px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors whitespace-nowrap"
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
