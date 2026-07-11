import type { ProjectDiagnostics } from "../shared/contracts";

type ValidationPanelProps = {
  diagnostics: ProjectDiagnostics[];
};

export function ValidationPanel({ diagnostics }: ValidationPanelProps) {
  if (diagnostics.length === 0) {
    return null;
  }

  return (
    <section className="validation-panel">
      <div className="diagnostic-list">
        {diagnostics.map((diagnostic, index) => (
          <div key={`${diagnostic.title}-${index}`} className={`diagnostic diagnostic--${diagnostic.level}`}>
            <strong>{diagnostic.title}</strong>
            <p className="body-copy body-copy--secondary">{diagnostic.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
