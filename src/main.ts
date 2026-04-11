// Calcpad-Symbolic Web — main entry point
// - Editor with syntax-aware output rendering
// - Autorun on input change (debounced)
// - File open/save (.cpd)
// - 390+ examples loaded from public/examples/index.json

import { evalCalcpad, OutputBlock } from './parser/CalcpadParser';
import { fem3d } from './viz/fem3d';
import { casManager } from './cas';
import { attachAutocomplete } from './autocomplete';
// NOTE: No KaTeX import. #sym / #deq blocks are rendered using the Calcpad
// desktop template HTML classes (.dvc, .dvl, .dvr, .nary, <var>, <sup>...)
// via calcpadExprToHtml() below. The template CSS in public/template-calcpad.css
// handles all styling.
/**
 * Render a Calcpad/nerdamer expression directly into HTML that uses the
 * Calcpad desktop template classes (.dvc, .dvl, .dvr, .nary, .b0, <var>,
 * <sub>, <sup>). NO KaTeX — we trust the Calcpad template CSS.
 *
 * Supports:
 *   integrate(f; x)         → ∫f dx  (with .dvr + .nary)
 *   integrate(f; x; a; b)   → ∫ₐᵇ f dx
 *   diff(f; x)              → df/dx  (with .dvc / .dvl fraction)
 *   diff(diff(f; x); x)     → d²f/dx²
 *   pdiff(f; x)             → ∂f/∂x
 *   sqrt(x), cbrt(x)        → √x, ∛x
 *   a/b (simple numerator)  → .dvc fraction
 *   x^2 / x^3               → x² / x³ via <sup>
 *   *                       → ·
 *   Greek letters           → Unicode
 */
function calcpadExprToHtml(s: string): string {
  if (!s) return '';
  let out = s.trim();

  // 1. NORMALIZE inverse powers and nerdamer's awkward text:
  //    `L^(-1)` → `1/L`        (inverse via .dvc fraction)
  //    `L^(-2)` → `1/L^2`      (reciprocal power)
  //    `x^(-N)` → `1/x^N`
  //    Done BEFORE function call transformation so nested integrate/diff
  //    still see raw exponent text.
  out = out.replace(
    /\b([A-Za-zα-ωΑ-Ω][A-Za-zα-ωΑ-Ω0-9_]*)\^\(-1\)/g,
    (_m, v) => `MKFRAC__1__${v}__END`
  );
  out = out.replace(
    /\b([A-Za-zα-ωΑ-Ω][A-Za-zα-ωΑ-Ω0-9_]*)\^\(-([0-9]+)\)/g,
    (_m, v, n) => `MKFRAC__1__${v}^${n}__END`
  );
  // Same for inverse of a parenthesized expression: `(a+b)^(-1)`
  out = out.replace(
    /\(([^()]+)\)\^\(-1\)/g,
    (_m, inner) => `MKFRAC__1__(${inner})__END`
  );

  // 2. Matrix literal `[[a,b],[c,d]]` (nerdamer output) or `[a;b|c;d]` (Calcpad)
  //    Convert to a real <span class="matrix"> using the Calcpad template HTML.
  out = convertMatrixLiterals(out);

  // 3. Process function calls (integrate, diff, etc.) recursively.
  out = transformFunctionCalls(out);

  // 4. Convert the MKFRAC markers into Calcpad .dvc fraction HTML
  //    (has to happen AFTER function transformation so the marker isn't
  //    consumed by anything else).
  out = out.replace(/MKFRAC__([^_]+)__([^_]+?)__END/g, (_m, num, den) =>
    `<span class="dvc"><var>${num}</var><span class="dvl"></span><var>${den}</var></span>`
  );

  // 5. Cosmetic replacements after function rewriting
  //    `x^2` → `x<sup>2</sup>` (single-char or grouped exponent)
  out = out.replace(/\^\{?([0-9]+)\}?/g, (_m, n) => `<sup>${n}</sup>`);
  out = out.replace(/\^\{?([a-zA-Z])\}?/g, (_m, v) => `<sup>${v}</sup>`);
  //    `*` → ` · ` (middle dot) but not inside HTML attribute values
  out = out.replace(/(?<!\*)\*(?!\*)/g, ' · ');
  //    Wrap bare identifiers in <var> so the Calcpad green italic applies.
  //    Skip HTML tags we just emitted.
  out = out.replace(/(<[^>]+>)|\b([A-Za-zα-ωΑ-Ω][A-Za-zα-ωΑ-Ω0-9_]*)\b/g,
    (m, tag, ident) => tag ? tag : `<var>${ident}</var>`);

  return out;
}

/**
 * Convert matrix literal syntaxes to Calcpad-template HTML:
 *   `[[a, b], [c, d]]`   →  <span class="matrix">...</span>
 *   `[a; b | c; d]`      →  <span class="matrix">...</span>
 */
