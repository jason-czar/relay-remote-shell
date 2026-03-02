
## What we're implementing

Three targeted fixes to the existing plan, confirmed by ChatGPT's final review. The core REPL spawn architecture, runtimeAgentsRef, pendingQueueRef, readiness detection, and approval UI are all already in the plan — we only need these 3 surgical additions before proceeding.

---

## Fix 1 — Trust-gate readiness guard (`Chat.tsx`)

**Problem:** Codex can print `"Approval mode: suggest"` *before* the trust gate prompt, causing `AGENT_READY_RE` to fire too early, marking the agent ready while it's still blocked on the trust check.

**Fix:** Add `TRUST_BLOCK_RE` and gate readiness on both conditions:

```ts
const TRUST_BLOCK_RE = /Not inside a trusted directory|Working with untrusted/i;
```

In the `onChunk` readiness detection:
```ts
// Only mark ready if banner seen AND trust block is NOT active in the buffer
if (AGENT_READY_RE.codex.test(chunk) && !TRUST_BLOCK_RE.test(outputBuffer)) {
  state.ready = true;
  // flush pending queue...
}
```

---

## Fix 2 — Session-scoped pending queue (`Chat.tsx`)

**Problem:** `pendingQueueRef = useRef<string[]>([])` is global. In a multi-device setup, messages queued for one PTY could flush into another.

**Fix:** Change type to `Record<string, string[]>` keyed by sessionId:

```ts
const pendingQueueRef = useRef<Record<string, string[]>>({});
```

All queue reads/writes use `pendingQueueRef.current[sessionId]`.  
PTY death cleanup adds: `delete pendingQueueRef.current[deadSessionId]`.

---

## Fix 3 — Only call `onAwaitingInput` for blocking prompts (`usePersistentRelaySession.ts`)

**Problem:** The current plan calls `onAwaitingInput` whenever `AWAITING_INPUT_RE` matches. This would surface buttons for informational agent suggestions like "Would you like to refactor this?" which are not blocking prompts.

**Fix:** Add `BLOCKING_PROMPT_RE` and gate `onAwaitingInput` on both:

```ts
const BLOCKING_PROMPT_RE = /Do you trust|Not inside a trusted directory|Working with untrusted|\[Y\/n\]|\(y\/n\)|password:|Proceed\?|Continue\?/i;
```

In `resetSilence`, only call `onAwaitingInput` when both fire:
```ts
if (AWAITING_INPUT_RE.test(stripped) && BLOCKING_PROMPT_RE.test(stripped)) {
  onAwaitingInputRef.current?.(extractOptions(stripped));
}
```

---

## Files to change

| File | Change |
|---|---|
| `src/hooks/usePersistentRelaySession.ts` | Add `BLOCKING_PROMPT_RE`; gate `onAwaitingInput` call on both `AWAITING_INPUT_RE` + `BLOCKING_PROMPT_RE` |
| `src/pages/Chat.tsx` | Add `TRUST_BLOCK_RE`; guard readiness with trust-block check; change `pendingQueueRef` to `Record<string, string[]>` keyed by sessionId; update all queue accesses and PTY death cleanup |

These are small, surgical changes — no new files, no structural rewrites. The full REPL spawn implementation from the prior plan is still needed and will be built alongside these.
