import * as z from "zod";

// Kept separate from contracts.ts deliberately, same reasoning as
// network-contracts.ts: a different domain (this app's own network exposure)
// from the Compose-project model the rest of contracts.ts describes.

export type DetectedAddress = {
  interfaceName: string;
  address: string;
};

export type RemoteAccessStatus =
  | { enabled: false; detectedAddresses: DetectedAddress[] }
  | { enabled: true; port: number; host: string; url: string; token: string; detectedAddresses: DetectedAddress[] };

export const RemoteAccessEnableRequestSchema = z.object({
  port: z.number().int().min(1).max(65535),
  // Optional: lets the user pick which address the shown URL advertises
  // (LAN IP, a Tailscale/VPN interface, a public IP/DDNS name behind a
  // port-forward, etc.) instead of the best-effort auto-detected one - the
  // server itself always binds every interface (0.0.0.0) regardless of this.
  host: z.string().min(1).optional()
});

export type RemoteAccessEnableRequest = z.infer<typeof RemoteAccessEnableRequestSchema>;

export const RemoteAccessSetHostRequestSchema = z.object({
  host: z.string().min(1)
});

export type RemoteAccessPreloadApi = {
  getRemoteAccessStatus(): Promise<RemoteAccessStatus>;
  enableRemoteAccess(port: number, host?: string): Promise<RemoteAccessStatus>;
  disableRemoteAccess(): Promise<RemoteAccessStatus>;
  regenerateRemoteAccessToken(): Promise<RemoteAccessStatus>;
  setRemoteAccessHost(host: string): Promise<RemoteAccessStatus>;
};
