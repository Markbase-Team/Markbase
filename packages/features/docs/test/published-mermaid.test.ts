import { describe, it, expect } from "vitest";
import { markdownToHtml } from "../src/logic/html";

// A published page is built on the server, where a diagram cannot be drawn —
// mermaid measures text to lay one out and needs a DOM. The fence becomes a
// placeholder carrying its source, which the client turns into the picture; if
// that script never runs, the reader still has the source rather than a blank.

describe("mermaid on a published page", () => {
  it("becomes a placeholder that carries the source", () => {
    const html = markdownToHtml("```mermaid\ngraph TD\n  A-->B\n```\n");
    expect(html).toContain('class="mermaid-source"');
    expect(html).toContain("graph TD");
    expect(html).toContain("A--&gt;B"); // escaped: this lands in innerHTML
  });

  it("leaves every other code block exactly as it was", () => {
    const html = markdownToHtml("```ts\nconst a = 1;\n```\n");
    expect(html).toContain('<code class="language-ts">');
    expect(html).not.toContain("mermaid");
  });

  it("leaves a bare fence alone", () => {
    expect(markdownToHtml("```\nplain\n```\n")).not.toContain("mermaid");
  });

  it("escapes source that would otherwise inject markup", () => {
    const html = markdownToHtml('```mermaid\ngraph TD\n  A["<img src=x onerror=alert(1)>"]\n```\n');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("handles several diagrams in one document", () => {
    const html = markdownToHtml("```mermaid\ngraph TD\nA-->B\n```\n\ntext\n\n```mermaid\ngraph LR\nC-->D\n```\n");
    expect(html.match(/class="mermaid-source"/g)).toHaveLength(2);
  });

  it("is case-insensitive about the language, as fences are", () => {
    expect(markdownToHtml("```Mermaid\ngraph TD\n```\n")).toContain('class="mermaid-source"');
  });
});
