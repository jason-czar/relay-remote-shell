
## Analysis

The architecture is already a **persistent REPL model** — Claude and Codex both spawn once per PTY and receive subsequent messages as raw stdin. The ChatGPT suggestion is largely already implemented. However there are three concrete gaps causing inconsistent conversations:

### Gap 1: `--resume` Not Used on Spawn (Most Critical)

When Claude spawns a new REPL (lines 1421, 1441), it always runs `claude\n` regardless of whether a `claude_session_id` is already stored on the conversation. This means:
- After a page reload (new PTY, same conversation), Claude starts fresh with no memory
- The trust gate re-appears every time
- Previous context is lost

**Fix**: When spawning Claude and `conv.claude_session_id` exists, emit `claude --resume <id>\n` instead of `claude\n`.

### Gap 2: Readiness Regex Too Narrow

Current: `/Type your message|Claude Code\s+\d/i`

The image the user uploaded shows the trust gate screen — `> 1. Yes, I trust this folder` — which doesn't match either pattern. If the REPL boots and shows the trust prompt before the readiness banner, the 20-second fallback fires and sends the user message into the trust gate UI rather than to Claude.

Also, the `TRUST_BLOCK_RE` pattern `/Not inside a trusted directory|Working with untrusted/i` doesn't match Claude's actual text (`"Is this a project you created or one you trust?"`).

**Fix**:
- Broaden `AGENT_READY_RE.claude` to also match `> ` prompt patterns and `✓` confirmations Claude emits after trust acceptance
- Update `TRUST_BLOCK_RE` to match Claude's actual trust-gate text: `"Is this a project you created"` and `"Quick safety check"`

### Gap 3: Session ID Not Captured in REPL Mode

`extractClaudeSessionId` looks for `{"type":"result","session_id":"..."}` which Claude emits in `--output-format stream-json` mode. But in interactive REPL mode (no `--print`), Claude doesn't emit this JSON. The session ID is only available from `Restored session: <id>` or similar banner text.

**Fix**: Add a REPL-specific session ID extractor that reads `Restored session:` lines or the session ID from Claude's interactive startup banner.

---

## Plan

### 1. Fix `--resume` spawn in `buildCommand` (Chat.tsx ~line 1416)

```typescript
if (conv.agent === "claude") {
  const resumeFlag = conv.claude_session_id ? ` --resume ${conv.claude_session_id}` : "";
  if (!sessionId) {
    deferredFirstMsgRef.current = { agent: "claude", text };
    return `claude${resumeFlag}${modelPart}\n`;
  }
  // ... rest unchanged, but use resumeFlag in spawn line too
  return `claude${resumeFlag}${modelPart}\n`;
}
```

### 2. Tighten readiness & trust-block patterns (~line 660)

```typescript
const AGENT_READY_RE = {
  codex: /Approval mode:|Model:|workdir:|session id:|Session \w{4,}:|openai\/codex|codex\s+v\d/i,
  claude: /Type your message|Claude Code\s+\d|>\s*$|✓|Restored session:/i,
};
const TRUST_BLOCK_RE = /Not inside a trusted directory|Working with untrusted|Is this a project you|Quick safety check/i;
```

### 3. Capture session ID from REPL banner (~line 1459)

Add a new branch in `extractClaudeSessionId` to parse the interactive startup banner:
```
Restored session: abc123-def456-...
```
Regex: `/Restored session:\s*([a-z0-9-]+)/i`

This makes the session ID persist correctly after the first conversation turn.

---

## Files to Edit

- `src/pages/Chat.tsx` — three targeted edits:
  1. `buildCommand` Claude branch: add `--resume <id>` when `conv.claude_session_id` exists
  2. `AGENT_READY_RE` / `TRUST_BLOCK_RE`: broaden patterns
  3. `extractClaudeSessionId`: add REPL banner regex as first check
