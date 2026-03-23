export enum MessageRole {
  user = "user",
  assistant = "assistant",
  system = "system",
  tool = "tool",
}

/** A single message in a sub-chat conversation, attributed to a role. */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolCallId?: string;
}

/** A scoped conversation thread optionally linked to a task and/or plan. */
export interface SubChat {
  id: string;
  taskId?: string;
  planId?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}
