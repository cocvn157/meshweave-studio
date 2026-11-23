# DevPost Submission Guide — MeshWeave Studio (Open Agentic Web Challenge Entry #3)

## 1. Copy-Paste DevPost Fields

- **Project Name:** `MeshWeave Studio`
- **Elevator Pitch / Tagline (<=200 chars):**
  `Cross-site workflow DAG composer, live ActionBridgeClient MessageChannel runner, partner contract & interop prober, and composable .network.json generator for the Open Agentic Web (MVP 0.3).`
- **Built With:** `javascript`, `es-modules`, `messagechannel`, `action-bridge`, `web-crypto`, `svg-dag`, `open-agentic-web`, `neuro-san-hocon`, `github-pages`
- **Try It Out / Live URL:** `https://cocvn157.github.io/meshweave-studio/`
- **GitHub Repository URL:** `https://github.com/cocvn157/meshweave-studio`
- **Published Agent Manifest:** `https://cocvn157.github.io/meshweave-studio/agent-manifest.json`
- **Published Network Definition:** `https://cocvn157.github.io/meshweave-studio/meshweave_composer.network.json`
- **Action Bridge:** `https://cocvn157.github.io/meshweave-studio/bridge/action-bridge.html`

### Inspiration
As more Open Agentic Websites go live under MVP Profile 0.3 (`Shutdown Clerk`, `Plainly`, `Agent Customs`, `Agent Atlas`, `Three Numbers`, `NandaSeal`, `ScopeGate Studio`), composing *multi-hop workflows across independent origins* exposes real friction: do partner bridges actually load in hidden iframes without `X-Frame-Options` blocks, do they speak Cognizant's `nsdeploy-actions-v1` `MessageChannel` protocol, do their `actions.module` catalogs expose cross-site reads, and do upstream outputs match downstream `inputSchema` contracts? **MeshWeave Studio** turns multi-site composition, live bridge contract probing, and `.network.json` compilation into a visual, `$0`-API-key browser workbench.

### What it does
1. **Visual Multi-Hop Workflow DAG Composer, Reorder/Toggle Builder & Live `MessageChannel` Waterfall Tracer:**
   - Visually wire, reorder (`← Earlier` / `Later →`), and toggle (`ON`/`OFF`) acyclic multi-hop workflows across multiple Open Agentic Websites (`ScopeGate Studio` ↔ `NandaSeal Trust Studio` ↔ `MeshWeave Studio`, or any custom `https://...` partner URL) with JSON-path edge bindings (`$.origin -> siteUrl`, `$.siteUrl -> hops[1].partnerUrl`).
   - Executes real cross-origin hidden-iframe `ActionBridgeClient` / `MessageChannel` RPCs directly in the browser with `$0` API keys across 3 instant sample pipelines, displaying a **Live MessageChannel Waterfall Tracer** with per-hop handshake + execution latency bars (ms), wire schema validation, and `sly_data` boundary secret stripping per hop.
   - Includes a **Strict `MessageChannel` Only** toggle vs **Interop Adapter** mode that validates `nsdeploy-actions-v1` fail-closed.
2. **Live Bridge Contract & Ecosystem Interop Matrix Prober:**
   - Audits any site's `agent-manifest.json` (`Access-Control-Allow-Origin`), `.network.json` graph & `sly_data` boundaries, `links.json`, `agent-mcp.json`, and `bridge/action-bridge.html` framing/module contracts.
   - Benchmarks all 9 live Open Agentic Web ecosystem sites side-by-side over real hidden iframes, reporting exact round-trip latency (ms), exposed catalog action counts, hosted MCP tools, and clear non-blocking diagnostics.
3. **1-Click Composable Unified Bundle, ECDSA P-256 Signed Trace, Self-Audit & Rogue-Frame Security Drill:**
   - Compiles the visual DAG into valid MVP Profile 0.3 `<network>.network.json` (both direct peer URLs and symbolic `link_slots` + `links.json`), `agent-manifest.json`, an **ECDSA P-256 + SHA-256 signed `meshweave-trace.json`**, and a **1-click Unified Bundle (`.json`)**.
   - Includes a live **Protocol Self-Audit** and interactive **"Simulate Rogue Frame / Untrusted Origin"** security drill proving fail-closed `ActionBridge` rejection against spoofed origins, `"null"`-origin sandbox iframes, iframe write escalations, and replay `requestId` attacks.

