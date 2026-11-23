import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ActionRegistry, validateData } from '../runtime/actions.js';
import { registerActions as registerBridgeActions } from '../bridge/bridge-actions.js';
import { registerActions as registerLocalActions } from '../mesh-actions.js';
import { simulateRogueFrameAttack } from '../src/bridge-runner.js';
import { auditComposableBundle, validateBridgeInboundFrame } from '../src/bridge-security.js';
import {
  DEFAULT_HOP_SLY_CONTEXT,
  detectSlyCanary,
  evaluateEdgeContract,
  evaluateHopSlyBoundary,
  evaluateNodeInputs,
  reorderDagNodes,
  resolveJsonPath,
  resolveNodeArguments,
  safeClone,
  toggleDagNode,
  validateDag,
} from '../src/dag-engine.js';
import {
  buildShareableTrace,
  compileUnifiedBundle,
  compileWorkflowBundle,
  verifyShareableTrace,
} from '../src/mesh-compiler.js';
import { SAMPLE_PIPELINES } from '../src/presets.js';
import { probeSiteArtifacts, validateNetworkStructure } from '../src/prober.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('DAG engine validates and topologically layers all 3 sample pipelines', () => {
  for (const pipeline of SAMPLE_PIPELINES) {
    const res = validateDag(pipeline.nodes, pipeline.edges);
    assert.equal(res.valid, true, `${pipeline.id} should be acyclic`);
    assert.equal(res.order.length, pipeline.nodes.length);
    assert.equal(res.layers.length, 3);
  }
});

test('DAG engine rejects cycles and self-loops cleanly', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const cyclic = validateDag(nodes, [
    { id: 'e1', from: 'a', to: 'b' },
    { id: 'e2', from: 'b', to: 'a' },
  ]);
  assert.equal(cyclic.valid, false);
  assert.deepEqual(cyclic.cycleNodes.sort(), ['a', 'b']);

  const selfLoop = validateDag([{ id: 'a' }], [{ id: 'e1', from: 'a', to: 'a' }]);
  assert.equal(selfLoop.valid, false);
});

test('resolveJsonPath & resolveNodeArguments map nested upstream fields safely', () => {
  const upstream = new Map([
    [
      'hop_1_egress',
      { allowed: true, verdict: 'ALLOW', origin: 'https://shutdown-clerk.pages.dev' },
    ],
    [
      'hop_2_seal',
      {
        siteUrl: 'https://shutdown-clerk.pages.dev',
        networkName: 'shutdown_clerk',
        specReport: { score: 85 },
      },
    ],
  ]);

  assert.equal(resolveJsonPath(upstream.get('hop_2_seal'), '$.specReport.score'), 85);
  assert.equal(resolveJsonPath({ __proto__: {} }, '__proto__'), undefined);

  const p1 = SAMPLE_PIPELINES[0];
  const hop3 = p1.nodes[2];
  const incoming3 = p1.edges.filter((e) => e.to === hop3.id);
  const { args, appliedBindings } = resolveNodeArguments(hop3, incoming3, upstream);
  assert.equal(args.networkName, 'shutdown_clerk');
  assert.equal(args.hops[1].partnerUrl, 'https://shutdown-clerk.pages.dev');
  assert.equal(appliedBindings.length, 2);
});

test('evaluateEdgeContract detects exact matches, coercions, and schema mismatches', () => {
  const source = {
    id: 'src',
    actionName: 'producer',
    outputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string' },
        score: { type: 'integer' },
        flags: { type: 'array', items: { type: 'string' } },
      },
    },
  };
  const target = {
    id: 'dst',
    actionName: 'consumer',
    staticArgs: {},
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteUrl'],
      properties: {
        siteUrl: { type: 'string' },
        label: { type: 'string' },
      },
    },
  };

  const ok = evaluateEdgeContract(source, target, [{ sourcePath: '$.origin', targetArg: 'siteUrl' }]);
  assert.equal(ok.compatible, true);
  assert.equal(ok.status, 'MATCH');

  const coercible = evaluateEdgeContract(source, target, [{ sourcePath: '$.score', targetArg: 'siteUrl' }]);
  assert.equal(coercible.compatible, true);
  assert.equal(coercible.status, 'COERCIBLE');

  const mismatchUnknown = evaluateEdgeContract(source, target, [
    { sourcePath: '$.origin', targetArg: 'undeclaredKey' },
  ]);
  assert.equal(mismatchUnknown.compatible, false);
  assert.equal(mismatchUnknown.status, 'MISMATCH');

  const mismatchType = evaluateEdgeContract(source, target, [
    { sourcePath: '$.flags', targetArg: 'siteUrl' },
  ]);
  assert.equal(mismatchType.compatible, false);
  assert.equal(mismatchType.status, 'MISMATCH');

  const missingReq = evaluateNodeInputs(target, [], new Map([['src', source], ['dst', target]]));
  assert.equal(missingReq.ready, false);
  assert.deepEqual(missingReq.missingRequired, ['siteUrl']);
});

