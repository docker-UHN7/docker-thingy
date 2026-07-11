import { LoaderCircle } from "lucide-react";
import type { ExecutableProjectActionId, ProjectSummary } from "../shared/contracts";
import type { OperationState } from "./store";
import { deriveToolbarActionModel } from "./project-state";
import { SplitButton } from "./SplitButton";

type ProjectActionToolbarProps = {
  project: ProjectSummary;
  operation: OperationState | undefined;
  disabled?: boolean | undefined;
  onRunAction(actionId: ExecutableProjectActionId): void;
};

function actionBusy(operation: OperationState | undefined, actionId: ExecutableProjectActionId): boolean {
  return operation?.status === "running" && operation.actionId === actionId;
}

export function ProjectActionToolbar({ project, operation, disabled, onRunAction }: ProjectActionToolbarProps) {
  const actions = deriveToolbarActionModel(project);
  const busy = operation?.status === "running";
  const supportedActions = new Set(project.actions.map((action) => action.id));
  const primarySupported = supportedActions.has(actions.primary.actionId);
  const secondarySupported = Boolean(actions.secondary && supportedActions.has(actions.secondary.actionId));
  const canRun = !disabled;
  const primaryBusy = actionBusy(operation, actions.primary.actionId);

  return (
    <section className="project-action-toolbar">
      {actions.secondary ? (
        <SplitButton
          className={actions.primary.actionId === "stop" ? "split-button--danger" : "split-button--primary"}
          disabled={busy || !canRun || !primarySupported || !secondarySupported}
          label={actions.primary.label}
          leadingIcon={primaryBusy ? <LoaderCircle size={14} className="busy spin" /> : undefined}
          menuLabel={actions.secondary.label}
          onPrimaryClick={() => onRunAction(actions.primary.actionId)}
          onSecondaryClick={() => onRunAction(actions.secondary!.actionId)}
        />
      ) : (
        <button
          className={`button ${actions.primary.actionId === "stop" ? "button--danger" : "button--primary"}`}
          disabled={busy || !canRun || !primarySupported}
          onClick={() => onRunAction(actions.primary.actionId)}
        >
          {primaryBusy ? <LoaderCircle size={14} className="busy spin" /> : null}
          <span>{actions.primary.label}</span>
        </button>
      )}

      <button
        className="button button--secondary"
        disabled={busy || !canRun || !supportedActions.has("validate")}
        onClick={() => onRunAction("validate")}
      >
        {actionBusy(operation, "validate") ? <LoaderCircle size={14} className="busy spin" /> : null}
        <span>Validate</span>
      </button>
    </section>
  );
}
