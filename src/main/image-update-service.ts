import type { ImageUpdateInfo } from "../shared/contracts";
import { PROCESS_LIMITS, execCommand } from "./process-runner";

const HUB_TIMEOUT_MS = 6_000;

type HubImageRef = { namespace: string; repo: string; tag: string };

/**
 * Docker Hub only - the same scope docker-hub-service.ts's search already
 * has. A digest-pinned reference (`image@sha256:...`) has nothing to "update"
 * to, and anything with a registry host component (a dot/colon/`localhost`
 * before the first slash) points somewhere this Hub-only check can't reach.
 */
export function parseHubImageRef(image: string): HubImageRef | undefined {
  if (image.includes("@")) {
    return undefined;
  }

  const lastColon = image.lastIndexOf(":");
  const lastSlash = image.lastIndexOf("/");
  const hasTag = lastColon > lastSlash;
  const namePart = hasTag ? image.slice(0, lastColon) : image;
  const tag = hasTag ? image.slice(lastColon + 1) : "latest";

  if (namePart === "" || tag === "") {
    return undefined;
  }

  const segments = namePart.split("/");
  const firstSegment = segments[0];
  if (segments.length > 1 && firstSegment && (firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost")) {
    return undefined;
  }

  if (segments.length === 1) {
    return { namespace: "library", repo: segments[0] ?? "", tag };
  }
  if (segments.length === 2 && segments[1]) {
    return { namespace: segments[0] ?? "", repo: segments[1], tag };
  }

  return undefined;
}

async function fetchRemoteDigest(ref: HubImageRef): Promise<string | undefined> {
  try {
    const response = await fetch(
      `https://hub.docker.com/v2/repositories/${encodeURIComponent(ref.namespace)}/${encodeURIComponent(ref.repo)}/tags/${encodeURIComponent(ref.tag)}`,
      { signal: AbortSignal.timeout(HUB_TIMEOUT_MS) }
    );
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as { digest?: unknown; images?: Array<{ digest?: unknown }> };
    if (typeof payload.digest === "string") {
      return payload.digest;
    }
    const firstImage = Array.isArray(payload.images) ? payload.images[0] : undefined;
    return typeof firstImage?.digest === "string" ? firstImage.digest : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLocalDigest(image: string): Promise<string | undefined> {
  try {
    const result = await execCommand("docker", ["image", "inspect", image, "--format", "{{json .RepoDigests}}"], {
      timeoutMs: PROCESS_LIMITS.capabilityCheckMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "capability-check"
    });

    const digests = JSON.parse(result.stdout.trim() || "[]") as unknown;
    if (!Array.isArray(digests)) {
      return undefined;
    }

    const repo = image.split("@")[0]?.split(":")[0];
    const match = digests.find((entry): entry is string => typeof entry === "string" && entry.startsWith(`${repo}@`)) ?? digests[0];
    return typeof match === "string" ? match.split("@")[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Undefined when `image` isn't a plain Docker Hub reference this check can resolve (a pinned digest, a non-Hub registry, or the tag/local image can't be found). */
export async function checkImageUpdate(image: string): Promise<ImageUpdateInfo | undefined> {
  const ref = parseHubImageRef(image);
  if (!ref) {
    return undefined;
  }

  const [remoteDigest, localDigest] = await Promise.all([fetchRemoteDigest(ref), fetchLocalDigest(image)]);

  return {
    image,
    updateAvailable: Boolean(remoteDigest && localDigest && remoteDigest !== localDigest),
    remoteDigest,
    localDigest,
    checkedAt: new Date().toISOString()
  };
}