test('Mesh compiler builds valid MVP 0.3 bundles in direct and link_slots modes + trace SHA-256', async () => {
  const pipeline = SAMPLE_PIPELINES[0];
  const direct = compileWorkflowBundle(pipeline, {
    networkName: 'trust_mesh_demo',
    bindingMode: 'direct',
  });
  assert.equal(direct.validation.ok, true);
  assert.ok(direct.manifestJson.allowed_peers.includes('https://cocvn157.github.io'));
  assert.equal(direct.networkJson.tools[0].name, 'mesh_coordinator');
  assert.equal(validateNetworkStructure(direct.networkJson).errors.length, 0);

  const slotted = compileWorkflowBundle(pipeline, {
    networkName: 'trust_mesh_slotted',
    bindingMode: 'link_slots',
    slyAllowlist: ['request_id'],
  });
  assert.equal(slotted.validation.ok, true);
  assert.ok(Object.keys(slotted.networkJson.link_slots).length >= 2);
  assert.ok(Object.keys(slotted.linksJson.networks.trust_mesh_slotted).length >= 2);
  assert.deepEqual(slotted.networkJson.tools[0].allow.to_downstream.sly_data, ['request_id']);

  const trace = await buildShareableTrace({
    dag: pipeline,
    runResults: [{ nodeId: 'hop_1_egress', status: 'PASSED', transport: 'MessageChannel', latencyMs: 55 }],
    compiledBundle: direct,
    timestamp: '2026-11-20T05:30:00.000Z',
  });
  assert.match(trace.traceSha256, /^[0-9a-f]{64}$/);
  assert.equal(trace.summary.passed, 1);
  assert.equal(trace.summary.liveBridgeHops, 1);
});

test('ActionRegistry strictly validates and executes bridge & local MeshWeave actions', async () => {
  const bridgeRegistry = new ActionRegistry();
  registerBridgeActions({
    register: (def) =>
      bridgeRegistry.register({ base: 'https://cocvn157.github.io/meshweave-studio', network: 'meshweave_composer' }, def),
  });
  assert.equal(bridgeRegistry.entries.size, 3);

  const localRegistry = new ActionRegistry();
  registerLocalActions({
    register: (def) =>
      localRegistry.register({ base: 'https://cocvn157.github.io/meshweave-studio', network: 'meshweave_composer' }, def),
  });
  assert.equal(localRegistry.entries.size, 3);

  const validateEntry = [...bridgeRegistry.entries.values()].find((e) => e.name === 'validate_edge_contract');
  assert.ok(validateEntry);
  const validateArgs = {
    sourceAction: 'evaluate_egress_policy',
    targetAction: 'inspect_remote_site',
    sourceFields: [{ path: 'origin', type: 'string' }],
    targetInputs: [{ name: 'siteUrl', type: 'string', required: true }],
    mappings: [{ sourcePath: '$.origin', targetArg: 'siteUrl' }],
    staticKeys: [],
  };
  validateData(validateEntry.inputSchema, validateArgs);
  const res1 = await validateEntry.execute(validateArgs);
  assert.equal(res1.compatible, true);
  assert.equal(res1.status, 'MATCH');

  const composeEntry = [...bridgeRegistry.entries.values()].find((e) => e.name === 'compose_mesh_contract');
  const composeArgs = {
    networkName: 'demo_mesh',
    hops: [
      {
        id: 'hop1',
        partnerUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker',
        actionName: 'evaluate_egress_policy',
        status: 'PASSED',
        latencyMs: 42,
      },
      {
        id: 'hop2',
        partnerUrl: 'https://cocvn157.github.io/nanda-seal/nanda_seal_verifier',
        actionName: 'inspect_remote_site',
        status: 'PASSED',
        latencyMs: 88,
      },
    ],
  };
  validateData(composeEntry.inputSchema, composeArgs);
  const res2 = await composeEntry.execute(composeArgs);
  assert.equal(res2.hopCount, 2);
  assert.equal(res2.passedCount, 2);
  assert.match(res2.contractDigest, /^[0-9a-f]{64}$/);
});

