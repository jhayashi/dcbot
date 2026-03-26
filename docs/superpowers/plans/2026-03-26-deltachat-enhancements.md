# Delta Chat Channel Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Delta Chat channel plugin with access control, setup UX, graceful shutdown, and documentation improvements.

**Architecture:** Seven enhancement areas, each producing a working commit. Tasks are ordered by dependency (access control before setup wizard, since the wizard should reference the allow-from flow), but most can be worked in parallel. Note: Task 3 (graceful shutdown) and Task 7 (reconnect resilience) both modify `src/deltachat.ts` in nearby areas — work them sequentially to avoid merge conflicts.

**Tech Stack:** TypeScript, @deltachat/jsonrpc-client, OpenClaw Plugin SDK (ChannelPlugin, ChannelSecurityAdapter, ChannelSetupAdapter, ChannelPairingAdapter)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/channel.ts` | Channel plugin factory, gateway adapters, message dispatch |
| `src/deltachat.ts` | DeltaChatClient wrapper (rpc-server lifecycle, message handling, sending) |
| `src/index.ts` | Plugin registration, HTTP invite route |
| `src/types.ts` | Config types |
| `tests/channel.test.ts` | Channel adapter unit tests |
| `tests/deltachat.test.ts` | Session key and client unit tests |
| `README.md` | User-facing documentation |

---

### Task 1: Access Control — Only respond to authorized users

The bot currently responds to anyone who connects. We need to integrate with OpenClaw's `dmPolicy`/`allowFrom` system so only authorized users get AI responses. Unauthorized users should get a short rejection message.

**Context:** OpenClaw's security model uses `ChannelSecurityAdapter.resolveDmPolicy()` to determine who can DM the bot. The `MsgContext` already includes `From`/`SenderId` which OpenClaw core uses for policy checks. However, the `dispatchReplyWithBufferedBlockDispatcher` may already enforce this — we need to verify. If it does, this task is just adding `OwnerAllowFrom` to the MsgContext. If not, we need to implement the `security` adapter.

**Design decision:** When no `allowFrom` is configured, default to allow-all (current behavior). This keeps zero-config working. Users can restrict access by adding `allowFrom` to their config.

**Files:**
- Modify: `src/channel.ts:326-336` (MsgContext construction)
- Modify: `src/channel.ts:387-394` (add `security` adapter near existing `groups`/`threading` adapters)
- Test: `tests/channel.test.ts`

**Research first:**
- [ ] **Step 1: Check if OpenClaw core enforces allowFrom during dispatch**

Check the OpenClaw SDK types for `ChannelSecurityAdapter`:
```bash
ssh lobster@localhost 'grep -A20 "ChannelSecurityAdapter" /var/home/lobster/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/channels/plugins/types.adapters.d.ts'
```

Also test: send a message from an unauthorized Delta Chat contact and check the logs. Does `dispatchReplyWithBufferedBlockDispatcher` reject it, or does it generate a reply?

- [ ] **Step 2: Add dmPolicy config support**

If needed, add a `security` adapter to the channel plugin that reads `dmPolicy` and `allowFrom` from the deltachat channel config (e.g. `channels.deltachat.dmPolicy: "allowlist"`, `channels.deltachat.allowFrom: ["user@example.com"]`).

- [ ] **Step 3: Pass OwnerAllowFrom in MsgContext**

In `channel.ts` where we build `msgContext` (inside the `startAccount` closure where `ctx` is in scope), add:
```typescript
// If allowFrom is configured, pass it so OpenClaw can enforce access control
const channels = ctx.cfg.channels as Record<string, unknown> | undefined;
const dc = (channels?.deltachat ?? {}) as Record<string, unknown>;
const allowFrom = dc.allowFrom as string[] | undefined;
if (allowFrom) {
  msgContext.OwnerAllowFrom = allowFrom;
}
```

- [ ] **Step 4: Send rejection message to unauthorized users**

If the dispatch rejects the message (or if we check allowFrom ourselves), send a short message back:
```typescript
await currentClient.sendText(inbound.chatId, "Sorry, I'm not configured to chat with you. Ask the owner to add your email to the allowlist.");
```

- [ ] **Step 5: Write tests for access control logic**
- [ ] **Step 6: Test end-to-end with an unauthorized sender**
- [ ] **Step 7: Commit**

---

### Task 2: Regular Email Account Support (polish)

The `email`/`password` config path exists but hasn't been tested end-to-end since the chatmail refactor. When using a regular email account:
- The `configure()` flow should be called (not just `addOrUpdateTransport`)
- SecureJoin QR should still be generated (useful but not required)
- The invite page should show different instructions (no QR scan needed for unencrypted first contact)

**Files:**
- Modify: `src/deltachat.ts:304-346` (createAccount method)
- Modify: `src/index.ts:38-101` (invite page HTML — conditional instructions)
- Modify: `src/channel.ts:163-167` (inviteState — add account type)
- Test: `tests/deltachat.test.ts`

- [ ] **Step 1: Add `configure()` call for regular email accounts**

In `createAccount()` at `src/deltachat.ts:309`, the existing `if (this.config.email && this.config.password)` branch calls `addOrUpdateTransport()` but not `configure()`. Add the `configure()` call after `addOrUpdateTransport()` within that same branch, then log the configured address:
```typescript
// Inside the existing if (this.config.email && this.config.password) block, after addOrUpdateTransport:
await this.dc.rpc.configure(this.accountId);
const addr = await this.dc.rpc.getConfig(this.accountId, "addr");
console.log(`[deltachat] Configured account: ${addr}`);
```
Note: when `email` is `"auto"`, `password` is not set, so this branch is skipped and the chatmail else-branch runs. No extra `!== "auto"` check needed.

- [ ] **Step 2: Track account type in inviteState**

Add `accountType: "chatmail" | "email"` to `inviteState` so the invite page can show different instructions.

- [ ] **Step 3: Update invite page for regular email accounts**

When `accountType` is `"email"`, show: "Send an email to bot@example.com to start chatting. Encryption will be established automatically after the first exchange."

- [ ] **Step 4: Test with a regular email account (sonic.net)**
- [ ] **Step 5: Commit**

---

### Task 3: Graceful Shutdown

When the gateway sends SIGTERM, the rpc-server is killed while the message loop may be mid-operation. This causes EPIPE errors. The `stop()` method should cleanly shut down IO before closing the connection.

**Files:**
- Modify: `src/deltachat.ts:85-106` (stop method)
- Modify: `src/deltachat.ts:118-161` (startMessageHandler — error handling)

- [ ] **Step 1: Stop IO before closing connection**

In `stop()`, call `stopIo()` before closing:
```typescript
async stop(): Promise<void> {
    this.running = false;

    // Wait for in-flight dispatches to complete (up to 10 seconds)
    if (this.inFlightCount > 0) {
        await Promise.race([
            new Promise<void>((resolve) => { this.inFlightResolve = resolve; }),
            new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
        ]);
    }

    // Stop IO gracefully before closing connection
    if (this.dc) {
        try {
            await this.dc.rpc.stopIo(this.accountId);
        } catch {
            // Ignore — server may already be gone
        }
        this.dc.close();
        this.dc = null;
    }
    if (this.server) {
        this.server.kill();
        this.server = null;
    }
}
```

- [ ] **Step 2: Suppress errors during shutdown in message handler**

The `IncomingMsg` handler already checks `if (!this.running) return;` in the catch block. Verify this is sufficient for EPIPE errors during shutdown.

- [ ] **Step 3: Test by restarting the gateway and checking for EPIPE errors in logs**
- [ ] **Step 4: Commit**

---

### Task 4: Group Chat Enhancements

Groups work but lack context. Pass group subject as `ConversationLabel` in MsgContext, and consider making `resolveRequireMention` configurable.

**Files:**
- Modify: `src/channel.ts:324-342` (MsgContext construction — add GroupSubject)
- Modify: `src/channel.ts:387-389` (resolveRequireMention — make configurable)

- [ ] **Step 1: Pass GroupSubject in MsgContext**

After building the base msgContext, add:
```typescript
if (isGroup) {
    msgContext.GroupSubject = chat.name;
    msgContext.ConversationLabel = chat.name;
}
```

- [ ] **Step 2: Make resolveRequireMention configurable**

Read from config:
```typescript
resolveRequireMention: (params: ChannelGroupContext): boolean | undefined => {
    const channels = params.cfg.channels as Record<string, unknown> | undefined;
    const dc = (channels?.deltachat ?? {}) as Record<string, unknown>;
    return (dc.requireMention as boolean) ?? false;
},
```

- [ ] **Step 3: Write test for group context building with subject**
- [ ] **Step 4: Test in a real group chat — verify ConversationLabel appears in agent context**
- [ ] **Step 5: Commit**

---

### Task 5: Setup Wizard / Dashboard Integration

Investigate OpenClaw's `ChannelSetupWizard` and `ChannelSetupAdapter` to provide guided setup. The goal: when a user runs `openclaw setup deltachat`, it walks them through the flow. Also investigate showing the QR code in the dashboard chat.

**Files:**
- Modify: `src/channel.ts` (add `setup` and `setupWizard` adapters)
- Modify: `src/index.ts` (potentially register CLI command)

**Research first:**
- [ ] **Step 1: Study the Telegram plugin's setup wizard**

```bash
ssh lobster@localhost 'cat /var/home/lobster/.npm-global/lib/node_modules/openclaw/dist/extensions/telegram/setup-entry.js | head -100'
ssh lobster@localhost 'grep -A30 "ChannelSetupWizard" /var/home/lobster/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/channels/plugins/setup-wizard.d.ts'
```

- [ ] **Step 2: Study how other channels show setup info in the dashboard**

Check if there's a way to push the QR code into the dashboard chat or control UI during setup.

- [ ] **Step 3: Implement ChannelSetupAdapter**

At minimum: `applyAccountConfig` to write the `email: "auto"` config entry when the user runs setup.

- [ ] **Step 4: Implement setupWizard if the API supports interactive steps**

Prompt: "Would you like to use chatmail (recommended) or provide your own email credentials?"

- [ ] **Step 5: Test with `openclaw setup deltachat`**
- [ ] **Step 6: Commit**

---

### Task 6: README — Why Delta Chat?

Add a section to the README explaining why someone would choose Delta Chat over Telegram, WhatsApp, Signal, etc.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the "Why Delta Chat?" section**

Key points to cover:
- **End-to-end encryption by default** — Autocrypt + OpenPGP, no trust-the-server model
- **No phone number required** — works with any email address
- **No app store dependency** — APK available directly, F-Droid, etc.
- **Decentralized** — uses existing email infrastructure, no single provider
- **Chatmail for speed** — chatmail servers provide instant delivery like regular chat apps
- **Group support** — topic-based groups for organizing conversations with the AI
- **Works alongside regular email** — bot can also respond to plain email (with regular IMAP account)
- **No vendor lock-in** — messages are standard emails, exportable, auditable
- **Privacy** — no metadata harvesting, no ads, no tracking

- [ ] **Step 2: Review and commit**

---

### Task 7: Reconnect Resilience Testing

The crash recovery logic (`handleServerExit`) exists but hasn't been tested. Verify that:
- If the rpc-server crashes, it respawns and the bot reconnects
- The SecureJoin verified state survives a restart (it should — keys are in the DC database)
- The IMAP IDLE connection recovers after network interruptions

**Files:**
- Modify: `src/deltachat.ts:348-372` (handleServerExit — if fixes needed)

- [ ] **Step 1: Test crash recovery by killing the rpc-server process**

```bash
# Find and kill the rpc-server
ssh lobster@localhost 'kill $(pgrep -f deltachat-rpc-server)'
# Watch logs for respawn
ssh lobster@localhost 'journalctl --user -u openclaw-gateway -f --no-pager'
```

- [ ] **Step 2: After respawn, send a message and verify it works**
- [ ] **Step 3: Verify SecureJoin state survives — the verified contact should still work**
- [ ] **Step 4: Fix any issues found, commit**
