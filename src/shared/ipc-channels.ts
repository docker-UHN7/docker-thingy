export const IPC_CHANNELS = {
  GET_SNAPSHOT: "app:get-snapshot",
  OPEN_SOURCE: "app:open-source",
  OPEN_SOURCE_PATH: "app:open-source-path",
  OPEN_RECENT_SOURCE: "app:open-recent-source",
  OPEN_EXTERNAL_URL: "app:open-external-url",
  GET_SERVICE_LOGS: "app:get-service-logs",
  GET_SERVICE_STATS: "app:get-service-stats",
  UPDATE_SETTINGS: "app:update-settings",
  CLEAR_RECENTS: "app:clear-recents",
  RUN_PROJECT_ACTION: "app:run-project-action",
  BUILD_EVENT: "build:event",
  UPDATE_PROJECT_CONFIG_FILES: "app:update-project-config-files",
  SNAPSHOT_EVENT: "snapshot:event",
  NETWORK_GET_TOPOLOGY: "network:get-topology",
  NETWORK_RUN_ACTION: "network:run-action"
} as const;
