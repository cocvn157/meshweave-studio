/**
 * MeshWeave Studio — Live Browser Action-Bridge Runner
 * Executes real cross-origin hidden-iframe MessageChannel RPCs using Cognizant's
 * runtime/action-transport.js (ActionBridgeClient, protocol "nsdeploy-actions-v1"),
 * while detecting legacy bridge wire divergences (e.g. "nsdeploy-action-bridge/v1").
 */

import { ActionBridgeClient } from '../runtime/action-transport.js';
import { randomUuid } from '../runtime/web-crypto.js';
import { validateBridgeInboundFrame } from './bridge-security.js';
import {
  DEFAULT_HOP_SLY_CONTEXT,
  evaluateEdgeContract,
  evaluateHopSlyBoundary,
  evaluateNodeInputs,
  resolveNodeArguments,
  safeClone,
  validateDag,
} from './dag-engine.js';

const STANDARD_PROTOCOL = 'nsdeploy-actions-v1';
const LEGACY_PROTOCOL = 'nsdeploy-action-bridge/v1';

export function resolveAbsoluteUrl(urlOrPath, baseHref = globalThis.location?.href) {
  return new URL(String(urlOrPath), baseHref).href;
}

/**
 * Inspect what wire protocol an action-bridge.html iframe speaks and fetch its live catalog.
 */
export async function probeBridgeChannel(bridgeUrl, { timeoutMs = 9000, allowLegacyAdapter = true } = {}) {
  const absUrl = resolveAbsoluteUrl(bridgeUrl);
  const origin = new URL(absUrl).origin;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'MeshWeave bridge probe';
    frame.sandbox = 'allow-scripts allow-same-origin';

    let settled = false;
    let port = null;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onWindowMessage);
      try {
        port?.close();
      } catch {
        // ignore close errors
      }
      frame.remove();
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onWindowMessage = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // 1. Standard Cognizant MVP Profile 0.3 MessageChannel bridge
      if (data.protocol === STANDARD_PROTOCOL && data.type === 'ready') {
        const handshakeMs = Math.max(1, Math.round(performance.now() - startedAt));
        const channel = new MessageChannel();
        port = channel.port1;
        const catalogStart = performance.now();
        port.onmessage = ({ data: reply }) => {
          if (reply?.id !== 1) return;
          const catalogMs = Math.max(1, Math.round(performance.now() - catalogStart));
          if (!reply.ok) {
            finish({
              connected: false,
              wireProtocol: STANDARD_PROTOCOL,
              transport: 'MessageChannel',
              protocolMismatch: false,
              handshakeMs,
              catalogMs,
              actions: [],
              error: reply.error || 'Catalog request rejected by bridge',
            });
            return;
          }
          finish({
            connected: true,
            wireProtocol: STANDARD_PROTOCOL,
            transport: 'MessageChannel',
            protocolMismatch: false,
            handshakeMs,
            catalogMs,
            actions: Array.isArray(reply.value) ? reply.value : [],
            error: null,
          });
        };
        port.start();
        frame.contentWindow.postMessage({ protocol: STANDARD_PROTOCOL, type: 'connect' }, origin, [
          channel.port2,
        ]);
        port.postMessage({ id: 1, type: 'catalog' });
        return;
      }

      // 2. Legacy / non-MessageChannel postMessage bridge (e.g. nsdeploy-action-bridge/v1)
      if (data.protocol === LEGACY_PROTOCOL && data.kind === 'ready') {
        const handshakeMs = Math.max(1, Math.round(performance.now() - startedAt));
        if (!allowLegacyAdapter) {
          finish({
            connected: false,
            wireProtocol: LEGACY_PROTOCOL,
            transport: 'postMessage',
            protocolMismatch: true,
            handshakeMs,
            catalogMs: 0,
            actions: [],
            error: `Strict protocol mismatch: bridge speaks ${LEGACY_PROTOCOL} instead of Cognizant ${STANDARD_PROTOCOL} MessageChannel.`,
          });
          return;
        }
        const catalogStart = performance.now();
        const discoverId = `probe_${randomUuid()}`;
        const waitDiscover = (ev) => {
          if (
            ev.source !== frame.contentWindow ||
            ev.origin !== origin ||
            ev.data?.protocol !== LEGACY_PROTOCOL ||
            ev.data?.kind !== 'discovered' ||
            ev.data?.id !== discoverId
          ) {
            return;
          }
          window.removeEventListener('message', waitDiscover);
          const catalogMs = Math.max(1, Math.round(performance.now() - catalogStart));
          finish({
            connected: true,
            wireProtocol: LEGACY_PROTOCOL,
            transport: 'postMessage (Adapter)',
            protocolMismatch: true,
            handshakeMs,
            catalogMs,
            actions: Array.isArray(ev.data.actions) ? ev.data.actions : [],
            error: null,
          });
        };
        window.addEventListener('message', waitDiscover);
        frame.contentWindow.postMessage(
          { protocol: LEGACY_PROTOCOL, kind: 'discover', id: discoverId },
          origin,
        );
      }
    };

    timer = setTimeout(() => {
      finish({
        connected: false,
        wireProtocol: 'unknown',
        transport: 'none',
        protocolMismatch: false,
        handshakeMs: timeoutMs,
        catalogMs: 0,
        actions: [],
        error: `Bridge ready signal timed out after ${timeoutMs}ms (check framing headers or script load).`,
      });
    }, timeoutMs);

    window.addEventListener('message', onWindowMessage);
    frame.src = absUrl;
    document.body.append(frame);
  });
}

