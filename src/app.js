/**
 * MeshWeave Studio — Main UI Application Controller
 */

import {
  executeDagWorkflow,
  probeBridgeChannel,
  resolveAbsoluteUrl,
  simulateRogueFrameAttack,
} from './bridge-runner.js';
import { auditComposableBundle } from './bridge-security.js';
import {
  DEFAULT_HOP_SLY_CONTEXT,
  evaluateEdgeContract,
  evaluateHopSlyBoundary,
  evaluateNodeInputs,
  reorderDagNodes,
  safeClone,
  toggleDagNode,
  validateDag,
} from './dag-engine.js';
import {
  buildShareableTrace,
  compileUnifiedBundle,
  compileWorkflowBundle,
  verifyShareableTrace,
} from './mesh-compiler.js';
import { PARTNER_PRESETS, SAMPLE_PIPELINES } from './presets.js';
import { ECOSYSTEM_DIRECTORY, probeSiteArtifacts } from './prober.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'dataset' && v && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const state = {
  dag: safeClone(SAMPLE_PIPELINES[0]),
  selection: { type: 'node', id: SAMPLE_PIPELINES[0].nodes[0].id },
  runState: new Map(),
  strictProtocol: false,
  runningDag: false,
  activeTab: 'composer',
  activeArtifact: 'network',
  lastCompiled: null,
  lastTrace: null,
  lastUnifiedBundle: null,
  lastTraceVerified: null,
  discovery: {
    url: 'https://cocvn157.github.io/nanda-seal',
    loading: false,
    error: null,
    probe: null,
    bridgeProbe: null,
  },
  matrixBusy: false,
};

const dom = {
  selfBridgePill: document.getElementById('self-bridge-pill'),
  tabs: [...document.querySelectorAll('.tab')],
  panels: [...document.querySelectorAll('.panel')],
  pipelineSelect: document.getElementById('pipeline-select'),
  pipelineDesc: document.getElementById('pipeline-description'),
  strictToggle: document.getElementById('strict-protocol-toggle'),
  btnRunDag: document.getElementById('btn-run-dag'),
  btnAddHop: document.getElementById('btn-open-add-hop'),
  btnAddEdge: document.getElementById('btn-open-add-edge'),
  btnResetRun: document.getElementById('btn-reset-run'),
  dagStatusBanner: document.getElementById('dag-status-banner'),
  dagCanvas: document.getElementById('dag-canvas'),
  dagEdgesSvg: document.getElementById('dag-edges-svg'),
  dagColumns: document.getElementById('dag-columns'),
  edgeBadgesLayer: document.getElementById('edge-badges-layer'),
  waterfallSummaryPill: document.getElementById('waterfall-summary-pill'),
  waterfallList: document.getElementById('waterfall-list'),
  inspectorContent: document.getElementById('inspector-content'),
  probeUrlInput: document.getElementById('probe-url-input'),
  btnProbeSingle: document.getElementById('btn-probe-single'),
  btnProbeMatrix: document.getElementById('btn-probe-matrix'),
  probeQuickChips: document.getElementById('probe-quick-chips'),
  singleProbeResults: document.getElementById('single-probe-results'),
  matrixSummaryBadge: document.getElementById('matrix-summary-badge'),
  matrixTbody: document.getElementById('matrix-tbody'),
  cfgNetworkName: document.getElementById('cfg-network-name'),
  cfgFrontMan: document.getElementById('cfg-front-man'),
  cfgMaxSteps: document.getElementById('cfg-max-steps'),
  cfgBindingMode: document.getElementById('cfg-binding-mode'),
  cfgSlyMode: document.getElementById('cfg-sly-mode'),
  compileBadge: document.getElementById('compile-validation-badge'),
  compileMessages: document.getElementById('compile-messages'),
  artifactPreview: document.getElementById('artifact-preview'),
  subtabs: [...document.querySelectorAll('.subtab')],
  btnVerifyTrace: document.getElementById('btn-verify-trace'),
  btnCopyArtifact: document.getElementById('btn-copy-artifact'),
  btnDownloadArtifact: document.getElementById('btn-download-artifact'),
  btnDownloadUnified: document.getElementById('btn-download-unified'),
  selfAuditPill: document.getElementById('self-audit-pill'),
  selfAuditList: document.getElementById('self-audit-list'),
  btnRunSelfAudit: document.getElementById('btn-run-self-audit'),
  rogueDrillPill: document.getElementById('rogue-drill-pill'),
  rogueDrillResults: document.getElementById('rogue-drill-results'),
  btnSimulateRogue: document.getElementById('btn-simulate-rogue'),
};

function switchTab(tabId, focusTab = false) {
  state.activeTab = tabId;
  for (const btn of dom.tabs) {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
    if (active && focusTab) btn.focus();
  }
  for (const panel of dom.panels) {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  }
  if (tabId === 'composer') {
    requestAnimationFrame(drawDagEdges);
  } else if (tabId === 'export') {
    void refreshExportTab();
  }
}

function loadPipelinePreset(presetId) {
  const found = SAMPLE_PIPELINES.find((p) => p.id === presetId) || SAMPLE_PIPELINES[0];
  state.dag = safeClone(found);
  state.runState.clear();
  state.selection = { type: 'node', id: state.dag.nodes[0]?.id || null };
  dom.cfgNetworkName.value = `${found.id}_network`;
  renderComposer();
  void refreshExportTab();
}

function getNodeStatusBadge(node) {
  const rec = state.runState.get(node.id);
  if (node.enabled === false && !rec) return { cls: 'warn', text: 'DISABLED' };
  if (!rec) return { cls: 'neutral', text: 'READY' };
  if (rec.status === 'RUNNING') return { cls: 'running', text: 'RUNNING…' };
  if (rec.status === 'PASSED') return { cls: 'pass', text: `PASSED · ${rec.latencyMs}ms` };
  if (rec.status === 'DISABLED') return { cls: 'warn', text: 'DISABLED' };
  if (rec.status === 'SKIPPED') return { cls: 'warn', text: 'SKIPPED' };
  return { cls: 'fail', text: 'FAILED' };
}

