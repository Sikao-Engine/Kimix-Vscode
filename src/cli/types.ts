export interface CliOptions {
  executable: string;
  env?: Record<string, string>;
  onLine?: (line: string) => void;
}

export interface LoginResult {
  success: boolean;
  error?: string;
}

export interface LogoutResult {
  success: boolean;
  error?: string;
}

export interface CheckCliResult {
  ok: boolean;
  resolved: {
    isCustomPath: boolean;
    path: string;
  };
  error?: {
    type: string;
    message: string;
  };
}

export interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities: string[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolCallResponse {
  tool_call_id: string;
  return_value: {
    is_error: boolean;
    output: string;
    message: string;
    display: unknown[];
  };
}

export interface HookRequest {
  subscription_id: string;
  [key: string]: unknown;
}

export interface HookResponse {
  action: "allow" | "deny";
  reason?: string;
}
