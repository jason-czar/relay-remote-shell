
## Plan: Fix First-Prompt Drop Bug in Chat.tsx + Auth Error Classification

### What to build

Four precise changes inside `src/pages/Chat.tsx` and one new pure helper file `src/lib/replClassifier.ts`.

---

### 1. New file: `src/lib/replClassifier.ts`

A tiny pure module (no React, no imports from Chat) with two exported functions:

```ts
// Classify stdout from a Codex/Claude REPL boot as an error type
export type ReplStartupError =
  | { kind: "auth"; agent: "codex" | "claude"; message: string }
  | { kind: "not_found"; agent: "codex" | "claude"; message: string }
  | null;

export function classifyReplStartupError(stdout: string, agent: "codex" | "claude"): ReplStartupError

// Returns actionable user-facing string, or null if no error
export function formatReplError(err: NonNullable<ReplStartupError>): string
```

Patterns to detect:
- **Codex auth**: `/not logged in|please run.*codex login|authentication required/i`
- **Claude auth**: `/not logged in|please run.*claude auth login|authentication required|no api key/i`
- **Not found (both)**: `/command not found|no such file.*directory|enoent/i`

This is the only testable pure logic extracted per the user's instruction. Tests go in `src/test/replClassifier.test.ts`.

---

### 2. Add `deferredFirstMsgRef` to Chat.tsx

New ref with structured type:
```ts
const deferredFirstMsgRef = useRef<{ agent: "codex" | "claude"; text: string } | null>(null);
```

This stores the user's first message when `buildCommand` is called before a `sessionId` exists, along with the agent type (read from the conversation's `agent` field at the time `buildCommand` runs — not from React state to avoid staleness).

---

### 3. Patch `buildCommand` — two drop points

**Drop point 1 — `!sessionId` path (both agents):**

```ts
// BEFORE
if (!sessionId) {
  return "codex\n";
}

// AFTER
if (!sessionId) {
  deferredFirstMsgRef.current = { agent: "codex", text };
  return `codex${modelPart}\n`;  // modelPart computed before the guard
}
```

Same fix mirrored for the `claude` branch. Note: `modelPart` is computed from `selectedModel` which is available at this point — move it above the `!sessionId` guard.

**Drop point 2 — `!state` path (both agents):**

```ts
// BEFORE (codex)
runtimeAgentsRef.current[sessionId] = { agent: "codex", ready: false };
// boot timeout...
return `codex${modelPart}\n`;

// AFTER
runtimeAgentsRef.current[sessionId] = { agent: "codex", ready: false };
pendingQueueRef.current[sessionId] = [text];   // ← queue the first message
// boot timeout... (unchanged)
return `codex${modelPart}\n`;
```

Same for `claude` `!state` branch.

---

### 4. Patch `onChunkActivity` — migrate deferred message when session appears

In the REPL readiness detection block (around line 918), add a block **before** the existing state check:

```ts
// Migrate deferred first message once sessionId is established
if (sessionId && deferredFirstMsgRef.current && !runtimeAgentsRef.current[sessionId]) {
  const { agent, text } = deferredFirstMsgRef.current;
  deferredFirstMsgRef.current = null;
  runtimeAgentsRef.current[sessionId] = { agent, ready: false };
  pendingQueueRef.current[sessionId] = [text];
  // Start boot timeout for this newly-registered session
  setTimeout(() => {
    const s = runtimeAgentsRef.current[sessionId];
    if (s && !s.ready) {
      s.ready = true;
      const queue = pendingQueueRef.current[sessionId] ?? [];
      delete pendingQueueRef.current[sessionId];
      for (const q of queue) relay.sendRawStdin(sessionId, btoa(q + "\n"));
    }
  }, 20_000);
}
```

This gives the deferred-session path the same boot-timeout protection as the `!state` path.

---

### 5. Add Claude boot timeout (parity with Codex)

In the `claude` `!state` branch (~line 1356), add the same 20s timeout guard that Codex already has. Currently the Claude branch has none — if the readiness banner never fires, the queue stalls forever.

---

### 6. Auth error classification — run BEFORE empty-response retry

At line ~1764, before the `if (!responseText.trim())` auto-retry block, insert:

```ts
// ── Auth/startup error classification ───────────────────────────────────
if (!responseText.trim() && (convData?.agent === "codex" || convData?.agent === "claude")) {
  const err = classifyReplStartupError(stdout, convData.agent);
  if (err) {
    responseText = formatReplError(err);
    // Skip the auto-retry — retrying an auth failure just re-spawns and hides the error
  }
}
```

This runs **before** the retry block so auth failures produce actionable messages instead of triggering a pointless re-run.

---

### 7. Tests: `src/test/replClassifier.test.ts`

Unit tests for the pure classifier only (aligned with Codex's guidance):
- Codex auth error strings → `{ kind: "auth", agent: "codex" }`
- Claude auth error strings → `{ kind: "auth", agent: "claude" }`
- "command not found" → `{ kind: "not_found" }`
- Clean stdout → `null`
- `formatReplError` produces actionable strings with the right commands

---

### 8. Validation step (documentation / comment in plan)

**Not a code change** — a manual step the user must do on the connector host after the fix is deployed:

```sh
claude auth login        # Claude is currently logged out per auth status
claude auth status       # Confirm logged in
codex login status       # Confirm still logged in
```

Claude will not work until host auth is fixed regardless of the frontend fix. This should be surfaced clearly in the assistant response after the code lands.

---

### Files changed

| File | Change |
|---|---|
| `src/lib/replClassifier.ts` | New — pure classifier + formatter |
| `src/test/replClassifier.test.ts` | New — unit tests for classifier |
| `src/pages/Chat.tsx` | Add `deferredFirstMsgRef`; patch two `!sessionId` drop points; patch two `!state` drop points to queue first message; add deferred-session migration + timeout in `onChunkActivity`; add Claude boot timeout; insert auth error classification before retry |

No backend changes. No plist changes. OpenClaw path untouched.
