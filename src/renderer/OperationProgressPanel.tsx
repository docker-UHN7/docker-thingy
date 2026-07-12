import { AlertTriangle, CheckCircle2, ChevronDown, Circle, LoaderCircle, OctagonX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OperationState } from "./store";

type OperationProgressPanelProps = {
  operation: OperationState | undefined;
  projectTitle: string;
  variant?: "floating" | "inline";
  includeValidate?: boolean;
  onCancel?: (() => void) | undefined;
};

type ProgressStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "failed";
  details: string[];
};

function normalizeGenericLabel(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "") {
    return "Working";
  }

  return trimmed
    .replace(/\s+(done|started|stopped|waiting|error|complete|completed)\b.*$/i, "")
    .replace(/\s+\(\d+\/\d+\)\s*$/i, "")
    .trim() || trimmed;
}

function operationLabel(actionId: OperationState["actionId"], projectTitle: string): string {
  switch (actionId) {
    case "build-image":
      return `Building ${projectTitle}`;
    case "validate":
      return `Validating ${projectTitle}`;
    case "stop":
      return `Stopping ${projectTitle}`;
    case "start":
      return `Starting ${projectTitle}`;
    case "apply-start":
      return `Applying ${projectTitle}`;
    default:
      return projectTitle;
  }
}

function summarizeOperation(operation: OperationState): string {
  if (operation.status === "running") {
    return operation.lines.at(-1) ?? "Working...";
  }

  if (operation.status === "success") {
    return operation.actionId === "validate" ? "Validation passed." : "Operation completed successfully.";
  }

  return operation.errorMessage ?? (operation.lines.at(-1) || "Operation failed.");
}

