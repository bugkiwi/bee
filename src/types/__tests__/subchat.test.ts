import { describe, it, expect } from "bun:test";
import { MessageRole, type ChatMessage, type SubChat } from "../subchat";

describe("MessageRole enum", () => {
  it("has all expected members", () => {
    expect(MessageRole.user as string).toBe("user");
    expect(MessageRole.assistant as string).toBe("assistant");
    expect(MessageRole.system as string).toBe("system");
    expect(MessageRole.tool as string).toBe("tool");
  });

  it("all values are strings", () => {
    for (const value of Object.values(MessageRole)) {
      expect(typeof value).toBe("string");
    }
  });

  it("has exactly 4 members", () => {
    expect(Object.values(MessageRole).length).toBe(4);
  });
});

describe("ChatMessage interface fixture", () => {
  const fixtureChatMessage: ChatMessage = {
    id: "msg-1",
    role: MessageRole.user,
    content: "Hello, world!",
    timestamp: new Date("2026-03-23T00:00:00Z"),
  };

  it("has required fields", () => {
    expect(fixtureChatMessage.id).toBe("msg-1");
    expect(fixtureChatMessage.role).toBe(MessageRole.user);
    expect(fixtureChatMessage.content).toBe("Hello, world!");
    expect(fixtureChatMessage.timestamp).toBeInstanceOf(Date);
  });

  it("role must be a valid MessageRole value", () => {
    expect(Object.values(MessageRole)).toContain(fixtureChatMessage.role);
  });

  it("optional toolCallId is undefined when not set", () => {
    expect(fixtureChatMessage.toolCallId).toBeUndefined();
  });

  it("optional toolCallId accepts a string value", () => {
    const msgWithTool: ChatMessage = {
      ...fixtureChatMessage,
      role: MessageRole.tool,
      toolCallId: "call-abc123",
    };
    expect(msgWithTool.toolCallId).toBe("call-abc123");
  });

  it("supports all MessageRole variants", () => {
    const roles: MessageRole[] = [
      MessageRole.user,
      MessageRole.assistant,
      MessageRole.system,
      MessageRole.tool,
    ];
    for (const role of roles) {
      const msg: ChatMessage = { ...fixtureChatMessage, role };
      expect(msg.role).toBe(role);
    }
  });
});

describe("SubChat interface fixture", () => {
  const baseMessage: ChatMessage = {
    id: "msg-1",
    role: MessageRole.assistant,
    content: "I can help with that.",
    timestamp: new Date("2026-03-23T00:00:00Z"),
  };

  const fixtureSubChat: SubChat = {
    id: "subchat-1",
    messages: [baseMessage],
    createdAt: new Date("2026-03-23T00:00:00Z"),
    updatedAt: new Date("2026-03-23T00:00:00Z"),
  };

  it("has required fields", () => {
    expect(fixtureSubChat.id).toBe("subchat-1");
    expect(Array.isArray(fixtureSubChat.messages)).toBe(true);
    expect(fixtureSubChat.createdAt).toBeInstanceOf(Date);
    expect(fixtureSubChat.updatedAt).toBeInstanceOf(Date);
  });

  it("taskId is undefined when not provided", () => {
    expect(fixtureSubChat.taskId).toBeUndefined();
  });

  it("planId is undefined when not provided", () => {
    expect(fixtureSubChat.planId).toBeUndefined();
  });

  it("accepts taskId linkage without errors", () => {
    const chatWithTask: SubChat = { ...fixtureSubChat, taskId: "task-42" };
    expect(chatWithTask.taskId).toBe("task-42");
    expect(chatWithTask.planId).toBeUndefined();
  });

  it("accepts planId linkage without errors", () => {
    const chatWithPlan: SubChat = { ...fixtureSubChat, planId: "plan-99" };
    expect(chatWithPlan.planId).toBe("plan-99");
    expect(chatWithPlan.taskId).toBeUndefined();
  });

  it("accepts both planId and taskId simultaneously", () => {
    const chatWithBoth: SubChat = {
      ...fixtureSubChat,
      taskId: "task-42",
      planId: "plan-99",
    };
    expect(chatWithBoth.taskId).toBe("task-42");
    expect(chatWithBoth.planId).toBe("plan-99");
  });

  it("messages array can be empty", () => {
    const emptyChat: SubChat = { ...fixtureSubChat, messages: [] };
    expect(emptyChat.messages.length).toBe(0);
  });

  it("messages contain valid ChatMessage objects", () => {
    const msg = fixtureSubChat.messages[0]!;
    expect(msg.id).toBeDefined();
    expect(Object.values(MessageRole)).toContain(msg.role);
    expect(typeof msg.content).toBe("string");
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it("supports multiple messages", () => {
    const multiChat: SubChat = {
      ...fixtureSubChat,
      messages: [
        baseMessage,
        {
          id: "msg-2",
          role: MessageRole.user,
          content: "Follow-up question",
          timestamp: new Date("2026-03-23T00:01:00Z"),
        },
      ],
    };
    expect(multiChat.messages.length).toBe(2);
    expect(multiChat.messages[1]!.role).toBe(MessageRole.user);
  });
});
