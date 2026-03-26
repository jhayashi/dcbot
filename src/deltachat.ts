import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { StdioDeltaChat, C, type T } from "@deltachat/jsonrpc-client";
import type { DeltaChatConfig } from "./types.js";

export type SessionKey =
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
      if (!email) return null;
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

    // Wait for spawn to succeed or fail before proceeding
    await new Promise<void>((resolve, reject) => {
      this.server!.on("error", (err) => {
        reject(new Error(`Failed to spawn ${this.config.rpcServerPath}: ${err.message}`));
      });
      this.server!.on("spawn", () => {
        resolve();
      });
    });

    this.server.on("exit", (code) => this.handleServerExit(code));

    this.dc = new StdioDeltaChat(this.server.stdin!, this.server.stdout!, true);

    await this.configureAccount();

    // Log all DC events for debugging
    this.dc.on("ALL", (accountId: number, event: { kind: string; msg?: string }) => {
      if (event.kind !== "Info" || !event.msg?.includes("langstrings")) {
        console.log(`[deltachat] event: ${event.kind} ${event.msg ?? ""}`);
      }
    });

    await this.dc.rpc.startIo(this.accountId);
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;

    // Wait for in-flight dispatches to complete (up to 10 seconds)
    if (this.inFlightCount > 0) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.inFlightResolve = resolve;
        }),
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

          const chat = await this.dc.rpc.getFullChatById(
            this.accountId,
            msg.chatId,
          );

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

  onEvent(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.dc) throw new Error("Client not started");
    this.dc.on(event as any, handler as any);
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
    const contactIds = await this.dc.rpc.getChatContacts(
      this.accountId,
      chatId,
    );
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
      await this.dc.rpc.addOrUpdateTransport(this.accountId, this.buildTransportConfig());
      return;
    }

    await this.createAndConfigureAccount();
  }

  private async createAndConfigureAccount(): Promise<void> {
    if (!this.dc) throw new Error("Client not started");

    this.accountId = await this.dc.rpc.addAccount();
    await this.dc.rpc.addOrUpdateTransport(this.accountId, this.buildTransportConfig());
    await this.dc.rpc.setConfig(this.accountId, "bot", "1");
    await this.dc.rpc.setConfig(
      this.accountId,
      "displayname",
      this.config.displayName,
    );
  }

  private buildTransportConfig() {
    return {
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
    };
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