function convertMatrixLiterals(s: string): string {
  // Handle nerdamer output [[a,b],[c,d]] first
  const nerd = s.match(/\[\s*\[([^\[\]]+)\](?:\s*,\s*\[([^\[\]]+)\])*\s*\]/);
  if (nerd) {
    // Full scan for nested bracket structure
    let i = 0;
    let result = '';
    while (i < s.length) {
      if (s[i] === '[' && s[i + 1] === '[') {
        // Find matching ]]
        let depth = 1;
        let j = i + 1;
        while (j < s.length && depth > 0) {
          if (s[j] === '[') depth++;
          else if (s[j] === ']') depth--;
          if (depth === 0) break;
          j++;
        }
        if (depth === 0) {
          const inner = s.substring(i + 1, j);
          // Split by `],[` into rows
          const rows = inner.split(/\]\s*,\s*\[/).map(row =>
            row.replace(/^\[|\]$/g, '').split(',').map(x => x.trim())
          );
          const maxCols = Math.max(...rows.map(r => r.length));
          const parts: string[] = ['<span class="matrix"><span class="tr"><span class="td"></span>'];
          // First row
          for (let c = 0; c < maxCols; c++) {
            parts.push(`<span class="td">${rows[0][c] || ''}</span>`);
          }
          parts.push('<span class="td"></span></span>');
          for (let r = 1; r < rows.length; r++) {
            parts.push('<span class="tr"><span class="td"></span>');
            for (let c = 0; c < maxCols; c++) {
              parts.push(`<span class="td">${rows[r][c] || ''}</span>`);
            }
            parts.push('<span class="td"></span></span>');
          }
          parts.push('</span>');
          result += parts.join('');
          i = j + 1;
          continue;
        }
      }
      result += s[i];
      i++;
    }
    return result;
  }
  return s;
}

/** Split a string by sep respecting nesting. */
function splitTopLevelHtml(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === sep) {
      out.push(s.substring(start, i));
      start = i + 1;
    }
  }
  out.push(s.substring(start));
  return out;
}

/** Recursively transform function calls into Calcpad-template HTML. */
function transformFunctionCalls(s: string): string {
  let result = '';
  let i = 0;
  while (i < s.length) {
    const m = s.substring(i).match(/^([a-zA-Z_][a-zA-Z_0-9]*)\s*\(/);
    if (m) {
      const name = m[1];
      const parenStart = i + m[0].length - 1;
      let depth = 1;
      let j = parenStart + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') depth--;
        if (depth === 0) break;
        j++;
      }
      if (depth === 0) {
        const inner = s.substring(parenStart + 1, j);
        const sep = inner.includes(';') ? ';' : ',';
        const rawArgs = splitTopLevelHtml(inner, sep).map(a => a.trim());
        // Recurse on each argument
        const args = rawArgs.map(a => transformFunctionCalls(a));
        const replaced = renderFunctionCall(name, args);
        // If the renderer returned null, keep as plain function call
        if (replaced !== null) {
          result += replaced;
          i = j + 1;
          continue;
        }
      }
    }
    result += s[i];
    i++;
  }
  return result;
}

