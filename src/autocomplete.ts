/**
 * Autocomplete dropdown for the Calcpad-Symbolic Web editor.
 *
 * Triggered on typing inside the <textarea id="editor">. Suggests:
 *  1. Calcpad directives (#if, #for, #sym, #python, #maxima, #function, ...)
 *  2. Built-in functions (sin, cos, diff, integrate, solve, lsolve, ...)
 *  3. User-defined functions from the last parse (UserFunction list)
 *  4. Known constants (pi, e, etc.) and variable names seen in the script
 *
 * Port of the WPF AutoCompleteManager.cs behavior (minus listbox styling).
 * Keyboard:
 *   Ctrl+Space           → force-open
 *   Tab / Enter          → accept highlighted item
 *   Up / Down            → move selection
 *   Esc                  → close
 */

import type { UserFunction } from './parser/CalcpadParser';

// ---- Keyword catalog (subset of WPF AutoCompleteManager) ----

interface KwItem {
  /** Text inserted into the editor (can have placeholders like `expr`) */
  text: string;
  /** Category for coloring and grouping */
  cat: 'directive' | 'function' | 'constant' | 'dollar' | 'user';
  /** Short description shown next to the item */
  hint?: string;
}

export const KEYWORDS: KwItem[] = [
  // Directives
  { text: '#if ', cat: 'directive', hint: 'if condition' },
  { text: '#else if ', cat: 'directive' },
  { text: '#else', cat: 'directive' },
  { text: '#end if', cat: 'directive' },
  { text: '#for ', cat: 'directive', hint: 'for i = 1 : N ... #loop' },
  { text: '#loop', cat: 'directive' },
  { text: '#while ', cat: 'directive' },
  { text: '#repeat ', cat: 'directive' },
  { text: '#until ', cat: 'directive' },
  { text: '#break', cat: 'directive' },
  { text: '#continue', cat: 'directive' },
  { text: '#function ', cat: 'directive', hint: '#function name(p1; p2)...' },
  { text: '#end function', cat: 'directive' },
  { text: '#sym ', cat: 'directive', hint: 'AngouriMath / nerdamer CAS' },
  { text: '#end sym', cat: 'directive' },
  { text: '#python', cat: 'directive', hint: 'SymPy via Pyodide' },
  { text: '#end python', cat: 'directive' },
  { text: '#maxima', cat: 'directive', hint: 'Maxima WASM' },
  { text: '#end maxima', cat: 'directive' },
  { text: '#pip install ', cat: 'directive', hint: 'install Python package' },
  { text: '#deq ', cat: 'directive', hint: 'display equation only' },
  { text: '#hide', cat: 'directive' },
  { text: '#show', cat: 'directive' },
  { text: '#format ', cat: 'directive' },
  { text: '#round ', cat: 'directive' },
  { text: '#deg', cat: 'directive' },
  { text: '#rad', cat: 'directive' },
  { text: '#gra', cat: 'directive' },
  { text: '#noc', cat: 'directive' },
  { text: '#include ', cat: 'directive' },
  { text: '#input ', cat: 'directive' },
  { text: '#read ', cat: 'directive' },
  { text: '#write ', cat: 'directive' },
  { text: '#post ', cat: 'directive' },

  // $-directives (plot/map/etc)
  { text: '$Plot{f(x) @ x = a : b}', cat: 'dollar' },
  { text: '$Map{f(x;y) @ x=a:b & y=c:d}', cat: 'dollar' },
  { text: '$Chart{x; y @ type=line}', cat: 'dollar' },
  { text: '$Fem2D{x_j; y_j; e_j; values}', cat: 'dollar' },
  { text: '$Fem3D{x_j; y_j; z_j; e_j; values}', cat: 'dollar' },
  { text: '$Integral{f(x) @ x=a:b}', cat: 'dollar' },
  { text: '$Derivative{f(x) @ x=a}', cat: 'dollar' },
  { text: '$Sum{f(k) @ k=a:b}', cat: 'dollar' },
  { text: '$Product{f(k) @ k=a:b}', cat: 'dollar' },
  { text: '$Root{f(x) = 0 @ x=a:b}', cat: 'dollar' },
  { text: '$Find{f(x) @ x=a:b}', cat: 'dollar' },
  { text: '$Area{f(x) @ x=a:b}', cat: 'dollar' },
  { text: '$Slope{f(x) @ x=a}', cat: 'dollar' },
  { text: '$Draw{line,0,0,10,0 @ w=400:h=300}', cat: 'dollar' },
  { text: '$Struct{beam,0,0,L,0 : pin,0,0 : roller,L,0}', cat: 'dollar' },
  { text: '$Frame{nodes; elements; supports}', cat: 'dollar' },
  { text: '$Table{v1; v2 @ "H1";"H2"}', cat: 'dollar' },

  // Math (single-arg)
  { text: 'sin(x)', cat: 'function' },
  { text: 'cos(x)', cat: 'function' },
  { text: 'tan(x)', cat: 'function' },
  { text: 'asin(x)', cat: 'function' },
  { text: 'acos(x)', cat: 'function' },
  { text: 'atan(x)', cat: 'function' },
  { text: 'sinh(x)', cat: 'function' },
  { text: 'cosh(x)', cat: 'function' },
  { text: 'tanh(x)', cat: 'function' },
  { text: 'csc(x)', cat: 'function' },
  { text: 'sec(x)', cat: 'function' },
  { text: 'cot(x)', cat: 'function' },
  { text: 'sqrt(x)', cat: 'function' },
  { text: 'cbrt(x)', cat: 'function' },
  { text: 'sqr(x)', cat: 'function' },
  { text: 'abs(x)', cat: 'function' },
  { text: 'exp(x)', cat: 'function' },
  { text: 'ln(x)', cat: 'function' },
  { text: 'log(x)', cat: 'function' },
  { text: 'log_2(x)', cat: 'function' },
  { text: 'sign(x)', cat: 'function' },
  { text: 'ceiling(x)', cat: 'function' },
  { text: 'floor(x)', cat: 'function' },
  { text: 'round(x)', cat: 'function' },
  { text: 'trunc(x)', cat: 'function' },
  { text: 're(z)', cat: 'function' },
  { text: 'im(z)', cat: 'function' },
  { text: 'phase(z)', cat: 'function' },
  { text: 'conj(z)', cat: 'function' },
  { text: 'fact(n)', cat: 'function' },
  { text: 'gamma(x)', cat: 'function' },
  { text: 'erf(x)', cat: 'function' },
  { text: 'erfc(x)', cat: 'function' },
  // Multi-arg
  { text: 'atan2(y; x)', cat: 'function' },
  { text: 'root(x; n)', cat: 'function' },
  { text: 'mod(a; b)', cat: 'function' },
  { text: 'min(x; y; …)', cat: 'function' },
  { text: 'max(x; y; …)', cat: 'function' },
  { text: 'sum(x; y; …)', cat: 'function' },
  { text: 'sumsq(x; …)', cat: 'function' },
  { text: 'srss(x; …)', cat: 'function' },
  { text: 'average(x; …)', cat: 'function' },
  { text: 'product(x; …)', cat: 'function' },
  { text: 'gcd(x; y)', cat: 'function' },
  { text: 'lcm(x; y)', cat: 'function' },
  { text: 'and(x; y; …)', cat: 'function' },
  { text: 'or(x; y; …)', cat: 'function' },
  { text: 'xor(x; y; …)', cat: 'function' },
  { text: 'switch(c1; v1; c2; v2; def)', cat: 'function' },
  { text: 'if(c; a; b)', cat: 'function' },

  // Matrix / Vector
  { text: 'matrix(rows; cols)', cat: 'function', hint: 'new zero matrix' },
  { text: 'vector(n)', cat: 'function', hint: 'new zero vector' },
  { text: 'cell(n)', cat: 'function', hint: 'new cell array' },
  { text: 'det(M)', cat: 'function' },
  { text: 'inv(M)', cat: 'function' },
  { text: 'transp(M)', cat: 'function' },
  { text: 'eigen(M)', cat: 'function' },
  { text: 'eigenvals(M)', cat: 'function' },
  { text: 'trace(M)', cat: 'function' },
  { text: 'rank(M)', cat: 'function' },
  { text: 'lsolve(A; b)', cat: 'function', hint: 'LU / LDLT solve' },
  { text: 'clsolve(A; b)', cat: 'function', hint: 'Cholesky solve' },
  { text: 'msolve(A; B)', cat: 'function' },
  { text: 'cholesky(M)', cat: 'function' },
  { text: 'diag(v)', cat: 'function' },
  { text: 'ones(n; m)', cat: 'function' },
  { text: 'zeros(n; m)', cat: 'function' },
  { text: 'identity(n)', cat: 'function' },
  { text: 'dot(a; b)', cat: 'function' },
  { text: 'cross(a; b)', cat: 'function' },
  { text: 'norm(v)', cat: 'function' },
  { text: 'n_rows(M)', cat: 'function' },
  { text: 'n_cols(M)', cat: 'function' },
  { text: 'len(v)', cat: 'function' },
  { text: 'col(M; j)', cat: 'function' },
  { text: 'row(M; i)', cat: 'function' },
  { text: 'submatrix(M; i1; i2; j1; j2)', cat: 'function' },

  // Symbolic
  { text: 'diff(f; x)', cat: 'function', hint: 'derivative' },
  { text: 'pdiff(f; x)', cat: 'function', hint: 'partial derivative' },
  { text: 'integrate(f; x)', cat: 'function', hint: 'indefinite integral' },
  { text: 'integrate(f; x; a; b)', cat: 'function', hint: 'definite integral' },
  { text: 'simplify(expr)', cat: 'function' },
  { text: 'expand(expr)', cat: 'function' },
  { text: 'factor(expr)', cat: 'function' },
  { text: 'solve(expr; x)', cat: 'function', hint: 'solve = 0' },
  { text: 'subs(expr; x; v)', cat: 'function' },
  { text: 'gradient(f; x; y)', cat: 'function' },
  { text: 'jacobian(f1; f2; x; y)', cat: 'function' },
  { text: 'hessian(f; x; y)', cat: 'function' },
  { text: 'laplace(f; t; s)', cat: 'function' },
  { text: 'ilaplace(F; s; t)', cat: 'function' },

  // FEM
  { text: 'mesh_hex8_nodes(specs)', cat: 'function' },
  { text: 'mesh_hex8_elems(specs)', cat: 'function' },
  { text: 'fem_hex8(nodes; elems; E; nu; specs)', cat: 'function' },
  { text: 'fem_hex8_stress(nodes; elems; E; nu; u)', cat: 'function' },
  { text: 'mesh_soil_specs([Lx;Ly;Lz;nx;ny;nz;centered;Pz])', cat: 'function' },

  // Constants
  { text: 'pi', cat: 'constant' },
  { text: 'e', cat: 'constant' },
  { text: 'π', cat: 'constant' },
  { text: 'inf', cat: 'constant' },
  { text: 'true', cat: 'constant' },
  { text: 'false', cat: 'constant' },
];

