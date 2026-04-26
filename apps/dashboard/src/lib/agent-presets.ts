// Agent install presets for the dashboard "Connect Agent" guide page.
// ADR-0015: no token is generated. The user runs the install command;
// on first request the agent gets a 401 with WWW-Authenticate, runs the
// OAuth 2.1 + DCR + PKCE flow against Clerk, and stores the access
// token in the agent's own credential store.

export interface AgentPreset {
  id: string;
  name: string;
  // CLI one-liner for agents that have an `add` command.
  installCommand?: string;
  // Manual config snippet (path the user pastes into + JSON body) for any
  // agent without a one-line install or as a fallback.
  configFile: string;
  configSnippet: string;
  // Brief tip surfaced under the snippet (restart instructions, where the
  // browser flow opens, etc.). One sentence.
  postInstallNote: string;
}

// Phase 2 preset catalog. Adding a new agent = append a row here. The
// guide page renders one card per row in this order.
export function buildAgentPresets(mcpServerUrl: string): readonly AgentPreset[] {
  const url = mcpServerUrl;
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      installCommand: `claude mcp add --transport http remarks ${url}`,
      configFile: "~/.claude/mcp.json (global) or .claude/mcp.json (project)",
      configSnippet: JSON.stringify(
        {
          mcpServers: {
            remarks: { type: "http", url },
          },
        },
        null,
        2
      ),
      postInstallNote:
        "Run any Remarks tool (e.g. `remarks_whoami`) — your browser will open the Remarks login. Approve the requested scopes and return to Claude Code.",
    },
    {
      id: "cursor",
      name: "Cursor",
      configFile: ".cursor/mcp.json (project) or ~/.cursor/mcp.json (global)",
      configSnippet: JSON.stringify({ mcpServers: { remarks: { url } } }, null, 2),
      postInstallNote:
        "Restart Cursor. The first MCP call will open a browser window for OAuth login.",
    },
    {
      id: "windsurf",
      name: "Windsurf",
      configFile: "~/.codeium/windsurf/mcp_config.json",
      configSnippet: JSON.stringify({ mcpServers: { remarks: { serverUrl: url } } }, null, 2),
      postInstallNote:
        "Restart Windsurf, then call any Remarks tool. The browser will open at the Remarks login page; approve the scopes and you're connected.",
    },
    {
      id: "codex-cli",
      name: "Codex CLI",
      installCommand: `codex mcp add --transport http remarks ${url}`,
      configFile: "~/.codex/mcp.json",
      configSnippet: JSON.stringify({ mcpServers: { remarks: { url } } }, null, 2),
      postInstallNote: "First tool call opens the browser for OAuth.",
    },
    {
      id: "generic",
      name: "Other (generic MCP client)",
      configFile: "(consult your client's docs for the MCP servers config path)",
      configSnippet: JSON.stringify({ mcpServers: { remarks: { url } } }, null, 2),
      postInstallNote:
        "Any MCP client that supports streamable HTTP transport + OAuth 2.1 will work. The server publishes Protected Resource Metadata at `/.well-known/oauth-protected-resource/mcp`.",
    },
  ] as const;
}
