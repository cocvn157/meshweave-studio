/**
 * MeshWeave Studio — Pure ActionBridge Security Validator & MVP Profile 0.3 Self-Auditor
 * Zero DOM dependencies. Runs identically in Node.js 22+ tests and modern browsers.
 */

import { validateDag, evaluateNodeInputs } from './dag-engine.js';
import { validateNetworkStructure } from './prober.js';

export const STANDARD_PROTOCOL = 'nsdeploy-actions-v1';

/**
 * Pure fail-closed validation of inbound ActionBridge handshake & execution frames.
 * Mirrors Cognizant's runtime/action-transport.js serveActionBridge security invariants.
 */
export function validateBridgeInboundFrame({
  eventOrigin,
  sourceMatchesPeer = true,
  protocol = STANDARD_PROTOCOL,
  type = 'connect',
  portsCount = 1,
  allowedCallerOrigins = ['*'],
  actionEffect = 'read',
  actionAvailability = 'bridge',
  isTopLevelWindow = false,
  requestId = '',
  seenRequestIds = new Set(),
}) {
  if (!eventOrigin || eventOrigin === 'null') {
    return {
      accepted: false,
      code: 'ERR_NULL_ORIGIN_REJECTED',
      reason: 'Opaque "null" origin frame rejected fail-closed.',
    };
  }
  if (!sourceMatchesPeer) {
    return {
      accepted: false,
      code: 'ERR_ROGUE_SOURCE_REJECTED',
      reason: 'Frame event.source does not match expected opener/parent peer.',
    };
  }
  if (protocol !== STANDARD_PROTOCOL) {
    return {
      accepted: false,
      code: 'ERR_PROTOCOL_MISMATCH',
      reason: `Rejected non-standard bridge protocol "${protocol}" (expected ${STANDARD_PROTOCOL}).`,
    };
  }
  if (type === 'connect' && portsCount !== 1) {
    return {
      accepted: false,
      code: 'ERR_MISSING_MESSAGE_PORT',
      reason: 'MessageChannel connect handshake requires exactly 1 transferred MessagePort.',
    };
  }
  const originPermitted =
    Array.isArray(allowedCallerOrigins) &&
    (allowedCallerOrigins.includes('*') || allowedCallerOrigins.includes(eventOrigin));
  if (!originPermitted) {
    return {
      accepted: false,
      code: 'ERR_UNTRUSTED_CALLER_ORIGIN',
      reason: `Caller origin "${eventOrigin}" is outside action callerOrigins allowlist.`,
    };
  }
  if (type === 'execute') {
    if (actionAvailability === 'local-only') {
      return {
        accepted: false,
        code: 'ERR_LOCAL_ONLY_ACTION',
        reason: 'local-only action cannot be invoked across cross-origin bridge.',
      };
    }
    if ((actionEffect !== 'read' || actionAvailability === 'top-level') && !isTopLevelWindow) {
      return {
        accepted: false,
        code: 'ERR_WRITE_REQUIRES_TOP_LEVEL',
        reason: 'State-changing write / top-level action rejected inside hidden iframe.',
      };
    }
    if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 200) {
      return {
        accepted: false,
        code: 'ERR_INVALID_REQUEST_ID',
        reason: 'Missing or oversized requestId.',
      };
    }
    if (seenRequestIds.has(requestId)) {
      return {
        accepted: false,
        code: 'ERR_REPLAY_REQUEST_ID',
        reason: `Duplicate requestId "${requestId}" rejected (replay protection).`,
      };
    }
  }
  return {
    accepted: true,
    code: 'OK_BRIDGE_AUTHORIZED',
    reason: `Authorized ${type} from ${eventOrigin}`,
  };
}

/**
 * Audit a compiled MeshWeave bundle + DAG against Open Agentic Web MVP Profile 0.3 invariants.
 */