/** Render a single function call using Calcpad desktop template HTML. */
function renderFunctionCall(name: string, args: string[]): string | null {
  switch (name) {
    case 'integrate':
    case 'int': {
      // FormatNary: <span class="dvr"><small>sup</small><span class="nary">∫</span><small>sub</small></span>expr
      const body = args[0] || '';
      const variable = args[1] || 'x';
      if (args.length >= 4) {
        const lo = args[2] || '';
        const hi = args[3] || '';
        return `<span class="dvr"><small>${hi}</small><span class="nary">∫</span><small>${lo}</small></span>${body}\u2009<var>d${variable}</var>`;
      }
      return `<span class="nary">∫</span>${body}\u2009<var>d${variable}</var>`;
    }
    case 'diff':
    case 'derivative': {
      // FormatDivision: <span class="dvc">NUM<span class="dvl"></span>DEN</span>
      const body = args[0] || '';
      const variable = args[1] || 'x';
      const order = args[2] && /^\d+$/.test(args[2]) ? args[2] : '';
      if (order) {
        return `<span class="dvc"><var>d<sup>${order}</sup>${body}</var><span class="dvl"></span><var>d${variable}<sup>${order}</sup></var></span>`;
      }
      return `<span class="dvc"><var>d${body.length > 6 ? '(' + body + ')' : body}</var><span class="dvl"></span><var>d${variable}</var></span>`;
    }
    case 'pdiff':
    case 'partial': {
      const body = args[0] || '';
      const variable = args[1] || 'x';
      // pdiff(f; x; n) — n-th partial derivative:  ∂ⁿf / ∂xⁿ
      if (args.length >= 3 && /^\d+$/.test(args[2])) {
        const n = args[2];
        return `<span class="dvc"><var>∂<sup>${n}</sup>${body}</var><span class="dvl"></span><var>∂${variable}<sup>${n}</sup></var></span>`;
      }
      return `<span class="dvc"><var>∂${body}</var><span class="dvl"></span><var>∂${variable}</var></span>`;
    }
    case 'pdiff2':
    case 'mixed': {
      // pdiff2(f; x; y) — mixed partial ∂²f / ∂x∂y  (Kirchhoff twist curvature)
      const body = args[0] || '';
      const v1 = args[1] || 'x';
      const v2 = args[2] || 'y';
      return `<span class="dvc"><var>∂<sup>2</sup>${body}</var><span class="dvl"></span><var>∂${v1}∂${v2}</var></span>`;
    }
    case 'laplacian':
    case 'laplace2d': {
      // laplacian(f; x; y) → ∂²f/∂x² + ∂²f/∂y²
      const body = args[0] || '';
      const v1 = args[1] || 'x';
      const v2 = args[2] || 'y';
      return `<span class="dvc"><var>∂<sup>2</sup>${body}</var><span class="dvl"></span><var>∂${v1}<sup>2</sup></var></span> + <span class="dvc"><var>∂<sup>2</sup>${body}</var><span class="dvl"></span><var>∂${v2}<sup>2</sup></var></span>`;
    }
    case 'sqrt':
      return `<span style="font-size:120%">√</span><span style="text-decoration:overline">${args[0]}</span>`;
    case 'cbrt':
      return `<sup style="font-size:70%">3</sup>√<span style="text-decoration:overline">${args[0]}</span>`;
    case 'abs':
      return `|${args[0]}|`;
    case 'sum':
      if (args.length >= 4) {
        return `<span class="dvr"><small>${args[3]}</small><span class="nary">∑</span><small>${args[1]}=${args[2]}</small></span>${args[0]}`;
      }
      return `∑${args.join(', ')}`;
    case 'product':
      if (args.length >= 4) {
        return `<span class="dvr"><small>${args[3]}</small><span class="nary">∏</span><small>${args[1]}=${args[2]}</small></span>${args[0]}`;
      }
      return `∏${args.join(', ')}`;
  }
  // Not a special function — keep as regular call (will be further processed)
  return null;
}

/**
 * Convert a Calcpad/nerdamer textual expression into LaTeX. Handles:
 *   integrate(expr; var)          → \int expr \, dvar
 *   integrate(expr; var; a; b)    → \int_{a}^{b} expr \, dvar
 *   diff(expr; var)               → \frac{d expr}{dvar}
 *   diff(diff(expr; var); var)    → \frac{d^2 expr}{dvar^2}
 *   pdiff(expr; var)              → \frac{\partial expr}{\partial var}
 *   sqrt(x)                       → \sqrt{x}
 *   a/b                           → \frac{a}{b}  (only when both sides are simple)
 *   x^2                           → x^{2}
 *   *                             → \cdot
 *   Greek letter names            → proper Greek letters
 *
 * Falls back to nerdamer.toTeX() for fragments it can't interpret.
 */
