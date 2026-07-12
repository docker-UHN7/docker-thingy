import { CircleAlert, LoaderCircle, Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "../shared/contracts";
import { useAppStore } from "./store";

type ServiceFieldsPanelProps = {
  project: ProjectSummary;
  serviceName: string;
};

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

const RESTART_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "no", label: "no" },
  { value: "always", label: "always" },
  { value: "unless-stopped", label: "unless-stopped" },
  { value: "on-failure", label: "on-failure" }
];

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, entryIndex) => entryIndex !== index);
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((entry, entryIndex) => (entryIndex === index ? value : entry));
}

export function ServiceFieldsPanel({ project, serviceName }: ServiceFieldsPanelProps) {
  const getServiceFields = useAppStore((state) => state.getServiceFields);
  const updateServiceFields = useAppStore((state) => state.updateServiceFields);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [image, setImage] = useState("");
  const [restart, setRestart] = useState("");
  const [ports, setPorts] = useState<string[]>([]);
  const [volumes, setVolumes] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<Array<{ key: string; value: string }>>([]);
  const [dependsOn, setDependsOn] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [justSaved, setJustSaved] = useState(false);

  const otherServices = useMemo(
    () => project.services.filter((service) => service.name !== serviceName),
    [project.services, serviceName]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    setSaveError(undefined);
    setJustSaved(false);

    void getServiceFields(project.id, serviceName).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setLoadState({ status: "error", message: result.error.message });
        return;
      }

      const fields = result.data.fields;
      setImage(fields.image);
      setRestart(fields.restart);
      setPorts(fields.ports);
      setVolumes(fields.volumes);
      setEnvironment(Object.entries(fields.environment).map(([key, value]) => ({ key, value })));
      setDependsOn(new Set(fields.dependsOn));
      setLoadState({ status: "ready" });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, serviceName]);

  function toggleDependsOn(name: string) {
    setDependsOn((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(undefined);

    const result = await updateServiceFields(project.id, serviceName, {
      image,
      restart,
      ports: ports.map((entry) => entry.trim()).filter(Boolean),
      volumes: volumes.map((entry) => entry.trim()).filter(Boolean),
      dependsOn: [...dependsOn],
      environment: Object.fromEntries(
        environment.map((entry) => [entry.key.trim(), entry.value]).filter(([key]) => key !== "")
      )
    });

    setSaving(false);

    if (!result.ok) {
      setSaveError(result.error.message);
      return;
    }

    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 2000);
  }

  if (loadState.status === "loading") {
    return (
      <div className="detail-list__row detail-list__row--loading">
        <LoaderCircle size={14} className="busy spin" />
        <span className="mono-value">Loading fields...</span>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="detail-list__row detail-list__row--error">
        <CircleAlert size={14} />
        <span className="mono-value">{loadState.message}</span>
      </div>
    );
  }

  return (
    <div className="detail-stack service-fields">
      <div className="settings-field">
        <label className="eyebrow" htmlFor="service-fields-image">
          Image
        </label>
        <input
          id="service-fields-image"
          className="settings-input"
          value={image}
          placeholder="(built from a Dockerfile - no image tag)"
          onChange={(event) => setImage(event.target.value)}
        />
      </div>

      <div className="settings-field">
        <label className="eyebrow" htmlFor="service-fields-restart">
          Restart policy
        </label>
        <select
          id="service-fields-restart"
          className="settings-select"
          value={restart}
          onChange={(event) => setRestart(event.target.value)}
        >
          {RESTART_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

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

      <div className="service-fields__list">
        <p className="eyebrow">Volumes</p>
        {volumes.map((volume, index) => (
          <div key={index} className="service-fields__row">
            <input
              className="settings-input"
              value={volume}
              placeholder="my-volume:/data"
              onChange={(event) => setVolumes((current) => replaceAt(current, index, event.target.value))}
            />
            <button
              type="button"
              className="icon-button icon-button--tiny"
              aria-label="Remove volume"
              onClick={() => setVolumes((current) => removeAt(current, index))}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button type="button" className="chip-button" onClick={() => setVolumes((current) => [...current, ""])}>
          <Plus size={12} />
          <span>Add volume</span>
        </button>
      </div>

      <div className="service-fields__list">
        <p className="eyebrow">Environment</p>
        {environment.map((entry, index) => (
          <div key={index} className="service-fields__row">
            <div className="service-fields__env-inputs">
              <input
                className="settings-input"
                value={entry.key}
                placeholder="KEY"
                onChange={(event) =>
                  setEnvironment((current) => replaceAt(current, index, { ...entry, key: event.target.value }))
                }
              />
              <input
                className="settings-input"
                value={entry.value}
                placeholder="value"
                onChange={(event) =>
                  setEnvironment((current) => replaceAt(current, index, { ...entry, value: event.target.value }))
                }
              />
            </div>
            <button
              type="button"
              className="icon-button icon-button--tiny"
              aria-label="Remove environment variable"
              onClick={() => setEnvironment((current) => removeAt(current, index))}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="chip-button"
          onClick={() => setEnvironment((current) => [...current, { key: "", value: "" }])}
        >
          <Plus size={12} />
          <span>Add variable</span>
        </button>
      </div>

      {otherServices.length > 0 ? (
        <div className="service-fields__list">
          <p className="eyebrow">Depends on</p>
          {otherServices.map((service) => (
            <label key={service.id} className="settings-field">
              <span>{service.name}</span>
              <input type="checkbox" checked={dependsOn.has(service.name)} onChange={() => toggleDependsOn(service.name)} />
            </label>
          ))}
        </div>
      ) : null}

      {saveError ? (
        <div className="detail-list__row detail-list__row--error">
          <CircleAlert size={14} />
          <span className="mono-value">{saveError}</span>
        </div>
      ) : null}

      <button className="button button--primary" onClick={() => void handleSave()} disabled={saving}>
        {saving ? <LoaderCircle size={14} className="busy spin" /> : <Save size={14} />}
        <span>{justSaved ? "Saved" : "Save"}</span>
      </button>
    </div>
  );
}
