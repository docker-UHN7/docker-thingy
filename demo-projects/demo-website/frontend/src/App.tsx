import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { apiUrl } from "./api";

type Fact = {
  id: number;
  text: string;
  emoji: string;
  created_at: string;
};

type Stats = {
  visits: number;
  factCount: number;
};

const EMOJI_OPTIONS = ["🍯", "🐙", "🦩", "🍌", "🗼", "🌿", "📚", "☕"];

export default function App() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [emoji, setEmoji] = useState("🌿");
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, factsRes] = await Promise.all([
        fetch(apiUrl("/api/stats")),
        fetch(apiUrl("/api/facts"))
      ]);

      if (!statsRes.ok || !factsRes.ok) {
        throw new Error("Could not load data");
      }

      const [statsData, factsData] = await Promise.all([
        statsRes.json() as Promise<Stats>,
        factsRes.json() as Promise<Fact[]>
      ]);

      setStats(statsData);
      setFacts(factsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!newFact.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/facts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newFact, emoji })
      });

      if (!response.ok) {
        throw new Error("Could not save");
      }

      setNewFact("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-5 py-12 sm:px-8">
      <header className="mb-12 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">Oddments</h1>
          <p className="mt-2 text-stone-500">Small facts, collected at random.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-3 text-sm font-medium text-stone-900 transition hover:bg-stone-100 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </header>

      {stats && (
        <p className="mb-8 text-sm text-stone-500">
          {stats.visits.toLocaleString()} visits · {stats.factCount.toLocaleString()} facts
        </p>
      )}

      <section className="mb-10 space-y-4">
        {loading && (
          <div className="flex items-center gap-2 py-8 text-stone-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {!loading &&
          !error &&
          facts.map((fact) => (
            <article
              key={fact.id}
              className="group flex gap-4 border-b border-stone-200/80 py-5 last:border-0"
            >
              <span className="mt-0.5 text-xl leading-none opacity-80">{fact.emoji}</span>
              <p className="text-[15px] leading-7 text-stone-800/90">{fact.text}</p>
            </article>
          ))}
      </section>

      <div className="rounded-xl border border-stone-200/80 bg-white shadow-sm">
        <div className="space-y-4 p-5">
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
            <input
              type="text"
              placeholder="Add something you learned"
              value={newFact}
              onChange={(event) => setNewFact(event.target.value)}
              maxLength={280}
              className="flex h-11 w-full rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700/30"
            />
            <div className="flex items-center justify-between gap-4">
              <div className="flex gap-1">
                {EMOJI_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setEmoji(option)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md text-base transition ${
                      emoji === option
                        ? "bg-stone-100 ring-1 ring-stone-200"
                        : "opacity-50 hover:opacity-100"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={submitting || !newFact.trim()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-green-700 px-4 text-sm font-medium text-white transition hover:bg-green-800 disabled:pointer-events-none disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Add
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}