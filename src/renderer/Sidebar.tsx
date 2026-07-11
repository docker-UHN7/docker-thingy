import { FolderPlus, FolderTree, LoaderCircle, MoonStar, Search, Settings, SunMedium, TriangleAlert, X } from "lucide-react";
import { useDeferredValue, useMemo, useState, type DragEvent } from "react";
import type { AppSettings, DockerStatus, ProjectSummary } from "../shared/contracts";
import { useAppStore } from "./store";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { deriveProjectLifecycle } from "./project-state";

type SidebarProps = {
  projects: ProjectSummary[];
  activeProjectId: string | undefined;
  dockerStatus: DockerStatus | undefined;
  loading: boolean;
  error: string | undefined;
  theme: "dark" | "light";
  onSelect(projectId: string): void;
  onOpenSource(): void;
  onOpenSourcePath(sourcePath: string): void;
  onOpenRecent(sourcePath: string): void;
  onToggleTheme(): void;
  recents: string[];
  recentLoadingPath?: string | undefined;
  settings?: AppSettings | undefined;
};

function middleTruncate(value: string, head = 20, tail = 16): string {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function isAcceptedSource(path: string): boolean {
  return /(?:docker-compose|compose)\.(?:ya?ml)$|(?:^|[\\/])Dockerfile$/i.test(path);
}

type FileWithPath = File & { path?: string };

type ProjectCardProps = {
  project: ProjectSummary;
  activeProjectId: string | undefined;
  dockerStatus: DockerStatus | undefined;
  staleHint: string;
  onSelect(projectId: string): void;
};

function ProjectCard({ project, activeProjectId, dockerStatus, staleHint, onSelect }: ProjectCardProps) {
  const location = project.sourcePath ?? project.configFiles[0] ?? "Runtime-only";
  const stale = !dockerStatus?.daemonAvailable;
  const lifecycle = deriveProjectLifecycle(project);
  const statusClass = lifecycle.state === "running" ? "running" : lifecycle.state === "crashed" ? "error" : "stopped";

  return (
    <button
      className={`project-card ${project.id === activeProjectId ? "project-card--active" : ""}`}
      onClick={() => onSelect(project.id)}
      title={stale ? staleHint : location}
    >
      <div className="project-card__head">
        <div className="project-card__title">
          <span
            className={`status-dot status-dot--${dockerStatus?.daemonAvailable ? statusClass : "stopped"} ${
              dockerStatus?.daemonAvailable ? "" : "status-dot--stale"
            } ${dockerStatus?.daemonAvailable && lifecycle.state === "running" ? "pulse" : ""}`}
          />
          <span>{project.title}</span>
        </div>
        <span className="mini-icon-button" aria-hidden="true">
          <FolderPlus size={14} />
        </span>
      </div>

      <p className="mono-path" title={location}>
        {middleTruncate(location, 24, 18)}
      </p>

      <div className="metadata-row">
        <span className="manifest-tag">{project.services.length} services</span>
        <span className="manifest-tag">{project.runtimeKind}</span>
        <span className="manifest-tag" title={stale ? staleHint : "Docker was reachable when this project was last checked."}>
          {stale ? "stale" : lifecycle.hasRuntimeMatch ? "runtime linked" : "source only"}
        </span>
      </div>

      <div className="project-card__foot">
        <span className="metadata-note">{project.contextName}</span>
        <span className="metadata-note">{project.lastUpdatedLabel}</span>
      </div>
    </button>
  );
}

type ProjectGroupCardProps = {
  groupLabel: string;
  projects: ProjectSummary[];
  activeProjectId: string | undefined;
  dockerStatus: DockerStatus | undefined;
  staleHint: string;
  onSelect(projectId: string): void;
};

// One card per folder scan that turned up multiple independent projects, with
// every member listed inline so the user can see (and jump straight to) any
// of them without drilling into the workspace first.
function ProjectGroupCard({ groupLabel, projects, activeProjectId, dockerStatus, staleHint, onSelect }: ProjectGroupCardProps) {
  const stale = !dockerStatus?.daemonAvailable;
  const containsActive = projects.some((project) => project.id === activeProjectId);

  return (
    <div className={`project-card project-card--group ${containsActive ? "project-card--active" : ""}`}>
      <div className="project-card__head">
        <div className="project-card__title">
          <FolderTree size={14} />
          <span>{groupLabel}</span>
        </div>
        <span className="manifest-tag">{projects.length} projects</span>
      </div>

      <p className="metadata-note">Independent Compose projects detected in this folder</p>

      <div className="project-group__members">
        {projects.map((project) => {
          const location = project.sourcePath ?? project.configFiles[0] ?? "Runtime-only";
          const lifecycle = deriveProjectLifecycle(project);
          const statusClass = lifecycle.state === "running" ? "running" : lifecycle.state === "crashed" ? "error" : "stopped";
          return (
            <button
              key={project.id}
              className={`project-group__member ${project.id === activeProjectId ? "project-group__member--active" : ""}`}
              onClick={() => onSelect(project.id)}
              title={stale ? staleHint : location}
            >
              <span
                className={`status-dot status-dot--${dockerStatus?.daemonAvailable ? statusClass : "stopped"} ${
                  dockerStatus?.daemonAvailable ? "" : "status-dot--stale"
                } ${dockerStatus?.daemonAvailable && lifecycle.state === "running" ? "pulse" : ""}`}
              />
              <span className="project-group__member-title">{project.title}</span>
              <span className="metadata-note">{project.services.length} svc</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type LauncherEntry =
  | { kind: "single"; project: ProjectSummary }
  | { kind: "group"; groupId: string; groupLabel: string; projects: ProjectSummary[] };

// Sibling projects discovered from the same folder scan (e.g. docker-compose-auth.yml
// and docker-compose-payment.yml side by side) share a groupId. Folding them into one
// launcher entry keeps the sidebar from filling up with cards for what's really one
// folder, while still surfacing every project inside it at a glance.
function groupProjectsForLauncher(projects: ProjectSummary[]): LauncherEntry[] {
  const groupSizes = new Map<string, number>();
  for (const project of projects) {
    if (project.groupId) {
      groupSizes.set(project.groupId, (groupSizes.get(project.groupId) ?? 0) + 1);
    }
  }

  const entries: LauncherEntry[] = [];
  const seenGroups = new Set<string>();

  for (const project of projects) {
    if (project.groupId && (groupSizes.get(project.groupId) ?? 0) > 1) {
      if (seenGroups.has(project.groupId)) {
        continue;
      }
      seenGroups.add(project.groupId);
      entries.push({
        kind: "group",
        groupId: project.groupId,
        groupLabel: project.groupLabel ?? project.groupId,
        projects: projects.filter((entry) => entry.groupId === project.groupId)
      });
    } else {
      entries.push({ kind: "single", project });
    }
  }

  return entries;
}

export function Sidebar({
  projects,
  activeProjectId,
  dockerStatus,
  loading,
  error,
  theme,
  onSelect,
  onOpenSource,
  onOpenSourcePath,
  onOpenRecent,
  onToggleTheme,
  recents,
  recentLoadingPath,
  settings
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearRecents = useAppStore((state) => state.clearRecents);
  const deferredQuery = useDeferredValue(query);
  const filteredProjects = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    if (!term) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = [
        project.title,
        project.subtitle,
        project.sourcePath,
        ...project.configFiles,
        ...project.services.flatMap((service) => [service.name, service.image, ...service.ports])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [deferredQuery, projects]);
  const launcherEntries = useMemo(() => groupProjectsForLauncher(filteredProjects), [filteredProjects]);
  const showDaemonBanner = !dockerStatus?.daemonAvailable && !bannerDismissed;
  const showHeaderPrimary = projects.length > 0;
  const staleHint = dockerStatus?.checkedAt
    ? `Docker was unreachable when this was last checked - showing cached data from ${new Date(dockerStatus.checkedAt).toLocaleString()}.`
    : "Docker was unreachable when this was last checked - showing cached data.";

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files) as FileWithPath[];
    const accepted = files.find((file) => file.path && isAcceptedSource(file.path));
    if (accepted?.path) {
      onOpenSourcePath(accepted.path);
    }
  }

  return (
    <main className="launcher-screen">
      <header className="topbar topbar--launcher">
        <div className="brand-lockup">
          <div className="brand-mark">DG</div>
          <h1 className="brand-title">Docker Graph</h1>
        </div>

        <div className="topbar__controls">
          <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {showDaemonBanner ? (
        <div className="daemon-banner">
          <div className="daemon-banner__copy">
            <span className="status-dot status-dot--warning" />
            <span>Docker daemon not detected. Start Docker to see live container status.</span>
          </div>
          <div className="daemon-banner__actions">
            <button className="icon-button" onClick={() => setBannerDismissed(true)} aria-label="Dismiss banner">
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}

      <section className="launcher-content">
        <div className="launcher-header">
          <div>
            <p className="eyebrow">Project Selector</p>
            <h2 className="screen-title">Projects</h2>
          </div>
          {showHeaderPrimary ? (
            <button className="button button--primary" onClick={onOpenSource}>
              <FolderPlus size={16} />
              <span>Add Project</span>
            </button>
          ) : null}
        </div>

        <div className="launcher-tools">
          <label className="search-input" aria-label="Search projects">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects..." />
          </label>

          <div className="launcher-meta">
            <span className="toolbar-note">{loading ? "Syncing Docker runtime..." : "Watching Docker runtime"}</span>
          </div>
        </div>

        <div
          className={`launcher-dropzone ${dropActive ? "launcher-dropzone--active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleDrop}
        >
          {loading && projects.length === 0 ? (
            <div className="empty-dropzone">
              <LoaderCircle size={28} className="busy spin" />
              <p>Looking for Docker Compose projects and running containers...</p>
            </div>
          ) : filteredProjects.length === 0 && projects.length === 0 ? (
            <div className="empty-dropzone">
              <FolderPlus size={28} className="empty-dropzone__icon" />
              <div>
                <p className="body-copy">Drop a docker-compose.yml, compose.yaml, or Dockerfile here</p>
                <p className="metadata-note">
                  Or click "Add Project" to browse for one. Running containers appear automatically once Docker is
                  detected.
                </p>
              </div>
              <button className="button button--primary" onClick={onOpenSource}>
                <FolderPlus size={16} />
                <span>Add Project</span>
              </button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="empty-dropzone">
              <p className="body-copy">No projects match "{query}".</p>
              <p className="metadata-note">Try a different search term, or clear the search to see all projects.</p>
            </div>
          ) : (
            <div className="project-grid">
              {launcherEntries.map((entry) =>
                entry.kind === "single" ? (
                  <ProjectCard
                    key={entry.project.id}
                    project={entry.project}
                    activeProjectId={activeProjectId}
                    dockerStatus={dockerStatus}
                    staleHint={staleHint}
                    onSelect={onSelect}
                  />
                ) : (
                  <ProjectGroupCard
                    key={entry.groupId}
                    groupLabel={entry.groupLabel}
                    projects={entry.projects}
                    activeProjectId={activeProjectId}
                    dockerStatus={dockerStatus}
                    staleHint={staleHint}
                    onSelect={onSelect}
                  />
                )
              )}
            </div>
          )}
        </div>

        <section className="recent-strip">
          <div className="recent-strip__header">
            <p className="eyebrow">Recent Sources</p>
          </div>
          {recents.length === 0 ? (
            <p className="metadata-note">Opened Compose files and Dockerfiles will appear here.</p>
          ) : (
            <div className="recent-list">
              {recents.slice(0, 6).map((recent) => {
                const pending = recentLoadingPath === recent;
                return (
                  <button
                    key={recent}
                    className="recent-item recent-item--button mono-path"
                    title={recent}
                    onClick={() => onOpenRecent(recent)}
                    disabled={pending}
                  >
                    {pending ? <LoaderCircle size={14} className="busy spin" /> : null}
                    <span>{middleTruncate(recent, 26, 18)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </section>

      {settingsOpen && settings ? (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <aside className="settings-modal" onClick={(event) => event.stopPropagation()}>
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
        </div>
      ) : null}
    </main>
  );
}
