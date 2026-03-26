# openclaw-channel-deltachat — OpenClaw Delta Chat Channel Plugin

## Overview

**openclaw-channel-deltachat** is an OpenClaw channel plugin that bridges Delta Chat to OpenClaw's AI agent pipeline. It allows users to interact with OpenClaw agents by messaging a bot's email address via any Delta Chat client, with automatic end-to-end encryption.

The plugin follows the same pattern as OpenClaw's bundled Telegram channel but uses Delta Chat (email-based messaging) as the transport. OpenClaw handles all AI agent logic, conversation history, session management, and tool execution. The plugin is responsible only for Delta Chat protocol translation.

## Architecture

### How It Fits Into OpenClaw

```
Delta Chat Client  <-->  Email (IMAP/SMTP)  <-->  deltachat-rpc-server
                                                         |
                                                    JSON-RPC (stdio)
                                                         |
                                                  openclaw-channel-deltachat (this plugin)
                                                         |
                                                    in-process calls
                                                         |
                                                  OpenClaw Gateway (core)
                                                         |
                                                    AI Agent Pipeline
```

### Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js (runs in-process within the OpenClaw gateway)
- **Delta Chat integration:** `@deltachat/jsonrpc-client` (npm) communicating with `deltachat-rpc-server` (Rust binary) over stdio JSON-RPC
- **Plugin SDK:** OpenClaw plugin SDK (`openclaw/plugin-sdk/core`)
- **Distribution:** Standalone npm package, installable via `openclaw plugins install`

### Prerequisites

