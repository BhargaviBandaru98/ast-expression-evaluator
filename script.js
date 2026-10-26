// ---------------- state ----------------
let calculationHistory = []; // {expr, result}
let currentAST = null;
let animation = { steps: [], idx: 0, playing: false, timer: null };
let tac = []; // three-address code array

const HISTORY_KEY = 'exprHistoryV1';
const STEP_DELAY_MS = 700;

// ---------------- tokenizer (lexical analysis) ----------------
function tokenize(expression) {
  const tokens = [];
  let i = 0;
  const n = expression.length;
  while (i < n) {
    const ch = expression[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch)) {
      let num = ch;
      i++;
      while (i < n && /[0-9]/.test(expression[i])) num += expression[i++];
      tokens.push({ type: 'NUMBER', value: parseInt(num, 10) });
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ type: ch, value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i + 1}`);
  }
  if (!tokens.length) throw new Error('Empty expression');
  return tokens;
}

// ---------------- parser (recursive descent) ----------------
// E -> T (('+' | '-') T)*
// T -> F (('*' | '/') F)*
// F -> '-' F | '(' E ')' | num
function parse(tokens) {
  let index = 0;

  function peek() { return tokens[index]; }
  function describe(t) { return t ? (t.type === 'NUMBER' ? `number ${t.value}` : `'${t.type}'`) : 'end of input'; }

  function consume(expected) {
    const t = peek();
    if (!t || (expected && t.type !== expected)) {
      throw new Error(`Expected '${expected}' but got ${describe(t)}`);
    }
    index++;
    return t;
  }

  function parseExpression() {
    let node = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume().type;
      const right = parseTerm();
      node = { type: 'BinaryExpression', operator: op, left: node, right };
    }
    return node;
  }

  function parseTerm() {
    let node = parseFactor();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = consume().type;
      const right = parseFactor();
      node = { type: 'BinaryExpression', operator: op, left: node, right };
    }
    return node;
  }

  function parseFactor() {
    // unary minus
    if (peek() && peek().type === '-') {
      consume('-');
      const arg = parseFactor();
      return { type: 'UnaryExpression', operator: '-', argument: arg };
    }
    if (peek() && peek().type === 'NUMBER') {
      return { type: 'Literal', value: consume('NUMBER').value };
    }
    if (peek() && peek().type === '(') {
      consume('(');
      const node = parseExpression();
      consume(')');
      return node;
    }
    throw new Error(`Unexpected token: ${describe(peek())}`);
  }

  const ast = parseExpression();
  if (peek()) throw new Error(`Unexpected token at end: ${describe(peek())}`);
  return ast;
}

// assign post-order ids
function assignIds(ast) {
  let nextId = 1;
  function walk(node) {
    if (!node) return;
    if (node.type === 'BinaryExpression') {
      walk(node.left);
      walk(node.right);
    } else if (node.type === 'UnaryExpression') {
      walk(node.argument);
    }
    node._id = nextId++;
  }
  walk(ast);
}

// trims long decimals from division results, e.g. 10/3
function formatNumber(v) {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toFixed(10)));
}

// ---------------- evaluate with steps and TAC generation ----------------
function evaluateWithStepsAndTAC(ast) {
  const code = [];
  let tempCounter = 1;
  const steps = [];
  // Simulated stack for visualization; index 0 is the top (we use unshift).
  const stackSim = [];

  function evalNode(node) {
    if (node.type === 'Literal') {
      stackSim.unshift({ kind: 'literal', value: node.value });
      steps.push({
        type: 'push', node, nodeId: node._id, evalIndex: steps.length + 1,
        value: node.value, stack: stackSim.slice(), tacInstruction: null
      });
      return { value: node.value, place: formatNumber(node.value) };
    }

    if (node.type === 'UnaryExpression') {
      const a = evalNode(node.argument);
      const val = -a.value;
      const tname = `t${tempCounter++}`;
      const instr = `${tname} = -${a.place}`;
      code.push(instr);
      // pop the operand, push the negated result
      stackSim.shift();
      stackSim.unshift({ kind: 'temp', value: val, name: tname });
      steps.push({
        type: 'compute', node, nodeId: node._id, evalIndex: steps.length + 1,
        value: val, stack: stackSim.slice(), tacInstruction: instr
      });
      return { value: val, place: tname };
    }

    // BinaryExpression
    const left = evalNode(node.left);
    const right = evalNode(node.right);
    // pop two operands (right is on top), then push the result
    stackSim.shift();
    stackSim.shift();

    const op = node.operator;
    let resultValue;
    switch (op) {
      case '+': resultValue = left.value + right.value; break;
      case '-': resultValue = left.value - right.value; break;
      case '*': resultValue = left.value * right.value; break;
      case '/':
        if (right.value === 0) throw new Error('Division by zero');
        resultValue = left.value / right.value;
        break;
      default: throw new Error(`Unsupported operator: ${op}`);
    }

    const tname = `t${tempCounter++}`;
    const instr = `${tname} = ${left.place} ${op} ${right.place}`;
    code.push(instr);

    stackSim.unshift({ kind: 'temp', value: resultValue, name: tname });
    steps.push({
      type: 'compute', node, nodeId: node._id, evalIndex: steps.length + 1,
      value: resultValue, stack: stackSim.slice(), tacInstruction: instr
    });
    return { value: resultValue, place: tname };
  }

  const final = evalNode(ast);
  return { result: final.value, steps, tac: code };
}

// ast -> d3 tree
function astToD3Tree(ast) {
  if (ast.type === 'Literal') {
    return { name: formatNumber(ast.value), type: 'Literal', id: ast._id };
  }
  if (ast.type === 'UnaryExpression') {
    return { name: ast.operator, type: 'UnaryExpression', id: ast._id, children: [astToD3Tree(ast.argument)] };
  }
  return {
    name: ast.operator, type: 'BinaryExpression', id: ast._id,
    children: [astToD3Tree(ast.left), astToD3Tree(ast.right)]
  };
}

// ---------------- details list helpers ----------------
function ensureDetailsList() {
  let el = document.getElementById('details-list');
  if (!el) {
    const wrap = document.getElementById('ast-wrap') || document.body;
    el = document.createElement('ul');
    el.id = 'details-list'; // styled in index.html
    el.innerHTML = '<li style="color:var(--muted)">Hover over a node to see details</li>';
    wrap.appendChild(el);
  }
  return el;
}

function showNodeInfo(d3nodeDatum) {
  const info = d3nodeDatum && d3nodeDatum.data ? d3nodeDatum.data : d3nodeDatum;
  const el = ensureDetailsList();
  const type = info.type || 'Unknown';
  const name = info.name ?? info.value ?? info.id ?? '';
  el.innerHTML = `
    <li><strong>Type:</strong> ${escapeHtml(type)}</li>
    <li><strong>Value / Op:</strong> ${escapeHtml(String(name))}</li>
    <li style="color:var(--muted);font-size:12px">AST id: ${escapeHtml(String(info.id ?? '—'))}</li>
  `;
}

function clearNodeInfo() {
  const el = document.getElementById('details-list');
  if (!el) return;
  el.innerHTML = '<li style="color:var(--muted)">Hover over a node to see details</li>';
}

// ---------------- render AST (D3) ----------------
let svg, g, zoom;

function renderAST(ast) {
  if (typeof d3 === 'undefined') throw new Error('D3.js did not load. Check your internet connection and reload.');
  currentAST = ast;
  const treeData = astToD3Tree(ast);
  const wrap = document.getElementById('ast-graph');
  wrap.innerHTML = '';

  const root = d3.hierarchy(treeData);
  // grow the drawing for big trees so nodes never overlap; the viewBox scales it to fit
  const leaves = root.leaves().length;
  const width = Math.max(wrap.clientWidth || 900, leaves * 56 + 100);
  const height = Math.max(wrap.clientHeight || 520, (root.height + 1) * 80 + 120);

  svg = d3.select('#ast-graph').append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`);

  g = svg.append('g');
  zoom = d3.zoom().scaleExtent([0.3, 3]).on('zoom', (event) => {
    g.attr('transform', event.transform);
  });
  svg.call(zoom);

  const treeLayout = d3.tree().size([width - 100, height - 120]);
  treeLayout(root);

  // Links
  g.selectAll('.link')
    .data(root.links())
    .enter().append('line')
    .attr('class', 'link')
    .attr('x1', d => d.source.x + 50).attr('y1', d => d.source.y + 60)
    .attr('x2', d => d.target.x + 50).attr('y2', d => d.target.y + 60);

  // Nodes
  const nodes = g.selectAll('.node')
    .data(root.descendants())
    .enter().append('g')
    .attr('class', 'node')
    .attr('transform', d => `translate(${d.x + 50}, ${d.y + 60})`)
    .attr('data-ast-id', d => d.data.id)
    .on('mouseover', (event, d) => showNodeInfo(d))
    .on('mouseout', () => clearNodeInfo());

  const s = getComputedStyle(document.body);
  const lit = s.getPropertyValue('--node-lit').trim() || '#bbf7d0';
  const op = s.getPropertyValue('--node-op').trim() || '#bfdbfe';

  nodes.append('circle')
    .attr('r', 20)
    .attr('fill', d => (d.data.type === 'Literal' ? lit : op));

  nodes.append('text')
    .attr('dy', '.35em')
    .attr('text-anchor', 'middle')
    .text(d => d.data.name)
    .style('font-size', d => (d.data.name.length > 4 ? '10px' : '12px'))
    .style('pointer-events', 'none');

  ensureDetailsList();

  // keep the current animation highlight after a re-render (theme switch)
  if (animation.idx > 0 && animation.steps[animation.idx - 1]) {
    highlightNode(animation.steps[animation.idx - 1].nodeId);
  }
}

