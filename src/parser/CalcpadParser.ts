// Minimal Calcpad parser for the web version.
//
// Supports a functional subset of the Calcpad-Symbolic language:
//   - Comments: ' text at start of line (inline after value)
//   - Titles:   "Title (renders as H3)
//   - Assignments: name = expr
//   - Expressions with math.js operators and functions
//   - Matrices/vectors: [1;2;3]  [1;2|3;4]
//   - Multiple expressions on one line: a = 1','b = 2
//   - Number/variable display: just the name alone prints its value
//   - Loops: #for i = 1:N ... #loop
//   - Conditionals: #if cond ... #else ... #end if
//   - Show/hide: #hide ... #show
//   - Built-in FEM functions: mesh_hex8_nodes, mesh_hex8_elems,
//     mesh_soil_specs, mesh_soil_specs_rect, fem_hex8, fem_hex8_stress
//   - $Fem3D{Xn; Yn; Zn; elems; values @ options} renders a 3D contour plot
//
// NOT supported yet: #function definitions, #sym/#python/#maxima blocks,
// $Chart/$Plot/$Map, nested contexts, units.

import { create, all } from 'mathjs';
import { solveHex8, computeSigmaZZ, meshHex8Box } from '../fem/FemSolver';
import { installSymbolic, symDiff, symIntegrate, symSimplify, symExpand, symFactor, symSolve, symSubs, symToLatex } from '../symbolic/Symbolic';

const math = create(all);

/**
 * math.js reserved identifiers that collide with user variables in engineering
 * scripts. When any of these appear as a bare word in a Calcpad expression,
 * we rename it to `__cp_<name>` before passing to math.evaluate, and keep
 * both aliases in the scope on assignment. This ensures `h = 10; r*r*h`
 * works even though math.js natively treats `h` as "hours".
 *
 * Covers: SI units (m, kg, s, A, K, mol, cd, ...), derived units (N, Pa, J,
 * W, V, Ω, F, T, H, ...), time (h, min, d, y), physical constants (E/e for
 * Euler, c for speed of light, pi, phi, i for imaginary), and common
 * structural/matrix variable names that mathjs has as constants or functions.
 */
const RESERVED_RENAMED = new Set<string>([
  // SI base + derived units
  'm', 'g', 'kg', 's', 'A', 'K', 'mol', 'cd', 'rad', 'sr',
  'N', 'Pa', 'J', 'W', 'C', 'V', 'F', 'S', 'Wb', 'T', 'H',
  'lm', 'lx', 'Bq', 'Gy', 'Sv', 'kat',
  'min', 'h', 'd', 'y', 'Hz',
  'L', 'l',
  'bar', 'atm', 'torr',
  'in', 'ft', 'yd', 'mi',
  'lb', 'oz',
  // Physical constants / reserved names
  'E', 'e', 'pi', 'i', 'phi', 'tau', 'c',
  'Inf', 'NaN',
]);

/**
 * The set of user-defined variables in the CURRENT script. Populated on
 * each evalCalcpad() call before any expression is translated. Only names
 * in this set get renamed (from `h` → `__cp_h`) when they collide with a
 * math.js reserved unit/constant — so units still work in expressions that
 * do NOT define a conflicting variable.
 *
 * Example:
 *   h = 10      ← user assignment; adds "h" to the set
 *   r*r*h       ← now "h" is treated as the variable, not hours
 *
 *   5*h         ← in a script with NO "h = ..." assignment, stays as hours
 */
let USER_DEFINED_NAMES = new Set<string>();

/**
 * Pre-scan the source lines for assignments `name = ...` and `#function name(...)`,
 * plus `#for name = ...`, and fill USER_DEFINED_NAMES. This needs to run
 * BEFORE translateExpr ever gets called so escapeReserved knows which
 * reserved names to rename.
 */
function collectUserNames(source: string): Set<string> {
  const names = new Set<string>();
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("'") || line.startsWith('"')) continue;
    // assignment: name = expr  (and `name{i} = ...` / `name.(i;j) = ...`)
    let m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[({.=]/);
    if (m && /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.test(line)) {
      // simple assignment
      const mm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (mm) names.add(mm[1]);
    }
    // name.(i;j) = ...  or name{i} = ...
    m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[.\{]/);
    if (m) names.add(m[1]);
    // #for i = ...
    m = line.match(/^#for\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) names.add(m[1]);
    // #function name(p1; p2) — add name AND params
    m = line.match(/^#function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
    if (m) {
      names.add(m[1]);
      for (const p of m[2].split(';').map(s => s.trim()).filter(Boolean)) {
        names.add(p);
      }
    }
  }
  return names;
}

/**
 * Replace only those occurrences of reserved identifiers with `__cp_<name>`
 * that the user has actually defined as a variable. Names not in
 * USER_DEFINED_NAMES stay as-is so math.js can still treat them as units.
 */
function escapeReserved(expr: string): string {
  return expr.replace(/\b([A-Za-z]+)\b/g, (match, word, offset) => {
    if (!RESERVED_RENAMED.has(word)) return match;
    if (!USER_DEFINED_NAMES.has(word)) return match;   // NEW: only rename if user-defined
    if (offset > 0) {
      const prev = expr[offset - 1];
      if (/[0-9.]/.test(prev)) return match;
    }
    return '__cp_' + word;
  });
}

export interface UserFunction {
  name: string;
  params: string[];
  line: number;            // line number of the #function declaration (1-based)
  body: string[];          // raw body lines for preview / edit
}

export interface ParseResult {
  /** Blocks produced: text, heading, assignment, matrix, fem3d */
  blocks: OutputBlock[];
  /** Errors encountered while parsing/evaluating */
  errors: { line: number; message: string }[];
  /** Scope after execution (for debugging / variable inspector) */
  scope: Record<string, unknown>;
  /** User-defined functions collected during parse (for UI listing) */
  functions: UserFunction[];
}

export type OutputBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'value'; name: string; text: string; value: unknown }
  | { kind: 'assignment'; name: string; expr: string; text: string; value: unknown }
  | { kind: 'raw'; text: string }
  | { kind: 'sym'; expr: string; result: string; latex: string; engine?: 'nerdamer' | 'sympy' | 'maxima' | 'giac' | 'symengine'; async?: boolean }
  | { kind: 'fem3d'; nodes: number[][]; elements: number[][]; values: number[]; title?: string }
  | { kind: 'error'; line: number; message: string };