- OpenClaw gateway running
- `deltachat-rpc-server` binary on `$PATH` (install from [chatmail/core releases](https://github.com/chatmail/core/releases) or via `pip install deltachat-rpc-server`)
- An email account for the bot

### Project Structure

```
openclaw-channel-deltachat/
  openclaw.plugin.json          — Plugin manifest (id, kind, configSchema)
  package.json                  — npm package with openclaw extension declaration
  tsconfig.json                 — TypeScript config
  src/
    index.ts                    — Plugin entry point, exports register(api)
    channel.ts                  — ChannelPlugin implementation (adapters)
    deltachat.ts                — Delta Chat client wrapper (spawn rpc-server, message loop)
    types.ts                    — Shared types
  tests/
    channel.test.ts             — Unit tests
    deltachat.test.ts           — Delta Chat client tests
```

## Plugin Configuration

The plugin is configured via OpenClaw's `openclaw.json` config file under `channels.deltachat`:

```json
{
  "channels": {
    "deltachat": {
      "enabled": true,
      "email": "bot@example.com",
      "password": "secret",
      "displayName": "OpenClaw Bot",
      "dataDir": "~/.openclaw/deltachat-data",
      "rpcServerPath": "deltachat-rpc-server"
    }
  }
}
```

### Config Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | no | `true` | Enable/disable the channel |
| `email` | string | yes | — | Bot email address |
| `password` | string | yes | — | Bot email password |
| `displayName` | string | no | `"OpenClaw Bot"` | Bot display name in chats |
| `dataDir` | string | no | `~/.openclaw/deltachat-data` | Directory for Delta Chat account state |
| `rpcServerPath` | string | no | `"deltachat-rpc-server"` | Path to the `deltachat-rpc-server` binary |

## Plugin Manifest

`openclaw.plugin.json`:
```json
{
  "id": "channel-deltachat",
  "kind": "channel",
  "displayName": "Delta Chat",
  "description": "Bridge Delta Chat messaging to OpenClaw agents via email",
  "configSchema": {
    "type": "object",
    "required": ["email", "password"],
    "properties": {
      "enabled": { "type": "boolean", "default": true },
      "email": { "type": "string", "description": "Bot email address" },
      "password": { "type": "string", "description": "Bot email password" },
      "displayName": { "type": "string", "default": "OpenClaw Bot" },
      "dataDir": { "type": "string", "default": "~/.openclaw/deltachat-data" },
      "rpcServerPath": { "type": "string", "default": "deltachat-rpc-server" }
    }
  }
}
```

## ChannelPlugin Implementation

### Adapters

The plugin implements the following OpenClaw `ChannelPlugin` adapters:

#### ChannelDock (Static Capabilities)

```typescript
const dock: ChannelDock = {
  id: "deltachat",
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,  // All file types are passed through as opaque attachments; OpenClaw's pipeline decides what to do with them
    blockStreaming: true,  // Delta Chat is email-based; no real-time streaming
  },
  outbound: {
    textChunkLimit: 0,  // No enforcement — Delta Chat handles arbitrarily large text bodies (they are email bodies)
  },
  groups: {
    resolveRequireMention: () => false,  // Bot responds to all messages in approved groups
  },
  threading: {
    resolveReplyToMode: () => "off",  // Delta Chat doesn't have threaded replies; all messages go to the chat
  },
};
```

#### ConfigAdapter (Account Resolution)

Resolves the Delta Chat account. Since the plugin supports a single bot email account:

- `listAccountIds()` — returns `["default"]`
- `resolveAccount(accountId)` — returns the configured email address and display name

#### SecurityAdapter (DM/Group Policy)

Delegates to OpenClaw's built-in security framework. The plugin maps Delta Chat concepts to OpenClaw's policy system:

- **DM policy:** Uses OpenClaw's `dmPolicy` setting (pairing, allowlist, open, disabled)
- **Group policy:** Uses OpenClaw's `groupPolicy` setting with per-group allowlists
- Session keys are derived from Delta Chat identifiers:
  - 1:1 chats: `deltachat:dm:<sender-email>`
  - Group chats: `deltachat:group:<chat-id>`

#### OutboundAdapter (Message Delivery)

Sends OpenClaw agent responses back through Delta Chat:

- `sendText(sessionKey, text, options)` — resolves session key to a Delta Chat chat ID and sends a text message
- `sendMedia(sessionKey, media)` — sends file attachments. OpenClaw passes media as `{ path: string, mimeType: string, filename?: string }`. The plugin passes the file path directly to `dc.rpc.sendMsg()` with the `file` field (Delta Chat handles blob management internally).

**Session key resolution for outbound:**
- `deltachat:dm:<email>` — look up contact by email via `dc.rpc.lookupContactIdByAddr()`, then get or create the 1:1 chat via `dc.rpc.createChatByContactId()`. This ensures the chat exists even if the bot hasn't been messaged first.
- `deltachat:group:<chatId>` — parse the integer chat ID directly from the key.

#### GatewayAdapter (Lifecycle)

- `start()` — spawns `deltachat-rpc-server` as a child process, creates the `StdioDeltaChat` client, configures the account if first run, starts I/O, and begins the message polling loop
- `stop()` — sets `running = false` to break the message loop, awaits any in-flight dispatch to complete (with a 10-second timeout), then closes the RPC client and kills the server process

#### GroupsAdapter (Group Members)

- `getMembers(sessionKey)` — returns the list of group member emails/display names for a given group chat

### Inbound Message Flow

When a Delta Chat message arrives:

1. The message loop runs an async `while (running)` loop that calls `dc.rpc.getNextMsgs(accountId)` which blocks until new messages arrive (no interval-based polling). This is the standard pattern for Delta Chat bots.
2. For each message:
   a. Fetch the full message via `dc.rpc.getMessage()`
   b. Skip system/info messages (`msg.isInfo`) and self-sent messages (`msg.fromId === DC_CONTACT_ID_SELF`)
   c. Fetch chat info via `dc.rpc.getFullChatById()`
   d. Determine session key based on `chat.chatType`:
      - `"Single"` → `deltachat:dm:<sender-email>`
      - `"Group"` → `deltachat:group:<chatId>`
      - All other types (`"Mailinglist"`, `"OutBroadcast"`, `"InBroadcast"`) are ignored (message skipped)
   e. Build the `ChannelMessageActionContext` with:
      - `text`: message text
      - `media`: file attachments (images, documents) if present
      - `senderEmail`: sender's email address
      - `chatType`: "direct" or "group"
      - `sessionKey`: for OpenClaw session routing
   f. Call `runtime.dispatch(context)` to push into OpenClaw's agent pipeline
   g. Mark message as seen via `dc.rpc.markseenMsgs()`

### Media Handling

**Inbound (Delta Chat → OpenClaw):**

Delta Chat messages may include file attachments (`msg.file`, `msg.fileMime`). The plugin:
- Reads the file from the Delta Chat blob directory (`msg.file` is an absolute path)
- Passes it to OpenClaw's dispatch context as media
- OpenClaw's agent pipeline handles vision/document analysis

**Outbound (OpenClaw → Delta Chat):**

When OpenClaw's agent includes file attachments in its response:
- The `sendMedia` adapter receives file metadata `{ path, mimeType, filename }`
- The file path is passed directly to `dc.rpc.sendMsg()` with the `file` field — Delta Chat handles blob management internally

### Error Handling

- **`deltachat-rpc-server` crash:** The plugin monitors the child process via the `exit` event. On unexpected exit, it logs the error and attempts to respawn after 5 seconds. If 3 crashes occur within 60 seconds, the plugin enters a disabled state and logs an error. The failure counter resets after 60 seconds of successful operation.
- **Email connectivity issues:** Handled by the Delta Chat core (auto-reconnect, message queuing). The plugin does not need to manage this.
- **Message send failures:** The plugin subscribes to `MsgFailed` events via `dc.on("MsgFailed", ...)` on the `StdioDeltaChat` event emitter and logs them. OpenClaw's retry framework handles user-visible error reporting.

## Delta Chat Client Wrapper (`deltachat.ts`)

Encapsulates all interaction with `deltachat-rpc-server`:

```typescript
class DeltaChatClient {
  private dc: StdioDeltaChat;
  private server: ChildProcess;
  private accountId: number;
  private running: boolean;

  constructor(config: DeltaChatConfig);

  // Lifecycle
  async start(): Promise<void>;      // Spawn server, configure account, start I/O
  async stop(): Promise<void>;       // Stop loop, close client, kill server

  // Message loop — async while loop calling dc.rpc.getNextMsgs(), blocks until messages arrive
  async runMessageLoop(handler: (msg: Message, chat: FullChat) => Promise<void>): Promise<void>;

  // Sending
  async sendText(chatId: number, text: string): Promise<number>;
  async sendFile(chatId: number, text: string | null, filePath: string, filename?: string): Promise<number>;

  // Events — registers listeners on the StdioDeltaChat event emitter
  onEvent(event: string, handler: (...args: any[]) => void): void;

  // Queries
  async getChatBySessionKey(sessionKey: string): Promise<number>;
  async getContactEmail(contactId: number): Promise<string>;
  async getChatMembers(chatId: number): Promise<Array<{ email: string; name: string }>>;
  async getChatInfo(chatId: number): Promise<FullChat>;
}
```

### Account Setup

On first start, the client:
1. Checks for existing configured accounts via `dc.rpc.getAllAccountIds()`
2. If no account exists, creates one and configures it with the provided email/password
3. Sets `bot` config to `"1"` (auto-accept chats) and `displayname`
4. Starts I/O

On subsequent starts, the existing account is reused. If the configured `email` differs from the stored account's address, the old account is removed and a new one is created. If only the `password` changes, the account is reconfigured with the new credentials via `dc.rpc.addOrUpdateTransport()`.

## Installation & Setup

### Install

```bash
# From npm (when published)
openclaw plugins install openclaw-channel-deltachat

# From local directory (development)
cd openclaw-channel-deltachat
npm install
npm run build
openclaw plugins install -l .
```

### Configure

Add to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "deltachat": {
      "email": "bot@example.com",
      "password": "secret"
    }
  }
}
```

### Start

```bash
openclaw gateway restart
```

Users message the bot's email address from any Delta Chat client. The bot appears as a regular Delta Chat contact.

## What the Plugin Does NOT Handle

These are all managed by OpenClaw core:

- Conversation history / session persistence
- AI model selection and execution
- Tool calling / function execution
- Access control policy decisions (the plugin enforces policies, OpenClaw defines them)
- Rate limiting
- Multi-agent routing
- User preferences and settings

## Non-Goals (v1)

- Message streaming/live edits (Delta Chat is email-based; messages are sent as complete units)
- Reactions or emoji responses
- Webxdc apps integration
- Multiple bot accounts per plugin instance
- Read receipts as typing indicators
- Inline keyboards or interactive elements

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `@deltachat/jsonrpc-client` | TypeScript client for deltachat-rpc-server |
| `openclaw` (peer) | OpenClaw plugin SDK types and interfaces |
| `deltachat-rpc-server` (system) | Rust binary for Delta Chat core (IMAP/SMTP/encryption) |
