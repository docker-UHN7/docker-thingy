import * as z from "zod";
import { access } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import {
  ComposeListRecordSchema,
  ContainerInspectSchema,
  type ContainerDetails,
  type ContainerStats,
  type DependencyDescriptor,
  type DockerHealth,
  type DockerStatus,
  type EnvVarRecord,
  type GraphExternalNode,
  type MountRecord,
  type NetworkAttachment,
  type PortMapping,
  type ProjectSummary,
  type RelationshipEdge,
  type Result,
  type RuntimeContainer,
  type ServiceNodeModel
} from "../shared/contracts";
import { loadComposeProject } from "./compose-service";
import { PROCESS_LIMITS, execCommand } from "./process-runner";

const ComposePsRecordSchema = z.looseObject({
  ID: z.string().optional(),
  Name: z.string(),
  Service: z.string().optional(),
  State: z.string().optional(),
  Publishers: z
    .array(
      z.looseObject({
        URL: z.string().optional(),
        PublishedPort: z.number().optional(),
        TargetPort: z.number().optional(),
        Protocol: z.string().optional()
      })
    )
    .optional()
});

const DockerStatsRecordSchema = z.looseObject({
  Container: z.string().optional(),
  ID: z.string().optional(),
  Name: z.string().optional(),
  CPUPerc: z.string().optional(),
  MemPerc: z.string().optional(),
  MemUsage: z.string().optional()
});

const MEMORY_UNIT_MULTIPLIERS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4
};

