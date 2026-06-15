import { create } from "zustand";
import type {
  HostToWebview,
  MessageWithParts,
  PlanMode,
  UIState,
} from "./protocol";
import { postToHost } from "./vscodeApi";

/** A locally-tracked streaming bubble appended while the assistant responds. */
export interface StreamBubble {
  id: string;
  kind: "text" | "reasoning";
  text: string;
}

export interface ToolCall {
  callID: string;
  toolName: string;
  status: string;
  title: string;
}

export interface PendingPermission {
  permissionId: string;
  title: string;
}

interface StoreState {
  ui: UIState;
  messages: MessageWithParts[];
  stream: StreamBubble[];
  tools: ToolCall[];
  permission: PendingPermission | undefined;
  busy: boolean;
  errorBanner: string | undefined;
  applyHostMessage: (msg: HostToWebview) => void;
  resetStreamState: () => void;
}

const initialUI: UIState = {
  status: "stopped",
  sessions: [],
  agents: [],
  providers: [],
  planMode: "build",
};

export const useStore = create<StoreState>((set, get) => ({
  ui: initialUI,
  messages: [],
  stream: [],
  tools: [],
  permission: undefined,
  busy: false,
  errorBanner: undefined,

  resetStreamState: () => set({ stream: [], tools: [], busy: false }),

  applyHostMessage: (msg) => {
    switch (msg.type) {
      case "state":
        set({ ui: msg.state });
        break;
      case "messages":
        set({ messages: msg.messages, stream: [], tools: [], busy: false });
        break;
      case "streamText": {
        const stream = [...get().stream];
        const last = stream[stream.length - 1];
        if (last && last.kind === msg.kind) {
          last.text = msg.full || last.text + msg.delta;
        } else {
          stream.push({
            id: `${msg.kind}-${stream.length}`,
            kind: msg.kind,
            text: msg.full || msg.delta,
          });
        }
        set({ stream, busy: true });
        break;
      }
      case "streamTool": {
        const tools = [...get().tools];
        const existing = tools.find((t) => t.callID === msg.callID);
        if (existing) {
          existing.status = msg.status;
          existing.title = msg.title;
        } else {
          tools.push({
            callID: msg.callID,
            toolName: msg.toolName,
            status: msg.status,
            title: msg.title,
          });
        }
        set({ tools, busy: true });
        break;
      }
      case "streamIdle":
        set({ busy: false });
        postToHost({ type: "refresh" });
        break;
      case "permission":
        set({
          permission: {
            permissionId: msg.permissionId,
            title: msg.title || "Permission requested",
          },
        });
        break;
      case "error":
        set({ errorBanner: msg.message });
        break;
    }
  },
}));

// ── Action helpers (thin wrappers around postToHost) ────────────────

export const actions = {
  sendPrompt: (text: string) => postToHost({ type: "sendPrompt", text }),
  abort: () => postToHost({ type: "abort" }),
  startServer: () => postToHost({ type: "startServer" }),
  stopServer: () => postToHost({ type: "stopServer" }),
  restartServer: () => postToHost({ type: "restartServer" }),
  newSession: () => postToHost({ type: "newSession" }),
  selectSession: (sessionId: string) =>
    postToHost({ type: "selectSession", sessionId }),
  deleteSession: (sessionId: string) =>
    postToHost({ type: "deleteSession", sessionId }),
  selectAgent: (agent: string) => postToHost({ type: "selectAgent", agent }),
  selectModel: (providerID: string, modelID: string) =>
    postToHost({ type: "selectModel", providerID, modelID }),
  setPlanMode: (mode: PlanMode) => postToHost({ type: "setPlanMode", mode }),
  compactContext: () => postToHost({ type: "compactContext" }),
  respondPermission: (
    permissionId: string,
    reply: "once" | "always" | "reject",
  ) => postToHost({ type: "respondPermission", permissionId, reply }),
};