test('Contract Prober verifies conforming partners and flags CORS / framing / missing module diagnostics', async () => {
  const mockRoutes = new Map([
    [
      'https://partner.example/agent-manifest.json',
      {
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({
          brand: 'Partner Good',
          networks: [{ name: 'good_net', front_man: 'front', hocon: './good_net.network.json' }],
          actions: { version: 1, bridge: './bridge/action-bridge.html' },
          allowed_peers: [],
        }),
      },
    ],
    [
      'https://partner.example/good_net.network.json',
      {
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({
          tools: [{ name: 'front', instructions: 'Help visitors cleanly.' }],
        }),
      },
    ],
    [
      'https://partner.example/links.json',
      {
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, networks: { good_net: {} } }),
      },
    ],
    [
      'https://partner.example/agent-mcp.json',
      {
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: 'nsdeploy-agent-mcp/v1', available: false }),
      },
    ],
    [
      'https://partner.example/bridge/action-bridge.html',
      {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><script type="module" src="../runtime/action-bridge.js"></script>',
      },
    ],
    [
      'https://partner.example/bridge/agent-manifest.json',
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ networks: [{ name: 'good_net' }], actions: { version: 1, module: './bridge-actions.js' } }),
      },
    ],
    [
      'https://partner.example/bridge/bridge-actions.js',
      {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
        body: 'export function registerActions() {}',
      },
    ],
  ]);

  const mockFetch = async (url) => {
    const entry = mockRoutes.get(url);
    if (!entry) {
      return {
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => '',
      };
    }
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      headers: new Headers(entry.headers),
      text: async () => entry.body,
    };
  };

  const goodReport = await probeSiteArtifacts('https://partner.example/good_net', {
    fetchImpl: mockFetch,
    callerOrigin: 'https://worldwideagenticweb.org',
  });
  assert.equal(goodReport.failCount, 0);
  assert.equal(goodReport.frameable, true);
  assert.equal(goodReport.hasBridgeModule, true);

  // Now simulate X-Frame-Options: DENY + missing ACAO
  mockRoutes.set('https://partner.example/bridge/action-bridge.html', {
    status: 200,
    headers: { 'content-type': 'text/html', 'x-frame-options': 'DENY' },
    body: '<!doctype html><script type="module" src="../runtime/action-bridge.js"></script>',
  });
  mockRoutes.set('https://partner.example/agent-manifest.json', {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: mockRoutes.get('https://partner.example/agent-manifest.json').body,
  });

  const blockedReport = await probeSiteArtifacts('https://partner.example', {
    fetchImpl: mockFetch,
    callerOrigin: 'https://worldwideagenticweb.org',
  });
  assert.ok(blockedReport.failCount >= 2);
  assert.equal(blockedReport.frameable, false);
  assert.match(blockedReport.bridgeDiagnostic, /X-Frame-Options/i);
});

test('Repository contains all required MVP Profile 0.3 artifacts and 8 Apache-2.0 runtime files', async () => {
  const required = [
    'index.html',
    'styles.css',
    'mesh-actions.js',
    'agent-manifest.json',
    'meshweave_composer.network.json',
    'links.json',
    'agent-mcp.json',
    '.nojekyll',
    '.well-known/nsdeploy.json',
    '.well-known/nsdeploy-agent.json',
    'bridge/action-bridge.html',
    'bridge/agent-manifest.json',
    'bridge/bridge-actions.js',
    'runtime/LICENSE.txt',
    'runtime/README.md',
    'runtime/action-bridge.js',
    'runtime/action-transport.js',
    'runtime/actions.js',
    'runtime/discovered-actions.js',
    'runtime/form-actions.js',
    'runtime/web-crypto.js',
  ];
  for (const rel of required) {
    assert.ok(existsSync(path.join(ROOT, rel)), `Missing required artifact: ${rel}`);
  }

  const manifest = JSON.parse(await readFile(path.join(ROOT, 'agent-manifest.json'), 'utf8'));
  assert.equal(manifest.networks[0].name, 'meshweave_composer');
  assert.equal(manifest.actions.version, 1);
  assert.equal(manifest.actions.bridge, './bridge/action-bridge.html');

  const netText = await readFile(path.join(ROOT, 'meshweave_composer.network.json'), 'utf8');
  assert.ok(!/\$\{[A-Z0-9_]+\}/.test(netText), 'Must not have unresolved ${ENV} tokens');
  const net = JSON.parse(netText);
  assert.equal(validateNetworkStructure(net).errors.length, 0);
});