function parsePercent(value: string | undefined): number | undefined {
  const match = value?.match(/^([\d.]+)%$/);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMemoryToken(token: string | undefined): number | undefined {
  const match = token?.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const multiplier = MEMORY_UNIT_MULTIPLIERS[match[2]];
  if (!multiplier) {
    return undefined;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed * multiplier : undefined;
}

function parseMemUsage(value: string | undefined): { usageBytes: number | undefined; limitBytes: number | undefined } {
  const [usageToken, limitToken] = (value ?? "").split("/").map((entry) => entry.trim());
  return {
    usageBytes: parseMemoryToken(usageToken),
    limitBytes: parseMemoryToken(limitToken)
  };
}

function isSecretKey(key: string): boolean {
  return /(?:^|_)(SECRET|PASSWORD|TOKEN|KEY)$/i.test(key);
}

function normalizeHealth(status: string | undefined): DockerHealth | undefined {
  if (!status) {
    return undefined;
  }

  if (status === "healthy" || status === "unhealthy" || status === "starting") {
    return status;
  }

  return "none";
}

function createPortLabel(hostPort: string | undefined, containerPort: number, protocol: string, state: PortMapping["state"]): string {
  if (state !== "published" || !hostPort) {
    return `${containerPort}/${protocol}`;
  }

  return `${hostPort} -> ${containerPort}/${protocol}`;
}

export function dedupePortMappings(portMappings: PortMapping[]): PortMapping[] {
  const seen = new Set<string>();
  const output: PortMapping[] = [];

  for (const port of portMappings) {
    const key =
      port.state === "published" && port.hostPort
        ? `${port.hostPort}:${port.containerPort}/${port.protocol}`
        : `${port.state}:${port.containerPort}/${port.protocol}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(port);
  }

  return output;
}

function unionStrings(...groups: Array<string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))];
}

function runtimePortKey(port: PortMapping): string {
  if (port.state === "published" && port.hostPort) {
    return `${port.hostPort}:${port.containerPort}/${port.protocol}`;
  }

  return `${port.containerPort}/${port.protocol}`;
}

function mergePortMappings(runtimePorts: PortMapping[], declaredPorts: PortMapping[]): PortMapping[] {
  const output = dedupePortMappings(runtimePorts);
  const seen = new Set(output.map(runtimePortKey));

  for (const port of declaredPorts) {
    const key = runtimePortKey(port);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(port);
  }

  return output;
}

function statusFromInspect(
  status: string | undefined,
  running: boolean | undefined,
  healthStatus: DockerHealth | undefined
): ServiceNodeModel["status"] {
  if (healthStatus === "unhealthy") {
    return "unhealthy";
  }

  if (healthStatus === "starting") {
    return "starting";
  }

  if (running || status === "running") {
    return "running";
  }

  if (status) {
    return "stopped";
  }

  return "unknown";
}

export function parseJsonOrJsonLines<T>(text: string, schema: z.ZodType<T>): Result<T[]> {
  const value = text.trim();

  if (value === "") {
    return { ok: true, data: [] };
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (Array.isArray(parsed)) {
      const result = z.array(schema).safeParse(parsed);

      return result.success
        ? { ok: true, data: result.data }
        : {
            ok: false,
            error: {
              code: "INVALID_DOCKER_OUTPUT",
              message: "Docker returned data in an unexpected format.",
              details: z.prettifyError(result.error)
            }
          };
    }

    const single = schema.safeParse(parsed);

    if (single.success) {
      return { ok: true, data: [single.data] };
    }
  } catch {
    // Fall through to JSON Lines parsing.
  }

  const output: T[] = [];

  for (const [index, line] of value.split(/\r?\n/).entries()) {
    if (line.trim() === "") {
      continue;
    }

    let parsedLine: unknown;

    try {
      parsedLine = JSON.parse(line);
    } catch {
      return {
        ok: false,
        error: {
          code: "INVALID_DOCKER_OUTPUT",
          message: `Docker returned invalid JSON on line ${index + 1}.`
        }
      };
    }

    const result = schema.safeParse(parsedLine);

    if (!result.success) {
      return {
        ok: false,
        error: {
          code: "INVALID_DOCKER_OUTPUT",
          message: `Docker returned unexpected data on line ${index + 1}.`,
          details: z.prettifyError(result.error)
        }
      };
    }

    output.push(result.data);
  }

  return { ok: true, data: output };
}

async function safeDockerCall(args: readonly string[], timeoutMs: number): Promise<string | undefined> {
  try {
    const result = await execCommand("docker", args, {
      timeoutMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "capability-check"
    });
    return result.stdout.trim() || result.stderr.trim();
  } catch {
    return undefined;
  }
}

function dockerUnavailableMessage(cliAvailable: boolean, daemonAvailable: boolean): string | undefined {
  if (!cliAvailable) {
    return "Docker CLI was not detected on this machine.";
  }

  if (!daemonAvailable) {
    return "Docker is installed, but the active daemon is unavailable. Start Docker Desktop or switch to a working Docker context.";
  }

  return undefined;
}

export async function detectDockerStatus(): Promise<DockerStatus> {
  const version = await safeDockerCall(["--version"], PROCESS_LIMITS.capabilityCheckMs);
  const cliAvailable = Boolean(version);
  const contextName = cliAvailable
    ? await safeDockerCall(["context", "show"], PROCESS_LIMITS.capabilityCheckMs)
    : undefined;
  const serverVersion = cliAvailable
    ? await safeDockerCall(["version", "--format", "{{.Server.Version}}"], PROCESS_LIMITS.capabilityCheckMs)
    : undefined;
  const composeVersion = cliAvailable
    ? await safeDockerCall(["compose", "version", "--short"], PROCESS_LIMITS.capabilityCheckMs)
    : undefined;
  const buildxVersion = cliAvailable
    ? await safeDockerCall(["buildx", "version"], PROCESS_LIMITS.capabilityCheckMs)
    : undefined;
  const daemonAvailable = Boolean(serverVersion);

  return {
    cliAvailable,
    daemonAvailable,
    composeAvailable: Boolean(composeVersion),
    buildxAvailable: Boolean(buildxVersion),
    contextName,
    serverVersion,
    composeVersion,
    buildxVersion,
    message: dockerUnavailableMessage(cliAvailable, daemonAvailable),
    checkedAt: new Date().toISOString()
  };
}

export function groupContainersByComposeProject(
  contextName: string,
  containers: RuntimeContainer[]
): Record<string, RuntimeContainer[]> {
  return containers.reduce<Record<string, RuntimeContainer[]>>((acc, container) => {
    const service = container.serviceName ?? "unassigned";
    const runtimeId = `runtime-compose:${contextName}:${service}`;
    acc[runtimeId] ??= [];
    acc[runtimeId].push(container);
    return acc;
  }, {});
}

function parseComposeDependencyLabel(raw: string | undefined): DependencyDescriptor[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, { condition?: string }>;
    return Object.entries(parsed).map(([serviceName, value]) => ({
      serviceName,
      condition: typeof value?.condition === "string" ? value.condition : undefined
    }));
  } catch {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((serviceName) => ({ serviceName }));
  }
}

function parseEnv(env: string[] | undefined): EnvVarRecord[] {
  return (env ?? [])
    .map((entry) => {
      const equalsIndex = entry.indexOf("=");
      if (equalsIndex === -1) {
        return {
          key: entry,
          value: "",
          masked: isSecretKey(entry)
        };
      }

      const key = entry.slice(0, equalsIndex);
      return {
        key,
        value: entry.slice(equalsIndex + 1),
        masked: isSecretKey(key)
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function parsePorts(
  inspected: z.infer<typeof ContainerInspectSchema>
): PortMapping[] {
  const runtimePorts: PortMapping[] = [];
  const published = inspected.NetworkSettings?.Ports ?? {};
  const exposed = new Set(Object.keys(inspected.Config?.ExposedPorts ?? {}));

  for (const [containerSide, bindings] of Object.entries(published)) {
    const match = containerSide.match(/^(\d+)\/([a-z]+)$/i);
    const containerPortToken = match?.[1];
    const protocolToken = match?.[2];
    if (!containerPortToken || !protocolToken) {
      continue;
    }

    const containerPort = Number(containerPortToken);
    const protocol = protocolToken.toLowerCase();
    exposed.delete(containerSide);

    if (!bindings || bindings.length === 0) {
      runtimePorts.push({
        id: `runtime:exposed:${containerPort}/${protocol}`,
        containerPort,
        protocol,
        state: "exposed",
        source: "runtime",
        label: createPortLabel(undefined, containerPort, protocol, "exposed")
      });
      continue;
    }

    for (const binding of bindings) {
      const hostPort = binding.HostPort;
      runtimePorts.push({
        id: `runtime:published:${hostPort ?? "none"}:${containerPort}/${protocol}`,
        hostIp: binding.HostIp,
        hostPort,
        containerPort,
        protocol,
        state: hostPort ? "published" : "exposed",
        source: "runtime",
        label: createPortLabel(hostPort, containerPort, protocol, hostPort ? "published" : "exposed")
      });
    }
  }

  for (const key of exposed) {
    const match = key.match(/^(\d+)\/([a-z]+)$/i);
    const containerPortToken = match?.[1];
    const protocolToken = match?.[2];
    if (!containerPortToken || !protocolToken) {
      continue;
    }

    runtimePorts.push({
      id: `runtime:exposed:${containerPortToken}/${protocolToken.toLowerCase()}`,
      containerPort: Number(containerPortToken),
      protocol: protocolToken.toLowerCase(),
      state: "exposed",
      source: "runtime",
      label: createPortLabel(undefined, Number(containerPortToken), protocolToken.toLowerCase(), "exposed")
    });
  }

  return dedupePortMappings(runtimePorts);
}

function parseMounts(inspected: z.infer<typeof ContainerInspectSchema>): MountRecord[] {
  return (inspected.Mounts ?? []).map((mount) => ({
    type:
      mount.Type === "volume" || mount.Type === "bind" || mount.Type === "tmpfs" ? mount.Type : "unknown",
    name: mount.Name,
    source: mount.Source ?? "",
    destination: mount.Destination ?? "",
    mode: mount.Mode ?? "",
    rw: mount.RW ?? false
  }));
}

function parseNetworks(inspected: z.infer<typeof ContainerInspectSchema>): NetworkAttachment[] {
  return Object.entries(inspected.NetworkSettings?.Networks ?? {}).map(([name, value]) => ({
    name,
    ipAddress: value.IPAddress,
    gateway: value.Gateway,
    macAddress: value.MacAddress,
    aliases: value.Aliases ?? []
  }));
}

export function toRuntimeContainer(inspected: z.infer<typeof ContainerInspectSchema>): RuntimeContainer {
  const labels = inspected.Config?.Labels;
  const name = inspected.Name?.replace(/^\//, "") ?? inspected.Id.slice(0, 12);
  const healthStatus = normalizeHealth(inspected.State?.Health?.Status);

  return {
    id: inspected.Id,
    shortId: inspected.Id.slice(0, 12),
    name,
    serviceName: labels?.["com.docker.compose.service"],
    image: inspected.Config?.Image,
    status: inspected.State?.Status ?? "unknown",
    running: inspected.State?.Running ?? false,
    healthStatus
  };
}

export function toContainerDetails(inspected: z.infer<typeof ContainerInspectSchema>): ContainerDetails {
  return {
    containerId: inspected.Id,
    image: inspected.Config?.Image,
    env: parseEnv(inspected.Config?.Env),
    mounts: parseMounts(inspected),
    networks: parseNetworks(inspected),
    labels: inspected.Config?.Labels ?? {},
    runtimeState: {
      status: inspected.State?.Status ?? "unknown",
      running: inspected.State?.Running ?? false,
      restarting: inspected.State?.Restarting ?? false,
      oomKilled: inspected.State?.OOMKilled ?? false,
      exitCode: inspected.State?.ExitCode,
      error: inspected.State?.Error,
      startedAt: inspected.State?.StartedAt,
      finishedAt: inspected.State?.FinishedAt,
      healthStatus: normalizeHealth(inspected.State?.Health?.Status),
      healthFailingStreak: inspected.State?.Health?.FailingStreak,
      healthLog: inspected.State?.Health?.Log?.map((entry) => ({
        start: entry.Start,
        end: entry.End,
        exitCode: entry.ExitCode,
        output: entry.Output?.trim()
      }))
    },
    resources: {
      memoryBytes: inspected.HostConfig?.Memory,
      nanoCpus: inspected.HostConfig?.NanoCpus,
      restartPolicyName: inspected.HostConfig?.RestartPolicy?.Name,
      restartRetryCount: inspected.HostConfig?.RestartPolicy?.MaximumRetryCount
    },
    command: inspected.Config?.Cmd ?? [],
    entrypoint: inspected.Config?.Entrypoint ?? [],
    workingDir: inspected.Config?.WorkingDir,
    ports: parsePorts(inspected)
  };
}

function buildExternalNodes(services: ServiceNodeModel[]): GraphExternalNode[] {
  const names = new Set(services.map((service) => service.name));
  const external: GraphExternalNode[] = [];
  const seen = new Set<string>();

  for (const service of services) {
    for (const dependency of service.dependencyDetails) {
      if (names.has(dependency.serviceName)) {
        continue;
      }

      const id = `external-service:${dependency.serviceName}`;
      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      external.push({
        id,
        kind: "service",
        name: dependency.serviceName
      });
    }
  }

  return external;
}

function buildRelationshipEdges(services: ServiceNodeModel[]): RelationshipEdge[] {
  const output: RelationshipEdge[] = [];
  const seen = new Set<string>();

  for (const service of services) {
    for (const dependency of service.dependencyDetails) {
      const key = `depends_on:${service.name}:${dependency.serviceName}:${dependency.condition ?? "service_started"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push({
        from: service.name,
        to: dependency.serviceName,
        kind: "depends_on",
        condition: (dependency.condition as RelationshipEdge["condition"]) ?? "service_started",
        inferred: false
      });
    }
  }

  const networks = new Set(services.flatMap((service) => service.categories.networks));
  for (const networkName of networks) {
    const members = services.filter((service) => service.categories.networks.includes(networkName));
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const left = members[i];
        const right = members[j];
        if (!left || !right) {
          continue;
        }

        const key = `network:${[left.name, right.name].sort().join("|")}:${networkName}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        output.push({
          from: left.name,
          to: right.name,
          kind: "network",
          label: networkName,
          inferred: false
        });
      }
    }
  }

  for (const service of services) {
    for (const volumeName of service.categories.volumes) {
      const key = `volume:${service.name}:${volumeName}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push({
        from: volumeName,
        to: service.name,
        kind: "volume",
        label: volumeName,
        inferred: false
      });
    }
  }

  return output;
}

function splitComposeConfigFiles(configFiles: string[] | undefined): string[] {
  return (configFiles ?? [])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Normalizes a filesystem path into a stable, comparable key: absolute,
 * forward-slashed, lowercased (Windows/most-mac filesystems are
 * case-insensitive, and this is only used for dedup matching - never for
 * an actual filesystem call). Used to recognize when a project the user
 * explicitly opened from source and a project `docker compose ls` just
 * discovered at runtime both point at the exact same Compose file, so the
 * two can be merged into a single card instead of showing two.
 */
export function resolveConfigKey(path: string): string {
  return resolvePath(path).replace(/\\/g, "/").toLowerCase();
}

async function maybeLoadComposeSource(
  contextName: string,
  configFiles: string[] | undefined
): Promise<ProjectSummary | undefined> {
  const candidates = splitComposeConfigFiles(configFiles);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return await loadComposeProject(candidate, contextName);
    } catch {
      // Try the next compose file candidate.
    }
  }

  return undefined;
}

