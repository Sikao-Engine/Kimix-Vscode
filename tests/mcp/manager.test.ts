import { describe, it, expect, beforeEach } from "vitest";
import { McpManager } from "../../src/mcp/manager";
import { MementoMock } from "../__mocks__/vscode";
import { MCPServer } from "../../src/protocol/types";

describe("McpManager", () => {
  let memento: MementoMock;
  let manager: McpManager;

  beforeEach(() => {
    memento = new MementoMock();
    manager = new McpManager(memento);
  });

  it("getServers returns empty array by default", () => {
    expect(manager.getServers()).toEqual([]);
  });

  it("addServer adds a new server", () => {
    const server: MCPServer = { name: "test-server", command: "npx", args: ["-y", "server"] };
    const result = manager.addServer(server);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(server);
    expect(manager.getServers()).toEqual([server]);
  });

  it("addServer updates existing server by name", () => {
    const s1: MCPServer = { name: "server1", command: "cmd1" };
    const s2: MCPServer = { name: "server1", command: "cmd2" };
    manager.addServer(s1);
    const result = manager.addServer(s2);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe("cmd2");
  });

  it("updateServer delegates to addServer", () => {
    const server: MCPServer = { name: "srv", command: "cmd" };
    manager.addServer(server);
    const updated: MCPServer = { name: "srv", command: "cmd2" };
    expect(manager.updateServer(updated)).toEqual([updated]);
  });

  it("removeServer removes by name", () => {
    const s1: MCPServer = { name: "a", command: "cmd" };
    const s2: MCPServer = { name: "b", command: "cmd" };
    manager.addServer(s1);
    manager.addServer(s2);
    const result = manager.removeServer("a");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("b");
  });

  it("removeServer returns all servers if name not found", () => {
    const s1: MCPServer = { name: "a", command: "cmd" };
    manager.addServer(s1);
    const result = manager.removeServer("missing");
    expect(result).toHaveLength(1);
  });

  it("auth resolves without error", async () => {
    await expect(manager.auth("test")).resolves.toBeUndefined();
  });

  it("resetAuth resolves without error", async () => {
    await expect(manager.resetAuth("test")).resolves.toBeUndefined();
  });

  it("test returns success", async () => {
    const result = await manager.test("test");
    expect(result.success).toBe(true);
  });
});
