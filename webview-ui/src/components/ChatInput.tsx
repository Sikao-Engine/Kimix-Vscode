import React, { useRef, useState } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
  useCtrlEnter?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading, useCtrlEnter }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (useCtrlEnter) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
    setText(target.value);
  };

  return (
    <div className="border-t p-4 flex gap-2 items-end">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        className="flex-1 resize-none rounded-md border bg-background p-2 text-sm min-h-[40px] max-h-[200px] outline-none focus:ring-2 focus:ring-primary"
        placeholder="Ask Kimi..."
        rows={1}
        disabled={isLoading}
      />
      <button
        onClick={handleSend}
        disabled={isLoading || !text.trim()}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        {isLoading ? "..." : "Send"}
      </button>
    </div>
  );
};