/** Format a scalar number Calcpad-style (short, no trailing zeros). */
function formatNumber(v: number): string {
  if (!isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs < 1e-4 || abs >= 1e5) {
    const exp = v.toExponential(3);
    const [mant, e] = exp.split('e');
    return `${parseFloat(mant)} · 10<sup>${parseInt(e)}</sup>`;
  }
  let s = v.toPrecision(6);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/**
 * Format a value using EXACTLY the same HTML structure as Calcpad desktop CLI.
 * The desktop output (from CLI.exe) produces this structure for matrices:
 *
 *   <span class="matrix">
 *     <span class="tr">
 *       <span class="td"></span>   <-- empty (left bracket padding)
 *       <span class="td">1</span>
 *       <span class="td">2</span>
 *       <span class="td"></span>   <-- empty (right bracket padding)
 *     </span>
 *     ...
 *   </span>
 *
 * IMPORTANT: all rows MUST have the same number of <span class="td"> cells,
 * otherwise the CSS grid/inline-block layout breaks and the brackets misalign.
 * We pad short rows with empty <td> spans.
 */
function formatValue(v: unknown): string {
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? '1' : '0';

  // Cell array (Matlab-style): render with the exact bracket style of a
  // matrix — single-row inline-table with the .matrix CSS class. Inside
  // each data cell we put a small {i} label followed by the content
  // (matrix / vector / scalar / empty).
  if (v && typeof v === 'object' && (v as { __cell?: boolean }).__cell) {
    const items = (v as { items: unknown[] }).items;
    const parts: string[] = [
      '<span class="matrix">',
      '<span class="tr">',
      '<span class="td"></span>'   // left [ bracket pad
    ];
    items.forEach((it, idx) => {
      const cellHtml = (it === null || it === undefined) ? '<i>∅</i>' : formatValue(it);
      parts.push(
        `<span class="td" style="padding:4px 8px;vertical-align:middle;text-align:center;">` +
        `<span style="display:block;font-size:0.75em;color:#888;font-style:normal;">{${idx + 1}}</span>` +
        cellHtml +
        `</span>`
      );
    });
    parts.push('<span class="td"></span>'); // right ] bracket pad
    parts.push('</span></span>');
    return parts.join('');
  }

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';

    // Matrix: normalize to 2D, pad rows, render
    if (Array.isArray(v[0])) {
      const rows = v as unknown[][];
      // Find max number of cells in any row
      const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      const out: string[] = ['<span class="matrix">'];
      for (const r of rows) {
        out.push('<span class="tr">');
        out.push('<span class="td"></span>'); // left bracket pad
        for (let i = 0; i < maxCols; i++) {
          const cell = i < r.length ? formatValue(r[i]) : '';
          out.push(`<span class="td">${cell}</span>`);
        }
        out.push('<span class="td"></span>'); // right bracket pad
        out.push('</span>');
      }
      out.push('</span>');
      return out.join('');
    }

    // Column vector: 1 cell per row
    const vec = v as unknown[];
    const out: string[] = ['<span class="matrix">'];
    for (const x of vec) {
      out.push('<span class="tr"><span class="td"></span>');
      out.push(`<span class="td">${formatValue(x)}</span>`);
      out.push('<span class="td"></span></span>');
    }
    out.push('</span>');
    return out.join('');
  }

  try {
    if (v && typeof v === 'object' && 'valueOf' in v) {
      const raw = (v as { valueOf: () => unknown }).valueOf();
      if (raw !== v) return formatValue(raw);
    }
  } catch {}
  return String(v);
}

/** Pre-process an expression to translate Calcpad syntax to math.js syntax.
 *
 * Key challenge: `;` is used as separator in MANY contexts:
 *  1. Inside `[...]` literals (matrix row separator)
 *  2. Inside `A.(i;j)` indexing (row/col separator)
 *  3. Inside function calls `f(a;b;c)` (argument separator)
 *  4. Statement separator (outside these)
 *
 * We tokenize and treat each context correctly.
 */
function translateExpr(expr: string): string {
  // Calcpad Unicode operators → mathjs operators.
  // Done BEFORE anything else so ≡ inside #if becomes ==, ≠ becomes !=, etc.
  // These are harmless outside #if/#for (no ambiguity with other uses).
  expr = expr
    .replace(/≡/g, '==')
    .replace(/≠/g, '!=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/∨/g, '|')   // logical or (Calcpad uses unicode ∨)
    .replace(/∧/g, '&')   // logical and
    .replace(/÷/g, '/')
    .replace(/×/g, '*');

  // Walk char-by-char, tracking bracket depth.
  // Replace `;` with `,` everywhere except inside [] (where we convert to rows).
  const chars = expr.split('');
  const out: string[] = [];
  let i = 0;

  while (i < chars.length) {
    const c = chars[i];
    if (c === '[') {
      // Scan the whole bracket literal, then translate it
      let depth = 1;
      let j = i + 1;
      while (j < chars.length && depth > 0) {
        if (chars[j] === '[') depth++;
        else if (chars[j] === ']') depth--;
        if (depth === 0) break;
        j++;
      }
      const inner = expr.substring(i + 1, j);
      // Recursively translate inner (to handle nested [] and function calls)
      // First split rows by | then cells by ;
      const rowsStr = inner.split('|').map(row => {
        const cells = row.split(';').map(c => translateExpr(c.trim()));
        return '[' + cells.join(',') + ']';
      });
      if (rowsStr.length === 1) {
        out.push(rowsStr[0]);
      } else {
        out.push('[' + rowsStr.join(',') + ']');
      }
      i = j + 1;
      continue;
    }
    if (c === '(') {
      // Scan to matching ), translate recursively, convert `;` inside to `,`
      let depth = 1;
      let j = i + 1;
      while (j < chars.length && depth > 0) {
        if (chars[j] === '(') depth++;
        else if (chars[j] === ')') depth--;
        if (depth === 0) break;
        j++;
      }
      const inner = expr.substring(i + 1, j);
      // Split top-level args by `;` (honoring nested [] and ())
      const args = splitTopLevel(inner, ';').map(a => translateExpr(a.trim()));
      out.push('(' + args.join(',') + ')');
      i = j + 1;
      continue;
    }
    if (c === '{') {
      // Cell-array indexing: A{i} — scan to matching }, translate inner,
      // emit a marker we'll post-process into __cellGet(A, i).
      // We keep the {} in the stream; the post-processing regex turns
      // <name>{<expr>} into __cellGet(name, expr).
      let depth = 1;
      let j = i + 1;
      while (j < chars.length && depth > 0) {
        if (chars[j] === '{') depth++;
        else if (chars[j] === '}') depth--;
        if (depth === 0) break;
        j++;
      }
      const inner = expr.substring(i + 1, j);
      out.push('{' + translateExpr(inner) + '}');
      i = j + 1;
      continue;
    }
    if (c === ';') {
      // Top-level ; becomes ,
      out.push(',');
      i++;
      continue;
    }
    out.push(c);
    i++;
  }
  let s = out.join('');

  // Indexing: A.(i,j) -> A[i,j]   (math.js uses 1-based indexing, same as Calcpad)
  // (we already converted ; to , above inside parens)
  s = s.replace(/\.\(([^()]+)\)/g, (_m, idx) => {
    const parts = idx.split(',').map((p: string) => p.trim());
    if (parts.length === 1) return `[${parts[0]}]`;
    return `[${parts.join(',')}]`;
  });

  // Simple index: X.3 -> X[3]   (1-based, math.js compatible)
  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.(\d+)\b/g, (_m, name, idx) => `${name}[${parseInt(idx)}]`);

  // Cell-array read: name{idx} -> __cellGet(name, idx)
  // Match name followed by {...} where ... has no nested { }.
  // (Our tokenizer already prevents nested {} from collapsing into one.)
  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\{([^{}]+)\}/g,
    (_m, name, idx) => `__cellGet(${name},${idx})`);

  // Strip Calcpad physical units (math.js doesn't know them).
  // Pattern: number followed by * unit, or number followed by unit identifier.
  // Common units: tonf, kgf, kN, MN, N, kPa, MPa, GPa, Pa, mm, cm, m, km, in, ft,
  //               s, min, h, deg, rad, °, kg, g, lb, lbf, kip, psi, ksi, etc.
  s = stripUnits(s);

  // Strip inline $Directive{...} blocks (e.g. $Area{N*q @ x=0:1}).
  // We replace them with NaN since we cannot evaluate them in the web.
  // This prevents 'Unexpected operator {' errors.
  s = stripDollarDirectives(s);

  // Finally: rename reserved identifiers (h, A, E, ...) to __cp_<name>
  // ONLY when the user has defined them as variables in this script.
  s = escapeReserved(s);

  return s;
}

