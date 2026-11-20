/**
 * MeshWeave Studio — Pure Multi-Hop Workflow DAG Engine & Schema Contract Matcher
 * Zero DOM dependencies. Runs identically in Node.js 22+ and modern browsers.
 */

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function safeClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value), (key, v) => {
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`Unsafe object key "${key}" rejected.`);
    }
    return v;
  });
}

/**
 * Resolve a dot/bracket JSON path (e.g. "$.specReport.score", "origin", "items[0].name")
 * against an arbitrary plain object/array.
 */
export function resolveJsonPath(source, pathExpr) {
  if (source == null || typeof pathExpr !== 'string') return undefined;
  const cleaned = pathExpr.trim().replace(/^\$\.?/, '');
  if (!cleaned) return source;
  const tokens = [];
  for (const part of cleaned.split('.')) {
    if (!part) continue;
    const bracketMatches = [...part.matchAll(/([^\[\]]+)|\[(\d+)\]/g)];
    for (const m of bracketMatches) {
      tokens.push(m[1] !== undefined ? m[1] : Number(m[2]));
    }
  }
  let cursor = source;
  for (const token of tokens) {
    if (cursor == null) return undefined;
    if (typeof token === 'number') {
      if (!Array.isArray(cursor) || token < 0 || token >= cursor.length) return undefined;
      cursor = cursor[token];
    } else {
      if (UNSAFE_KEYS.has(token) || !Object.hasOwn(cursor, token)) return undefined;
      cursor = cursor[token];
    }
  }
  return cursor;
}

/**
 * Lookup the declared JSON Schema node at a dot path within a schema object.
 */
export function lookupSchemaPath(schema, pathExpr) {
  if (!isPlainObject(schema) || typeof pathExpr !== 'string') return null;
  const cleaned = pathExpr.trim().replace(/^\$\.?/, '');
  if (!cleaned) return schema;
  const parts = cleaned.split('.').filter(Boolean);
  let current = schema;
  for (const part of parts) {
    const arrayMatch = part.match(/^([^\[\]]+)\[\d+\]$/);
    const key = arrayMatch ? arrayMatch[1] : part;
    if (!isPlainObject(current) || current.type !== 'object' || !isPlainObject(current.properties)) {
      return null;
    }
    if (!Object.hasOwn(current.properties, key)) return null;
    current = current.properties[key];
    if (arrayMatch) {
      if (current?.type !== 'array' || !isPlainObject(current.items)) return null;
      current = current.items;
    }
  }
  return current;
}

export function inferTypeFromValue(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'number') return Number.isInteger(val) ? 'integer' : 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'string') return 'string';
  if (typeof val === 'object') return 'object';
  return 'unknown';
}

function isTypeCompatible(sourceType, targetType) {
  if (!sourceType || !targetType) return { ok: true, coercible: false };
  if (sourceType === targetType) return { ok: true, coercible: false };
  if (sourceType === 'integer' && targetType === 'number') return { ok: true, coercible: false };
  if (targetType === 'string' && ['number', 'integer', 'boolean'].includes(sourceType)) {
    return { ok: true, coercible: true };
  }
  return { ok: false, coercible: false };
}

/**
 * Topological sort + cycle detection + layer assignment using Kahn's algorithm.
 */
export function validateDag(nodes = [], edges = []) {
  const errors = [];
  const nodeMap = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim()) {
      errors.push('Every DAG node must have a non-empty string id.');
      continue;
    }
    if (nodeMap.has(node.id)) {
      errors.push(`Duplicate DAG node id "${node.id}".`);
      continue;
    }
    nodeMap.set(node.id, node);
  }

  const inDegree = new Map();
  const adj = new Map();
  const revAdj = new Map();
  for (const id of nodeMap.keys()) {
    inDegree.set(id, 0);
    adj.set(id, []);
    revAdj.set(id, []);
  }

  for (const edge of edges) {
    if (!edge || !nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      errors.push(`Edge references missing node: "${edge?.from}" -> "${edge?.to}".`);
      continue;
    }
    if (edge.from === edge.to) {
      errors.push(`Self-loop detected on node "${edge.from}".`);
      continue;
    }
    adj.get(edge.from).push(edge.to);
    revAdj.get(edge.to).push(edge.from);
    inDegree.set(edge.to, inDegree.get(edge.to) + 1);
  }

  const queue = [];
  const layerMap = new Map();
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
      layerMap.set(id, 0);
    }
  }

  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);
    const baseLayer = layerMap.get(current) ?? 0;
    for (const next of adj.get(current)) {
      const nextLayer = Math.max(layerMap.get(next) ?? 0, baseLayer + 1);
      layerMap.set(next, nextLayer);
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  const cycleNodes = [...nodeMap.keys()].filter((id) => !order.includes(id));
  if (cycleNodes.length > 0) {
    errors.push(`Cycle detected involving node(s): ${cycleNodes.join(', ')}.`);
  }

  const layers = [];
  for (const id of order) {
    const col = layerMap.get(id) ?? 0;
    if (!layers[col]) layers[col] = [];
    layers[col].push(nodeMap.get(id));
  }

  return {
    valid: errors.length === 0 && cycleNodes.length === 0,
    order,
    layers,
    cycleNodes,
    errors,
  };
}