function renderWaterfallTracer(dagCheck, nodeById) {
  const orderedIds = dagCheck.order.length ? dagCheck.order : state.dag.nodes.map((n) => n.id);
  const records = orderedIds.map((id, idx) => {
    const node = nodeById.get(id);
    const rec = state.runState.get(id);
    const incoming = state.dag.edges.filter((e) => e.to === id);
    const edgeStatuses = incoming.map((e) =>
      evaluateEdgeContract(nodeById.get(e.from), node, e.mappings || []).status,
    );
    const schemaStatus =
      rec?.schemaStatus ||
      (edgeStatuses.length === 0
        ? 'ROOT'
        : edgeStatuses.includes('MISMATCH')
          ? 'MISMATCH'
          : edgeStatuses.includes('COERCIBLE')
            ? 'COERCIBLE'
            : edgeStatuses.includes('UNVERIFIED')
              ? 'UNVERIFIED'
              : 'MATCH');
    const slyAudit =
      rec?.slyAudit ||
      evaluateHopSlyBoundary(node?.proposedSlyData || DEFAULT_HOP_SLY_CONTEXT, node?.slyAllowlist || []);
    return { idx, node, rec, schemaStatus, slyAudit };
  });

  const maxRtt = Math.max(
    1,
    ...records.map((r) => Math.max(1, Number(r.rec?.latencyMs) || 0)),
  );
  const totalRtt = records.reduce((s, r) => s + (Number(r.rec?.latencyMs) || 0), 0);
  const liveCount = records.filter((r) => r.rec?.status === 'PASSED').length;
  const totalStripped = records.reduce((s, r) => s + (r.slyAudit?.strippedKeys?.length || 0), 0);

  if (state.runState.size === 0) {
    dom.waterfallSummaryPill.className = 'pill neutral';
    dom.waterfallSummaryPill.textContent = `${records.length} hop(s) staged · ${totalStripped} sly keys guarded`;
  } else {
    dom.waterfallSummaryPill.className = liveCount === records.filter((r) => r.node?.enabled !== false).length
      ? 'pill pass'
      : 'pill warn';
    dom.waterfallSummaryPill.textContent = `${liveCount} live hop(s) · ${totalRtt}ms RTT · ${totalStripped} sly keys stripped`;
  }

  dom.waterfallList.replaceChildren();
  for (const item of records) {
    const { idx, node, rec, schemaStatus, slyAudit } = item;
    if (!node) continue;
    const handshakeMs = Number(rec?.handshakeMs) || 0;
    const executeMs = Number(rec?.executeMs) || 0;
    const latencyMs = Number(rec?.latencyMs) || 0;
    const hsPct = rec?.status === 'PASSED' ? Math.max(4, Math.round((handshakeMs / maxRtt) * 100)) : 0;
    const exPct = rec?.status === 'PASSED' ? Math.max(4, Math.round((executeMs / maxRtt) * 100)) : 0;

    const protoLabel =
      rec?.status === 'PASSED'
        ? `${rec.wireProtocol} · ${rec.transport}`
        : rec?.status === 'DISABLED' || node.enabled === false
          ? 'DISABLED'
          : rec?.status || 'STAGED (MessageChannel)';

    const protoCls =
      rec?.status === 'PASSED'
        ? 'pass'
        : rec?.status === 'FAILED'
          ? 'fail'
          : rec?.status === 'DISABLED' || node.enabled === false
            ? 'warn'
            : 'neutral';

    const schemaCls =
      schemaStatus === 'MISMATCH' ? 'fail' : schemaStatus === 'COERCIBLE' || schemaStatus === 'UNVERIFIED' ? 'warn' : 'pass';

    dom.waterfallList.append(
      el(
        'div',
        { className: 'waterfall-row' },
        el(
          'div',
          { className: 'waterfall-top' },
          el('span', {
            className: 'waterfall-title',
            textContent: `Hop ${idx + 1}: ${node.partnerLabel || node.networkName} → ${node.actionName}`,
          }),
          el(
            'div',
            { className: 'waterfall-badges' },
            el('span', { className: `pill ${schemaCls}`, textContent: `Schema: ${schemaStatus}` }),
            el('span', { className: `pill ${protoCls}`, textContent: protoLabel }),
            el('span', {
              className: 'pill neutral',
              textContent: rec?.status === 'PASSED' ? `${latencyMs}ms` : node.enabled === false ? '0ms (OFF)' : 'pending',
            }),
          ),
        ),
        el(
          'div',
          {
            className: 'waterfall-bar-track',
            title: `Handshake ${handshakeMs}ms + Execute ${executeMs}ms = ${latencyMs}ms`,
          },
          hsPct > 0
            ? el('div', { className: 'waterfall-seg-handshake', style: `width:${Math.min(100, hsPct)}%` })
            : null,
          exPct > 0
            ? el('div', { className: 'waterfall-seg-execute', style: `width:${Math.min(100 - Math.min(100, hsPct), exPct)}%` })
            : null,
        ),
        el(
          'div',
          { className: 'waterfall-meta' },
          el('span', {
            textContent:
              rec?.status === 'PASSED'
                ? `handshake: ${handshakeMs}ms · execute: ${executeMs}ms · total: ${latencyMs}ms`
                : rec?.error || 'Ready for live hidden-iframe MessageChannel RPC',
          }),
          el('span', {
            textContent: `sly_data kept=[${slyAudit.permittedKeys.join(', ') || 'none'}] · stripped=[${slyAudit.strippedKeys.join(', ') || 'none'}]`,
          }),
        ),
      ),
    );
  }
}

