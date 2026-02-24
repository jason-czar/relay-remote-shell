import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  FastForward,
  Download,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface Frame {
  t: number; // ms since session start
  d: string; // base64 stdout data
}

interface Recording {
  id: string;
  session_id: string;
  frames: Frame[];
  frame_count: number;
  size_bytes: number;
  duration_ms: number;
}

export default function SessionPlayback() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);

  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);

  // Keep refs in sync
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Load recording
  useEffect(() => {
    if (!sessionId || !user) return;
    const load = async () => {
      const { data, error: err } = await supabase
        .from("session_recordings")
        .select("*")
        .eq("session_id", sessionId)
        .single();

      if (err || !data) {
        setError("Recording not found for this session.");
        setLoading(false);
        return;
      }

      setRecording(data as unknown as Recording);
      setLoading(false);
    };
    load();
  }, [sessionId, user]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || !recording) return;

    const isMobile = window.innerWidth < 640;
    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: isMobile ? 12 : 14,
      lineHeight: 1.4,
      theme: {
        background: "#080c14",
        foreground: "#c4d9c4",
        cursor: "#4ade80",
        selectionBackground: "#4ade8033",
        black: "#1a1e2e",
        red: "#ef4444",
        green: "#4ade80",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#f87171",
        brightGreen: "#86efac",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [recording]);

  // Render frames up to a specific time
  const renderUpTo = useCallback(
    (targetTime: number) => {
      if (!termRef.current || !recording) return;
      const term = termRef.current;
      term.reset();

      for (const frame of recording.frames) {
        if (frame.t > targetTime) break;
        const bytes = Uint8Array.from(atob(frame.d), (c) => c.charCodeAt(0));
        term.write(bytes);
      }

      // Find current frame index
      let idx = 0;
      for (let i = 0; i < recording.frames.length; i++) {
        if (recording.frames[i].t <= targetTime) idx = i;
        else break;
      }
      setCurrentFrame(idx);
      setCurrentTime(targetTime);
    },
    [recording]
  );

  // Playback engine
  const playFrom = useCallback(
    (fromFrame: number) => {
      if (!recording || !termRef.current) return;
      if (playTimerRef.current) clearTimeout(playTimerRef.current);

      const scheduleNext = (idx: number) => {
        if (!playingRef.current || idx >= recording.frames.length) {
          setPlaying(false);
          return;
        }

        const frame = recording.frames[idx];
        const bytes = Uint8Array.from(atob(frame.d), (c) => c.charCodeAt(0));
        termRef.current?.write(bytes);
        setCurrentFrame(idx);
        setCurrentTime(frame.t);

        if (idx + 1 < recording.frames.length) {
          const nextFrame = recording.frames[idx + 1];
          // Cap max delay to 2s to skip long idle periods
          const delay = Math.min((nextFrame.t - frame.t) / speedRef.current, 2000);
          playTimerRef.current = setTimeout(() => scheduleNext(idx + 1), delay);
        } else {
          setPlaying(false);
        }
      };

      scheduleNext(fromFrame);
    },
    [recording]
  );

  const handlePlay = () => {
    if (!recording) return;
    if (currentFrame >= recording.frames.length - 1) {
      // Restart from beginning
      renderUpTo(0);
      setPlaying(true);
      setTimeout(() => playFrom(0), 50);
    } else {
      setPlaying(true);
      playFrom(currentFrame + 1);
    }
  };

  const handlePause = () => {
    setPlaying(false);
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
  };

  const handleSeek = (values: number[]) => {
    handlePause();
    const targetTime = values[0];
    renderUpTo(targetTime);
  };

  const handleSkipBack = () => {
    handlePause();
    renderUpTo(Math.max(0, currentTime - 5000));
  };

  const handleSkipForward = () => {
    handlePause();
    if (recording) {
      renderUpTo(Math.min(recording.duration_ms, currentTime + 5000));
    }
  };

  const cycleSpeed = () => {
    const speeds = [0.5, 1, 2, 4, 8];
    const idx = speeds.indexOf(speed);
    setSpeed(speeds[(idx + 1) % speeds.length]);
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const handleDownloadCast = () => {
    if (!recording) return;

    // asciicast v2 format: https://docs.asciinema.org/manual/asciicast/v2/
    const header = JSON.stringify({
      version: 2,
      width: 120,
      height: 40,
      timestamp: Math.floor(Date.now() / 1000),
      title: `Session ${sessionId?.slice(0, 8)}`,
      env: { TERM: "xterm-256color" },
    });

    const events = recording.frames.map((frame) => {
      const seconds = frame.t / 1000;
      const text = atob(frame.d);
      return JSON.stringify([seconds, "o", text]);
    });

    const content = [header, ...events].join("\n") + "\n";
    const blob = new Blob([content], { type: "application/x-asciicast" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId?.slice(0, 8)}.cast`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-terminal-bg items-center justify-center">
        <p className="text-muted-foreground">Loading recording...</p>
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className="flex flex-col h-screen bg-terminal-bg items-center justify-center gap-4">
        <p className="text-muted-foreground">{error || "Recording not found"}</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-terminal-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              Session Playback
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              {sessionId?.slice(0, 8)} · {recording.frame_count} frames ·{" "}
              {Math.round(recording.size_bytes / 1024)}KB
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs shrink-0"
          onClick={handleDownloadCast}
          title="Download as .cast file"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">.cast</span>
        </Button>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 p-1" />

      {/* Playback controls */}
      <div className="border-t border-border bg-card px-3 sm:px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 max-w-3xl mx-auto">
          {/* Skip back */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSkipBack}
            title="Back 5s"
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          {/* Play/Pause */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={playing ? handlePause : handlePlay}
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>

          {/* Skip forward */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSkipForward}
            title="Forward 5s"
          >
            <SkipForward className="h-4 w-4" />
          </Button>

          {/* Time */}
          <span className="text-xs font-mono text-muted-foreground shrink-0 w-20 text-center">
            {formatTime(currentTime)} / {formatTime(recording.duration_ms)}
          </span>

          {/* Scrubber */}
          <div className="flex-1 min-w-0">
            <Slider
              value={[currentTime]}
              min={0}
              max={recording.duration_ms || 1}
              step={100}
              onValueChange={handleSeek}
              className="cursor-pointer"
            />
          </div>

          {/* Speed */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-mono gap-1 shrink-0"
            onClick={cycleSpeed}
            title="Playback speed"
          >
            <FastForward className="h-3 w-3" />
            {speed}×
          </Button>
        </div>
      </div>
    </div>
  );
}