function calcpadToLatex(s: string): string {
  if (!s) return '';
  let out = s.trim();

  // Normalize Unicode Greek letters to LaTeX commands first
  const greek: Record<string, string> = {
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
    'ε': '\\varepsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
    'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
    'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
    'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
    'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    'Α': 'A', 'Β': 'B', 'Γ': '\\Gamma', 'Δ': '\\Delta',
    'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi',
    'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  };
  for (const [k, v] of Object.entries(greek)) {
    out = out.split(k).join(v);
  }

  // Recursive function-call pretty-printer using a simple matching paren scanner
  const processCall = (name: string, args: string[]): string => {
    const la = args.map(a => calcpadToLatex(a.trim()));
    switch (name) {
      case 'integrate':
      case 'int':
        if (la.length >= 4) {
          return `\\int_{${la[2]}}^{${la[3]}} ${la[0]} \\, d${la[1]}`;
        }
        return `\\int ${la[0]} \\, d${la[1] || 'x'}`;
      case 'diff':
      case 'derivative':
        // diff(expr; var[; n])
        if (la.length >= 3 && /^\d+$/.test(args[2].trim())) {
          return `\\frac{d^{${la[2]}} ${la[0]}}{d${la[1]}^{${la[2]}}}`;
        }
        return `\\frac{d\\,${la[0]}}{d${la[1]}}`;
      case 'pdiff':
      case 'partial':
        return `\\frac{\\partial ${la[0]}}{\\partial ${la[1]}}`;
      case 'sqrt':
        return `\\sqrt{${la[0]}}`;
      case 'cbrt':
        return `\\sqrt[3]{${la[0]}}`;
      case 'sum':
        if (la.length >= 4) return `\\sum_{${la[1]}=${la[2]}}^{${la[3]}} ${la[0]}`;
        return `\\sum ${la.join(', ')}`;
      case 'product':
        if (la.length >= 4) return `\\prod_{${la[1]}=${la[2]}}^{${la[3]}} ${la[0]}`;
        return `\\prod ${la.join(', ')}`;
      case 'limit':
      case 'lim':
        return `\\lim_{${la[1]} \\to ${la[2]}} ${la[0]}`;
      case 'sin': case 'cos': case 'tan':
      case 'asin': case 'acos': case 'atan':
      case 'sinh': case 'cosh': case 'tanh':
      case 'log': case 'ln': case 'exp':
        return `\\${name}\\left(${la.join(', ')}\\right)`;
      case 'abs':
        return `\\left|${la[0]}\\right|`;
      case 'frac':
        return `\\frac{${la[0]}}{${la[1]}}`;
      default:
        // Generic function call
        return `\\mathrm{${name}}\\!\\left(${la.join(', ')}\\right)`;
    }
  };

  // Replace top-level name(...) function calls recursively
  const transformCalls = (s: string): string => {
    let result = '';
    let i = 0;
    while (i < s.length) {
      const m = s.substring(i).match(/^([a-zA-Z_][a-zA-Z_0-9]*)\s*\(/);
      if (m) {
        const name = m[1];
        const parenStart = i + m[0].length - 1;
        let depth = 1;
        let j = parenStart + 1;
        while (j < s.length && depth > 0) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')') depth--;
          if (depth === 0) break;
          j++;
        }
        if (depth === 0) {
          const inner = s.substring(parenStart + 1, j);
          // Split top-level args by `;` (fallback to `,`)
          const args = splitTopLevel(inner, inner.includes(';') ? ';' : ',');
          // Use the passed-through transformer so nested functions work
          const replaced = processCall(name, args);
          result += replaced;
          i = j + 1;
          continue;
        }
      }
      result += s[i];
      i++;
    }
    return result;
  };

  out = transformCalls(out);

  // Simple cosmetic substitutions that are safe at any level
  // `*` → `\cdot`   (but keep `**` alone since LaTeX doesn't use it)
  out = out.replace(/(?<!\*)\*(?!\*)/g, ' \\cdot ');
  // `x^2` → `x^{2}` (group the exponent if longer than 1 char)
  out = out.replace(/\^(\d+)/g, (_m, d) => `^{${d}}`);
  // `1/2` (only if both sides are short and simple) → `\frac{1}{2}`
  // We leave complex divisions alone — they look fine as a/b in most cases.

  return out;
}

/** Split a string by sep respecting nesting of (), [], {}. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === sep) {
      out.push(s.substring(start, i));
      start = i + 1;
    }
  }
  out.push(s.substring(start));
  return out;
}

// Expose parser on window for quick batch-checking of all examples
// from the browser console (used by scripts/check-all.js).
(window as unknown as { __calcpad: unknown }).__calcpad = { evalCalcpad };

// Load Calcpad desktop template CSS at runtime (avoids bundler parser issues).
// The CSS lives in public/template-calcpad.css. Use new URL so it works
// regardless of the GitHub Pages base path.
(function loadCalcpadTemplateCSS() {
  const url = new URL('template-calcpad.css', document.baseURI).href;
  fetch(url)
    .then(r => (r.ok ? r.text() : ''))
    .then(css => {
      if (!css) {
        console.warn('Calcpad template CSS empty:', url);
        return;
      }
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-source', 'calcpad-template');
      // Scope body rules to #output so we don't break the header/editor
      // and add !important so they win against the inline #output * {} rules.
      const scoped = css
        .replace(/(^|\s|,)body\b/g, '$1#output')
        .replace(/^\s*html\b[^{]*\{[^}]*\}/gm, '');
      // Inject a stronger Calcpad font rule for #output content
      // Extra rules: make sure text color is black and fonts match,
      // BUT leave .matrix / .matrix .tr / .matrix .td alone so the exact
      // Calcpad desktop matrix layout rules apply without interference.
      const extra = `
#output, #output p, #output var, #output .eq {
  font-family: 'Segoe UI', 'Arial Nova', Helvetica, sans-serif;
  color: black;
}
#output .eq, #output var {
  font-family: 'Georgia Pro', 'Century Schoolbook', 'Times New Roman', Times, serif;
  font-style: italic;
}
#output var { color: #061; }
#output h3 {
  font-family: 'Arial Nova', Helvetica, sans-serif;
  font-size: 1.4em;
  margin: 0.6em 0 0.3em;
  color: #036;
  border-bottom: 1px solid #ddd;
  padding-bottom: 0.2em;
}
#output p { margin: 0.3em 0; line-height: 150%; }
/* Matrix uses the exact .matrix / .matrix .tr / .matrix .td rules
   from the desktop template (loaded above). Do not override them here. */
