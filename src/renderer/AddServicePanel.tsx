import { ArrowLeft, Check, ChevronRight, CircleAlert, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AddServiceConnection, DockerHubSearchResult, ProjectSummary } from "../shared/contracts";
import { findPresetForImageName, resolveConnectionEnv, searchPresets, type ServicePreset } from "../shared/service-presets";
import { useAppStore } from "./store";

type AddServicePanelProps = {
  project: ProjectSummary;
  onClose(): void;
};

type SelectionSource =
  | { kind: "preset"; preset: ServicePreset }
  | { kind: "hub"; result: DockerHubSearchResult; preset: ServicePreset | undefined };

type PullState =
  | { status: "idle" }
  | { status: "pulling"; message: string }
  | { status: "done" }
  | { status: "error"; message: string };

function slugifyServiceName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/^library\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 63);

  return slug || "service";
}

function uniqueServiceName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) {
    return base;
  }

  let index = 2;
  while (existing.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, entryIndex) => entryIndex !== index);
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((entry, entryIndex) => (entryIndex === index ? value : entry));
}

export function AddServicePanel({ project, onClose }: AddServicePanelProps) {
  const searchDockerHub = useAppStore((state) => state.searchDockerHub);
  const addServiceToProject = useAppStore((state) => state.addServiceToProject);

  const existingServiceNames = useMemo(() => new Set(project.services.map((service) => service.name)), [project.services]);

  const [query, setQuery] = useState("");
  const [hubResults, setHubResults] = useState<DockerHubSearchResult[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [selection, setSelection] = useState<SelectionSource | undefined>();

  const [serviceName, setServiceName] = useState("");
  const [image, setImage] = useState("");
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [ports, setPorts] = useState<string[]>([]);
  const [connectTo, setConnectTo] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [justAdded, setJustAdded] = useState(false);
  const [pullState, setPullState] = useState<PullState>({ status: "idle" });

  const presetMatches = useMemo(() => searchPresets(query), [query]);

  // Debounced Docker Hub search - only fires once the user has typed enough
  // to be worth a network round trip, and cancels a stale in-flight query if
  // they keep typing.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHubResults([]);
      setHubLoading(false);
      return;
    }

    let cancelled = false;
    setHubLoading(true);

    const timer = window.setTimeout(() => {
      void searchDockerHub(term).then((result) => {
        if (cancelled) {
          return;
        }
        setHubLoading(false);
        setHubResults(result.ok ? result.data.results : []);
      });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchDockerHub]);

  // Hub results that duplicate a curated preset (by image name) are folded
  // into the "Presets" section instead of showing the same service twice.
  const hubOnlyResults = useMemo(
    () => hubResults.filter((result) => !findPresetForImageName(result.name)),
    [hubResults]
  );

  function selectPreset(preset: ServicePreset) {
    setSelection({ kind: "preset", preset });
    setServiceName(uniqueServiceName(preset.defaultServiceName, existingServiceNames));
    setImage(preset.defaultImage);
    setEnvironment({ ...preset.environment });
    setPorts([`${preset.defaultPort}:${preset.defaultPort}`]);
    setConnectTo(new Set());
    setSubmitError(undefined);
    setJustAdded(false);
    setPullState({ status: "idle" });
  }

  function selectHubResult(result: DockerHubSearchResult) {
    const preset = findPresetForImageName(result.name);
    setSelection({ kind: "hub", result, preset });
    const baseName = slugifyServiceName(result.name.split("/").pop() ?? result.name);
    setServiceName(uniqueServiceName(preset?.defaultServiceName ?? baseName, existingServiceNames));
    setImage(preset?.defaultImage ?? `${result.name}:latest`);
    setEnvironment(preset ? { ...preset.environment } : {});
    setPorts(preset ? [`${preset.defaultPort}:${preset.defaultPort}`] : []);
    setConnectTo(new Set());
    setSubmitError(undefined);
    setJustAdded(false);
    setPullState({ status: "idle" });
  }

  function goBack() {
    setSelection(undefined);
    setSubmitError(undefined);
    setPullState({ status: "idle" });
  }

  // Pulls the just-added image in the background and streams live progress
  // into the panel - the service is already written to the compose file at
  // this point either way, this just gets the image warmed up so the first
  // `docker compose up` isn't waiting on a slow download.
  async function pullImageWithProgress(targetImage: string) {
    setPullState({ status: "pulling", message: "Starting pull..." });

    const unsubscribe = window.dockerExplorer.subscribePullProgress((event) => {
      if (event.image !== targetImage) {
        return;
      }

      const percent =
        event.current !== undefined && event.total !== undefined && event.total > 0
          ? ` ${Math.round((event.current / event.total) * 100)}%`
          : "";
      setPullState({ status: "pulling", message: `${event.status}${percent}` });
    });

    const result = await window.dockerExplorer.pullImage(targetImage);
    unsubscribe();

    setPullState(result.ok ? { status: "done" } : { status: "error", message: result.error.message });
  }

  function updateEnvValue(key: string, value: string) {
    setEnvironment((current) => ({ ...current, [key]: value }));
  }

  function toggleConnect(name: string) {
    setConnectTo((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  // Both selection variants carry a `preset` field (defined for a curated
  // pick, possibly undefined for a raw Docker Hub result with no match).
  const preset = selection?.preset;

  async function handleSubmit() {
    if (!selection) {
      return;
    }

    setSubmitting(true);
    setSubmitError(undefined);
    setPullState({ status: "idle" });

    const connections: AddServiceConnection[] = [...connectTo].map((targetName) => ({
      serviceName: targetName,
      environment: preset ? resolveConnectionEnv(preset, serviceName, environment) : {}
    }));

    const targetImage = image;

    // exactOptionalPropertyTypes rejects `key: undefined` for optional
    // fields - build the payload by only including keys that have a value,
    // rather than assigning `undefined` to them.
    const targetPorts = ports.map((entry) => entry.trim()).filter(Boolean);

    const result = await addServiceToProject(project.id, {
      serviceName,
      image: targetImage,
      connectTo: connections,
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
      ...(targetPorts.length > 0 ? { ports: targetPorts } : {}),
      ...(preset?.volumeMountPath
        ? { volumeName: `${serviceName}-data`, volumeMountPath: preset.volumeMountPath }
        : {})
    });

    setSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }

    // The service is written to the compose file either way - pulling the
    // image is best-effort background work from here on, so its own
    // success/failure never blocks or reopens the "add" flow.
    setJustAdded(true);
    void pullImageWithProgress(targetImage);
  }

  return (
    <aside className="floating-panel detail-panel detail-panel--overlay detail-panel--catalog">
      <div className="detail-panel__header">
        <div>
          <p className="eyebrow">Detail Panel</p>
          <h3 className="panel-title">Add service</h3>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close add service">
          <X size={16} />
        </button>
      </div>

      {!selection ? (
        <>
          <label className="search-input">
            <Search size={16} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search e.g. postgres, redis, mysql..."
            />
          </label>

          <div className="catalog-list">
            <p className="eyebrow">Presets</p>
            {presetMatches.length === 0 ? (
              <p className="metadata-note">No curated presets match &ldquo;{query}&rdquo;.</p>
            ) : (
              presetMatches.map((item) => (
                <button key={item.key} type="button" className="catalog-item" onClick={() => selectPreset(item)}>
                  <div className="catalog-item__body">
                    <span className="catalog-item__title">{item.name}</span>
                    <span className="metadata-note">{item.description}</span>
                  </div>
                  <ChevronRight size={14} />
                </button>
              ))
            )}

            {query.trim().length >= 2 ? (
              <>
                <p className="eyebrow">From Docker Hub</p>
                {hubLoading ? (
                  <div className="detail-list__row detail-list__row--loading">
                    <LoaderCircle size={14} className="busy spin" />
                    <span className="mono-value">Searching Docker Hub...</span>
                  </div>
                ) : hubOnlyResults.length === 0 ? (
                  <p className="metadata-note">No Docker Hub results.</p>
                ) : (
                  hubOnlyResults.map((result) => (
                    <button key={result.name} type="button" className="catalog-item" onClick={() => selectHubResult(result)}>
                      <div className="catalog-item__body">
                        <span className="catalog-item__title">
                          {result.name}
                          {result.isOfficial ? <span className="manifest-tag">official</span> : null}
                        </span>
                        <span className="metadata-note">{result.description || "No description"}</span>
                      </div>
                      <ChevronRight size={14} />
                    </button>
                  ))
                )}
              </>
            ) : null}
          </div>
        </>
      ) : (
        <div className="detail-stack">
          <button type="button" className="button button--secondary catalog-back" onClick={goBack}>
            <ArrowLeft size={14} />
            <span>Back to search</span>
          </button>

          <div className="settings-field">
            <label className="eyebrow" htmlFor="add-service-name">
              Service name
            </label>
            <input
              id="add-service-name"
              className="settings-input"
              value={serviceName}
              onChange={(event) => setServiceName(event.target.value)}
            />
          </div>

          <div className="settings-field">
            <label className="eyebrow" htmlFor="add-service-image">
              Image
            </label>
            <input
              id="add-service-image"
              className="settings-input"
              value={image}
              onChange={(event) => setImage(event.target.value)}
            />
          </div>

          {Object.keys(environment).length > 0 ? (
            <div className="detail-stack">
              <p className="eyebrow">Environment</p>
              {Object.entries(environment).map(([key, value]) => (
                <div key={key} className="settings-field">
                  <span className="mono-key">{key}</span>
                  <input className="settings-input" value={value} onChange={(event) => updateEnvValue(key, event.target.value)} />
                </div>
              ))}
            </div>
          ) : null}

          <div className="service-fields__list">
            <p className="eyebrow">Ports</p>
            {ports.map((port, index) => (
              <div key={index} className="service-fields__row">
                <input
                  className="settings-input"
                  value={port}
                  placeholder="8080:80"
                  onChange={(event) => setPorts((current) => replaceAt(current, index, event.target.value))}
                />
                <button
                  type="button"
                  className="icon-button icon-button--tiny"
                  aria-label="Remove port"
                  onClick={() => setPorts((current) => removeAt(current, index))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button type="button" className="chip-button" onClick={() => setPorts((current) => [...current, ""])}>
              <Plus size={12} />
              <span>Add port</span>
            </button>
          </div>

          {!preset ? (
            <p className="metadata-note">
              No curated preset for this image - it will be added with just the image name. Wire up environment
              variables or depends_on yourself afterward.
            </p>
          ) : null}

          {preset && project.services.length > 0 ? (
            <div className="detail-stack">
              <p className="eyebrow">Connect to</p>
              {project.services.map((service) => (
                <label key={service.id} className="settings-field">
                  <span>{service.name}</span>
                  <input type="checkbox" checked={connectTo.has(service.name)} onChange={() => toggleConnect(service.name)} />
                </label>
              ))}
              {connectTo.size > 0 ? (
                <p className="metadata-note">
                  Adds {Object.keys(preset.connectionEnv).join(", ")} to {[...connectTo].join(", ")}, and depends_on: {serviceName}.
                </p>
              ) : null}
            </div>
          ) : null}

          {submitError ? (
            <div className="detail-list__row detail-list__row--error">
              <CircleAlert size={14} />
              <span className="mono-value">{submitError}</span>
            </div>
          ) : null}

          {pullState.status === "pulling" ? (
            <div className="detail-list__row detail-list__row--loading">
              <LoaderCircle size={14} className="busy spin" />
              <span className="mono-value">Pulling {image}... {pullState.message}</span>
            </div>
          ) : pullState.status === "done" ? (
            <div className="detail-list__row">
              <Check size={14} />
              <span className="mono-value">Image ready.</span>
            </div>
          ) : pullState.status === "error" ? (
            <div className="detail-list__row detail-list__row--error">
              <CircleAlert size={14} />
              <span className="mono-value">Image pull failed: {pullState.message}</span>
            </div>
          ) : null}

          <button
            className="button button--primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || !serviceName.trim() || !image.trim()}
          >
            {submitting ? <LoaderCircle size={14} className="busy spin" /> : <Check size={14} />}
            <span>{justAdded ? "Added" : "Add service"}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
