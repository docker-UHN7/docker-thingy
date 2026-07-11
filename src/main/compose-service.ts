import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isMap, isScalar, parseDocument } from "yaml";
import type { Document } from "yaml";
import type {
  DependencyDescriptor,
  GraphExternalNode,
  PortMapping,
  ProjectDiagnostics,
  ProjectSummary,
  RelationshipEdge,
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

function parseDependencies(value: unknown): DependencyDescriptor[] {
  if (Array.isArray(value)) {
    return value.map((entry) => ({
      serviceName: String(entry)
    }));
  }

  if (isMap(value)) {
    return value.items.map((entry) => {
      const condition = isMap(entry.value) ? entry.value.get("condition") : undefined;
      return {
        serviceName: String(entry.key),
        condition: typeof condition === "string" ? condition : undefined
      };
    });
  }

  return [];
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (isMap(value)) {
    return value.items.map((entry) => String(entry.key));
  }

  return [];
}

function parseVolumes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
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
    const build = item.value.get("build", true);
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
      ...(Array.isArray(ports) ? ports.flatMap((entry) => toPortMapping(entry, "compose")) : []),
      ...(Array.isArray(expose) ? expose.flatMap((entry) => toExposeMapping(entry)) : [])
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
          expose: Array.isArray(expose)
            ? expose
                .map((entry) => parsePortToken(String(entry))?.containerPort)
                .filter((entry): entry is number => Number.isFinite(entry))
            : []
        }
      }
    ];
  });
}

export async function loadComposeProject(sourcePath: string, contextName: string): Promise<ProjectSummary> {
  const sourceText = await readFile(sourcePath, "utf8");
  const document = parseDocument(sourceText, {
    keepSourceTokens: true
  });

  const services = toServiceModels(document);
  const diagnostics: ProjectDiagnostics[] = [];

  for (const service of services) {
    if (service.sourceHints?.buildContext) {
      diagnostics.push(...describeComposePath(service.sourceHints.buildContext));
    }
  }

  return {
    id: `source-compose:${contextName}:${sourcePath}`,
    title: sourcePath.split(/[/\\]/).at(-1) ?? sourcePath,
    subtitle: "Explicitly opened Compose source",
    runtimeKind: "compose",
    access: "editable",
    contextName,
    sourcePath,
    configFiles: [sourcePath],
    services,
    diagnostics,
    actions: [
      { id: "validate", label: "Validate", emphasis: "primary" },
      { id: "apply-start", label: "Apply & Start", confirmation: "Apply changes and start this Compose project?" },
      { id: "stop", label: "Stop", emphasis: "danger", confirmation: "Stop containers for this project?" }
    ],
    lastUpdatedLabel: "Opened from source",
    lastCheckedAt: new Date().toISOString(),
    externalNodes: inferExternalNodes(services),
    relationshipEdges: buildRelationshipEdges(services),
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
