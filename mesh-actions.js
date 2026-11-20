/**
 * MeshWeave Studio — Pure, DOM-free Action Definitions (Local & Cross-Site Action Bridge)
 * Strictly satisfies Cognizant runtime/actions.js checkSchema() and validateData().
 */

import { sha256Hex } from './runtime/web-crypto.js';
import { evaluateEdgeContract, evaluateNodeInputs } from './src/dag-engine.js';
import { canonicalJson, extractOrigin, sanitizeIdentifier } from './src/mesh-compiler.js';

function buildObjectSchemaFromFields(fields = [], isTarget = false) {
  const properties = {};
  const required = [];
  for (const field of fields) {
    const key = String(isTarget ? field.name : field.path).replace(/^\$\.?/, '').trim();
    if (!key) continue;
    // Support simple top-level or nested dot-path synthesis for validation
    const segments = key.split('.');
    let cursorProps = properties;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i === segments.length - 1) {
        cursorProps[seg] = { type: field.type || 'string' };
        if (isTarget && field.required) {
          required.push(seg);
        }
      } else {
        if (!cursorProps[seg] || cursorProps[seg].type !== 'object') {
          cursorProps[seg] = { type: 'object', properties: {}, additionalProperties: false };
        }
        cursorProps = cursorProps[seg].properties;
      }
    }
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

export function createMeshActionDefinitions({
  availability = 'local-only',
  callerOrigins = [],
} = {}) {
  return [
    {
      name: 'validate_edge_contract',
      description:
        'Validate whether an upstream Open Agentic Web bridge action output contract satisfies a downstream action inputSchema and edge field mappings. Changes nothing.',
      effect: 'read',
      availability,
      callerOrigins,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceAction', 'targetAction', 'sourceFields', 'targetInputs', 'mappings'],
        properties: {
          sourceAction: { type: 'string', minLength: 1, maxLength: 120 },
          targetAction: { type: 'string', minLength: 1, maxLength: 120 },
          sourceFields: {
            type: 'array',
            maxItems: 32,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'type'],
              properties: {
                path: { type: 'string', minLength: 1, maxLength: 120 },
                type: {
                  type: 'string',
                  enum: ['string', 'number', 'integer', 'boolean', 'array', 'object'],
                },
              },
            },
          },
          targetInputs: {
            type: 'array',
            maxItems: 32,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'type', 'required'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 120 },
                type: {
                  type: 'string',
                  enum: ['string', 'number', 'integer', 'boolean', 'array', 'object'],
                },
                required: { type: 'boolean' },
              },
            },
          },
          mappings: {
            type: 'array',
            maxItems: 32,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourcePath', 'targetArg'],
              properties: {
                sourcePath: { type: 'string', minLength: 1, maxLength: 120 },
                targetArg: { type: 'string', minLength: 1, maxLength: 120 },
              },
            },
          },
          staticKeys: {
            type: 'array',
            maxItems: 32,
            items: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
      },
      execute: async (args) => {
        const sourceNode = {
          id: 'upstream',
          actionName: args.sourceAction,
          outputSchema: buildObjectSchemaFromFields(args.sourceFields, false),
        };
        const staticArgs = {};
        for (const k of args.staticKeys || []) staticArgs[k] = true;
        const targetNode = {
          id: 'downstream',
          actionName: args.targetAction,
          inputSchema: buildObjectSchemaFromFields(args.targetInputs, true),
          staticArgs,
        };
        const edgeReport = evaluateEdgeContract(sourceNode, targetNode, args.mappings);
        const nodeCheck = evaluateNodeInputs(
          targetNode,
          [{ id: 'edge_1', from: 'upstream', to: 'downstream', mappings: args.mappings }],
          new Map([
            ['upstream', sourceNode],
            ['downstream', targetNode],
          ]),
        );
        return {
          sourceAction: args.sourceAction,
          targetAction: args.targetAction,
          compatible: edgeReport.compatible && nodeCheck.ready,
          status: edgeReport.status,
          missingRequired: nodeCheck.missingRequired,
          unknownTargets: edgeReport.unknownTargets,
          typeMismatchesCount: edgeReport.typeMismatches.length,
          checkedCount: edgeReport.details.length,
          details: edgeReport.details,
        };
      },
    },
    {
      name: 'compose_mesh_contract',
      description:
        'Compile a multi-hop bridge execution summary into an MVP Profile 0.3 allowed_peers set and canonical SHA-256 contract digest. Changes nothing.',
      effect: 'read',
      availability,
      callerOrigins,
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
                id: { type: 'string', minLength: 1, maxLength: 80 },
                partnerUrl: { type: 'string', minLength: 1, maxLength: 300 },
                actionName: { type: 'string', minLength: 1, maxLength: 120 },
                status: { type: 'string', minLength: 1, maxLength: 40 },
                latencyMs: { type: 'number', minimum: 0, maximum: 300000 },
              },
            },
          },
        },
      },
      execute: async (args) => {
        const cleanNet = sanitizeIdentifier(args.networkName);
        const allowedPeers = [...new Set(args.hops.map((h) => extractOrigin(h.partnerUrl)))].sort();
        const passedCount = args.hops.filter((h) => h.status === 'PASSED').length;
        const totalLatencyMs = args.hops.reduce((sum, h) => sum + (Number(h.latencyMs) || 0), 0);
        const summary = {
          mvpProfile: '0.3',
          networkName: cleanNet,
          allowedPeers,
          hopCount: args.hops.length,
          passedCount,
          totalLatencyMs,
          hops: args.hops.map((h) => ({
            id: h.id,
            origin: extractOrigin(h.partnerUrl),
            actionName: h.actionName,
            status: h.status,
          })),
        };
        const contractDigest = await sha256Hex(canonicalJson(summary));
        return {
          ...summary,
          contractDigest,
        };
      },
    },
    {
      name: 'get_meshweave_capabilities',
      description:
        'Return MeshWeave Studio bridge capabilities, supported Open Agentic Web protocols, and sample pipeline metadata. Changes nothing.',
      effect: 'read',
      availability,
      callerOrigins,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => ({
        brand: 'MeshWeave Studio',
        network: 'meshweave_composer',
        mvpProfile: '0.3',
        role: 'Cross-Site Open Agentic Web Workflow DAG Composer & Live Bridge Contract Prober',
        protocols: ['nsdeploy-actions-v1', 'open-agentic-web/mvp-0.3', 'nsdeploy-link/v1'],
        samplePipelineCount: 3,
      }),
    },
  ];
}

export function registerActions(actions) {
  for (const def of createMeshActionDefinitions({ availability: 'local-only', callerOrigins: [] })) {
    actions.register(def);
  }
}
