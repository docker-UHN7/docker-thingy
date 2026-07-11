import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OperationState } from "./store";

type ValidateStatusPanelProps = {
  operation: OperationState | undefined;
};

function summarizeValidation(operation: OperationState): string {
  const serviceMentions = operation.lines.filter((line) => /service/i.test(line)).length;

  if (operation.status === "running") {
    return operation.lines.at(-1) ?? "Checking docker-compose.yml...";
  }

  if (operation.status === "success") {
    return `Valid${serviceMentions > 0 ? ` - ${serviceMentions} service checks completed` : " - no issues found"}`;
  }

  return operation.errorMessage ?? "Validation failed";
}

export function ValidateStatusPanel({ operation }: ValidateStatusPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissedOperationId, setDismissedOperationId] = useState<string | undefined>();

  useEffect(() => {
    if (!operation) {
      return;
    }

    if (operation.status === "running") {
      setDismissedOperationId(undefined);
      setExpanded(false);
      return;
    }

    if (operation.status === "success") {
      const timer = window.setTimeout(() => {
        setDismissedOperationId(operation.operationId || operation.startedAt);
      }, 3000);

      const dismissOnPointer = () => setDismissedOperationId(operation.operationId || operation.startedAt);
      window.addEventListener("pointerdown", dismissOnPointer, { once: true });

      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointerdown", dismissOnPointer);
      };
    }
  }, [operation]);

  const operationKey = operation ? operation.operationId || operation.startedAt : undefined;
  const visible = Boolean(operation && operationKey !== dismissedOperationId);
  const summary = useMemo(() => (operation ? summarizeValidation(operation) : ""), [operation]);

  if (!operation || !visible) {
    return null;
  }

  const failure = operation.status === "failed";

  return (
    <div className={`floating-panel floating-panel--validate floating-panel--${failure ? "error" : operation.status === "success" ? "success" : "warning"}`}>
      <div className="validate-toast__header">
        {operation.status === "running" ? <LoaderCircle size={14} className="busy spin" /> : null}
        {operation.status === "success" ? <CheckCircle2 size={14} /> : null}
        {failure ? <AlertTriangle size={14} /> : null}
        <span>{summary}</span>
      </div>

      {failure ? (
        <div className="validate-toast__details">
          <button className="validate-toast__toggle" onClick={() => setExpanded((value) => !value)}>
            <span>Details</span>
            <ChevronDown size={14} className={expanded ? "validate-toast__chevron validate-toast__chevron--open" : "validate-toast__chevron"} />
          </button>
          {expanded ? (
            <div className="validate-toast__log">
              {(operation.lines.length > 0 ? operation.lines : [operation.errorMessage ?? "Validation failed"]).map((line, index) => (
                <div key={`${operationKey}:${index}`} className="log-line">
                  {line}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