// ---------------- highlighting & animation ----------------
function clearHighlights() {
  d3.selectAll('.node').classed('highlight', false);
}

function highlightNode(targetId) {
  clearHighlights();
  const sel = d3.selectAll('.node').filter(d => String(d.data.id) === String(targetId));
  if (!sel.empty()) {
    sel.classed('highlight', true);
    sel.raise();
  } else {
    console.warn('No D3 node matched AST id', targetId);
  }
}

function updateTACPanel(currentTAC) {
  const list = document.getElementById('tac-list');
  list.innerHTML = '';
  if (!currentTAC.length) {
    list.innerHTML = '<div class="empty">No instructions yet</div>';
    return;
  }
  currentTAC.forEach((instr, idx) => {
    const div = document.createElement('div');
    div.className = 'tac-item';
    div.textContent = `${idx + 1}. ${instr}`;
    list.appendChild(div);
  });
}

function renderStack(stackArr) {
  const wrap = document.getElementById('stack');
  wrap.innerHTML = '';
  if (!stackArr.length) {
    wrap.innerHTML = '<div class="empty">Stack is empty</div>';
    return;
  }
  // stackArr has the top at index 0 (we used unshift), so display in order
  stackArr.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'stack-item';
    if (item.kind === 'literal') div.textContent = formatNumber(item.value);
    else if (item.kind === 'temp') div.textContent = `${item.name ?? ''} (${formatNumber(item.value)})`;
    else div.textContent = JSON.stringify(item);
    wrap.appendChild(div);
  });
}

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function highlightStep(step) {
  highlightNode(step.nodeId);
  setStatus(`Step ${step.evalIndex}/${animation.steps.length} · value = ${formatNumber(step.value)}`);
  updateTACPanel(tac);
  renderStack(step.stack);
}

