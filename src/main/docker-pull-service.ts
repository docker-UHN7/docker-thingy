import Docker from "dockerode";
import type { PullProgressEvent } from "../shared/contracts";

// dockerode picks the right default connection for the platform on its own
// (named pipe on Windows, unix socket on macOS/Linux) - same daemon the rest
// of the app already talks to via the `docker` CLI, just reached directly
// for this one operation so pull progress can be streamed live instead of
// only knowing "done" or "failed" at the end.
const docker = new Docker();

type RawProgressLine = {
  status?: string;
  id?: string;
  progressDetail?: { current?: number; total?: number };
};

/**
 * Pulls `image` via the Docker Engine API, invoking `onProgress` for every
 * progress line the daemon streams back (layer-by-layer download/extract
 * status). Resolves once the pull completes; rejects if the daemon can't be
 * reached or the pull itself fails (bad tag, network error, etc).
 */
export function pullImage(image: string, onProgress: (event: PullProgressEvent) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    docker
      .pull(image)
      .then((stream) => {
        docker.modem.followProgress(
          stream,
          (error: Error | null) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          },
          (line: RawProgressLine) => {
            onProgress({
              image,
              status: line.status ?? "",
              id: line.id,
              current: line.progressDetail?.current,
              total: line.progressDetail?.total
            });
          }
        );
      })
      .catch((error: unknown) => {
        reject(error instanceof Error ? error : new Error("Failed to start image pull."));
      });
  });
}
