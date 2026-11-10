import { describe, it, expect } from "vitest";
import { ticketBranch, ticketBranchKind } from "../src/tickets";

describe("ticketBranchKind", () => {
  it("classifies defect-flavored tickets as fix", () => {
    expect(ticketBranchKind({ title: "Fix login crash", description: "" })).toBe("fix");
    expect(ticketBranchKind({ title: "Button broken", description: "" })).toBe("fix");
    expect(ticketBranchKind({ title: "Typo in header", description: "" })).toBe("fix");
    expect(ticketBranchKind({ title: "Slow page", description: "regression after deploy" })).toBe("fix");
  });

  it("classifies everything else as feature", () => {
    expect(ticketBranchKind({ title: "Add dark mode", description: "" })).toBe("feature");
    expect(ticketBranchKind({ title: "New onboarding flow", description: "" })).toBe("feature");
  });

  it("matches whole words only (not substrings like 'prefix')", () => {
    expect(ticketBranchKind({ title: "Add prefix support", description: "" })).toBe("feature");
  });
});

describe("ticketBranch", () => {
  const base = { id: "abcdef1234", description: "" };

  it("prefers an explicit base_branch, trimmed", () => {
    expect(ticketBranch({ ...base, title: "x", base_branch: "  main  " })).toBe("main");
  });

  it("derives feature/<slug>-<id6> when no base branch is set", () => {
    expect(ticketBranch({ ...base, title: "Add Dark Mode", base_branch: null })).toBe(
      "feature/add-dark-mode-abcdef"
    );
  });

  it("derives fix/<slug>-<id6> for defect tickets", () => {
    expect(ticketBranch({ ...base, title: "Fix the crash", base_branch: null })).toBe(
      "fix/fix-the-crash-abcdef"
    );
  });

  it("slugifies punctuation/case and caps length", () => {
    const b = ticketBranch({ ...base, title: "Feature: Café & Co!!!", base_branch: "" });
    expect(b.startsWith("feature/feature-caf-co-")).toBe(true);
    expect(b.endsWith("-abcdef")).toBe(true);
  });

  it("falls back to a 'ticket' slug when the title has no usable chars", () => {
    expect(ticketBranch({ ...base, title: "＄＄＄", base_branch: null })).toBe(
      "feature/ticket-abcdef"
    );
  });
});