/** Replace $Foo{...} (with balanced braces) with NaN. */
function stripDollarDirectives(s: string): string {
  let result = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$') {
      const m = s.substring(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)\{/);
      if (m) {
        // Find matching closing brace
        let depth = 1;
        let j = i + m[0].length;
        while (j < s.length && depth > 0) {
          if (s[j] === '{') depth++;
          else if (s[j] === '}') depth--;
          if (depth === 0) break;
          j++;
        }
        result += '0'; // placeholder
        i = j + 1;
        continue;
      }
    }
    result += s[i];
    i++;
  }
  return result;
}

// List of unit tokens to strip (Calcpad uses these inline; math.js parses as identifiers)
const UNIT_TOKENS = new Set([
  // SI lengths
  'mm', 'cm', 'dm', 'm', 'km', 'um', 'nm',
  // Imperial lengths
  'in', 'ft', 'yd', 'mi',
  // Forces
  'N', 'kN', 'MN', 'GN', 'kgf', 'tonf', 'lbf', 'kip',
  // Mass
  'g', 'kg', 't', 'lb', 'oz',
  // Pressures / stresses
  'Pa', 'kPa', 'MPa', 'GPa', 'bar', 'atm', 'psi', 'ksi', 'Msi', 'Torr',
  // Time
  's', 'ms', 'us', 'ns', 'min', 'h', 'd', 'yr',
  // Angles
  'deg', 'rad', 'gon', '°',
  // Temperature
  'K', '°C', '°F', 'degC', 'degF',
  // Energy
  'J', 'kJ', 'MJ', 'cal', 'kcal', 'Wh', 'kWh', 'eV', 'BTU',
  // Power
  'W', 'kW', 'MW', 'GW', 'hp',
  // Frequency
  'Hz', 'kHz', 'MHz', 'GHz',
  // Areas
  'm2', 'cm2', 'mm2', 'km2', 'ha', 'in2', 'ft2',
  // Volumes
  'm3', 'cm3', 'mm3', 'L', 'mL', 'gal',
  // Misc
  'mol', 'A', 'V', 'kV', 'MV', 'ohm', 'F', 'H', 'T', 'Wb',
]);

/**
 * Strip Calcpad physical units from an expression.
 * - "100*tonf" -> "100"
 * - "5 m" -> "5" (when followed by a unit)
 * - "F = 100*tonf + 50*kN" -> "F = 100 + 50"
 * Variables with the same name as units are NOT stripped if not preceded by * or number.
 */
function stripUnits(s: string): string {
  // Tokenize: keep operators and identifiers separate
  let result = '';
  let i = 0;
  while (i < s.length) {
    // Try to match an identifier
    const m = s.substring(i).match(/^([A-Za-z_°][A-Za-z0-9_°]*)/);
    if (m) {
      const id = m[1];
      // CRITICAL: if this identifier is also a user-defined variable, it
      // is NOT a unit — leave it alone. This is what lets `h = 10; r*r*h`
      // work while still stripping `5*tonf` etc.
      const isUserVar = USER_DEFINED_NAMES.has(id);
      if (UNIT_TOKENS.has(id) && !isUserVar) {
        // Look back to see if preceded by * or by a digit (with possible whitespace)
        const before = result.replace(/\s+$/, '');
        const lastChar = before.slice(-1);
        const isAfterMultiply = lastChar === '*';
        const isAfterNumber = /[0-9.)]$/.test(before);
        if (isAfterMultiply) {
          // Strip the * and the unit: "100*tonf" -> "100"
          result = before.slice(0, -1);
          i += id.length;
          continue;
        }
        if (isAfterNumber) {
          // Just strip the unit (with any space before it): "5 m" -> "5"
          result = before;
          i += id.length;
          continue;
        }
        // Otherwise it might be a variable named like a unit — leave it alone
      }
      result += id;
      i += id.length;
      continue;
    }
    result += s[i];
    i++;
  }
  return result;
}

/** Split a string by `sep` respecting nesting of [], (), {}. */
function splitTopLevel(s: string, sep: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') depth--;
    else if (c === sep && depth === 0) {
      result.push(s.substring(start, i));
      start = i + 1;
    }
  }
  result.push(s.substring(start));
  return result;
}