function renderComposer() {
  const dagCheck = validateDag(state.dag.nodes, state.dag.edges);
  const nodeById = new Map(state.dag.nodes.map((n) => [n.id, n]));
  dom.pipelineDesc.textContent = state.dag.description || '';

  const runValues = [...state.runState.values()];
  const passedCount = runValues.filter((r) => r.status === 'PASSED').length;
  const failedCount = runValues.filter((r) => r.status === 'FAILED').length;
  const totalMs = runValues.reduce((s, r) => s + (r.latencyMs || 0), 0);

  if (!dagCheck.valid) {
    dom.dagStatusBanner.className = 'status-pill fail';
    dom.dagStatusBanner.textContent = `Invalid DAG: ${dagCheck.errors[0]}`;
  } else if (state.runningDag) {
    dom.dagStatusBanner.className = 'status-pill running';
    dom.dagStatusBanner.textContent = 'Executing cross-site action bridges…';
  } else if (runValues.length > 0) {
    dom.dagStatusBanner.className = failedCount > 0 ? 'status-pill fail' : 'status-pill pass';
    dom.dagStatusBanner.textContent = `${passedCount}/${state.dag.nodes.length} hops executed live · ${totalMs}ms total`;
  } else {
    const enabledCount = state.dag.nodes.filter((n) => n.enabled !== false).length;
    dom.dagStatusBanner.className = 'status-pill neutral';
    dom.dagStatusBanner.textContent = `${enabledCount}/${state.dag.nodes.length} active hops · ${state.dag.edges.length} edges · Acyclic DAG ready`;
  }

  dom.dagColumns.replaceChildren();
  const layers = dagCheck.layers.length > 0 ? dagCheck.layers : [state.dag.nodes];
  layers.forEach((layerNodes, layerIdx) => {
    const col = el('div', { className: 'dag-column' }, el('div', { className: 'layer-label', textContent: `Hop Layer ${layerIdx + 1}` }));
    for (const node of layerNodes) {
      const nodeIdx = state.dag.nodes.findIndex((n) => n.id === node.id);
      const incoming = state.dag.edges.filter((e) => e.to === node.id);
      const inputEval = evaluateNodeInputs(node, incoming, nodeById);
      const rec = state.runState.get(node.id);
      const badge = getNodeStatusBadge(node);
      const selected = state.selection.type === 'node' && state.selection.id === node.id;
      const isDisabled = node.enabled === false;

      let previewText = `args: ${JSON.stringify(node.staticArgs || {})}`;
      if (rec?.status === 'PASSED') {
        previewText = `out: ${JSON.stringify(rec.output)}`;
      } else if (rec?.error) {
        previewText = `err: ${rec.error}`;
      }

      const card = el(
        'div',
        {
          className: `hop-card${selected ? ' selected' : ''}${isDisabled ? ' status-disabled' : ''}${
            rec?.status === 'PASSED'
              ? ' status-passed'
              : rec?.status === 'FAILED'
                ? ' status-failed'
                : rec?.status === 'RUNNING'
                  ? ' status-running'
                  : ''
          }`,
          tabindex: '0',
          role: 'button',
          'aria-label': `Select hop ${node.partnerLabel || node.networkName} ${node.actionName}`,
          dataset: { nodeId: node.id },
          onClick: () => {
            state.selection = { type: 'node', id: node.id };
            renderComposer();
          },
          onKeydown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              state.selection = { type: 'node', id: node.id };
              renderComposer();
            }
          },
        },
        el(
          'div',
          { className: 'hop-top' },
          el('span', { className: 'hop-partner', textContent: node.partnerLabel || node.networkName }),
          el('span', { className: `pill ${badge.cls}`, textContent: badge.text }),
        ),
        el('div', { className: 'hop-action', textContent: node.actionName }),
        el(
          'div',
          { className: 'hop-meta' },
          el('span', { className: 'pill neutral', textContent: (node.effect || 'read').toUpperCase() }),
          el('span', {
            className: `pill ${inputEval.ready ? 'pass' : 'warn'}`,
            textContent: inputEval.ready ? 'CONTRACT OK' : `MISSING: ${inputEval.missingRequired.join(',') || 'EDGE'}`,
          }),
          rec?.wireProtocol && rec.wireProtocol !== 'none'
            ? el('span', { className: 'pill neutral', textContent: rec.wireProtocol })
            : null,
        ),
        el('div', { className: 'hop-preview', textContent: previewText }),
        el(
          'div',
          { className: 'hop-controls' },
          el('button', {
            type: 'button',
            className: 'hop-ctrl-btn',
            disabled: nodeIdx <= 0 || state.runningDag,
            title: 'Move hop earlier in DAG',
            textContent: '← Earlier',
            onClick: (ev) => {
              ev.stopPropagation();
              state.dag = reorderDagNodes(state.dag, node.id, 'earlier');
              state.runState.clear();
              renderComposer();
              void refreshExportTab();
            },
          }),
          el('button', {
            type: 'button',
            className: `hop-ctrl-btn${isDisabled ? ' off' : ''}`,
            disabled: state.runningDag,
            title: 'Toggle hop active/bypassed',
            textContent: isDisabled ? 'OFF' : 'ON',
            onClick: (ev) => {
              ev.stopPropagation();
              state.dag = toggleDagNode(state.dag, node.id);
              state.runState.clear();
              renderComposer();
              void refreshExportTab();
            },
          }),
          el('button', {
            type: 'button',
            className: 'hop-ctrl-btn',
            disabled: nodeIdx >= state.dag.nodes.length - 1 || state.runningDag,
            title: 'Move hop later in DAG',
            textContent: 'Later →',
            onClick: (ev) => {
              ev.stopPropagation();
              state.dag = reorderDagNodes(state.dag, node.id, 'later');
              state.runState.clear();
              renderComposer();
              void refreshExportTab();
            },
          }),
        ),
      );
      col.append(card);
    }
    dom.dagColumns.append(col);
  });

  renderWaterfallTracer(dagCheck, nodeById);
  renderInspector(nodeById);
  requestAnimationFrame(drawDagEdges);
}

function drawDagEdges() {
  const canvasRect = dom.dagCanvas.getBoundingClientRect();
  if (canvasRect.width === 0 || canvasRect.height === 0) return;

  dom.dagEdgesSvg.setAttribute('viewBox', `0 0 ${canvasRect.width} ${canvasRect.height}`);
  dom.dagEdgesSvg.replaceChildren();
  dom.edgeBadgesLayer.replaceChildren();

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'meshweave-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M 0 1 L 10 5 L 0 9 z');
  arrowPath.setAttribute('fill', '#38bdf8');
  marker.append(arrowPath);
  defs.append(marker);
  dom.dagEdgesSvg.append(defs);

  const nodeById = new Map(state.dag.nodes.map((n) => [n.id, n]));

  for (const edge of state.dag.edges) {
    const fromCard = dom.dagColumns.querySelector(`[data-node-id="${CSS.escape(edge.from)}"]`);
    const toCard = dom.dagColumns.querySelector(`[data-node-id="${CSS.escape(edge.to)}"]`);
    if (!fromCard || !toCard) continue;

    const r1 = fromCard.getBoundingClientRect();
    const r2 = toCard.getBoundingClientRect();
    const x1 = r1.right - canvasRect.left;
    const y1 = r1.top + r1.height / 2 - canvasRect.top;
    const x2 = r2.left - canvasRect.left;
    const y2 = r2.top + r2.height / 2 - canvasRect.top;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const contract = evaluateEdgeContract(
      nodeById.get(edge.from),
      nodeById.get(edge.to),
      edge.mappings || [],
    );
    const stroke =
      contract.status === 'MISMATCH'
        ? '#f43f5e'
        : contract.status === 'MATCH'
          ? '#10b981'
          : '#38bdf8';

    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', state.selection.type === 'edge' && state.selection.id === edge.id ? '3' : '2');
    path.setAttribute('marker-end', 'url(#meshweave-arrow)');
    dom.dagEdgesSvg.append(path);

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const maps = edge.mappings || [];
    const fullLabel = maps.length
      ? maps.map((m) => `${m.sourcePath}→${m.targetArg}`).join(', ')
      : 'sequence';
    const compactLabel =
      maps.length > 0
        ? `${contract.status} (${maps.length})`
        : 'sequence';

    const badge = el('button', {
      type: 'button',
      title: `${fullLabel} (${contract.status})`,
      className: `edge-badge ${contract.compatible ? 'match' : 'mismatch'}${
        state.selection.type === 'edge' && state.selection.id === edge.id ? ' selected' : ''
      }`,
      style: `left:${midX}px;top:${midY}px`,
      textContent: compactLabel,
      onClick: (ev) => {
        ev.stopPropagation();
        state.selection = { type: 'edge', id: edge.id };
        renderComposer();
      },
    });
    dom.edgeBadgesLayer.append(badge);
  }
}

