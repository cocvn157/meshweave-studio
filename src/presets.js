/**
 * MeshWeave Studio — Instant $0-Key Runnable Multi-Hop Presets & Partner Catalog
 */

export const PARTNER_PRESETS = [
  {
    id: 'scopegate',
    label: 'ScopeGate Studio',
    siteBase: 'https://cocvn157.github.io/scopegate-studio',
    networkName: 'scopegate_broker',
    partnerNetworkUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker',
    bridgeUrl: 'https://cocvn157.github.io/scopegate-studio/bridge/action-bridge.html',
  },
  {
    id: 'nanda-seal',
    label: 'NandaSeal Trust Studio',
    siteBase: 'https://cocvn157.github.io/nanda-seal',
    networkName: 'nanda_seal_verifier',
    partnerNetworkUrl: 'https://cocvn157.github.io/nanda-seal/nanda_seal_verifier',
    bridgeUrl: 'https://cocvn157.github.io/nanda-seal/bridge/action-bridge.html',
  },
  {
    id: 'meshweave',
    label: 'MeshWeave Studio (Self)',
    siteBase: '.',
    networkName: 'meshweave_composer',
    partnerNetworkUrl: 'https://cocvn157.github.io/meshweave-studio/meshweave_composer',
    bridgeUrl: './bridge/action-bridge.html',
  },
];

