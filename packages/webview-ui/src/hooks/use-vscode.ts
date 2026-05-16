import { useCallback, useEffect, useRef, useState } from "react";
import { VSCodeAPI, RpcRequest, RpcResponse } from "../types";

let vscodeInstance: VSCodeAPI | null = null;

function getVSCode(): VSCodeAPI {
  if (!vscodeInstance) {
    vscodeInstance = window.acquireVsCodeApi();
  }
  return vscodeInstance;
}

export function useVSCode(): VSCodeAPI {
  return getVSCode();
}

export function useRpc(method: string, params?: unknown): {
  data: unknown;
  error: Error | null;
  loading: boolean;
  execute: () => void;
} {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef<string>(crypto.randomUUID());

  const execute = useCallback(() => {
    setLoading(true);
    setError(null);
    const id = requestIdRef.current;
    const vscode = getVSCode();

    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; payload: RpcResponse };
      if (msg.type === "rpc" && msg.payload.id === id) {
        window.removeEventListener("message", handler);
        setLoading(false);
        if (msg.payload.error) {
          setError(new Error(msg.payload.error.message));
        } else {
          setData(msg.payload.result);
        }
      }
    };

    window.addEventListener("message", handler);
    vscode.postMessage({
      type: "rpc",
      payload: { id, method, params } as RpcRequest,
    });
  }, [method, params]);

  return { data, error, loading, execute };
}

export function useEvent<T>(eventType: string): T | null {
  const [payload, setPayload] = useState<T | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "event" && msg.payload?.type === eventType) {
        setPayload(msg.payload.payload as T);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [eventType]);

  return payload;
}
