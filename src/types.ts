export interface DeltaChatConfig {
  enabled: boolean;
  email: string;
  password: string;
  displayName: string;
  dataDir: string;
  rpcServerPath: string;
}

export const DEFAULT_CONFIG: Partial<DeltaChatConfig> = {
  enabled: true,
  displayName: "OpenClaw Bot",
  dataDir: "~/.openclaw/deltachat-data",
  rpcServerPath: "deltachat-rpc-server",
};
