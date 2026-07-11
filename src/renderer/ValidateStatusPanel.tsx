import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OperationState } from "./store";

type ValidateStatusPanelProps = {
  operation: OperationState | undefined;
  variant?: "toast" | "panel";
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

export function ValidateStatusPanel({ operation, variant = "toast" }: ValidateStatusPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissedOperationId, setDismissedOperationId] = useState<string | undefined>();

  useEffect(() => {
    if (!operation || variant !== "toast") {
      return;
    }

    if (operation.status === "running") {
      if (dismissedOperationId !== undefined) {
        setDismissedOperationId(undefined);
      }
      if (expanded) {
        setExpanded(false);
      }
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
  }, [operation?.status, operation?.operationId, operation?.startedAt, variant, dismissedOperationId, expanded]);

  const operationKey = operation ? operation.operationId || operation.startedAt : undefined;
  const visible = Boolean(operation && operationKey !== dismissedOperationId);
  const summary = useMemo(() => (operation ? summarizeValidation(operation) : ""), [operation]);

  if (!operation || !visible) {
    return null;
  }

  const failure = operation.status === "failed";
  const containerClass =
    variant === "panel"
      ? "detail-stack"
      : `floating-panel floating-panel--validate floating-panel--${
          failure ? "error" : operation.status === "success" ? "success" : "warning"
        }`;

  return (
    <div className={containerClass}>
      <div className="validate-toast__header">
        {operation.status === "running" ? <LoaderCircle size={14} className="busy spin" /> : null}
        {operation.status === "success" ? <CheckCircle2 size={14} /> : null}
        {failure ? <AlertTriangle size={14} /> : null}
        <span>{summary}</span>
      </div>

      {failure || variant === "panel" ? (
        <div className="validate-toast__details">
          <button className="validate-toast__toggle" onClick={() => setExpanded((value) => !value)}>
            <span>Details</span>
            <ChevronDown size={14} className={expanded ? "validate-toast__chevron validate-toast__chevron--open" : "validate-toast__chevron"} />
          </button>
          {expanded ? (
            <div className="validate-toast__log">
              {(operation.lines.length > 0
                ? operation.lines
                : [operation.errorMessage ?? (operation.status === "success" ? "Validation completed" : "Validation failed")]).map((line, index) => (
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