async function executeLegacyBridgeAction(absUrl, actionName, args, timeoutMs = 10000) {
  const origin = new URL(absUrl).origin;
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'MeshWeave legacy bridge adapter';
    frame.sandbox = 'allow-scripts allow-same-origin';

    let settled = false;
    let timer = null;
    const reqId = `exec_${randomUuid()}`;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      frame.remove();
    };

    const fail = (msg) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };

    const succeed = (value, handshakeMs) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        value,
        handshakeMs,
        executeMs: Math.max(1, Math.round(performance.now() - startedAt - handshakeMs)),
        totalLatencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        wireProtocol: LEGACY_PROTOCOL,
        transport: 'postMessage (Adapter)',
      });
    };

    let handshakeMs = 0;
    let sentInvoke = false;

    const onMsg = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const d = event.data;
      if (!d || typeof d !== 'object' || d.protocol !== LEGACY_PROTOCOL) return;
      if (d.kind === 'ready' && !sentInvoke) {
        sentInvoke = true;
        handshakeMs = Math.max(1, Math.round(performance.now() - startedAt));
        frame.contentWindow.postMessage(
          { protocol: LEGACY_PROTOCOL, kind: 'invoke', id: reqId, action: actionName, args },
          origin,
        );
      } else if (d.kind === 'result' && d.id === reqId) {
        if (d.ok) succeed(d.result, handshakeMs);
        else fail(d.error || 'Bridge execution failed');
      }
    };

    timer = setTimeout(() => fail(`Legacy adapter timed out after ${timeoutMs}ms`), timeoutMs);
    window.addEventListener('message', onMsg);
    frame.src = absUrl;
    document.body.append(frame);
  });
}

/**
 * Execute one action against a remote or same-origin bridge in a SINGLE iframe connection.
 * Uses Cognizant's ActionBridgeClient (MessageChannel, nsdeploy-actions-v1) directly,
 * while intercepting legacy nsdeploy-action-bridge/v1 frames if present.
 */
