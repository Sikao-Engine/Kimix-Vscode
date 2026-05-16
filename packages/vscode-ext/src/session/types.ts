import { StreamEvent, TurnResult } from "../protocol/types";

export interface ClientInfo {
  name: string;
  version: string;
}

export interface SessionOptions {
  workDir: string;
  model: string;
  thinking: boolean;
  yoloMode: boolean;
  sessionId?: string;
  executable: string;
  env: Record<string, string>;
  clientInfo: ClientInfo;
}

export interface Session {
  sessionId: string;
  model: string;
  thinking: boolean;
  yoloMode: boolean;
  executable: string;
  env: Record<string, string>;
  prompt(content: unknown): Turn;
  close(): void;
}

export interface Turn {
  result: Promise<TurnResult>;
  resolveResult: (value: TurnResult) => void;
  rejectResult: (reason: Error) => void;
  interrupted: boolean;
  interrupt(): void;
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
}

export interface SessionInfo {
  sessionId: string;
  title?: string;
  createdAt: string;
  model: string;
}

export interface ForkOptions {
  workDir: string;
  sourceSessionId: string;
  turnIndex: number;
}

export interface ForkResult {
  sessionId: string;
  sessionDir: string;
}

export interface HistoryEntry {
  role: string;
  content?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface WorkDirInfo {
  path: string;
  name: string;
}
