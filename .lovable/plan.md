
## Root cause analysis

The relay log and network requests reveal **three compounding problems** causing excessive disconnections:

### Problem 1: Multiple duplicate `start-session` calls on page load
The network logs show **6 simultaneous `start-session` calls** all firing within 300ms when Chat.tsx loads (at 17:15:47–48). These create 6 separate DB session rows. They then all immediately get `end-session` calls, leaving the user with no stable session to resume.

**Cause:** `usePersistentRelaySession` is instantiated multiple times across different components that all mount at page load (Chat page renders multiple agent sub-components / panels, each calling `prewarmSession` or `ensureSessionId` independently).

### Problem 2: Browser disconnect → grace timer → connector send of `browser_disconnected`
When the user navigates away or the browser goes to background (iOS app-switch, tab change), the browser WS closes. The relay starts a **30-minute grace timer** — good. BUT when the grace timer fires, it sends `session_end` with `reason: "browser_disconnected"` to the connector. The Go connector currently **does NOT ignore** `browser_disconnected` — it actually ends the PTY. This means even though the relay waits 30 minutes, the connector kills the process.

Looking at the relay log (line 45-46 of the upload): 
```
Ending session ...: browser_disconnected
Ending session ...: browser_disconnected
```
These are arriving at the connector and terminating the PTY. This is the core persistence failure when navigating away.

### Problem 3: `ensureSessionId` uses `user_id` filter but sessions table stores `user_id = null`
The network response shows all devices have `user_id: null`. The `ensureSessionId` function queries:
```
.eq("user_id", user.id)
```
This will **never match** existing sessions (since `user_id` is null in the sessions table), so it always falls through to create a brand new session rather than reusing an existing active one.

---

## The Fix Plan

### Fix 1: Stop the duplicate `start-session` storm (frontend)
In `usePersistentRelaySession.ts`, add a module-level in-flight deduplication map so that concurrent `ensureSessionId` calls for the same device wait for the same promise rather than all firing `start-session` simultaneously.

```
const inflightSessions = new Map<string, Promise<string | null>>();
```

### Fix 2: Make `ensureSessionId` find sessions without `user_id` filter (frontend)
Remove the `.eq("user_id", user.id)` filter from the active session lookup, OR use `.or("user_id.eq." + user.id + ",user_id.is.null")` to also match sessions that were created before `user_id` was stored.

### Fix 3: Relay — don't send `browser_disconnected` to the connector on grace expiry (relay server)
In `relay-server/src/index.js`, the grace timer callback (line 667–686) sends `session_end` with `reason: "browser_disconnected"` to the connector. This kills the PTY. Instead, **only update the DB** on grace expiry; don't tell the connector to end the PTY. The PTY will naturally expire on its own if the connector process restarts.

Change the grace timer callback from:
```js
send(connectorWs, { type: "session_end", data: { session_id: sessionId, reason: "browser_disconnected" } });
```
To: simply skip sending to the connector (let PTY live).

---

## Files to change

1. `src/hooks/usePersistentRelaySession.ts` — Fix 1 (dedup) + Fix 2 (user_id query)
2. `relay-server/src/index.js` — Fix 3 (don't kill PTY on grace expiry)

These are targeted, low-risk changes. The relay server change requires a redeploy to Fly.io (which happens automatically when the file is saved in this project).