function renderInspector(nodeById) {
  dom.inspectorContent.replaceChildren();

  if (state.selection.type === 'add-hop') {
    renderAddHopInspector();
    return;
  }
  if (state.selection.type === 'add-edge') {
    renderAddEdgeInspector();
    return;
  }
  if (state.selection.type === 'edge') {
    const edge = state.dag.edges.find((e) => e.id === state.selection.id);
    if (edge) {
      renderEdgeInspector(edge, nodeById);
      return;
    }
  }

  const node = nodeById.get(state.selection.id) || state.dag.nodes[0];
  if (!node) {
    dom.inspectorContent.append(el('div', { className: 'muted', textContent: 'No hops in DAG yet. Click "+ Add Partner Hop".' }));
    return;
  }
  renderNodeInspector(node, nodeById);
}

function renderNodeInspector(node, nodeById) {
  const rec = state.runState.get(node.id);
  const incoming = state.dag.edges.filter((e) => e.to === node.id);
  const inputEval = evaluateNodeInputs(node, incoming, nodeById);
  const slyAudit =
    rec?.slyAudit ||
    evaluateHopSlyBoundary(node.proposedSlyData || DEFAULT_HOP_SLY_CONTEXT, node.slyAllowlist || []);

  const argsInput = el('textarea', {
    className: 'textarea',
    rows: 4,
    'aria-label': 'Static input arguments JSON',
  });
  argsInput.value = JSON.stringify(node.staticArgs || {}, null, 2);

  const slyInput = el('input', {
    className: 'input',
    type: 'text',
    placeholder: 'request_id, caller_origin',
    'aria-label': 'Allowed sly_data keys for this hop',
  });
  slyInput.value = (node.slyAllowlist || []).join(', ');

  const errorLine = el('div', { className: 'muted', textContent: '' });

  dom.inspectorContent.append(
    el(
      'div',
      { className: 'inspector-header' },
      el('h3', { textContent: `Hop Inspector · ${node.id}` }),
      state.dag.nodes.length > 1
        ? el('button', {
            type: 'button',
            className: 'btn sm danger',
            textContent: 'Remove Hop',
            onClick: () => {
              state.dag.nodes = state.dag.nodes.filter((n) => n.id !== node.id);
              state.dag.edges = state.dag.edges.filter((e) => e.from !== node.id && e.to !== node.id);
              state.runState.delete(node.id);
              state.selection = { type: 'node', id: state.dag.nodes[0]?.id || null };
              renderComposer();
              void refreshExportTab();
            },
          })
        : null,
    ),
    el(
      'div',
      { className: 'inspector-section kv-grid' },
      el('span', { className: 'kv-key', textContent: 'Partner' }),
      el('span', { className: 'kv-val', textContent: `${node.partnerLabel} (${node.networkName})` }),
      el('span', { className: 'kv-key', textContent: 'Bridge URL' }),
      el('span', { className: 'kv-val', textContent: node.bridgeUrl }),
      el('span', { className: 'kv-key', textContent: 'Action' }),
      el('span', { className: 'kv-val', textContent: `${node.actionName} [${node.effect || 'read'}]` }),
      el('span', { className: 'kv-key', textContent: 'Contract' }),
      el('span', {
        className: 'kv-val',
        textContent: inputEval.ready
          ? 'All required inputs & edge schemas satisfied'
          : `Missing: ${inputEval.missingRequired.join(', ') || 'schema mismatch'}`,
      }),
      el('span', { className: 'kv-key', textContent: 'sly_data' }),
      el('span', {
        className: 'kv-val',
        textContent: `kept=[${slyAudit.permittedKeys.join(', ') || 'none'}] · stripped=[${slyAudit.strippedKeys.join(', ') || 'none'}]`,
      }),
    ),
    el(
      'div',
      { className: 'inspector-section form-stack' },
      el('span', { className: 'field-label', textContent: 'Hop sly_data Allowlist (comma-separated)' }),
      slyInput,
      el('span', { className: 'field-label', textContent: 'Static Input Arguments (JSON)' }),
      argsInput,
      errorLine,
      el(
        'div',
        { className: 'btn-row' },
        el('button', {
          type: 'button',
          className: 'btn sm secondary',
          textContent: 'Apply Hop Settings',
          onClick: () => {
            try {
              const parsed = JSON.parse(argsInput.value || '{}');
              node.staticArgs = parsed;
              node.slyAllowlist = slyInput.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              errorLine.textContent = 'Saved staticArgs & sly_data allowlist.';
              renderComposer();
              void refreshExportTab();
            } catch (e) {
              errorLine.textContent = `Invalid JSON: ${e.message}`;
            }
          },
        }),
      ),
    ),
    el(
      'div',
      { className: 'inspector-section' },
      el('span', { className: 'field-label', textContent: rec ? 'Live Bridge Execution Output' : 'Declared inputSchema' }),
      el('pre', {
        className: 'code-viewer',
        textContent: rec
          ? JSON.stringify(
              {
                status: rec.status,
                transport: rec.transport,
                wireProtocol: rec.wireProtocol,
                handshakeMs: rec.handshakeMs,
                executeMs: rec.executeMs,
                slyAudit: rec.slyAudit,
                appliedBindings: rec.appliedBindings,
                output: rec.output,
                error: rec.error,
              },
              null,
              2,
            )
          : JSON.stringify(node.inputSchema || {}, null, 2),
      }),
    ),
  );
}

