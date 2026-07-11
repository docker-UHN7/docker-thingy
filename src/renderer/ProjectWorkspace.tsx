import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Layers,
  LayoutPanelTop,
  LoaderCircle,
  MoonStar,
  Plus,
  RefreshCw,
  ScanSearch,
  Settings,
  Shrink,
  SunMedium,
  TriangleAlert,
  X
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  DockerStatus,
  ExecutableProjectActionId,
  LogSnapshotResult,
  ProjectAction,
  ProjectSummary,
  ServiceNodeModel,
  StatsSnapshotResult
} from "../shared/contracts";
import { useAppStore } from "./store";
import { GraphView } from "./graph/GraphView";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { Inspector } from "./Inspector";
import { LogsPanel } from "./LogsPanel";
import { OperationPanel } from "./OperationPanel";
import { ValidationPanel } from "./ValidationPanel";

type ProjectWorkspaceProps = {
  project: ProjectSummary | undefined;
  projects: ProjectSummary[];
  dockerStatus: DockerStatus | undefined;
  settings: AppSettings | undefined;
  theme: "dark" | "light";
  loading: boolean;
  error: string | undefined;
  onBack(): void;
  onRefresh(): void;
  onToggleTheme(): void;
  onSelectProject(projectId: string): void;
};

type DetailTab = "overview" | "env" | "mounts" | "logs";

