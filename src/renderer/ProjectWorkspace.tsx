import {
  ArrowLeft,
  LayoutPanelTop,
  LoaderCircle,
  MoonStar,
  ScanSearch,
  Settings,
  SunMedium,
  TriangleAlert,
  X
} from "lucide-react";
import { Panel } from "@xyflow/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  DockerStatus,
  ExecutableProjectActionId,
  LogSnapshotResult,
  ProjectSummary,
  ServiceNodeModel,
  StatsSnapshotResult
} from "../shared/contracts";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { Inspector } from "./Inspector";
import { LogsPanel } from "./LogsPanel";
import { OperationProgressPanel } from "./OperationProgressPanel";
import { ProjectActionToolbar } from "./ProjectActionToolbar";
import { GraphView } from "./graph/GraphView";
import { deriveProjectLifecycle } from "./project-state";
import { useAppStore } from "./store";
import appLogo from "./assets/logo.png";

type ProjectWorkspaceProps = {
  project: ProjectSummary | undefined;
  dockerStatus: DockerStatus | undefined;
  settings: AppSettings | undefined;
  theme: "dark" | "light";
  loading: boolean;
  error: string | undefined;
  onBack(): void;
  onToggleTheme(): void;
};

type DetailTab = "overview" | "env" | "mounts" | "logs";

const EXECUTABLE_ACTION_IDS: ReadonlySet<string> = new Set<ExecutableProjectActionId>([
  "validate",
  "start",
  "apply-start",
  "stop",
  "build-image"
]);

function isExecutableActionId(value: string): value is ExecutableProjectActionId {
  return EXECUTABLE_ACTION_IDS.has(value);
}

