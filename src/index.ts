import { DeltaChatClient } from "./deltachat.js";
import { createDeltaChatChannel } from "./channel.js";
import type { DeltaChatConfig } from "./types.js";

export function register(api: any) {
  const rawConfig = api.getConfig() ?? {};

  const config: DeltaChatConfig = {
    enabled: rawConfig.enabled ?? true,
    email: rawConfig.email,
    password: rawConfig.password,
    displayName: rawConfig.displayName ?? "OpenClaw Bot",
    dataDir: rawConfig.dataDir ?? "~/.openclaw/deltachat-data",
    rpcServerPath: rawConfig.rpcServerPath ?? "deltachat-rpc-server",
  };

  if (!config.enabled) {
    console.log("[deltachat] Channel disabled by config");
    return;
  }

  if (!config.email || !config.password) {
    console.error("[deltachat] Missing required config: email and password");
    return;
  }

  const client = new DeltaChatClient(config);
  const channel = createDeltaChatChannel(client);

  api.registerChannel({ plugin: channel });
  console.log(`[deltachat] Channel registered for ${config.email}`);
}
