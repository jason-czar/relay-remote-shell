
## Understanding the Problem

The user is pointing out that when Codex (or Claude) is running as an agent in a chat conversation, the system sends messages to Codex by:
1. Running `codex\n` on the PTY to spawn the Codex REPL (first message)
2. Sending subsequent messages as raw stdin directly into that running Codex REPL process

This means the conversation with Codex happens **inside the running PTY** — the user types in the chat composer, which gets piped as stdin to the Codex process running in the terminal. The bottom terminal pane should show exactly what's happening in that PTY — the Codex banner, the user's typed messages appearing at the Codex prompt, and Codex's responses.

**The user confirmed**: they manually ran `codex` in their terminal to start a session, and are typing into that Codex window. The chat system is supposed to be doing this automatically and the terminal drawer should show it live.

## The Real Issue

The terminal drawer in Chat.tsx currently uses `convId={null}` which means it reads from the **device-level** session key (`relay-session-${deviceId}`). But the actual chat session for that conversation might be stored under a conversation-scoped key.

More critically: the `EmbeddedTerminal` component connects via its **own WebSocket** to the relay. It's showing the PTY output, but there's a disconnect:

1. `sendViaRelay` (in `usePersistentRelaySession`) uses its own short-lived WebSocket per command, writing stdin and reading stdout
2. `EmbeddedTerminal` uses a **separate** persistent WebSocket to the same PTY session
3. Both should show the same PTY output IF they're connected to the same `sessionId`

The core question is: **why isn't the terminal drawer showing the output?**

Looking at `mirrorSessionId` — it writes to both `localStorage` and `sessionStorage` with both the conv-scoped key AND the device-level key. So `convId={null}` in EmbeddedTerminal should pick up the same session.

BUT: `EmbeddedTerminal` reads from `getPersistedSessionId()` which reads from `localStorage` with the device key. When a new conversation starts or `codex\n` is sent, the session ID gets mirrored. However the EmbeddedTerminal **initializes once** and doesn't re-subscribe when the session ID changes — it only re-initializes when `convId` or `deviceId` props change.

## Root Cause

The terminal drawer's `EmbeddedTerminal` component initializes when `showTerminalDrawer` becomes `true`. At that point, it reads the persisted session ID and connects. But the problem is likely that:

1. The EmbeddedTerminal connects to the PTY but `EmbeddedTerminal` uses its own `sessionStorage` key lookup, and the timing between "session created" and "terminal connected" might cause it to miss the session
2. The terminal is showing — the user sees "Connected" in the screenshot — but the Codex output from `sendViaRelay` isn't showing because `sendViaRelay` uses its own separate WS connection

The real fix: The terminal drawer needs to use the **same session ID** that the chat relay hook is using for the active conversation. The most reliable approach is to pass `convId={activeConvId}` instead of `null`, so both the relay hook and the terminal use the same session key lookup.

But wait — looking at the previous diff, `convId={null}` was set intentionally because "device-level key is mirrored on every command". The problem is that `EmbeddedTerminal` connects **once** at mount and stays connected. When `sendViaRelay` finishes a command, it **closes the WebSocket** (line: `if (ws.readyState === WebSocket.OPEN) ws.close()`). The terminal's separate persistent WS however stays open and receives stdout in real-time from the relay's broadcast.

So the terminal SHOULD be showing output... unless the terminal drawer's WS isn't connecting to the right session, or the relay isn't broadcasting stdout to multiple WS connections simultaneously.

## The Architectural Fix

The cleanest solution is:

**Pass `convId={activeConvId}` to the EmbeddedTerminal in the drawer** so it uses the exact same session key as the relay hook. Then ensure it re-connects when `activeConvId` changes.

The `mirrorSessionId` function already writes to the conversation-scoped key AND the device-level key. So passing `convId={activeConvId}` means the terminal looks up `relay-session-${deviceId}-${convId}` — exactly what the relay hook stores.

Additionally, the EmbeddedTerminal needs to reconnect whenever the session ID changes (e.g., when a new conversation is created and a new PTY session is started). Currently the terminal only re-initializes if the `convId` prop changes. Since `activeConvId` is passed as a prop and changes when switching conversations, this will naturally trigger re-initialization.

## Plan

**File to edit: `src/pages/Chat.tsx`**

1. Change `<EmbeddedTerminal deviceId={selectedDeviceId} convId={null} />` to `<EmbeddedTerminal deviceId={selectedDeviceId} convId={activeConvId} />` in the terminal drawer

This ensures:
- The terminal drawer connects to `relay-session-${deviceId}-${convId}` — the exact same session key the relay hook populates
- When the user switches conversations, the terminal automatically reconnects to that conversation's PTY session
- When a new message is sent, `mirrorSessionId` updates this key, and the EmbeddedTerminal (which is already connected and listening) sees the output in real-time

**File to check: `src/components/EmbeddedTerminal.tsx`** — verify that `convId` changes trigger a proper reconnect (re-run the useEffect initialization).

This is a minimal, targeted fix.
