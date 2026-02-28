
## Save raw stdout to the database for historical viewing

**The problem:** `rawStdout` (the "raw stdout from relay" debug panel) is stored only in a React `useRef` Map — it lives in memory for the current session and is lost when the page reloads or a past conversation is opened. The `chat_messages` table has no column to store it.

**Pulling from the device isn't viable** — `relay.log` only contains connector-level output (connect/disconnect events), not the agent's JSON responses. There's no way to replay a past response from the device.

**The fix:** Add a `raw_stdout` column to `chat_messages` and persist it when saving assistant messages. On load, read it back and populate the debug panel for historical messages.

---

### Changes

**1. Database migration**
Add a nullable `raw_stdout text` column to `chat_messages`:
```sql
ALTER TABLE public.chat_messages ADD COLUMN raw_stdout text;
```

**2. `src/pages/Chat.tsx`**
- Update `saveMessage` to accept an optional `rawStdout` string and insert it into the new column
- Pass the captured `stdout` when saving the assistant message after a relay response
- When loading messages on conversation select, also fetch `raw_stdout`
- Populate `rawStdoutMapRef` from DB data when messages load, so historical messages show their debug panel

**3. `src/integrations/supabase/types.ts`** — auto-updated by Lovable Cloud, no manual edit needed.

No RLS changes required — the column inherits the existing row-level policy (conversation owner only).
