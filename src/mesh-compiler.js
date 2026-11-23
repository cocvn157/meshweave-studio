/**
 * MeshWeave Studio — Composable .network.json, agent-manifest.json, links.json & Trace Compiler
 * Zero DOM dependencies. Produces valid Open Agentic Web MVP Profile 0.3 artifacts.
 */

import { sha256Hex } from '../runtime/web-crypto.js';
import { validateDag, evaluateNodeInputs, safeClone } from './dag-engine.js';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(',')}}`;
}

export function sanitizeIdentifier(raw, fallback = 'composed_mesh_workflow') {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function extractOrigin(urlStr, fallbackOrigin = 'https://cocvn157.github.io') {
  if (!urlStr || String(urlStr).startsWith('.')) return fallbackOrigin;
  try {
    return new URL(String(urlStr)).origin;
  } catch {
    return fallbackOrigin;
  }
}

export function normalizePartnerNetworkUrl(node, selfBaseUrl = 'https://cocvn157.github.io/meshweave-studio') {
  if (node?.partnerNetworkUrl && /^https?:\/\//i.test(node.partnerNetworkUrl)) {
    return node.partnerNetworkUrl.replace(/\/+$/, '');
  }
  const base = String(node?.siteBase || selfBaseUrl).replace(/\/+$/, '');
  const resolvedBase = base === '.' ? selfBaseUrl : base;
  const net = node?.networkName || 'meshweave_composer';
  return `${resolvedBase}/${net}`;
}

/**
 * Compile a MeshWeave DAG into valid MVP Profile 0.3 deployment files.
 */
export function compileWorkflowBundle(dag, options = {}) {
  const allNodes = Array.isArray(dag?.nodes) ? dag.nodes : [];
  const nodes = allNodes.filter((n) => n.enabled !== false);
  const activeIds = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(dag?.edges) ? dag.edges : []).filter(
    (e) => activeIds.has(e.from) && activeIds.has(e.to),
  );
  const dagCheck = validateDag(nodes, edges);

  const networkName = sanitizeIdentifier(options.networkName || dag?.id || 'composed_mesh_workflow');
  const frontMan = sanitizeIdentifier(options.frontMan || 'mesh_coordinator');
  const brand = String(options.brand || dag?.name || 'MeshWeave Composed Workflow').trim();
  const maxSteps = Math.max(4, Math.min(30, Number(options.maxSteps) || 12));
  const bindingMode = options.bindingMode === 'link_slots' ? 'link_slots' : 'direct';
  const slyAllowlist = Array.isArray(options.slyAllowlist)
    ? options.slyAllowlist.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const selfOrigin = options.selfOrigin || 'https://cocvn157.github.io';
  const selfBaseUrl = options.selfBaseUrl || 'https://cocvn157.github.io/meshweave-studio';

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const orderedNodes = dagCheck.order.map((id) => nodeById.get(id)).filter(Boolean);
  const peersSeen = new Map();
  const allowedPeers = new Set();

  for (const node of orderedNodes) {
    const netUrl = normalizePartnerNetworkUrl(node, selfBaseUrl);
    const origin = extractOrigin(netUrl, selfOrigin);
    if (origin !== selfOrigin && !netUrl.startsWith(selfBaseUrl)) {
      allowedPeers.add(origin);
    } else if (node.siteBase && node.siteBase !== '.' && !node.siteBase.startsWith(selfBaseUrl)) {
      allowedPeers.add(origin);
    }
    if (!peersSeen.has(netUrl)) {
      peersSeen.set(netUrl, {
        netUrl,
        label: node.partnerLabel || node.networkName || netUrl,
        slotName: sanitizeIdentifier(`peer_${node.networkName || node.id}`),
        actions: [],
      });
    }
    peersSeen.get(netUrl).actions.push(`${node.id}:${node.actionName}`);
  }

  const peerRefs = [];
  const linkLabels = {};
  const linkSlots = {};
  const linksMap = {};

  for (const peer of peersSeen.values()) {
    if (bindingMode === 'link_slots') {
      peerRefs.push(peer.slotName);
      linkSlots[peer.slotName] = {
        description: `Bound peer slot for ${peer.label} (${peer.actions.join(', ')})`,
      };
      linksMap[peer.slotName] = peer.netUrl;
      linkLabels[peer.netUrl] = peer.label;
    } else {
      peerRefs.push(peer.netUrl);
      linkLabels[peer.netUrl] = peer.label;
    }
  }

  const hopSummary = orderedNodes.map((n, idx) => `${idx + 1}. ${n.partnerLabel || n.networkName}.${n.actionName}`).join(' -> ');
  const edgeSummary = edges.map((e) => {
    const maps = (e.mappings || []).map((m) => `${m.sourcePath}=>${m.targetArg}`).join(', ');
    return `${e.from}->${e.to}${maps ? ` (${maps})` : ''}`;
  });

  const networkJson = {
    aaosa_instructions:
      `Orchestrate the multi-hop Open Agentic Web workflow (${hopSummary || 'empty DAG'}). Preserve deny-by-default sly_data boundaries and never forward user router keys to peer sites.`,
    aaosa_call: {
      description: 'Execute or explain the composed cross-site workflow and return structured hop outputs.',
      parameters: {
        type: 'object',
        properties: {
          inquiry: { type: 'string', description: 'Workflow task or verification request' },
          mode: {
            type: 'string',
            description: "'Determine' relevance, 'Fulfill' execution, or 'Follow up' to inspect hop contracts.",
          },
        },
        required: ['inquiry', 'mode'],
      },
    },
    aaosa_command: '',
    metadata: {
      description: `MeshWeave compiled multi-hop workflow (${orderedNodes.length} hops, ${edges.length} edges).`,
      sample_queries: [
        `Execute the ${brand} multi-hop workflow across its linked partner bridges.`,
        'Inspect schema compatibility across every edge in this workflow.',
      ],
      meshweave_dag: {
        nodes: orderedNodes.map((n) => ({
          id: n.id,
          partner: n.partnerLabel || n.networkName,
          action: n.actionName,
          effect: n.effect || 'read',
        })),
        edges: edgeSummary,
      },
    },
    llm_config: {
      model_name: 'alibaba/qwen3.8-flash',
    },
    max_steps: maxSteps,
    max_execution_seconds: 300,
    instructions_prefix:
      'You execute a MeshWeave-compiled Open Agentic Web workflow. Report concrete partner outputs, schema check results, and exact origins contacted.',
    ...(Object.keys(linkSlots).length > 0 ? { link_slots: linkSlots } : {}),
    ...(Object.keys(linkLabels).length > 0 ? { link_labels: linkLabels } : {}),
    tools: [
      {
        name: frontMan,
        function: {
          description: `Front coordinator for ${brand}.`,
          parameters: {
            type: 'object',
            properties: {
              inquiry: { type: 'string', description: 'Workflow execution request' },
            },
            required: ['inquiry'],
          },
        },
        instructions: `Coordinate the compiled multi-hop DAG (${hopSummary || 'local planner'}). Delegate hop planning to dag_hop_router and return grounded outputs from each peer network.`,
        tools: ['dag_hop_router'],
        allow: {
          to_downstream: {
            sly_data: slyAllowlist,
          },
        },
      },
      {
        name: 'dag_hop_router',
        function: {
          description: 'Routes validated arguments across linked Open Agentic Web peer networks.',
          parameters: {
            type: 'object',
            properties: {
              inquiry: { type: 'string', description: 'Hop delegation payload' },
            },
            required: ['inquiry'],
          },
        },
        instructions: `Invoke linked partner networks in DAG order (${hopSummary || 'none'}). Strip unlisted sly_data fields and report any unavailable peer or bridge contract mismatch fail-closed.`,
        tools: peerRefs,
        allow: {
          to_downstream: {
            sly_data: slyAllowlist,
          },
        },
      },
    ],
  };

  const manifestJson = {
    brand,
    networks: [
      {
        name: networkName,
        front_man: frontMan,
        hocon: `./${networkName}.network.json`,
        description: `Compiled MeshWeave Studio workflow (${orderedNodes.length} hops across ${Math.max(1, allowedPeers.size)} peer origin(s)).`,
        tags: ['meshweave', 'composed-dag', 'open-agentic-web', 'mvp-0.3'],
        sample_queries: networkJson.metadata.sample_queries,
      },
    ],
    llm_router: {
      base_url: 'https://api.otari.ai/api/v1',
      mock: false,
      byok_router: 'https://api.otari.ai/api/v1',
    },
    allowed_peers: [...allowedPeers].sort(),
    peer_policy: {
      mode: 'allowlist',
      deny_origins: [],
      strip_unlisted_sly_data: slyAllowlist.length === 0,
      note: 'Generated by MeshWeave Studio. Peer calls remain bounded by explicit allowed_peers and caller origin checks.',
    },
    agent_mcp: {
      protocol: 'nsdeploy-agent-mcp/v1',
      network: networkName,
      front_man: frontMan,
      available: false,
      reason: 'Static Open Agentic Web bundle orchestrated in the browser.',
    },
    theme: { primary: '#38bdf8' },
    linking: {
      protocol: 'nsdeploy-link/v1',
      exports: [
        {
          network: networkName,
          front_man: frontMan,
          aliases: [networkName, frontMan],
          url: networkName,
        },
      ],
      imports: [...peersSeen.keys()],
      link_updates: { mode: 'browser-local' },
    },
    deployment: {
      mode: 'static',
      self_contained_runtime: true,
      browser_mock: true,
      direct_byok: true,
      direct_mcp_requires_cors: true,
      public_mcp_facade: false,
    },
    actions: {
      version: 1,
      module: './mesh-actions.js',
      bridge: './bridge/action-bridge.html',
      agentTools: [
        'validate_edge_contract',
        'compose_mesh_contract',
        'get_meshweave_capabilities',
      ],
    },
  };

  const linksJson = {
    version: 1,
    networks: {
      [networkName]: linksMap,
    },
  };

  const validation = validateCompiledBundle({ networkJson, manifestJson, dagCheck, nodes, edges });
  return {
    networkName,
    frontMan,
    bindingMode,
    networkJson,
    manifestJson,
    linksJson,
    validation,
  };
}

export function validateCompiledBundle({ networkJson, manifestJson, dagCheck, nodes = [], edges = [] }) {
  const errors = [];
  const warnings = [];
  if (dagCheck && !dagCheck.valid) {
    errors.push(...dagCheck.errors);
  }
  const rawNet = JSON.stringify(networkJson);
  if (/\$\{[A-Z0-9_]+\}/.test(rawNet)) {
    errors.push('Compiled .network.json contains unresolved ${ENV} placeholders.');
  }
  const tools = Array.isArray(networkJson?.tools) ? networkJson.tools : [];
  if (tools.length === 0) {
    errors.push('Compiled .network.json must define at least one agent in tools.');
  }
  const entry = manifestJson?.networks?.[0];
  if (!entry?.name || !entry?.front_man || !entry?.hocon) {
    errors.push('Compiled agent-manifest.json is missing networks[0] name, front_man, or hocon.');
  }
  if (!tools.some((t) => t.name === entry?.front_man && typeof t.instructions === 'string')) {
    errors.push(`Front agent "${entry?.front_man}" not found with instructions in .network.json.`);
  }
  if (manifestJson?.actions?.version !== 1 || !manifestJson?.actions?.bridge) {
    errors.push('agent-manifest.json actions.version must be 1 with actions.bridge.');
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    const incoming = edges.filter((e) => e.to === node.id);
    const check = evaluateNodeInputs(node, incoming, nodeById);
    if (!check.ready) {
      if (check.missingRequired.length) {
        warnings.push(`Hop "${node.id}" missing required input(s): ${check.missingRequired.join(', ')}.`);
      }
      for (const er of check.edgeReports) {
        if (!er.compatible) {
          errors.push(`Edge "${er.from} -> ${er.to}" has incompatible schema mapping.`);
        }
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

let cachedSigningKeyPairPromise = null;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function getTraceSigningKeys() {
  if (!globalThis.crypto?.subtle) return null;
  if (!cachedSigningKeyPairPromise) {
    cachedSigningKeyPairPromise = globalThis.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
  }
  return cachedSigningKeyPairPromise;
}

/**
 * Create a shareable execution trace with canonical SHA-256 digest and ECDSA P-256 signature.
 */
export async function buildShareableTrace({
  dag,
  runResults = [],
  compiledBundle,
  timestamp = new Date().toISOString(),
}) {
  const payload = {
    schema: 'meshweave/execution-trace/v1',
    mvpProfile: '0.3',
    generatedAt: timestamp,
    workflowId: dag?.id || 'custom_dag',
    workflowName: dag?.name || 'Custom Multi-Hop Workflow',
    nodeCount: Array.isArray(dag?.nodes) ? dag.nodes.length : 0,
    enabledNodeCount: Array.isArray(dag?.nodes)
      ? dag.nodes.filter((n) => n.enabled !== false).length
      : 0,
    edgeCount: Array.isArray(dag?.edges) ? dag.edges.length : 0,
    allowedPeers: compiledBundle?.manifestJson?.allowed_peers || [],
    hops: safeClone(runResults),
    summary: {
      passed: runResults.filter((r) => r.status === 'PASSED').length,
      failed: runResults.filter((r) => r.status === 'FAILED').length,
      disabled: runResults.filter((r) => r.status === 'DISABLED').length,
      liveBridgeHops: runResults.filter((r) => r.transport === 'MessageChannel').length,
      totalLatencyMs: runResults.reduce((sum, r) => sum + (Number(r.latencyMs) || 0), 0),
      strippedSlyKeysTotal: runResults.reduce(
        (sum, r) => sum + (r.slyAudit?.strippedKeys?.length || 0),
        0,
      ),
    },
  };
  const digest = await sha256Hex(canonicalJson(payload));
  let signature = null;
  const keys = await getTraceSigningKeys();
  if (keys) {
    const sigBuf = await globalThis.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      new TextEncoder().encode(digest),
    );
    const publicJwk = await globalThis.crypto.subtle.exportKey('jwk', keys.publicKey);
    signature = {
      algorithm: 'ECDSA-P256-SHA256',
      publicJwk,
      signatureHex: toHex(sigBuf),
    };
  }
  return {
    ...payload,
    traceSha256: digest,
    signature,
  };
}

/**
 * Independently verify a signed meshweave-trace.json artifact using its embedded ECDSA P-256 publicJwk.
 */
export async function verifyShareableTrace(trace) {
  if (!trace || typeof trace !== 'object' || !trace.traceSha256) {
    return { valid: false, reason: 'Missing trace payload or traceSha256.' };
  }
  const { traceSha256, signature, ...payload } = trace;
  const recomputed = await sha256Hex(canonicalJson(payload));
  if (recomputed !== traceSha256) {
    return {
      valid: false,
      reason: `SHA-256 mismatch: expected ${traceSha256.slice(0, 14)}…, computed ${recomputed.slice(0, 14)}…`,
    };
  }
  if (!signature?.publicJwk || !signature?.signatureHex) {
    return { valid: false, reason: 'Missing ECDSA P-256 signature block.' };
  }
  if (!globalThis.crypto?.subtle) {
    return { valid: false, reason: 'Web Crypto SubtleCrypto unavailable for ECDSA verification.' };
  }
  try {
    const pubKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      signature.publicJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      fromHex(signature.signatureHex),
      new TextEncoder().encode(traceSha256),
    );
    return ok
      ? {
          valid: true,
          reason: `Verified ECDSA P-256 signature + SHA-256 (${traceSha256.slice(0, 14)}…)`,
        }
      : { valid: false, reason: 'ECDSA P-256 signature verification failed.' };
  } catch (err) {
    return {
      valid: false,
      reason: `Signature verification error: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Build a unified 1-click exportable bundle combining .network.json, agent-manifest.json, links.json, and signed trace.
 */
export function compileUnifiedBundle({ compiledBundle, trace }) {
  return {
    schema: 'meshweave/unified-bundle/v1',
    mvpProfile: '0.3',
    exportedAt: trace?.generatedAt || new Date().toISOString(),
    networkName: compiledBundle?.networkName || 'composed_mesh_workflow',
    validation: compiledBundle?.validation || { ok: false, errors: [], warnings: [] },
    artifacts: {
      networkFileName: `${compiledBundle?.networkName || 'composed_mesh_workflow'}.network.json`,
      networkJson: compiledBundle?.networkJson || {},
      manifestJson: compiledBundle?.manifestJson || {},
      linksJson: compiledBundle?.linksJson || {},
      traceJson: trace || null,
    },
  };
}
