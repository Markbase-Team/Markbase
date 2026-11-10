"use client";

import { useEffect } from "react";

/**
 * Draw the mermaid blocks on a published page.
 *
 * The HTML is built on the server, where a diagram cannot be drawn — mermaid
 * measures text to lay one out, so it needs a DOM. markdownToHtml therefore emits
 * `<pre class="mermaid-source">` carrying the source, and this replaces each one
 * with the picture once the page is interactive.
 *
 * Mounted rather than inlined so the cost is honest: mermaid is ~500KB and is
 * imported only after a page turns out to contain a diagram. A published page
 * with none loads nothing extra.
 *
 * If this never runs — script blocked, an old browser, a crawler — the page still
 * shows the diagram's source, which is worth more than an empty box.
 */
export function MermaidDiagrams() {
  useEffect(() => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>("pre.mermaid-source")
    ).filter((el) => !el.dataset.drawn);
    if (blocks.length === 0) return;

    let cancelled = false;
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        // Published pages render text somebody else wrote. `strict` is what keeps
        // a diagram from carrying script into the reader's page.
        securityLevel: "strict",
        fontFamily: "inherit",
      });
      for (const [i, el] of blocks.entries()) {
        if (cancelled) return;
        const source = el.textContent ?? "";
        if (!source.trim()) continue;
        el.dataset.drawn = "1";
        try {
          const { svg } = await mermaid.render(`published-mermaid-${i}`, source);
          const figure = document.createElement("div");
          figure.className = "mermaid-figure";
          figure.innerHTML = svg;
          el.replaceWith(figure);
        } catch {
          // Leave the source visible. A diagram that will not draw is still
          // readable as text, and replacing it with an error the reader cannot
          // act on serves nobody — this is someone else's published page.
          el.dataset.drawn = "";
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