function mergeServiceModel(
  sourceService: ServiceNodeModel,
  runtimeService: ServiceNodeModel | undefined,
  contextName: string,
  projectName: string
): ServiceNodeModel {
  const details = runtimeService?.details;
  const mergedPorts = mergePortMappings(runtimeService?.portMappings ?? [], sourceService.portMappings);

  return {
    // Always the source-declared id, never the runtime one - `runtimeService`
    // is only present when this sync cycle's live discovery happened to
    // succeed for this exact service (docker compose ps/inspect can fail
    // transiently, or briefly return nothing mid-recreate), so keying off it
    // meant a service's id could flip between `service:${name}` and
    // `runtime-service:...` from one sync to the next. The renderer clears
    // the selected/open service whenever its id disappears from the current
    // project (see ProjectWorkspace.tsx), so that flip was silently closing
    // the detail panel out from under the user on an unrelated background
    // sync. sourceService.id is always present here and never changes.
    id: sourceService.id,
    name: sourceService.name,
    image: sourceService.image ?? runtimeService?.image ?? details?.image,
    status: runtimeService?.status ?? sourceService.status,
    healthStatus: runtimeService?.healthStatus,
    dependencies: sourceService.dependencies.length > 0 ? sourceService.dependencies : runtimeService?.dependencies ?? [],
    dependencyDetails:
      sourceService.dependencyDetails.length > 0 ? sourceService.dependencyDetails : runtimeService?.dependencyDetails ?? [],
    ports: mergedPorts.map((entry) => entry.label),
    portMappings: mergedPorts,
    categories: {
      containers: runtimeService?.categories.containers ?? [],
      networks: unionStrings(runtimeService?.categories.networks, sourceService.declaredNetworks, sourceService.categories.networks),
      volumes: unionStrings(runtimeService?.categories.volumes, sourceService.categories.volumes)
    },
    declaredNetworks: unionStrings(sourceService.declaredNetworks, runtimeService?.declaredNetworks),
    details,
    ...(sourceService.sourceHints ? { sourceHints: sourceService.sourceHints } : {})
  };
}

