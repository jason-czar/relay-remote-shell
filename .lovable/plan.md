
## Plan: Fix macOS Gatekeeper quarantine removal — use $BINARY_PATH instead of $FULL_BINARY

### Root cause recap
After downloading, macOS attaches `com.apple.quarantine` to the file at `$BINARY_PATH`. The quarantine flag is a filesystem attribute on that specific path. Using `$FULL_BINARY` (a runtime-resolved alias computed later) is less safe — if path resolution has any edge case, the `xattr` call could silently target the wrong path. Using `$BINARY_PATH` directly (the exact path written by `curl`) is the safest approach.

### Single change — `supabase/functions/download-connector/index.ts`

**Location:** line 934, inside the `install=full` bash script, between `chmod +x "$BINARY_PATH"` and `"$FULL_BINARY" --install-agent`

**Before (lines 934–950):**
```bash
chmod +x "$BINARY_PATH"

# Resolve absolute path (POSIX-safe, no realpath dependency)
FULL_BINARY="$(cd "$(dirname "$BINARY_PATH")"; pwd)/$(basename "$BINARY_PATH")"

# Pair device (idempotent — skip if already paired)
...
  "$FULL_BINARY" --pair "$PAIR_CODE" --api "$API_URL" --name "$(hostname)"
...

# Register service (binary owns all platform-specific service logic)
echo "⚙️  Registering background service..."
"$FULL_BINARY" --install-agent
```

**After:**
```bash
chmod +x "$BINARY_PATH"

# Remove macOS Gatekeeper quarantine flag (prevents Killed: 9)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "🔓 Removing macOS quarantine..."
  xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true
fi

# Resolve absolute path (POSIX-safe, no realpath dependency)
FULL_BINARY="$(cd "$(dirname "$BINARY_PATH")"; pwd)/$(basename "$BINARY_PATH")"

# Pair device ...
...

# Register service
"$FULL_BINARY" --install-agent
```

### Why $BINARY_PATH and not $FULL_BINARY
- `$BINARY_PATH` = `$HOME/relay-connector/relay-connector` — set on line 921, this is the exact path `curl` wrote the file to. The quarantine attribute lives on this inode.
- `$FULL_BINARY` is computed later (line 937) via a subshell `cd`. If anything in that subshell fails, `xattr` would use an empty string and silently do nothing.
- Removing the attribute from `$BINARY_PATH` before resolving `$FULL_BINARY` is the safest execution order.

### What this fixes
- `curl ... | bash -s -- PAIRCODE` now succeeds end-to-end on macOS without `Killed: 9`
- No user action required (no manual `xattr -d ...`)
- Linux and Windows are completely unaffected (`[[ "$(uname)" == "Darwin" ]]` is false)
- `2>/dev/null || true` makes it idempotent — safe on reinstall

### Scope
- One file: `supabase/functions/download-connector/index.ts`
- ~5 lines inserted inside the bash string literal
- No database, no UI, no Go code changes
