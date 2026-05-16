import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileManager, isImageFile, getMediaMimeType } from "../../src/file/manager";

describe("FileManager", () => {
  let manager: FileManager;
  let broadcastMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broadcastMock = vi.fn();
    manager = new FileManager(() => "/workspace", broadcastMock);
  });

  it("sets and gets sessionId", () => {
    manager.setSessionId("view1", "sess-1");
    expect(manager.getSessionId("view1")).toBe("sess-1");
  });

  it("tracks files", () => {
    manager.trackFile("view1", "/workspace/file.ts");
    expect(manager.getTracked("view1").has("/workspace/file.ts")).toBe(true);
  });

  it("clears tracked files", () => {
    manager.trackFile("view1", "/workspace/file.ts");
    manager.clearTracked("view1");
    expect(manager.getTracked("view1").size).toBe(0);
  });

  it("disposeView removes view state", () => {
    manager.setSessionId("view1", "sess-1");
    manager.trackFile("view1", "/workspace/file.ts");
    manager.disposeView("view1");
    expect(manager.getSessionId("view1")).toBeNull();
    expect(manager.getTracked("view1").size).toBe(0);
  });
});

describe("isImageFile", () => {
  it("returns true for image extensions", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.JPEG")).toBe(true);
    expect(isImageFile("animation.gif")).toBe(true);
    expect(isImageFile("icon.svg")).toBe(true);
  });

  it("returns false for non-image extensions", () => {
    expect(isImageFile("doc.txt")).toBe(false);
    expect(isImageFile("video.mp4")).toBe(false);
  });
});

describe("getMediaMimeType", () => {
  it("returns correct mime types", () => {
    expect(getMediaMimeType("png")).toBe("image/png");
    expect(getMediaMimeType("jpg")).toBe("image/jpeg");
    expect(getMediaMimeType("jpeg")).toBe("image/jpeg");
    expect(getMediaMimeType("gif")).toBe("image/gif");
    expect(getMediaMimeType("webp")).toBe("image/webp");
    expect(getMediaMimeType("mp4")).toBe("video/mp4");
    expect(getMediaMimeType("webm")).toBe("video/webm");
    expect(getMediaMimeType("mov")).toBe("video/quicktime");
  });

  it("returns octet-stream for unknown extensions", () => {
    expect(getMediaMimeType("xyz")).toBe("application/octet-stream");
  });

  it("is case insensitive", () => {
    expect(getMediaMimeType("PNG")).toBe("image/png");
    expect(getMediaMimeType("Mp4")).toBe("video/mp4");
  });
});
