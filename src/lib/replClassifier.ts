/**
 * Pure REPL startup error classifier.
 * No React imports, no Chat.tsx deps — fully unit-testable.
 */

export type ReplStartupError =
  | { kind: "auth"; agent: "codex" | "claude"; message: string }
  | { kind: "not_found"; agent: "codex" | "claude"; message: string }
  | null;

// ── Pattern sets ─────────────────────────────────────────────────────────────

const CODEX_AUTH_RE =
  /not logged in|please run.*codex login|authentication required|login required/i;

const CLAUDE_AUTH_RE =
  /not logged in|please run.*claude auth login|authentication required|no api key/i;

const NOT_FOUND_RE =
  /command not found|no such file.*director|enoent/i;

// ── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify stdout from a Codex/Claude REPL boot as a structured error, or null
 * if no known failure pattern is detected.
 */
export function classifyReplStartupError(
  stdout: string,
  agent: "codex" | "claude",
): ReplStartupError {
  // "not found" takes precedence — the binary isn't installed at all
  if (NOT_FOUND_RE.test(stdout)) {
    return { kind: "not_found", agent, message: stdout };
  }

  const authRe = agent === "codex" ? CODEX_AUTH_RE : CLAUDE_AUTH_RE;
  if (authRe.test(stdout)) {
    return { kind: "auth", agent, message: stdout };
  }

  return null;
}

// ── Formatter ────────────────────────────────────────────────────────────────

/**
 * Returns an actionable user-facing error string for a classified REPL error.
 */
export function formatReplError(err: NonNullable<ReplStartupError>): string {
  if (err.kind === "not_found") {
    return (
      `⚠️ \`${err.agent}\` was not found on the connected device. ` +
      `Make sure it is installed and available on \`$PATH\`.`
    );
  }

  // auth error
  if (err.agent === "codex") {
    return (
      "⚠️ Codex is not authenticated on the connected device.\n\n" +
      "Run in your terminal:\n" +
      "```\ncodex login\ncodex login status\n```"
    );
  }

  // claude auth
  return (
    "⚠️ Claude is not authenticated on the connected device.\n\n" +
    "Run in your terminal:\n" +
    "```\nclaude auth login\nclaude auth status\n```"
  );
}
