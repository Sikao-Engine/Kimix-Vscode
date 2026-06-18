import { useMemo } from "react";
import { renderMarkdown, type RenderMarkdownOptions } from "../markdown/markdown";

interface MarkdownRendererProps {
  text: string;
  className?: string;
  options?: RenderMarkdownOptions;
}

export function MarkdownRenderer({ text, className, options }: MarkdownRendererProps) {
  const html = useMemo(() => renderMarkdown(text, options), [text, options]);
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
