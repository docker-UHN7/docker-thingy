// Curated defaults for the "Add service" catalog. Kept as plain data (no
// Node/Electron APIs) so both the main process (compose mutation) and the
// renderer (catalog UI) can import it directly.

export type ServicePresetCategory = "database" | "cache" | "queue" | "storage" | "search";

export type ServicePreset = {
  key: string;
  name: string;
  description: string;
  category: ServicePresetCategory;
  defaultImage: string;
  defaultServiceName: string;
  defaultPort: number;
  /** Seed environment variables for the new service itself (credentials, db name, ...). */
  environment: Record<string, string>;
  /** Container-side path to persist to a named volume, if the service needs one. */
  volumeMountPath?: string;
  /**
   * Env vars to inject into whatever service connects to this one. Values are
   * templates: `{{service}}` resolves to the new service's compose name,
   * `{{SOME_KEY}}` resolves against this preset's own `environment` map -
   * see resolveConnectionEnv.
   */
  connectionEnv: Record<string, string>;
};

export const SERVICE_PRESETS: ServicePreset[] = [
  {
    key: "postgres",
    name: "PostgreSQL",
    description: "Relational database",
    category: "database",
    defaultImage: "postgres:16",
    defaultServiceName: "postgres",
    defaultPort: 5432,
    environment: { POSTGRES_USER: "app", POSTGRES_PASSWORD: "app", POSTGRES_DB: "app" },
    volumeMountPath: "/var/lib/postgresql/data",
    connectionEnv: {
      DATABASE_URL: "postgres://{{POSTGRES_USER}}:{{POSTGRES_PASSWORD}}@{{service}}:5432/{{POSTGRES_DB}}"
    }
  },
  {
    key: "mysql",
    name: "MySQL",
    description: "Relational database",
    category: "database",
    defaultImage: "mysql:8",
    defaultServiceName: "mysql",
    defaultPort: 3306,
    environment: {
      MYSQL_ROOT_PASSWORD: "app",
      MYSQL_DATABASE: "app",
      MYSQL_USER: "app",
      MYSQL_PASSWORD: "app"
    },
    volumeMountPath: "/var/lib/mysql",
    connectionEnv: {
      DATABASE_URL: "mysql://{{MYSQL_USER}}:{{MYSQL_PASSWORD}}@{{service}}:3306/{{MYSQL_DATABASE}}"
    }
  },
  {
    key: "redis",
    name: "Redis",
    description: "In-memory cache and message broker",
    category: "cache",
    defaultImage: "redis:7-alpine",
    defaultServiceName: "redis",
    defaultPort: 6379,
    environment: {},
    connectionEnv: {
      REDIS_URL: "redis://{{service}}:6379"
    }
  },
  {
    key: "mongo",
    name: "MongoDB",
    description: "Document database",
    category: "database",
    defaultImage: "mongo:7",
    defaultServiceName: "mongo",
    defaultPort: 27017,
    environment: {
      MONGO_INITDB_ROOT_USERNAME: "app",
      MONGO_INITDB_ROOT_PASSWORD: "app"
    },
    volumeMountPath: "/data/db",
    connectionEnv: {
      MONGODB_URI: "mongodb://{{MONGO_INITDB_ROOT_USERNAME}}:{{MONGO_INITDB_ROOT_PASSWORD}}@{{service}}:27017"
    }
  }
];

export function findPresetByKey(key: string): ServicePreset | undefined {
  return SERVICE_PRESETS.find((preset) => preset.key === key);
}

// Matches a Docker Hub repo name (e.g. "library/postgres", "bitnami/postgresql")
// to a curated preset so raw Hub search results can still get smart defaults
// pre-filled instead of an empty form.
export function findPresetForImageName(imageRepo: string): ServicePreset | undefined {
  const normalized = imageRepo.toLowerCase().replace(/^library\//, "");
  return SERVICE_PRESETS.find((preset) => normalized === preset.key || normalized.includes(preset.key));
}

export function searchPresets(query: string): ServicePreset[] {
  const term = query.trim().toLowerCase();
  if (!term) {
    return SERVICE_PRESETS;
  }

  return SERVICE_PRESETS.filter(
    (preset) =>
      preset.key.includes(term) ||
      preset.name.toLowerCase().includes(term) ||
      preset.description.toLowerCase().includes(term)
  );
}

// Resolves a preset's connectionEnv templates against a concrete service name
// and its (possibly user-edited) environment values, e.g.
// "postgres://{{POSTGRES_USER}}:{{POSTGRES_PASSWORD}}@{{service}}:5432/{{POSTGRES_DB}}"
// -> "postgres://app:app@postgres:5432/app".
export function resolveConnectionEnv(
  preset: ServicePreset,
  serviceName: string,
  environment: Record<string, string>
): Record<string, string> {
  const context: Record<string, string> = { service: serviceName, ...environment };
  const output: Record<string, string> = {};

  for (const [key, template] of Object.entries(preset.connectionEnv)) {
    output[key] = template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => context[token] ?? "");
  }

  return output;
}