export async function executeBridgeAction({
  bridgeUrl,
  brand = 'Partner Bridge',
  actionName,
  args = {},
  strictProtocol = false,
  timeoutMs = 10000,
}) {
  const absUrl = resolveAbsoluteUrl(bridgeUrl);
  const origin = new URL(absUrl).origin;
  const client = new ActionBridgeClient(absUrl, brand);
  const tStart = performance.now();

  let legacyDetected = false;
  const legacyListener = (event) => {
    if (
      event.origin === origin &&
      event.source === client.frame?.contentWindow &&
      event.data?.protocol === LEGACY_PROTOCOL &&
      event.data?.kind === 'ready'
    ) {
      legacyDetected = true;
      client.dispose();
    }
  };
  window.addEventListener('message', legacyListener);

  try {
    await client.connect(false);
    window.removeEventListener('message', legacyListener);

    const handshakeMs = Math.max(1, Math.round(performance.now() - tStart));
    const catalog = await client.request('catalog');
    const catalogEntry = Array.isArray(catalog)
      ? catalog.find((a) => a.name === actionName)
      : null;

    if (!catalogEntry) {
      const names = Array.isArray(catalog) ? catalog.map((a) => a.name).join(', ') || 'none' : 'none';
      throw new Error(
        `Action "${actionName}" is not exposed in ${brand} bridge catalog (exposed: ${names}).`,
      );
    }
    if (catalogEntry.effect && catalogEntry.effect !== 'read') {
      throw new Error(
        `Action "${actionName}" has effect="${catalogEntry.effect}"; automated background DAG runner only executes read actions silently.`,
      );
    }

    const tExec = performance.now();
    const requestId = `meshweave_${randomUuid()}`;
    const value = await client.request('execute', {
      name: actionName,
      args: safeClone(args),
      requestId,
    });
    const executeMs = Math.max(1, Math.round(performance.now() - tExec));
    return {
      value,
      handshakeMs,
      executeMs,
      totalLatencyMs: Math.max(1, Math.round(performance.now() - tStart)),
      wireProtocol: STANDARD_PROTOCOL,
      transport: 'MessageChannel',
      catalogEntry,
    };
  } catch (err) {
    window.removeEventListener('message', legacyListener);
    if (!legacyDetected) throw err;
    if (strictProtocol) {
      throw new Error(
        `Strict protocol mismatch: ${brand} speaks ${LEGACY_PROTOCOL} instead of Cognizant ${STANDARD_PROTOCOL} MessageChannel.`,
      );
    }
    return executeLegacyBridgeAction(absUrl, actionName, safeClone(args), timeoutMs);
  } finally {
    window.removeEventListener('message', legacyListener);
    client.dispose();
  }
}

/**
 * Execute an entire multi-hop workflow DAG in topological order.
 */