test('toggleDagNode toggles hop enabled state immutably without mutating original DAG', () => {
  const original = safeClone(SAMPLE_PIPELINES[0]);
  const disabled = toggleDagNode(original, 'hop_2_seal');
  assert.equal(original.nodes[1].enabled, true);
  assert.equal(disabled.nodes[1].enabled, false);
  const reEnabled = toggleDagNode(disabled, 'hop_2_seal');
  assert.equal(reEnabled.nodes[1].enabled, true);
});

test('reorderDagNodes swaps hops earlier/later and rewires linear chain edges safely', () => {
  const p3 = safeClone(SAMPLE_PIPELINES[2]); // hop_1_broker -> hop_2_self -> hop_3_caps
  const moved = reorderDagNodes(p3, 'hop_2_self', 'earlier');
  assert.deepEqual(
    moved.nodes.map((n) => n.id),
    ['hop_2_self', 'hop_1_broker', 'hop_3_caps'],
  );
  const check = validateDag(moved.nodes, moved.edges);
  assert.equal(check.valid, true);
  assert.deepEqual(check.order, ['hop_2_self', 'hop_1_broker', 'hop_3_caps']);

  const movedBack = reorderDagNodes(moved, 'hop_2_self', 'later');
  assert.deepEqual(
    movedBack.nodes.map((n) => n.id),
    ['hop_1_broker', 'hop_2_self', 'hop_3_caps'],
  );
});

test('reorderDagNodes safely ignores out-of-bounds moves and unknown node ids', () => {
  const p1 = safeClone(SAMPLE_PIPELINES[0]);
  const noOpFirst = reorderDagNodes(p1, p1.nodes[0].id, 'earlier');
  assert.deepEqual(
    noOpFirst.nodes.map((n) => n.id),
    p1.nodes.map((n) => n.id),
  );
  const noOpUnknown = reorderDagNodes(p1, 'nonexistent_hop', 'later');
  assert.deepEqual(
    noOpUnknown.nodes.map((n) => n.id),
    p1.nodes.map((n) => n.id),
  );
});

test('evaluateHopSlyBoundary strips unlisted keys, BYOK secrets, and PII values per hop', () => {
  const audit = evaluateHopSlyBoundary(DEFAULT_HOP_SLY_CONTEXT, ['request_id', 'caller_origin']);
  assert.deepEqual(audit.permittedKeys, ['request_id', 'caller_origin']);
  assert.ok(audit.strippedKeys.includes('byok_api_key'));
  assert.ok(audit.strippedKeys.includes('session_cookie'));
  assert.ok(audit.strippedKeys.includes('user_email'));
  assert.ok(audit.canaryAlerts.length >= 3);
});

test('detectSlyCanary recursively detects secret keys and tokens in nested structures', () => {
  assert.ok(detectSlyCanary({ nested: [{ token: 'sk-1234567890abcdef1234' }] }));
  assert.ok(detectSlyCanary({ sub: { ssn: '123-45-6789' } }));
  assert.equal(detectSlyCanary({ request_id: 'mesh-req-2026', tags: ['a', 'b'] }), null);
});

test('compileWorkflowBundle excludes disabled hops from compiled .network.json and allowed_peers', () => {
  const dagWithDisabled = toggleDagNode(SAMPLE_PIPELINES[0], 'hop_2_seal');
  const compiled = compileWorkflowBundle(dagWithDisabled, { networkName: 'active_only_mesh' });
  assert.equal(compiled.validation.ok, true);
  assert.equal(compiled.networkJson.metadata.meshweave_dag.nodes.length, 2);
  assert.ok(!compiled.networkJson.metadata.meshweave_dag.nodes.some((n) => n.id === 'hop_2_seal'));
});

