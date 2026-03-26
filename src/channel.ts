import type { T } from "@deltachat/jsonrpc-client";
import { DeltaChatClient } from "./deltachat.js";

// --- Types for inbound context ---

export interface InboundContext {
  text: string;
  sessionKey: string;
  senderEmail: string;
  chatType: "direct" | "group";
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
    media:
      input.file && input.fileMime
        ? { path: input.file, mimeType: input.fileMime }
        : null,
  };
}

// --- Channel Plugin Factory ---

export function createDeltaChatChannel(client: DeltaChatClient) {
  const dock = {
    id: "deltachat",
    capabilities: {
      chatTypes: ["direct", "group"] as const,
      media: true,
      blockStreaming: true,
    },
    outbound: {
      textChunkLimit: 0,
    },
    groups: {
      resolveRequireMention: () => false,
    },
    threading: {
      resolveReplyToMode: () => "off" as const,
    },
  };

  return {
    id: "deltachat",
    meta: {
      label: "Delta Chat",
      blurb: "Bridge Delta Chat messaging to OpenClaw agents via email",
    },
    capabilities: { chatTypes: ["direct", "group"] as const },
    dock,

    config: {
      listAccountIds: async () => ["default"],
      resolveAccount: async (_accountId: string) => ({
        id: "default",
        label: "Delta Chat Bot",
      }),
    },

    outbound: {
      sendText: async (sessionKey: string, text: string) => {
        const chatId = await client.getChatBySessionKey(sessionKey);
        await client.sendText(chatId, text);
      },
      sendMedia: async (
        sessionKey: string,
        media: { path: string; mimeType: string; filename?: string },
      ) => {
        const chatId = await client.getChatBySessionKey(sessionKey);
        await client.sendFile(chatId, null, media.path, media.filename);
      },
    },

    gateway: {
      start: async (runtime: { dispatch: (ctx: InboundContext) => Promise<void> }) => {
        await client.start();

        // Listen for send failures
        client.onEvent("MsgFailed", (...args: unknown[]) => {
          console.error("[deltachat] Message send failed:", ...args);
        });

        // Start message loop (runs in background until stop)
        const loopPromise = client.runMessageLoop(async (msg: T.Message, chat: T.FullChat) => {
          if (shouldSkipChat(chat.chatType)) return;

          const senderEmail = await client.getContactEmail(msg.fromId);

          const context = buildInboundContext({
            text: msg.text,
            senderEmail,
            chatType: chat.chatType,
            chatId: msg.chatId,
            file: msg.file,
            fileMime: msg.fileMime,
          });

          await runtime.dispatch(context);
        });
        loopPromise.catch((err) => console.error("[deltachat] Message loop crashed:", err));
      },

      stop: async () => {
        await client.stop();
      },
    },

    // SecurityAdapter is omitted — OpenClaw core provides default security
    // behavior based on session keys and the gateway-level dmPolicy/groupPolicy
    // settings. The plugin does not need to implement custom security logic.

    groups: {
      getMembers: async (sessionKey: string) => {
        const chatId = await client.getChatBySessionKey(sessionKey);
        return client.getChatMembers(chatId);
      },
    },
  };
}
