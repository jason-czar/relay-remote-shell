
## Context

The user shared a ChatGPT architectural recommendation suggesting we add `--install-agent`, `--uninstall-agent`, and `--status` flags to the Go binary so it can self-manage its own OS service registration (launchctl/systemd/scheduled task), rather than relying on the Bash/PowerShell installer scripts to do that work.

### Current State

The installer (`download-connector?install=full` / `install=ps-full`) is already production-grade:
- macOS: writes `com.privaclaw.connector.plist` → `launchctl bootstrap`, `enable`, `kickstart`
- Linux: writes `~/.config/systemd/user/privaclaw-connector.service` → `systemctl --user enable/start`, `loginctl enable-linger`
- Windows: registers a Scheduled Task via PowerShell
- Pairing is idempotent (skips if config exists)

The binary (`connector/main.go`) currently only has: `--pair`, `--name`, `--api`, `--config`, `--shell`, `--workdir`.

### What the Plan Adds

**Three new subcommands in `connector/main.go`:**

1. **`--install-agent`** — writes the service file for the current platform and boots it, using the binary's own path (`os.Executable()`). This is what `connector/main.go` receives as `--install-agent` flag.
2. **`--uninstall-agent`** — stops and removes the service.
3. **`--status`** — prints whether the service is installed and running.

**Update the install scripts in `download-connector/index.ts`:**
- Replace the large inline plist/systemd/scheduled-task blocks in the Bash and PowerShell scripts with a single call: `"$FULL_BINARY" --install-agent`
- The scripts shrink dramatically; service management logic moves into the binary where it can evolve independently.

### Files to Change

1. **`connector/main.go`** — Add `--install-agent`, `--uninstall-agent`, `--status` flag handling. Add platform dispatch functions: `installAgent()`, `uninstallAgent()`, `agentStatus()` that branch on `runtime.GOOS`.
   - macOS: write plist + `launchctl bootstrap/enable/kickstart`
   - Linux: write systemd unit + `systemctl enable/start` + `loginctl enable-linger`
   - Windows: `schtasks` or `sc` calls via `os/exec`

2. **`supabase/functions/download-connector/index.ts`** — Slim down the `install=full` and `install=ps-full` script branches: remove the inline service registration blocks and replace with `"$FULL_BINARY" --install-agent` (Bash) / `& $destBin --install-agent` (PowerShell).

### Scope Note

The UI (SetupWizard, DevicePanel, QuickStart) does NOT need to change — they continue to call `curl ... | bash -s -- PAIR_CODE`, which internally calls `--install-agent`. The user experience is identical.

### Why This Is the Right Move

| Capability | Current (installer-owned) | After (binary-owned) |
|---|---|---|
| Self-update without reinstall | ❌ | ✅ (can update binary, then `--install-agent` re-registers) |
| Uninstall cleanly | ❌ | ✅ `--uninstall-agent` |
| Health/status check | ❌ | ✅ `--status` |
| Service repair | ❌ | ✅ re-run `--install-agent` |
| Installer complexity | High | Low |

### Implementation Details

**`connector/main.go` additions (new flags at top of `main()`):**
```go
installAgent   := flag.Bool("install-agent",   false, "Register binary as a background service and start it")
uninstallAgent := flag.Bool("uninstall-agent", false, "Stop and remove the background service")
statusAgent    := flag.Bool("status",          false, "Print service status")
```

Platform detection uses `runtime.GOOS`. The binary resolves its own absolute path via `os.Executable()`.

**`install=full` bash script after change** (simplified):
```bash
# ... download, pair (same as before) ...

# Register service (now one line instead of 60)
"$FULL_BINARY" --install-agent

echo "✅ PrivaClaw installed and running!"
```

**`install=ps-full` PowerShell after change:**
```powershell
# ... download, pair (same as before) ...
& $destBin --install-agent
```

This is a pure Go connector file + edge function change. No database migrations, no UI changes, no new packages required.
