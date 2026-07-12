import { dialog } from "electron";
import { basename, dirname } from "node:path";
import type { BackupVolumeResult, RestoreVolumeResult } from "../shared/contracts";
import { PROCESS_LIMITS, execCommand } from "./process-runner";
import { isValidVolumeName } from "./validation";

// A throwaway container is the whole mechanism here (consistent with this
// codebase's "shell out to system tools" convention) - it mounts the named
// volume plus the host directory holding the archive, and tar does the rest.
// Never `sh -c` with the archive filename interpolated into it: it comes from
// a native file dialog, but that's still an untrusted string as far as shell
// parsing goes, so tar/docker always get it as its own argv element instead.
const BACKUP_IMAGE = "alpine:latest";

export async function backupVolume(volumeName: string): Promise<BackupVolumeResult> {
  if (!isValidVolumeName(volumeName)) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid volume name." } };
  }

  const dialogResult = await dialog.showSaveDialog({
    title: `Back up volume "${volumeName}"`,
    defaultPath: `${volumeName}-backup.tar.gz`
  });

  if (dialogResult.canceled || !dialogResult.filePath) {
    return { ok: true, data: { cancelled: true } };
  }

  const hostDir = dirname(dialogResult.filePath);
  const fileName = basename(dialogResult.filePath);

  try {
    await execCommand(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/data:ro`,
        "-v",
        `${hostDir}:/backup`,
        BACKUP_IMAGE,
        "tar",
        "czf",
        `/backup/${fileName}`,
        "-C",
        "/data",
        "."
      ],
      { timeoutMs: PROCESS_LIMITS.composeOperationMs, maxBytes: PROCESS_LIMITS.maxDiagnosticBytes, category: "compose-operation" }
    );

    return { ok: true, data: { filePath: dialogResult.filePath } };
  } catch (error) {
    return {
      ok: false,
      error: { code: "PROCESS_FAILED", message: error instanceof Error ? error.message : "Volume backup failed." }
    };
  }
}

export async function restoreVolume(volumeName: string): Promise<RestoreVolumeResult> {
  if (!isValidVolumeName(volumeName)) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid volume name." } };
  }

  const dialogResult = await dialog.showOpenDialog({
    title: `Restore volume "${volumeName}" from archive`,
    properties: ["openFile"],
    filters: [{ name: "Archive", extensions: ["tar.gz", "tgz", "tar"] }]
  });

  const archivePath = dialogResult.filePaths[0];
  if (dialogResult.canceled || !archivePath) {
    return { ok: true, data: { cancelled: true } };
  }

  const hostDir = dirname(archivePath);
  const fileName = basename(archivePath);

  try {
    // Extracts on top of whatever's already in the volume - it does not
    // clear existing content first, so a restore can't accidentally wipe
    // data the archive itself doesn't cover.
    await execCommand(
      "docker",
      ["run", "--rm", "-v", `${volumeName}:/data`, "-v", `${hostDir}:/backup:ro`, BACKUP_IMAGE, "tar", "xzf", `/backup/${fileName}`, "-C", "/data"],
      { timeoutMs: PROCESS_LIMITS.composeOperationMs, maxBytes: PROCESS_LIMITS.maxDiagnosticBytes, category: "compose-operation" }
    );

    return { ok: true, data: { restored: true } };
  } catch (error) {
    return {
      ok: false,
      error: { code: "PROCESS_FAILED", message: error instanceof Error ? error.message : "Volume restore failed." }
    };
  }
}
