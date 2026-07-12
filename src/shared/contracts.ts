import * as z from "zod";

export const ComposeListRecordSchema = z.looseObject({
  Name: z.string(),
  Status: z.string().optional(),
  ConfigFiles: z.string().optional()
});

export const ContainerInspectSchema = z.looseObject({
  Id: z.string(),
  Name: z.string().optional(),
  Config: z
    .looseObject({
      Image: z.string().optional(),
      Env: z.array(z.string()).optional(),
      // Docker returns null (not just an omitted key) for these when unset -
      // e.g. an image with no Dockerfile CMD, or no explicit ENTRYPOINT.
      Cmd: z.array(z.string()).nullish(),
      Entrypoint: z.array(z.string()).nullish(),
      WorkingDir: z.string().optional(),
      Labels: z.record(z.string(), z.string()).optional(),
      ExposedPorts: z.record(z.string(), z.unknown()).optional()
    })
    .optional(),
  State: z
    .looseObject({
      Status: z.string().optional(),
      Running: z.boolean().optional(),
      Restarting: z.boolean().optional(),
      OOMKilled: z.boolean().optional(),
      ExitCode: z.number().optional(),
      Error: z.string().optional(),
      StartedAt: z.string().optional(),
      FinishedAt: z.string().optional(),
      Health: z
        .looseObject({
          Status: z.string().optional(),
          FailingStreak: z.number().optional(),
          Log: z
            .array(
              z.looseObject({
                Start: z.string().optional(),
                End: z.string().optional(),
                ExitCode: z.number().optional(),
                Output: z.string().optional()
              })
            )
            .optional()
        })
        .optional()
    })
    .optional(),
  Mounts: z
    .array(
      z.looseObject({
        Type: z.string().optional(),
        Name: z.string().optional(),
        Source: z.string().optional(),
        Destination: z.string().optional(),
        Mode: z.string().optional(),
        RW: z.boolean().optional()
      })
    )
    .optional(),
  HostConfig: z
    .looseObject({
      Memory: z.number().optional(),
      NanoCpus: z.number().optional(),
      RestartPolicy: z
        .looseObject({
          Name: z.string().optional(),
          MaximumRetryCount: z.number().optional()
        })
        .optional()
    })
    .optional(),
  NetworkSettings: z
    .looseObject({
      Ports: z
        .record(
          z.string(),
          z
            .array(
              z.looseObject({
                HostIp: z.string().optional(),
                HostPort: z.string().optional()
              })
            )
            .nullable()
            .optional()
        )
        .optional(),
      Networks: z
        .record(
          z.string(),
          z.looseObject({
            IPAddress: z.string().optional(),
            Gateway: z.string().optional(),
            MacAddress: z.string().optional(),
            // Docker returns null here (not [] or an omitted key) when no
            // aliases are set, which is the common case.
            Aliases: z.array(z.string()).nullish()
          })
        )
        .optional()
    })
    .optional()
});

export const DockerStatusSchema = z.object({
  cliAvailable: z.boolean(),
  daemonAvailable: z.boolean(),
  composeAvailable: z.boolean(),
  buildxAvailable: z.boolean(),
  contextName: z.string().optional(),
  serverVersion: z.string().optional(),
  composeVersion: z.string().optional(),
  buildxVersion: z.string().optional(),
  message: z.string().optional(),
  checkedAt: z.string().optional()
});

export type DockerStatus = z.infer<typeof DockerStatusSchema>;

export type ProjectAccess = "editable" | "read-only" | "runtime-only";
export type RuntimeKind = "compose" | "container" | "dockerfile";
export type ThemeMode = "light" | "dark" | "system";
export type PortState = "published" | "exposed" | "declared";
export type DockerHealth = "healthy" | "unhealthy" | "starting" | "none";

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code:
          | "INVALID_DOCKER_OUTPUT"
          | "PROCESS_FAILED"
          | "TIMEOUT"
          | "SOURCE_CHANGED_EXTERNALLY"
          | "VALIDATION_FAILED"
          | "OPERATION_IN_PROGRESS"
          | "CANCELLED";
        message: string;
        details?: string | undefined;
      };
    };

export type PortMapping = {
  id: string;
  hostIp?: string | undefined;
  hostPort?: string | undefined;
  containerPort: number;
  protocol: string;
  state: PortState;
  source: "runtime" | "compose";
  label: string;
};

export type DependencyDescriptor = {
  serviceName: string;
  condition?: string | undefined;
  external?: boolean | undefined;
};

