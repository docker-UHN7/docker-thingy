export const IPC_CHANNELS = {
  GET_SNAPSHOT: "app:get-snapshot",
  REFRESH_RUNTIME: "app:refresh-runtime",
  OPEN_SOURCE: "app:open-source",
  OPEN_SOURCE_PATH: "app:open-source-path",
  OPEN_RECENT_SOURCE: "app:open-recent-source",
  GET_SERVICE_LOGS: "app:get-service-logs",
  GET_SERVICE_STATS: "app:get-service-stats",
  UPDATE_SETTINGS: "app:update-settings",
  CLEAR_RECENTS: "app:clear-recents",
  RUN_PROJECT_ACTION: "app:run-project-action",
  BUILD_EVENT: "build:event",
  UPDATE_PROJECT_CONFIG_FILES: "app:update-project-config-files"
} as const;
