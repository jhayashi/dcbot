import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { T } from "@deltachat/jsonrpc-client";
import { DeltaChatClient } from "./deltachat.js";
import type { DeltaChatConfig } from "./types.js";

// --- Types for inbound context ---

export interface InboundContext {
  text: string;
  sessionKey: string;
  senderEmail: string;
  chatType: "direct" | "group";
  chatId: number;
  media: { path: string; mimeType: string } | null;
}

interface InboundInput {
  text: string;
  senderEmail: string;
  chatType: T.ChatType;
  chatId: number;
  file: string | null;
  fileMime: string | null;
}

// --- Helpers (exported for testing) ---

export function shouldSkipChat(chatType: string): boolean {
  return chatType !== "Single" && chatType !== "Group";
}

export function buildInboundContext(input: InboundInput): InboundContext {
  const isGroup = input.chatType === "Group";

  const sessionKey = isGroup
    ? DeltaChatClient.buildSessionKey("group", input.chatId)
    : DeltaChatClient.buildSessionKey("dm", input.senderEmail);

  return {
    text: input.text,
    sessionKey,
    senderEmail: input.senderEmail,
    chatType: isGroup ? "group" : "direct",
    chatId: input.chatId,
    media:
      input.file && input.fileMime
        ? { path: input.file, mimeType: input.fileMime }
        : null,
  };
}

// --- Channel Plugin Factory ---

// Minimal type stubs for OpenClaw SDK types we depend on.
// These mirror the real SDK types enough for our plugin to compile
// without importing from openclaw (which is a peerDependency).

type OpenClawConfig = Record<string, unknown>;

interface ChannelGatewayContext {
  cfg: OpenClawConfig;
  accountId: string;
  account: ResolvedAccount;
  runtime: unknown;
  abortSignal: AbortSignal;
  log?: ChannelLogSink;
  getStatus: () => Record<string, unknown>;
  setStatus: (next: Record<string, unknown>) => void;
  channelRuntime?: {
    reply: {
      dispatchReplyWithBufferedBlockDispatcher: (params: {
        ctx: Record<string, unknown>;
        cfg: OpenClawConfig;
        dispatcherOptions: {
          deliver: (payload: { text?: string; mediaUrl?: string }, info: { kind: string }) => Promise<void>;
          onError?: (err: unknown, info: { kind: string }) => void;
        };
        replyOptions?: Record<string, unknown>;
      }) => Promise<unknown>;
      finalizeInboundContext: <T extends Record<string, unknown>>(ctx: T) => T;
    };
  };
}

interface ChannelLogSink {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
}

interface ChannelOutboundContext {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  accountId?: string | null;
  replyToId?: string | null;
  threadId?: string | number | null;
}

interface ChannelGroupContext {
  cfg: OpenClawConfig;
  groupId?: string | null;
  accountId?: string | null;
  senderId?: string | null;
}

interface OutboundDeliveryResult {
  messageId?: string;
}

interface ResolvedAccount {
  id: string;
  label: string;
  email?: string;
  password?: string;
  displayName: string;
  dataDir: string;
  rpcServerPath: string;
  chatmailServer: string;
  enabled: boolean;
}

function resolveAccountFromConfig(cfg: OpenClawConfig, _accountId?: string | null): ResolvedAccount {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const dc = (channels?.deltachat ?? {}) as Record<string, unknown>;
  return {
    id: "default",
    label: (dc.displayName as string) ?? "OC",
    email: dc.email as string | undefined,
    password: dc.password as string | undefined,
    displayName: (dc.displayName as string) ?? "OC",
    dataDir: (dc.dataDir as string) ?? "~/.openclaw/deltachat-data",
    rpcServerPath: (dc.rpcServerPath as string) ?? "deltachat-rpc-server",
    chatmailServer: (dc.chatmailServer as string) ?? "nine.testrun.org",
    enabled: (dc.enabled as boolean) ?? true,
  };
}

/** Shared state for the invite link/QR, readable by the HTTP route. */
export const inviteState: { inviteLink: string | null; svg: string | null } = {
  inviteLink: null,
  svg: null,
};