export type RuntimeContainer = {
  id: string;
  shortId: string;
  name: string;
  serviceName?: string | undefined;
  image?: string | undefined;
  status: string;
  running: boolean;
  healthStatus?: DockerHealth | undefined;
  restartCount?: number | undefined;
};

export type EnvVarRecord = {
  key: string;
  value: string;
  masked: boolean;
};

export type MountRecord = {
  type: "volume" | "bind" | "tmpfs" | "unknown";
  name?: string | undefined;
  source: string;
  destination: string;
  mode: string;
  rw: boolean;
};

export type NetworkAttachment = {
  name: string;
  ipAddress?: string | undefined;
  gateway?: string | undefined;
  macAddress?: string | undefined;
  aliases: string[];
  external?: boolean | undefined;
};

export type ResourceLimits = {
  memoryBytes?: number | undefined;
  nanoCpus?: number | undefined;
  restartPolicyName?: string | undefined;
  restartRetryCount?: number | undefined;
};

export type HealthLogEntry = {
  start?: string | undefined;
  end?: string | undefined;
  exitCode?: number | undefined;
  output?: string | undefined;
};

export type RuntimeState = {
  status: string;
  running: boolean;
  restarting: boolean;
  oomKilled: boolean;
  exitCode?: number | undefined;
  error?: string | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  healthStatus?: DockerHealth | undefined;
  healthFailingStreak?: number | undefined;
  healthLog?: HealthLogEntry[] | undefined;
};

export type ContainerDetails = {
  containerId: string;
  image?: string | undefined;
  env: EnvVarRecord[];
  mounts: MountRecord[];
  networks: NetworkAttachment[];
  labels: Record<string, string>;
  runtimeState: RuntimeState;
  resources: ResourceLimits;
  command: string[];
  entrypoint: string[];
  workingDir?: string | undefined;
  ports: PortMapping[];
};

export type ServiceNodeModel = {
  id: string;
  name: string;
  image?: string | undefined;
  status: "running" | "stopped" | "unknown" | "starting" | "unhealthy";
  healthStatus?: DockerHealth | undefined;
  dependencies: string[];
  dependencyDetails: DependencyDescriptor[];
  ports: string[];
  portMappings: PortMapping[];
  categories: {
    containers: RuntimeContainer[];
    networks: string[];
    volumes: string[];
  };
  declaredNetworks: string[];
  details?: ContainerDetails | undefined;
  sourceHints?: {
    buildContext?: string | undefined;
    dockerfilePath?: string | undefined;
    expose?: number[] | undefined;
  };
};

export type ProjectDiagnostics = {
  level: "info" | "warning" | "error";
  title: string;
  message: string;
};

export type ProjectAction = {
  id: "open-source" | "validate" | "start" | "apply-start" | "stop" | "build-image";
  label: string;
  emphasis?: "primary" | "danger" | "neutral" | undefined;
  disabled?: boolean | undefined;
  confirmation?: string | undefined;
};

export type GraphExternalNode = {
  id: string;
  kind: "service" | "volume" | "network";
  name: string;
};

export type RelationshipEdge = {
  from: string;
  to: string;
  kind: "depends_on" | "network" | "volume" | "inferred";
  condition?: "service_started" | "service_healthy" | "service_completed_successfully" | undefined;
  label?: string | undefined;
  inferred: boolean;
};

export type ProjectSummary = {
  id: string;
  title: string;
  subtitle: string;
  runtimeKind: RuntimeKind;
  access: ProjectAccess;
  contextName: string;
  composeProjectName?: string | undefined;
  sourcePath?: string | undefined;
  configFiles: string[];
  allConfigFiles?: string[];
  dockerfilePaths?: string[];
  groupId?: string | undefined;
  groupLabel?: string | undefined;
  services: ServiceNodeModel[];
  diagnostics: ProjectDiagnostics[];
  actions: ProjectAction[];
  buildStatus: "not-built" | "built";
  lastUpdatedLabel: string;
  lastCheckedAt?: string | undefined;
  externalNodes: GraphExternalNode[];
  relationshipEdges: RelationshipEdge[];
  sourceLinked?: boolean | undefined;
};

export type SourceSession = {
  id: string;
  sourcePath: string;
  revision: number;
  lastKnownHash: string;
  diffPreview: string;
};

