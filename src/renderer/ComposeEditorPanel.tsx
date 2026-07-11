import { CircleAlert, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "../shared/contracts";
import { distinguishingFileLabel, longestCommonPrefix } from "./compose-file-labels";
import { useAppStore } from "./store";

type ComposeEditorPanelProps = {
  project: ProjectSummary;
  onClose(): void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sourceText: string; hash: string };

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function ComposeEditorPanel({ project, onClose }: ComposeEditorPanelProps) {
  const readComposeFile = useAppStore((state) => state.readComposeFile);
  const saveComposeFile = useAppStore((state) => state.saveComposeFile);

  const editableFiles = useMemo(
    () => (project.allConfigFiles && project.allConfigFiles.length > 0 ? project.allConfigFiles : project.configFiles),
    [project.allConfigFiles, project.configFiles]
  );
  const commonFileNamePrefix = useMemo(
    () => longestCommonPrefix(editableFiles.map((file) => fileNameOf(file))),
    [editableFiles]
  );

  const [selectedFile, setSelectedFile] = useState(() => project.sourcePath ?? editableFiles[0] ?? "");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!editableFiles.includes(selectedFile) && editableFiles[0]) {
      setSelectedFile(editableFiles[0]);
    }
  }, [editableFiles, selectedFile]);

  useEffect(() => {
    if (!selectedFile) {
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });
    setSaveError(undefined);
    setConflict(false);
    setJustSaved(false);

    void readComposeFile(project.id, selectedFile).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setLoadState({ status: "error", message: result.error.message });
        return;
      }

      setLoadState({ status: "ready", sourceText: result.data.sourceText, hash: result.data.hash });
      setDraftText(result.data.sourceText);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, selectedFile]);

  const dirty = loadState.status === "ready" && draftText !== loadState.sourceText;

  async function handleSave(overrideHash?: string) {
    if (loadState.status !== "ready" || !selectedFile) {
      return;
    }

    setSaving(true);
    setSaveError(undefined);
    setConflict(false);

    const result = await saveComposeFile(project.id, selectedFile, draftText, overrideHash ?? loadState.hash);
    setSaving(false);

    if (!result.ok) {
      if (result.error.code === "SOURCE_CHANGED_EXTERNALLY") {
        setConflict(true);
      }
      setSaveError(result.error.message);
      return;
    }

    setLoadState({ status: "ready", sourceText: draftText, hash: result.data.hash });
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 2000);
  }

  async function handleOverwrite() {
    const latest = await readComposeFile(project.id, selectedFile);
    if (!latest.ok) {
      setSaveError(latest.error.message);
      return;
    }
    void handleSave(latest.data.hash);
  }

  function handleDiscard() {
    if (loadState.status === "ready") {
      setDraftText(loadState.sourceText);
      setSaveError(undefined);
      setConflict(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      if (dirty && !saving) {
        void handleSave();
      }
    }
  }

  return (
    <aside className="floating-panel detail-panel detail-panel--overlay detail-panel--editor">
      <div className="detail-panel__header">
        <div>
          <p className="eyebrow">Detail Panel</p>
          <h3 className="panel-title">Edit compose file</h3>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close editor">
          <X size={16} />
        </button>
      </div>

      {editableFiles.length > 1 ? (
        <select
          className="settings-select"
          value={selectedFile}
          onChange={(event) => setSelectedFile(event.target.value)}
          disabled={saving}
        >
          {editableFiles.map((file) => (
            <option key={file} value={file} title={file}>
              {distinguishingFileLabel(fileNameOf(file), commonFileNamePrefix)}
            </option>
          ))}
        </select>
      ) : (
        <span className="metadata-note" title={selectedFile}>
          {fileNameOf(selectedFile)}
        </span>
      )}

      {loadState.status === "loading" ? (
        <div className="detail-list__row detail-list__row--loading">
          <LoaderCircle size={14} className="busy spin" />
          <span className="mono-value">Loading file...</span>
        </div>
      ) : loadState.status === "error" ? (
        <div className="detail-list__row detail-list__row--error">
          <CircleAlert size={14} />
          <span className="mono-value">{loadState.message}</span>
        </div>
      ) : (
        <>
          <textarea
            className="compose-editor__textarea"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            disabled={saving}
          />

          {saveError ? (
            <div className="detail-list__row detail-list__row--error">
              <CircleAlert size={14} />
              <span className="mono-value">{saveError}</span>
            </div>
          ) : null}

          <div className="compose-editor__actions">
            {conflict ? (
              <button className="button button--danger" onClick={() => void handleOverwrite()} disabled={saving}>
                Overwrite with my changes
              </button>
            ) : null}
            <button className="button button--secondary" onClick={handleDiscard} disabled={!dirty || saving}>
              <RotateCcw size={14} />
              <span>Discard</span>
            </button>
            <button className="button button--primary" onClick={() => void handleSave()} disabled={!dirty || saving}>
              {saving ? <LoaderCircle size={14} className="busy spin" /> : <Save size={14} />}
              <span>{justSaved ? "Saved" : "Save"}</span>
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