function mergeRuntimeProjectWithSource(
  contextName: string,
  runtimeProject: ProjectSummary,
  sourceProject: ProjectSummary | undefined
): ProjectSummary {
  if (!sourceProject) {
    return {
      ...runtimeProject,
      relationshipEdges: buildRelationshipEdges(runtimeProject.services),
      sourceLinked: false
    };
  }

  const runtimeByService = new Map(runtimeProject.services.map((service) => [service.name, service]));
  const mergedServices = sourceProject.services.map((service) =>
    mergeServiceModel(service, runtimeByService.get(service.name), contextName, runtimeProject.title)
  );

  for (const runtimeOnlyService of runtimeProject.services) {
    if (mergedServices.some((service) => service.name === runtimeOnlyService.name)) {
      continue;
    }

    mergedServices.push(runtimeOnlyService);
  }

  return {
    ...runtimeProject,
    id: sourceProject.id,
    runtimeKind: sourceProject.runtimeKind,
    access: sourceProject.access,
    sourcePath: sourceProject.sourcePath,
    configFiles: sourceProject.configFiles,
    ...(sourceProject.allConfigFiles ? { allConfigFiles: sourceProject.allConfigFiles } : {}),
    ...(sourceProject.dockerfilePaths ? { dockerfilePaths: sourceProject.dockerfilePaths } : {}),
    actions: sourceProject.actions,
    services: mergedServices,
    composeProjectName: runtimeProject.composeProjectName,
    diagnostics: [...sourceProject.diagnostics],
    buildStatus: "built",
    externalNodes: buildExternalNodes(mergedServices),
    relationshipEdges: buildRelationshipEdges(mergedServices),
    lastUpdatedLabel: "Live runtime",
    lastCheckedAt: new Date().toISOString(),
    sourceLinked: true
  };
}

