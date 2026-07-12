import { StreamLanguage } from "@codemirror/language";
import { yaml } from "@codemirror/lang-yaml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import CodeMirror from "@uiw/react-codemirror";
import { CircleAlert, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "../shared/contracts";
import { distinguishingFileLabel, longestCommonPrefix } from "./compose-file-labels";
import { useAppStore } from "./store";

type SourceEditorPanelProps = {
  project: ProjectSummary;
  theme: "dark" | "light";
  onClose(): void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sourceText: string; hash: string };

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function dirOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index === -1 ? "" : path.slice(0, index);
}

// Dockerfiles reached through a Compose service's build.dockerfile aren't
// necessarily named exactly "Dockerfile" - mirrors the check the main
// process uses to decide whether to run YAML validation before a save.
function isDockerfilePath(filePath: string): boolean {
  const name = fileNameOf(filePath).toLowerCase();
  return name === "dockerfile" || name.startsWith("dockerfile.") || name.endsWith(".dockerfile");
}

const dockerfileLanguage = StreamLanguage.define(dockerFile);

function languageExtensionFor(filePath: string) {
  return isDockerfilePath(filePath) ? dockerfileLanguage : yaml();
}

// react-codemirror reconfigures the whole editor (via a CodeMirror
// StateEffect.reconfigure) whenever the `extensions` array or `basicSetup`
// object it's handed is a *new reference* - it compares by identity, not
// deep equality. Passed as inline literals, both get a fresh reference on
// every render, so every unrelated re-render of this panel (e.g. a
// background docker-events sync updating `project`) was tearing down and
// rebuilding the search extension, silently closing an open Ctrl+F panel.
// Hoisting basicSetup to a module constant and memoizing the extensions
// array keeps their identity stable across renders.
const CODE_MIRROR_BASIC_SETUP = { tabSize: 2, highlightActiveLine: true, foldGutter: true };

// Two Dockerfiles resolved from different services often share the same
// basename ("Dockerfile" in both ./api and ./worker) - fall back to a
// project-relative path for any name that isn't unique in the list so the
// picker never shows two indistinguishable entries.
function labelForFile(filePath: string, siblings: string[], projectDir: string, commonPrefix: string): string {
  const name = fileNameOf(filePath);
  const isAmbiguous = siblings.filter((entry) => fileNameOf(entry) === name).length > 1;
  if (!isAmbiguous) {
    return distinguishingFileLabel(name, commonPrefix);
  }

  if (projectDir && filePath.startsWith(projectDir)) {
    return filePath.slice(projectDir.length).replace(/^[/\\]/, "").split(/[/\\]/).join("/");
  }

  return filePath;
}

export function SourceEditorPanel({ project, theme, onClose }: SourceEditorPanelProps) {
  const readSourceFile = useAppStore((state) => state.readSourceFile);
  const saveSourceFile = useAppStore((state) => state.saveSourceFile);

  const composeFiles = useMemo(
    () => (project.allConfigFiles && project.allConfigFiles.length > 0 ? project.allConfigFiles : project.configFiles),
    [project.allConfigFiles, project.configFiles]
  );
  const dockerfiles = useMemo(() => project.dockerfilePaths ?? [], [project.dockerfilePaths]);
  const editableFiles = useMemo(() => [...composeFiles, ...dockerfiles], [composeFiles, dockerfiles]);
  const projectDir = useMemo(() => dirOf(project.sourcePath ?? composeFiles[0] ?? ""), [project.sourcePath, composeFiles]);
  const composePrefix = useMemo(() => longestCommonPrefix(composeFiles.map((file) => fileNameOf(file))), [composeFiles]);

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

    void readSourceFile(project.id, selectedFile).then((result) => {
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
  const languageExtension = useMemo(() => languageExtensionFor(selectedFile), [selectedFile]);
  const cmExtensions = useMemo(() => [languageExtension], [languageExtension]);

  async function handleSave(overrideHash?: string) {
    if (loadState.status !== "ready" || !selectedFile) {
      return;
    }

    setSaving(true);
    setSaveError(undefined);
    setConflict(false);

    const result = await saveSourceFile(project.id, selectedFile, draftText, overrideHash ?? loadState.hash);
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
    const latest = await readSourceFile(project.id, selectedFile);
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
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
          <h3 className="panel-title">Edit source file</h3>
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
          {composeFiles.length > 0 ? (
            <optgroup label="Compose files">
              {composeFiles.map((file) => (
                <option key={file} value={file} title={file}>
                  {labelForFile(file, composeFiles, projectDir, composePrefix)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {dockerfiles.length > 0 ? (
            <optgroup label="Dockerfiles">
              {dockerfiles.map((file) => (
                <option key={file} value={file} title={file}>
                  {labelForFile(file, dockerfiles, projectDir, "")}
                </option>
              ))}
            </optgroup>
          ) : null}
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
          <div className="compose-editor__cm-wrapper" onKeyDown={handleKeyDown}>
            <CodeMirror
              value={draftText}
              height="420px"
              theme={theme}
              extensions={cmExtensions}
              onChange={setDraftText}
              editable={!saving}
              basicSetup={CODE_MIRROR_BASIC_SETUP}
            />
          </div>

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
