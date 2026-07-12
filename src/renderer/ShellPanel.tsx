import { Send, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ShellPanelProps = {
  containerId: string;
  running: boolean;
};

type OutputChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

// Line-buffered stdin/stdout streaming over `docker exec -i <id> sh` - no
// pty on either end, so this can't offer real interactive-terminal behavior
// (no job control, no cursor addressing). Curses-style programs (vim, top)
// won't render correctly. Good enough for running ordinary commands without
// leaving the app.
export function ShellPanel({ containerId, running }: ShellPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputChunk[]>([]);
  const [command, setCommand] = useState("");
  const [exitInfo, setExitInfo] = useState<number | null | undefined>(undefined);
  const [startError, setStartError] = useState<string | undefined>();
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!running) {
      return;
    }

    let cancelled = false;
    setOutput([]);
    setExitInfo(undefined);
    setStartError(undefined);

    const unsubscribeOutput = window.dockerExplorer.subscribeExecOutput((event) => {
      if (event.sessionId !== sessionIdRef.current) {
        return;
      }
      setOutput((current) => [...current, { stream: event.stream, text: event.chunk }]);
    });
    const unsubscribeExit = window.dockerExplorer.subscribeExecExit((event) => {
      if (event.sessionId !== sessionIdRef.current) {
        return;
      }
      setExitInfo(event.exitCode);
    });

    void window.dockerExplorer
      .startContainerExec(containerId)
      .then((id) => {
        if (cancelled) {
          void window.dockerExplorer.stopContainerExec(id);
          return;
        }
        sessionIdRef.current = id;
        setSessionId(id);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStartError(error instanceof Error ? error.message : "Failed to start shell session.");
        }
      });

    return () => {
      cancelled = true;
      unsubscribeOutput();
      unsubscribeExit();
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) {
        void window.dockerExplorer.stopContainerExec(activeSessionId);
      }
      sessionIdRef.current = null;
      setSessionId(null);
    };
  }, [containerId, running]);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [output]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!sessionId || command === "") {
      return;
    }
    setOutput((current) => [...current, { stream: "stdout", text: `$ ${command}\n` }]);
    void window.dockerExplorer.writeContainerExec(sessionId, `${command}\n`);
    setCommand("");
  }

  if (!running) {
    return (
      <section className="detail-stack">
        <div className="daemon-banner">
          <div className="daemon-banner__copy">
            <span className="status-dot status-dot--warning" />
            <span>This container is powered off - a shell needs a running container to exec into.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="detail-stack">
      {startError ? (
        <div className="error-banner error-banner--inline">
          <TriangleAlert size={16} />
          <span>{startError}</span>
        </div>
      ) : null}
      <div ref={consoleRef} className="log-console shell-console">
        {output.length === 0 && !startError ? (
          <div className="log-line">Connecting...</div>
        ) : (
          output.map((chunk, index) => (
            <pre key={index} className={`log-line shell-line shell-line--${chunk.stream}`}>
              {chunk.text}
            </pre>
          ))
        )}
        {exitInfo !== undefined ? (
          <div className="log-line shell-line--exit">
            <X size={12} /> Session ended{exitInfo !== null ? ` (exit ${exitInfo})` : ""}.
          </div>
        ) : null}
      </div>
      <form className="shell-input-row" onSubmit={handleSubmit}>
        <input
          className="shell-input"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={sessionId ? "Type a command and press Enter" : "Connecting..."}
          disabled={!sessionId || exitInfo !== undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="icon-button" disabled={!sessionId || exitInfo !== undefined} aria-label="Run command">
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}
