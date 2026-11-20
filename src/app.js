/**
 * MeshWeave Studio — Main UI Application Controller
 */

import { executeDagWorkflow, probeBridgeChannel, resolveAbsoluteUrl } from './bridge-runner.js';
import {
  evaluateEdgeContract,
  evaluateNodeInputs,
  safeClone,
  validateDag,
} from './dag-engine.js';
import { buildShareableTrace, compileWorkflowBundle } from './mesh-compiler.js';
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
  btnCopyArtifact: document.getElementById('btn-copy-artifact'),
  btnDownloadArtifact: document.getElementById('btn-download-artifact'),
};

function switchTab(tabId) {
  state.activeTab = tabId;
  for (const btn of dom.tabs) {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
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

function getNodeStatusBadge(nodeId) {
  const rec = state.runState.get(nodeId);
  if (!rec) return { cls: 'neutral', text: 'READY' };
  if (rec.status === 'RUNNING') return { cls: 'running', text: 'RUNNING…' };
  if (rec.status === 'PASSED') return { cls: 'pass', text: `PASSED · ${rec.latencyMs}ms` };
  if (rec.status === 'SKIPPED') return { cls: 'warn', text: 'SKIPPED' };
  return { cls: 'fail', text: 'FAILED' };
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
    dom.dagStatusBanner.className = 'status-pill neutral';
    dom.dagStatusBanner.textContent = `${state.dag.nodes.length} hops · ${state.dag.edges.length} edges · Acyclic DAG ready`;
  }

  dom.dagColumns.replaceChildren();
  const layers = dagCheck.layers.length > 0 ? dagCheck.layers : [state.dag.nodes];
  layers.forEach((layerNodes, layerIdx) => {
    const col = el('div', { className: 'dag-column' }, el('div', { className: 'layer-label', textContent: `Hop Layer ${layerIdx + 1}` }));
    for (const node of layerNodes) {
      const incoming = state.dag.edges.filter((e) => e.to === node.id);
      const inputEval = evaluateNodeInputs(node, incoming, nodeById);
      const rec = state.runState.get(node.id);
      const badge = getNodeStatusBadge(node.id);
      const selected = state.selection.type === 'node' && state.selection.id === node.id;

      let previewText = `args: ${JSON.stringify(node.staticArgs || {})}`;
      if (rec?.status === 'PASSED') {
        previewText = `out: ${JSON.stringify(rec.output)}`;
      } else if (rec?.error) {
        previewText = `err: ${rec.error}`;
      }

      const card = el(
        'div',
        {
          className: `hop-card${selected ? ' selected' : ''}${
            rec?.status === 'PASSED'
              ? ' status-passed'
              : rec?.status === 'FAILED'
                ? ' status-failed'
                : rec?.status === 'RUNNING'
                  ? ' status-running'
                  : ''
          }`,
          dataset: { nodeId: node.id },
          onClick: () => {
            state.selection = { type: 'node', id: node.id };
            renderComposer();
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
          rec?.wireProtocol
            ? el('span', { className: 'pill neutral', textContent: rec.wireProtocol })
            : null,
        ),
        el('div', { className: 'hop-preview', textContent: previewText }),
      );
      col.append(card);
    }
    dom.dagColumns.append(col);
  });

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
      maps.length > 1
        ? `${maps.length} bindings · ${contract.status}`
        : `${fullLabel} · ${contract.status}`;

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
  const argsInput = el('textarea', {
    className: 'textarea',
    rows: 5,
    textContent: JSON.stringify(node.staticArgs || {}, null, 2),
  });
  argsInput.value = JSON.stringify(node.staticArgs || {}, null, 2);

  const errorLine = el('div', { className: 'muted', textContent: '' });

  dom.inspectorContent.append(
    el(
      'div',
      { className: 'inspector-header' },
      el('h3', { textContent: `Hop Inspector · ${node.id}` }),
      state.dag.nodes.length > 1
        ? el('button', {
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
    ),
    el(
      'div',
      { className: 'inspector-section form-stack' },
      el('span', { className: 'field-label', textContent: 'Static Input Arguments (JSON)' }),
      argsInput,
      errorLine,
      el(
        'div',
        { className: 'btn-row' },
        el('button', {
          className: 'btn sm secondary',
          textContent: 'Apply Static Args',
          onClick: () => {
            try {
              const parsed = JSON.parse(argsInput.value || '{}');
              node.staticArgs = parsed;
              errorLine.textContent = 'Saved staticArgs.';
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

  const { ok, errors, warnings } = compiled.validation;
  dom.compileBadge.className = `pill ${ok ? 'pass' : 'fail'}`;
  dom.compileBadge.textContent = ok
    ? `Valid MVP 0.3 Bundle (0 errors, ${warnings.length} warnings)`
    : `${errors.length} error(s), ${warnings.length} warning(s)`;

  const msgs = [...errors.map((e) => `ERROR: ${e}`), ...warnings.map((w) => `WARN: ${w}`)];
  dom.compileMessages.textContent = msgs.join(' | ');

  renderActiveArtifactPreview();
}

function renderActiveArtifactPreview() {
  if (!state.lastCompiled) return;
  let obj = state.lastCompiled.networkJson;
  if (state.activeArtifact === 'manifest') obj = state.lastCompiled.manifestJson;
  else if (state.activeArtifact === 'links') obj = state.lastCompiled.linksJson;
  else if (state.activeArtifact === 'trace') obj = state.lastTrace;
  dom.artifactPreview.textContent = JSON.stringify(obj, null, 2);
}

async function initSelfBridgeBadge() {
  try {
    const res = await probeBridgeChannel('./bridge/action-bridge.html', { timeoutMs: 4000 });
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
  for (const tab of dom.tabs) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }
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
    state.runState.clear();
    renderComposer();
    void refreshExportTab();
  });

  for (const site of ECOSYSTEM_DIRECTORY) {
    dom.probeQuickChips.append(
      el('button', {
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
      for (const b of dom.subtabs) b.classList.toggle('active', b === st);
      renderActiveArtifactPreview();
    });
  }

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
    };
    const blob = new Blob([dom.artifactPreview.textContent || '{}'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = names[state.activeArtifact] || 'meshweave-artifact.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  window.addEventListener('resize', () => {
    if (state.activeTab === 'composer') requestAnimationFrame(drawDagEdges);
  });
}

wireEvents();
loadPipelinePreset(SAMPLE_PIPELINES[0].id);
void initSelfBridgeBadge();