function renderEdgeInspector(edge, nodeById) {
  const fromNode = nodeById.get(edge.from);
  const toNode = nodeById.get(edge.to);
  const contract = evaluateEdgeContract(fromNode, toNode, edge.mappings || []);

  const srcInput = el('input', { className: 'input', placeholder: '$.origin or $.siteUrl' });
  const dstInput = el('input', { className: 'input', placeholder: 'siteUrl or hops[1].partnerUrl' });

  const mappingsList = el('div', { className: 'form-stack' });
  (edge.mappings || []).forEach((m, idx) => {
    const detail = contract.details[idx];
    mappingsList.append(
      el(
        'div',
        { className: 'check-card' },
        el(
          'div',
          { className: 'check-card-top' },
          el('span', { textContent: `${m.sourcePath} → ${m.targetArg}` }),
          el('span', {
            className: `pill ${detail?.status === 'MATCH' ? 'pass' : detail?.status === 'MISMATCH' ? 'fail' : 'warn'}`,
            textContent: detail?.status || 'UNVERIFIED',
          }),
        ),
        el('div', { className: 'check-card-detail', textContent: detail?.reason || '' }),
        el(
          'div',
          { className: 'btn-row', style: 'margin-top:6px' },
          el('button', {
            type: 'button',
            className: 'btn sm danger',
            textContent: 'Remove Mapping',
            onClick: () => {
              edge.mappings.splice(idx, 1);
              renderComposer();
              void refreshExportTab();
            },
          }),
        ),
      ),
    );
  });

  dom.inspectorContent.append(
    el(
      'div',
      { className: 'inspector-header' },
      el('h3', { textContent: `Edge Contract · ${edge.from} → ${edge.to}` }),
      el('button', {
        type: 'button',
        className: 'btn sm danger',
        textContent: 'Delete Edge',
        onClick: () => {
          state.dag.edges = state.dag.edges.filter((e) => e.id !== edge.id);
          state.selection = { type: 'node', id: edge.from };
          renderComposer();
          void refreshExportTab();
        },
      }),
    ),
    el(
      'div',
      { className: 'inspector-section' },
      el('span', {
        className: `pill ${contract.compatible ? 'pass' : 'fail'}`,
        textContent: `Edge Status: ${contract.status}`,
      }),
    ),
    el('div', { className: 'inspector-section' }, mappingsList),
    el(
      'div',
      { className: 'inspector-section form-stack' },
      el('span', { className: 'field-label', textContent: 'Add Field Mapping' }),
      srcInput,
      dstInput,
      el('button', {
        type: 'button',
        className: 'btn sm primary',
        textContent: 'Add Field Mapping',
        onClick: () => {
          if (!srcInput.value.trim() || !dstInput.value.trim()) return;
          edge.mappings ||= [];
          edge.mappings.push({
            sourcePath: srcInput.value.trim(),
            targetArg: dstInput.value.trim(),
          });
          renderComposer();
          void refreshExportTab();
        },
      }),
    ),
  );
}

function renderAddHopInspector() {
  const urlInput = el('input', {
    className: 'input',
    type: 'url',
    value: state.discovery.url,
    placeholder: 'https://partner.example or ./',
  });
  urlInput.value = state.discovery.url;

  const chips = el('div', { className: 'chip-row' });
  for (const p of PARTNER_PRESETS) {
    chips.append(
      el('button', {
        type: 'button',
        className: 'chip',
        textContent: p.label,
        onClick: () => {
          state.discovery.url = p.siteBase;
          urlInput.value = p.siteBase;
        },
      }),
    );
  }

  const runDiscovery = async () => {
    state.discovery.url = urlInput.value.trim() || '.';
    state.discovery.loading = true;
    state.discovery.error = null;
    renderComposer();
    try {
      const probe = await probeSiteArtifacts(state.discovery.url);
      let bridgeProbe = null;
      if (probe.bridgeUrl) {
        bridgeProbe = await probeBridgeChannel(probe.bridgeUrl, {
          timeoutMs: 5500,
          allowLegacyAdapter: !state.strictProtocol,
        });
      }
      state.discovery.probe = probe;
      state.discovery.bridgeProbe = bridgeProbe;
    } catch (e) {
      state.discovery.error = e.message;
    } finally {
      state.discovery.loading = false;
      renderComposer();
    }
  };

  dom.inspectorContent.append(
    el(
      'div',
      { className: 'inspector-header' },
      el('h3', { textContent: 'Discover & Add Partner Bridge Hop' }),
      el('button', {
        type: 'button',
        className: 'btn sm ghost',
        textContent: 'Close',
        onClick: () => {
          state.selection = { type: 'node', id: state.dag.nodes[0]?.id || null };
          renderComposer();
        },
      }),
    ),
    el(
      'div',
      { className: 'inspector-section form-stack' },
      el('span', { className: 'field-label', textContent: 'Partner Site URL' }),
      urlInput,
      chips,
      el('button', {
        type: 'button',
        className: 'btn primary',
        disabled: state.discovery.loading,
        textContent: state.discovery.loading ? 'Connecting over MessageChannel…' : 'Discover Bridge Catalog',
        onClick: runDiscovery,
      }),
    ),
  );

  if (state.discovery.error) {
    dom.inspectorContent.append(el('div', { className: 'pill fail', textContent: state.discovery.error }));
    return;
  }

  const { probe, bridgeProbe } = state.discovery;
  if (!probe) return;

  const actions = bridgeProbe?.actions || [];
  if (!actions.length) {
    dom.inspectorContent.append(
      el(
        'div',
        { className: 'check-card' },
        el('div', { className: 'check-card-top' }, el('span', { textContent: probe.brand }), el('span', { className: 'pill warn', textContent: '0 Bridge Actions' })),
        el('div', {
          className: 'check-card-detail',
          textContent: bridgeProbe?.error || probe.bridgeDiagnostic,
        }),
      ),
    );
    return;
  }

  const actionSelect = el('select', { className: 'select' });
  actions.forEach((a) => actionSelect.append(el('option', { value: a.name, textContent: `${a.name} (${a.effect || 'read'})` })));
  const parentSelect = el('select', { className: 'select' }, el('option', { value: '', textContent: '(Root hop — no parent)' }));
  state.dag.nodes.forEach((n) => parentSelect.append(el('option', { value: n.id, textContent: `${n.id} (${n.actionName})` })));
  const argsBox = el('textarea', { className: 'textarea', rows: 4 });
  argsBox.value = '{}';

  dom.inspectorContent.append(
    el(
      'div',
      { className: 'inspector-section form-stack' },
      el('span', {
        className: 'pill pass',
        textContent: `${bridgeProbe.wireProtocol} · ${actions.length} action(s) discovered (${bridgeProbe.handshakeMs}ms)`,
      }),
      el('span', { className: 'field-label', textContent: 'Select Bridge Action' }),
      actionSelect,
      el('span', { className: 'field-label', textContent: 'Upstream Parent Hop (Optional)' }),
      parentSelect,
      el('span', { className: 'field-label', textContent: 'Initial Static Arguments (JSON)' }),
      argsBox,
      el('button', {
        type: 'button',
        className: 'btn primary',
        textContent: 'Add Hop to DAG',
        onClick: () => {
          const picked = actions.find((a) => a.name === actionSelect.value) || actions[0];
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(argsBox.value || '{}');
          } catch {
            return;
          }
          const newId = `hop_${state.dag.nodes.length + 1}_${picked.name.slice(0, 14)}`;
          state.dag.nodes.push({
            id: newId,
            partnerLabel: probe.brand,
            siteBase: probe.siteBase,
            networkName: probe.networkName,
            partnerNetworkUrl: `${probe.siteBase}/${probe.networkName}`,
            bridgeUrl: probe.bridgeUrl,
            actionName: picked.name,
            effect: picked.effect || 'read',
            enabled: true,
            slyAllowlist: ['request_id'],
            staticArgs: parsedArgs,
            inputSchema: picked.inputSchema || { type: 'object', properties: {} },
            outputSchema: picked.outputSchema || null,
          });
          if (parentSelect.value) {
            state.dag.edges.push({
              id: `edge_${parentSelect.value}_${newId}`,
              from: parentSelect.value,
              to: newId,
              mappings: [],
            });
          }
          state.selection = { type: 'node', id: newId };
          renderComposer();
          void refreshExportTab();
        },
      }),
    ),
  );
}