const EXECUTABLE_ACTION_IDS: ReadonlySet<string> = new Set<ExecutableProjectActionId>([
  "validate",
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
  projects,
  dockerStatus,
  settings,
  theme,
  loading,
  error,
  onBack,
  onRefresh,
  onToggleTheme,
  onSelectProject
}: ProjectWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [layoutDirection, setLayoutDirection] = useState<"RIGHT" | "DOWN">("RIGHT");
  const [fitNonce, setFitNonce] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsState, setLogsState] = useState<LogSnapshotResult | null>(null);
  const [statsState, setStatsState] = useState<StatsSnapshotResult | null>(null);
  // Toggling a compose-file checkbox round-trips through main (reload +
  // reparse every active YAML file), which is noticeable enough that driving
  // `checked` off the store snapshot alone made the control feel unresponsive.
  // This mirrors the change locally the instant it's clicked and clears once
  // the persisted snapshot catches up (success or failure - either way
  // project.configFiles is then the source of truth again).
  const [optimisticConfigFiles, setOptimisticConfigFiles] = useState<string[] | undefined>(undefined);
  const [savingConfigFiles, setSavingConfigFiles] = useState(false);
  // Collapsed by default - this is a power-user control most projects never
  // need to touch, and an expanded file-order editor sitting open above the
  // graph on every visit was pure visual noise for the common case.
  const [composeSelectorOpen, setComposeSelectorOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearRecents = useAppStore((state) => state.clearRecents);
  const updateProjectConfigFiles = useAppStore((state) => state.updateProjectConfigFiles);
  const runProjectAction = useAppStore((state) => state.runProjectAction);
  const operations = useAppStore((state) => state.operations);
  const operation = project ? operations[project.id] : undefined;

  // Intentionally no fallback to project.services[0]: selectedNodeId === undefined
  // means "nothing selected" and must stay that way so clearing the selection
  // (Escape, clicking empty canvas, closing the panel) actually closes the panel
  // instead of silently re-selecting the first service.
  const selectedService = useMemo(
    () => project?.services.find((service) => service.id === selectedNodeId),
    [project, selectedNodeId]
  );

  // Sibling projects discovered from the same folder scan (see project.groupId)
  // so the user can tab between e.g. docker-compose-auth.yml and
  // docker-compose-payment.yml without dropping back out to the launcher.
  const siblingProjects = useMemo(
    () => (project?.groupId ? projects.filter((entry) => entry.groupId === project.groupId) : []),
    [project, projects]
  );

  // If the active project changes out from under us (switched projects, or the
  // previously selected service disappeared on refresh) drop a now-invalid
  // selection instead of leaving a stale id around.
  useEffect(() => {
    if (selectedNodeId && !project?.services.some((service) => service.id === selectedNodeId)) {
      setSelectedNodeId(undefined);
    }
  }, [project, selectedNodeId]);

  // Switching to a different project (including tabbing to a sibling) should
  // never carry over another project's in-flight compose-file selection.
  useEffect(() => {
    setOptimisticConfigFiles(undefined);
    setSavingConfigFiles(false);
  }, [project?.id]);

  async function applyConfigFilesChange(newFiles: string[]) {
    if (!project) {
      return;
    }

    setOptimisticConfigFiles(newFiles);
    setSavingConfigFiles(true);
    try {
      await updateProjectConfigFiles(project.id, newFiles);
    } finally {
      setOptimisticConfigFiles(undefined);
      setSavingConfigFiles(false);
    }
  }

  function handleConfigFileToggle(file: string, checked: boolean) {
    if (!project) {
      return;
    }

    const baseFiles = optimisticConfigFiles ?? project.configFiles;
    // Newly-added files go on top of the merge order (last = highest
    // priority) since that's the position most likely to be what someone
    // reaching for an override file wants.
    const newFiles = checked ? [...baseFiles, file] : baseFiles.filter((entry) => entry !== file);
    void applyConfigFilesChange(newFiles);
  }

  // Moves a file earlier (-1) or later (+1) in the merge order. Order is the
  // whole point of this control: compose-service.ts merges configFiles
  // strictly left-to-right, so a later file's image/ports/etc. win over an
  // earlier one's - this is what lets the same override file be applied
  // "on top of" different base files.
  function handleReorderConfigFile(fromIndex: number, direction: -1 | 1) {
    if (!project) {
      return;
    }

    const baseFiles = optimisticConfigFiles ?? project.configFiles;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= baseFiles.length) {
      return;
    }

    const newFiles = [...baseFiles];
    const [moved] = newFiles.splice(fromIndex, 1);
    if (moved === undefined) {
      return;
    }
    newFiles.splice(toIndex, 0, moved);
    void applyConfigFilesChange(newFiles);
  }

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
    const containerIdSafe = containerId;
    const tailSafe = tail;

    // Reset immediately so switching services/tabs never briefly shows the
    // previous service's log lines while the fresh fetch is in flight.
    setLogsState(null);
    let cancelled = false;

    async function loadLogs() {
      const result = await window.dockerExplorer.getServiceLogs(containerIdSafe, tailSafe);
      if (!cancelled) {
        setLogsState(result);
      }
    }

    void loadLogs();

    const intervalMs = settings.runtimeRefreshSeconds ? settings.runtimeRefreshSeconds * 1000 : null;
    const intervalId = intervalMs ? window.setInterval(() => void loadLogs(), intervalMs) : undefined;

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [detailTab, selectedService?.details?.containerId, settings?.logTailLines, settings?.runtimeRefreshSeconds]);

  useEffect(() => {
    const containerId = selectedService?.details?.containerId;
    const isRunning = selectedService?.details?.runtimeState.running;
    if (detailTab !== "overview" || !containerId || !isRunning) {
      setStatsState(null);
      return;
    }
    const containerIdSafe = containerId;

    // Reset immediately so switching between two running services never briefly
    // shows the previous service's CPU/memory numbers while the fetch is in flight.
    setStatsState(null);
    let cancelled = false;

    async function loadStats() {
      const result = await window.dockerExplorer.getServiceStats(containerIdSafe);
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
  }, [
    detailTab,
    selectedService?.details?.containerId,
    selectedService?.details?.runtimeState.running,
    settings?.statsPollSeconds
  ]);

  if (!project) {
    return (
      <main className="workspace-screen">
        <header className="topbar topbar--workspace">
          <div className="toolbar-left">
            <button className="icon-button" onClick={onBack} aria-label="Back to projects">
              <ArrowLeft size={16} />
            </button>
            <h2 className="screen-title">Docker Graph</h2>
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
                ? "Try Refresh runtime, start a container, or open an explicit Compose source."
                : dockerStatus?.message ?? "No Docker runtime data is available yet."}
            </p>
            <ul className="hero-steps">
              <li>Start Docker Desktop (or your Docker daemon) so running containers can be discovered automatically.</li>
              <li>Or go back and open a docker-compose.yml, compose.yaml, or Dockerfile directly.</li>
            </ul>
            <button className="button button--primary" onClick={onBack}>
              <ArrowLeft size={16} />
              <span>Back to projects</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  function handleAction(action: ProjectAction) {
    if (action.confirmation && !window.confirm(action.confirmation)) {
      return;
    }

    if (action.id === "refresh") {
      onRefresh();
      return;
    }

    if (!project || !isExecutableActionId(action.id)) {
      return;
    }

    void runProjectAction(project.id, action.id);
  }

  const runtimeStateLabel = dockerStatus?.daemonAvailable ? "connected" : loading ? "reconnecting..." : "offline";
  const uptimeLabel = relativeTimeLabel(selectedService?.details?.runtimeState.startedAt);
  const dependencyCount = project.services.reduce((count, service) => count + service.dependencyDetails.length, 0);
  const volumeCount = new Set(project.services.flatMap((service) => service.categories.volumes)).size;
  const networkCount = new Set(project.services.flatMap((service) => service.categories.networks)).size;
  const activeConfigFiles = optimisticConfigFiles ?? project.configFiles;
  const inactiveConfigFiles = (project.allConfigFiles ?? []).filter((file) => !activeConfigFiles.includes(file));

  return (
    <main className="workspace-screen">
      <header className="topbar topbar--workspace">
        <div className="toolbar-left">
          <button className="icon-button" onClick={onBack} aria-label="Back to projects">
            <ArrowLeft size={16} />
          </button>
          <div className="toolbar-project">
            <h2 className="toolbar-project__title">{project.title}</h2>
            <div className="live-indicator">
              <span
                className={`status-dot status-dot--${dockerStatus?.daemonAvailable ? "running" : "stopped"} ${
                  dockerStatus?.daemonAvailable ? "pulse" : ""
                }`}
              />
              <span className="metadata-note">{runtimeStateLabel}</span>
            </div>
          </div>
        </div>

        <div className="toolbar-tools">
          <label className="search-input search-input--workspace">
            <ScanSearch size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name, image, or port" />
          </label>
          <button
            className="button button--secondary"
            onClick={() => setLayoutDirection((current) => (current === "RIGHT" ? "DOWN" : "RIGHT"))}
          >
            <LayoutPanelTop size={16} />
            <span>{layoutDirection === "RIGHT" ? "Layout: Left to right" : "Layout: Top to bottom"}</span>
          </button>
          <button className="icon-button" onClick={() => setFitNonce((value) => value + 1)} aria-label="Fit view">
            <Shrink size={16} />
          </button>
          <button className="icon-button" onClick={onRefresh} aria-label="Refresh runtime">
            <RefreshCw size={16} className={loading ? "busy spin" : undefined} />
          </button>
          <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {siblingProjects.length > 1 ? (
        <div className="project-tabs" role="tablist" aria-label={`Projects in ${project.groupLabel ?? "this folder"}`}>
          {siblingProjects.map((sibling) => (
            <button
              key={sibling.id}
              role="tab"
              aria-selected={sibling.id === project.id}
              className={`project-tab ${sibling.id === project.id ? "project-tab--active" : ""}`}
              onClick={() => onSelectProject(sibling.id)}
            >
              <span
                className={`status-dot status-dot--${dockerStatus?.daemonAvailable ? (sibling.services.some((s) => s.status === "running") ? "running" : "stopped") : "stopped"}`}
              />
              <span>{sibling.title}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="error-banner error-banner--inline">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="workspace-frame">
        <section className="graph-stage">
          <div className="graph-stage__header">
            <div>
              <p className="eyebrow">{project.contextName}</p>

              {project.allConfigFiles && project.allConfigFiles.length > 1 && (
                <div className={`compose-selector ${composeSelectorOpen ? "" : "compose-selector--collapsed"}`}>
                  <button
                    type="button"
                    className="compose-selector__header"
                    onClick={() => setComposeSelectorOpen((value) => !value)}
                    aria-expanded={composeSelectorOpen}
                  >
                    {composeSelectorOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Layers size={14} />
                    <span className="compose-selector__title">Active compose files</span>
                    <span className="metadata-note">
                      {composeSelectorOpen
                        ? "Merged top to bottom — lower files override higher ones"
                        : `${activeConfigFiles.length} of ${project.allConfigFiles.length} files active`}
                    </span>
                    {savingConfigFiles ? (
                      <LoaderCircle size={14} className="busy spin compose-selector__spinner" aria-label="Applying compose file selection" />
                    ) : null}
                  </button>

                  {composeSelectorOpen ? (
                    <>
                      <ol className="compose-file-order">
                        {activeConfigFiles.map((file, index) => {
                          const fileName = file.split(/[/\\]/).pop() ?? file;
                          return (
                            <li key={file} className="compose-file-order__item" title={file}>
                              <span className="compose-file-order__index">{index + 1}</span>
                              <span className="compose-file-order__name">{fileName}</span>
                              <div className="compose-file-order__actions">
                                <button
                                  type="button"
                                  className="icon-button icon-button--tiny"
                                  disabled={index === 0}
                                  onClick={() => handleReorderConfigFile(index, -1)}
                                  aria-label={`Move ${fileName} earlier in the merge order`}
                                >
                                  <ArrowUp size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button icon-button--tiny"
                                  disabled={index === activeConfigFiles.length - 1}
                                  onClick={() => handleReorderConfigFile(index, 1)}
                                  aria-label={`Move ${fileName} later in the merge order`}
                                >
                                  <ArrowDown size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button icon-button--tiny"
                                  disabled={activeConfigFiles.length <= 1}
                                  onClick={() => handleConfigFileToggle(file, false)}
                                  aria-label={`Remove ${fileName} from the active compose files`}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>

                      {inactiveConfigFiles.length > 0 ? (
                        <div className="compose-file-order__available">
                          <span className="metadata-note">Add:</span>
                          {inactiveConfigFiles.map((file) => {
                            const fileName = file.split(/[/\\]/).pop() ?? file;
                            return (
                              <button
                                type="button"
                                key={file}
                                className="chip-button"
                                title={file}
                                onClick={() => handleConfigFileToggle(file, true)}
                              >
                                <Plus size={12} />
                                {fileName}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}

              <div className="stage-meta">
                <span className="manifest-tag">{project.access}</span>
                <span className="manifest-tag">{project.runtimeKind}</span>
                <span className="metadata-note">{project.lastUpdatedLabel}</span>
              </div>
              <p className="graph-summary">
                {project.services.length} services, {dependencyCount} dependency edges, {networkCount} networks, {volumeCount} volumes
              </p>
            </div>
            <div className="toolbar-note-cluster">
              {!dockerStatus?.daemonAvailable && dockerStatus?.message ? (
                <span className="toolbar-note">{dockerStatus.message}</span>
              ) : null}
            </div>
          </div>

          <OperationPanel actions={project.actions} operation={operation} onAction={handleAction} />
          <ValidationPanel diagnostics={project.diagnostics} />

          <GraphView
            project={project}
            filterQuery={deferredQuery}
            selectedNodeId={selectedNodeId}
            layoutDirection={layoutDirection}
            fitNonce={fitNonce}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              setDetailTab("overview");
              setSettingsOpen(false);
            }}
            onClearSelection={() => setSelectedNodeId(undefined)}
          />
        </section>

        {settingsOpen && settings ? (
          <aside className="detail-panel">
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
        ) : null}

        {!settingsOpen && selectedService ? (
          <aside className="detail-panel">
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
              <Inspector
                service={selectedService}
                uptimeLabel={uptimeLabel}
                stats={statsState?.ok ? statsState.data : undefined}
              />
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
                            {entry.masked ? "••••••••" : entry.value}
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

        {!settingsOpen && !selectedService ? (
          <aside className="detail-panel detail-panel--empty">
            <p className="eyebrow">Detail Panel</p>
            <h3 className="panel-title">No service selected</h3>
            <p className="body-copy body-copy--secondary">
              Click a service node in the graph to inspect its overview, environment variables, mounts, and logs.
            </p>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
