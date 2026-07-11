import type { DockerHubSearchResult } from "../shared/contracts";

const SEARCH_TIMEOUT_MS = 6_000;
const MAX_RESULTS = 20;

// The legacy Docker Registry v1 search endpoint - still the one `docker
// search` itself calls, public and unauthenticated. There's no modern
// equivalent that returns the same simple {name, description, is_official,
// star_count} shape without registering for a Hub API token.
const SEARCH_URL = "https://index.docker.io/v1/search";

type RawSearchResult = {
  name?: unknown;
  description?: unknown;
  is_official?: unknown;
  is_automated?: unknown;
  star_count?: unknown;
};

function toSearchResult(entry: RawSearchResult): DockerHubSearchResult | undefined {
  if (typeof entry.name !== "string" || entry.name.trim() === "") {
    return undefined;
  }

  return {
    name: entry.name,
    description: typeof entry.description === "string" ? entry.description : "",
    isOfficial: entry.is_official === true,
    starCount: typeof entry.star_count === "number" ? entry.star_count : 0
  };
}

/**
 * Searches Docker Hub for image repositories matching `query`. Network
 * failures (offline, DNS, timeout) resolve to an empty list rather than
 * throwing - the catalog UI falls back to curated presets only, it doesn't
 * hard-fail the whole panel over a flaky connection.
 */
export async function searchDockerHub(query: string): Promise<DockerHubSearchResult[]> {
  const term = query.trim();
  if (term === "") {
    return [];
  }

  try {
    const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(term)}&n=${MAX_RESULTS}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { results?: unknown };
    if (!Array.isArray(payload.results)) {
      return [];
    }

    return payload.results
      .map((entry) => toSearchResult(entry as RawSearchResult))
      .filter((entry): entry is DockerHubSearchResult => entry !== undefined)
      .sort((a, b) => Number(b.isOfficial) - Number(a.isOfficial) || b.starCount - a.starCount)
      .slice(0, MAX_RESULTS);
  } catch {
    return [];
  }
}