function renderAddEdgeInspector() {
  const fromSelect = el('select', { className: 'select' });
  const toSelect = el('select', { className: 'select' });
  for (const n of state.dag.nodes) {
    fromSelect.append(el('option', { value: n.id, textContent: `${n.id} (${n.actionName})` }));
    toSelect.append(el('option', { value: n.id, textContent: `${n.id} (${n.actionName})` }));
  }
  if (state.dag.nodes.length > 1) toSelect.selectedIndex = 1;
  const srcPath = el('input', { className: 'input', placeholder: '$.origin (optional)' });
  const dstArg = el('input', { className: 'input', placeholder: 'siteUrl (optional)' });
  const msg = el('div', { className: 'muted', textContent: '' });

  dom.inspectorContent.append(
    el(
      'div',
      { className: 'inspector-header' },
      el('h3', { textContent: 'Wire New DAG Edge' }),
      el('button', {
        type: 'button',
        className: 'btn sm ghost',
        textContent: 'Close',
        onClick: () => {
          state.selection = { type: 'node', id: state.dag.nodes[0]?.id || null };
          renderComposer();
        },
      }),
    ),
    el(
      'div',
      { className: 'form-stack' },
      el('span', { className: 'field-label', textContent: 'From Upstream Hop' }),
      fromSelect,
      el('span', { className: 'field-label', textContent: 'To Downstream Hop' }),
      toSelect,
      el('span', { className: 'field-label', textContent: 'Source JSON Path' }),
      srcPath,
      el('span', { className: 'field-label', textContent: 'Target Input Argument' }),
      dstArg,
      msg,
      el('button', {
        type: 'button',
        className: 'btn primary',
        textContent: 'Create Edge',
        onClick: () => {
          const newEdge = {
            id: `edge_${Date.now()}`,
            from: fromSelect.value,
            to: toSelect.value,
            mappings:
              srcPath.value.trim() && dstArg.value.trim()
                ? [{ sourcePath: srcPath.value.trim(), targetArg: dstArg.value.trim() }]
                : [],
          };
          const check = validateDag(state.dag.nodes, [...state.dag.edges, newEdge]);
          if (!check.valid) {
            msg.textContent = `Rejected: ${check.errors.join(' ')}`;
            return;
          }
          state.dag.edges.push(newEdge);
          state.selection = { type: 'edge', id: newEdge.id };
          renderComposer();
          void refreshExportTab();
        },
      }),
    ),
  );
}

async function runLiveDag() {
  if (state.runningDag) return;
  state.runningDag = true;
  state.runState.clear();
  dom.btnRunDag.disabled = true;
  renderComposer();

  try {
    await executeDagWorkflow(state.dag, {
      strictProtocol: state.strictProtocol,
      onNodeEvent: (ev) => {
        state.runState.set(ev.nodeId, ev);
        renderComposer();
      },
    });
  } catch (err) {
    dom.dagStatusBanner.className = 'status-pill fail';
    dom.dagStatusBanner.textContent = err.message;
  } finally {
    state.runningDag = false;
    dom.btnRunDag.disabled = false;
    renderComposer();
    await refreshExportTab();
  }
}

async function runSingleProbe(rawUrl) {
  dom.probeUrlInput.value = rawUrl;
  dom.singleProbeResults.replaceChildren(
    el('div', { className: 'muted', textContent: `Probing ${rawUrl} artifacts and action-bridge MessageChannel…` }),
  );
  const report = await probeSiteArtifacts(rawUrl);
  let bridgeLive = null;
  if (report.bridgeUrl && report.frameable) {
    bridgeLive = await probeBridgeChannel(report.bridgeUrl, {
      timeoutMs: 5500,
      allowLegacyAdapter: true,
    });
  }

  const grid = el('div', { className: 'checks-grid' });
  for (const c of report.checks) {
    grid.append(
      el(
        'div',
        { className: 'check-card' },
        el(
          'div',
          { className: 'check-card-top' },
          el('span', { textContent: c.label }),
          el('span', {
            className: `pill ${c.status === 'PASS' ? 'pass' : c.status === 'WARN' ? 'warn' : 'fail'}`,
            textContent: c.status,
          }),
        ),
        el('div', { className: 'check-card-detail', textContent: c.detail }),
      ),
    );
  }

  if (bridgeLive) {
    grid.append(
      el(
        'div',
        { className: 'check-card' },
        el(
          'div',
          { className: 'check-card-top' },
          el('span', { textContent: 'Live Iframe Bridge Handshake' }),
          el('span', {
            className: `pill ${
              !bridgeLive.connected ? 'fail' : bridgeLive.protocolMismatch ? 'warn' : 'pass'
            }`,
            textContent: bridgeLive.connected ? bridgeLive.wireProtocol : 'UNREACHABLE',
          }),
        ),
        el('div', {
          className: 'check-card-detail',
          textContent: bridgeLive.connected
            ? `Catalog actions (${bridgeLive.actions.length}): ${
                bridgeLive.actions.map((a) => `${a.name}[${a.effect}]`).join(', ') || 'none'
              } · handshake ${bridgeLive.handshakeMs}ms + catalog ${bridgeLive.catalogMs}ms`
            : bridgeLive.error,
        }),
      ),
    );
  }

  dom.singleProbeResults.replaceChildren(
    el(
      'div',
      { className: 'prober-header' },
      el(
        'div',
        {},
        el('h3', { textContent: `${report.brand} (${report.networkName})` }),
        el('div', { className: 'muted', textContent: `${report.siteBase} · front_man: ${report.frontMan || 'n/a'}` }),
      ),
      el('span', {
        className: `pill ${report.failCount === 0 ? 'pass' : 'fail'}`,
        textContent: `${report.passCount} PASS · ${report.failCount} FAIL · ${report.totalLatencyMs}ms`,
      }),
    ),
    grid,
  );
}

