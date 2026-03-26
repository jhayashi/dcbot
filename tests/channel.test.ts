import { describe, it, expect } from "vitest";
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
      expect(ctx.chatId).toBe(10);
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
      expect(ctx.chatId).toBe(42);
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