/** Install the custom FEM functions in a math.js scope. */
function installFemFunctions(scope: Record<string, unknown>): void {
  const m = math;

  scope.mesh_hex8_nodes = function (params: number[]): number[][] {
    const [Lx, Ly, Lz, nx, ny, nz, centered = 1] = params;
    const mesh = meshHex8Box(Lx, Ly, Lz, nx, ny, nz, centered >= 0.5);
    return mesh.nodes;
  };

  scope.mesh_hex8_elems = function (params: number[]): number[][] {
    const [nx, ny, nz] = params;
    const mesh = meshHex8Box(1, 1, 1, nx, ny, nz, false);
    // Return 1-based indices (Calcpad convention)
    return mesh.elements.map(row => row.map(x => x + 1));
  };

  scope.fem_hex8 = function (
    nodes: number[][],
    elems: number[][],
    E: number,
    nu: number,
    specs: number[][]
  ): number[] {
    // Split specs rows: col[0]==1 is load, col[0]==2 is BC
    const loads: { nodeId: number; fx: number; fy: number; fz: number }[] = [];
    const bcs: { dofId: number; value: number }[] = [];
    for (const row of specs) {
      if (row[0] === 1) {
        loads.push({ nodeId: row[1] - 1, fx: row[2] || 0, fy: row[3] || 0, fz: row[4] || 0 });
      } else if (row[0] === 2) {
        bcs.push({ dofId: row[1] - 1, value: row[2] || 0 });
      }
    }
    // Convert 1-based elements to 0-based
    const elems0 = elems.map(row => row.map(x => x - 1));
    const res = solveHex8({ nodes, elements: elems0, E, nu, loads, bcs });
    return res.u;
  };

  scope.fem_hex8_stress = function (
    nodes: number[][],
    elems: number[][],
    E: number,
    nu: number,
    u: number[]
  ): number[] {
    const elems0 = elems.map(row => row.map(x => x - 1));
    // For now return just sigma_zz; a full Nx6 matrix can be added later.
    return computeSigmaZZ(nodes, elems0, u, E, nu);
  };

  scope.mesh_soil_specs = function (params: number[]): number[][] {
    const [Lx, Ly, Lz, nx, ny, nz, centered, Pz] = params;
    const mesh = meshHex8Box(Lx, Ly, Lz, nx, ny, nz, centered >= 0.5);
    const TOL = Math.min(Lx / nx, Ly / ny, Lz / nz) / 100;
    const x0 = centered >= 0.5 ? -Lx / 2 : 0;
    const y0 = centered >= 0.5 ? -Ly / 2 : 0;
    const xC = centered >= 0.5 ? 0 : Lx / 2;
    const yC = centered >= 0.5 ? 0 : Ly / 2;

    let tcId = -1;
    for (let i = 0; i < mesh.nodes.length; i++) {
      const [x, y, z] = mesh.nodes[i];
      if (Math.abs(x - xC) < TOL && Math.abs(y - yC) < TOL && z > Lz - TOL) {
        tcId = i;
        break;
      }
    }

    const specs: number[][] = [];
    specs.push([1, tcId + 1, 0, 0, Pz]);

    for (let i = 0; i < mesh.nodes.length; i++) {
      const [x, y, z] = mesh.nodes[i];
      const onBase = z < TOL;
      const onLat =
        x < x0 + TOL || x > x0 + Lx - TOL || y < y0 + TOL || y > y0 + Ly - TOL;
      if (onBase || onLat) {
        for (let d = 1; d <= 3; d++) {
          specs.push([2, 3 * i + d, 0, 0, 0]);
        }
      }
    }
    return specs;
  };

  scope.mesh_soil_specs_rect = function (params: number[]): number[][] {
    const [Lx, Ly, Lz, nx, ny, nz, centered, Rx, Ry, q] = params;
    const mesh = meshHex8Box(Lx, Ly, Lz, nx, ny, nz, centered >= 0.5);
    const dx = Lx / nx, dy = Ly / ny;
    const TOL = Math.min(dx, dy, Lz / nz) / 100;
    const x0 = centered >= 0.5 ? -Lx / 2 : 0;
    const y0 = centered >= 0.5 ? -Ly / 2 : 0;
    const xC = centered >= 0.5 ? 0 : Lx / 2;
    const yC = centered >= 0.5 ? 0 : Ly / 2;

    const specs: number[][] = [];

    // Distributed load
    for (let i = 0; i < mesh.nodes.length; i++) {
      const [x, y, z] = mesh.nodes[i];
      if (z > Lz - TOL) {
        const xr = x - xC;
        const yr = y - yC;
        if (Math.abs(xr) <= Rx / 2 + TOL && Math.abs(yr) <= Ry / 2 + TOL) {
          const onXEdge = Math.abs(Math.abs(xr) - Rx / 2) < TOL;
          const onYEdge = Math.abs(Math.abs(yr) - Ry / 2) < TOL;
          let f = 1;
          if (onXEdge) f *= 0.5;
          if (onYEdge) f *= 0.5;
          const Fz = -q * dx * dy * f;
          specs.push([1, i + 1, 0, 0, Fz]);
        }
      }
    }

    // BCs
    for (let i = 0; i < mesh.nodes.length; i++) {
      const [x, y, z] = mesh.nodes[i];
      const onBase = z < TOL;
      const onLat =
        x < x0 + TOL || x > x0 + Lx - TOL || y < y0 + TOL || y > y0 + Ly - TOL;
      if (onBase || onLat) {
        for (let d = 1; d <= 3; d++) {
          specs.push([2, 3 * i + d, 0, 0, 0]);
        }
      }
    }
    return specs;
  };

  // Helpers: col(matrix; k) -> extract column k (1-based)
  scope.col = function (mat: number[][], k: number): number[] {
    return mat.map(row => row[k - 1]);
  };

  // vector(n) -> zeros(n)
  scope.vector = function (n: number): number[] {
    return new Array(n).fill(0);
  };

  // matrix(rows; cols) -> zeros(rows, cols)
  scope.matrix = function (rows: number, cols: number): number[][] {
    const m: number[][] = [];
    for (let i = 0; i < rows; i++) m.push(new Array(cols).fill(0));
    return m;
  };

  // === Cell arrays (Matlab-style) ===
  // cell(n) returns a CellArray of n empty slots.
  // Syntax: A{i}           reads slot i (1-based)
  //         A{i} = expr    writes slot i
  //         len(A)         returns n
  // Supported content: scalars, vectors, matrices — anything storable in scope.
  scope.cell = function (n: number): { __cell: true; items: unknown[] } {
    return { __cell: true, items: new Array(Math.max(0, Math.floor(n))).fill(null) };
  };

  // Post-processed read: __cellGet(A, i) — 1-based, error on out-of-range.
  scope.__cellGet = function (A: unknown, i: number): unknown {
    if (A && typeof A === 'object' && (A as { __cell?: boolean }).__cell) {
      const items = (A as { items: unknown[] }).items;
      const idx = Math.floor(i) - 1;
      if (idx < 0 || idx >= items.length)
        throw new Error(`Cell index out of range: ${i} (1..${items.length})`);
      return items[idx];
    }
    // Fallback: if the user writes M{i} on a regular matrix, treat it as row-i.
    if (Array.isArray(A)) return (A as unknown[])[Math.floor(i) - 1];
    throw new Error('__cellGet: not a cell array');
  };

  // Post-processed write: __cellSet(A, i, value) — used by assignment handler.
  scope.__cellSet = function (A: unknown, i: number, value: unknown): unknown {
    if (A && typeof A === 'object' && (A as { __cell?: boolean }).__cell) {
      const items = (A as { items: unknown[] }).items;
      const idx = Math.floor(i) - 1;
      if (idx < 0) throw new Error(`Cell index must be >= 1 (got ${i})`);
      // Auto-grow if within a small margin (Matlab behavior)
      while (items.length <= idx) items.push(null);
      items[idx] = value;
      return A;
    }
    throw new Error('__cellSet: not a cell array');
  };

  // n_rows / n_cols
  scope.n_rows = function (mat: number[][]): number {
    return mat.length;
  };
  scope.n_cols = function (mat: number[][]): number {
    return Array.isArray(mat[0]) ? mat[0].length : 1;
  };

  // min / max on arrays (wrap math.js)
  const origMin = m.min.bind(m);
  const origMax = m.max.bind(m);
  scope.min = function (...args: unknown[]): number {
    if (args.length === 1 && Array.isArray(args[0])) {
      return origMin(...(args[0] as number[]));
    }
    return origMin(...(args as number[]));
  };
  scope.max = function (...args: unknown[]): number {
    if (args.length === 1 && Array.isArray(args[0])) {
      return origMax(...(args[0] as number[]));
    }
    return origMax(...(args as number[]));
  };
  scope.len = function (v: unknown): number {
    if (v && typeof v === 'object' && (v as { __cell?: boolean }).__cell) {
      return (v as { items: unknown[] }).items.length;
    }
    if (Array.isArray(v)) return v.length;
    return 0;
  };
  scope.length = scope.len;
  scope.pi = Math.PI;
  scope.π = Math.PI;
  scope.e = Math.E;

  // === Calcpad-specific helper functions — match desktop Calculator.cs ===
  scope.sqr = (x: number) => x * x;
  scope.cube = (x: number) => x * x * x;
  scope.cbrt = (x: number) => Math.cbrt(x);
  scope.sgn = (x: number) => Math.sign(x);
  scope.sign = (x: number) => Math.sign(x);
  // NOTE: Heaviside is 'heaviside' not 'h' — 'h' collides with common user
  // variables (height, h in Lz/h ratios, etc). Calcpad desktop uses 'h' but
  // we trade off exact parity for usability here.
  scope.heaviside = (x: number) => (x >= 0 ? 1 : 0);
  scope.if = (cond: number | boolean, a: unknown, b: unknown) => (cond ? a : b);
  scope.ceiling = (x: number) => Math.ceil(x);
  scope.trunc = (x: number) => Math.trunc(x);
  scope.re = (x: number | { re?: number }) =>
    typeof x === 'number' ? x : (x && typeof x.re === 'number' ? x.re : 0);
  scope.im = (x: number | { im?: number }) =>
    typeof x === 'number' ? 0 : (x && typeof x.im === 'number' ? x.im : 0);
  scope.phase = (x: number | { re?: number; im?: number }) =>
    typeof x === 'number' ? (x < 0 ? Math.PI : 0) : Math.atan2(x?.im ?? 0, x?.re ?? 0);
  scope.conj = (x: number | { re?: number; im?: number }) =>
    typeof x === 'number' ? x : { re: x?.re ?? 0, im: -(x?.im ?? 0) };
  scope.random = () => Math.random();
  scope.fact = (n: number) => {
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  };
  scope.timer = () => performance.now() / 1000;
  scope.not = (x: number) => (x ? 0 : 1);
  scope.log_2 = (x: number) => Math.log2(x);

  // Trigonometric extras missing in math.js (usually)
  scope.csc = (x: number) => 1 / Math.sin(x);
  scope.sec = (x: number) => 1 / Math.cos(x);
  scope.cot = (x: number) => 1 / Math.tan(x);
  scope.acsc = (x: number) => Math.asin(1 / x);
  scope.asec = (x: number) => Math.acos(1 / x);
  scope.acot = (x: number) => Math.atan(1 / x);
  scope.csch = (x: number) => 1 / Math.sinh(x);
  scope.sech = (x: number) => 1 / Math.cosh(x);
  scope.coth = (x: number) => 1 / Math.tanh(x);
  scope.acsch = (x: number) => Math.asinh(1 / x);
  scope.asech = (x: number) => Math.acosh(1 / x);
  scope.acoth = (x: number) => Math.atanh(1 / x);

  // Multi-arg functions from Calculator.MultiFunctionIndex
  scope.sumsq = (...args: unknown[]) => {
    const vals = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return (vals as number[]).reduce((acc, x) => acc + x * x, 0);
  };
  scope.srss = (...args: unknown[]) => Math.sqrt(scope.sumsq(...args) as number);
  scope.average = (...args: unknown[]) => {
    const vals = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const arr = vals as number[];
    return arr.reduce((a, x) => a + x, 0) / arr.length;
  };
  scope.mean = scope.average;
  scope.product = (...args: unknown[]) => {
    const vals = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return (vals as number[]).reduce((a, x) => a * x, 1);
  };
  scope.and = (...args: unknown[]) => (args as number[]).every(x => !!x) ? 1 : 0;
  scope.or = (...args: unknown[]) => (args as number[]).some(x => !!x) ? 1 : 0;
  scope.xor = (...args: unknown[]) =>
    (args as number[]).reduce((acc, x) => (acc ? !x : !!x) ? 1 : 0, 0);
  scope.switch = (...args: unknown[]) => {
    // switch(cond1; val1; cond2; val2; ...; default)
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (args[i]) return args[i + 1];
    }
    return args.length % 2 === 1 ? args[args.length - 1] : 0;
  };
  scope.gcd = (...args: unknown[]) => {
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
    const vals = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args) as number[];
    return vals.reduce((a, b) => g(Math.abs(a), Math.abs(b)));
  };
  scope.lcm = (...args: unknown[]) => {
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
    const vals = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args) as number[];
    return vals.reduce((a, b) => (a * b) / g(a, b));
  };
  scope.atan2 = Math.atan2;
  scope.mod = (a: number, b: number) => a - Math.floor(a / b) * b;
  scope.root = (x: number, n: number) => Math.pow(x, 1 / n);

  // Interpolation functions (take/line/spline) — stub: linear-only fallback.
  // Users passing data tables get reasonable behavior; pure spline would
  // need a natural-spline solver.
  scope.take = (i: number, ...args: unknown[]) => args[Math.floor(i) - 1];
  scope.line = (x: number, ...args: unknown[]) => {
    // line(x; x0; y0; x1; y1; ...) — piecewise linear through points.
    // Expect interleaved: xs, ys flattened
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < args.length; i += 2) pts.push([args[i] as number, args[i + 1] as number]);
    pts.sort((a, b) => a[0] - b[0]);
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (x >= pts[i][0] && x <= pts[i + 1][0]) {
        const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
      }
    }
    return 0;
  };
  scope.spline = scope.line; // fallback: treat spline as piecewise linear

  // Beta, erf — approximations sufficient for most engineering use
  scope.gamma = (x: number) => {
    // Stirling-like Lanczos approximation
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
               771.32342877765313, -176.61502916214059, 12.507343278686905,
               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * scope.gamma(1 - x));
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
  };
  scope.gammaln = (x: number) => Math.log(Math.abs(scope.gamma(x)));
  scope.beta = (a: number, b: number) =>
    (scope.gamma(a) * scope.gamma(b)) / scope.gamma(a + b);
  scope.erf = (x: number) => {
    // Abramowitz & Stegun 7.1.26
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  };
  scope.erfc = (x: number) => 1 - scope.erf(x);

  // === Symbolic functions (nerdamer) ===
  // Available in any expression — same names as Calcpad-Symbolic desktop
  installSymbolic(scope);
}

