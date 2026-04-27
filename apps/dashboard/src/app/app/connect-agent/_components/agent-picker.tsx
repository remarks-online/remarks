"use client";

import { AgentPresetDetails } from "@/components/agent-preset-details";
import type { AgentPreset } from "@/lib/agent-presets";
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@remarks/ui";
import { useState } from "react";

export function AgentPicker({ presets }: { presets: readonly AgentPreset[] }) {
  const [selectedId, setSelectedId] = useState<string>(presets[0]?.id ?? "claude-code");
  const selected = presets.find((p) => p.id === selectedId) ?? presets[0];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="agent-picker">Agent</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger id="agent-picker" className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected ? <AgentPresetDetails preset={selected} /> : null}
    </div>
  );
}
