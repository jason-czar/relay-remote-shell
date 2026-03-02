import { describe, it, expect } from "vitest";
import {
  classifyReplStartupError,
  formatReplError,
} from "@/lib/replClassifier";

describe("classifyReplStartupError", () => {
  // ── Codex auth ─────────────────────────────────────────────────────────────
  it("detects codex 'not logged in'", () => {
    const result = classifyReplStartupError("Error: not logged in", "codex");
    expect(result).toMatchObject({ kind: "auth", agent: "codex" });
  });

  it("detects codex 'please run codex login'", () => {
    const result = classifyReplStartupError(
      "Please run `codex login` to authenticate.",
      "codex",
    );
    expect(result).toMatchObject({ kind: "auth", agent: "codex" });
  });

  it("detects codex 'authentication required'", () => {
    const result = classifyReplStartupError("Authentication required.", "codex");
    expect(result).toMatchObject({ kind: "auth", agent: "codex" });
  });

  // ── Claude auth ────────────────────────────────────────────────────────────
  it("detects claude 'not logged in'", () => {
    const result = classifyReplStartupError("Error: not logged in", "claude");
    expect(result).toMatchObject({ kind: "auth", agent: "claude" });
  });

  it("detects claude 'please run claude auth login'", () => {
    const result = classifyReplStartupError(
      "Please run `claude auth login` to continue.",
      "claude",
    );
    expect(result).toMatchObject({ kind: "auth", agent: "claude" });
  });

  it("detects claude 'No API key'", () => {
    const result = classifyReplStartupError("No API key configured.", "claude");
    expect(result).toMatchObject({ kind: "auth", agent: "claude" });
  });

  // ── Not found ──────────────────────────────────────────────────────────────
  it("detects 'command not found' for codex", () => {
    const result = classifyReplStartupError(
      "bash: codex: command not found",
      "codex",
    );
    expect(result).toMatchObject({ kind: "not_found", agent: "codex" });
  });

  it("detects 'command not found' for claude", () => {
    const result = classifyReplStartupError(
      "zsh: command not found: claude",
      "claude",
    );
    expect(result).toMatchObject({ kind: "not_found", agent: "claude" });
  });

  it("detects ENOENT", () => {
    const result = classifyReplStartupError(
      "spawn codex ENOENT",
      "codex",
    );
    expect(result).toMatchObject({ kind: "not_found", agent: "codex" });
  });

  it("not_found takes priority over auth pattern", () => {
    const result = classifyReplStartupError(
      "command not found: codex — not logged in",
      "codex",
    );
    expect(result?.kind).toBe("not_found");
  });

  // ── Clean stdout ───────────────────────────────────────────────────────────
  it("returns null for clean codex startup", () => {
    expect(
      classifyReplStartupError("Codex v1.2.3  Model: gpt-5.3-codex\nworkdir: /home/user", "codex"),
    ).toBeNull();
  });

  it("returns null for clean claude startup", () => {
    expect(
      classifyReplStartupError("Claude Code 1.0\nType your message below…", "claude"),
    ).toBeNull();
  });

  it("returns null for empty stdout", () => {
    expect(classifyReplStartupError("", "codex")).toBeNull();
    expect(classifyReplStartupError("", "claude")).toBeNull();
  });
});

describe("formatReplError", () => {
  it("codex auth error includes login command", () => {
    const err = classifyReplStartupError("not logged in", "codex")!;
    const msg = formatReplError(err);
    expect(msg).toContain("codex login");
    expect(msg).toContain("⚠️");
  });

  it("claude auth error includes auth login command", () => {
    const err = classifyReplStartupError("not logged in", "claude")!;
    const msg = formatReplError(err);
    expect(msg).toContain("claude auth login");
    expect(msg).toContain("⚠️");
  });

  it("not_found error mentions PATH", () => {
    const err = classifyReplStartupError("command not found: codex", "codex")!;
    const msg = formatReplError(err);
    expect(msg).toContain("$PATH");
    expect(msg).toContain("codex");
  });
});