async function runEcosystemMatrix() {
  if (state.matrixBusy) return;
  state.matrixBusy = true;
  dom.btnProbeMatrix.disabled = true;
  dom.matrixSummaryBadge.className = 'pill running';
  dom.matrixSummaryBadge.textContent = 'Probing 9 live Open Agentic Web sites…';
  dom.matrixTbody.replaceChildren();

  const rows = await Promise.all(
    ECOSYSTEM_DIRECTORY.map(async (site) => {
      const report = await probeSiteArtifacts(site.siteBase);
      let bridgeLive = null;
      if (report.bridgeUrl && report.frameable) {
        bridgeLive = await probeBridgeChannel(report.bridgeUrl, {
          timeoutMs: 5000,
          allowLegacyAdapter: true,
        });
      }
      return { site, report, bridgeLive };
    }),
  );

  let readyMessageChannelCount = 0;
  for (const { site, report, bridgeLive } of rows) {
    const manifestCheck = report.checks.find((c) => c.id === 'manifest');
    const netCheck = report.checks.find((c) => c.id === 'network');
    const mcpText = report.mcpInfo.available
      ? `MCP: ${report.mcpInfo.tools.length} tool(s)`
      : `links: ${report.linksCount} · MCP: static`;

    let bridgePillCls = 'warn';
    let bridgeText = 'No Bridge';
    if (bridgeLive?.connected) {
      if (bridgeLive.actions.length > 0 && !bridgeLive.protocolMismatch) {
        readyMessageChannelCount += 1;
        bridgePillCls = 'pass';
        bridgeText = `MessageChannel · ${bridgeLive.actions.length} action(s)`;
      } else if (bridgeLive.actions.length > 0 && bridgeLive.protocolMismatch) {
        bridgePillCls = 'warn';
        bridgeText = `${bridgeLive.wireProtocol} · ${bridgeLive.actions.length} action(s)`;
      } else {
        bridgePillCls = 'neutral';
        bridgeText = `${bridgeLive.wireProtocol} · 0 actions`;
      }
    } else if (report.bridgeUrl && !report.frameable) {
      bridgePillCls = 'fail';
      bridgeText = 'Framing/Script Error';
    }

    const rttMs =
      report.totalLatencyMs + (bridgeLive ? (bridgeLive.handshakeMs || 0) + (bridgeLive.catalogMs || 0) : 0);

    dom.matrixTbody.append(
      el(
        'tr',
        {},
        el('td', {}, el('strong', { textContent: site.brand }), el('div', { className: 'muted', textContent: report.networkName })),
        el('td', {}, el('span', { className: `pill ${manifestCheck?.status === 'PASS' ? 'pass' : 'fail'}`, textContent: manifestCheck?.status || 'FAIL' })),
        el('td', {}, el('span', { className: `pill ${netCheck?.status === 'PASS' ? 'pass' : 'fail'}`, textContent: netCheck?.status || 'FAIL' })),
        el('td', { textContent: mcpText }),
        el('td', {}, el('span', { className: `pill ${bridgePillCls}`, textContent: bridgeText })),
        el('td', { textContent: `${rttMs}ms` }),
        el('td', { className: 'muted', textContent: bridgeLive?.connected && bridgeLive.actions.length > 0 ? bridgeLive.actions.map((a) => a.name).join(', ') : report.bridgeDiagnostic }),
      ),
    );
  }

  dom.matrixSummaryBadge.className = 'pill pass';
  dom.matrixSummaryBadge.textContent = `${rows.length} sites probed · ${readyMessageChannelCount} standard MessageChannel hubs`;
  dom.btnProbeMatrix.disabled = false;
  state.matrixBusy = false;
}

function renderSelfAudit() {
  if (!state.lastCompiled) return;
  const audit = auditComposableBundle({
    dag: state.dag,
    compiledBundle: state.lastCompiled,
    trace: state.lastTrace,
    traceVerified: state.lastTraceVerified?.valid ?? null,
  });

  dom.selfAuditPill.className = `pill ${audit.passedAll ? 'pass' : 'warn'}`;
  dom.selfAuditPill.textContent = `${audit.score}% (${audit.passedCount}/${audit.totalCount} PASS)`;

  dom.selfAuditList.replaceChildren();
  for (const chk of audit.checks) {
    dom.selfAuditList.append(
      el(
        'div',
        { className: 'check-card' },
        el(
          'div',
          { className: 'check-card-top' },
          el('span', { textContent: chk.label }),
          el('span', { className: `pill ${chk.passed ? 'pass' : 'fail'}`, textContent: chk.passed ? 'PASS' : 'FAIL' }),
        ),
        el('div', { className: 'check-card-detail', textContent: chk.detail }),
      ),
    );
  }
}

async function runRogueSecurityDrill() {
  dom.rogueDrillPill.className = 'pill running';
  dom.rogueDrillPill.textContent = 'Running live frame probes…';
  const report = await simulateRogueFrameAttack('./bridge/action-bridge.html');

  dom.rogueDrillPill.className = `pill ${report.allRejectedFailClosed ? 'pass' : 'fail'}`;
  dom.rogueDrillPill.textContent = report.allRejectedFailClosed
    ? `ALL ${report.vectors.length} ATTACKS REJECTED FAIL-CLOSED`
    : 'SECURITY FAILURE DETECTED';

  dom.rogueDrillResults.replaceChildren();
  for (const vec of report.vectors) {
    dom.rogueDrillResults.append(
      el(
        'div',
        { className: 'check-card' },
        el(
          'div',
          { className: 'check-card-top' },
          el('span', { textContent: vec.label }),
          el('span', {
            className: `pill ${vec.passedFailClosed ? 'pass' : 'fail'}`,
            textContent: vec.passedFailClosed ? 'FAIL-CLOSED' : 'EXPOSED',
          }),
        ),
        el('div', {
          className: 'check-card-detail',
          textContent: `[${vec.code}] ${vec.detail}`,
        }),
      ),
    );
  }
}

