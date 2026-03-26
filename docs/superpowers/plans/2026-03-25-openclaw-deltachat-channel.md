# openclaw-channel-deltachat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OpenClaw channel plugin that bridges Delta Chat messaging to OpenClaw's AI agent pipeline.

**Architecture:** TypeScript OpenClaw channel plugin running in-process within the gateway. Spawns `deltachat-rpc-server` as a child process, communicates via `@deltachat/jsonrpc-client` over stdio JSON-RPC. Inbound messages are dispatched to OpenClaw's agent pipeline; outbound responses are sent back via Delta Chat.

**Tech Stack:** TypeScript, Node.js, @deltachat/jsonrpc-client, OpenClaw plugin SDK, vitest (testing)

**Spec:** `docs/superpowers/specs/2026-03-25-openclaw-deltachat-channel-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `openclaw.plugin.json`
- Create: `src/types.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
*.js
*.d.ts
*.js.map
!openclaw.plugin.json
```

- [ ] **Step 2: Create package.json**

Create `package.json`:
```json
{
  "name": "openclaw-channel-deltachat",
  "version": "0.1.0",
  "description": "OpenClaw channel plugin for Delta Chat",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"]
  },
  "peerDependencies": {
    "openclaw": "*"
  },
  "dependencies": {
    "@deltachat/jsonrpc-client": "^2.47.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^22.0.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create openclaw.plugin.json**

Create `openclaw.plugin.json`:
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

- [ ] **Step 5: Create src/types.ts**

Create `src/types.ts`:
```typescript
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
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npm install
```

- [ ] **Step 7: Verify TypeScript compiles (empty project)**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx tsc --noEmit
```
Expected: No errors (types.ts compiles cleanly).

- [ ] **Step 8: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add package.json package-lock.json tsconfig.json openclaw.plugin.json src/types.ts .gitignore
git commit -m "feat: scaffold openclaw-channel-deltachat project"
```

---

### Task 2: Delta Chat Client Wrapper

**Files:**
- Create: `src/deltachat.ts`
- Create: `tests/deltachat.test.ts`

- [ ] **Step 1: Write failing test for DeltaChatClient**

Create `tests/deltachat.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeltaChatClient } from "../src/deltachat.js";

// We can't easily test the real deltachat-rpc-server in unit tests,
// so we test the session key resolution and config logic.

describe("DeltaChatClient", () => {
  describe("parseSessionKey", () => {
    it("parses dm session key", () => {
      const result = DeltaChatClient.parseSessionKey("deltachat:dm:alice@example.com");
      expect(result).toEqual({ type: "dm", email: "alice@example.com" });
    });

    it("parses group session key", () => {
      const result = DeltaChatClient.parseSessionKey("deltachat:group:42");
      expect(result).toEqual({ type: "group", chatId: 42 });
    });

    it("returns null for invalid session key", () => {
      expect(DeltaChatClient.parseSessionKey("invalid")).toBeNull();
      expect(DeltaChatClient.parseSessionKey("deltachat:unknown:foo")).toBeNull();
      expect(DeltaChatClient.parseSessionKey("")).toBeNull();
    });

    it("returns null for group key with non-numeric id", () => {
      expect(DeltaChatClient.parseSessionKey("deltachat:group:abc")).toBeNull();
    });
  });

  describe("buildSessionKey", () => {
    it("builds dm session key", () => {
      expect(DeltaChatClient.buildSessionKey("dm", "alice@example.com")).toBe(
        "deltachat:dm:alice@example.com",
      );
    });

    it("builds group session key", () => {
      expect(DeltaChatClient.buildSessionKey("group", 42)).toBe(
        "deltachat:group:42",
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx vitest run
```
Expected: FAIL (module doesn't exist yet).

- [ ] **Step 3: Implement DeltaChatClient**

Create `src/deltachat.ts`:
```typescript
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { StdioDeltaChat, C, type T } from "@deltachat/jsonrpc-client";
import type { DeltaChatConfig } from "./types.js";

type SessionKey =
  | { type: "dm"; email: string }
  | { type: "group"; chatId: number };

export class DeltaChatClient {
  private dc: StdioDeltaChat | null = null;
  private server: ChildProcess | null = null;
  private accountId = 0;
  private running = false;
  private config: DeltaChatConfig;
  private crashTimes: number[] = [];
  private inFlightCount = 0;
  private inFlightResolve: (() => void) | null = null;

  constructor(config: DeltaChatConfig) {
    this.config = config;
  }

  // --- Static helpers for session key management ---

  static parseSessionKey(key: string): SessionKey | null {
    if (!key.startsWith("deltachat:")) return null;
    const parts = key.split(":");
    if (parts.length < 3) return null;

    if (parts[1] === "dm") {
      const email = parts.slice(2).join(":"); // email may contain colons (unlikely but safe)
      return { type: "dm", email };
    }
    if (parts[1] === "group") {
      const chatId = parseInt(parts[2], 10);
      if (isNaN(chatId)) return null;
      return { type: "group", chatId };
    }
    return null;
  }

  static buildSessionKey(type: "dm", email: string): string;
  static buildSessionKey(type: "group", chatId: number): string;
  static buildSessionKey(type: string, id: string | number): string {
    return `deltachat:${type}:${id}`;
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    const dataDir = this.resolveDataDir();
    await mkdir(dataDir, { recursive: true });

    this.server = spawn(this.config.rpcServerPath, [], {
      env: {
        ...process.env,
        DC_ACCOUNTS_PATH: dataDir,
      },
      stdio: ["pipe", "pipe", "inherit"],
    });

    this.server.on("exit", (code) => this.handleServerExit(code));

    this.dc = new StdioDeltaChat(this.server.stdin!, this.server.stdout!, true);

    await this.configureAccount();
    await this.dc.rpc.startIo(this.accountId);
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;

    // Wait for in-flight dispatches to complete (up to 10 seconds)
    if (this.inFlightCount > 0) {
      await Promise.race([
        new Promise<void>((resolve) => { this.inFlightResolve = resolve; }),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }

    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.server) {
      this.server.kill();
      this.server = null;
    }
  }

  // --- Message loop ---

  async runMessageLoop(
    handler: (msg: T.Message, chat: T.FullChat) => Promise<void>,
  ): Promise<void> {
    if (!this.dc) throw new Error("Client not started");

    while (this.running) {
      try {
        const msgIds = await this.dc.rpc.getNextMsgs(this.accountId);

        for (const msgId of msgIds) {
          const msg = await this.dc.rpc.getMessage(this.accountId, msgId);

          // Skip system/info messages and self-sent messages
          if (msg.isInfo || msg.fromId === C.DC_CONTACT_ID_SELF) {
            await this.dc.rpc.markseenMsgs(this.accountId, [msgId]);
            continue;
          }

          const chat = await this.dc.rpc.getFullChatById(this.accountId, msg.chatId);

          this.inFlightCount++;
          try {
            await handler(msg, chat);
          } catch (err) {
            console.error("[deltachat] Error handling message:", err);
          } finally {
            this.inFlightCount--;
            if (this.inFlightCount === 0 && this.inFlightResolve) {
              this.inFlightResolve();
              this.inFlightResolve = null;
            }
          }

          await this.dc.rpc.markseenMsgs(this.accountId, [msgId]);
        }
      } catch (err) {
        if (!this.running) break; // Expected error during shutdown
        console.error("[deltachat] Message loop error:", err);
        await new Promise((r) => setTimeout(r, 1000)); // Brief pause before retry
      }
    }
  }

  // --- Sending ---

  async sendText(chatId: number, text: string): Promise<number> {
    if (!this.dc) throw new Error("Client not started");
    return this.dc.rpc.miscSendTextMessage(this.accountId, chatId, text);
  }

  async sendFile(
    chatId: number,
    text: string | null,
    filePath: string,
    filename?: string,
  ): Promise<number> {
    if (!this.dc) throw new Error("Client not started");
    return this.dc.rpc.sendMsg(this.accountId, chatId, {
      text: text ?? null,
      html: null,
      viewtype: null,
      file: filePath,
      filename: filename ?? null,
      location: null,
      overrideSenderName: null,
      quotedMessageId: null,
      quotedText: null,
    });
  }

  // --- Events ---

  onEvent(event: string, handler: (...args: any[]) => void): void {
    if (!this.dc) throw new Error("Client not started");
    this.dc.on(event as any, handler);
  }

  // --- Queries ---

  async getChatBySessionKey(sessionKey: string): Promise<number> {
    if (!this.dc) throw new Error("Client not started");

    const parsed = DeltaChatClient.parseSessionKey(sessionKey);
    if (!parsed) throw new Error(`Invalid session key: ${sessionKey}`);

    if (parsed.type === "group") {
      return parsed.chatId;
    }

    // DM: look up or create chat by email
    const contactId = await this.dc.rpc.lookupContactIdByAddr(
      this.accountId,
      parsed.email,
    );
    if (contactId === null) {
      // Create contact first
      const newContactId = await this.dc.rpc.createContact(
        this.accountId,
        parsed.email,
        null,
      );
      return this.dc.rpc.createChatByContactId(this.accountId, newContactId);
    }
    return this.dc.rpc.createChatByContactId(this.accountId, contactId);
  }

  async getContactEmail(contactId: number): Promise<string> {
    if (!this.dc) throw new Error("Client not started");
    const contact = await this.dc.rpc.getContact(this.accountId, contactId);
    return contact.address;
  }

  async getChatMembers(
    chatId: number,
  ): Promise<Array<{ email: string; name: string }>> {
    if (!this.dc) throw new Error("Client not started");
    const contactIds = await this.dc.rpc.getChatContacts(this.accountId, chatId);
    const members: Array<{ email: string; name: string }> = [];
    for (const id of contactIds) {
      if (id === C.DC_CONTACT_ID_SELF) continue;
      const contact = await this.dc.rpc.getContact(this.accountId, id);
      members.push({ email: contact.address, name: contact.displayName });
    }
    return members;
  }

  async getChatInfo(chatId: number): Promise<T.FullChat> {
    if (!this.dc) throw new Error("Client not started");
    return this.dc.rpc.getFullChatById(this.accountId, chatId);
  }

  // --- Private ---

  private resolveDataDir(): string {
    let dir = this.config.dataDir;
    if (dir.startsWith("~")) {
      dir = dir.replace("~", homedir());
    }
    return resolve(dir);
  }

  private async configureAccount(): Promise<void> {
    if (!this.dc) throw new Error("Client not started");

    const accounts = await this.dc.rpc.getAllAccountIds();

    if (accounts.length > 0) {
      this.accountId = accounts[0];

      // Check if email changed
      const currentAddr = await this.dc.rpc.getConfig(this.accountId, "addr");
      if (currentAddr && currentAddr !== this.config.email) {
        // Email changed — remove old account and create new one
        await this.dc.rpc.removeAccount(this.accountId);
        await this.createAndConfigureAccount();
        return;
      }

      // Reconfigure with potentially updated password
      await this.dc.rpc.addOrUpdateTransport(this.accountId, {
        addr: this.config.email,
        password: this.config.password,
        imapServer: null,
        imapPort: null,
        imapSecurity: null,
        imapUser: null,
        smtpServer: null,
        smtpPort: null,
        smtpSecurity: null,
        smtpUser: null,
        smtpPassword: null,
        certificateChecks: null,
        oauth2: null,
      });
      return;
    }

    await this.createAndConfigureAccount();
  }

  private async createAndConfigureAccount(): Promise<void> {
    if (!this.dc) throw new Error("Client not started");

    this.accountId = await this.dc.rpc.addAccount();
    await this.dc.rpc.addOrUpdateTransport(this.accountId, {
      addr: this.config.email,
      password: this.config.password,
      imapServer: null,
      imapPort: null,
      imapSecurity: null,
      imapUser: null,
      smtpServer: null,
      smtpPort: null,
      smtpSecurity: null,
      smtpUser: null,
      smtpPassword: null,
      certificateChecks: null,
      oauth2: null,
    });
    await this.dc.rpc.setConfig(this.accountId, "bot", "1");
    await this.dc.rpc.setConfig(
      this.accountId,
      "displayname",
      this.config.displayName,
    );
  }

  private handleServerExit(code: number | null): void {
    if (!this.running) return; // Expected shutdown

    console.error(`[deltachat] rpc-server exited with code ${code}`);

    const now = Date.now();
    this.crashTimes.push(now);
    // Only count crashes within the last 60 seconds
    this.crashTimes = this.crashTimes.filter((t) => now - t < 60_000);

    if (this.crashTimes.length >= 3) {
      console.error("[deltachat] Too many crashes, disabling plugin");
      this.running = false;
      return;
    }

    console.error("[deltachat] Attempting respawn in 5 seconds...");
    setTimeout(() => {
      if (this.running) {
        this.start().catch((err) => {
          console.error("[deltachat] Respawn failed:", err);
        });
      }
    }, 5000);
  }
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx vitest run
```
Expected: PASS

- [ ] **Step 5: Verify build**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx tsc
```
Expected: Compiles with no errors.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add src/deltachat.ts tests/deltachat.test.ts
git commit -m "feat: add Delta Chat client wrapper with session key management"
```

---

### Task 3: Channel Plugin (Adapters + Registration)

**Files:**
- Create: `src/channel.ts`
- Create: `tests/channel.test.ts`

- [ ] **Step 1: Write failing test for channel adapters**

Create `tests/channel.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { buildInboundContext, shouldSkipChat } from "../src/channel.js";

describe("channel", () => {
  describe("shouldSkipChat", () => {
    it("allows Single chats", () => {
      expect(shouldSkipChat("Single")).toBe(false);
    });

    it("allows Group chats", () => {
      expect(shouldSkipChat("Group")).toBe(false);
    });

    it("skips Mailinglist chats", () => {
      expect(shouldSkipChat("Mailinglist")).toBe(true);
    });

    it("skips Broadcast chats", () => {
      expect(shouldSkipChat("OutBroadcast")).toBe(true);
      expect(shouldSkipChat("InBroadcast")).toBe(true);
    });
  });

  describe("buildInboundContext", () => {
    it("builds context for a DM text message", () => {
      const ctx = buildInboundContext({
        text: "Hello bot",
        senderEmail: "alice@example.com",
        chatType: "Single",
        chatId: 10,
        file: null,
        fileMime: null,
      });

      expect(ctx.text).toBe("Hello bot");
      expect(ctx.sessionKey).toBe("deltachat:dm:alice@example.com");
      expect(ctx.chatType).toBe("direct");
      expect(ctx.media).toBeNull();
    });

    it("builds context for a group text message", () => {
      const ctx = buildInboundContext({
        text: "Hello group",
        senderEmail: "alice@example.com",
        chatType: "Group",
        chatId: 42,
        file: null,
        fileMime: null,
      });

      expect(ctx.sessionKey).toBe("deltachat:group:42");
      expect(ctx.chatType).toBe("group");
    });

    it("includes media when file is present", () => {
      const ctx = buildInboundContext({
        text: "Check this image",
        senderEmail: "alice@example.com",
        chatType: "Single",
        chatId: 10,
        file: "/path/to/image.jpg",
        fileMime: "image/jpeg",
      });

      expect(ctx.media).toEqual({
        path: "/path/to/image.jpg",
        mimeType: "image/jpeg",
      });
    });

    it("sets media to null when no file", () => {
      const ctx = buildInboundContext({
        text: "Just text",
        senderEmail: "alice@example.com",
        chatType: "Single",
        chatId: 10,
        file: null,
        fileMime: null,
      });

      expect(ctx.media).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx vitest run
```
Expected: FAIL (module doesn't exist yet).

- [ ] **Step 3: Implement channel.ts**

Create `src/channel.ts`:
```typescript
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
        client.onEvent("MsgFailed", (_accountId: number, event: any) => {
          console.error("[deltachat] Message send failed:", event);
        });

        // Start message loop (runs in background until stop)
        const loopPromise = client.runMessageLoop(async (msg: T.Message, chat: T.FullChat) => {
          if (shouldSkipChat(chat.chatType)) return;

          const senderEmail = await client.getContactEmail(msg.fromId);

          const context = buildInboundContext({
            text: msg.text ?? "",
            senderEmail,
            chatType: chat.chatType,
            chatId: msg.chatId,
            file: msg.file ?? null,
            fileMime: msg.fileMime ?? null,
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
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx vitest run
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add src/channel.ts tests/channel.test.ts
git commit -m "feat: add channel plugin with adapters and inbound message handling"
```

---

### Task 4: Plugin Entry Point (Registration)

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create the plugin entry point**

Create `src/index.ts`:
```typescript
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
```

- [ ] **Step 2: Verify full build**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx tsc
```
Expected: Compiles with no errors. `dist/` directory created with JS output.

- [ ] **Step 3: Run all tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npx vitest run
```
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add src/index.ts
git commit -m "feat: add plugin entry point with config resolution and registration"
```

---

### Task 5: README and Final Polish

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md`:
```markdown
# openclaw-channel-deltachat

An [OpenClaw](https://openclaw.ai) channel plugin that bridges [Delta Chat](https://delta.chat) messaging to OpenClaw's AI agent pipeline.

Users interact with OpenClaw agents by messaging a bot email address via any Delta Chat client, with automatic end-to-end encryption.

## Prerequisites

- [OpenClaw](https://openclaw.ai) gateway running
- [`deltachat-rpc-server`](https://github.com/chatmail/core/releases) on your `$PATH`
- An email account for the bot

## Install

```bash
openclaw plugins install openclaw-channel-deltachat
```

Or from source:

```bash
git clone https://github.com/jhayashi/dcbot.git
cd dcbot
npm install && npm run build
openclaw plugins install -l .
```

## Configure

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

Then restart the gateway:

```bash
openclaw gateway restart
```

## Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `email` | yes | — | Bot email address |
| `password` | yes | — | Bot email password |
| `displayName` | no | `"OpenClaw Bot"` | Bot display name |
| `dataDir` | no | `~/.openclaw/deltachat-data` | Delta Chat data directory |
| `rpcServerPath` | no | `"deltachat-rpc-server"` | Path to rpc-server binary |
| `enabled` | no | `true` | Enable/disable the channel |

## How It Works

The plugin spawns `deltachat-rpc-server` as a child process and communicates via JSON-RPC. When a Delta Chat message arrives, it's dispatched to OpenClaw's agent pipeline. Agent responses are sent back as Delta Chat messages.

Supports both 1:1 DMs and group chats. All AI logic, conversation history, and access control are managed by OpenClaw.

## License

MIT
```

- [ ] **Step 2: Run final build and tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
npm run build && npm test
```
Expected: Build succeeds, all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

- [ ] **Step 4: Clean up old Go specs and plans**

Remove the outdated Go-based design files:
```bash
cd /var/home/jhayashi/src/dcbot
git rm docs/superpowers/specs/2026-03-24-dcbot-design.md
git rm docs/superpowers/plans/2026-03-24-dcbot-implementation.md
git commit -m "chore: remove outdated Go-based design docs"
```

- [ ] **Step 5: Push to remote**

```bash
cd /var/home/jhayashi/src/dcbot
git push -u origin main
```