test('buildShareableTrace signs with ECDSA P-256 and verifyShareableTrace verifies intact trace', async () => {
  const pipeline = SAMPLE_PIPELINES[0];
  const compiled = compileWorkflowBundle(pipeline, { networkName: 'signed_trace_mesh' });
  const trace = await buildShareableTrace({
    dag: pipeline,
    runResults: [
      {
        nodeId: 'hop_1_egress',
        status: 'PASSED',
        transport: 'MessageChannel',
        wireProtocol: 'nsdeploy-actions-v1',
        handshakeMs: 12,
        executeMs: 22,
        latencyMs: 34,
        slyAudit: evaluateHopSlyBoundary(DEFAULT_HOP_SLY_CONTEXT, ['request_id']),
      },
    ],
    compiledBundle: compiled,
    timestamp: '2026-11-23T00:00:00.000Z',
  });
  assert.equal(trace.signature?.algorithm, 'ECDSA-P256-SHA256');
  assert.match(trace.signature?.signatureHex || '', /^[0-9a-f]+$/);
  const res = await verifyShareableTrace(trace);
  assert.equal(res.valid, true);
});

test('verifyShareableTrace fails closed on 1-byte payload tampering and forged ECDSA signature', async () => {
  const pipeline = SAMPLE_PIPELINES[0];
  const compiled = compileWorkflowBundle(pipeline, { networkName: 'tamper_check_mesh' });
  const trace = await buildShareableTrace({
    dag: pipeline,
    runResults: [{ nodeId: 'hop_1_egress', status: 'PASSED', transport: 'MessageChannel', latencyMs: 15 }],
    compiledBundle: compiled,
  });

  const tamperedPayload = safeClone(trace);
  tamperedPayload.workflowName = `${tamperedPayload.workflowName}!`;
  const payloadCheck = await verifyShareableTrace(tamperedPayload);
  assert.equal(payloadCheck.valid, false);
  assert.match(payloadCheck.reason, /SHA-256 mismatch/i);

  const forgedSig = safeClone(trace);
  const firstHex = forgedSig.signature.signatureHex[0];
  forgedSig.signature.signatureHex = `${firstHex === 'a' ? 'b' : 'a'}${forgedSig.signature.signatureHex.slice(1)}`;
  const sigCheck = await verifyShareableTrace(forgedSig);
  assert.equal(sigCheck.valid, false);
  assert.match(sigCheck.reason, /signature verification failed/i);
});

test('compileUnifiedBundle packages networkJson, manifestJson, linksJson, and signed traceJson', async () => {
  const pipeline = SAMPLE_PIPELINES[0];
  const compiled = compileWorkflowBundle(pipeline, { networkName: 'unified_mesh' });
  const trace = await buildShareableTrace({
    dag: pipeline,
    runResults: [{ nodeId: 'hop_1_egress', status: 'PASSED', transport: 'MessageChannel', latencyMs: 25 }],
    compiledBundle: compiled,
  });
  const bundle = compileUnifiedBundle({ compiledBundle: compiled, trace });
  assert.equal(bundle.schema, 'meshweave/unified-bundle/v1');
  assert.equal(bundle.artifacts.networkFileName, 'unified_mesh.network.json');
  assert.equal(bundle.artifacts.manifestJson.networks[0].name, 'unified_mesh');
  assert.equal(bundle.artifacts.linksJson.version, 1);
  assert.equal(bundle.artifacts.traceJson.traceSha256, trace.traceSha256);
});

test('auditComposableBundle scores 100% on valid DAG + signed trace and flags invalid inputs', async () => {
  const pipeline = SAMPLE_PIPELINES[0];
  const compiled = compileWorkflowBundle(pipeline, { networkName: 'audit_ok_mesh' });
  const trace = await buildShareableTrace({ dag: pipeline, runResults: [], compiledBundle: compiled });
  const verified = await verifyShareableTrace(trace);
  const passReport = auditComposableBundle({
    dag: pipeline,
    compiledBundle: compiled,
    trace,
    traceVerified: verified.valid,
  });
  assert.equal(passReport.score, 100);
  assert.equal(passReport.passedAll, true);

  const brokenBundle = safeClone(compiled);
  brokenBundle.manifestJson.allowed_peers.push('http://insecure-remote.example');
  const failReport = auditComposableBundle({
    dag: { nodes: [{ id: 'a' }], edges: [{ id: 'loop', from: 'a', to: 'a' }] },
    compiledBundle: brokenBundle,
    trace,
    traceVerified: false,
  });
  assert.equal(failReport.passedAll, false);
  assert.ok(failReport.score < 80);
});

