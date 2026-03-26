export interface DeltaChatConfig {
  enabled: boolean;
  /** Optional: email address for a pre-existing account. If omitted, a chatmail account is auto-created. */
  email?: string;
  /** Optional: password for a pre-existing account. Required if email is set. */
  password?: string;
  displayName: string;
  dataDir: string;
  rpcServerPath: string;
  /** Chatmail server URL for auto-creating accounts. Defaults to nine.testrun.org. */
  chatmailServer: string;
}

export const DEFAULT_CONFIG: Partial<DeltaChatConfig> = {
  enabled: true,
  displayName: "OC",
  dataDir: "~/.openclaw/deltachat-data",
  rpcServerPath: "deltachat-rpc-server",
  chatmailServer: "nine.testrun.org",
};