#output .matrix .td { font-style: normal; }

/* KaTeX inside Calcpad equation context — force the template green
   color (#061) on all KaTeX glyphs so symbolic output matches the
   rest of the Calcpad template (green italic <var>). */
#output .eq .katex,
#output .eq .katex * {
  color: #061 !important;
  font-family: KaTeX_Main, 'Georgia Pro', 'Times New Roman', Times, serif !important;
}
#output .eq .katex .mord,
#output .eq .katex .mord * { color: #061 !important; }
#output .eq var > .katex,
#output .eq var > .katex * { color: #061 !important; }
`;
      styleEl.textContent = scoped + '\n' + extra;
      document.head.appendChild(styleEl);
      console.log('Calcpad template CSS loaded:', css.length, 'chars');
    })
    .catch(err => console.warn('Calcpad template CSS fetch failed:', err));
})();

const editor = document.getElementById('editor') as HTMLTextAreaElement;
const output = document.getElementById('output') as HTMLDivElement;
const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
const btnAutorun = document.getElementById('btn-autorun') as HTMLButtonElement;
const btnOpen = document.getElementById('btn-open') as HTMLButtonElement;
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnHelp = document.getElementById('btn-help') as HTMLButtonElement;
const btnFunctions = document.getElementById('btn-functions') as HTMLButtonElement;
const btnFunctionsBadge = document.getElementById('btn-functions-badge') as HTMLSpanElement;
const functionsModal = document.getElementById('functions-modal') as HTMLDivElement;
const functionsList = document.getElementById('functions-list') as HTMLDivElement;
const btnFunctionsClose = document.getElementById('btn-functions-close') as HTMLButtonElement;
const btnFnNew = document.getElementById('btn-fn-new') as HTMLButtonElement;
const fnForm = document.getElementById('fn-form') as HTMLDivElement;
const fnNameInput = document.getElementById('fn-name') as HTMLInputElement;
const fnParamsInput = document.getElementById('fn-params') as HTMLInputElement;
const fnBodyInput = document.getElementById('fn-body') as HTMLTextAreaElement;
const btnFnSave = document.getElementById('btn-fn-save') as HTMLButtonElement;
const btnFnCancel = document.getElementById('btn-fn-cancel') as HTMLButtonElement;
const exampleSelect = document.getElementById('example-select') as HTMLSelectElement;
const statusLines = document.getElementById('status-lines')!;
const statusTime = document.getElementById('status-time')!;
const statusVars = document.getElementById('status-vars')!;

let autorun = true;
let currentFilename = 'untitled.cpd';

// --- Hidden file input for Open ---
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.cpd,.txt';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

btnOpen.onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  const txt = await f.text();
  editor.value = txt;
  currentFilename = f.name;
  runScript();
};

// --- Save as .cpd ---
btnSave.onclick = () => {
  const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentFilename;
  a.click();
  URL.revokeObjectURL(url);
};

// --- Autorun toggle ---
btnAutorun.onclick = () => {
  autorun = !autorun;
  btnAutorun.classList.toggle('active', autorun);
  btnAutorun.textContent = autorun ? '⚡ Autorun' : '⚡ Manual';
};

// --- Render output blocks ---
function renderBlocks(blocks: OutputBlock[]): void {
  output.innerHTML = '';
  let fem3dCounter = 0;

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        // Calcpad uses <h3> for "Title (with one quote)
        const h = document.createElement('h3');
        h.textContent = block.text;
        output.appendChild(h);
        break;
      }
      case 'comment': {
        // Calcpad renders 'comments as <p> tags with HTML allowed
        const p = document.createElement('p');
        p.innerHTML = block.text;
        output.appendChild(p);
        break;
      }
      case 'assignment':
      case 'value': {
        // Calcpad pattern: <p><span class="eq"><var>name</var> = <result></span></p>
        const p = document.createElement('p');
        const eq = document.createElement('span');
        eq.className = 'eq';
        const v = document.createElement('var');
        v.textContent = block.name;
        eq.appendChild(v);
        eq.appendChild(document.createTextNode(' = '));
        const valSpan = document.createElement('span');
        valSpan.innerHTML = block.text; // matrix already HTML
        eq.appendChild(valSpan);
        p.appendChild(eq);
        output.appendChild(p);
        break;
      }
      case 'sym': {
        // Render #sym / #deq lines using ONLY the Calcpad desktop template
        // HTML (<var>, .dvc/.dvl fractions, .dvr/.nary integrals, <sup>,
        // <sub>, Unicode ∫/∑/∂/√). NO KaTeX — the template CSS handles all
        // styling (green italic, serif Georgia, bracket borders, etc.).
        const p = document.createElement('p');
        const eq = document.createElement('span');
        eq.className = 'eq';
        p.appendChild(eq);
        output.appendChild(p);

        const assignMatch = block.expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        const lhs = assignMatch ? assignMatch[1] : '';

        let resultText = block.result;
        if (assignMatch) {
          const mRes = resultText.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/);
          if (mRes) resultText = mRes[1];
        }

        const resultHtml = calcpadExprToHtml(resultText);

        if (lhs) {
          eq.innerHTML = `<var>${lhs}</var> = ${resultHtml}`;
        } else {
          eq.innerHTML = resultHtml;
        }
        // If this is an async CAS block, resolve it in the background and
        // patch the <var> element once the engine returns.
        if (block.async && block.engine) {
          const varEl = eq.querySelector('.sym-result') as HTMLElement;
          const engineName = block.engine as 'sympy' | 'maxima' | 'giac' | 'symengine';
          (async () => {
            try {
              // Init the specific engine if not already ready
              if (!casManager.engines[engineName].isReady()) {
                varEl.innerHTML = `<i style="color:#64748b">⏳ ${engineName} cargando (primera vez, ~10 MB)…</i>`;
                await casManager.initEngine(engineName);
              }
              const result = await casManager.engines[engineName].evaluate(block.expr);
              const text = result.text || result.latex || String(result.numeric ?? '');
              varEl.textContent = text;
              varEl.title = `engine: ${result.engine} — ${result.timeMs.toFixed(0)} ms`;
            } catch (err) {
              varEl.innerHTML = `<span class="err">${escapeHtml((err as Error).message)}</span>`;
            }
          })();
        }
        break;
      }
      case 'fem3d': {
        const wrap = document.createElement('div');
        wrap.className = 'canvas-wrapper';
        const id = `fem3d_${fem3dCounter++}`;
        wrap.id = id;
        output.appendChild(wrap);
        setTimeout(() => {
          try {
            fem3d(id, {
              nodes: block.nodes,
              elements: block.elements,
              values: block.values,
              options: { width: 700, height: 500 },
            });
          } catch (err) {
            wrap.innerHTML = `<div class="err">Fem3D error: ${(err as Error).message}</div>`;
          }
        }, 0);
        break;
      }
      case 'error': {
        const e = document.createElement('div');
        e.className = 'err';
        e.textContent = `Línea ${block.line}: ${block.message}`;
        output.appendChild(e);
        break;
      }
      default: {
        const r = document.createElement('div');
        r.className = 'var-line';
        r.textContent = (block as { text?: string }).text || '';
        output.appendChild(r);
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Last-known user functions from the most recent parse (for the UI panel). */
let lastFunctions: import('./parser/CalcpadParser').UserFunction[] = [];

function updateFunctionsBadge(): void {
  const n = lastFunctions.length;
  if (n === 0) {
    btnFunctionsBadge.style.display = 'none';
  } else {
    btnFunctionsBadge.style.display = 'inline-block';
    btnFunctionsBadge.textContent = String(n);
  }
}

function renderFunctionsList(): void {
  if (lastFunctions.length === 0) {
    functionsList.innerHTML =
      '<div style="color:#64748b;padding:12px;text-align:center;">' +
      'No hay funciones definidas. Usa <code>#function nombre(p1; p2) ... #end function</code> ' +
      'en tu script para crear una.</div>';
    return;
  }
  const rows: string[] = [];
  for (const fn of lastFunctions) {
    const sig = `${fn.name}(${fn.params.join('; ')})`;
    const preview = fn.body.slice(0, 4).map(l => l.trim()).filter(Boolean).join(' · ');
    rows.push(
      `<div class="fn-row" data-name="${fn.name}" data-params="${fn.params.join(';')}" ` +
      `style="padding:8px 10px;border-bottom:1px solid #e2e8f0;cursor:pointer;" ` +
      `onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">` +
      `<div><b style="color:#036;">ƒ</b> <code style="color:#0284c7;font-weight:600;">${sig}</code> ` +
      `<span style="color:#94a3b8;font-size:11px;">línea ${fn.line}</span></div>` +
      (preview ? `<div style="color:#64748b;font-size:11px;margin-top:2px;">${preview.slice(0, 120)}${preview.length > 120 ? '…' : ''}</div>` : '') +
      `</div>`
    );
  }
  functionsList.innerHTML = rows.join('');
  // Wire up click-to-insert: always append the call at the END of the
  // editor so we never accidentally split the #function definition.
  functionsList.querySelectorAll('.fn-row').forEach(el => {
    el.addEventListener('click', () => {
      const name = (el as HTMLElement).dataset.name || '';
      const params = ((el as HTMLElement).dataset.params || '').split(';').filter(Boolean);
      // Use placeholder parameter names so the user sees where to substitute.
      // They can edit them afterwards.
      const callText = `\n${name}(${params.join('; ')})\n`;
      const trailing = editor.value.endsWith('\n') ? '' : '\n';
      editor.value = editor.value + trailing + callText;
      // Move cursor to the newly inserted call so the user can immediately
      // replace the placeholder params with concrete values.
      const pos = editor.value.length - 1;
      editor.setSelectionRange(pos, pos);
      editor.focus();
      functionsModal.style.display = 'none';
      runScript();
    });
  });
}

