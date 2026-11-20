/**
 * MeshWeave Studio — Live Bridge Contract & Open Agentic Web Interop Prober
 * Pure, fetch-injectable module for Node.js 22+ tests and browser runtime.
 */

export const ECOSYSTEM_DIRECTORY = [
  {
    id: 'meshweave',
    brand: 'MeshWeave Studio (Self)',
    siteBase: '.',
    networkUrl: './meshweave_composer.network.json',
    partnerUrl: 'https://cocvn157.github.io/meshweave-studio/meshweave_composer',
    role: 'Workflow DAG Composer & Bridge Contract Prober',
  },
  {
    id: 'nanda-seal',
    brand: 'NandaSeal Trust Studio',
    siteBase: 'https://cocvn157.github.io/nanda-seal',
    networkUrl: 'https://cocvn157.github.io/nanda-seal/nanda_seal_verifier.network.json',
    partnerUrl: 'https://cocvn157.github.io/nanda-seal/nanda_seal_verifier',
    role: 'ECDSA P-256 AgentFacts & Tamper Lab',
  },
  {
    id: 'scopegate',
    brand: 'ScopeGate Studio',
    siteBase: 'https://cocvn157.github.io/scopegate-studio',
    networkUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker.network.json',
    partnerUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker',
    role: 'Egress Firewall, Web Worker Sandbox & sly_data Filter',
  },
  {
    id: 'shutdown-clerk',
    brand: 'Shutdown Clerk',
    siteBase: 'https://shutdown-clerk.pages.dev',
    networkUrl: 'https://shutdown-clerk.pages.dev/shutdown_clerk.network.json',
    partnerUrl: 'https://shutdown-clerk.pages.dev/shutdown_clerk',
    role: 'Public GitHub Deprecation & Breaking-Release Checker',
  },
  {
    id: 'plainly',
    brand: 'Plainly (Agentic)',
    siteBase: 'https://sainath998.github.io/plainly-agent',
    networkUrl: 'https://sainath998.github.io/plainly-agent/plainly_document_helper.network.json',
    partnerUrl: 'https://sainath998.github.io/plainly-agent/plainly_document_helper',
    role: 'Redacted Plain-Word Document Explainer',
  },
  {
    id: 'agent-customs',
    brand: 'Agent Customs',
    siteBase: 'https://montbaga.github.io/agent-customs',
    networkUrl: 'https://montbaga.github.io/agent-customs/agent_customs.network.json',
    partnerUrl: 'https://montbaga.github.io/agent-customs/agent_customs',
    role: 'Pre-Run Agent Instruction & Origin Safety Inspector',
  },
  {
    id: 'agent-atlas',
    brand: 'Agent Atlas',
    siteBase: 'https://agent-atlas-phi.vercel.app',
    networkUrl: 'https://agent-atlas-phi.vercel.app/agent_atlas.network.json',
    partnerUrl: 'https://agent-atlas-phi.vercel.app/agent_atlas',
    role: 'Agentic Web Directory + Hosted Read-Only MCP',
  },
  {
    id: 'three-numbers',
    brand: 'Three Numbers',
    siteBase: 'https://ledenti.github.io/trois-nombres',
    networkUrl: 'https://ledenti.github.io/trois-nombres/three_numbers.network.json',
    partnerUrl: 'https://ledenti.github.io/trois-nombres/three_numbers',
    role: 'XRPL Key Escrow Commitment Inspector',
  },
  {
    id: 'wwaw-home',
    brand: 'WorldwideAgenticWeb.org',
    siteBase: 'https://worldwideagenticweb.org/wp-content/plugins/wwaw-agent-widget/assets/worldwide_agentic_web_widget/v1.0.9',
    networkUrl: 'https://worldwideagenticweb.org/wp-content/plugins/wwaw-agent-widget/assets/worldwide_agentic_web_widget/v1.0.9/worldwide_agentic_web_widget.network.json',
    partnerUrl: 'https://worldwideagenticweb.org/wp-content/plugins/wwaw-agent-widget/assets/worldwide_agentic_web_widget/v1.0.9/worldwide_agentic_web_widget',
    role: 'Challenge Reference Guide Widget',
  },
];

function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

