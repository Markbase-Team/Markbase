import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The same rule packages/core keeps: "." is isomorphic, "./node" is everything
// that needs a machine.
//
// The first version of this test only looked for `node:` specifiers, and that
// is not enough here. terminal-operator imports nothing from node — the CLI
// injects readline — yet it exists to drive a terminal and has no business in a
// browser bundle. A test that asks "does it import fs?" would wave it through.
//
// So this pins the isomorphic graph exactly instead: the default entry reaches
// operator.ts and nothing else. Adding an export to index.ts then fails here,
// which is the point.

const SRC = resolve(__dirname, "../src");

function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+"(\.[^"]*)"/g)) {
      const base = resolve(dirname(file), m[1]);
      for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
        if (existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return seen.size ? [...seen].map((f) => f.slice(SRC.length + 1)).sort() : [];
}

describe("package boundary", () => {
  it("the default entry reaches only the interface", () => {
    expect(importGraph(join(SRC, "index.ts"))).toEqual(["index.ts", "operator.ts"]);
  });

  it("the default entry reaches no node builtins", () => {
    const touchesNode = importGraph(join(SRC, "index.ts")).filter((f) =>
      /from\s+"node:|require\("node:/.test(readFileSync(join(SRC, f), "utf8"))
    );
    expect(touchesNode).toEqual([]);
  });

  it("the node entry carries the flows that need a machine", () => {
    const graph = importGraph(join(SRC, "node.ts"));
    expect(graph).toContain("mount-vault.ts");
    expect(graph).toContain("terminal-operator.ts");
  });
});