export const AppSettingsSchema = z.object({
  themeMode: z.enum(["light", "dark", "system"]),
  statsPollSeconds: z.number().int().positive().nullable(),
  logTailLines: z.number().int().positive().max(10_000)
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export type AppSnapshot = {
  dockerStatus: DockerStatus;
  projects: ProjectSummary[];
  recents: string[];
  settings: AppSettings;
  activeProjectId?: string | undefined;
  activeSourceSession?: SourceSession | undefined; 
};

export type OpenSourceResult = Result<ProjectSummary>;
export type LogSnapshotResult = Result<{
  containerId: string;
  lines: string[];
  fetchedAt: string;
}>;

export type ContainerStats = {
  containerId: string;
  cpuPercent?: number | undefined;
  memoryUsageBytes?: number | undefined;
  memoryLimitBytes?: number | undefined;
  memoryPercent?: number | undefined;
  fetchedAt: string;
};

export type StatsSnapshotResult = Result<ContainerStats>;

export type ValidationOutcome = {
  ok: boolean;
  title: string;
  detail: string;
};

export type BuildTarget = {
  name: string;
  isDefault: boolean;
  description?: string | undefined;
};

export type OperationStream = "stdout" | "stderr";

export type ExecutableProjectActionId = "validate" | "start" | "apply-start" | "stop" | "build-image";

export type OperationEvent =
  | {
      kind: "status";
      projectId: string;
      operationId: string;
      actionId: ExecutableProjectActionId;
      status: "running" | "success" | "failed";
      startedAt: string;
      finishedAt?: string | undefined;
      errorMessage?: string | undefined;
    }
  | {
      kind: "output";
      projectId: string;
      operationId: string;
      actionId: ExecutableProjectActionId;
      stream: OperationStream;
      line: string;
    };

export type ProjectActionResult = Result<{
  operationId: string;
  outcome: ValidationOutcome;
  snapshot: AppSnapshot;
}>;

export type CancelActionResult = Result<{ cancelled: true }>;

export type ReadSourceFileResult = Result<{ sourceText: string; hash: string }>;
export type SaveSourceFileResult = Result<{ hash: string; snapshot: AppSnapshot }>;

export type AddServiceConnection = {
  serviceName: string;
  environment: Record<string, string>;
};

export type AddServiceInput = {
  serviceName: string;
  image: string;
  environment?: Record<string, string>;
  ports?: string[];
  volumeName?: string;
  volumeMountPath?: string;
  connectTo?: AddServiceConnection[];
};

export type AddServiceResult = Result<{ snapshot: AppSnapshot; serviceName: string }>;

export type DockerHubSearchResult = {
  name: string;
  description: string;
  isOfficial: boolean;
  starCount: number;
};

export type SearchDockerHubResult = Result<{ results: DockerHubSearchResult[] }>;

export type RemoveServiceResult = Result<{ snapshot: AppSnapshot; serviceName: string }>;

// The graphical fields the side-panel "Edit" tab exposes for a Compose
// service. Read/written straight from the service's block in the compose
// file - not the same as ServiceNodeModel, which is a merged, display-ready
// projection built from every active file and (for ports/volumes) already
// lossy in ways that make it unsuitable for editing.
export type ServiceFields = {
  image: string;
  restart: string;
  ports: string[];
  volumes: string[];
  dependsOn: string[];
  environment: Record<string, string>;
};

export type ServiceFieldsInput = Partial<ServiceFields>;

export type GetServiceFieldsResult = Result<{ fields: ServiceFields }>;
export type UpdateServiceFieldsResult = Result<{ snapshot: AppSnapshot }>;

// A project mutation that only ever needs to hand back the refreshed
// snapshot - used by the graph view's click-to-disconnect actions.
export type SnapshotMutationResult = Result<{ snapshot: AppSnapshot }>;

// Streamed while an image pull (dockerode) is in flight - `image` lets
// listeners with several pulls potentially in flight filter to the one they
// care about. `current`/`total` are byte counts for the layer named by `id`,
// straight from the Docker Engine API's own progress payload.
export type PullProgressEvent = {
  image: string;
  status: string;
  id?: string | undefined;
  current?: number | undefined;
  total?: number | undefined;
};

export type PullImageResult = Result<{ pulled: true }>;

// Container shell/exec - line-buffered stdin/stdout streaming over a spawned
// `docker exec -i <id> sh`, not a real pty (no node-pty dependency). Good
// enough for running ordinary commands; curses-style programs (vim, top)
// won't render correctly since there's no TTY on either end.
export type ExecOutputEvent = {
  sessionId: string;
  stream: "stdout" | "stderr";
  chunk: string;
};

export type ExecExitEvent = {
  sessionId: string;
  exitCode: number | null;
};

// Config drift: a running container's actual state vs. what the main
// compose file declares for that service. Only covers services declared in
// the project's main config file (same limitation getServiceFields already
// has for override files).
export type DriftFinding = {
  serviceName: string;
  field: "image" | "restart" | "environment";
  declared: string;
  actual: string;
};

export type ConfigDriftResult = Result<{ findings: DriftFinding[] }>;

export type ImageUpdateInfo = {
  image: string;
  updateAvailable: boolean;
  remoteDigest?: string | undefined;
  localDigest?: string | undefined;
  checkedAt: string;
};

export type CheckImageUpdateResult = Result<{ info: ImageUpdateInfo | undefined }>;

export type BackupVolumeResult = Result<{ cancelled: true } | { filePath: string }>;
export type RestoreVolumeResult = Result<{ cancelled: true } | { restored: true }>;

export type PreloadApi = {
  // Routed through here rather than the web Clipboard API directly - the
  // Electron BrowserWindow denies every permission request/check (see
  // main.ts), which includes clipboard-write, so navigator.clipboard.writeText
  // throws NotAllowedError there. Electron's own `clipboard` module (used by
  // preload.ts's implementation) isn't gated by that check.
  copyToClipboard(text: string): Promise<void>;
  // File.path was removed from dropped File objects in newer Electron
  // versions when contextIsolation is on - webUtils.getPathForFile is the
  // replacement, and it has to be called from the preload (webUtils is on
  // the sandboxed preload allowlist, File.path resolution is not exposed to
  // the renderer directly).
  getPathForFile(file: File): string;
  getSnapshot(): Promise<AppSnapshot>;
  openSource(): Promise<OpenSourceResult>;
  createProject(): Promise<OpenSourceResult>;
  openSourcePath(sourcePath: string): Promise<OpenSourceResult>;
  openRecentSource(sourcePath: string): Promise<OpenSourceResult>;
  touchRecentProject(projectId: string): Promise<AppSnapshot>;
  openExternalUrl(url: string): Promise<void>;
  getServiceLogs(containerId: string, tail: number): Promise<LogSnapshotResult>;
  getServiceStats(containerId: string): Promise<StatsSnapshotResult>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSnapshot>;
  clearRecents(): Promise<AppSnapshot>;
  updateProjectConfigFiles(projectId: string, configFiles: string[]): Promise<AppSnapshot>;
  readSourceFile(projectId: string, filePath: string): Promise<ReadSourceFileResult>;
  saveSourceFile(
    projectId: string,
    filePath: string,
    sourceText: string,
    expectedHash: string
  ): Promise<SaveSourceFileResult>;
  searchDockerHub(query: string): Promise<SearchDockerHubResult>;
  addServiceToProject(projectId: string, input: AddServiceInput): Promise<AddServiceResult>;
  removeServiceFromProject(projectId: string, serviceName: string): Promise<RemoveServiceResult>;
  getServiceFields(projectId: string, serviceName: string): Promise<GetServiceFieldsResult>;
  updateServiceFields(
    projectId: string,
    serviceName: string,
    fields: ServiceFieldsInput
  ): Promise<UpdateServiceFieldsResult>;
  disconnectDependency(projectId: string, fromService: string, toService: string): Promise<SnapshotMutationResult>;
  disconnectVolumeMount(projectId: string, serviceName: string, volumeName: string): Promise<SnapshotMutationResult>;
  pullImage(image: string): Promise<PullImageResult>;
  runProjectAction(projectId: string, actionId: ProjectAction["id"]): Promise<ProjectActionResult>;
  cancelProjectAction(projectId: string): Promise<CancelActionResult>;
  subscribeBuildEvents(listener: (event: OperationEvent) => void): () => void;
  subscribeSnapshotEvents(listener: (snapshot: AppSnapshot) => void): () => void;
  subscribePullProgress(listener: (event: PullProgressEvent) => void): () => void;
  startContainerExec(containerId: string): Promise<string>;
  writeContainerExec(sessionId: string, data: string): Promise<void>;
  stopContainerExec(sessionId: string): Promise<void>;
  subscribeExecOutput(listener: (event: ExecOutputEvent) => void): () => void;
  subscribeExecExit(listener: (event: ExecExitEvent) => void): () => void;
  getConfigDrift(projectId: string): Promise<ConfigDriftResult>;
  checkImageUpdate(image: string): Promise<CheckImageUpdateResult>;
  backupVolume(volumeName: string): Promise<BackupVolumeResult>;
  restoreVolume(volumeName: string): Promise<RestoreVolumeResult>;
};
