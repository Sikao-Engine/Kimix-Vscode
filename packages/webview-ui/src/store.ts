import { create } from "zustand";
import type {
  FileListItem,
  FileRef,
  HostToWebview,
  MessageWithParts,
  PlanMode,
  SymbolListItem,
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

/** A prompt queued while the model is still busy. */
export interface PendingPrompt {
  id: string;
  text: string;
  locked: boolean;
  createdAt: number;
  attachments: FileRef[];
}

interface StoreState {
  ui: UIState;
  messages: MessageWithParts[];
  stream: StreamBubble[];
  tools: ToolCall[];
  permission: PendingPermission | undefined;
  busy: boolean;
  errorBanner: string | undefined;

  /** Id of the turn that is currently allowed to update busy/stream state. */
  activeTurnId: string | undefined;
  activePromptText: string | undefined;

  /** Prompts waiting to be sent once the current turn finishes. */
  pending: PendingPrompt[];

  /** Per-message reasoning collapsed state (keyed by message id). */
  reasoningCollapsed: Record<string, boolean>;
  /** Global toggle that overrides individual message states when true. */
  globalReasoningCollapsed: boolean;

  /** Current composer attachments. */
  attachments: FileRef[];
  fileList: FileListItem[];
  symbolList: SymbolListItem[];

  /** Composer draft text (shared so pending-queue edit can refill it). */
  composerText: string;
  setComposerText: (text: string) => void;

  applyHostMessage: (msg: HostToWebview) => void;
  resetStreamState: () => void;

  // Pending queue actions
  enqueuePrompt: (text: string) => void;
  removePending: (id: string) => void;
  editPending: (id: string) => { text: string; attachments: FileRef[] } | undefined;
  promoteNextLocked: () => void;
  reorderPending: (fromId: string, toId: string) => void;

  // Reasoning actions
  toggleReasoning: (id: string) => void;
  collapseAllReasoning: () => void;
  expandAllReasoning: () => void;

  // Streaming lifecycle
  stopGeneration: () => void;

  // Mention / attachment actions
  requestFiles: (query?: string) => void;
  requestSymbols: (query: string) => void;
  insertFileRef: (ref: FileRef) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
}

const initialUI: UIState = {
  status: "stopped",
  sessions: [],
  agents: [],
  providers: [],
  planMode: "build",
  planState: {
    phase: "idle",
    attempt: 0,
    maxAttempts: 3,
  },
  showThinking: true,
  autoScroll: true,
  enableMentions: true,
  features: {},
};

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useStore = create<StoreState>((set, get) => ({
  ui: initialUI,
  messages: [],
  stream: [],
  tools: [],
  permission: undefined,
  busy: false,
  errorBanner: undefined,
  activeTurnId: undefined,
  activePromptText: undefined,
  pending: [],
  reasoningCollapsed: {},
  globalReasoningCollapsed: false,
  attachments: [],
  fileList: [],
  symbolList: [],
  composerText: "",
  setComposerText: (text) => set({ composerText: text }),

  resetStreamState: () =>
    set({
      stream: [],
      tools: [],
      busy: false,
      activeTurnId: undefined,
      activePromptText: undefined,
    }),

  applyHostMessage: (msg) => {
    switch (msg.type) {
      case "state":
        set({ ui: msg.state });
        break;
      case "planState": {
        const prev = get().ui.planState.phase;
        const next = msg.state.phase;
        const updates: Partial<StoreState> = {
          ui: { ...get().ui, planState: msg.state },
        };
        if (next === "reviewing") {
          updates.busy = false;
        } else if (next === "idle") {
          updates.busy = false;
          if (
            prev === "reviewing" ||
            prev === "generating" ||
            prev === "revising"
          ) {
            updates.stream = [];
            updates.tools = [];
            updates.activeTurnId = undefined;
            updates.activePromptText = undefined;
          }
        } else if (next === "implementing") {
          updates.stream = [];
          updates.tools = [];
        }
        set(updates);
        break;
      }
      case "messages":
        set({
          messages: msg.messages,
          stream: [],
          tools: [],
          busy: false,
          activePromptText: undefined,
        });
        break;
      case "streamText": {
        const { activeTurnId } = get();
        if (msg.turnId && activeTurnId && msg.turnId !== activeTurnId) {
          return;
        }
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
        const { activeTurnId } = get();
        if (msg.turnId && activeTurnId && msg.turnId !== activeTurnId) {
          return;
        }
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
      case "streamIdle": {
        const { activeTurnId, pending } = get();
        if (msg.turnId && activeTurnId && msg.turnId !== activeTurnId) {
          postToHost({ type: "refresh" });
          return;
        }

        const completedMessages = archiveCompletedTurn(get());
        const locked = pending.find((p) => p.locked);
        if (locked) {
          const nextPending = pending.filter((p) => p.id !== locked.id);
          const nextId = generateId();
          set({
            messages: completedMessages,
            pending: nextPending,
            busy: true,
            activeTurnId: nextId,
            activePromptText: locked.text,
            stream: [],
            tools: [],
          });
          postToHost({
            type: "sendPrompt",
            text: formatRefs(locked.text, locked.attachments),
            turnId: nextId,
          });
          return;
        }

        set({
          messages: completedMessages,
          busy: false,
          activeTurnId: undefined,
          activePromptText: undefined,
          stream: [],
          tools: [],
        });
        break;
      }
      case "aborted": {
        const { activeTurnId } = get();
        if (msg.turnId && activeTurnId && msg.turnId !== activeTurnId) {
          return;
        }
        set({
          busy: false,
          activeTurnId: undefined,
          activePromptText: undefined,
          stream: [],
          tools: [],
        });
        break;
      }
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
      case "fileList":
        set({ fileList: msg.files });
        break;
      case "workspaceSymbols":
        set({ symbolList: msg.symbols });
        break;
    }
  },

  // ── Pending queue ───────────────────────────────────────────────

  enqueuePrompt: (text) => {
    const pending = [...get().pending];
    const wasEmpty = pending.length === 0;
    if (wasEmpty) {
      pending.push({
        id: generateId(),
        text,
        locked: true,
        createdAt: Date.now(),
        attachments: [...get().attachments],
      });
    } else {
      // Only one locked item at a time; new items are unlocked.
      pending.push({
        id: generateId(),
        text,
        locked: false,
        createdAt: Date.now(),
        attachments: [...get().attachments],
      });
    }
    set({ pending, attachments: [] });
  },

  removePending: (id) => {
    let pending = get().pending.filter((p) => p.id !== id);
    if (pending.length > 0 && !pending.some((p) => p.locked)) {
      pending = promoteFirst(pending);
    }
    set({ pending });
  },

  editPending: (id) => {
    const pending = get().pending;
    const item = pending.find((p) => p.id === id);
    if (!item || item.locked) {
      return undefined;
    }
    set({
      pending: pending.filter((p) => p.id !== id),
      attachments: item.attachments,
      composerText: item.text,
    });
    return { text: item.text, attachments: item.attachments };
  },

  reorderPending: (fromId, toId) => {
    const pending = [...get().pending];
    const fromIndex = pending.findIndex((p) => p.id === fromId);
    const toIndex = pending.findIndex((p) => p.id === toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return;
    }
    const [moved] = pending.splice(fromIndex, 1);
    pending.splice(toIndex, 0, moved);
    // Ensure exactly one item is locked and it is the first one.
    set({ pending: promoteFirst(pending) });
  },

  promoteNextLocked: () => {
    const pending = get().pending;
    if (pending.some((p) => p.locked)) {
      return;
    }
    set({ pending: promoteFirst([...pending]) });
  },

  // ── Reasoning ───────────────────────────────────────────────────

  toggleReasoning: (id) => {
    set((state) => ({
      reasoningCollapsed: {
        ...state.reasoningCollapsed,
        [id]: !state.reasoningCollapsed[id],
      },
    }));
  },

  collapseAllReasoning: () => {
    set({ globalReasoningCollapsed: true });
  },

  expandAllReasoning: () => {
    set({ globalReasoningCollapsed: false });
  },

  // ── Streaming lifecycle ─────────────────────────────────────────

  stopGeneration: () => {
    const turnId = get().activeTurnId;
    set({
      busy: false,
      activeTurnId: undefined,
      activePromptText: undefined,
      stream: [],
      tools: [],
    });
    postToHost({ type: "abort", turnId });
  },

  // ── Mentions / attachments ──────────────────────────────────────

  requestFiles: (query) => {
    postToHost({ type: "requestFileList", query });
  },

  requestSymbols: (query) => {
    postToHost({ type: "requestWorkspaceSymbols", query });
  },

  insertFileRef: (ref) => {
    set((state) => ({
      attachments: state.attachments.some((a) => a.id === ref.id)
        ? state.attachments
        : [...state.attachments, ref],
    }));
  },

  removeAttachment: (id) => {
    set((state) => ({
      attachments: state.attachments.filter((a) => a.id !== id),
    }));
  },

  clearAttachments: () => set({ attachments: [] }),
}));

function archiveCompletedTurn(state: StoreState): MessageWithParts[] {
  const out = [...state.messages];
  if (state.activePromptText) {
    out.push({
      info: {
        id: `local-user-${state.activeTurnId ?? generateId()}`,
        role: "user",
        createdAt: new Date().toISOString(),
      },
      parts: [{ type: "text", text: state.activePromptText }],
    });
  }
  if (state.stream.length > 0 || state.tools.length > 0) {
    out.push({
      info: {
        id: `local-assistant-${state.activeTurnId ?? generateId()}`,
        role: "assistant",
        createdAt: new Date().toISOString(),
      },
      parts: [
        ...state.stream.map((b) => ({ type: b.kind, text: b.text })),
        ...state.tools.map((t) => ({
          type: "tool",
          tool: t.toolName,
          state: { status: t.status, title: t.title },
        })),
      ],
    });
  }
  return out;
}

function promoteFirst(pending: PendingPrompt[]): PendingPrompt[] {
  if (pending.length === 0) {
    return pending;
  }
  return pending.map((p, idx) => ({ ...p, locked: idx === 0 }));
}

function formatRefs(text: string, attachments: FileRef[]): string {
  if (attachments.length === 0) {
    return text;
  }
  const refs = attachments.map((a) => `@${a.path}`).join(" ");
  return `${refs}\n\n${text}`;
}

// ── Action helpers (thin wrappers around postToHost) ────────────────

export const actions = {
  sendPrompt: (text: string, turnId?: string) => {
    useStore.setState({
      busy: true,
      activeTurnId: turnId,
      activePromptText: text,
      stream: [],
      tools: [],
    });
    postToHost({ type: "sendPrompt", text, turnId });
  },
  generatePlan: (text: string, turnId?: string) => {
    useStore.setState({
      busy: true,
      activeTurnId: turnId,
      stream: [],
      tools: [],
    });
    postToHost({ type: "generatePlan", text, turnId });
  },
  revisePlan: (feedback: string, turnId?: string) => {
    useStore.setState({
      busy: true,
      activeTurnId: turnId,
      stream: [],
      tools: [],
    });
    postToHost({ type: "revisePlan", feedback, turnId });
  },
  implementPlan: () => {
    useStore.setState({ stream: [], tools: [] });
    postToHost({ type: "implementPlan" });
  },
  discardPlan: () => postToHost({ type: "discardPlan" }),
  openPlanFile: () => postToHost({ type: "openPlanFile" }),
  abort: (turnId?: string) => postToHost({ type: "abort", turnId }),
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