export function moduleScriptSources(html) {
  const sources = [];
  for (const tag of String(html || '').matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = `${tag[1]} `;
    if (!/\btype\s*=\s*["']?module["'\s]/i.test(attrs)) continue;
    const src = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    if (src) sources.push(src[1] || src[2] || src[3]);
  }
  return sources;
}

export function isFramingAllowedByCsp(cspHeader, callerOrigin, pageOrigin) {
  if (!cspHeader) return true;
  for (const policy of String(cspHeader).split(',')) {
    for (const directive of policy.split(';')) {
      const parts = directive.trim().split(/\s+/);
      if (parts[0].toLowerCase() !== 'frame-ancestors') continue;
      const sources = parts.slice(1).map((s) => s.toLowerCase());
      const caller = new URL(callerOrigin);
      const allowed = sources.some((src) => {
        if (src === '*') return true;
        if (src === "'self'") return callerOrigin === pageOrigin;
        if (src === 'https:') return caller.protocol === 'https:';
        if (src === 'http:') return caller.protocol === 'http:' || caller.protocol === 'https:';
        try {
          return new URL(src).origin === callerOrigin;
        } catch {
          return false;
        }
      });
      if (!allowed) return false;
      break;
    }
  }
  return true;
}

export function validateNetworkStructure(network) {
  const errors = [];
  const warnings = [];
  const externals = [];
  const mcps = [];
  const tools = Array.isArray(network?.tools) ? network.tools : [];
  if (!tools.length) {
    errors.push('Network has no tools[] array.');
    return { errors, warnings, externals, mcps, frontMan: null, agentCount: 0 };
  }
  const names = new Set();
  let frontMan = null;
  for (const item of tools) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) {
      errors.push('Network tool entry missing string name.');
      continue;
    }
    if (names.has(item.name)) errors.push(`Duplicate agent/tool name "${item.name}".`);
    names.add(item.name);
    if (!frontMan && typeof item.instructions === 'string' && !item.class && !item.toolbox) {
      frontMan = item.name;
    }
  }
  if (!frontMan) errors.push('No front-man agent with instructions found.');
  const linkSlots = new Set(Object.keys(network?.link_slots || {}));
  for (const item of tools) {
    for (const ref of item.tools || []) {
      if (ref && typeof ref === 'object' && typeof ref.url === 'string') {
        mcps.push(ref.url);
      } else if (typeof ref === 'string') {
        if (/^https?:\/\//i.test(ref) || ref.startsWith('/')) {
          if (/\/mcp(?:\/|$)/i.test(ref)) mcps.push(ref);
          else externals.push(ref);
        } else if (!names.has(ref) && !linkSlots.has(ref)) {
          errors.push(`Agent "${item.name}" references missing tool "${ref}".`);
        }
      }
    }
  }
  if (/\$\{[A-Z0-9_]+\}/.test(JSON.stringify(network))) {
    errors.push('Unresolved ${ENV} token in network definition.');
  }
  return {
    errors,
    warnings,
    externals,
    mcps,
    frontMan,
    linkSlots: [...linkSlots],
    agentCount: tools.filter((t) => typeof t.instructions === 'string').length,
  };
}

async function timedFetch(fetchImpl, url, origin) {
  const t0 = performance.now();
  try {
    const res = await fetchImpl(url, {
      mode: 'cors',
      credentials: 'omit',
      headers: typeof window === 'undefined' && origin ? { Origin: origin } : undefined,
    });
    const text = await res.text();
    const latencyMs = Math.round(performance.now() - t0);
    return {
      ok: res.ok,
      status: res.status,
      url,
      text,
      latencyMs,
      acao: res.headers?.get?.('access-control-allow-origin') ?? null,
      contentType: res.headers?.get?.('content-type') ?? '',
      xFrameOptions: res.headers?.get?.('x-frame-options') ?? null,
      csp: res.headers?.get?.('content-security-policy') ?? null,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      text: '',
      latencyMs: Math.round(performance.now() - t0),
      acao: null,
      contentType: '',
      xFrameOptions: null,
      csp: null,
      error: err?.message || String(err),
    };
  }
}

export function resolveBaseTarget(rawInput, locationHref = 'https://cocvn157.github.io/meshweave-studio/') {
  const raw = String(rawInput || '.').trim();
  const abs = raw === '.' || raw.startsWith('./') || raw.startsWith('/')
    ? new URL(raw === '.' ? './' : raw, locationHref).href
    : raw;
  const clean = abs.replace(/\/+$/, '');
  if (clean.endsWith('.network.json')) {
    const folder = clean.slice(0, clean.lastIndexOf('/'));
    const file = clean.slice(clean.lastIndexOf('/') + 1);
    return {
      input: rawInput,
      siteBase: folder,
      directNetworkUrl: clean,
      expectedNetworkName: file.replace(/\.network\.json$/, ''),
      origin: new URL(clean).origin,
      isPartnerNetworkUrl: false,
    };
  }
  const u = new URL(clean);
  const segs = u.pathname.split('/').filter(Boolean);
  return {
    input: rawInput,
    siteBase: clean,
    directNetworkUrl: null,
    expectedNetworkName: null,
    candidateFolder: segs.length > 0 ? clean.slice(0, clean.lastIndexOf('/')) : clean,
    candidateNetworkName: segs.length > 0 ? segs[segs.length - 1] : null,
    origin: u.origin,
    isPartnerNetworkUrl: false,
  };
}