function runScript(): void {
  const src = editor.value;
  const t0 = performance.now();
  try {
    const result = evalCalcpad(src);
    renderBlocks(result.blocks);
    lastFunctions = result.functions || [];
    updateFunctionsBadge();
    const dt = performance.now() - t0;
    statusLines.textContent = `${src.split('\n').length} lineas`;
    statusTime.textContent = `${dt.toFixed(0)} ms`;
    statusVars.textContent = `${Object.keys(result.scope).length} vars`;
    if (result.errors.length > 0) {
      const errBanner = document.createElement('div');
      errBanner.className = 'err';
      errBanner.textContent = `${result.errors.length} errores — revisa consola`;
      output.insertBefore(errBanner, output.firstChild);
      console.warn('Calcpad errors:', result.errors);
    }
  } catch (err) {
    output.innerHTML = `<div class="err">Error global: ${(err as Error).message}</div>`;
    console.error(err);
  }
}

// Debounced autorun (300ms after user stops typing)
let autorunTimer: number | null = null;
function scheduleAutorun(): void {
  if (!autorun) return;
  if (autorunTimer !== null) clearTimeout(autorunTimer);
  autorunTimer = window.setTimeout(() => {
    runScript();
    autorunTimer = null;
  }, 300);
}

editor.addEventListener('input', scheduleAutorun);

