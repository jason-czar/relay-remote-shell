
## Plan: AI Chat Interface (OpenClaw + Claude Code)

### Database migration
One new migration creating two tables:

```sql
CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  agent text NOT NULL DEFAULT 'openclaw',          -- 'openclaw' | 'claude'
  title text NOT NULL DEFAULT 'New Conversation',
  openclaw_session_id text,                        -- pre-generated UUID, passed as --session-id
  claude_session_id text,                          -- parsed from stdout
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,   -- 'user' | 'assistant'
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on chat_conversations: user_id = auth.uid()
-- RLS on chat_messages: via conversation ownership join
```

### Final command execution matrix

| Agent | Scenario | Command sent via relay stdin |
|-------|----------|------------------------------|
| OpenClaw | New conversation | `openclaw agent --agent main --session-id <pre-generated-uuid> --message "..." --json --local\n` |
| OpenClaw | Continue | same `openclaw_session_id` stored in DB |
| Claude | New conversation | `claude -p "..."\n` |
| Claude | Continue | `claude -c -p "..."\n` |

Key change from ChatGPT feedback: **OpenClaw session ID is generated on the frontend (crypto.randomUUID()) before the first message is sent** — not parsed from stdout. This makes it deterministic and avoids any parsing race conditions.

For Claude, stdout is still scanned for `/Session ID:\s*(\S+)/` to capture `claude_session_id` for `--resume` if needed, but `-c` (continue last) is the primary continuation mechanism.

### Relay integration (no xterm)
Reuses the same WebSocket pattern from `TerminalSession.tsx` (`/session` endpoint, `auth` → `auth_ok` → `session_start` → `stdin` send → buffer `stdout` messages). No Terminal instance — just a string buffer. Response completion detected by 1.5s silence after last stdout chunk. 30s hard timeout with error message.

### Files to create/modify

**New files:**
- `supabase/migrations/20260226_chat_tables.sql`
- `src/pages/Chat.tsx` — full page: sidebar + agent toggle + device picker + message area + input
- `src/components/ChatSidebar.tsx` — conversation list, new chat button, delete (with trash on hover)
- `src/components/ChatMessage.tsx` — message bubbles (user right-aligned, assistant left-aligned, with `●●●` thinking indicator)

**Modified files:**
- `src/App.tsx` — add `/chat` protected route
- `src/components/AppSidebar.tsx` — add "Chat" nav item with `MessageSquare` icon (between Multi-Session and PrivaClaw)

### Page layout
```
┌─ AppLayout sidebar ─────────────────────────────────────────────┐
│ ┌─ ChatSidebar (w-64) ──┬─ Chat area ─────────────────────────┐ │
│ │ + New Chat            │  ┌────────────────────────────────┐  │ │
│ │ ─────────────────     │  │  [OpenClaw ●]  [ Claude Code ] │  │ │ ← ToggleGroup centered
│ │ > Conversation 1      │  │  Device: [picker ▾]            │  │ │
│ │   Conversation 2      │  └────────────────────────────────┘  │ │
│ │   Conversation 3      │                                       │ │
│ │                       │   scroll area (messages)             │ │
│ │                       │   ┌──────────────────────────────┐   │ │
│ │                       │   │  [textarea]      [Send ▶]    │   │ │
│ │                       │   └──────────────────────────────┘   │ │
│ └───────────────────────┴───────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

### Key UX behaviours
1. **Agent toggle** defaults to OpenClaw; switching agent on an active conversation offers "Start new conversation?"
2. **Device picker** — dropdown of all devices the user has access to (fetched via existing RLS on `devices`); must select a device before sending
3. **OpenClaw session ID** — `crypto.randomUUID()` generated when creating the conversation row, stored in `openclaw_session_id`, passed as `--session-id` on every turn
4. **Auto-title** — first 40 chars of the user's first message
5. **Thinking indicator** — `● ● ●` animated dots while awaiting response; times out at 30s
6. **Enter to send**, Shift+Enter for newline
7. **Conversation delete** — trash icon on hover in sidebar
8. **Relay sessions** — a fresh relay session is created per send (lightweight); conversational state lives in DB session IDs