function relativeTimeLabel(value: string | undefined): string {
  if (!value) {
    return "not available";
  }

  const start = new Date(value).getTime();
  if (!Number.isFinite(start)) {
    return "not available";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function ProjectWorkspace({
  project,
  dockerStatus,
  settings,
  theme,
  loading,
  error,
  onBack,
  onToggleTheme
}: ProjectWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [layoutDirection, setLayoutDirection] = useState<"RIGHT" | "DOWN">("RIGHT");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dismissedValidationOperationId, setDismissedValidationOperationId] = useState<string | undefined>();
  const [logsState, setLogsState] = useState<LogSnapshotResult | null>(null);
  const [statsState, setStatsState] = useState<StatsSnapshotResult | null>(null);
  const deferredQuery = useDeferredValue(query);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearRecents = useAppStore((state) => state.clearRecents);
  const runProjectAction = useAppStore((state) => state.runProjectAction);
  const operations = useAppStore((state) => state.operations);
  const operation = project ? operations[project.id] : undefined;

  const selectedService = useMemo(
    () => project?.services.find((service) => service.id === selectedNodeId),
    [project, selectedNodeId]
  );

  useEffect(() => {
    if (selectedNodeId && !project?.services.some((service) => service.id === selectedNodeId)) {
      setSelectedNodeId(undefined);
    }
  }, [project, selectedNodeId]);

  useEffect(() => {
    if (operation?.actionId === "validate" && operation.status === "running" && dismissedValidationOperationId) {
      setDismissedValidationOperationId(undefined);
    }
  }, [operation?.actionId, operation?.status, operation?.operationId, operation?.startedAt, dismissedValidationOperationId]);

  const visibleEnv = useMemo(() => {
    const env = selectedService?.details?.env ?? [];
    const term = envFilter.trim().toLowerCase();
    return term ? env.filter((entry) => entry.key.toLowerCase().includes(term)) : env;
  }, [envFilter, selectedService]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedNodeId(undefined);
        setSettingsOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const containerId = selectedService?.details?.containerId;
    const tail = settings?.logTailLines;
    if (detailTab !== "logs" || !containerId || !tail) {
      return;
    }
    const resolvedContainerId = containerId;
    const resolvedTail = tail;

    setLogsState(null);
    let cancelled = false;

    async function loadLogs() {
      const result = await window.dockerExplorer.getServiceLogs(resolvedContainerId, resolvedTail);
      if (!cancelled) {
        setLogsState(result);
      }
    }

    void loadLogs();

    const intervalMs = settings?.statsPollSeconds ? settings.statsPollSeconds * 1000 : null;
    const intervalId = intervalMs ? window.setInterval(() => void loadLogs(), intervalMs) : undefined;

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [detailTab, selectedService?.details?.containerId, settings?.logTailLines, settings?.statsPollSeconds]);

  useEffect(() => {
    const containerId = selectedService?.details?.containerId;
    const isRunning = selectedService?.details?.runtimeState.running;
    if (detailTab !== "overview" || !containerId || !isRunning) {
      setStatsState(null);
      return;
    }
    const resolvedContainerId = containerId;

    setStatsState(null);
    let cancelled = false;

    async function loadStats() {
      const result = await window.dockerExplorer.getServiceStats(resolvedContainerId);
      if (!cancelled) {
        setStatsState(result);
      }
    }

    void loadStats();

    const intervalMs = settings?.statsPollSeconds ? settings.statsPollSeconds * 1000 : null;
    const intervalId = intervalMs ? window.setInterval(() => void loadStats(), intervalMs) : undefined;

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [detailTab, selectedService?.details?.containerId, selectedService?.details?.runtimeState.running, settings?.statsPollSeconds]);

  if (!project) {
    return (
      <main className="workspace-screen">
        <header className="topbar topbar--workspace">
          <div className="brand-lockup">
            <img className="brand-mark brand-mark--image" src={appLogo} alt="" />
            <h1 className="brand-title">VIMOKU</h1>
          </div>
          <div className="topbar__controls">
            <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
            </button>
          </div>
        </header>

        <div className="workspace-empty">
          <div className="hero-card">
            <p className="eyebrow">Nothing discovered yet</p>
            <h2 className="screen-title">
              {dockerStatus?.daemonAvailable
                ? "Docker is reachable, but there are no Compose projects or standalone containers to show yet."
                : "Start Docker or open a Compose source to begin."}
            </h2>
            <p className="body-copy">
              {dockerStatus?.daemonAvailable
                ? "Start a container, or open an explicit Compose source."
                : dockerStatus?.message ?? "No Docker runtime data is available yet."}
            </p>
            <button className="button button--primary" onClick={onBack}>
              <ArrowLeft size={16} />
              <span>Back to projects</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  function handleAction(actionId: ExecutableProjectActionId) {
    if (!project || !isExecutableActionId(actionId)) {
      return;
    }

    const confirmation =
      actionId === "stop"
        ? "Stop containers for this project?"
        : actionId === "apply-start"
          ? "Apply changes and start this project?"
          : actionId === "start"
            ? "Start containers for this project?"
            : undefined;

    if (confirmation && !window.confirm(confirmation)) {
      return;
    }

    void runProjectAction(project.id, actionId);
  }

  const lifecycle = deriveProjectLifecycle(project);
  const runtimeStateLabel =
    lifecycle.state === "running"
      ? "running"
      : lifecycle.state === "crashed"
        ? "crashed"
        : lifecycle.state === "built-not-running"
          ? "stopped"
          : loading
            ? "checking runtime..."
            : "source only";
  const runtimeIndicatorClass =
    lifecycle.state === "running" ? "running" : lifecycle.state === "crashed" ? "error" : "stopped";
  const uptimeLabel = relativeTimeLabel(selectedService?.details?.runtimeState.startedAt);
  const validationOperation = operation?.actionId === "validate" ? operation : undefined;
  const actionOperation = operation && operation.actionId !== "validate" ? operation : undefined;
  const validationOperationKey = validationOperation?.operationId || validationOperation?.startedAt;
  const visibleValidationOperation =
    validationOperation && validationOperationKey !== dismissedValidationOperationId ? validationOperation : undefined;

  return (
    <main className="workspace-screen">
      {error ? (
        <div className="error-banner error-banner--inline">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="workspace-canvas">
        <GraphView
          project={project}
          filterQuery={deferredQuery}
          selectedNodeId={selectedNodeId}
          layoutDirection={layoutDirection}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setDetailTab("overview");
            setSettingsOpen(false);
          }}
          onClearSelection={() => setSelectedNodeId(undefined)}
        >
          <Panel position="top-left" style={{ margin: 16 }}>
            <div className="floating-panel workspace-panel workspace-panel--project">
              <div className="workspace-project-card">
                <div className="workspace-project-card__header">
                  <button className="icon-button" onClick={onBack} aria-label="Back to projects">
                    <ArrowLeft size={16} />
                  </button>
                  <div className="workspace-project-card__title-block">
                    <h2 className="toolbar-project__title">{project.title}</h2>
                    <div className="live-indicator">
                      <span
                        className={`status-dot status-dot--${runtimeIndicatorClass} ${
                          lifecycle.state === "running" ? "pulse" : ""
                        }`}
                      />
                      <span className="metadata-note">{runtimeStateLabel}</span>
                    </div>
                  </div>
                </div>

                <div className="workspace-project-card__meta">
                  <span className="metadata-note">{project.contextName}</span>
                </div>
              </div>
            </div>
          </Panel>

          <Panel position="top-right" style={{ margin: 16 }}>
            <div className="floating-panel workspace-panel workspace-panel--toolbar">
              <div className="workspace-toolbar__cluster">
                <label className="search-input search-input--workspace">
                  <ScanSearch size={16} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name, image, or port" />
                </label>
              </div>

              <div className="workspace-toolbar__divider" />

              <div className="workspace-toolbar__cluster">
                <button
                  className="button button--secondary"
                  onClick={() => setLayoutDirection((current) => (current === "RIGHT" ? "DOWN" : "RIGHT"))}
                >
                  <LayoutPanelTop size={16} />
                  <span>{layoutDirection === "RIGHT" ? "Left to right" : "Top to bottom"}</span>
                </button>
              </div>

              <div className="workspace-toolbar__divider" />

              <div className="workspace-toolbar__cluster">
                <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
                  {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
                </button>
                <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen((value) => !value)}>
                  <Settings size={16} />
                </button>
              </div>

              <div className="workspace-toolbar__divider" />

              <div className="workspace-toolbar__cluster">
                <ProjectActionToolbar project={project} operation={operation} onRunAction={handleAction} />
              </div>
            </div>
          </Panel>

          <Panel position="bottom-center" style={{ margin: 16 }}>
            <OperationProgressPanel operation={actionOperation} projectTitle={project.title} />
          </Panel>

          <Panel position="center-right" style={{ margin: 16 }}>
            {settingsOpen && settings ? (
              <aside className="floating-panel detail-panel detail-panel--overlay">
                <div className="detail-panel__header">
                  <div>
                    <p className="eyebrow">Settings</p>
                    <h3 className="panel-title">Workspace preferences</h3>
                  </div>
                  <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                    <X size={16} />
                  </button>
                </div>
                <ConfigurationPanel
                  settings={settings}
                  onUpdate={(next) => void updateSettings(next)}
                  onClearRecents={() => void clearRecents()}
                />
              </aside>
            ) : visibleValidationOperation ? (
              <aside className="floating-panel detail-panel detail-panel--overlay">
                <div className="detail-panel__header">
                  <div>
                    <p className="eyebrow">Detail Panel</p>
                    <h3 className="panel-title">Validation</h3>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setDismissedValidationOperationId(validationOperationKey)}
                    aria-label="Close panel"
                  >
                    <X size={16} />
                  </button>
                </div>
                <OperationProgressPanel
                  operation={visibleValidationOperation}
                  projectTitle={project.title}
                  variant="inline"
                  includeValidate
                />
              </aside>
            ) : selectedService ? (
              <aside className="floating-panel detail-panel detail-panel--overlay">
                <div className="detail-panel__header">
                  <div>
                    <p className="eyebrow">Detail Panel</p>
                    <h3 className="panel-title">{selectedService.name}</h3>
                  </div>
                  <button className="icon-button" onClick={() => setSelectedNodeId(undefined)} aria-label="Close panel">
                    <X size={16} />
                  </button>
                </div>

                <div className="detail-tabs">
                  {(["overview", "env", "mounts", "logs"] as DetailTab[]).map((tab) => (
                    <button
                      key={tab}
                      className={`detail-tab ${detailTab === tab ? "detail-tab--active" : ""}`}
                      onClick={() => setDetailTab(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {detailTab === "overview" ? (
                  <Inspector service={selectedService} uptimeLabel={uptimeLabel} stats={statsState?.ok ? statsState.data : undefined} />
                ) : null}

                {detailTab === "env" ? (
                  <div className="detail-stack">
                    {(selectedService.details?.env.length ?? 0) > 15 ? (
                      <label className="search-input">
                        <ScanSearch size={16} />
                        <input value={envFilter} onChange={(event) => setEnvFilter(event.target.value)} placeholder="Filter env vars" />
                      </label>
                    ) : null}
                    <div className="detail-table">
                      {visibleEnv.length === 0 ? (
                        <div className="detail-list__row">
                          <span className="mono-key">Runtime env</span>
                          <span className="mono-value">Not available for this service.</span>
                        </div>
                      ) : (
                        visibleEnv.map((entry) => (
                          <div key={entry.key} className="detail-list__row detail-list__row--column">
                            <div className="detail-row-main">
                              <span className="mono-key" title={entry.key}>
                                {entry.key}
                              </span>
                              <span className="mono-value" title={entry.masked ? "Value hidden" : entry.value}>
                                {entry.masked ? "........" : entry.value}
                              </span>
                            </div>
                            <button className="button button--secondary" onClick={() => void navigator.clipboard.writeText(entry.value)}>
                              Copy
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}

                {detailTab === "mounts" ? (
                  <div className="detail-table">
                    {selectedService.details?.mounts.length ? (
                      selectedService.details.mounts.map((mount) => (
                        <div key={`${mount.source}:${mount.destination}`} className="mount-row">
                          <span className={`manifest-tag manifest-tag--${mount.type}`}>{mount.type}</span>
                          <span className="mono-value" title={mount.source}>
                            {mount.source}
                          </span>
                          <span className="mono-value" title={mount.destination}>
                            {mount.destination}
                          </span>
                          <span className="manifest-tag">{mount.rw ? "rw" : "ro"}</span>
                        </div>
                      ))
                    ) : (
                      <div className="detail-list__row">
                        <span className="mono-key">Mounts</span>
                        <span className="mono-value">No runtime mounts detected.</span>
                      </div>
                    )}
                  </div>
                ) : null}

                {detailTab === "logs" ? (
                  selectedService.details?.containerId ? (
                    logsState?.ok ? (
                      <LogsPanel lines={logsState.data.lines} fetchedAt={logsState.data.fetchedAt} />
                    ) : logsState?.ok === false ? (
                      <div className="detail-list__row detail-list__row--error">
                        <span className="mono-key">Logs</span>
                        <span className="mono-value">{logsState.error.message}</span>
                      </div>
                    ) : (
                      <div className="detail-list__row detail-list__row--loading">
                        <LoaderCircle size={14} className="busy spin" />
                        <span className="mono-value">Loading logs...</span>
                      </div>
                    )
                  ) : (
                    <div className="detail-list__row">
                      <span className="mono-key">Logs</span>
                      <span className="mono-value">Runtime logs are not available for source-only services.</span>
                    </div>
                  )
                ) : null}
              </aside>
            ) : null}
          </Panel>
        </GraphView>
      </section>
    </main>
  );
}
