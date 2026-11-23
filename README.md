# MeshWeave Studio

> **Cross-Site Open Agentic Web Workflow DAG Composer & Live Bridge Contract Prober (`MVP Profile 0.3`)**

Live App: `https://cocvn157.github.io/meshweave-studio/`
Published Network URL: `https://cocvn157.github.io/meshweave-studio/meshweave_composer`

## What Makes MeshWeave Studio Distinct

While existing Open Agentic Web entries focus on single-site analysis (`Shutdown Clerk`, `Plainly`, `Agent Customs`, `Three Numbers`), static search/directory checking (`Agent Atlas`), ECDSA `AgentFacts` signing (`NandaSeal`), or isolated Worker egress firewalls (`ScopeGate Studio`), **MeshWeave Studio** solves **cross-site multi-hop workflow orchestration and live bridge contract interoperability**:

1. **Visual Multi-Hop Workflow DAG Composer, Reorder/Toggle Builder & Live `MessageChannel` Waterfall Tracer:**
   - Visually compose, **reorder (`← Earlier` / `Later →`)**, and **toggle (`ON`/`OFF`)** acyclic cross-site workflows across Open Agentic Web partner websites (`ScopeGate Studio` <-> `NandaSeal Trust Studio` <-> `MeshWeave Studio`, or any custom `https://...` partner site).
   - Executes real cross-origin hidden-iframe `ActionBridgeClient` / `MessageChannel` (`nsdeploy-actions-v1`) calls in the browser with JSON-path edge field bindings (`$.origin -> siteUrl`, `$.siteUrl -> hops[1].partnerUrl`) and zero API keys required (`$0` BYOK).
   - Renders a live **MessageChannel Waterfall & `sly_data` Boundary Tracer** displaying per-hop handshake + execution latency bars (ms), wire schema validation (`MATCH` / `COERCIBLE` / `MISMATCH`), and destination-scoped `sly_data` secret stripping per hop.
   - Includes a **Strict `MessageChannel` Only** vs **Interop Adapter** mode that detects real wire-protocol divergences (`nsdeploy-actions-v1` vs `nsdeploy-action-bridge/v1`).

2. **Live Bridge Contract & Ecosystem Interop Matrix Prober:**
   - Validates `agent-manifest.json` (`Access-Control-Allow-Origin`), `.network.json` graph integrity, `links.json`, `agent-mcp.json`, and `bridge/action-bridge.html` framing/module contracts.
   - Connects live over hidden iframes to inspect each partner's exposed action catalog, `inputSchema` / `outputSchema` constraints, and round-trip latency (ms) with non-blocking error diagnostics.

3. **1-Click Composable Unified Bundle, ECDSA P-256 Signed Trace, Protocol Self-Audit & Rogue-Frame Security Drill:**
   - Deterministically compiles any visual DAG into valid MVP Profile 0.3 `*.network.json`, `agent-manifest.json` (deduplicated `allowed_peers`), `links.json` (`link_slots` or direct peer URLs), an **ECDSA P-256 + SHA-256 signed `meshweave-trace.json`**, and a **1-click Unified Bundle (`.json`)** export.
   - Runs an automated **MVP Profile 0.3 Protocol Self-Audit** plus an interactive **"Simulate Rogue Frame / Untrusted Origin"** security drill proving fail-closed `ActionBridge` rejection against rogue frames, opaque `"null"` sandbox iframes, write escalations, and replay `requestId` attacks.

## Local Development & Verification

```bash
npm test
```

## Architecture & Spec Artifacts

- `agent-manifest.json` & `meshweave_composer.network.json` — Open Agentic Web MVP Profile 0.3 site manifest & multi-agent orchestration network.
- `bridge/action-bridge.html`, `bridge/agent-manifest.json`, `bridge/bridge-actions.js` — Cross-site read-only bridge exporting `validate_edge_contract`, `compose_mesh_contract`, and `get_meshweave_capabilities`.
- `runtime/` — Unmodified Apache-2.0 Cognizant `agentify-website` browser runtime (`ActionBridgeClient`, `ActionRegistry`, `web-crypto`, form & discovered action helpers).
- `.well-known/nsdeploy.json`, `.well-known/nsdeploy-agent.json`, `agent-mcp.json`, `links.json`, `.nojekyll`.
