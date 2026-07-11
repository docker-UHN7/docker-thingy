import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Document } from "yaml";
import type {
  AddServiceInput,
  DependencyDescriptor,
  GraphExternalNode,
  PortMapping,
  ProjectDiagnostics,
  ProjectSummary,
  RelationshipEdge,
  ServiceFields,
  ServiceFieldsInput,
  ServiceNodeModel
} from "../shared/contracts";

export function hashSource(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function setScalarPreservingNode(
  document: Document,
  path: readonly (string | number)[],
  value: string
): void {
  const existing = document.getIn(path, true);

  if (isScalar(existing)) {
    existing.value = value;
    return;
  }

  document.setIn(path, value);
}

export function clearNode(document: Document, path: readonly (string | number)[]): void {
  document.deleteIn(path);
}

export function describeComposePath(value: string): ProjectDiagnostics[] {
  const diagnostics: ProjectDiagnostics[] = [];

  if (value.includes("\0")) {
    diagnostics.push({
      level: "error",
      title: "Invalid path value",
      message: "Compose path values cannot contain null bytes."
    });
  }

  if (/^[A-Za-z]:\\|^\//.test(value)) {
    diagnostics.push({
      level: "warning",
      title: "Absolute path reduces portability",
      message: "Absolute Compose paths are valid, but they make the project less portable."
    });
  }

  return diagnostics;
}

function parsePortToken(token: string): { containerPort: number; protocol: string } | undefined {
  const match = token.match(/^(\d+)(?:\/([a-z]+))?$/i);
  if (!match) {
    return undefined;
  }

  return {
    containerPort: Number(match[1]),
    protocol: match[2]?.toLowerCase() ?? "tcp"
  };
}

function createPortLabel(hostPort: string | undefined, containerPort: number, protocol: string, state: PortMapping["state"]): string {
  if (state === "exposed" || !hostPort) {
    return `${containerPort}/${protocol}`;
  }

  return `${hostPort} -> ${containerPort}/${protocol}`;
}

function toPortMapping(value: unknown, source: "compose" | "runtime"): PortMapping[] {
  if (typeof value === "string") {
    const protocolSplit = value.split("/");
    const protocol = protocolSplit[1]?.toLowerCase() ?? "tcp";
    const base = protocolSplit[0] ?? value;
    const segments = base.split(":");
    const normalized = segments.filter(Boolean);

    if (normalized.length === 1) {
      const onlyToken = normalized[0];
      if (!onlyToken) {
        return [];
      }

      const parsed = parsePortToken(onlyToken);
      if (!parsed) {
        return [];
      }

      return [
        {
          id: `${source}:declared:${parsed.containerPort}/${parsed.protocol}`,
          containerPort: parsed.containerPort,
          protocol: parsed.protocol,
          state: "declared",
          source,
          label: createPortLabel(undefined, parsed.containerPort, parsed.protocol, "declared")
        }
      ];
    }

    const containerToken = normalized.at(-1);
    const hostToken = normalized.at(-2);
    if (!containerToken || !hostToken) {
      return [];
    }

    const parsed = parsePortToken(containerToken);
    if (!parsed) {
      return [];
    }

    return [
      {
        id: `${source}:published:${hostToken}:${parsed.containerPort}/${parsed.protocol}`,
        hostPort: hostToken,
        containerPort: parsed.containerPort,
        protocol: parsed.protocol,
        state: "published",
        source,
        label: createPortLabel(hostToken, parsed.containerPort, parsed.protocol, "published")
      }
    ];
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const target = typeof input.target === "number" ? input.target : Number(input.target);
    if (!Number.isFinite(target)) {
      return [];
    }

    const protocol = typeof input.protocol === "string" ? input.protocol.toLowerCase() : "tcp";
    const published =
      typeof input.published === "string" || typeof input.published === "number"
        ? String(input.published)
        : undefined;

    return [
      {
        id: `${source}:${published ? "published" : "declared"}:${published ?? "none"}:${target}/${protocol}`,
        hostIp: typeof input.host_ip === "string" ? input.host_ip : undefined,
        hostPort: published,
        containerPort: target,
        protocol,
        state: published ? "published" : "declared",
        source,
        label: createPortLabel(published, target, protocol, published ? "published" : "declared")
      }
    ];
  }

  return [];
}

function toExposeMapping(value: unknown): PortMapping[] {
  if (typeof value !== "string" && typeof value !== "number") {
    return [];
  }

  const parsed = parsePortToken(String(value));
  if (!parsed) {
    return [];
  }

  return [
    {
      id: `compose:exposed:${parsed.containerPort}/${parsed.protocol}`,
      containerPort: parsed.containerPort,
      protocol: parsed.protocol,
      state: "exposed",
      source: "compose",
      label: createPortLabel(undefined, parsed.containerPort, parsed.protocol, "exposed")
    }
  ];
}

// yaml's Collection#get() only unwraps plain Scalars; YAMLSeq/YAMLMap values are
// always returned as their Node form (regardless of the keepScalar flag). Every
// list-shaped Compose field (ports, expose, depends_on, networks, volumes) is
// parsed from such a node, so a bare `Array.isArray(value)` check silently
// treats every list-form declaration as absent. Normalize through here first.
function toPlainArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isSeq(value)) {
    return value.toJSON() as unknown[];
  }

  return [];
}