/**
 * Evaluate a single symbolic expression. Recognizes common forms:
 *   diff(expr; x)             → derivative
 *   diff(expr; x; 2)          → second derivative
 *   pdiff(expr; x)            → partial derivative
 *   integrate(expr; x)        → indefinite integral
 *   integrate(expr; x; a; b)  → definite integral
 *   simplify(expr)            → simplification
 *   expand(expr)              → expansion
 *   factor(expr)              → factorization
 *   solve(expr; x)            → solve = 0
 *   subs(expr; x; v)          → substitute
 *   <bare expression>         → simplify
 */
function evalSymExpression(line: string): string {
  // Match function-call form
  const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/);
  if (m) {
    const fname = m[1];
    const args = splitTopLevel(m[2], ';').map(s => s.trim());
    switch (fname) {
      case 'diff':
        if (args.length === 3 && /^\d+$/.test(args[2])) {
          // diff(expr; x; n) — n-th derivative
          let r = args[0];
          for (let k = 0; k < parseInt(args[2]); k++) r = symDiff(r, args[1]);
          return r;
        }
        return symDiff(args[0], args[1]);
      case 'pdiff':
      case 'partial':
        return symDiff(args[0], args[1]);
      case 'integrate':
      case 'int':
        if (args.length >= 4) return symIntegrate(args[0], args[1], args[2], args[3]);
        return symIntegrate(args[0], args[1]);
      case 'simplify':
        return symSimplify(args[0]);
      case 'expand':
        return symExpand(args[0]);
      case 'factor':
        return symFactor(args[0]);
      case 'solve':
        return symSolve(args[0], args[1]);
      case 'subs':
        return symSubs(args[0], args[1], args[2]);
      case 'tex':
      case 'latex':
        return symToLatex(args[0]);
    }
  }
  // Default: simplify
  return symSimplify(line);
}

