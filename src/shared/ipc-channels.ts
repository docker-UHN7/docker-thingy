export const IPC_CHANNELS = {
  GET_SNAPSHOT: "app:get-snapshot",
  REFRESH_RUNTIME: "app:refresh-runtime",
  OPEN_SOURCE: "app:open-source",
  OPEN_SOURCE_PATH: "app:open-source-path",
  OPEN_RECENT_SOURCE: "app:open-recent-source",
  GET_SERVICE_LOGS: "app:get-service-logs",
  UPDATE_SETTINGS: "app:update-settings",
  CLEAR_RECENTS: "app:clear-recents",
  BUILD_EVENT: "build:event"
} as const;