function parseDependencies(value: unknown): DependencyDescriptor[] {
  if (isMap(value)) {
    return value.items.map((entry) => {
      const condition = isMap(entry.value) ? entry.value.get("condition") : undefined;
      return {
        serviceName: String(entry.key),
        condition: typeof condition === "string" ? condition : undefined
      };
    });
  }

  return toPlainArray(value).map((entry) => ({
    serviceName: String(entry)
  }));
}

function parseStringArray(value: unknown): string[] {
  if (isMap(value)) {
    return value.items.map((entry) => String(entry.key));
  }

  return toPlainArray(value).map((entry) => String(entry));
}

function parseVolumes(value: unknown): string[] {
  return toPlainArray(value).flatMap((entry) => {
    if (typeof entry === "string") {
      const parts = entry.split(":");
      return parts[0] ? [parts[0]] : [];
    }

    if (entry && typeof entry === "object") {
      const source = (entry as Record<string, unknown>).source;
      return typeof source === "string" ? [source] : [];
    }

    return [];
  });
}

function inferExternalNodes(services: ServiceNodeModel[]): GraphExternalNode[] {
  const serviceNames = new Set(services.map((service) => service.name));
  const external: GraphExternalNode[] = [];
  const seen = new Set<string>();

  for (const service of services) {
    for (const dependency of service.dependencyDetails) {
      if (serviceNames.has(dependency.serviceName)) {
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

  const networks = new Set(services.flatMap((service) => service.declaredNetworks));
  for (const networkName of networks) {
    const members = services.filter((service) => service.declaredNetworks.includes(networkName));
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

// declaredName comes from whichever active file last declared a `name:`
// directive - later files win, same as every other merge rule here, so a
// `name:` in an override file takes effect just like it would in real
// `docker compose -f a -f b`.
function deriveComposeProjectTitle(declaredName: string | undefined, sourcePath: string): string {
  if (declaredName && declaredName.trim() !== "") {
    return declaredName.trim();
  }

  const parentDirectory = basename(dirname(sourcePath));
  if (parentDirectory.trim() !== "") {
    return parentDirectory;
  }

  return sourcePath.split(/[/\\]/).at(-1) ?? sourcePath;
}

function toServiceModels(document: Document): ServiceNodeModel[] {
  const servicesNode = document.get("services", true);
  if (!isMap(servicesNode)) {
    return [];
  }

  return servicesNode.items.flatMap((item) => {
    const serviceName = String(item.key);
    if (!isMap(item.value)) {
      return [];
    }

    const image = item.value.get("image");
    const dependsOn = item.value.get("depends_on", true);
    const ports = item.value.get("ports");
    const expose = item.value.get("expose");
    const networks = item.value.get("networks", true);
    const volumes = item.value.get("volumes", true);
    // Do NOT request keepScalar for build: a Collection (map-form build) is
    // returned as its Node either way, but requesting keepScalar also leaves a
    // scalar (string-form `build: ./context`) wrapped, so `typeof build ===
    // "string"` below would never match and the build context would be lost.
    const build = item.value.get("build");
    const buildContext =
      typeof build === "string"
        ? build
        : isMap(build) && typeof build.get("context") === "string"
          ? String(build.get("context"))
          : undefined;
    const dockerfilePath =
      isMap(build) && typeof build.get("dockerfile") === "string" ? String(build.get("dockerfile")) : undefined;

    const dependencyDetails = parseDependencies(dependsOn);
    const portMappings = [
      ...toPlainArray(ports).flatMap((entry) => toPortMapping(entry, "compose")),
      ...toPlainArray(expose).flatMap((entry) => toExposeMapping(entry))
    ];

    return [
      {
        id: `service:${serviceName}`,
        name: serviceName,
        image: typeof image === "string" ? image : undefined,
        status: "unknown" as const,
        dependencies: dependencyDetails.map((entry) => entry.serviceName),
        dependencyDetails,
        ports: portMappings.map((entry) => entry.label),
        portMappings,
        categories: {
          containers: [],
          networks: parseStringArray(networks),
          volumes: parseVolumes(volumes)
        },
        declaredNetworks: parseStringArray(networks),
        sourceHints: {
          buildContext,
          dockerfilePath,
          expose: toPlainArray(expose)
            .map((entry) => parsePortToken(String(entry))?.containerPort)
            .filter((entry): entry is number => Number.isFinite(entry))
        }
      }
    ];
  });
}

// A service's `build.context` + `build.dockerfile` only says where its
// Dockerfile *should* live - Compose allows context to be a remote git URL,
// and dockerfile is optional (defaults to "Dockerfile" inside the context).
// This resolves that into an absolute local path the same way `docker
// compose build` would (relative to the compose file's own directory), and
// skips anything with no local path to resolve.
function resolveDockerfileCandidate(
  composeDir: string,
  buildContext: string | undefined,
  dockerfilePath: string | undefined
): string | undefined {
  if (!buildContext && !dockerfilePath) {
    return undefined;
  }

  if (buildContext && /^[a-z][a-z0-9+.-]*:\/\//i.test(buildContext)) {
    return undefined;
  }

  const contextDir = buildContext ? (isAbsolute(buildContext) ? buildContext : join(composeDir, buildContext)) : composeDir;

  const fileName = dockerfilePath ?? "Dockerfile";
  return isAbsolute(fileName) ? fileName : join(contextDir, fileName);
}

// Resolved candidates are existence-checked so the editor's file picker never
// offers a Dockerfile path that turned out to be wrong (typo'd dockerfile:
// field, context that doesn't exist yet, etc).
async function resolveServiceDockerfilePaths(services: ServiceNodeModel[], composeDir: string): Promise<string[]> {
  const candidates = new Set<string>();

  for (const service of services) {
    const candidate = resolveDockerfileCandidate(
      composeDir,
      service.sourceHints?.buildContext,
      service.sourceHints?.dockerfilePath
    );
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const checked = await Promise.all(
    [...candidates].map(async (candidate) => {
      try {
        await access(candidate);
        return candidate;
      } catch {
        return undefined;
      }
    })
  );

  return checked.filter((entry): entry is string => Boolean(entry));
}

function dedupePortMappings(portMappings: PortMapping[]): PortMapping[] {
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

function mergeDependencyDetails(base: DependencyDescriptor[], override: DependencyDescriptor[]): DependencyDescriptor[] {
  const result = [...base];
  for (const overDep of override) {
    const existingIndex = result.findIndex((d) => d.serviceName === overDep.serviceName);
    if (existingIndex === -1) {
      // Ensure all required fields are present
      result.push({
        serviceName: overDep.serviceName,
        condition: overDep.condition,
        external: overDep.external
      });
    } else {
      // Update existing
      result[existingIndex] = {
        ...result[existingIndex]!,
        condition: overDep.condition ?? result[existingIndex]!.condition
      };
    }
  }
  return result;
}

function mergeComposeServices(base: ServiceNodeModel[], override: ServiceNodeModel[]): ServiceNodeModel[] {
  const result = [...base];
  for (const overService of override) {
    const existingIndex = result.findIndex((s) => s.name === overService.name);
    
    if (existingIndex === -1) {
      result.push(overService);
    } else {
      const baseService = result[existingIndex]!; // Use ! to tell TS you checked the index exists
      const mergedPorts = dedupePortMappings([...baseService.portMappings, ...overService.portMappings]);
      
      // We must explicitly include the ID from the base service
      result[existingIndex] = {
        ...baseService, // Keep the original ID
        image: overService.image ?? baseService.image,
        ports: mergedPorts.map((entry) => entry.label),
        portMappings: mergedPorts,
        dependencies: [...new Set([...baseService.dependencies, ...overService.dependencies])],
        dependencyDetails: mergeDependencyDetails(baseService.dependencyDetails, overService.dependencyDetails),
        declaredNetworks: [...new Set([...baseService.declaredNetworks, ...overService.declaredNetworks])],
        categories: {
          containers: [...baseService.categories.containers, ...overService.categories.containers],
          networks: [...new Set([...baseService.categories.networks, ...overService.categories.networks])],
          volumes: [...new Set([...baseService.categories.volumes, ...overService.categories.volumes])]
        },
        sourceHints: {
          buildContext: overService.sourceHints?.buildContext ?? baseService.sourceHints?.buildContext,
          dockerfilePath: overService.sourceHints?.dockerfilePath ?? baseService.sourceHints?.dockerfilePath,
          expose: [...new Set([...(baseService.sourceHints?.expose ?? []), ...(overService.sourceHints?.expose ?? [])])]
        }
      };
    }
  }
  return result;
}

export async function loadComposeProject(
  sourcePath: string,
  contextName: string,
  configFiles?: string[]
): Promise<ProjectSummary> {
  const activeFiles = configFiles && configFiles.length > 0 ? configFiles : [sourcePath];
  let mergedServices: ServiceNodeModel[] = [];
  const diagnostics: ProjectDiagnostics[] = [];
  let declaredName: string | undefined;

  for (const filePath of activeFiles) {
    try {
      const sourceText = await readFile(filePath, "utf8");
      const document = parseDocument(sourceText, {
        keepSourceTokens: true
      });

      const services = toServiceModels(document);
      mergedServices = mergeComposeServices(mergedServices, services);

      const fileDeclaredName = document.get("name");
      if (typeof fileDeclaredName === "string" && fileDeclaredName.trim() !== "") {
        declaredName = fileDeclaredName.trim();
      }

      for (const service of services) {
        if (service.sourceHints?.buildContext) {
          diagnostics.push(...describeComposePath(service.sourceHints.buildContext));
        }
      }
    } catch (e) {
      diagnostics.push({
        level: "error",
        title: `Failed to load ${filePath.split(/[/\\]/).at(-1)}`,
        message: e instanceof Error ? e.message : "Error reading or parsing file."
      });
    }
  }

  // Deduplicate diagnostics
  const uniqueDiagnostics = diagnostics.filter(
    (diag, index, self) =>
      index === self.findIndex((d) => d.title === diag.title && d.message === diag.message)
  );

  const projectTitle = deriveComposeProjectTitle(declaredName, sourcePath);
  const dockerfilePaths = await resolveServiceDockerfilePaths(mergedServices, dirname(sourcePath));

  return {
    id: `source-compose:${contextName}:${sourcePath}`,
    title: projectTitle,
    subtitle: activeFiles.length > 1
      ? `Merged Compose source (${activeFiles.length} files)`
      : "Explicitly opened Compose source",
    runtimeKind: "compose",
    access: "editable",
    contextName,
    composeProjectName: projectTitle,
    sourcePath,
    configFiles: activeFiles,
    dockerfilePaths,
    services: mergedServices,
    diagnostics: uniqueDiagnostics,
    actions: [
      { id: "validate", label: "Validate", emphasis: "primary" },
      { id: "build-image", label: "Build" },
      { id: "start", label: "Start" },
      { id: "apply-start", label: "Apply & Start", confirmation: "Apply changes and start this Compose project?" },
      { id: "stop", label: "Stop", emphasis: "danger", confirmation: "Stop containers for this project?" }
    ],
    buildStatus: "not-built",
    lastUpdatedLabel: "Opened from source",
    lastCheckedAt: new Date().toISOString(),
    externalNodes: inferExternalNodes(mergedServices),
    relationshipEdges: buildRelationshipEdges(mergedServices),
    sourceLinked: true
  };
}

export function updateComposeImage(
  sourceText: string,
  serviceName: string,
  image: string
): { sourceText: string; diffPreview: string } {
  const document = parseDocument(sourceText, {
    keepSourceTokens: true
  });

  setScalarPreservingNode(document, ["services", serviceName, "image"], image);
  const next = String(document);

  return {
    sourceText: next,
    diffPreview: `- image: <previous>\n+ image: ${image}`
  };
}

// Adds `dependencyService` to `targetService`'s depends_on, preserving
// whichever form (short list or long map-with-condition) is already there,
// and creating a short-list form if the service has no depends_on yet.
function addDependency(document: Document, targetService: string, dependencyService: string): void {
  const path = ["services", targetService, "depends_on"];
  const existing = document.getIn(path, true);

  if (isSeq(existing)) {
    const alreadyPresent = existing.items.some(
      (item) => (isScalar(item) ? String(item.value) : String(item)) === dependencyService
    );
    if (!alreadyPresent) {
      existing.add(dependencyService);
    }
    return;
  }

  if (isMap(existing)) {
    if (!existing.has(dependencyService)) {
      existing.set(dependencyService, { condition: "service_started" });
    }
    return;
  }

  document.setIn(path, [dependencyService]);
}

// Merges one KEY=value into a service's environment block, preserving
// whichever form (`environment: [KEY=value, ...]` or `environment: {KEY: value}`)
// is already there. Skips the write if the list form already declares that key.
function mergeEnvVar(document: Document, servicePath: readonly (string | number)[], key: string, value: string): void {
  const envPath = [...servicePath, "environment"];
  const existing = document.getIn(envPath, true);

  if (isSeq(existing)) {
    const alreadyPresent = existing.items.some((item) => {
      const text = isScalar(item) ? String(item.value) : String(item);
      return text.startsWith(`${key}=`);
    });
    if (!alreadyPresent) {
      existing.add(`${key}=${value}`);
    }
    return;
  }

  document.setIn([...envPath, key], value);
}

// Adds a new service (from the "Add service" catalog) to the compose file,
// optionally wiring a persistent named volume and, for each service listed
// in `connectTo`, a depends_on entry plus connection environment variables -
// see resolveConnectionEnv in shared/service-presets.ts for how those
// env values get built.
export function addServiceToCompose(
  sourceText: string,
  input: AddServiceInput
): { sourceText: string; diffPreview: string } {
  const document = parseDocument(sourceText, { keepSourceTokens: true });

  const serviceNode: Record<string, unknown> = { image: input.image, restart: "unless-stopped" };
  if (input.environment && Object.keys(input.environment).length > 0) {
    serviceNode.environment = input.environment;
  }
  if (input.ports && input.ports.length > 0) {
    serviceNode.ports = input.ports;
  }
  if (input.volumeName && input.volumeMountPath) {
    serviceNode.volumes = [`${input.volumeName}:${input.volumeMountPath}`];
  }

  document.setIn(["services", input.serviceName], serviceNode);

  if (input.volumeName) {
    document.setIn(["volumes", input.volumeName], null);
  }

  const diffLines = [`+ services.${input.serviceName}:`, `+   image: ${input.image}`];

  for (const target of input.connectTo ?? []) {
    addDependency(document, target.serviceName, input.serviceName);
    diffLines.push(`+ services.${target.serviceName}.depends_on: +${input.serviceName}`);

    for (const [key, value] of Object.entries(target.environment)) {
      mergeEnvVar(document, ["services", target.serviceName], key, value);
      diffLines.push(`+ services.${target.serviceName}.environment.${key}=${value}`);
    }
  }

  return { sourceText: String(document), diffPreview: diffLines.join("\n") };
}

// Removes `dependencyService` from `targetService`'s depends_on (whichever
// form it's in), dropping the depends_on key entirely once it's empty rather
// than leaving `depends_on: []` / `depends_on: {}` behind.
function removeDependency(document: Document, targetService: string, dependencyService: string): void {
  const path = ["services", targetService, "depends_on"];
  const existing = document.getIn(path, true);

  if (isSeq(existing)) {
    const index = existing.items.findIndex(
      (item) => (isScalar(item) ? String(item.value) : String(item)) === dependencyService
    );
    if (index !== -1) {
      existing.items.splice(index, 1);
    }
    if (existing.items.length === 0) {
      document.deleteIn(path);
    }
    return;
  }

  if (isMap(existing)) {
    existing.delete(dependencyService);
    if (existing.items.length === 0) {
      document.deleteIn(path);
    }
  }
}

function topLevelVolumeNames(document: Document): Set<string> {
  const volumesNode = document.get("volumes", true);
  if (!isMap(volumesNode)) {
    return new Set();
  }

  return new Set(volumesNode.items.map((item) => String(item.key)));
}

function isVolumeReferencedByAnyService(document: Document, volumeName: string): boolean {
  const servicesNode = document.get("services", true);
  if (!isMap(servicesNode)) {
    return false;
  }

  return servicesNode.items.some((item) => {
    if (!isMap(item.value)) {
      return false;
    }

    return toPlainArray(item.value.get("volumes", true)).some(
      (entry) => typeof entry === "string" && entry.split(":")[0] === volumeName
    );
  });
}

// Deletes a top-level named volume once nothing references it anymore,
// including removing the whole `volumes:` key if that was the last entry -
// leaving `volumes: {}` behind reads as "still has a volume" at a glance.
// `volumeName` isn't guaranteed to actually have a top-level declaration -
// plenty of hand-written compose files reference a named volume from a
// service without declaring it under `volumes:` at all - so this has to
// check the node is really a map before touching it; `deleteIn` throws
// rather than no-op-ing when a path segment isn't a collection.
function pruneVolumeIfOrphaned(document: Document, volumeName: string): void {
  if (isVolumeReferencedByAnyService(document, volumeName)) {
    return;
  }

  const volumesNode = document.get("volumes", true);
  if (!isMap(volumesNode)) {
    return;
  }

  document.deleteIn(["volumes", volumeName]);
  if (volumesNode.items.length === 0) {
    document.deleteIn(["volumes"]);
  }
}

// Removes a service (e.g. from the "Add service" catalog, or hand-written)
// from the compose file: deletes its own block, strips it out of every other
// service's depends_on, and drops any top-level named volume that only this
// service referenced - so adding a service and then removing it round-trips
// cleanly instead of leaving orphaned volume declarations behind. Bind
// mounts and volumes still used by another service are left untouched.
export function removeServiceFromCompose(
  sourceText: string,
  serviceName: string
): { sourceText: string; diffPreview: string } {
  const document = parseDocument(sourceText, { keepSourceTokens: true });

  const servicesNode = document.get("services", true);
  const removedServiceNode = isMap(servicesNode) ? servicesNode.get(serviceName, true) : undefined;

  const declaredVolumeNames = topLevelVolumeNames(document);
  const ownVolumeNames = isMap(removedServiceNode)
    ? toPlainArray(removedServiceNode.get("volumes", true))
        .map((entry) => (typeof entry === "string" ? entry.split(":")[0] : undefined))
        .filter((name): name is string => name !== undefined && declaredVolumeNames.has(name))
    : [];

  document.deleteIn(["services", serviceName]);

  if (isMap(servicesNode)) {
    for (const item of servicesNode.items) {
      const otherServiceName = String(item.key);
      if (otherServiceName !== serviceName) {
        removeDependency(document, otherServiceName, serviceName);
      }
    }
  }

  for (const volumeName of ownVolumeNames) {
    pruneVolumeIfOrphaned(document, volumeName);
  }

  return {
    sourceText: String(document),
    diffPreview: `- services.${serviceName}`
  };
}

function scalarText(value: unknown): string {
  if (isScalar(value)) {
    return value.value === null || value.value === undefined ? "" : String(value.value);
  }
  return value === null || value === undefined ? "" : String(value);
}

// Reads a service's raw, editable fields straight out of the compose YAML -
// deliberately not sourced from ServiceNodeModel, which is a merged,
// display-formatted projection (ports become "host -> container/tcp"
// labels, volumes lose their mount path) unsuitable for round-tripping back
// into a form. Only simple string ports/volumes are surfaced; long-form
// (mapping) port/volume entries are left out of the editable list since
// there's no lossless flat-string representation for them - they're still
// visible/editable via the raw YAML editor.
export function readServiceFields(sourceText: string, serviceName: string): ServiceFields | undefined {
  const document = parseDocument(sourceText, { keepSourceTokens: true });
  const servicesNode = document.get("services", true);
  const serviceNode = isMap(servicesNode) ? servicesNode.get(serviceName, true) : undefined;

  if (!isMap(serviceNode)) {
    return undefined;
  }

  const ports = toPlainArray(serviceNode.get("ports", true)).filter(
    (entry): entry is string => typeof entry === "string"
  );
  const volumes = toPlainArray(serviceNode.get("volumes", true)).filter(
    (entry): entry is string => typeof entry === "string"
  );

  const dependsOnNode = serviceNode.get("depends_on", true);
  const dependsOn = isMap(dependsOnNode)
    ? dependsOnNode.items.map((item) => String(item.key))
    : toPlainArray(dependsOnNode).map((entry) => String(entry));

  const environment: Record<string, string> = {};
  const envNode = serviceNode.get("environment", true);
  if (isMap(envNode)) {
    for (const item of envNode.items) {
      environment[String(item.key)] = scalarText(item.value);
    }
  } else {
    for (const entry of toPlainArray(envNode)) {
      const text = String(entry);
      const separatorIndex = text.indexOf("=");
      if (separatorIndex === -1) {
        environment[text] = "";
      } else {
        environment[text.slice(0, separatorIndex)] = text.slice(separatorIndex + 1);
      }
    }
  }

  return {
    image: scalarText(serviceNode.get("image", true)),
    restart: scalarText(serviceNode.get("restart", true)),
    ports,
    volumes,
    dependsOn,
    environment
  };
}

// Applies a set of graphical field edits from the side panel to a service.
// Every field present in `fields` is fully replaced (not merged) - this is
// a form editor, not the smarter list/map-preserving merges addServiceToCompose
// uses for "connect to" wiring. A field is deleted from the YAML entirely
// once its edited value is empty, rather than being written as `[]`/`{}`.
export function applyServiceFieldEdits(
  sourceText: string,
  serviceName: string,
  fields: ServiceFieldsInput
): { sourceText: string } {
  const document = parseDocument(sourceText, { keepSourceTokens: true });
  const servicePath = ["services", serviceName];

  if (fields.image !== undefined) {
    setScalarPreservingNode(document, [...servicePath, "image"], fields.image);
  }

  if (fields.restart !== undefined) {
    if (fields.restart.trim() === "") {
      document.deleteIn([...servicePath, "restart"]);
    } else {
      setScalarPreservingNode(document, [...servicePath, "restart"], fields.restart);
    }
  }

  if (fields.ports !== undefined) {
    if (fields.ports.length === 0) {
      document.deleteIn([...servicePath, "ports"]);
    } else {
      document.setIn([...servicePath, "ports"], fields.ports);
    }
  }

  if (fields.volumes !== undefined) {
    if (fields.volumes.length === 0) {
      document.deleteIn([...servicePath, "volumes"]);
    } else {
      document.setIn([...servicePath, "volumes"], fields.volumes);
    }
  }

  if (fields.dependsOn !== undefined) {
    if (fields.dependsOn.length === 0) {
      document.deleteIn([...servicePath, "depends_on"]);
    } else {
      document.setIn([...servicePath, "depends_on"], fields.dependsOn);
    }
  }

  if (fields.environment !== undefined) {
    if (Object.keys(fields.environment).length === 0) {
      document.deleteIn([...servicePath, "environment"]);
    } else {
      document.setIn([...servicePath, "environment"], fields.environment);
    }
  }

  return { sourceText: String(document) };
}

// Backs the graph view's click-to-disconnect: removes one depends_on edge
// (fromService -> dependencyService), reusing the same list/map-aware
// removeDependency helper addServiceToCompose's connect flow and
// removeServiceFromCompose's cleanup both already use.
export function removeDependencyEdge(sourceText: string, fromService: string, dependencyService: string): { sourceText: string } {
  const document = parseDocument(sourceText, { keepSourceTokens: true });
  removeDependency(document, fromService, dependencyService);
  return { sourceText: String(document) };
}

// Backs the graph view's click-to-disconnect for a volume mount edge:
// drops `volumeName` out of `serviceName`'s volumes list (short string form
// only - see readServiceFields for why long-form mount entries are out of
// scope for these graphical edits), then drops the top-level named volume
// declaration too if no other service still mounts it.
export function removeVolumeMount(sourceText: string, serviceName: string, volumeName: string): { sourceText: string } {
  const document = parseDocument(sourceText, { keepSourceTokens: true });
  const volumesPath = ["services", serviceName, "volumes"];
  const existing = document.getIn(volumesPath, true);

  if (isSeq(existing)) {
    const remaining = existing.items.filter((item) => {
      const text = isScalar(item) ? String(item.value) : String(item);
      return text.split(":")[0] !== volumeName;
    });

    if (remaining.length === 0) {
      document.deleteIn(volumesPath);
    } else {
      existing.items = remaining;
    }
  }

  pruneVolumeIfOrphaned(document, volumeName);

  return { sourceText: String(document) };
}
