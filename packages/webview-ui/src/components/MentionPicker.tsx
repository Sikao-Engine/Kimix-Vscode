import { useEffect, useMemo, useRef, useState } from "react";
import type { FileListItem, SymbolListItem } from "../protocol";
import { useStore } from "../store";

interface MentionPickerProps {
  query: string;
  onSelect: (path: string, label: string, kind: "file" | "symbol") => void;
  onClose: () => void;
}

export function MentionPicker({ query, onSelect, onClose }: MentionPickerProps) {
  const fileList = useStore((s) => s.fileList);
  const symbolList = useStore((s) => s.symbolList);
  const requestFiles = useStore((s) => s.requestFiles);
  const requestSymbols = useStore((s) => s.requestSymbols);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const lowerQuery = query.toLowerCase();

  useEffect(() => {
    requestFiles(query);
    if (query.length > 1) {
      requestSymbols(query);
    }
  }, [query, requestFiles, requestSymbols]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, fileList, symbolList]);

  const items: Array<
    | ({ kind: "file" } & FileListItem)
    | ({ kind: "symbol" } & SymbolListItem)
  > = useMemo(() => {
    const files = fileList
      .filter((f) => f.label.toLowerCase().includes(lowerQuery))
      .slice(0, 50)
      .map((f) => ({ ...f, kind: "file" as const }));
    const symbols = symbolList
      .filter(
        (s) =>
          s.name.toLowerCase().includes(lowerQuery) ||
          s.path.toLowerCase().includes(lowerQuery),
      )
      .slice(0, 50)
      .map((s) => ({ ...s, kind: "symbol" as const }));
    return [...files, ...symbols];
  }, [fileList, symbolList, lowerQuery]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (i) => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1),
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) {
          if (item.kind === "file") {
            onSelect(item.path, item.label, "file");
          } else {
            onSelect(`${item.path}#${item.name}`, `${item.name} (${item.path})`, "symbol");
          }
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, onClose, onSelect, selectedIndex]);

  useEffect(() => {
    const el = containerRef.current?.querySelector("[data-selected='true']");
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <div className="mention-picker" ref={containerRef}>
        <div className="mention-empty">No matches</div>
      </div>
    );
  }

  return (
    <div className="mention-picker" ref={containerRef} role="listbox">
      {items.map((item, idx) => {
        const selected = idx === selectedIndex;
        const label = item.kind === "file" ? item.label : `${item.name} — ${item.path}`;
        return (
          <div
            key={`${item.kind}-${item.path}-${idx}`}
            className={`mention-item ${selected ? "selected" : ""}`}
            data-selected={selected}
            role="option"
            aria-selected={selected}
            onMouseEnter={() => setSelectedIndex(idx)}
            onClick={() => {
              if (item.kind === "file") {
                onSelect(item.path, item.label, "file");
              } else {
                onSelect(
                  `${item.path}#${item.name}`,
                  `${item.name} (${item.path})`,
                  "symbol",
                );
              }
            }}
          >
            <span className="mention-kind">{item.kind === "file" ? "📄" : "◎"}</span>
            <span className="mention-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
