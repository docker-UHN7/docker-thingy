import type { ProjectAction } from "../shared/contracts";

type OperationPanelProps = {
  actions: ProjectAction[];
  onAction(action: ProjectAction): void;
};

export function OperationPanel({ actions, onAction }: OperationPanelProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="operation-panel">
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
            disabled={action.disabled}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
