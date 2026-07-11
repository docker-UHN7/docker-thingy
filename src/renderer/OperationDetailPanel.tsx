import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useMemo } from "react";
import type { OperationState } from "./store";

type OperationDetailPanelProps = {
  operation: OperationState;
};

type ParsedStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string | undefined;
};

function parseBuildSteps(lines: string[], operation: OperationState): ParsedStep[] {
  const steps = new Map<string, ParsedStep>();

  for (const line of lines) {
    const match = line.match(/^#(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }

    const stepId = match[1] ?? "";
    const detail = match[2]?.trim() ?? "";
    const existing = steps.get(stepId);
    const normalizedLabel = detail
      .replace(/\s+DONE\s+\S+$/i, "")
      .replace(/\s+ERROR.*$/i, "")
      .trim();

    let status: ParsedStep["status"] = existing?.status ?? "running";
    if (/\bDONE\b/i.test(detail)) {
      status = "done";
    } else if (/\bERROR\b/i.test(detail) || /\bCANCELED\b/i.test(detail)) {
      status = "failed";
    } else if (!existing) {
      status = "running";
    }

    steps.set(stepId, {
      id: stepId,
      label: existing?.label ?? (normalizedLabel || `Step ${stepId}`),
      status,
      detail
    });
  }

  const parsed = [...steps.values()].sort((a, b) => Number(a.id) - Number(b.id));
  if (operation.status === "failed" && parsed.length > 0) {
    const current = [...parsed].reverse().find((step) => step.status === "running") ?? parsed.at(-1);
    if (current) {
      current.status = "failed";
    }
  }

  return parsed;
}

function statusSummary(operation: OperationState): string {
  if (operation.status === "running") {
    return operation.lines.at(-1) ?? "Running validation...";
  }

  if (operation.status === "success") {
    return "Validation passed.";
  }

  return operation.errorMessage ?? (operation.lines.at(-1) || "Validation failed.");
}

export function OperationDetailPanel({ operation }: OperationDetailPanelProps) {
  const steps = useMemo(() => parseBuildSteps(operation.lines, operation), [operation]);
  const summary = statusSummary(operation);
  const hasStructuredProgress = steps.length > 0;

  return (
    <aside className="detail-panel">
      <div className="detail-panel__header">
        <div>
          <p className="eyebrow">Detail Panel</p>
          <h3 className="panel-title">Validation</h3>
        </div>
      </div>

      <div className="detail-stack">
        <div
          className={`diagnostic diagnostic--${
            operation.status === "failed" ? "error" : operation.status === "success" ? "info" : "warning"
          }`}
        >
          <strong className="operation-status">
            {operation.status === "running" ? <LoaderCircle size={14} className="busy spin" /> : null}
            {operation.status === "success" ? <CheckCircle2 size={14} /> : null}
            {operation.status === "failed" ? <AlertTriangle size={14} /> : null}
            <span>{summary}</span>
          </strong>
        </div>

        {hasStructuredProgress ? (
          <div className="validation-progress-list">
            {steps.map((step) => (
              <div key={step.id} className="validation-progress-row">
                <div className="validation-progress-row__head">
                  <span className="mono-key">{step.label}</span>
                  <span className="metadata-note">{step.status}</span>
                </div>
                <div className="validation-progress-track" aria-hidden="true">
                  <div
                    className={`validation-progress-bar validation-progress-bar--${step.status}`}
                    style={{ width: step.status === "done" ? "100%" : step.status === "failed" ? "100%" : "55%" }}
                  />
                </div>
                {step.detail ? <p className="toolbar-note">{step.detail}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {operation.lines.length > 0 ? (
          <div className="log-console">
            {operation.lines.map((line, index) => (
              <div key={`${operation.operationId || operation.startedAt}:${index}`} className="log-line">
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