async function refreshExportTab() {
  const compiled = compileWorkflowBundle(state.dag, {
    networkName: dom.cfgNetworkName.value,
    frontMan: dom.cfgFrontMan.value,
    maxSteps: Number(dom.cfgMaxSteps.value),
    bindingMode: dom.cfgBindingMode.value,
    slyAllowlist: dom.cfgSlyMode.value === 'request_id' ? ['request_id'] : [],
    selfOrigin: globalThis.location?.origin || 'https://cocvn157.github.io',
    selfBaseUrl: resolveAbsoluteUrl('.').replace(/\/+$/, ''),
  });
  state.lastCompiled = compiled;

  const trace = await buildShareableTrace({
    dag: state.dag,
    runResults: [...state.runState.values()],
    compiledBundle: compiled,
  });
  state.lastTrace = trace;
  state.lastTraceVerified = await verifyShareableTrace(trace);
  state.lastUnifiedBundle = compileUnifiedBundle({ compiledBundle: compiled, trace });

  const { ok, errors, warnings } = compiled.validation;
  dom.compileBadge.className = `pill ${ok ? 'pass' : 'fail'}`;
  dom.compileBadge.textContent = ok
    ? `Valid MVP 0.3 Bundle (0 errors, ${warnings.length} warnings)`
    : `${errors.length} error(s), ${warnings.length} warning(s)`;

  const msgs = [...errors.map((e) => `ERROR: ${e}`), ...warnings.map((w) => `WARN: ${w}`)];
  dom.compileMessages.textContent = msgs.join(' | ');

  renderActiveArtifactPreview();
  renderSelfAudit();
}

function renderActiveArtifactPreview() {
  if (!state.lastCompiled) return;
  let obj = state.lastCompiled.networkJson;
  if (state.activeArtifact === 'manifest') obj = state.lastCompiled.manifestJson;
  else if (state.activeArtifact === 'links') obj = state.lastCompiled.linksJson;
  else if (state.activeArtifact === 'trace') obj = state.lastTrace;
  else if (state.activeArtifact === 'bundle') obj = state.lastUnifiedBundle;
  dom.artifactPreview.textContent = JSON.stringify(obj, null, 2);
}

async function initSelfBridgeBadge() {
  try {
    const res = await probeBridgeChannel('./bridge/action-bridge.html', { timeoutMs: 9000 });
    if (res.connected && res.actions.length > 0) {
      dom.selfBridgePill.className = 'pill pass';
      dom.selfBridgePill.textContent = `Self-Bridge Ready · ${res.wireProtocol} (${res.actions.length} actions · ${res.handshakeMs}ms)`;
    } else {
      dom.selfBridgePill.className = 'pill warn';
      dom.selfBridgePill.textContent = `Self-Bridge: ${res.error || '0 actions'}`;
    }
  } catch (e) {
    dom.selfBridgePill.className = 'pill warn';
    dom.selfBridgePill.textContent = `Self-Bridge unavailable: ${e.message}`;
  }
}

function wireEvents() {
  dom.tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    tab.addEventListener('keydown', (ev) => {
      let next = -1;
      if (ev.key === 'ArrowRight') next = (idx + 1) % dom.tabs.length;
      else if (ev.key === 'ArrowLeft') next = (idx - 1 + dom.tabs.length) % dom.tabs.length;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = dom.tabs.length - 1;
      if (next >= 0) {
        ev.preventDefault();
        switchTab(dom.tabs[next].dataset.tab, true);
      }
    });
  });

  for (const p of SAMPLE_PIPELINES) {
    dom.pipelineSelect.append(el('option', { value: p.id, textContent: p.name }));
  }
  dom.pipelineSelect.addEventListener('change', () => loadPipelinePreset(dom.pipelineSelect.value));
  dom.strictToggle.addEventListener('change', () => {
    state.strictProtocol = dom.strictToggle.checked;
  });
  dom.btnRunDag.addEventListener('click', () => void runLiveDag());
  dom.btnAddHop.addEventListener('click', () => {
    state.selection = { type: 'add-hop', id: null };
    renderComposer();
  });
  dom.btnAddEdge.addEventListener('click', () => {
    state.selection = { type: 'add-edge', id: null };
    renderComposer();
  });
  dom.btnResetRun.addEventListener('click', () => {
    loadPipelinePreset(dom.pipelineSelect.value || SAMPLE_PIPELINES[0].id);
  });

  for (const site of ECOSYSTEM_DIRECTORY) {
    dom.probeQuickChips.append(
      el('button', {
        type: 'button',
        className: 'chip',
        textContent: site.brand,
        onClick: () => void runSingleProbe(site.siteBase),
      }),
    );
  }
  dom.btnProbeSingle.addEventListener('click', () => void runSingleProbe(dom.probeUrlInput.value.trim() || '.'));
  dom.btnProbeMatrix.addEventListener('click', () => void runEcosystemMatrix());

  for (const input of [
    dom.cfgNetworkName,
    dom.cfgFrontMan,
    dom.cfgMaxSteps,
    dom.cfgBindingMode,
    dom.cfgSlyMode,
  ]) {
    input.addEventListener('input', () => void refreshExportTab());
    input.addEventListener('change', () => void refreshExportTab());
  }

  for (const st of dom.subtabs) {
    st.addEventListener('click', () => {
      state.activeArtifact = st.dataset.artifact;
      for (const b of dom.subtabs) {
        const active = b === st;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      }
      renderActiveArtifactPreview();
    });
  }

  dom.btnVerifyTrace.addEventListener('click', async () => {
    if (!state.lastTrace) return;
    const res = await verifyShareableTrace(state.lastTrace);
    state.lastTraceVerified = res;
    dom.compileMessages.textContent = res.valid
      ? `TRACE VERIFIED: ${res.reason}`
      : `TRACE INVALID: ${res.reason}`;
    renderSelfAudit();
  });

  dom.btnCopyArtifact.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(dom.artifactPreview.textContent || '');
    dom.btnCopyArtifact.textContent = 'Copied!';
    setTimeout(() => {
      dom.btnCopyArtifact.textContent = 'Copy JSON';
    }, 1500);
  });

  dom.btnDownloadArtifact.addEventListener('click', () => {
    if (!state.lastCompiled) return;
    const names = {
      network: `${state.lastCompiled.networkName}.network.json`,
      manifest: 'agent-manifest.json',
      links: 'links.json',
      trace: 'meshweave-trace.json',
      bundle: `${state.lastCompiled.networkName}.bundle.json`,
    };
    const blob = new Blob([dom.artifactPreview.textContent || '{}'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = names[state.activeArtifact] || 'meshweave-artifact.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  dom.btnDownloadUnified.addEventListener('click', () => {
    if (!state.lastUnifiedBundle) return;
    const blob = new Blob([JSON.stringify(state.lastUnifiedBundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.lastCompiled?.networkName || 'meshweave'}-unified-bundle.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  dom.btnRunSelfAudit.addEventListener('click', () => void refreshExportTab());
  dom.btnSimulateRogue.addEventListener('click', () => void runRogueSecurityDrill());

  window.addEventListener('resize', () => {
    if (state.activeTab === 'composer') requestAnimationFrame(drawDagEdges);
  });
}

wireEvents();
loadPipelinePreset(SAMPLE_PIPELINES[0].id);
void initSelfBridgeBadge();
