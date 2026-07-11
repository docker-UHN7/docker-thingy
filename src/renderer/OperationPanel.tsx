import { LoaderCircle } from "lucide-react";
import type { ProjectAction } from "../shared/contracts";
import type { OperationState } from "./store";

type OperationPanelProps = {
  actions: ProjectAction[];
  operation: OperationState | undefined;
  onAction(action: ProjectAction): void;
};

function actionLabel(actions: ProjectAction[], actionId: string): string {
  return actions.find((action) => action.id === actionId)?.label ?? actionId;
}

export function OperationPanel({ actions, operation, onAction }: OperationPanelProps) {
  const busy = operation?.status === "running";

  if (actions.length === 0 && !operation) {
    return null;
  }

  return (
    <section className="operation-panel">
      {actions.length > 0 ? (
        <div className="action-row">
          {actions.map((action) => (
            <button
              key={action.id}
              className={`button ${
                action.emphasis === "primary"
                  ? "button--primary"
                  : action.emphasis === "danger"
                    ? "button--danger"
                    : "button--secondary"
              }`}
              disabled={action.disabled || busy}
              onClick={() => onAction(action)}
            >
              {busy && operation?.actionId === action.id ? <LoaderCircle size={14} className="busy spin" /> : null}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {operation ? (
        <div
          className={`diagnostic diagnostic--${
            operation.status === "failed" ? "error" : operation.status === "success" ? "info" : "warning"
          }`}
        >
          <strong>
            {actionLabel(actions, operation.actionId)} - {operation.status}
          </strong>
          {operation.errorMessage ? <p className="body-copy body-copy--secondary">{operation.errorMessage}</p> : null}
        </div>
      ) : null}

      {operation && operation.lines.length > 0 ? (
        <div className="log-console">
          {operation.lines.map((line, index) => (
            <div key={`${operation.operationId || operation.startedAt}:${index}`} className="log-line">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
