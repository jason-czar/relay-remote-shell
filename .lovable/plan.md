
## Implementation: Live Preview Split Pane in Chat

### Single file change: `src/pages/Chat.tsx`

**1. Add imports (line 17 and nearby)**
- Add `Globe` to lucide imports (already present? — yes, imported in WebPanel; need to add to Chat.tsx line 17)
- Add `WebPanel` from `@/components/WebPanel`
- Add `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` from `@/components/ui/resizable`
- Add `Popover`, `PopoverContent`, `PopoverTrigger` from `@/components/ui/popover`
- Add `Input` from `@/components/ui/input`
- Add `Globe` to the lucide import on line 17

**2. Add state (after line 565, in state block)**
```typescript
const [showPreview, setShowPreview] = useState(false);
const [previewUrl, setPreviewUrl] = useState("");
const [previewInputPort, setPreviewInputPort] = useState("3000");
const [previewPopoverOpen, setPreviewPopoverOpen] = useState(false);
const [previewAutoDetecting, setPreviewAutoDetecting] = useState(false);
```

**3. Add `handleOpenPreview` helper (after line 1712, before `return`)**

Cross-platform detect chain (lsof → ss → netstat), uses `127.0.0.1` for compatibility, includes port validation guard from ChatGPT's feedback (bail if `finalPort` is empty or NaN):

```typescript
const handleOpenPreview = useCallback(async (port?: string) => {
  const targetPort = port ?? previewInputPort;
  setPreviewAutoDetecting(true);
  setPreviewPopoverOpen(false);
  try {
    const detectCmd = `(\n  command -v lsof >/dev/null && lsof -iTCP -sTCP:LISTEN -n -P\n) || (\n  command -v ss >/dev/null && ss -ltn\n) || (\n  netstat -ltn 2>/dev/null\n) | grep -oE ':(3000|5173|8080|4200|8000|8888|4000|3001)\\b' | head -1 | tr -d ':'\n`;
    const stdout = await sendViaRelay(detectCmd, false);
    const detected = stdout.replace(/\x1b\[[\d;]*[a-zA-Z]/g, "").trim();
    const finalPort = detected || targetPort;
    if (!finalPort || isNaN(Number(finalPort))) {
      setPreviewAutoDetecting(false);
      return;
    }
    setPreviewUrl(`http://127.0.0.1:${finalPort}`);
    setPreviewInputPort(finalPort);
    setShowPreview(true);
  } catch {
    const finalPort = targetPort;
    if (!finalPort || isNaN(Number(finalPort))) { setPreviewAutoDetecting(false); return; }
    setPreviewUrl(`http://127.0.0.1:${finalPort}`);
    setShowPreview(true);
  } finally {
    setPreviewAutoDetecting(false);
  }
}, [previewInputPort, sendViaRelay]);
```

**4. Wrap outer layout (lines 1724–1730)**

Replace:
```tsx
<div className="flex h-full overflow-hidden">
  <div className={`flex flex-col flex-1 min-w-0 h-full relative ...`}
```

With:
```tsx
<div className="flex h-full overflow-hidden">
  <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0">
    <ResizablePanel defaultSize={showPreview ? 50 : 100} minSize={30}>
      <div className={`flex flex-col h-full relative ...`}
```

Close the existing chat div (before `</div>` that closes the outer flex div), then add:
```tsx
    </ResizablePanel>
    {showPreview && (
      <>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={25}>
          <WebPanel
            deviceId={selectedDeviceId}
            deviceName={devices.find(d => d.id === selectedDeviceId)?.name}
            initialUrl={previewUrl}
            onClose={() => { setShowPreview(false); setPreviewUrl(""); }}
          />
        </ResizablePanel>
      </>
    )}
  </ResizablePanelGroup>
</div>
```

Need to find exact closing div. The outer div at line 1724 closes at the very end of the return statement. The chat column div at 1726 also needs its closing `</div>` moved before the ResizablePanel closer.

**5. Add Preview button to header right section (after line 1823, before the device pill at line 1825)**

```tsx
{/* Preview button */}
{selectedDeviceId && (
  <Popover open={previewPopoverOpen} onOpenChange={setPreviewPopoverOpen}>
    <PopoverTrigger asChild>
      <button
        className={cn(
          "hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors",
          showPreview ? "bg-primary/10 text-primary" : "text-foreground/50 hover:text-foreground hover:bg-accent"
        )}
        title="Live preview"
      >
        {previewAutoDetecting
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Monitor className="h-3.5 w-3.5" />}
        <span>{showPreview ? `Preview · :${previewInputPort}` : "Preview"}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="bottom" align="end" className="w-64 p-3">
      <p className="text-xs font-medium mb-2">Open live preview</p>
      <div className="flex gap-2 mb-2">
        <Input
          className="h-8 text-sm"
          placeholder="Port (e.g. 3000)"
          value={previewInputPort}
          onChange={e => setPreviewInputPort(e.target.value.replace(/\D/g, ""))}
          onKeyDown={e => e.key === "Enter" && handleOpenPreview()}
        />
        <Button size="sm" className="h-8 shrink-0" onClick={() => handleOpenPreview()}>Open</Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {["3000","5173","8080","4200","8000"].map(p => (
          <button key={p} onClick={() => handleOpenPreview(p)}
            className="text-xs px-2 py-0.5 rounded-full border hover:bg-accent transition-colors">:{p}</button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">Auto-detects running dev server on your device.</p>
    </PopoverContent>
  </Popover>
)}
```

`Monitor` is already imported on line 17. `Loader2` is already imported on line 17. No new icons needed beyond `Globe` (already in WebPanel — needs adding to Chat.tsx only if used there, but we're using `Monitor` so it's fine).

### Summary of changes
- File: `src/pages/Chat.tsx` only
- No backend, no edge function, no database changes
- `ResizablePanelGroup` + `ResizablePanel` + `ResizableHandle` — already installed package
- `Popover` — already installed package
- `Input` — already in project
- `WebPanel` — already exists with full HTTP + WS proxy

### Key technical decisions
- `127.0.0.1` not `localhost` → better framework compatibility (Vite, Next, Astro)
- Port validation guard (`isNaN(Number(finalPort))`) → no blank preview panel
- Cross-platform detect: `lsof` (macOS) → `ss` (Linux) → `netstat` (fallback) 
- `sendViaRelay` already has auto-retry built in — detect command benefits automatically
- `defaultSize={showPreview ? 50 : 100}` on the left panel ensures 50/50 when preview opens but full-width otherwise (panel respects `defaultSize` on mount; toggling `showPreview` mounts/unmounts the right panel causing a re-render)
