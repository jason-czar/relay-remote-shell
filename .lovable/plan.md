
## What the user specified (canonical commands)

**Spawn (fires immediately when new chat starts):**
```bash
tmux new-session -d -s <name> claude && sleep 1 && tmux send-keys -t <name> Enter ""
tmux new-session -d -s <name> codex  && sleep 1 && tmux send-keys -t <name> Enter ""
```
The `-d` flag IS back. The `sleep 1 && tmux send-keys Enter ""` sends an empty Enter after 1s to dismiss any initial prompt/trust gate.

**First AND subsequent messages (identical for both agents):**
```bash
tmux send-keys -t <name> "message text" && sleep 1 && tmux send-keys -t <name> "" Enter
```
No `tmux attach` in any message command. The second PTY session does `tmux attach -t <name>` separately — the user says every conversation needs 2 PTY sessions: one for commands, one as the viewer. The app already does this naturally: the relay PTY is the command channel, and the user can open a terminal panel to view the tmux session.

**Response capture for display** (new — not currently implemented):
- Codex: `tmux capture-pane -t <name> -pS - | awk -v msg="USER_MSG" '...'`
- Claude: `tmux capture-pane -t <name> -pS - | awk -v msg="USER_MSG" '...' | sed ...`

This replaces the current stdout-streaming approach with a `tmux capture-pane` poll after sending each message.

---

## Gaps vs current code

| | Current | Required |
|---|---|---|
| Spawn Claude | `-d -s <name> -x 220 -y 50 && send-keys 'claude' Enter && attach` | `-d -s <name> claude && sleep 1 && send-keys Enter ""` |
| Spawn Codex | `codex --skip-git-repo-check` (no tmux) | `-d -s <name> codex && sleep 1 && send-keys Enter ""` |
| All messages | raw stdin `text + "\n"` | `send-keys -t <name> "text" && sleep 1 && send-keys -t <name> "" Enter` |
| Response capture | parse stdout stream from relay | `tmux capture-pane -t <name> -pS - \| awk ...` |
| PTY role | single PTY: command + view | command-only PTY; viewer PTY is separate (user opens terminal panel) |

---

## Implementation plan

### Edit 1 — Generalize `ensureClaudeTmuxSession` → `ensureTmuxSession` (line 1427)
Add a `prefix` parameter so Codex can use `cx-` prefix. Same race-safe logic, just parameterized.

### Edit 2 — Spawn commands (Claude + Codex, no-PTY-yet branch)

**Claude** (line 1560–1574): Replace spawn command with:
```bash
command -v tmux ... || { echo 'TMUX_NOT_FOUND'; exit 1; } && tmux new-session -d -s <name> claude<modelPart> && sleep 1 && tmux send-keys -t <name> Enter ""
```
Resume path stays the same (probe + attach) but drop `-x 220 -y 50`.

**Codex** (line 1512–1548): Full rewrite:
- Call `ensureTmuxSession(convId, "cx-")` to get `tmuxName`
- No PTY yet: `tmuxCheck && tmux new-session -d -s <name> codex<modelPart> && sleep 1 && tmux send-keys -t <name> Enter ""`
- Store `deferredFirstMsgRef`; `attachingToTmuxRef` for resume path

### Edit 3 — All message routing: use `send-keys` not raw stdin

Replace every `return text + "\n"` (lines 1547, 1600) and every `relay.sendRawStdin(sessionId, btoa(text + "\n"))` flush in `onChunkActivity` and the boot-timeout handler with:

```bash
tmux send-keys -t <name> 'escaped_text' && sleep 1 && tmux send-keys -t <name> '' Enter
```

This runs as a shell command on the command PTY — no raw stdin needed. The return value from `buildCommand` IS this shell command string.

For the deferred flush in `onChunkActivity` (line 979): use `relay.sendRawStdin` with the send-keys command bytes instead of raw text.

For boot-timeout flush (lines 1534–1536, 1589–1591) and banner-ready flush (lines 1008–1010): same — wrap in send-keys command.

### Edit 4 — `tmuxName` available in message-routing branches

Currently `tmuxName` is only resolved in the no-PTY path. For `state.ready` branch (lines 1547, 1600) to emit the send-keys command, it needs `tmuxName`. Solution: move `ensureTmuxSession` call to the top of each agent's branch (before `if (!sessionId)`), so `tmuxName` is available everywhere in that branch. Since it's a DB read, it's a cheap single-row fetch and is already cached in most cases.

### Edit 5 — `onChunkActivity` deferred flush (line 979)

Change:
```typescript
relay.sendRawStdin(sessionId, btoa(deferredText + "\n"));
```
To:
```typescript
const tmuxName = /* read from conversations state */ conversations.find(c => c.id === activeConvIdRef.current)?.tmux_session_name;
if (tmuxName) {
  const cmd = `tmux send-keys -t ${tmuxName} ${shellEscape(deferredText)} && sleep 1 && tmux send-keys -t ${tmuxName} '' Enter\n`;
  relay.sendRawStdin(sessionId, btoa(cmd));
}
```

Same pattern for boot-timeout flush and banner-ready flush.

---

## Files changed
- `src/pages/Chat.tsx` only — 5 targeted edits
- No DB migration needed

## Key simplification
- `attachingToTmuxRef` fast-path still valid: when resuming a live tmux session, the agent is already ready → immediately flush deferred message as a send-keys command
- The `runtimeAgentsRef` + `pendingQueueRef` readiness system is retained for Codex (needs banner detection) but becomes mostly a pass-through for Claude (tmux attach makes it instantly ready)
- Response display continues to use the existing stdout-stream parsing (the relay streams all PTY output including tmux capture-pane output to the browser) — no change to response parsing layer needed
