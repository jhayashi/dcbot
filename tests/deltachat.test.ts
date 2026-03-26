import { describe, it, expect } from "vitest";
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