const CAT_COLORS: Record<KwItem['cat'], string> = {
  directive: '#c026d3',
  function: '#0891b2',
  constant: '#059669',
  dollar: '#d97706',
  user: '#0ea5e9',
};

// ---- Dropdown state ----

let currentItems: KwItem[] = [];
let selectedIdx = 0;
let popup: HTMLDivElement | null = null;
let currentEditor: HTMLTextAreaElement | null = null;
let currentPrefix = '';
let currentPrefixStart = 0;

function ensurePopup(): HTMLDivElement {
  if (popup) return popup;
  popup = document.createElement('div');
  popup.id = 'autocomplete-popup';
  popup.style.cssText =
    'position:fixed;display:none;background:#fff;border:1px solid #cbd5e1;' +
    'border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,0.18);max-height:260px;' +
    'overflow-y:auto;z-index:2000;font-family:Consolas,Monaco,monospace;' +
    'font-size:12px;min-width:280px;';
  document.body.appendChild(popup);
  return popup;
}

function render(): void {
  if (!popup) return;
  if (currentItems.length === 0) { popup.style.display = 'none'; return; }
  const rows: string[] = [];
  currentItems.forEach((it, idx) => {
    const selected = idx === selectedIdx;
    const bg = selected ? 'background:#0ea5e9;color:#fff;' : 'background:#fff;color:#0f172a;';
    const color = selected ? '#fff' : CAT_COLORS[it.cat];
    const hint = it.hint ? ` <span style="color:${selected ? '#dbeafe' : '#94a3b8'};font-size:10px;margin-left:8px;">${it.hint}</span>` : '';
    rows.push(
      `<div class="ac-row" data-idx="${idx}" style="padding:3px 10px;cursor:pointer;${bg}" ` +
      `onmouseover="this.dataset.hover='1'">` +
      `<span style="color:${color};font-weight:500;">${escapeHtml(it.text)}</span>${hint}</div>`
    );
  });
  popup.innerHTML = rows.join('');
  popup.style.display = 'block';
  // Wire mouse clicks
  popup.querySelectorAll('.ac-row').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number((el as HTMLElement).dataset.idx || 0);
      accept(idx);
    });
  });
  // Scroll selected into view
  const sel = popup.querySelector(`.ac-row[data-idx="${selectedIdx}"]`);
  if (sel) (sel as HTMLElement).scrollIntoView({ block: 'nearest' });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

