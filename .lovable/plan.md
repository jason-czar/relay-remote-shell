
## Pre-flight checks

**`buildCommand` already async**: Confirmed — line 1404: `const buildCommand = useCallback(async (text: string, ...): Promise<string> => {`. No signature change needed.

**TypeScript types**: `src/integrations/supabase/types.ts` is auto-generated and will update automatically after the migration runs. No manual edits needed — the Supabase integration regenerates it on schema change.

---

## Implementation plan

### 1. Database migration
Add `tmux_session_name text` column to `chat_conversations`.

### 2. `src/pages/Chat.tsx` — 5 targeted edits

**Edit 1** — Add `attachingToTmuxRef` at line 652 (after `deferredFirstMsgRef`):
```typescript
const attachingToTmuxRef = useRef<boolean>(false);
```

**Edit 2** — Update DB select in `buildCommand` at line 1407:
```
select("agent, openclaw_session_id, claude_session_id, tmux_session_name")
```

**Edit 3** — Add `ensureClaudeTmuxSession` helper at line 1403 (before `buildCommand`). Race-safe: generates `cc-${convId.replace(/-/g,'').substring(0,8)}`, persists with `.is("tmux_session_name", null)`, re-reads on race loss, updates local React state.

**Edit 4** — Replace Claude branch of `buildCommand` (lines 1493–1530):
- Call `await ensureClaudeTmuxSession(convId)` to get `tmuxName`
- Prepend `command -v tmux >/dev/null 2>&1 || { echo 'TMUX_NOT_FOUND'; exit 1; }` guard
- **First-time path** (`!conv.tmux_session_name`): spawn fresh, no flag set — banner detection handles readiness:
  ```bash
  tmux new-session -d -s <name> -x 220 -y 50 && tmux send-keys -t <name> 'claude<modelPart>' Enter && tmux attach -t <name>
  ```
- **Resume path** (`conv.tmux_session_name` exists): set `attachingToTmuxRef.current = true`, probe + attach with correct fallback:
  ```bash
  tmux has-session -t <name> 2>/dev/null && tmux send-keys -t <name> '' Enter && tmux attach -t <name> || (tmux new-session -d -s <name> -x 220 -y 50 && tmux send-keys -t <name> 'claude<resumeFlag><modelPart>' Enter && tmux attach -t <name>)
  ```
  Flag is safe even when tmux is dead and fallback spawns fresh: first message sits in PTY stdin buffer and is read when Claude's REPL reaches its input prompt.
- PTY-already-exists path (lines 1503–1529): unchanged

**Edit 5** — Update deferred-first-message handler in `onChunkActivity` (lines 955–970):
- Add `TMUX_NOT_FOUND` check before the deferred block → `toast.error(...)` 
- After registering `runtimeAgentsRef.current[sessionId]`, branch on `attachingToTmuxRef.current`:
  - `true`: clear flag, set `ready = true`, immediately `sendRawStdin` the deferred text — skip 20s timeout
  - `false`: existing path (queue + 20s timeout) unchanged

### What stays unchanged
- OpenClaw and Codex branches  
- `extractClaudeSessionId` and `--resume` fallback  
- `AGENT_READY_RE.claude` — `>\\s*$` already matches redrawn Claude prompt after tmux attach  
- All relay/PTY infrastructure