export const SAMPLE_PIPELINES = [
  {
    id: 'trust_gated_mesh',
    name: 'Pipeline 1: Live 3-Origin Trust & Egress Mesh',
    description:
      'Checks peer egress policy on ScopeGate Studio -> passes allowed origin into NandaSeal Trust Studio remote inspection -> compiles canonical MVP 0.3 contract digest on MeshWeave Studio.',
    nodes: [
      {
        id: 'hop_1_egress',
        partnerLabel: 'ScopeGate Studio',
        siteBase: 'https://cocvn157.github.io/scopegate-studio',
        networkName: 'scopegate_broker',
        partnerNetworkUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker',
        bridgeUrl: 'https://cocvn157.github.io/scopegate-studio/bridge/action-bridge.html',
        actionName: 'evaluate_egress_policy',
        effect: 'read',
        enabled: true,
        slyAllowlist: ['request_id', 'caller_origin'],
        staticArgs: {
          targetUrl: 'https://shutdown-clerk.pages.dev/shutdown_clerk',
          effect: 'read',
          allowedPeers: ['https://shutdown-clerk.pages.dev'],
          denyOrigins: [],
        },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['targetUrl', 'effect'],
          properties: {
            targetUrl: { type: 'string' },
            effect: { type: 'string', enum: ['read', 'write'] },
            allowedPeers: { type: 'array', items: { type: 'string' } },
            denyOrigins: { type: 'array', items: { type: 'string' } },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            allowed: { type: 'boolean' },
            verdict: { type: 'string' },
            ruleCode: { type: 'string' },
            origin: { type: 'string' },
          },
        },
        sampleOutput: {
          allowed: true,
          verdict: 'ALLOW',
          ruleCode: 'OK_PERMITTED',
          origin: 'https://shutdown-clerk.pages.dev',
        },
      },
      {
        id: 'hop_2_seal',
        partnerLabel: 'NandaSeal Trust Studio',
        siteBase: 'https://cocvn157.github.io/nanda-seal',
        networkName: 'nanda_seal_verifier',
        partnerNetworkUrl: 'https://cocvn157.github.io/nanda-seal/nanda_seal_verifier',
        bridgeUrl: 'https://cocvn157.github.io/nanda-seal/bridge/action-bridge.html',
        actionName: 'inspect_remote_site',
        effect: 'read',
        enabled: true,
        slyAllowlist: ['request_id'],
        staticArgs: {},
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['siteUrl'],
          properties: {
            siteUrl: { type: 'string', minLength: 8, maxLength: 500 },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            siteUrl: { type: 'string' },
            brand: { type: 'string' },
            networkName: { type: 'string' },
            frontMan: { type: 'string' },
            hasSignedFacts: { type: 'boolean' },
            specReport: {
              type: 'object',
              properties: { score: { type: 'number' } },
            },
            cryptoReport: {
              type: 'object',
              properties: { status: { type: 'string' }, valid: { type: 'boolean' } },
            },
          },
        },
        sampleOutput: {
          siteUrl: 'https://shutdown-clerk.pages.dev',
          brand: 'Shutdown Clerk',
          networkName: 'shutdown_clerk',
          frontMan: 'shutdown_clerk',
          hasSignedFacts: false,
          specReport: { score: 85 },
          cryptoReport: { status: 'UNSIGNED', valid: false },
        },
      },
      {
        id: 'hop_3_weave',
        partnerLabel: 'MeshWeave Studio',
        siteBase: '.',
        networkName: 'meshweave_composer',
        partnerNetworkUrl: 'https://cocvn157.github.io/meshweave-studio/meshweave_composer',
        bridgeUrl: './bridge/action-bridge.html',
        actionName: 'compose_mesh_contract',
        effect: 'read',
        enabled: true,
        slyAllowlist: ['request_id'],
        staticArgs: {
          networkName: 'shutdown_clerk_verified_mesh',
          hops: [
            {
              id: 'hop_1_egress',
              partnerUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker',
              actionName: 'evaluate_egress_policy',
              status: 'PASSED',
              latencyMs: 40,
            },
            {
              id: 'hop_2_seal',
              partnerUrl: 'https://shutdown-clerk.pages.dev',
              actionName: 'inspect_remote_site',
              status: 'PASSED',
              latencyMs: 90,
            },
          ],
        },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['networkName', 'hops'],
          properties: {
            networkName: { type: 'string', minLength: 1, maxLength: 80 },
            hops: {
              type: 'array',
              minItems: 1,
              maxItems: 16,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'partnerUrl', 'actionName', 'status'],
                properties: {
                  id: { type: 'string' },
                  partnerUrl: { type: 'string' },
                  actionName: { type: 'string' },
                  status: { type: 'string' },
                  latencyMs: { type: 'number' },
                },
              },
            },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            mvpProfile: { type: 'string' },
            networkName: { type: 'string' },
            allowedPeers: { type: 'array', items: { type: 'string' } },
            hopCount: { type: 'integer' },
            passedCount: { type: 'integer' },
            contractDigest: { type: 'string' },
          },
        },
        sampleOutput: {
          mvpProfile: '0.3',
          networkName: 'shutdown_clerk',
          allowedPeers: ['https://cocvn157.github.io', 'https://shutdown-clerk.pages.dev'],
          hopCount: 2,
          passedCount: 2,
          contractDigest: 'sha256_preview',
        },
      },
    ],
    edges: [
      {
        id: 'edge_1_2',
        from: 'hop_1_egress',
        to: 'hop_2_seal',
        mappings: [{ sourcePath: '$.origin', targetArg: 'siteUrl' }],
      },
      {
        id: 'edge_2_3',
        from: 'hop_2_seal',
        to: 'hop_3_weave',
        mappings: [
          { sourcePath: '$.networkName', targetArg: 'networkName' },
          { sourcePath: '$.siteUrl', targetArg: 'hops[1].partnerUrl' },
        ],
      },
    ],
  },
  {
    id: 'boundary_tamper_defense',
    name: 'Pipeline 2: Private Context Scrub + Tamper Defense',
    description:
      'Scrubs sly_data BYOK canary secrets on ScopeGate Studio -> simulates 1-byte prompt-injection tamper detection on NandaSeal -> verifies edge contract schema compatibility on MeshWeave Studio.',
    nodes: [
      {
        id: 'hop_1_sly',
        partnerLabel: 'ScopeGate Studio',
        siteBase: 'https://cocvn157.github.io/scopegate-studio',
        networkName: 'scopegate_broker',
        partnerNetworkUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker',
        bridgeUrl: 'https://cocvn157.github.io/scopegate-studio/bridge/action-bridge.html',
        actionName: 'inspect_sly_boundary',
        effect: 'read',
        staticArgs: {
          slyData: {
            request_id: 'mesh-trace-2026',
            byok_api_key: 'sk-live-CANARY-DO-NOT-CROSS',
            session_token: 'sess_canary_99',
          },
          allowedKeys: ['request_id'],
        },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['slyData'],
          properties: {
            slyData: { type: 'object', properties: {} },
            allowedKeys: { type: 'array', items: { type: 'string' } },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            permitted: { type: 'object', properties: { request_id: { type: 'string' } } },
            strippedKeys: { type: 'array', items: { type: 'string' } },
            canaryAlerts: { type: 'array', items: { type: 'string' } },
          },
        },
        sampleOutput: {
          permitted: { request_id: 'mesh-trace-2026' },
          strippedKeys: ['byok_api_key', 'session_token'],
          canaryAlerts: ['Blocked secret key sly_data.byok_api_key'],
        },
      },
      {
        id: 'hop_2_tamper',
        partnerLabel: 'NandaSeal Trust Studio',
        siteBase: 'https://cocvn157.github.io/nanda-seal',
        networkName: 'nanda_seal_verifier',
        partnerNetworkUrl: 'https://cocvn157.github.io/nanda-seal/nanda_seal_verifier',
        bridgeUrl: 'https://cocvn157.github.io/nanda-seal/bridge/action-bridge.html',
        actionName: 'simulate_tamper_attack',
        effect: 'read',
        staticArgs: {},
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        outputSchema: {
          type: 'object',
          properties: {
            before: { type: 'object', properties: { status: { type: 'string' }, specScore: { type: 'number' } } },
            after: { type: 'object', properties: { status: { type: 'string' }, specScore: { type: 'number' } } },
          },
        },
        sampleOutput: {
          before: { status: 'VERIFIED', specScore: 100 },
          after: { status: 'TAMPERED', specScore: 80 },
        },
      },
      {
        id: 'hop_3_validate',
        partnerLabel: 'MeshWeave Studio',
        siteBase: '.',
        networkName: 'meshweave_composer',
        partnerNetworkUrl: 'https://cocvn157.github.io/meshweave-studio/meshweave_composer',
        bridgeUrl: './bridge/action-bridge.html',
        actionName: 'validate_edge_contract',
        effect: 'read',
        staticArgs: {
          sourceAction: 'simulate_tamper_attack',
          targetAction: 'compose_mesh_contract',
          sourceFields: [
            { path: 'after.status', type: 'string' },
            { path: 'before.specScore', type: 'number' },
          ],
          targetInputs: [
            { name: 'networkName', type: 'string', required: true },
            { name: 'status', type: 'string', required: false },
          ],
          mappings: [{ sourcePath: '$.after.status', targetArg: 'status' }],
          staticKeys: ['networkName'],
        },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceAction', 'targetAction', 'sourceFields', 'targetInputs', 'mappings'],
          properties: {
            sourceAction: { type: 'string' },
            targetAction: { type: 'string' },
            sourceFields: { type: 'array', items: { type: 'object', properties: {} } },
            targetInputs: { type: 'array', items: { type: 'object', properties: {} } },
            mappings: { type: 'array', items: { type: 'object', properties: {} } },
            staticKeys: { type: 'array', items: { type: 'string' } },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            compatible: { type: 'boolean' },
            status: { type: 'string' },
            checkedCount: { type: 'integer' },
          },
        },
        sampleOutput: { compatible: true, status: 'MATCH', checkedCount: 1 },
      },
    ],
    edges: [
      {
        id: 'edge_sly_tamper',
        from: 'hop_1_sly',
        to: 'hop_2_tamper',
        mappings: [],
      },
      {
        id: 'edge_tamper_val',
        from: 'hop_2_tamper',
        to: 'hop_3_validate',
        mappings: [{ sourcePath: '$.after.status', targetArg: 'sourceAction' }],
      },
    ],
  },
  {
    id: 'ecosystem_broker_mesh',
    name: 'Pipeline 3: Self-Attestation & Broker Capability Mesh',
    description:
      'Queries ScopeGate Broker capabilities -> runs NandaSeal live self-seal ECDSA verification -> retrieves MeshWeave Studio bridge capabilities & protocol status.',
    nodes: [
      {
        id: 'hop_1_broker',
        partnerLabel: 'ScopeGate Studio',
        siteBase: 'https://cocvn157.github.io/scopegate-studio',
        networkName: 'scopegate_broker',
        partnerNetworkUrl: 'https://cocvn157.github.io/scopegate-studio/scopegate_broker',
        bridgeUrl: 'https://cocvn157.github.io/scopegate-studio/bridge/action-bridge.html',
        actionName: 'get_broker_status',
        effect: 'read',
        staticArgs: {},
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: {
          type: 'object',
          properties: {
            brand: { type: 'string' },
            network: { type: 'string' },
            mvpProfile: { type: 'string' },
          },
        },
        sampleOutput: { brand: 'ScopeGate Studio', network: 'scopegate_broker', mvpProfile: '0.3' },
      },
      {
        id: 'hop_2_self',
        partnerLabel: 'NandaSeal Trust Studio',
        siteBase: 'https://cocvn157.github.io/nanda-seal',
        networkName: 'nanda_seal_verifier',
        partnerNetworkUrl: 'https://cocvn157.github.io/nanda-seal/nanda_seal_verifier',
        bridgeUrl: 'https://cocvn157.github.io/nanda-seal/bridge/action-bridge.html',
        actionName: 'verify_self_seal',
        effect: 'read',
        staticArgs: {},
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: {
          type: 'object',
          properties: {
            cryptoReport: { type: 'object', properties: { status: { type: 'string' }, valid: { type: 'boolean' } } },
            specReport: { type: 'object', properties: { score: { type: 'number' } } },
          },
        },
        sampleOutput: {
          cryptoReport: { status: 'VERIFIED', valid: true },
          specReport: { score: 100 },
        },
      },
      {
        id: 'hop_3_caps',
        partnerLabel: 'MeshWeave Studio',
        siteBase: '.',
        networkName: 'meshweave_composer',
        partnerNetworkUrl: 'https://cocvn157.github.io/meshweave-studio/meshweave_composer',
        bridgeUrl: './bridge/action-bridge.html',
        actionName: 'get_meshweave_capabilities',
        effect: 'read',
        staticArgs: {},
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: {
          type: 'object',
          properties: {
            brand: { type: 'string' },
            network: { type: 'string' },
            mvpProfile: { type: 'string' },
          },
        },
        sampleOutput: { brand: 'MeshWeave Studio', network: 'meshweave_composer', mvpProfile: '0.3' },
      },
    ],
    edges: [
      { id: 'edge_b_s', from: 'hop_1_broker', to: 'hop_2_self', mappings: [] },
      { id: 'edge_s_c', from: 'hop_2_self', to: 'hop_3_caps', mappings: [] },
    ],
  },
];
