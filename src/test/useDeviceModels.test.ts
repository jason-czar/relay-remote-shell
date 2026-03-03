import { describe, expect, it } from "vitest";
import { parseModels } from "@/hooks/useDeviceModels";

describe("parseModels", () => {
  it("parses codex model list output", () => {
    const raw = `Available models\n\ngpt-5.3-codex   Latest Codex model\ngpt-5.2-codex   Previous Codex\n`;
    const models = parseModels("codex", raw);

    expect(models).toEqual([
      { id: "gpt-5.3-codex", label: "gpt-5.3-codex", description: "Latest Codex model" },
      { id: "gpt-5.2-codex", label: "gpt-5.2-codex", description: "Previous Codex" },
    ]);
  });

  it("parses claude JSON output", () => {
    const raw = JSON.stringify([
      { id: "claude-sonnet-4-5", description: "Balanced" },
      { id: "claude-opus-4-1", description: "Most capable" },
    ]);

    const models = parseModels("claude", raw);
    expect(models).toEqual([
      { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5", description: "Balanced" },
      { id: "claude-opus-4-1", label: "claude-opus-4-1", description: "Most capable" },
    ]);
  });

  it("returns empty array on unknown agent", () => {
    expect(parseModels("terminal", "whatever")).toEqual([]);
  });
});
