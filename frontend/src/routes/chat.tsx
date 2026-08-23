import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, pct } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip, ErrorNote, Loading } from "@/components/pf";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Assistant — PathFinder" },
      { name: "description", content: "Ask about your path, your gaps and what to study next." },
      { property: "og:title", content: "Assistant — PathFinder" },
      { property: "og:description", content: "A learning assistant that knows your active path." },
    ],
  }),
  component: ChatPage,
});

type Msg = {
  role: "user" | "assistant";
  content: string;
  intent?: string;
  intent_confidence?: number;
  source?: string;
  suggestions?: string[];
};

type ChatReply = {
  reply?: string;
  intent?: string;
  intent_confidence?: number;
  source?: string;
  suggestions?: string[];
};

type HistoryItem = { role?: string; content?: string; message?: string; reply?: string };

function ChatPage() {
  const { ready, authed } = useRequireAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const sessionId = useMemo(() => {
    if (typeof window === "undefined") return "";
    const key = "pf_chat_session";
    let s = window.localStorage.getItem(key);
    if (!s) {
      s = crypto.randomUUID();
      window.localStorage.setItem(key, s);
    }
    return s;
  }, []);

  const history = useQuery({
    queryKey: ["chat-history"],
    queryFn: () => api<{ history?: HistoryItem[] } | HistoryItem[]>("/api/chat/history"),
    enabled: ready && authed,
    retry: false,
  });

  const activePath = useQuery({
    queryKey: ["active-path"],
    queryFn: () =>
      api<{
        title?: string;
        tracks?: string[];
        estimated_weeks?: number;
        // No top-level progress field — derived below from each item's status.
        items?: { status?: string }[];
      }>("/api/paths/active"),
    enabled: ready && authed,
    retry: false,
  });
  const pathItems = activePath.data?.items ?? [];
  const pathProgress = pathItems.length
    ? pathItems.filter((i) => i.status === "completed").length / pathItems.length
    : undefined;

  useEffect(() => {
    const raw = Array.isArray(history.data) ? history.data : history.data?.history;
    if (!raw) return;
    setMessages(
      raw.map((h) => ({
        role: h.role === "user" ? "user" : "assistant",
        content: h.content ?? h.message ?? h.reply ?? "",
      })),
    );
  }, [history.data]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const r = await api<ChatReply>("/api/chat", {
        method: "POST",
        body: { message, session_id: sessionId },
      });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: r.reply ?? "",
          intent: r.intent,
          intent_confidence: r.intent_confidence,
          source: r.source,
          suggestions: r.suggestions,
        },
      ]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await api("/api/chat/history", { method: "DELETE" });
      setMessages([]);
    } catch (err) {
      setError(err);
    }
  };

  const last = messages[messages.length - 1];

  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-h-[70vh] flex-col">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Assistant</h1>
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
          </div>

          <div className="flex-1 space-y-6">
            {history.isLoading ? <Loading label="Loading history…" /> : null}
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div className="max-w-[42rem] space-y-2">
                  <div
                    className={
                      m.role === "user"
                        ? "rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground"
                        : "rounded-2xl border border-border bg-card px-4 py-3 text-sm"
                    }
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  </div>
                  {m.role === "assistant" && (m.intent || m.source) ? (
                    <p className="text-xs text-muted-foreground">
                      {[
                        m.intent,
                        m.intent_confidence !== undefined ? pct(m.intent_confidence) : null,
                        m.source,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            {busy ? <Loading label="Thinking…" /> : null}
            {error ? <ErrorNote error={error} /> : null}
            <div ref={bottom} />
          </div>

          {last?.role === "assistant" && last.suggestions?.length ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {last.suggestions.map((s) => (
                <Chip key={s} onClick={() => send(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          ) : null}

          <form
            className="mt-6 flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your path…"
            />
            <Button type="submit" disabled={busy || !input.trim()}>
              Send
            </Button>
          </form>
        </div>

        <aside className="space-y-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Active path</p>
          <div className="rounded-xl border border-border bg-card p-5">
            {activePath.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : activePath.data?.title ? (
              <>
                <p className="text-sm font-medium">{activePath.data.title}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {activePath.data.tracks?.join(" · ") || "—"}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Progress {pct(pathProgress)}
                  {activePath.data.estimated_weeks
                    ? ` · ${activePath.data.estimated_weeks} weeks`
                    : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No active path.</p>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