test('validateBridgeInboundFrame rejects opaque "null" origin frames fail-closed', () => {
  const res = validateBridgeInboundFrame({ eventOrigin: 'null', type: 'connect' });
  assert.equal(res.accepted, false);
  assert.equal(res.code, 'ERR_NULL_ORIGIN_REJECTED');
});

test('validateBridgeInboundFrame rejects rogue frame when event.source mismatches peer', () => {
  const res = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    sourceMatchesPeer: false,
    type: 'connect',
  });
  assert.equal(res.accepted, false);
  assert.equal(res.code, 'ERR_ROGUE_SOURCE_REJECTED');
});

test('validateBridgeInboundFrame rejects untrusted caller origins outside callerOrigins allowlist', () => {
  const res = validateBridgeInboundFrame({
    eventOrigin: 'https://evil-attacker.invalid',
    allowedCallerOrigins: ['https://cocvn157.github.io', 'https://worldwideagenticweb.org'],
    type: 'connect',
  });
  assert.equal(res.accepted, false);
  assert.equal(res.code, 'ERR_UNTRUSTED_CALLER_ORIGIN');
});

test('validateBridgeInboundFrame rejects non-standard protocol and missing MessagePort on connect', () => {
  const badProto = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    protocol: 'rogue-bridge/v0',
    type: 'connect',
  });
  assert.equal(badProto.accepted, false);
  assert.equal(badProto.code, 'ERR_PROTOCOL_MISMATCH');

  const noPort = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    type: 'connect',
    portsCount: 0,
  });
  assert.equal(noPort.accepted, false);
  assert.equal(noPort.code, 'ERR_MISSING_MESSAGE_PORT');
});

test('validateBridgeInboundFrame rejects hidden-iframe write escalations fail-closed', () => {
  const res = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    type: 'execute',
    actionEffect: 'write',
    isTopLevelWindow: false,
    requestId: 'req-write-99',
  });
  assert.equal(res.accepted, false);
  assert.equal(res.code, 'ERR_WRITE_REQUIRES_TOP_LEVEL');
});

test('validateBridgeInboundFrame rejects local-only actions and duplicate requestId replay attacks', () => {
  const localOnly = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    type: 'execute',
    actionAvailability: 'local-only',
    requestId: 'req-1',
  });
  assert.equal(localOnly.accepted, false);
  assert.equal(localOnly.code, 'ERR_LOCAL_ONLY_ACTION');

  const replay = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    type: 'execute',
    actionEffect: 'read',
    requestId: 'req-dup-1',
    seenRequestIds: new Set(['req-dup-1']),
  });
  assert.equal(replay.accepted, false);
  assert.equal(replay.code, 'ERR_REPLAY_REQUEST_ID');

  const ok = validateBridgeInboundFrame({
    eventOrigin: 'https://cocvn157.github.io',
    type: 'execute',
    actionEffect: 'read',
    requestId: 'req-fresh-2',
    seenRequestIds: new Set(['req-dup-1']),
  });
  assert.equal(ok.accepted, true);
  assert.equal(ok.code, 'OK_BRIDGE_AUTHORIZED');
});

test('simulateRogueFrameAttack verifies all fail-closed ActionBridge defense vectors cleanly', async () => {
  const drill = await simulateRogueFrameAttack('https://cocvn157.github.io/meshweave-studio/bridge/action-bridge.html');
  assert.equal(drill.allRejectedFailClosed, true);
  assert.equal(drill.vectors.length, 3);
  assert.ok(drill.vectors.every((v) => v.passedFailClosed));
});

test('index.html has inline SVG favicon, ARIA roles, and deploy workflow stages all modules', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /rel="icon"\s+type="image\/svg\+xml"/i);
  assert.match(html, /role="tablist"/i);
  assert.match(html, /role="tabpanel"/i);
  assert.match(html, /aria-live="polite"/i);

  const deployYml = await readFile(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(deployYml, /\bsrc\b/);
  assert.match(deployYml, /meshweave_composer\.network\.json/);
  assert.match(deployYml, /\.well-known/);
});