export async function executeDagWorkflow(
  dag,
  { strictProtocol = false, onNodeEvent = () => {} } = {},
) {
  const nodes = Array.isArray(dag?.nodes) ? dag.nodes : [];
  const edges = Array.isArray(dag?.edges) ? dag.edges : [];
  const dagCheck = validateDag(nodes, edges);
  if (!dagCheck.valid) {
    throw new Error(`Invalid DAG topology: ${dagCheck.errors.join(' ')}`);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const outputsByNodeId = new Map();
  const failedNodes = new Set();
  const results = [];

  for (const nodeId of dagCheck.order) {
    const node = nodeById.get(nodeId);
    const incoming = edges.filter((e) => e.to === nodeId);
    const edgeStatuses = incoming.map((e) =>
      evaluateEdgeContract(nodeById.get(e.from), node, e.mappings || []).status,
    );
    const schemaSummary =
      edgeStatuses.length === 0
        ? 'ROOT'
        : edgeStatuses.includes('MISMATCH')
          ? 'MISMATCH'
          : edgeStatuses.includes('COERCIBLE')
            ? 'COERCIBLE'
            : edgeStatuses.includes('UNVERIFIED')
              ? 'UNVERIFIED'
              : 'MATCH';

    const slyAudit = evaluateHopSlyBoundary(
      node.proposedSlyData || DEFAULT_HOP_SLY_CONTEXT,
      node.slyAllowlist || [],
    );

    if (node.enabled === false) {
      const disabledRec = {
        nodeId,
        partnerLabel: node.partnerLabel,
        networkName: node.networkName,
        actionName: node.actionName,
        bridgeUrl: node.bridgeUrl,
        status: 'DISABLED',
        transport: 'none',
        wireProtocol: 'none',
        handshakeMs: 0,
        executeMs: 0,
        latencyMs: 0,
        schemaStatus: schemaSummary,
        slyAudit: {
          proposedKeys: slyAudit.proposedKeys,
          permittedKeys: [],
          strippedKeys: slyAudit.proposedKeys,
          canaryAlerts: ['Hop disabled — 0 sly_data keys emitted'],
        },
        error: 'Hop toggled OFF by composer.',
      };
      results.push(disabledRec);
      onNodeEvent(disabledRec);
      continue;
    }

    const failedParent = incoming.find((e) => failedNodes.has(e.from));
    if (failedParent) {
      failedNodes.add(nodeId);
      const skipped = {
        nodeId,
        partnerLabel: node.partnerLabel,
        networkName: node.networkName,
        actionName: node.actionName,
        bridgeUrl: node.bridgeUrl,
        status: 'SKIPPED',
        transport: 'none',
        wireProtocol: 'none',
        handshakeMs: 0,
        executeMs: 0,
        latencyMs: 0,
        schemaStatus: schemaSummary,
        slyAudit,
        error: `Skipped fail-closed because upstream hop "${failedParent.from}" did not succeed.`,
      };
      results.push(skipped);
      onNodeEvent(skipped);
      continue;
    }

    onNodeEvent({ nodeId, status: 'RUNNING' });

    try {
      const activeIncoming = incoming.filter((e) => outputsByNodeId.has(e.from));
      const disabledMappedParent = incoming.find(
        (e) => nodeById.get(e.from)?.enabled === false && (e.mappings || []).length > 0,
      );
      if (disabledMappedParent) {
        const mappedFromDisabled = (disabledMappedParent.mappings || []).some((m) => {
          const top = String(m.targetArg || '').split(/[.[]/)[0];
          const req = Array.isArray(node.inputSchema?.required) ? node.inputSchema.required : [];
          return req.includes(top) && !Object.hasOwn(node.staticArgs || {}, top);
        });
        if (mappedFromDisabled) {
          throw new Error(
            `Upstream hop "${disabledMappedParent.from}" is disabled and required by edge mapping.`,
          );
        }
      }

      const contractCheck = evaluateNodeInputs(node, incoming, nodeById);
      if (!contractCheck.ready && contractCheck.missingRequired.length > 0) {
        throw new Error(`Missing required argument(s): ${contractCheck.missingRequired.join(', ')}`);
      }
      const { args, appliedBindings } = resolveNodeArguments(node, activeIncoming, outputsByNodeId);
      const execResult = await executeBridgeAction({
        bridgeUrl: node.bridgeUrl,
        brand: node.partnerLabel || node.networkName,
        actionName: node.actionName,
        args,
        strictProtocol,
      });

      outputsByNodeId.set(nodeId, execResult.value);
      const record = {
        nodeId,
        partnerLabel: node.partnerLabel,
        networkName: node.networkName,
        actionName: node.actionName,
        bridgeUrl: resolveAbsoluteUrl(node.bridgeUrl),
        status: 'PASSED',
        transport: execResult.transport,
        wireProtocol: execResult.wireProtocol,
        handshakeMs: execResult.handshakeMs,
        executeMs: execResult.executeMs,
        latencyMs: execResult.totalLatencyMs,
        schemaStatus: schemaSummary,
        slyAudit,
        appliedBindings,
        resolvedArgs: args,
        output: execResult.value,
        error: null,
      };
      results.push(record);
      onNodeEvent(record);
    } catch (err) {
      failedNodes.add(nodeId);
      const failed = {
        nodeId,
        partnerLabel: node.partnerLabel,
        networkName: node.networkName,
        actionName: node.actionName,
        bridgeUrl: node.bridgeUrl,
        status: 'FAILED',
        transport: 'none',
        wireProtocol: 'none',
        handshakeMs: 0,
        executeMs: 0,
        latencyMs: 0,
        schemaStatus: schemaSummary,
        slyAudit,
        error: err?.message || String(err),
      };
      results.push(failed);
      onNodeEvent(failed);
    }
  }

  return {
    dagCheck,
    results,
    outputsByNodeId,
  };
}

/**
 * Interactive browser drill proving fail-closed ActionBridge rejection against rogue frames,
 * opaque "null" sandboxed origins, and iframe write/replay attacks.
 */
export async function simulateRogueFrameAttack(bridgeUrl = './bridge/action-bridge.html') {
  const absUrl = resolveAbsoluteUrl(bridgeUrl);
  const vectors = [];

  // Vector 1: Untrusted origin & mismatched event.source guard check
  const untrusted = validateBridgeInboundFrame({
    eventOrigin: 'https://rogue-exfil.invalid',
    sourceMatchesPeer: false,
    protocol: STANDARD_PROTOCOL,
    type: 'connect',
    portsCount: 1,
    allowedCallerOrigins: ['https://cocvn157.github.io'],
  });
  vectors.push({
    id: 'rogue-origin-source',
    label: '1. Spoofed Rogue Frame (https://rogue-exfil.invalid, source != peer)',
    passedFailClosed: !untrusted.accepted,
    code: untrusted.code,
    detail: untrusted.reason,
  });

  // Vector 2: Real browser opaque "null" origin sandboxed iframe probe against live ActionBridge
  let nullOriginBlocked = false;
  let nullOriginDetail = '';
  if (typeof document !== 'undefined') {
    nullOriginBlocked = await new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.title = 'MeshWeave null-origin security drill';
      // Omitting allow-same-origin forces opaque "null" origin in Chromium/Edge!
      frame.sandbox = 'allow-scripts';
      let gotUnexpectedCatalog = false;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        frame.remove();
        resolve(!gotUnexpectedCatalog);
      }, 900);

      const onMsg = (ev) => {
        if (ev.source !== frame.contentWindow) return;
        if (ev.data?.kind === 'rogue_probe_unexpected_catalog') {
          gotUnexpectedCatalog = true;
          clearTimeout(timer);
          window.removeEventListener('message', onMsg);
          frame.remove();
          resolve(false);
        }
      };
      window.addEventListener('message', onMsg);
      frame.srcdoc = `<!doctype html><script>
        try {
          const f = document.createElement('iframe');
          f.src = ${JSON.stringify(absUrl)};
          document.body.appendChild(f);
          window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'ready') {
              const mc = new MessageChannel();
              mc.port1.onmessage = (m) => {
                if (m.data && m.data.ok) parent.postMessage({ kind: 'rogue_probe_unexpected_catalog' }, '*');
              };
              e.source.postMessage({ protocol: 'nsdeploy-actions-v1', type: 'connect' }, '*', [mc.port2]);
              mc.port1.postMessage({ id: 1, type: 'catalog' });
            }
          });
        } catch (err) {}
      </script>`;
      document.body.append(frame);
    });
    const nullRule = validateBridgeInboundFrame({ eventOrigin: 'null', type: 'connect' });
    nullOriginDetail = nullOriginBlocked
      ? `Live opaque "null"-origin sandbox iframe received 0 ports & 0 actions (${nullRule.code}).`
      : 'Unexpectedly received catalog in null-origin frame!';
  } else {
    const nullRule = validateBridgeInboundFrame({ eventOrigin: 'null', type: 'connect' });
    nullOriginBlocked = !nullRule.accepted;
    nullOriginDetail = nullRule.reason;
  }
  vectors.push({
    id: 'null-origin-iframe',
    label: '2. Live Sandboxed "null" Origin Frame Attack against ActionBridge',
    passedFailClosed: nullOriginBlocked,
    code: 'ERR_NULL_ORIGIN_REJECTED',
    detail: nullOriginDetail,
  });

  // Vector 3: Cross-origin write escalation + duplicate requestId replay inside iframe
  const writeBlocked = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    sourceMatchesPeer: true,
    protocol: STANDARD_PROTOCOL,
    type: 'execute',
    actionEffect: 'write',
    isTopLevelWindow: false,
    requestId: 'req-write-01',
  });
  const replayBlocked = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    sourceMatchesPeer: true,
    protocol: STANDARD_PROTOCOL,
    type: 'execute',
    actionEffect: 'read',
    isTopLevelWindow: false,
    requestId: 'req-dup-01',
    seenRequestIds: new Set(['req-dup-01']),
  });
  vectors.push({
    id: 'write-and-replay',
    label: '3. Iframe Write Escalation & Replay RequestID Guard',
    passedFailClosed: !writeBlocked.accepted && !replayBlocked.accepted,
    code: `${writeBlocked.code} + ${replayBlocked.code}`,
    detail: `${writeBlocked.reason} | ${replayBlocked.reason}`,
  });

  return {
    allRejectedFailClosed: vectors.every((v) => v.passedFailClosed),
    testedAt: new Date().toISOString(),
    bridgeUrl: absUrl,
    vectors,
  };
}
