import { create } from "zustand";
import { ChatMessage } from "../types";

interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  isLoading: boolean;
  model: string;
  thinking: boolean;

  addMessage: (message: ChatMessage) => void;
  appendContent: (text: string) => void;
  setSession: (sessionId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setModel: (model: string) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessionId: null,
  isLoading: false,
  model: "default",
  thinking: false,

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  appendContent: (text) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant") {
        const current =
          typeof last.content === "string" ? last.content : last.content.map((c) => c.text).join("");
        const updated = current + text;
        messages[messages.length - 1] = {
          ...last,
          content: updated,
        };
      } else {
        messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: text,
          timestamp: Date.now(),
        });
      }
      return { messages };
    }),

  setSession: (sessionId) => set({ sessionId }),
  setLoading: (isLoading) => set({ isLoading }),
  setModel: (model) => set({ model }),

  clear: () =>
    set({
      messages: [],
      sessionId: null,
      isLoading: false,
    }),
}));
