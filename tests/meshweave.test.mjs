import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ActionRegistry, validateData } from '../runtime/actions.js';
import { registerActions as registerBridgeActions } from '../bridge/bridge-actions.js';
import { registerActions as registerLocalActions } from '../mesh-actions.js';
import {
  evaluateEdgeContract,
  evaluateNodeInputs,
  resolveJsonPath,
  resolveNodeArguments,
  validateDag,
} from '../src/dag-engine.js';
import { buildShareableTrace, compileWorkflowBundle } from '../src/mesh-compiler.js';
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
