
## Root Cause Analysis

### ChatGPT's diagnosis is WRONG for this architecture

ChatGPT assumed the connector allocates PTY from the *host terminal* (like `ssh` does). That's incorrect. The Go connector uses `github.com/creack/pty` — `pty.StartWithSize()` — which creates a **kernel-level pseudo-terminal** entirely in userspace. It does NOT need the LaunchAgent to have a host `/dev/tty` attached. PTY allocation works fine from a background daemon.

### The real bug: `connect` is an unknown command

Look at the plist template in `download-connector/index.ts` (line 201):
```xml
<array><string>{{.Exe}}</string><string>connect</string></array>
```

But in `main.go`, `flag.Parse()` is called and there is **no `connect` subcommand**. The program only handles `--pair`, `--install-agent`, `--uninstall-agent`, `--status`, `--update`, `--self-update-check` flags. 

When the LaunchAgent runs `relay-connector connect`, Go's `flag` package treats `connect` as a **positional argument** — it's passed to `flag.Args()` and silently ignored. The binary then tries to load `~/.relay-connector.json` and run... which should actually work.

Wait — let me re-examine. Actually `flag.Parse()` + no subcommand handling means `connect` IS silently ignored and execution falls through to the connect logic. So this isn't the issue either.

### The actual issue: `$SHELL` environment variable is missing in LaunchAgent context

When macOS LaunchAgent launches a process, it runs with a **minimal environment** — specifically, `$SHELL` is often **not set** in the LaunchAgent environment. 

In `main.go`:
```go
shell := flag.String("shell", defaultShell(), "Shell to spawn")
```

And `defaultShell()`:
```go
func defaultShell() string {
    if s := os.Getenv("SHELL"); s != "" {
        return s
    }
    return "/bin/sh"
}
```

When run via LaunchAgent, `$SHELL` is typically empty, so the connector falls back to `/bin/sh`. On macOS, `/bin/sh` is `dash`, which uses the `-i` strategy (just `-i`, no login). This means:
- No `.zshrc` / `.bash_profile` sourced → `$PATH` is minimal
- No user environment → tools like `codex`, `node`, `python` not found

But more importantly: the shell used when you manually run `relay-connector connect` is **your interactive zsh** (set in `$SHELL`), while the LaunchAgent uses `/bin/sh`.

### The fix

The plist needs to explicitly pass `--shell` with the user's shell path. We need to capture `$SHELL` at install time (when `--install-agent` runs) and bake it into the plist template as `<string>--shell</string><string>/bin/zsh</string>`.

Additionally, the LaunchAgent environment needs `HOME` and `PATH` set via `EnvironmentVariables` to ensure the user's tools are accessible.

### Changes needed

**1. `connector/main.go` — plistTemplate: add `--shell` and `EnvironmentVariables`**

The `installAgentDarwin` function captures the resolved exe path. We need to also capture the shell path and home directory and pass them into the template.

Change `plistTemplate` to:
```xml
<key>ProgramArguments</key>
<array>
  <string>{{.Exe}}</string>
  <string>--shell</string>
  <string>{{.Shell}}</string>
</array>
<key>EnvironmentVariables</key>
<dict>
  <key>HOME</key><string>{{.Home}}</string>
  <key>SHELL</key><string>{{.Shell}}</string>
  <key>PATH</key><string>{{.Path}}</string>
</dict>
```

Where `{{.Shell}}` = `os.Getenv("SHELL")` (or `/bin/zsh` on macOS fallback), `{{.Home}}` = `os.UserHomeDir()`, `{{.Path}}` = `os.Getenv("PATH")`.

**2. `supabase/functions/download-connector/index.ts` — MAIN_GO: same change in the embedded `plistTmpl`**

The edge function embeds the full Go source. The `plistTmpl` constant in `MAIN_GO` (line ~195 in the file) needs the same fix so newly downloaded binaries have the correct behavior.

**3. Bump `SOURCE_VERSION`** to force a new binary build so users who run `--update` get the fix.

### Summary of changes

| File | Change |
|---|---|
| `connector/main.go` | Update `plistTemplate`: add `--shell {{.Shell}}`, `EnvironmentVariables` block with HOME/SHELL/PATH; update `installAgentDarwin` to pass Shell/Home/Path to template data |
| `supabase/functions/download-connector/index.ts` | Same fix to `plistTmpl` inside `MAIN_GO` constant; bump `SOURCE_VERSION` |

This is the minimal, correct fix. No `/dev/tty` hackery needed — that would actually break things since macOS LaunchAgents can't safely reference `/dev/tty`.