export function createDeltaChatChannel() {
  // Client is created lazily when the gateway starts an account
  let client: DeltaChatClient | null = null;
  // Used to keep startAccount alive until stopAccount is called
  let accountStopped: (() => void) | null = null;

  return {
    id: "deltachat" as const,

    meta: {
      id: "deltachat" as const,
      label: "Delta Chat",
      selectionLabel: "Delta Chat",
      docsPath: "deltachat",
      blurb: "Bridge Delta Chat messaging to OpenClaw agents via email",
    },

    capabilities: {
      chatTypes: ["direct", "group"] as Array<"direct" | "group">,
      media: true,
      blockStreaming: true,
    },

    config: {
      listAccountIds: (_cfg: OpenClawConfig): string[] => {
        return ["default"];
      },

      resolveAccount: resolveAccountFromConfig,

      isEnabled: (account: ResolvedAccount): boolean => account.enabled,

      isConfigured: (_account: ResolvedAccount): boolean => true,

      unconfiguredReason: (_account: ResolvedAccount): string => "",

      describeAccount: (account: ResolvedAccount) => ({
        accountId: account.id,
        name: account.label,
        enabled: account.enabled,
        configured: true,
      }),
    },

    outbound: {
      deliveryMode: "direct" as const,
      textChunkLimit: 0,

      sendText: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
        if (!client) throw new Error("Delta Chat client not started");
        const chatId = await client.getChatBySessionKey(ctx.to);
        const msgId = await client.sendText(chatId, ctx.text);
        return { messageId: String(msgId) };
      },

      sendMedia: async (ctx: ChannelOutboundContext & { mediaUrl: string }): Promise<OutboundDeliveryResult> => {
        if (!client) throw new Error("Delta Chat client not started");
        const chatId = await client.getChatBySessionKey(ctx.to);
        const msgId = await client.sendFile(chatId, null, ctx.mediaUrl);
        return { messageId: String(msgId) };
      },
    },

    gateway: {
      startAccount: async (ctx: ChannelGatewayContext): Promise<void> => {
        // Guard against double-start
        if (client) {
          await client.stop();
          client = null;
        }
        if (accountStopped) {
          accountStopped();
          accountStopped = null;
        }

        const account = ctx.account;
        const config: DeltaChatConfig = {
          enabled: account.enabled,
          email: account.email,
          password: account.password,
          displayName: account.displayName,
          dataDir: account.dataDir,
          rpcServerPath: account.rpcServerPath,
          chatmailServer: account.chatmailServer,
        };

        const log = ctx.log ?? {
          info: (msg: string) => console.log(`[deltachat] ${msg}`),
          warn: (msg: string) => console.warn(`[deltachat] ${msg}`),
          error: (msg: string) => console.error(`[deltachat] ${msg}`),
        };

        client = new DeltaChatClient(config);
        try {
          await client.start();
        } catch (err) {
          log.error(`Failed to start Delta Chat client: ${err}`);
          client = null;
          return;
        }

        log.info(`Started Delta Chat client for ${account.displayName}`);

        // Generate and publish SecureJoin invite link + QR code
        try {
          const invite = await client.getSecureJoinInvite();
          inviteState.inviteLink = invite.inviteLink;
          inviteState.svg = invite.svg;
          log.info(`SecureJoin invite link: ${invite.inviteLink}`);

          // Save QR code SVG to data dir for external access
          const dataDir = account.dataDir.startsWith("~")
            ? account.dataDir.replace("~", homedir())
            : account.dataDir;
          const qrDir = resolve(dataDir);
          await mkdir(qrDir, { recursive: true });
          const qrPath = resolve(qrDir, "invite-qr.svg");
          await writeFile(qrPath, invite.svg);
          log.info(`SecureJoin QR code saved to ${qrPath}`);
        } catch (err) {
          log.error(`Failed to generate SecureJoin invite: ${err}`);
        }

        // Listen for send failures
        client.onEvent("MsgFailed", (...args: unknown[]) => {
          log.error(`Message send failed: ${JSON.stringify(args)}`);
        });

        if (!ctx.channelRuntime) {
          log.warn("channelRuntime not available — AI dispatch disabled");
        }

        // Start event-based message handler
        const currentClient = client;
        currentClient.startMessageHandler(async (msg: T.Message, chat: T.FullChat) => {
          if (shouldSkipChat(chat.chatType)) return;

          const senderEmail = await currentClient.getContactEmail(msg.fromId);
          log.info(`Incoming message from ${senderEmail}: "${msg.text.slice(0, 50)}"`);

          const inbound = buildInboundContext({
            text: msg.text,
            senderEmail,
            chatType: chat.chatType,
            chatId: msg.chatId,
            file: msg.file,
            fileMime: msg.fileMime,
          });

          if (!ctx.channelRuntime) {
            log.warn(`No channelRuntime — dropping message from ${senderEmail}`);
            return;
          }

          // Build MsgContext for OpenClaw dispatch
          const isGroup = inbound.chatType === "group";
          const msgContext: Record<string, unknown> = {
            Body: inbound.text,
            From: inbound.senderEmail,
            SessionKey: inbound.sessionKey,
            AccountId: ctx.accountId,
            ChatType: isGroup ? "group" : "direct",
            Provider: "deltachat",
            SenderId: inbound.senderEmail,
            SenderName: inbound.senderEmail,
            Timestamp: Date.now(),
          };

          // Attach media if present
          if (inbound.media) {
            msgContext.MediaPath = inbound.media.path;
            msgContext.MediaType = inbound.media.mimeType;
          }

          // Dispatch AI reply
          await ctx.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctx.channelRuntime.reply.finalizeInboundContext(msgContext),
            cfg: ctx.cfg,
            dispatcherOptions: {
              deliver: async (payload, _info) => {
                try {
                  if (payload.text) {
                    await currentClient.sendText(inbound.chatId, payload.text);
                  }
                  if (payload.mediaUrl) {
                    await currentClient.sendFile(inbound.chatId, null, payload.mediaUrl);
                  }
                } catch (err) {
                  log.error(`Failed to deliver reply to chat ${inbound.chatId}: ${err}`);
                }
              },
              onError: (err) => {
                log.error(`Reply dispatch error: ${err}`);
              },
            },
          });
        });

        // Block until stopAccount is called — the gateway expects startAccount
        // to stay alive for the lifetime of the account.
        await new Promise<void>((resolve) => {
          accountStopped = resolve;
        });
      },

      stopAccount: async (_ctx: ChannelGatewayContext): Promise<void> => {
        if (client) {
          await client.stop();
          client = null;
        }
        if (accountStopped) {
          accountStopped();
          accountStopped = null;
        }
      },
    },

    groups: {
      resolveRequireMention: (_params: ChannelGroupContext): boolean | undefined => false,
    },

    threading: {
      resolveReplyToMode: (): "off" => "off",
    },
  };
}