// Attach IDE-style autocomplete (#directives, built-ins, user #functions).
// Ctrl+Space to force-open; Tab/Enter to accept; Esc to cancel.
attachAutocomplete(editor, () => lastFunctions);

// Ctrl+Enter to run manually
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runScript();
  }
});

// --- Event listeners ---
btnRun.addEventListener('click', runScript);

btnClear.addEventListener('click', () => {
  editor.value = '';
  output.innerHTML = '';
  statusLines.textContent = '0 lineas';
  statusTime.textContent = '0 ms';
  statusVars.textContent = '0 vars';
  lastFunctions = [];
  updateFunctionsBadge();
});

// --- ƒ(x) Functions modal ---
btnFunctions.addEventListener('click', () => {
  renderFunctionsList();
  functionsModal.style.display = 'flex';
});
btnFunctionsClose.addEventListener('click', () => {
  functionsModal.style.display = 'none';
});
functionsModal.addEventListener('click', e => {
  // Click outside the modal content closes it
  if (e.target === functionsModal) functionsModal.style.display = 'none';
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && functionsModal.style.display === 'flex') {
    functionsModal.style.display = 'none';
  }
});

// --- "＋ Nueva función" form ---
btnFnNew.addEventListener('click', () => {
  fnForm.style.display = 'block';
  fnNameInput.value = '';
  fnParamsInput.value = '';
  fnBodyInput.value = "' tu código aquí\nresult = ";
  setTimeout(() => fnNameInput.focus(), 20);
});
btnFnCancel.addEventListener('click', () => {
  fnForm.style.display = 'none';
});
btnFnSave.addEventListener('click', () => {
  const name = fnNameInput.value.trim();
  const paramsRaw = fnParamsInput.value.trim();
  const body = fnBodyInput.value.replace(/\r\n/g, '\n');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    alert('Nombre inválido. Debe empezar con letra o _ y contener solo letras, números y _.');
    return;
  }
  // Normalize param separators: accept both , and ; — emit with ;
  const params = paramsRaw.split(/[;,]/).map(p => p.trim()).filter(Boolean);
  const header = `#function ${name}(${params.join('; ')})`;
  const footer = `#end function`;
  const bodyLines = body.split('\n').map(l => (l.startsWith('  ') ? l : '  ' + l)).join('\n');
  const fullBlock = `\n${header}\n${bodyLines}\n${footer}\n`;
  // Insert ONLY the definition at the top (so it's defined before any usage).
  // We deliberately do NOT auto-append a call line — the user calls the
  // function with concrete argument values by clicking the row in the list.
  editor.value = fullBlock + editor.value;
  fnForm.style.display = 'none';
  runScript();          // re-parse to pick up the new function
  // After re-parse, re-render the list (the new function is now in lastFunctions)
  renderFunctionsList();
  editor.focus();
});

