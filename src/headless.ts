import * as os from "node:os";
import * as path from "node:path";
import { ProjectService } from "./main/project-service";
import { disableRemoteAccess, enableRemoteAccess } from "./main/remote-access-service";

// The Electron desktop app (src/main.ts) assumes a display server exists to
// create a BrowserWindow - not true on a CLI-only server, and Electron has no
// reliable fully-headless mode (even offscreen rendering typically still
// wants a display backend in practice). This entry point runs the same
// project/container/network-topology core and the remote-access HTTP(S)
// server directly under plain Node, with no Electron/window/display
// dependency at all. Run via `npm run headless -- --port 8443`.

type CliArgs = {
  port: number;
  host: string | undefined;
  projectPaths: string[];
  dataDir: string;
};

function defaultDataDir(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "docker-thingy");
}

function printUsage(): void {
  console.log(`Usage: npm run headless -- --port <number> [options]

Options:
  --port <number>       Port to listen on (required)
  --host <address>      Address to advertise in the shown URL (default: best-effort auto-detected)
  --project <path>      Path to a Compose project/Dockerfile to link (repeatable)
  --data-dir <path>     Directory to cache the TLS cert/key in (default: ${defaultDataDir()})
  --help                Show this message
`);
}

function parseArgs(argv: string[]): CliArgs {
  let port: number | undefined;
  let host: string | undefined;
  let dataDir = defaultDataDir();
  const projectPaths: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
        printUsage();
        process.exit(0);
        break;
      case "--port":
        port = Number(argv[++i]);
        break;
      case "--host":
        host = argv[++i];
        break;
      case "--project":
        projectPaths.push(argv[++i] ?? "");
        break;
      case "--data-dir":
        dataDir = argv[++i] ?? dataDir;
        break;
      default:
        console.error(`Unrecognized argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("A valid --port is required.");
    printUsage();
    process.exit(1);
  }

  return { port, host, projectPaths: projectPaths.filter((p) => p !== ""), dataDir };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectService = new ProjectService();

  for (const projectPath of args.projectPaths) {
    const result = await projectService.openSourcePath(projectPath);
    if (!result.ok) {
      console.error(`Failed to open ${projectPath}: ${result.error.message}`);
    }
  }

  try {
    await projectService.synchronizeSnapshot();
  } catch {
    // Keep the server running even if Docker is unavailable at startup.
  }
  projectService.startAutoSync();

  const status = await enableRemoteAccess(args.port, projectService, args.host, args.dataDir);
  if (!status.enabled) {
    throw new Error("Failed to start remote access.");
  }

  console.log(`docker-thingy headless server listening at ${status.url}`);
  console.log(
    "Keep this token secret - anyone with it gets full control over projects, containers, VMs, and network isolation."
  );

  const shutdown = () => {
    disableRemoteAccess();
    projectService.dispose();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