function parseOperationSteps(operation: OperationState): ProgressStep[] {
  const steps: ProgressStep[] = [];
  const ensureStep = (key: string, label: string): ProgressStep => {
    let step = steps.find((entry) => entry.key === key);
    if (!step) {
      step = { key, label, status: "pending", details: [] };
      steps.push(step);
    } else if (label.trim() !== "") {
      step.label = label;
    }
    return step;
  };

  for (const line of operation.lines) {
    const buildKit = line.match(/^#(\d+)\s+(.*)$/);
    if (buildKit) {
      const step = ensureStep(`build-${buildKit[1]}`, buildKit[2]!.replace(/\s+DONE.*$/i, "").trim() || `Build step ${buildKit[1]}`);
      step.details.push(line);
      step.status = /\bDONE\b/i.test(line) ? "done" : /\bERROR\b|\bCANCELED\b/i.test(line) ? "failed" : "active";
      continue;
    }

    const containerAction = line.match(/Container\s+([^\s]+)\s+(Stopping|Stopped|Starting|Started|Waiting|Error)/i);
    if (containerAction) {
      const containerName = containerAction[1] ?? "container";
      const verb = containerAction[2]?.toLowerCase() ?? "working";
      const step = ensureStep(`container-${containerName}`, `${containerName} ${verb}`);
      step.details.push(line);
      step.status =
        verb === "stopped" || verb === "started"
          ? "done"
          : verb === "error"
            ? "failed"
            : "active";
      continue;
    }

    const genericLabel = normalizeGenericLabel(line);
    const generic = ensureStep(`generic:${genericLabel.toLowerCase()}`, genericLabel);
    generic.details.push(line);
    generic.status = operation.status === "failed" ? "failed" : operation.status === "success" ? "done" : "active";
  }

  if (steps.length === 0) {
    steps.push({
      key: "operation",
      label: operation.status === "running" ? "Working" : operation.status === "success" ? "Completed" : "Failed",
      status: operation.status === "running" ? "active" : operation.status === "success" ? "done" : "failed",
      details: operation.lines
    });
  }

  if (operation.status === "failed") {
    const active = [...steps].reverse().find((step) => step.status === "active");
    if (active) {
      active.status = "failed";
    }
  }

  return steps;
}

export function OperationProgressPanel({
  operation,
  projectTitle,
  variant = "floating",
  includeValidate = false,
  onCancel
}: OperationProgressPanelProps) {
  const [dismissedOperationId, setDismissedOperationId] = useState<string | undefined>();
  const [expandedKey, setExpandedKey] = useState<string | undefined>();
  const [hovered, setHovered] = useState(false);
  const [pinnedOperationId, setPinnedOperationId] = useState<string | undefined>();
  const operationKey = operation ? operation.operationId || operation.startedAt : undefined;

  useEffect(() => {
    if (!operationKey) {
      return;
    }

    setExpandedKey(undefined);
    setHovered(false);
    if (pinnedOperationId && pinnedOperationId !== operationKey) {
      setPinnedOperationId(undefined);
    }
  }, [operationKey, pinnedOperationId]);

  useEffect(() => {
    if (!operation) {
      return;
    }

    if (operation.status !== "running" && hovered && pinnedOperationId !== operationKey) {
      setPinnedOperationId(operationKey);
      return;
    }

    if (operation.status === "running") {
      if (dismissedOperationId !== undefined) {
        setDismissedOperationId(undefined);
      }
      if (pinnedOperationId !== undefined) {
        setPinnedOperationId(undefined);
      }
      return;
    }

    if (operation.status === "success" && pinnedOperationId !== operationKey && !hovered) {
      const timer = window.setTimeout(() => {
        setDismissedOperationId(operationKey);
      }, 2200);

      return () => window.clearTimeout(timer);
    }
  }, [operation?.status, operation?.operationId, operation?.startedAt, dismissedOperationId, hovered, operationKey, pinnedOperationId]);

  const steps = useMemo(() => (operation ? parseOperationSteps(operation) : []), [operation]);
  const summary = useMemo(() => (operation ? summarizeOperation(operation) : ""), [operation]);

  if (!operation || (!includeValidate && operation.actionId === "validate") || dismissedOperationId === operationKey) {
    return null;
  }

  const containerClass =
    variant === "inline"
      ? "operation-progress operation-progress--inline"
      : `floating-panel floating-panel--operation floating-panel--${
          operation.status === "failed" ? "error" : operation.status === "success" ? "success" : "warning"
        }`;

  return (
    <div
      className={containerClass}
      onMouseEnter={() => {
        setHovered(true);
        if (operation.status !== "running") {
          setPinnedOperationId(operationKey);
        }
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="operation-progress__header">
        <strong>{operationLabel(operation.actionId, projectTitle)}</strong>
        <div className="operation-progress__header-actions">
          {operation.status === "running" && onCancel ? (
            <button
              type="button"
              className="button button--danger operation-progress__cancel"
              onClick={onCancel}
            >
              <OctagonX size={14} />
              <span>Cancel</span>
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button operation-progress__close"
            onClick={() => setDismissedOperationId(operationKey)}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="validate-toast__header">
        {operation.status === "running" ? <LoaderCircle size={14} className="busy spin" /> : null}
        {operation.status === "success" ? <CheckCircle2 size={14} /> : null}
        {operation.status === "failed" ? <AlertTriangle size={14} /> : null}
        <span>{summary}</span>
      </div>

      <div className="operation-progress__steps">
        {steps.map((step) => {
          const active = step.status === "active";
          const failed = step.status === "failed";
          const expanded = expandedKey === step.key;

          return (
            <div key={step.key} className="operation-progress__step">
              <div className="operation-progress__row">
                <span className="operation-progress__icon">
                  {step.status === "done" ? <CheckCircle2 size={14} /> : failed ? <AlertTriangle size={14} /> : active ? <LoaderCircle size={14} className="busy spin" /> : <Circle size={14} />}
                </span>
                <span className="operation-progress__label">{step.label}</span>
              </div>

              <div className="operation-progress__track" aria-hidden="true">
                <div
                  className={`operation-progress__bar operation-progress__bar--${step.status}`}
                  style={{ width: step.status === "done" ? "100%" : step.status === "failed" ? "100%" : step.status === "active" ? "55%" : "0%" }}
                />
              </div>

              {step.details.length > 0 ? (
                <div className="operation-progress__failure">
                  <button className="validate-toast__toggle" onClick={() => setExpandedKey(expanded ? undefined : step.key)}>
                    <span>Details</span>
                    <ChevronDown size={14} className={expanded ? "validate-toast__chevron validate-toast__chevron--open" : "validate-toast__chevron"} />
                  </button>
                  {expanded ? (
                    <div className="validate-toast__log">
                      {step.details.map((line, index) => (
                        <div key={`${step.key}:${index}`} className="log-line">
                          {line}
                        </div>
                      ))}
                      {operation.errorMessage ? <div className="log-line">{operation.errorMessage}</div> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
