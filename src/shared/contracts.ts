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
          Status: z.string().optional()
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
          | "OPERATION_IN_PROGRESS";
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
  id: "refresh" | "open-source" | "validate" | "start" | "apply-start" | "stop" | "build-image";
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
  sourcePath?: string | undefined;
  configFiles: string[];
  services: ServiceNodeModel[];
  diagnostics: ProjectDiagnostics[];
  actions: ProjectAction[];
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
  runtimeRefreshSeconds: z.number().int().positive().nullable(),
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
export type RefreshRuntimeResult = Result<AppSnapshot>;
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

export type ExecutableProjectActionId = "validate" | "apply-start" | "stop" | "build-image";

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

export type PreloadApi = {
  getSnapshot(): Promise<AppSnapshot>;
  refreshRuntime(): Promise<RefreshRuntimeResult>;
  openSource(): Promise<OpenSourceResult>;
  openSourcePath(sourcePath: string): Promise<OpenSourceResult>;
  openRecentSource(sourcePath: string): Promise<OpenSourceResult>;
  getServiceLogs(containerId: string, tail: number): Promise<LogSnapshotResult>;
  getServiceStats(containerId: string): Promise<StatsSnapshotResult>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSnapshot>;
  clearRecents(): Promise<AppSnapshot>;
  runProjectAction(projectId: string, actionId: ProjectAction["id"]): Promise<ProjectActionResult>;
  subscribeBuildEvents(listener: (event: OperationEvent) => void): () => void;
};