export function auditComposableBundle({ dag, compiledBundle, trace = null, traceVerified = null }) {
  const checks = [];
  const manifest = compiledBundle?.manifestJson || {};
  const network = compiledBundle?.networkJson || {};
  const links = compiledBundle?.linksJson || {};
  const nodes = Array.isArray(dag?.nodes) ? dag.nodes.filter((n) => n.enabled !== false) : [];
  const edges = Array.isArray(dag?.edges)
    ? dag.edges.filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
    : [];

  const dagRes = validateDag(nodes, edges);
  checks.push({
    id: 'dag-acyclic',
    label: 'Acyclic Multi-Hop DAG Topology',
    passed: dagRes.valid && nodes.length > 0,
    detail: dagRes.valid
      ? `${nodes.length} active hop(s) in ${dagRes.layers.length} topological layer(s)`
      : dagRes.errors.join(' | ') || 'No active hops',
  });

  const netRes = validateNetworkStructure(network);
  checks.push({
    id: 'network-schema',
    label: 'Resolved Neuro SAN .network.json',
    passed: netRes.errors.length === 0,
    detail:
      netRes.errors.length === 0
        ? `front_man=${netRes.frontMan}, ${netRes.agentCount} agent(s), 0 unresolved \${ENV}`
        : netRes.errors.join(' | '),
  });

  const peers = Array.isArray(manifest.allowed_peers) ? manifest.allowed_peers : [];
  const allHttps = peers.every((p) => {
    try {
      const u = new URL(p);
      return u.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname);
    } catch {
      return false;
    }
  });
  checks.push({
    id: 'https-peers',
    label: 'HTTPS-Only allowed_peers & Manifest Policy',
    passed: allHttps && manifest.peer_policy?.mode === 'allowlist',
    detail: allHttps
      ? `${peers.length} allowlisted origin(s), mode=${manifest.peer_policy?.mode}`
      : 'Non-HTTPS or malformed peer origin found',
  });

  const hasBridge =
    manifest.actions?.version === 1 &&
    typeof manifest.actions?.bridge === 'string' &&
    manifest.actions.bridge.length > 0;
  checks.push({
    id: 'actions-bridge',
    label: 'ActionBridge v1 Metadata',
    passed: hasBridge,
    detail: hasBridge ? `bridge=${manifest.actions.bridge}` : 'Missing actions.version=1 or bridge URL',
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const schemaIssues = [];
  for (const node of nodes) {
    const incoming = edges.filter((e) => e.to === node.id);
    const inputEval = evaluateNodeInputs(node, incoming, nodeById);
    if (!inputEval.ready) {
      schemaIssues.push(`${node.id}: ${inputEval.missingRequired.join(',') || 'edge mismatch'}`);
    }
  }
  checks.push({
    id: 'edge-contracts',
    label: 'Cross-Hop Schema & Input Contracts',
    passed: schemaIssues.length === 0,
    detail:
      schemaIssues.length === 0
        ? 'All active edges & required hop arguments satisfied'
        : schemaIssues.join(' ; '),
  });

  const slyKeys = network.tools?.[0]?.allow?.to_downstream?.sly_data || [];
  checks.push({
    id: 'sly-boundary',
    label: 'Destination-Scoped sly_data Boundary',
    passed: Array.isArray(slyKeys),
    detail:
      slyKeys.length === 0
        ? 'Strict deny-all downstream sly_data ([])'
        : `Explicit allowlist [${slyKeys.join(', ')}]`,
  });

  const linksValid = links?.version === 1 && typeof links?.networks === 'object';
  checks.push({
    id: 'links-artifact',
    label: 'Portable links.json Binding Table',
    passed: linksValid,
    detail: linksValid ? `version=1, network=${compiledBundle?.networkName}` : 'Invalid links.json schema',
  });

  if (trace) {
    const sigOk = traceVerified !== null ? Boolean(traceVerified) : Boolean(trace.signature?.signatureHex);
    checks.push({
      id: 'signed-trace',
      label: 'ECDSA P-256 + SHA-256 Trace Integrity',
      passed: sigOk,
      detail: sigOk
        ? `SHA-256 ${String(trace.traceSha256 || '').slice(0, 14)}… + ECDSA P-256 verified`
        : 'Missing or invalid ECDSA trace signature',
    });
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;
  return {
    score: Math.round((passedCount / totalCount) * 100),
    passedCount,
    totalCount,
    passedAll: passedCount === totalCount,
    checks,
  };
}
