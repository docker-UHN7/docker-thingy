import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import writeFileAtomic from "write-file-atomic";
import { copyFile } from "node:fs/promises";
import type { Result } from "../shared/contracts";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function saveSourceAtomically(
  sourcePath: string,
  nextText: string,
  expectedHash: string
): Promise<Result<{ hash: string; mtimeMs: number }>> {
  const currentText = await readFile(sourcePath, "utf8");
  const currentHash = sha256(currentText);

  if (currentHash !== expectedHash) {
    return {
      ok: false,
      error: {
        code: "SOURCE_CHANGED_EXTERNALLY",
        message: "The source file changed on disk before save could complete."
      }
    };
  }

  await copyFile(sourcePath, `${sourcePath}.docker-explorer.bak`);
  await writeFileAtomic(sourcePath, nextText, { fsync: true });

  const fileStat = await stat(sourcePath);

  return {
    ok: true,
    data: {
      hash: sha256(nextText),
      mtimeMs: fileStat.mtimeMs
    }
  };
}