function play() {
  if (!animation.steps.length) return;
  if (animation.playing) return;
  // restart from the beginning if the previous run already finished
  if (animation.idx >= animation.steps.length) animation.idx = 0;
  animation.playing = true;
  const tick = () => {
    if (animation.idx >= animation.steps.length) { pause(); return; }
    highlightStep(animation.steps[animation.idx++]);
  };
  tick();
  animation.timer = setInterval(tick, STEP_DELAY_MS);
}

function pause() {
  animation.playing = false;
  if (animation.timer) {
    clearInterval(animation.timer);
    animation.timer = null;
  }
}

function stepOnce() {
  if (!animation.steps.length) return;
  pause();
  if (animation.idx >= animation.steps.length) return;
  highlightStep(animation.steps[animation.idx++]);
}

function resetAnim() {
  pause();
  animation.idx = 0;
  clearHighlights();
  setStatus(animation.steps.length ? `Ready — ${animation.steps.length} step${animation.steps.length === 1 ? "" : "s"}` : '');
  updateTACPanel(tac);
  renderStack([]);
}

// ---------------- history ----------------
function pushHistory(expr, result) {
  calculationHistory.unshift({ expr, result });
  if (calculationHistory.length > 25) calculationHistory.pop();
  renderHistory();
  saveHistory();
}

