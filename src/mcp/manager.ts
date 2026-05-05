import * as vscode from "vscode";
import { MCPServer } from "../protocol/types";

const MCP_SERVERS_KEY = "kimi.mcpServers";

export class McpManager {
  constructor(private workspaceState: vscode.Memento) {}

  getServers(): MCPServer[] {
    return this.workspaceState.get<MCPServer[]>(MCP_SERVERS_KEY, []);
  }

  addServer(server: MCPServer): MCPServer[] {
    const servers = this.getServers();
    const existing = servers.findIndex((s) => s.name === server.name);
    if (existing >= 0) {
      servers[existing] = server;
    } else {
      servers.push(server);
    }
    this.workspaceState.update(MCP_SERVERS_KEY, servers);
    return servers;
  }

  updateServer(server: MCPServer): MCPServer[] {
    return this.addServer(server);
  }

  removeServer(name: string): MCPServer[] {
    const servers = this.getServers().filter((s) => s.name !== name);
    this.workspaceState.update(MCP_SERVERS_KEY, servers);
    return servers;
  }

  async auth(name: string): Promise<void> {
    // Would trigger auth flow via CLI
  }

  async resetAuth(name: string): Promise<void> {
    // Would reset auth via CLI
  }

  async test(name: string): Promise<{ success: boolean; output?: string }> {
    // Would test server via CLI
    return { success: true };
  }
}