/** Parse and evaluate a Calcpad script. */
export function evalCalcpad(source: string): ParseResult {
  const blocks: OutputBlock[] = [];
  const errors: { line: number; message: string }[] = [];
  const scope: Record<string, unknown> = {};
  const functions: UserFunction[] = [];
  installFemFunctions(scope);

  // Pre-scan the source for user-defined variable names that collide with
  // math.js reserved unit names (h, A, E, m, ...). translateExpr reads
  // USER_DEFINED_NAMES through escapeReserved to decide which occurrences
  // to rename. Set this BEFORE any translateExpr call.
  USER_DEFINED_NAMES = collectUserNames(source);

  /** Helper: whenever we store a value in scope under a reserved name,
   *  also store it under the renamed alias so translated expressions
   *  (which use `__cp_h` etc.) can find it. */
  const setScope = (name: string, value: unknown) => {
    scope[name] = value;
    if (RESERVED_RENAMED.has(name)) {
      scope['__cp_' + name] = value;
    }
  };

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let hidden = false;

  // --- First pass: find loops and group them ---
  // We process line by line. When we hit #for, we collect the body until #loop.
  const processLines = (linesSubset: string[], offset: number) => {
    let i = 0;
    while (i < linesSubset.length) {
      const rawLine = linesSubset[i];
      const lineNum = offset + i + 1;
      const line = rawLine.trim();

      if (line === '') {
        i++;
        continue;
      }

      // #hide / #show
      if (line === '#hide') { hidden = true; i++; continue; }
      if (line === '#show') { hidden = false; i++; continue; }

      // Comment line (starts with ')
      if (line.startsWith("'")) {
        if (!hidden) {
          const txt = line.substring(1);
          // Check for HTML-like <b> tags
          blocks.push({ kind: 'comment', text: txt });
        }
        i++;
        continue;
      }

      // Heading ("Title)
      if (line.startsWith('"')) {
        if (!hidden) blocks.push({ kind: 'heading', text: line.substring(1) });
        i++;
        continue;
      }

      // Silently skip unsupported directives that don't open a block
      // (#noc, #equ, #nopreview, #post, #read, #pre, #pause, #input, #write,
      //  #format, #round, #compl, #lang, #include, etc.)
      // Also skip block-style directives whose end markers we ignore.
      if (line.startsWith('#')) {
        const directive = line.split(/\s/)[0];
        const SKIP_INLINE = new Set([
          '#noc', '#equ', '#nopreview', '#post', '#pre', '#read', '#write',
          '#format', '#round', '#compl', '#lang', '#include', '#pause', '#input',
          '#hide', '#show', '#deg', '#rad', '#gra', '#breakif', '#continueif',
          '#repeat', '#until', '#while', '#wend', '#return', '#exit',
          '#md', '#html', '#text',
        ]);
        if (SKIP_INLINE.has(directive)) {
          // #hide/#show already handled above; others just skip
          if (directive !== '#hide' && directive !== '#show') {
            i++;
            continue;
          }
        }
      }

      // Function definition: f(x; y) = expr
      // Only at top-level statements (not inside indexing).
      const funcDefMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)=]*)\)\s*=\s*(.+)$/);
      if (funcDefMatch && !funcDefMatch[2].includes('.')) {
        // Make sure left side is not an indexed assignment like A.(i;j)
        const fname = funcDefMatch[1];
        const params = funcDefMatch[2].split(';').map(p => p.trim()).filter(Boolean);
        const body = funcDefMatch[3];
        try {
          // Translate the body so it uses commas internally
          const translatedBody = translateExpr(body);
          // Create a JavaScript function that evaluates the body with params bound
          const fn = (...args: unknown[]) => {
            const localScope: Record<string, unknown> = { ...scope };
            params.forEach((p, idx) => { localScope[p] = args[idx]; });
            return math.evaluate(translatedBody, localScope);
          };
          scope[fname] = fn;
          if (!hidden) {
            blocks.push({ kind: 'comment', text: `<i>${fname}(${params.join(', ')}) = ${body}</i>` });
          }
        } catch (err) {
          errors.push({ line: lineNum, message: `function def: ${(err as Error).message}` });
        }
        i++;
        continue;
      }

      // Multi-line function definition:
      //   #function name(p1; p2; ...) ... #end function
      // The body is executed with a local scope containing the parameters.
      // The returned value is whatever variable matches the function name
      // (Calcpad-Symbolic convention), or the variable `result` if the
      // user never assigns to the function name.
      const funcBlockMatch = line.match(/^#function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/);
      if (funcBlockMatch) {
        const fname = funcBlockMatch[1];
        const params = funcBlockMatch[2].split(';').map(p => p.trim()).filter(Boolean);
        // Scan for matching #end function (allow nesting)
        let depth = 1;
        let j = i + 1;
        while (j < linesSubset.length && depth > 0) {
          const l = linesSubset[j].trim();
          if (l.startsWith('#function ')) depth++;
          else if (l === '#end function') { depth--; if (depth === 0) break; }
          j++;
        }
        if (depth !== 0) {
          errors.push({ line: lineNum, message: '#function without matching #end function' });
          i++;
          continue;
        }
        const body = linesSubset.slice(i + 1, j);
        const bodyOffset = offset + i + 1;

        // Create the closure. On each call: copy the current outer scope,
        // overlay the parameters, run the body lines, then read back the
        // function name (or "result") as the return value.
        const fn = (...args: unknown[]): unknown => {
          const savedEntries: [string, unknown][] = [];
          // Save any globals we are about to shadow, including the function name itself
          const keysToShadow = [...params, fname, 'result'];
          for (const k of keysToShadow) {
            if (Object.prototype.hasOwnProperty.call(scope, k)) {
              savedEntries.push([k, scope[k]]);
            }
          }
          // Bind parameters
          params.forEach((p, idx) => { scope[p] = args[idx]; });
          // Clear any prior value of the return sentinel
          delete scope[fname];
          delete scope.result;
          try {
            processLines(body, bodyOffset);
          } finally {
            // Restore shadowed globals
            for (const k of keysToShadow) delete scope[k];
            for (const [k, v] of savedEntries) scope[k] = v;
          }
          // Read return value (checked while still in scope)
          // Since we just deleted them above, the callee must assign BEFORE
          // the finally block — so we capture the return value BEFORE restoring.
          return undefined;
        };

        // The above implementation has a subtle bug: the return value is read
        // after restoration. Use a better pattern — capture before restore.
        const fn2 = (...args: unknown[]): unknown => {
          const savedEntries: [string, unknown, boolean][] = [];
          const keysToShadow = [...params, fname, 'result'];
          for (const k of keysToShadow) {
            const has = Object.prototype.hasOwnProperty.call(scope, k);
            savedEntries.push([k, scope[k], has]);
          }
          params.forEach((p, idx) => { scope[p] = args[idx]; });
          delete scope[fname];
          delete scope.result;
          let retVal: unknown = undefined;
          try {
            processLines(body, bodyOffset);
            retVal = scope[fname] !== undefined ? scope[fname] : scope.result;
          } finally {
            for (const [k, v, has] of savedEntries) {
              if (has) scope[k] = v;
              else delete scope[k];
            }
          }
          return retVal;
        };
        void fn;

        scope[fname] = fn2;
        // Register in the user-function list for the UI
        functions.push({
          name: fname,
          params: params.slice(),
          line: lineNum,
          body: body.slice(),
        });
        if (!hidden) {
          blocks.push({
            kind: 'comment',
            text: `<i>#function <b>${fname}</b>(${params.join('; ')})</i>`,
          });
        }
        i = j + 1;
        continue;
      }

      // Loop: #for var = start : end
      const forMatch = line.match(/^#for\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*:\s*(.+)$/);
      if (forMatch) {
        const [, varName, startExpr, endExpr] = forMatch;
        // Find matching #loop
        let depth = 1;
        let j = i + 1;
        while (j < linesSubset.length && depth > 0) {
          const l = linesSubset[j].trim();
          if (l.startsWith('#for ')) depth++;
          else if (l === '#loop') depth--;
          if (depth === 0) break;
          j++;
        }
        if (depth !== 0) {
          errors.push({ line: lineNum, message: '#for without matching #loop' });
          i++;
          continue;
        }
        const body = linesSubset.slice(i + 1, j);
        try {
          const startV = Number(math.evaluate(translateExpr(startExpr), scope));
          const endV = Number(math.evaluate(translateExpr(endExpr), scope));
          const step = startV <= endV ? 1 : -1;
          for (let v = startV; step > 0 ? v <= endV : v >= endV; v += step) {
            scope[varName] = v;
            processLines(body, offset + i + 1);
          }
        } catch (err) {
          errors.push({ line: lineNum, message: `#for error: ${(err as Error).message}` });
        }
        i = j + 1;
        continue;
      }

      // #if condition ... #else ... #end if
      const ifMatch = line.match(/^#if\s+(.+)$/);
      if (ifMatch) {
        const condExpr = ifMatch[1];
        let depth = 1;
        let j = i + 1;
        let elseIdx = -1;
        while (j < linesSubset.length && depth > 0) {
          const l = linesSubset[j].trim();
          if (l.startsWith('#if ')) depth++;
          else if (l === '#end if') { depth--; if (depth === 0) break; }
          else if (l === '#else' && depth === 1) elseIdx = j;
          j++;
        }
        if (depth !== 0) {
          errors.push({ line: lineNum, message: '#if without matching #end if' });
          i++;
          continue;
        }
        try {
          const cond = math.evaluate(translateExpr(condExpr), scope);
          const isTrue = typeof cond === 'number' ? cond !== 0 : Boolean(cond);
          if (isTrue) {
            const thenBody = linesSubset.slice(i + 1, elseIdx >= 0 ? elseIdx : j);
            processLines(thenBody, offset + i + 1);
          } else if (elseIdx >= 0) {
            const elseBody = linesSubset.slice(elseIdx + 1, j);
            processLines(elseBody, offset + elseIdx + 1);
          }
        } catch (err) {
          errors.push({ line: lineNum, message: `#if error: ${(err as Error).message}` });
        }
        i = j + 1;
        continue;
      }

      // #python block: #python ... #end python  (Pyodide + SymPy, async)
      // Captures the body and emits a placeholder block. main.ts picks up
      // the placeholder and replaces it once the async CAS engine finishes.
      if (line === '#python' || line.startsWith('#python ')) {
        // Block form: #python\n...\n#end python
        if (line === '#python') {
          let j = i + 1;
          while (j < linesSubset.length && linesSubset[j].trim() !== '#end python') j++;
          if (j >= linesSubset.length) {
            errors.push({ line: lineNum, message: '#python without matching #end python' });
            i++;
            continue;
          }
          const body = linesSubset.slice(i + 1, j).join('\n');
          blocks.push({ kind: 'sym', expr: body, result: '<i style="color:#64748b">⏳ SymPy cargando…</i>', latex: body });
          // Main.ts will discover this block via its engine attribute
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).engine = 'sympy';
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).async = true;
          i = j + 1;
          continue;
        } else {
          // Inline form: #python <expr>
          const expr = line.substring('#python '.length).trim();
          blocks.push({ kind: 'sym', expr, result: '<i style="color:#64748b">⏳ SymPy cargando…</i>', latex: expr });
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).engine = 'sympy';
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).async = true;
          i++;
          continue;
        }
      }

      // #maxima block: #maxima ... #end maxima  (Maxima-on-WASM iframe, async)
      if (line === '#maxima' || line.startsWith('#maxima ')) {
        if (line === '#maxima') {
          let j = i + 1;
          while (j < linesSubset.length && linesSubset[j].trim() !== '#end maxima') j++;
          if (j >= linesSubset.length) {
            errors.push({ line: lineNum, message: '#maxima without matching #end maxima' });
            i++;
            continue;
          }
          const body = linesSubset.slice(i + 1, j).join('\n');
          blocks.push({ kind: 'sym', expr: body, result: '<i style="color:#64748b">⏳ Maxima cargando…</i>', latex: body });
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).engine = 'maxima';
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).async = true;
          i = j + 1;
          continue;
        } else {
          const expr = line.substring('#maxima '.length).trim();
          blocks.push({ kind: 'sym', expr, result: '<i style="color:#64748b">⏳ Maxima cargando…</i>', latex: expr });
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).engine = 'maxima';
          (blocks[blocks.length - 1] as unknown as { engine?: string; async?: boolean }).async = true;
          i++;
          continue;
        }
      }

      // #sym block: #sym ... #end sym
      // Each non-empty, non-comment line inside is treated as a symbolic expression
      // (or assignment, optionally) and rendered with its result.
      if (line === '#sym') {
        let j = i + 1;
        while (j < linesSubset.length && linesSubset[j].trim() !== '#end sym') j++;
        if (j >= linesSubset.length) {
          errors.push({ line: lineNum, message: '#sym without matching #end sym' });
          i++;
          continue;
        }
        const body = linesSubset.slice(i + 1, j);
        for (const sl of body) {
          const symLine = sl.trim();
          if (!symLine || symLine.startsWith("'")) continue;
          try {
            const result = evalSymExpression(symLine);
            blocks.push({ kind: 'sym', expr: symLine, result, latex: result });
          } catch (err) {
            errors.push({ line: lineNum, message: `#sym: ${(err as Error).message}` });
          }
        }
        i = j + 1;
        continue;
      }

      // #sym inline: #sym <expr>
      const symInlineMatch = line.match(/^#sym\s+(.+)$/);
      if (symInlineMatch) {
        const symExpr = symInlineMatch[1];
        try {
          const result = evalSymExpression(symExpr);
          blocks.push({ kind: 'sym', expr: symExpr, result, latex: result });
        } catch (err) {
          errors.push({ line: lineNum, message: `#sym: ${(err as Error).message}` });
        }
        i++;
        continue;
      }

      // #deq: display equation only (no eval)
      const deqMatch = line.match(/^#deq\s+(.+)$/);
      if (deqMatch) {
        blocks.push({ kind: 'sym', expr: deqMatch[1], result: deqMatch[1], latex: deqMatch[1] });
        i++;
        continue;
      }

      // Skip unsupported $-directives ($Plot, $Map, $Chart, $Mesh, $Find, $Root,
      // $Integral, $Slope, $Sum, $Product, $Table, $Draw, $PlotMap, $Struct, etc.)
      // We render a placeholder comment so the user knows what was skipped.
      if (line.startsWith('$') && !line.startsWith('$Fem3D{')) {
        const dirMatch = line.match(/^\$([A-Za-z_][A-Za-z0-9_]*)/);
        if (dirMatch && !hidden) {
          blocks.push({ kind: 'comment', text: `<i style="opacity:0.6">[$${dirMatch[1]} — directiva visual no implementada en la web]</i>` });
        }
        // Skip until matching }
        if (line.includes('{') && !line.endsWith('}')) {
          // Multi-line $: scan until balanced }
          let depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          let j = i + 1;
          while (j < linesSubset.length && depth > 0) {
            const l = linesSubset[j];
            depth += (l.match(/\{/g) || []).length;
            depth -= (l.match(/\}/g) || []).length;
            if (depth <= 0) break;
            j++;
          }
          i = j + 1;
          continue;
        }
        i++;
        continue;
      }

      // Special $Fem3D directive
      if (line.startsWith('$Fem3D{')) {
        try {
          const inner = line.substring(7, line.length - 1);
          // Split by " @ " (options) then by ";"
          const atIdx = inner.indexOf(' @ ');
          const args = (atIdx >= 0 ? inner.substring(0, atIdx) : inner).split(';').map(s => s.trim());
          if (args.length >= 4) {
            const Xn = math.evaluate(translateExpr(args[0]), scope) as number[];
            const Yn = math.evaluate(translateExpr(args[1]), scope) as number[];
            const Zn = math.evaluate(translateExpr(args[2]), scope) as number[];
            const elems = math.evaluate(translateExpr(args[3]), scope) as number[][];
            const values = args.length >= 5
              ? math.evaluate(translateExpr(args[4]), scope) as number[]
              : new Array(Xn.length).fill(0);
            // Build nodes Nx3 from Xn,Yn,Zn
            const nodes: number[][] = Xn.map((x, k) => [x, Yn[k], Zn[k]]);
            // Convert 1-based element ids to 0-based
            const elems0 = elems.map(row => row.map(x => (x as number) - 1));
            blocks.push({ kind: 'fem3d', nodes, elements: elems0, values });
          }
        } catch (err) {
          errors.push({ line: lineNum, message: `$Fem3D error: ${(err as Error).message}` });
        }
        i++;
        continue;
      }

      // Multiple statements on one line: split by "',"'" pattern
      // In Calcpad, separator is: ','  (literal comma-apostrophe-apostrophe)
      // For simplicity we accept "'," as separator (and also `';` for legacy).
      const statements = line.split(/','/);
      for (const stmt of statements) {
        const s = stmt.trim();
        if (s === '') continue;

        // Assignment: name = expr
        const assignMatch = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        if (assignMatch) {
          const [, name, exprRaw] = assignMatch;
          try {
            const translated = translateExpr(exprRaw);
            const value = math.evaluate(translated, scope);
            setScope(name, value);       // also aliases __cp_<name> if reserved
            if (!hidden) {
              blocks.push({ kind: 'assignment', name, expr: exprRaw, text: formatValue(value), value });
            }
          } catch (err) {
            errors.push({ line: lineNum, message: `${(err as Error).message} in "${s}"` });
            blocks.push({ kind: 'error', line: lineNum, message: (err as Error).message });
          }
          continue;
        }

        // Cell-array assignment: name{i} = expr  →  __cellSet(name, i, expr)
        const cellAssign = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\{([^{}]+)\}\s*=\s*(.+)$/);
        if (cellAssign) {
          const [, name, idxExpr, rhs] = cellAssign;
          try {
            const translatedIdx = translateExpr(idxExpr);
            const translatedRhs = translateExpr(rhs);
            math.evaluate(`__cellSet(${name}, ${translatedIdx}, ${translatedRhs})`, scope);
          } catch (err) {
            errors.push({ line: lineNum, message: `${(err as Error).message} in "${s}"` });
            blocks.push({ kind: 'error', line: lineNum, message: (err as Error).message });
          }
          continue;
        }

        // Indexed assignment: name.(i;j) = expr
        const idxAssign = s.match(/^([A-Za-z_][A-Za-z0-9_]*\s*\.\([^)]+\))\s*=\s*(.+)$/);
        if (idxAssign) {
          const lhs = idxAssign[1];
          const rhs = idxAssign[2];
          try {
            // Replace lhs in translateExpr to get subscript access; use math.js subset syntax.
            // Calcpad: A.(i;j) = v  →  A[i,j] = v  →  need `A = subset(A, index(i,j), v)`
            const translated = translateExpr(`${lhs} = ${rhs}`);
            math.evaluate(translated, scope);
          } catch (err) {
            errors.push({ line: lineNum, message: `${(err as Error).message} in "${s}"` });
            blocks.push({ kind: 'error', line: lineNum, message: (err as Error).message });
          }
          continue;
        }

        // Bare expression: print its value
        try {
          const translated = translateExpr(s);
          const value = math.evaluate(translated, scope);
          if (value !== undefined && !hidden) {
            blocks.push({ kind: 'value', name: s, text: formatValue(value), value });
          }
        } catch (err) {
          errors.push({ line: lineNum, message: `${(err as Error).message} in "${s}"` });
          blocks.push({ kind: 'error', line: lineNum, message: (err as Error).message });
        }
      }
      i++;
    }
  };

  processLines(lines, 0);

  return { blocks, errors, scope, functions };
}
