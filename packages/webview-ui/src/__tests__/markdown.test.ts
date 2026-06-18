import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown/markdown";

describe("renderMarkdown", () => {
  it("renders headings, paragraphs, and lists", () => {
    const html = renderMarkdown("# Hello\n\nSome text.\n\n- one\n- two\n");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>Some text.</p>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders code blocks with pre and code tags", () => {
    const html = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
    expect(html).toContain("</code></pre>");
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| c | d |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>c</td>");
    expect(html).toContain("</table>");
  });

  it("renders task lists with disabled checkboxes", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo\n");
    expect(html).toContain("<input");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("done");
    expect(html).toContain("todo");
    expect(html).not.toContain("<script");
  });

  it("strips raw HTML and scripts after sanitization", () => {
    const html = renderMarkdown("Hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("Hello");
    expect(html).toContain("world");
  });

  it("adds target=\"_blank\" and rel to external links", () => {
    const html = renderMarkdown("[link](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not add target=\"_blank\" to relative or internal links", () => {
    const html = renderMarkdown("[relative](/path) [file](file:///tmp/file.md)");
    expect(html).toContain('<a href="/path">');
    expect(html).toContain('<a href="file:///tmp/file.md">');
    expect(html).not.toContain('target="_blank"');
  });
});