btnHelp.addEventListener('click', () => {
  output.innerHTML = `
<div class="heading">Calcpad-Symbolic Web — Ayuda</div>
<div class="comment">
  <p><b>Subset soportado del lenguaje Calcpad:</b></p>
  <ul>
    <li><code>'comentario</code> — comentario de linea</li>
    <li><code>"Titulo</code> — encabezado H3</li>
    <li><code>nombre = expresion</code> — asignacion</li>
    <li><code>nombre</code> — imprime el valor de la variable</li>
    <li><code>[1;2;3]</code> — vector columna; <code>[1;2|3;4]</code> — matriz 2x2</li>
    <li><code>M.(i;j)</code> — acceso a elemento de matriz (1-based)</li>
    <li><code>#for i = 1 : N ... #loop</code> — bucle</li>
    <li><code>#if cond ... #else ... #end if</code> — condicional</li>
    <li><code>#hide ... #show</code> — ocultar output</li>
  </ul>
  <p><b>Funciones FEM nativas:</b></p>
  <ul>
    <li><code>mesh_hex8_nodes([Lx;Ly;Lz;nx;ny;nz;centered])</code></li>
    <li><code>mesh_hex8_elems([nx;ny;nz])</code></li>
    <li><code>mesh_soil_specs([Lx;Ly;Lz;nx;ny;nz;centered;Pz])</code></li>
    <li><code>mesh_soil_specs_rect([Lx;Ly;Lz;nx;ny;nz;centered;Rx;Ry;q])</code></li>
    <li><code>fem_hex8(nodes; elems; E; nu; specs)</code></li>
    <li><code>fem_hex8_stress(nodes; elems; E; nu; u)</code></li>
  </ul>
  <p><b>Visualizacion:</b></p>
  <ul>
    <li><code>$Fem3D{Xn; Yn; Zn; elems; values}</code> — contour plot 3D con clipping planes</li>
  </ul>
  <p><b>Atajos:</b> Ctrl+Enter ejecuta. Autorun (toggle) ejecuta automáticamente al editar.</p>
</div>
`;
});

// --- Load 390+ examples from public/examples/index.json ---
type ExampleIndex = {
  groups: Record<string, { path: string; name: string }[]>;
  total: number;
};

async function loadExamplesIndex(): Promise<void> {
  try {
    const baseUrl = import.meta.env.BASE_URL || '/';
    const res = await fetch(baseUrl + 'examples/index.json');
    if (!res.ok) {
      console.warn('No examples/index.json found');
      return;
    }
    const idx: ExampleIndex = await res.json();

    // Update header label with total
    exampleSelect.options[0].text = `📂 Ejemplos (${idx.total})`;

    // Build optgroups
    const sortedGroups = Object.keys(idx.groups).sort();
    for (const groupName of sortedGroups) {
      const og = document.createElement('optgroup');
      og.label = groupName;
      const items = idx.groups[groupName];
      // Sort by name
      items.sort((a, b) => a.name.localeCompare(b.name));
      for (const item of items) {
        const opt = document.createElement('option');
        opt.value = item.path;
        opt.textContent = item.name;
        og.appendChild(opt);
      }
      exampleSelect.appendChild(og);
    }
    console.log(`Loaded ${idx.total} examples in ${sortedGroups.length} groups`);
  } catch (err) {
    console.error('Failed to load examples index:', err);
  }
}

exampleSelect.addEventListener('change', async () => {
  const path = exampleSelect.value;
  if (!path) return;
  try {
    const baseUrl = import.meta.env.BASE_URL || '/';
    const res = await fetch(baseUrl + 'examples/' + path);
    if (!res.ok) {
      output.innerHTML = `<div class="err">No se pudo cargar ${path} (HTTP ${res.status})</div>`;
      return;
    }
    const text = await res.text();
    editor.value = text;
    currentFilename = path.split('/').pop() || 'example.cpd';
    runScript();
  } catch (err) {
    output.innerHTML = `<div class="err">Error cargando ejemplo: ${(err as Error).message}</div>`;
  }
});

// --- Default welcome script ---
editor.value = `' Calcpad-Symbolic Web — bienvenido!
' Selecciona un ejemplo del menu "📂 Ejemplos (390+)" o escribe tu propio script.
' Atajos:
'   Ctrl+Enter — ejecutar
'   ⚡ Autorun — ejecuta al escribir (toggle)

"Ejemplo rapido: matriz 3x3
A = [1;2;3|4;5;6|7;8;10]
A

'<b>Determinante:</b>
d = det(A)
d

'<b>Inversa:</b>
Ainv = inv(A)
Ainv

'<b>Resolver sistema Ax = b:</b>
b = [1;2;3]
x = lusolve(A; b)
x
`;

// Init
loadExamplesIndex();
runScript();
