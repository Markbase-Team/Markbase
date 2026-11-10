import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The documents layout is an async Server Component and DocsShell is a Client
// Component, so anything passed between them has to be serializable. DocsShell
// also needs `routing`, which is two methods — and React refuses those with
// "Functions cannot be passed directly to Client Components", at render time,
// on every visit to /dashboard/documents.
//
// The fix is structural rather than a value to assert: the routing object is
// built inside a client module, so it never crosses the boundary. These two
// checks are what "structural" means here — remove either and the error comes
// back, with no type error to warn anyone.

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(appRoot, p), "utf8");

describe("the documents surface stays on the right side of the boundary", () => {
  it("builds the routing object in a client module", () => {
    const source = read("src/components/docs-surface.tsx");

    expect(source.split("\n")[0]).toContain('"use client"');
    expect(source).toContain("DocsRouting");
  });

  it("keeps the server layout away from DocsShell, which would need that object", () => {
    const layout = read("src/app/dashboard/documents/layout.tsx");
    // Imports only — the prose above them names DocsShell to explain why it is
    // not imported, and a test that cannot tell those apart is a test nobody
    // will trust the next time it goes red.
    const imports = layout
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .join("\n");

    expect(imports).toContain("DocsSurface");
    // Importing DocsShell here is the mistake this guards: the layout would
    // then have to supply `routing`, from the server, as a function.
    expect(imports).not.toContain("DocsShell");
    expect(imports).not.toContain("DocsRouting");
  });
});
