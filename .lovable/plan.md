
## What to implement

Two fixes to `buildCommand` in `src/pages/Chat.tsx`, lines 1412-1420, incorporating the feedback's correction to the race-safe pattern.

### Fix 1: Shell escape helper (line 1412)
Replace the naive double-quote escape with a proper single-quote wrapper:
```typescript
// Before:
const escaped = text.replace(/"/g, '\\"');

// After (add helper, use it for openclaw only):
const shellEscape = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
```

### Fix 2: Race-safe session ID (lines 1416-1420)
Replace the `?? crypto.randomUUID()` transient fallback with the corrected two-step atomic pattern:

```typescript
if (conv.agent === "openclaw") {
  let sid = conv.openclaw_session_id;
  if (!sid) {
    const candidate = crypto.randomUUID();
    const { data: updated } = await supabase
      .from("chat_conversations")
      .update({ openclaw_session_id: candidate })
      .eq("id", convId)
      .is("openclaw_session_id", null)
      .select("openclaw_session_id");

    if (updated && updated.length > 0) {
      // We won the race
      sid = updated[0].openclaw_session_id;
    } else {
      // We lost — re-read the winner's value
      const { data: row } = await supabase
        .from("chat_conversations")
        .select("openclaw_session_id")
        .eq("id", convId)
        .single();
      sid = row?.openclaw_session_id ?? candidate;
    }

    // Update local state so subsequent messages in this render cycle reuse sid
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, openclaw_session_id: sid! } : c
    ));
  }
  const modelPart = modelFlag ? ` ${modelFlag}` : "";
  return `openclaw agent --agent main --session-id ${sid}${modelPart} --message ${shellEscape(text)} --json --local\n`;
}
```

### File
- `src/pages/Chat.tsx` — one targeted block replacement, lines 1412-1420
