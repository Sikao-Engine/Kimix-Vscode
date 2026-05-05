import React from "react";
import { ChatMessage } from "../types";

interface MessageItemProps {
  message: ChatMessage;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content.map((c) => c.text).join("");

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isSystem
              ? "bg-destructive/10 text-destructive border border-destructive/20"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {message.thinking && (
          <details className="mb-2 text-xs opacity-70">
            <summary className="cursor-pointer">Thinking</summary>
            <div className="mt-1 whitespace-pre-wrap">{message.thinking}</div>
          </details>
        )}
        <div className="whitespace-pre-wrap">{content}</div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <div
                key={tc.id}
                className="text-xs bg-black/5 dark:bg-white/5 rounded px-2 py-1"
              >
                <span className="font-medium">{tc.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