/**
 * The counterpart to `mergeRuntimeProjectWithSource`, used when a project was
 * already opened explicitly from source (and already has a stable
 * `source-compose:...` id, editable actions, etc.) and a *separate*
 * runtime-discovered card for the exact same Compose file shows up during a
 * live sync. Keeps the source project's identity (id/access/actions/title) -
 * which is what `activeProjectId` points at - while pulling in live
 * container status per service, so the two never render as duplicate cards
 * and the active selection never has to jump to a different project just
 * because its runtime twin came and went.
 */
export function mergeSourceProjectWithRuntime(
  contextName: string,
  sourceProject: ProjectSummary,
  runtimeProject: ProjectSummary
): ProjectSummary {
  const runtimeByService = new Map(runtimeProject.services.map((service) => [service.name, service]));
  const mergedServices = sourceProject.services.map((service) =>
    mergeServiceModel(service, runtimeByService.get(service.name), contextName, runtimeProject.title)
  );

  for (const runtimeOnlyService of runtimeProject.services) {
    if (mergedServices.some((service) => service.name === runtimeOnlyService.name)) {
      continue;
    }

    mergedServices.push(runtimeOnlyService);
  }

  return {
    ...sourceProject,
    subtitle: runtimeProject.subtitle,
    composeProjectName: runtimeProject.composeProjectName,
    services: mergedServices,
    buildStatus: "built",
    externalNodes: buildExternalNodes(mergedServices),
    relationshipEdges: buildRelationshipEdges(mergedServices),
    lastUpdatedLabel: "Live runtime",
    lastCheckedAt: new Date().toISOString(),
    sourceLinked: true
  };
}

