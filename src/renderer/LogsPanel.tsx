import { Search } from "lucide-react";
import { useMemo, useState } from "react";

type LogsPanelProps = {
  lines: string[];
  fetchedAt?: string | undefined;
};

export function LogsPanel({ lines, fetchedAt }: LogsPanelProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return lines;
    }

    return lines.filter((line) => line.toLowerCase().includes(term));
  }, [lines, query]);

  return (
    <section className="detail-stack">
      <label className="search-input search-input--log">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter logs" />
      </label>
      {fetchedAt ? <p className="metadata-note">Fetched {new Date(fetchedAt).toLocaleTimeString()}</p> : null}
      <div className="log-console">
        {filtered.length === 0 ? (
          <div className="log-line">No log lines matched the current filter.</div>
        ) : (
          filtered.map((line, index) => (
            <div key={`${index}:${line.slice(0, 32)}`} className="log-line">
              {line}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