/**
 * Probe all public MVP Profile 0.3 contract artifacts for a site or partner network URL.
 */
export async function probeSiteArtifacts(
  rawInput,
  {
    fetchImpl = globalThis.fetch,
    callerOrigin = typeof location !== 'undefined' ? location.origin : 'https://worldwideagenticweb.org',
    locationHref = typeof location !== 'undefined' ? location.href : 'https://cocvn157.github.io/meshweave-studio/',
  } = {},
) {
  const target = resolveBaseTarget(rawInput, locationHref);
  const checks = [];
  let siteBase = target.siteBase;
  let expectedNetworkName = target.expectedNetworkName;

  // Try manifest at siteBase first; if 404 and looks like <folder>/<networkName>, fallback to candidateFolder
  let manifestFetch = await timedFetch(fetchImpl, `${siteBase}/agent-manifest.json`, callerOrigin);
  if (!manifestFetch.ok && manifestFetch.status === 404 && target.candidateFolder && target.candidateFolder !== siteBase) {
    const altFetch = await timedFetch(fetchImpl, `${target.candidateFolder}/agent-manifest.json`, callerOrigin);
    if (altFetch.ok) {
      manifestFetch = altFetch;
      siteBase = target.candidateFolder;
      expectedNetworkName = target.candidateNetworkName;
    }
  }

  const origin = new URL(siteBase).origin;
  const isHttps = origin.startsWith('https://') || isLoopbackHost(new URL(origin).hostname);
  checks.push({
    id: 'https',
    label: 'HTTPS / Loopback Transport',
    status: isHttps ? 'PASS' : 'FAIL',
    detail: isHttps ? origin : `Insecure origin ${origin}`,
  });

  let manifest = null;
  if (manifestFetch.ok) {
    try {
      manifest = JSON.parse(manifestFetch.text);
      const corsOk =
        origin === callerOrigin ||
        manifestFetch.acao === '*' ||
        manifestFetch.acao === callerOrigin ||
        (typeof window !== 'undefined' && manifestFetch.error === null);
      checks.push({
        id: 'manifest',
        label: 'agent-manifest.json & CORS',
        status: corsOk ? 'PASS' : 'FAIL',
        latencyMs: manifestFetch.latencyMs,
        detail: corsOk
          ? `HTTP 200 (${manifestFetch.latencyMs}ms)${manifestFetch.acao ? ` · ACAO: ${manifestFetch.acao}` : ''}`
          : `Missing or mismatched Access-Control-Allow-Origin (${manifestFetch.acao})`,
      });
    } catch (e) {
      checks.push({
        id: 'manifest',
        label: 'agent-manifest.json & CORS',
        status: 'FAIL',
        latencyMs: manifestFetch.latencyMs,
        detail: `Invalid JSON: ${e.message}`,
      });
    }
  } else {
    checks.push({
      id: 'manifest',
      label: 'agent-manifest.json & CORS',
      status: 'FAIL',
      latencyMs: manifestFetch.latencyMs,
      detail: manifestFetch.error
        ? `Fetch/CORS blocked: ${manifestFetch.error}`
        : `HTTP ${manifestFetch.status}`,
    });
  }

  const netEntry = expectedNetworkName
    ? (manifest?.networks || []).find((n) => n.name === expectedNetworkName) || manifest?.networks?.[0]
    : manifest?.networks?.[0];
  const networkName = expectedNetworkName || netEntry?.name || 'unknown';
  const networkUrl = target.directNetworkUrl
    || (netEntry?.hocon ? new URL(netEntry.hocon, `${siteBase}/`).href : `${siteBase}/${networkName}.network.json`);

  // Probe .network.json
  let network = null;
  let networkValidation = null;
  const netFetch = await timedFetch(fetchImpl, networkUrl, callerOrigin);
  if (netFetch.ok) {
    try {
      network = JSON.parse(netFetch.text);
      networkValidation = validateNetworkStructure(network);
      checks.push({
        id: 'network',
        label: '.network.json Graph & Schema',
        status: networkValidation.errors.length === 0 ? 'PASS' : 'FAIL',
        latencyMs: netFetch.latencyMs,
        detail:
          networkValidation.errors.length === 0
            ? `Valid (${networkValidation.agentCount} agents, front: ${networkValidation.frontMan}, ${netFetch.latencyMs}ms)`
            : networkValidation.errors.join(' | '),
      });
    } catch (e) {
      checks.push({
        id: 'network',
        label: '.network.json Graph & Schema',
        status: 'FAIL',
        latencyMs: netFetch.latencyMs,
        detail: `Parse error: ${e.message}`,
      });
    }
  } else {
    checks.push({
      id: 'network',
      label: '.network.json Graph & Schema',
      status: 'FAIL',
      latencyMs: netFetch.latencyMs,
      detail: netFetch.error ? `Fetch/CORS error: ${netFetch.error}` : `HTTP ${netFetch.status}`,
    });
  }

  // Probe links.json
  const linksFetch = await timedFetch(fetchImpl, `${siteBase}/links.json`, callerOrigin);
  let linksCount = 0;
  if (linksFetch.ok) {
    try {
      const linksDoc = JSON.parse(linksFetch.text);
      const netLinks = linksDoc?.networks?.[networkName] || {};
      linksCount = Object.keys(netLinks).length;
      checks.push({
        id: 'links',
        label: 'links.json Peer Bindings',
        status: 'PASS',
        latencyMs: linksFetch.latencyMs,
        detail: `HTTP 200 (${linksCount} bound link(s), ${linksFetch.latencyMs}ms)`,
      });
    } catch (e) {
      checks.push({
        id: 'links',
        label: 'links.json Peer Bindings',
        status: 'WARN',
        latencyMs: linksFetch.latencyMs,
        detail: `Invalid links.json: ${e.message}`,
      });
    }
  } else {
    checks.push({
      id: 'links',
      label: 'links.json Peer Bindings',
      status: linksFetch.status === 404 ? 'WARN' : 'WARN',
      latencyMs: linksFetch.latencyMs,
      detail: linksFetch.error ? `Unreachable (${linksFetch.error})` : `HTTP ${linksFetch.status} (optional)`,
    });
  }

  // Probe agent-mcp.json
  const mcpFetch = await timedFetch(fetchImpl, `${siteBase}/agent-mcp.json`, callerOrigin);
  let mcpInfo = { available: false, url: null, tools: [] };
  if (mcpFetch.ok) {
    try {
      const mcpDoc = JSON.parse(mcpFetch.text);
      mcpInfo = {
        available: Boolean(mcpDoc.available),
        url: mcpDoc.url || null,
        tools: Array.isArray(mcpDoc.tools) ? mcpDoc.tools : [],
        protocol: mcpDoc.protocol || null,
      };
      checks.push({
        id: 'mcp',
        label: 'agent-mcp.json Capability',
        status: 'PASS',
        latencyMs: mcpFetch.latencyMs,
        detail: mcpInfo.available
          ? `Hosted MCP available (${mcpInfo.tools.length} tool(s) at ${mcpInfo.url})`
          : `Static bundle (available: false, ${mcpFetch.latencyMs}ms)`,
      });
    } catch (e) {
      checks.push({
        id: 'mcp',
        label: 'agent-mcp.json Capability',
        status: 'WARN',
        latencyMs: mcpFetch.latencyMs,
        detail: `Parse error: ${e.message}`,
      });
    }
  } else {
    checks.push({
      id: 'mcp',
      label: 'agent-mcp.json Capability',
      status: 'WARN',
      latencyMs: mcpFetch.latencyMs,
      detail: mcpFetch.error ? `Unreachable (${mcpFetch.error})` : `HTTP ${mcpFetch.status}`,
    });
  }

  // Probe bridge/action-bridge.html + bridge/agent-manifest.json + module
  const bridgeRef = manifest?.actions?.bridge || null;
  let bridgeUrl = null;
  let bridgeManifest = null;
  let bridgeDiagnostic = 'No actions.bridge declared in agent-manifest.json';
  let frameable = false;
  let hasBridgeModule = false;

  if (bridgeRef) {
    try {
      const candidateBridge = new URL(bridgeRef, `${siteBase}/`).href;
      if (new URL(candidateBridge).origin !== origin) {
        checks.push({
          id: 'bridge',
          label: 'action-bridge.html Contract',
          status: 'FAIL',
          detail: `actions.bridge "${bridgeRef}" is cross-origin (${new URL(candidateBridge).origin})`,
        });
        bridgeDiagnostic = 'Cross-origin actions.bridge rejected';
      } else {
        bridgeUrl = candidateBridge;
        const pageFetch = await timedFetch(fetchImpl, bridgeUrl, callerOrigin);
        if (!pageFetch.ok) {
          checks.push({
            id: 'bridge',
            label: 'action-bridge.html Contract',
            status: 'FAIL',
            latencyMs: pageFetch.latencyMs,
            detail: pageFetch.error ? `Bridge fetch error: ${pageFetch.error}` : `HTTP ${pageFetch.status}`,
          });
          bridgeDiagnostic = `Bridge HTTP ${pageFetch.status || 'ERR'}`;
        } else {
          const xfoBlocked = Boolean(pageFetch.xFrameOptions);
          const cspBlocked = !isFramingAllowedByCsp(pageFetch.csp, callerOrigin, origin);
          const scripts = moduleScriptSources(pageFetch.text);
          frameable = !xfoBlocked && !cspBlocked && scripts.length > 0;

          const bmUrl = new URL('./agent-manifest.json', bridgeUrl).href;
          const bmFetch = await timedFetch(fetchImpl, bmUrl, callerOrigin);
          if (bmFetch.ok) {
            try {
              bridgeManifest = JSON.parse(bmFetch.text);
            } catch {
              bridgeManifest = null;
            }
          }
          const modPath = bridgeManifest?.actions?.module || null;
          hasBridgeModule = Boolean(modPath);

          if (xfoBlocked || cspBlocked) {
            bridgeDiagnostic = xfoBlocked
              ? `Blocked by X-Frame-Options: ${pageFetch.xFrameOptions}`
              : 'Blocked by CSP frame-ancestors';
            checks.push({
              id: 'bridge',
              label: 'action-bridge.html Contract',
              status: 'FAIL',
              latencyMs: pageFetch.latencyMs,
              detail: bridgeDiagnostic,
            });
          } else if (!scripts.length) {
            bridgeDiagnostic = 'Bridge HTML loads zero <script type="module"> scripts';
            checks.push({
              id: 'bridge',
              label: 'action-bridge.html Contract',
              status: 'FAIL',
              latencyMs: pageFetch.latencyMs,
              detail: bridgeDiagnostic,
            });
          } else if (!hasBridgeModule) {
            bridgeDiagnostic = 'Bridge connects (v1), but bridge/agent-manifest.json omits actions.module (0 shared bridge tools)';
            checks.push({
              id: 'bridge',
              label: 'action-bridge.html Contract',
              status: 'WARN',
              latencyMs: pageFetch.latencyMs,
              detail: bridgeDiagnostic,
            });
          } else {
            const modUrl = new URL(modPath, bmUrl).href;
            const modFetch = await timedFetch(fetchImpl, modUrl, callerOrigin);
            const isJs = /javascript|ecmascript/i.test(modFetch.contentType);
            bridgeDiagnostic = modFetch.ok && isJs
              ? `Bridge ready · ${modPath} (${modFetch.latencyMs}ms)`
              : `Bridge module issue: HTTP ${modFetch.status} (${modFetch.contentType})`;
            checks.push({
              id: 'bridge',
              label: 'action-bridge.html Contract',
              status: modFetch.ok && isJs ? 'PASS' : 'FAIL',
              latencyMs: pageFetch.latencyMs + modFetch.latencyMs,
              detail: bridgeDiagnostic,
            });
          }
        }
      }
    } catch (e) {
      checks.push({
        id: 'bridge',
        label: 'action-bridge.html Contract',
        status: 'FAIL',
        detail: e.message,
      });
      bridgeDiagnostic = e.message;
    }
  } else {
    checks.push({
      id: 'bridge',
      label: 'action-bridge.html Contract',
      status: 'WARN',
      detail: 'No actions.bridge declared in agent-manifest.json',
    });
  }

  const totalLatencyMs = checks.reduce((s, c) => s + (c.latencyMs || 0), 0);
  const passCount = checks.filter((c) => c.status === 'PASS').length;
  const failCount = checks.filter((c) => c.status === 'FAIL').length;

  return {
    siteBase,
    origin,
    brand: manifest?.brand || networkName,
    networkName,
    frontMan: netEntry?.front_man || networkValidation?.frontMan || null,
    manifest,
    network,
    networkValidation,
    linksCount,
    mcpInfo,
    bridgeUrl,
    bridgeManifest,
    frameable,
    hasBridgeModule,
    bridgeDiagnostic,
    declaredAgentTools: manifest?.actions?.agentTools || [],
    allowedPeers: manifest?.allowed_peers || [],
    checks,
    passCount,
    failCount,
    totalLatencyMs,
  };
}