function createServiceModelFromContainer(
  contextName: string,
  inspected: z.infer<typeof ContainerInspectSchema>
): ServiceNodeModel {
  const labels = inspected.Config?.Labels ?? {};
  const details = toContainerDetails(inspected);
  const serviceName = labels["com.docker.compose.service"] ?? inspected.Name?.replace(/^\//, "") ?? inspected.Id.slice(0, 12);
  const dependencyDetails = parseComposeDependencyLabel(labels["com.docker.compose.depends_on"]);
  const mounts = details.mounts.map((entry) => entry.name ?? entry.source).filter(Boolean);
  const networks = details.networks.map((entry) => entry.name);
  const healthStatus = details.runtimeState.healthStatus;

  return {
    id: labels["com.docker.compose.service"]
      ? `runtime-service:${contextName}:${labels["com.docker.compose.project"] ?? "runtime"}:${serviceName}`
      : `container-service:${contextName}:${inspected.Id}`,
    name: serviceName,
    image: inspected.Config?.Image,
    status: statusFromInspect(details.runtimeState.status, details.runtimeState.running, healthStatus),
    healthStatus,
    dependencies: dependencyDetails.map((entry) => entry.serviceName),
    dependencyDetails,
    ports: details.ports.map((entry) => entry.label),
    portMappings: details.ports,
    categories: {
      containers: [toRuntimeContainer(inspected)],
      networks,
      volumes: mounts
    },
    declaredNetworks: networks,
    details
  };
}

async function inspectContainers(
  containerIds: readonly string[]
): Promise<Map<string, z.infer<typeof ContainerInspectSchema>>> {
  const inspectedMap = new Map<string, z.infer<typeof ContainerInspectSchema>>();
  if (containerIds.length === 0) {
    return inspectedMap;
  }

  const batches: string[][] = [];
  for (let i = 0; i < containerIds.length; i += 50) {
    batches.push([...containerIds.slice(i, i + 50)]);
  }

  for (const batch of batches) {
    const result = await execCommand("docker", ["inspect", "--type", "container", ...batch], {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxJsonBytes,
      category: "runtime-discovery"
    });
    const parsed = z.array(ContainerInspectSchema).safeParse(JSON.parse(result.stdout));

    if (!parsed.success) {
      continue;
    }

    for (const entry of parsed.data) {
      inspectedMap.set(entry.Id, entry);
    }
  }

  return inspectedMap;
}

/** Every container on the host (any state), fully inspected - used by callers that need the whole fleet, not just a single Compose project's containers. */
export async function listAllContainers(): Promise<z.infer<typeof ContainerInspectSchema>[]> {
  const containerIdResult = await execCommand("docker", ["ps", "--all", "--quiet", "--no-trunc"], {
    timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
    maxBytes: PROCESS_LIMITS.maxJsonBytes,
    category: "runtime-discovery"
  });

  const containerIds = containerIdResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const inspectedMap = await inspectContainers(containerIds);
  return [...inspectedMap.values()];
}

const DockerNetworkRecordSchema = z.looseObject({
  ID: z.string().optional(),
  Name: z.string(),
  Driver: z.string().optional()
});

export type DockerNetworkSummary = {
  id: string;
  name: string;
  driver: string;
};

export async function listDockerNetworks(): Promise<DockerNetworkSummary[]> {
  try {
    const result = await execCommand("docker", ["network", "ls", "--format", "json"], {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxJsonBytes,
      category: "runtime-discovery"
    });

    const parsed = parseJsonOrJsonLines(result.stdout, DockerNetworkRecordSchema);
    if (!parsed.ok) {
      return [];
    }

    return parsed.data.map((entry) => ({
      id: entry.ID ?? "",
      name: entry.Name,
      driver: entry.Driver ?? ""
    }));
  } catch {
    return [];
  }
}

/** The Linux bridge interface backing a Docker bridge-driver network, following Docker's own naming convention. Non-bridge-driver networks (host/none/overlay) have no single backing interface. */
export function dockerNetworkBridgeName(network: DockerNetworkSummary): string | undefined {
  if (network.driver !== "bridge") {
    return undefined;
  }

  if (network.name === "bridge") {
    return "docker0";
  }

  return network.id ? `br-${network.id.slice(0, 12)}` : undefined;
}

async function discoverComposeProjectServices(
  contextName: string,
  projectName: string,
  containers: z.infer<typeof ContainerInspectSchema>[]
): Promise<ServiceNodeModel[]> {
  try {
    const result = await execCommand("docker", ["compose", "--project-name", projectName, "ps", "--format", "json"], {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxJsonBytes,
      category: "runtime-discovery"
    });

    const parsed = parseJsonOrJsonLines(result.stdout, ComposePsRecordSchema);
    if (!parsed.ok) {
      return [];
    }

    const byService = new Map<string, z.infer<typeof ContainerInspectSchema>[]>();
    for (const container of containers) {
      const serviceName = container.Config?.Labels?.["com.docker.compose.service"];
      if (!serviceName) {
        continue;
      }

      byService.set(serviceName, [...(byService.get(serviceName) ?? []), container]);
    }

    return parsed.data.map((record) => {
      const serviceName = record.Service ?? record.Name;
      const serviceContainers = byService.get(serviceName) ?? [];
      const first = serviceContainers[0];
      const details = first ? toContainerDetails(first) : undefined;
      const dependencyDetails = parseComposeDependencyLabel(first?.Config?.Labels?.["com.docker.compose.depends_on"]);
      const publisherPorts: PortMapping[] =
        record.Publishers?.flatMap((publisher) => {
          if (!publisher.TargetPort) {
            return [];
          }

          const protocol = publisher.Protocol?.toLowerCase() ?? "tcp";
          const hostPort = publisher.PublishedPort ? String(publisher.PublishedPort) : undefined;

          return [
            {
              id: `runtime:published:${hostPort ?? "none"}:${publisher.TargetPort}/${protocol}`,
              hostPort,
              containerPort: publisher.TargetPort,
              protocol,
              state: hostPort ? "published" : "exposed",
              source: "runtime" as const,
              label: createPortLabel(hostPort, publisher.TargetPort, protocol, hostPort ? "published" : "exposed")
            }
          ];
        }) ?? [];
      const ports = details?.ports.length ? details.ports : publisherPorts;
      const healthStatus = details?.runtimeState.healthStatus;

      return {
        id: `runtime-service:${contextName}:${projectName}:${serviceName}`,
        name: serviceName,
        image: first?.Config?.Image,
        status: statusFromInspect(first?.State?.Status ?? record.State, first?.State?.Running, healthStatus),
        healthStatus,
        dependencies: dependencyDetails.map((entry) => entry.serviceName),
        dependencyDetails,
        ports: ports.map((entry) => entry.label),
        portMappings: ports,
        categories: {
          containers: serviceContainers.map(toRuntimeContainer),
          networks: details?.networks.map((entry) => entry.name) ?? [],
          volumes: details?.mounts.map((entry) => entry.name ?? entry.source).filter(Boolean) ?? []
        },
        declaredNetworks: details?.networks.map((entry) => entry.name) ?? [],
        details
      };
    });
  } catch {
    return [];
  }
}

function standaloneContainerProject(
  contextName: string,
  inspected: z.infer<typeof ContainerInspectSchema>
): ProjectSummary {
  const service = createServiceModelFromContainer(contextName, inspected);

  return {
    id: `container:${contextName}:${inspected.Id}`,
    title: service.name,
    subtitle: inspected.Config?.Image ?? "Standalone runtime container",
    runtimeKind: "container",
    access: "runtime-only",
    contextName,
    composeProjectName: undefined,
    configFiles: [],
    services: [service],
    diagnostics: [
      {
        level: "info",
        title: "Runtime-only container",
        message: "This container was discovered directly from the active daemon and is not linked to an editable source project."
      }
    ],
    actions: [],
    buildStatus: "built",
    lastUpdatedLabel: "Live runtime",
    lastCheckedAt: new Date().toISOString(),
    externalNodes: [],
    relationshipEdges: buildRelationshipEdges([service]),
    sourceLinked: false
  };
}

export async function discoverRuntimeProjects(status: DockerStatus): Promise<ProjectSummary[]> {
  if (!status.composeAvailable || !status.contextName) {
    return [];
  }
  const contextName = status.contextName;

  try {
    const composeLs = await execCommand("docker", ["compose", "ls", "--all", "--format", "json"], {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxJsonBytes,
      category: "runtime-discovery"
    });

    const composeProjects = parseJsonOrJsonLines(composeLs.stdout, ComposeListRecordSchema);
    if (!composeProjects.ok) {
      return [];
    }

    const inspectedContainers = await listAllContainers();

    // Track containers that actually got attached to one of the resolved
    // compose projects below (rather than "any container carrying a compose
    // label"). A container can carry a `com.docker.compose.project` label for
    // a project that `docker compose ls` no longer reports (e.g. the project
    // was removed/renamed); excluding those from the standalone list purely
    // based on the label would silently drop them from the UI entirely.
    const containersLinkedToComposeProjects = new Set<string>();

    const composeProjectsResolved = await Promise.all(
      composeProjects.data.map(async (project) => {
        const matchingContainers = inspectedContainers.filter(
          (container) => container.Config?.Labels?.["com.docker.compose.project"] === project.Name
        );
        for (const container of matchingContainers) {
          containersLinkedToComposeProjects.add(container.Id);
        }
        const services = await discoverComposeProjectServices(contextName, project.Name, matchingContainers);
        const sourceProject = await maybeLoadComposeSource(contextName, project.ConfigFiles ? [project.ConfigFiles] : []);

        const resolvedConfigFiles = splitComposeConfigFiles(project.ConfigFiles ? [project.ConfigFiles] : []);
        // The Compose project name alone (typically just the containing
        // directory's basename) isn't a reliably unique key - two unrelated
        // directories can easily share a name. Fold in the resolved config
        // file path too so those don't collide into a single id and cause
        // the active project to silently flip to the wrong card during a sync.
        const configIdentity = resolvedConfigFiles[0] ? resolveConfigKey(resolvedConfigFiles[0]) : "no-config-file";

        const runtimeProject = {
          id: `runtime-compose:${contextName}:${project.Name}:${configIdentity}`,
          title: project.Name,
          subtitle: project.Status ?? "Runtime-discovered Compose project",
          runtimeKind: "compose" as const,
          access: "runtime-only" as const,
          contextName,
          composeProjectName: project.Name,
          sourcePath: undefined,
          configFiles: resolvedConfigFiles,
          services,
          diagnostics: resolvedConfigFiles.length > 0
            ? [
                {
                  level: "info" as const,
                  title: "Possible source files found",
                  message: "Open and verify source before linking this runtime project to editable configuration."
                }
              ]
            : [],
          actions: resolvedConfigFiles.length > 0
            ? [
                { id: "validate" as const, label: "Validate", emphasis: "primary" as const },
                { id: "build-image" as const, label: "Build" },
                { id: "start" as const, label: "Start" },
                { id: "apply-start" as const, label: "Apply & Start" },
                { id: "stop" as const, label: "Stop", emphasis: "danger" as const }
              ]
            : [],
          buildStatus: "built" as const,
          lastUpdatedLabel: "Live runtime",
          lastCheckedAt: new Date().toISOString(),
          externalNodes: buildExternalNodes(services),
          relationshipEdges: buildRelationshipEdges(services),
          sourceLinked: Boolean(sourceProject)
        } satisfies ProjectSummary;

        return mergeRuntimeProjectWithSource(contextName, runtimeProject, sourceProject);
      })
    );

    const standaloneProjects = inspectedContainers
      .filter((container) => !containersLinkedToComposeProjects.has(container.Id))
      .map((container) => standaloneContainerProject(contextName, container));

    return [...composeProjectsResolved, ...standaloneProjects];
  } catch {
    return [];
  }
}

export async function fetchContainerLogs(containerId: string, tail: number): Promise<{ containerId: string; lines: string[]; fetchedAt: string }> {
  const result = await execCommand("docker", ["logs", "--tail", String(tail), containerId], {
    timeoutMs: PROCESS_LIMITS.logFetchMs,
    maxBytes: PROCESS_LIMITS.maxLogBytes,
    category: "logs"
  });

  const content = [result.stdout, result.stderr].filter(Boolean).join("\n");

  return {
    containerId,
    lines: content.split(/\r?\n/).filter((line) => line.length > 0),
    fetchedAt: new Date().toISOString()
  };
}

export async function fetchContainerStats(containerId: string): Promise<ContainerStats> {
  const result = await execCommand("docker", ["stats", "--no-stream", "--format", "{{json .}}", containerId], {
    timeoutMs: PROCESS_LIMITS.statsFetchMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "stats"
  });

  const parsed = parseJsonOrJsonLines(result.stdout, DockerStatsRecordSchema);
  const record = parsed.ok ? parsed.data[0] : undefined;
  const { usageBytes, limitBytes } = parseMemUsage(record?.MemUsage);

  return {
    containerId,
    cpuPercent: parsePercent(record?.CPUPerc),
    memoryUsageBytes: usageBytes,
    memoryLimitBytes: limitBytes,
    memoryPercent: parsePercent(record?.MemPerc),
    fetchedAt: new Date().toISOString()
  };
}