function renderHistory() {
  const wrap = document.getElementById('history');
  wrap.innerHTML = '';
  if (!calculationHistory.length) {
    wrap.innerHTML = '<div class="history-item" style="color:var(--muted);cursor:default">No history yet</div>';
    return;
  }
  calculationHistory.forEach((h) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `<div style="font-weight:600">${escapeHtml(h.expr)}</div><div class="chip">Result: ${escapeHtml(h.result)}</div>`;
    div.addEventListener('click', () => {
      document.getElementById('expression').value = h.expr;
      runExpression(h.expr, false);
    });
    wrap.appendChild(div);
  });
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(calculationHistory));
  } catch (e) { /* storage unavailable */ }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      calculationHistory = parsed.filter(h => h && typeof h.expr === 'string');
    }
  } catch (e) { /* storage unavailable or corrupt */ }
  renderHistory();
}

// ---------------- utilities ----------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function exportSvgToPng() {
  const svgEl = document.querySelector('#ast-graph svg');
  if (!svgEl) { alert('No AST to export — evaluate an expression first.'); return; }

  const viewBox = svgEl.viewBox.baseVal;
  const w = viewBox && viewBox.width ? viewBox.width : svgEl.clientWidth;
  const h = viewBox && viewBox.height ? viewBox.height : svgEl.clientHeight;

  // Work on a copy: give it a fixed size, drop the zoom transform, and inline the
  // CSS-driven styles so the standalone image looks the same as the page.
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  const innerG = clone.querySelector('g');
  if (innerG) innerG.removeAttribute('transform');
  const srcEls = svgEl.querySelectorAll('circle, text, line');
  const dstEls = clone.querySelectorAll('circle, text, line');
  srcEls.forEach((el, i) => {
    const cs = getComputedStyle(el);
    ['fill', 'stroke', 'stroke-width', 'font-size', 'font-weight', 'font-family'].forEach(p => {
      dstEls[i].style.setProperty(p, cs.getPropertyValue(p));
    });
  });

  const svgStr = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();

  img.onload = function () {
    const scale = 2; // sharper output
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ast.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };
  img.onerror = function () {
    URL.revokeObjectURL(url);
    alert('Could not export the AST image.');
  };
  img.src = url;
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  if (currentAST) renderAST(currentAST);
}

// ---------------- evaluate main ----------------
function runExpression(expr, addToHistory) {
  pause();
  try {
    const tokens = tokenize(expr);
    const ast = parse(tokens);
    assignIds(ast); // post-order ids
    const { result, steps, tac: newTac } = evaluateWithStepsAndTAC(ast);

    tac = newTac.slice();
    animation.steps = steps;
    animation.idx = 0;

    document.getElementById('result').textContent = formatNumber(result);
    renderAST(ast);
    if (addToHistory) pushHistory(expr, formatNumber(result));
    updateTACPanel(tac);
    renderStack([]);
    setStatus(`Ready — ${steps.length} step${steps.length === 1 ? "" : "s"}`);
  } catch (error) {
    console.error(error);
    currentAST = null;
    tac = [];
    animation.steps = [];
    animation.idx = 0;
    document.getElementById('result').textContent = '—';
    setStatus(`Error: ${error.message}`, true);
    document.getElementById('ast-graph').innerHTML = '';
    updateTACPanel([]);
    renderStack([]);
  }
}

function evaluateExpression() {
  const expr = document.getElementById('expression').value.trim();
  if (!expr) {
    setStatus('Enter an expression', true);
    return;
  }
  runExpression(expr, true);
}

// ---------------- wire UI ----------------
document.getElementById('evalBtn').addEventListener('click', evaluateExpression);
document.getElementById('playBtn').addEventListener('click', play);
document.getElementById('pauseBtn').addEventListener('click', pause);
document.getElementById('stepBtn').addEventListener('click', stepOnce);
document.getElementById('resetAnimBtn').addEventListener('click', resetAnim);
document.getElementById('exportBtn').addEventListener('click', exportSvgToPng);
document.getElementById('themeBtn').addEventListener('click', toggleTheme);
document.getElementById('clearHistory').addEventListener('click', () => {
  calculationHistory = [];
  saveHistory();
  renderHistory();
});
document.getElementById('expression').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') evaluateExpression();
});

// ---------------- initial ----------------
loadHistory();
updateTACPanel([]);
renderStack([]);
document.getElementById('expression').value = '(3 + 5) * (2 - 4/2) + 7';
window.appLoaded = true;