### How we built it
Built with zero runtime or build dependencies in pure modular ES JavaScript, HTML5/CSS3, SVG edge layout, browser `MessageChannel` + Cognizant's unmodified Apache-2.0 `runtime/` (`ActionBridgeClient`, `ActionRegistry`, `web-crypto`), and Node's built-in `node --test` runner. Verified with automated unit/contract tests, headless Edge `1280×720` E2E live multi-origin execution, and Cognizant's `check_partner.mjs` (`0` errors, `0` warnings).

---

## 2. < 3 Minute Demo Video Script (YouTube Unlisted/Public)

1. **0:00 – 0:30 | Intro & Live Self-Bridge Verification:**
   - Open `https://cocvn157.github.io/meshweave-studio/`.
   - Point out the green **Self-Bridge Ready · nsdeploy-actions-v1 (3 actions)** pill in the header and the visual 3-hop DAG preloaded in **Tab 1: Workflow DAG Composer** (`ScopeGate Studio` → `NandaSeal Trust Studio` → `MeshWeave Studio`) with green `MATCH` schema-binding badges on the edges.
2. **0:30 – 1:15 | Live 3-Origin Cross-Site Bridge Execution (`$0` API Keys):**
   - Click **▶ Run Live DAG**.
   - Show Hop 1 (`ScopeGate` `evaluate_egress_policy`) returning `ALLOW` + `origin: "https://shutdown-clerk.pages.dev"`, flowing automatically across the edge mapping (`$.origin -> siteUrl`) into Hop 2 (`NandaSeal` `inspect_remote_site` over `MessageChannel`), and flowing into Hop 3 (`MeshWeave` `compose_mesh_contract` over `MessageChannel`) producing a SHA-256 contract digest!
   - Toggle **Strict MessageChannel Only** and re-run briefly (optional) to demonstrate how MeshWeave flags `nsdeploy-action-bridge/v1` vs standard `nsdeploy-actions-v1` fail-closed.
3. **1:15 – 2:00 | Live Ecosystem Interop Matrix Prober (`Tab 2`):**
   - Switch to **2. Bridge Contract & Interop Matrix** and click **Probe Full Ecosystem Matrix (9 Sites)**.
   - Show the live comparison table across all 9 Open Agentic Web websites (`MeshWeave`, `NandaSeal`, `ScopeGate`, `Shutdown Clerk`, `Plainly`, `Agent Customs`, `Agent Atlas`, `Three Numbers`, `WorldwideAgenticWeb.org`), highlighting live `MessageChannel` catalogs vs empty local-only bridges vs hosted MCP vs missing CORS headers.
4. **2:00 – 2:45 | Composable `.network.json` & Trace Export (`Tab 3`):**
   - Switch to **3. Composable Manifest & Trace Export**.
   - Toggle **Symbolic link_slots + links.json** and **Downstream sly_data**, showing live regeneration of `<network>.network.json`, `agent-manifest.json` (`allowed_peers`), `links.json`, and `meshweave-trace.json` with canonical `traceSha256` and `Valid MVP 0.3 Bundle (0 errors, 0 warnings)`.

---

## 3. Ready-to-Submit Upstream Registry Row (`cognizant-ai-labs/agentic-web`)

Wait until your YouTube demo video is uploaded and DevPost submission is finalized before opening the PR to `cognizant-ai-labs/agentic-web` (`docs/agentic_websites.md`). Exact table row to append:

```markdown
|https://cocvn157.github.io/meshweave-studio/|MeshWeave Studio| Cross-site Open Agentic Web workflow DAG composer, live ActionBridgeClient MessageChannel runner, partner bridge contract & interop matrix prober, and composable .network.json topology compiler (MVP Profile 0.3).| `@cocvn157` | [Link](https://cocvn157.github.io/meshweave-studio/meshweave_composer.network.json) |
```

## 4. Remaining Manual Submission Steps

1. Record `<3 min` demo video walking through `https://cocvn157.github.io/meshweave-studio/` following Section 2 above and upload to YouTube (Public or Unlisted).
2. Submit **MeshWeave Studio** on DevPost (`The Open Agentic Web Challenge`) using Section 1 fields + YouTube URL + `https://github.com/cocvn157/meshweave-studio` + `https://cocvn157.github.io/meshweave-studio/`.
3. Open PR to `cognizant-ai-labs/agentic-web` adding the Section 3 row to `docs/agentic_websites.md`.
