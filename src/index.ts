import { DeltaChatClient } from "./deltachat.js";
import { createDeltaChatChannel } from "./channel.js";
import type { DeltaChatConfig } from "./types.js";

export default function register(api: any) {
  // OpenClaw plugin API: config from channels.deltachat section
  const channelConfig = api.config?.channels?.deltachat ?? {};

  const config: DeltaChatConfig = {
    enabled: channelConfig.enabled ?? true,
    email: channelConfig.email,
    password: channelConfig.password,
    displayName: channelConfig.displayName ?? "OpenClaw Bot",
    dataDir: channelConfig.dataDir ?? "~/.openclaw/deltachat-data",
    rpcServerPath: channelConfig.rpcServerPath ?? "deltachat-rpc-server",
  };

  if (!config.enabled) {
    api.logger?.info("[deltachat] Channel disabled by config");
    return;
  }

  if (!config.email || !config.password) {
    api.logger?.error("[deltachat] Missing required config: email and password");
    return;
  }

  const client = new DeltaChatClient(config);
  const channel = createDeltaChatChannel(client);

  api.registerChannel(channel);
  api.logger?.info(`[deltachat] Channel registered for ${config.email}`);
}