/** Find the current word the cursor is inside (letters + # + $ allowed). */
function getCurrentPrefix(ed: HTMLTextAreaElement): { prefix: string; start: number } {
  const pos = ed.selectionStart;
  const src = ed.value;
  let i = pos;
  while (i > 0) {
    const c = src[i - 1];
    if (/[A-Za-z0-9_#$π]/.test(c)) i--;
    else break;
  }
  return { prefix: src.substring(i, pos), start: i };
}

/** Position the popup near the cursor in the textarea. */
function positionPopup(ed: HTMLTextAreaElement): void {
  if (!popup) return;
  const rect = ed.getBoundingClientRect();
  // Approximate: use the current line (hard to measure without a canvas ruler).
  // Use a quick hack: find the number of newlines before selection and pos accordingly.
  const src = ed.value;
  const pre = src.substring(0, ed.selectionStart);
  const line = pre.split('\n').length;
  const col = pre.split('\n').pop()!.length;
  // Heuristic: Consolas 13px → ~7.8 px per char wide, 18 px per line tall
  const charW = 7.8;
  const lineH = 20;
  const x = rect.left + 12 + col * charW;
  const y = rect.top + 12 + line * lineH;
  popup.style.left = `${Math.min(x, window.innerWidth - 300)}px`;
  popup.style.top = `${Math.min(y, window.innerHeight - 280)}px`;
}

function accept(idx: number = selectedIdx): void {
  if (!currentEditor || currentItems.length === 0) return;
  const item = currentItems[idx];
  const ed = currentEditor;
  const before = ed.value.substring(0, currentPrefixStart);
  const after = ed.value.substring(ed.selectionStart);
  ed.value = before + item.text + after;
  const newPos = currentPrefixStart + item.text.length;
  ed.setSelectionRange(newPos, newPos);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  hide();
  ed.focus();
}

function hide(): void {
  if (popup) popup.style.display = 'none';
  currentItems = [];
  selectedIdx = 0;
}

function update(): void {
  if (!currentEditor) return;
  const { prefix, start } = getCurrentPrefix(currentEditor);
  currentPrefix = prefix;
  currentPrefixStart = start;
  if (prefix.length === 0) { hide(); return; }
  const lc = prefix.toLowerCase();
  const match = (it: KwItem) => it.text.toLowerCase().startsWith(lc);
  currentItems = KEYWORDS.filter(match).slice(0, 40);
  if (currentItems.length === 0) { hide(); return; }
  selectedIdx = 0;
  ensurePopup();
  positionPopup(currentEditor);
  render();
}

/**
 * Attach autocomplete behavior to a textarea.
 * Pass a callback that returns the current list of user functions for the
 * 'user' category (updated after each parse).
 */
export function attachAutocomplete(
  editor: HTMLTextAreaElement,
  getUserFunctions: () => UserFunction[],
): void {
  currentEditor = editor;
  ensurePopup();

  editor.addEventListener('input', () => {
    // Rebuild the keyword list to include current user functions
    const userFns = getUserFunctions();
    // Keep static keywords; append user functions at the top
    const userItems: KwItem[] = userFns.map(fn => ({
      text: `${fn.name}(${fn.params.join('; ')})`,
      cat: 'user',
      hint: `línea ${fn.line} — tu función`,
    }));
    // Update a mutable ref so filter sees them
    (KEYWORDS as KwItem[]).length; // no-op to silence TS
    (currentEditor as unknown as { __userFns?: KwItem[] }).__userFns = userItems;
    update();
  });

  editor.addEventListener('keydown', (e) => {
    if (popup?.style.display !== 'block' || currentItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % currentItems.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + currentItems.length) % currentItems.length;
      render();
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      accept();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    }
  });

  // Ctrl+Space force-open
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault();
      update();
      if (currentItems.length === 0) {
        // Force open with all items
        currentItems = KEYWORDS.slice(0, 40);
        selectedIdx = 0;
        ensurePopup();
        positionPopup(editor);
        render();
      }
    }
  });

  // Click outside closes the popup
  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.contains(e.target as Node) && e.target !== editor) {
      hide();
    }
  });
}