/**
 * Evaluate edge compatibility between an upstream node and downstream node.
 */
export function evaluateEdgeContract(sourceNode, targetNode, mappings = []) {
  const targetSchema = targetNode?.inputSchema || null;
  const targetProps = targetSchema?.properties || {};
  const strictProps = targetSchema?.additionalProperties === false || isPlainObject(targetSchema?.properties);
  const unknownTargets = [];
  const typeMismatches = [];
  const mappingDetails = [];
  let hasCoercible = false;
  let hasUnverified = false;

  for (const mapping of mappings) {
    const sourcePath = String(mapping?.sourcePath || '').trim();
    const targetArg = String(mapping?.targetArg || '').trim();
    if (!sourcePath || !targetArg) continue;

    const topTargetKey = targetArg.split(/[.[]/)[0];
    const targetPropSchema = lookupSchemaPath(targetSchema, targetArg) || targetProps[targetArg] || null;
    if (strictProps && !targetPropSchema && !Object.hasOwn(targetProps, topTargetKey)) {
      unknownTargets.push(targetArg);
      mappingDetails.push({
        sourcePath,
        targetArg,
        status: 'MISMATCH',
        reason: `Target argument "${targetArg}" is not declared in ${targetNode?.actionName || 'target'} inputSchema.`,
      });
      continue;
    }

    const targetType = targetPropSchema?.type || null;

    let sourceType = null;
    let sourceSource = 'unverified';
    if (sourceNode?.outputSchema) {
      const outSchema = lookupSchemaPath(sourceNode.outputSchema, sourcePath);
      if (outSchema?.type) {
        sourceType = outSchema.type;
        sourceSource = 'outputSchema';
      }
    }
    if (!sourceType && sourceNode?.lastOutput !== undefined) {
      const liveVal = resolveJsonPath(sourceNode.lastOutput, sourcePath);
      if (liveVal !== undefined) {
        sourceType = inferTypeFromValue(liveVal);
        sourceSource = 'liveOutput';
      }
    }
    if (!sourceType && sourceNode?.sampleOutput !== undefined) {
      const sampleVal = resolveJsonPath(sourceNode.sampleOutput, sourcePath);
      if (sampleVal !== undefined) {
        sourceType = inferTypeFromValue(sampleVal);
        sourceSource = 'sampleOutput';
      }
    }

    if (!sourceType) {
      hasUnverified = true;
      mappingDetails.push({
        sourcePath,
        targetArg,
        status: 'UNVERIFIED',
        reason: `Source path "${sourcePath}" has no static outputSchema or observed sample value yet.`,
      });
      continue;
    }

    const compat = isTypeCompatible(sourceType, targetType);
    if (!compat.ok) {
      typeMismatches.push({ sourcePath, targetArg, sourceType, targetType });
      mappingDetails.push({
        sourcePath,
        targetArg,
        status: 'MISMATCH',
        reason: `Type mismatch (${sourceSource}): ${sourceType} cannot satisfy ${targetType}.`,
      });
    } else if (compat.coercible) {
      hasCoercible = true;
      mappingDetails.push({
        sourcePath,
        targetArg,
        status: 'COERCIBLE',
        reason: `Coercible (${sourceSource}): ${sourceType} -> ${targetType}.`,
      });
    } else {
      mappingDetails.push({
        sourcePath,
        targetArg,
        status: 'MATCH',
        reason: `Exact match (${sourceSource}): ${sourceType} -> ${targetType || 'any'}.`,
      });
    }
  }

  let status = 'MATCH';
  if (unknownTargets.length > 0 || typeMismatches.length > 0) {
    status = 'MISMATCH';
  } else if (hasCoercible) {
    status = 'COERCIBLE';
  } else if (hasUnverified && mappings.length > 0) {
    status = 'UNVERIFIED';
  }

  return {
    compatible: unknownTargets.length === 0 && typeMismatches.length === 0,
    status,
    unknownTargets,
    typeMismatches,
    details: mappingDetails,
  };
}

/**
 * Evaluate required input arguments across a whole node given incoming edges & staticArgs.
 */
export function evaluateNodeInputs(node, incomingEdges = [], nodeById = new Map()) {
  const schema = node?.inputSchema || null;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const staticArgs = isPlainObject(node?.staticArgs) ? node.staticArgs : {};
  const mappedFields = new Set();
  for (const edge of incomingEdges) {
    for (const m of edge.mappings || []) {
      if (m?.targetArg) mappedFields.add(String(m.targetArg).split(/[.[]/)[0]);
    }
  }
  const missingRequired = required.filter(
    (key) => !Object.hasOwn(staticArgs, key) && !mappedFields.has(key),
  );
  const edgeReports = incomingEdges.map((edge) => ({
    edgeId: edge.id,
    from: edge.from,
    to: edge.to,
    ...evaluateEdgeContract(nodeById.get(edge.from), node, edge.mappings || []),
  }));
  return {
    ready: missingRequired.length === 0 && edgeReports.every((r) => r.compatible),
    missingRequired,
    edgeReports,
  };
}

/**
 * Set a dot/bracket JSON path (e.g. "hops[0].partnerUrl" or "siteUrl") on a cloned target object.
 */
export function setByPath(target, pathExpr, value) {
  const cleaned = String(pathExpr || '').trim().replace(/^\$\.?/, '');
  if (!cleaned) return;
  const tokens = [];
  for (const part of cleaned.split('.')) {
    if (!part) continue;
    const bracketMatches = [...part.matchAll(/([^\[\]]+)|\[(\d+)\]/g)];
    for (const m of bracketMatches) {
      tokens.push(m[1] !== undefined ? m[1] : Number(m[2]));
    }
  }
  if (tokens.length === 0) return;
  let cursor = target;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    if (typeof token === 'string' && UNSAFE_KEYS.has(token)) {
      throw new Error(`Unsafe target key "${token}" rejected.`);
    }
    if (cursor[token] === undefined || cursor[token] === null || typeof cursor[token] !== 'object') {
      cursor[token] = typeof nextToken === 'number' ? [] : {};
    }
    cursor = cursor[token];
  }
  const last = tokens[tokens.length - 1];
  if (typeof last === 'string' && UNSAFE_KEYS.has(last)) {
    throw new Error(`Unsafe target key "${last}" rejected.`);
  }
  cursor[last] = safeClone(value);
}

/**
 * Resolve runtime arguments for a node from its staticArgs and upstream hop outputs.
 */
export function resolveNodeArguments(node, incomingEdges = [], outputsByNodeId = new Map()) {
  const args = isPlainObject(node?.staticArgs) ? safeClone(node.staticArgs) : {};
  const appliedBindings = [];
  for (const edge of incomingEdges) {
    const upstreamOutput = outputsByNodeId.get(edge.from);
    for (const mapping of edge.mappings || []) {
      const targetArg = String(mapping?.targetArg || '').trim();
      const sourcePath = String(mapping?.sourcePath || '').trim();
      if (!targetArg || !sourcePath) continue;
      const topKey = targetArg.split(/[.[]/)[0];
      if (UNSAFE_KEYS.has(topKey)) continue;
      let val = resolveJsonPath(upstreamOutput, sourcePath);
      if (val === undefined) {
        throw new Error(
          `Edge "${edge.from} -> ${edge.to}" could not resolve "${sourcePath}" from upstream output.`,
        );
      }
      const targetProp = lookupSchemaPath(node?.inputSchema, targetArg);
      const targetType = targetProp?.type;
      if (targetType === 'string' && typeof val !== 'string') {
        val = String(val);
      }
      setByPath(args, targetArg, val);
      appliedBindings.push({ from: edge.from, sourcePath, targetArg, value: val });
    }
  }
  return { args, appliedBindings };
}
