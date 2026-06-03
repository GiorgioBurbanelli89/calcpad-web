/* cpd-translate.js — Traductor source-to-source entre los 3 dialectos Calcpad.
 *   dialectos: 'calcpad' (puro), 'symbolic', 'lab' (MATLAB .m)
 *
 * Arquitectura IR central: parse(src, from) -> IR (lista de nodos) -> emit(IR, to).
 * El "canonico" de la IR es Calcpad PURO (puro y symbolic comparten casi toda la
 * sintaxis), asi que parsear/emitir puro es casi identidad y el trabajo real esta
 * en lab<->canonico y symbolic-extras<->canonico.
 *
 * Expone window.translateDialect(src, from, to).
 *
 * Nodos IR:
 *   {t:'comment', kind:'plain'|'heading'|'hidden', text}
 *   {t:'assign', name, expr, suppress}      // suppress = no mostrar el resultado
 *   {t:'display', expr}                     // expresion sola (se muestra su valor)
 *   {t:'for', v, lo, hi, body:[...], suppress}
 *   {t:'funcdef', name, params:[...], outs:[...], body:[...]|null, expr:string|null}
 *   {t:'raw', text}                         // linea no reconocida -> passthrough
 *   {t:'blank'}
 * El estado "oculto" (#hide/#show en calcpad ; ';' en lab) se modela con suppress
 * en cada nodo afectado.
 */
(function () {
  'use strict';

  // ================= helpers de expresion (canonico = Calcpad puro) =================

  // split por 'sep' fuera de parentesis/corchetes/llaves
  function splitTop(s, sep) {
    const out = []; let d = 0, last = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') d--;
      else if (c === sep && d === 0) { out.push(s.slice(last, i)); last = i + 1; }
    }
    out.push(s.slice(last));
    return out;
  }

  // split por comas de nivel superior (respeta parentesis/corchetes/llaves)
  function splitTopComma(s) {
    const parts = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim() !== '') parts.push(cur);
    return parts.map(x => x.trim());
  }

  // inversa de la libreria calcpad_lab_lib.m: cpSlope/cpArea/cpPlot/cpMap(...) -> $-constructs
  function cpCallsToConstructs(s) {
    const fns = ['cpSlope', 'cpArea', 'cpPlot', 'cpMap'];
    for (const fn of fns) {
      let idx;
      while ((idx = s.indexOf(fn + '(')) >= 0) {
        let depth = 0, end = -1;                          // hallar el ) que cierra
        for (let k = idx + fn.length; k < s.length; k++) {
          if (s[k] === '(') depth++;
          else if (s[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
        }
        if (end < 0) break;
        const args = splitTopComma(s.slice(idx + fn.length + 1, end));
        const m0 = (args[0] || '').match(/^@\(([^)]*)\)\s*([\s\S]+)$/);   // @(vars) EXPR
        if (!m0) break;
        const v = m0[1].split(',').map(x => x.trim()), e = m0[2].trim();
        let repl;
        if (fn === 'cpSlope') repl = '$Slope{' + e + ' @ ' + v[0] + ' = ' + args[1] + '}';
        else if (fn === 'cpArea') repl = '$Area{' + e + ' @ ' + v[0] + ' = ' + args[1] + ' : ' + args[2] + '}';
        else if (fn === 'cpPlot') repl = '$Plot{' + e + ' @ ' + v[0] + ' = ' + args[1] + ' : ' + args[2] + '}';
        else repl = '$Map{' + e + ' @ ' + v[0] + ' = ' + args[1] + ' : ' + args[2] + ' & ' + v[1] + ' = ' + args[3] + ' : ' + args[4] + '}';
        s = s.slice(0, idx) + repl + s.slice(end + 1);
      }
    }
    return s;
  }

  // Lab -> canonico: cp* -> $-constructs, indexacion de arrays X(i,j) -> X.(i;j).
  // `arrays` es un Set de nombres conocidos como array (no funciones).
  function exprLabToCanon(s, arrays) {
    let out = cpCallsToConstructs(s);   // inversa de las funciones cp* primero
    // X(args) -> X.(args) solo si X es array conocido
    out = out.replace(/([A-Za-z_À-ɏ][\wÀ-ɏ]*)\s*\(([^()]*)\)/g, function (m, name, args) {
      const a = args.split(',').map(x => x.trim()).join('; ');
      if (arrays && arrays.has(name)) return name + '.(' + a + ')';
      return name + '(' + a + ')';
    });
    // operador potencia: MATLAB '.^' y '^' -> Calcpad '^'
    out = out.replace(/\.\^/g, '^').replace(/\.\*/g, '*').replace(/\.\//g, '/');
    return out;
  }

  // split por separador en nivel superior (respeta ()/[]/{} anidados)
  function splitTopSep(s, sep) {
    const parts = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === sep && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts.map(x => x.trim());
  }
  function topLevelChar(s, c) {            // indice del char c en nivel 0
    let depth = 0;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === c && depth === 0) return k;
    }
    return -1;
  }

  // canonico -> cp*: $Slope/$Area/$Plot/$Map -> cpSlope/cpArea/cpPlot/cpMap.
  // Maneja ANIDAMIENTO (ej. integral doble $Area{$Area{...}}) procesando el mas interno primero.
  function constructsToCp(s) {
    const names = ['Slope', 'Area', 'Plot', 'Map'];
    let guard = 0, again = true;
    while (again && guard++ < 60) {
      again = false;
      for (const name of names) {
        const mark = '$' + name + '{';
        let idx = s.indexOf(mark);
        while (idx >= 0) {
          let depth = 0, end = -1;                       // hallar la } balanceada
          for (let k = idx + mark.length - 1; k < s.length; k++) {
            if (s[k] === '{') depth++;
            else if (s[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
          }
          if (end < 0) break;
          const inside = s.slice(idx + mark.length, end);
          if (inside.indexOf('$') >= 0) { idx = s.indexOf(mark, idx + 1); continue; }   // mas interno primero
          const at = topLevelChar(inside, '@');          // @ separador (no el de @(x))
          if (at < 0) { idx = s.indexOf(mark, idx + 1); continue; }
          const expr = inside.slice(0, at).trim();
          const dims = splitTopSep(inside.slice(at + 1), '&').map(seg => {
            const eq = seg.indexOf('='); const v = seg.slice(0, eq).trim();
            const rng = splitTopSep(seg.slice(eq + 1), ':');
            return { v: v, lo: rng[0], hi: rng[1] };
          });
          let repl;
          if (name === 'Slope') repl = 'cpSlope(@(' + dims[0].v + ') ' + expr + ', ' + dims[0].lo + ')';
          else if (name === 'Area') repl = 'cpArea(@(' + dims[0].v + ') ' + expr + ', ' + dims[0].lo + ', ' + dims[0].hi + ')';
          else if (name === 'Plot') repl = 'cpPlot(@(' + dims[0].v + ') ' + expr + ', ' + dims[0].lo + ', ' + dims[0].hi + ')';
          else repl = 'cpMap(@(' + dims[0].v + ',' + dims[1].v + ') ' + expr + ', ' + dims[0].lo + ', ' + dims[0].hi + ', ' + dims[1].lo + ', ' + dims[1].hi + ')';
          s = s.slice(0, idx) + repl + s.slice(end + 1);
          again = true; idx = s.indexOf(mark);
        }
      }
    }
    return s;
  }

  // canonico -> Lab: $-constructs -> cp*, indexacion X.(i;j) -> X(i,j), separador ';' -> ','
  function exprCanonToLab(s) {
    let out = constructsToCp(s);
    // indexacion X.(args) -> X(args) con ',' en vez de ';'
    out = out.replace(/([A-Za-z_À-ɏ][\wÀ-ɏ]*)\.\(([^()]*)\)/g, function (m, name, args) {
      return name + '(' + args.split(';').map(x => x.trim()).join(', ') + ')';
    });
    // llamadas a funcion f(a; b) -> f(a, b) (separador de args MATLAB); deja matrices [a;b] intactas
    out = out.replace(/([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*)\(([^()\[\]]*;[^()\[\]]*)\)/g, function (m, name, args) {
      return name + '(' + args.split(';').map(x => x.trim()).join(', ') + ')';
    });
    // funciones Calcpad con OTRO nombre en MATLAB (orden importa: log antes que ln)
    out = out.replace(/\blog\s*\(/g, 'log10(');   // Calcpad log = log base 10
    out = out.replace(/\bln\s*\(/g, 'log(');       // Calcpad ln  = log natural
    out = out.replace(/\bsqr\s*\(/g, 'sqrt(');     // Calcpad sqr = raiz cuadrada
    return out;
  }

  // ================= PARSERS (dialecto -> IR) =================

  // detecta comentario/heading en calcpad/symbolic: linea que ARRANCA en modo texto
  function parseCalcpadComment(line) {
    const t = line.trim();
    if (t[0] === '"') return { t: 'comment', kind: 'heading', text: t.slice(1).replace(/"$/, '') };
    if (t[0] === "'") return { t: 'comment', kind: 'plain', text: t.slice(1).replace(/'$/, '') };
    return null;
  }

  function parseCalcpad(src, isSymbolic) {
    const lines = src.split(/\r?\n/);
    let hidden = false;                         // estado #hide/#show
    let noc = false;                            // estado #noc/#equ (display simbolico = ocultar el resultado)
    const root = [];
    const stack = [root];                       // para anidar #for
    const push = (node) => stack[stack.length - 1].push(node);
    const sup = () => hidden || noc;            // suprimir salida (en Lab -> ';', en Calcpad -> #hide/#noc)

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (line === '') { push({ t: 'blank' }); continue; }
      if (/^#hide\b/i.test(line)) { hidden = true; continue; }
      if (/^#show\b/i.test(line)) { hidden = false; continue; }
      // #noc/#equ: en Calcpad muestra la formula sin resultado; en MATLAB no existe -> ';' (suprimir)
      if (/^#noc\b/i.test(line)) { noc = true; continue; }
      if (/^#equ\b/i.test(line)) { noc = false; continue; }
      // #for v = lo : hi
      let mFor = line.match(/^#for\s+([^=]+?)\s*=\s*(.+?)\s*:\s*(.+)$/i);
      if (mFor) {
        const node = { t: 'for', v: mFor[1].trim(), lo: mFor[2].trim(), hi: mFor[3].trim(), body: [], suppress: sup() };
        push(node); stack.push(node.body); continue;
      }
      if (/^#loop\b/i.test(line)) { if (stack.length > 1) stack.pop(); continue; }
      // comentario / heading
      const cm = parseCalcpadComment(line);
      if (cm) { if (sup()) cm.kind = 'hidden'; push(cm); continue; }
      // otras directivas que no traducimos aun -> raw
      if (line[0] === '#') { push({ t: 'raw', text: line }); continue; }
      // funcion inline:  f(x; y) = expr
      const mFun = line.match(/^([A-Za-z_À-ɏ][\wÀ-ɏ]*)\s*\(([^)=]*)\)\s*=\s*(.+)$/);
      if (mFun && mFun[2].indexOf('.') < 0) {
        push({ t: 'funcdef', name: mFun[1], params: splitTop(mFun[2], ';').map(s => s.trim()).filter(Boolean), outs: [], body: null, expr: mFun[3].trim(), suppress: sup() });
        continue;
      }
      // asignacion:  name = expr   (incluye indexada X.(i)=...)
      const mAsg = line.match(/^([A-Za-z_À-ɏ][\wÀ-ɏ]*(?:\.\([^)]*\)|\.\w+)?)\s*=\s*(.+)$/);
      if (mAsg) { push({ t: 'assign', name: mAsg[1].trim(), expr: mAsg[2].trim(), suppress: sup() }); continue; }
      // expresion sola -> display
      push({ t: 'display', expr: line, suppress: sup() });
    }
    return root;
  }

  function parseLab(src) {
    const lines = src.split(/\r?\n/);
    const root = [];
    const stack = [root];
    const owners = [null];                        // nodo dueno de cada nivel (para inferir suppress del #for)
    const push = (node) => stack[stack.length - 1].push(node);
    const popLevel = () => {                       // cerrar un for/function (MATLAB 'end')
      if (stack.length <= 1) return;
      stack.pop(); const owner = owners.pop();
      // loop silencioso: si TODO su cuerpo (assign/display) es suppress -> el loop va oculto
      if (owner && owner.t === 'for') {
        const stmts = owner.body.filter(b => b.t === 'assign' || b.t === 'display');
        owner.suppress = stmts.length > 0 && stmts.every(b => b.suppress);
      }
    };
    const arrays = new Set();                    // nombres declarados como array (heuristica)

    // pre-escaneo: nombres asignados con indexacion X(i)=... o X(i,j)=... -> arrays
    for (const l of lines) {
      const m = l.trim().match(/^([A-Za-z_À-ɏ][\wÀ-ɏ]*)\s*\([^)]*\)\s*=/);
      if (m && !/^(if|for|while|function|end|switch)$/.test(m[1])) {
        // si el LHS tiene parentesis y NO es palabra clave, es indexacion de array
        arrays.add(m[1]);
      }
      // X = zeros(...) / ones(...) / [..] -> array
      const m2 = l.trim().match(/^([A-Za-z_À-ɏ][\wÀ-ɏ]*)\s*=\s*(zeros|ones|linspace|\[)/);
      if (m2) arrays.add(m2[1]);
    }

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      // separar comentario '%' fuera de strings
      let code = rawLine, comment = '';
      { let inS = false, inD = false;
        for (let k = 0; k < rawLine.length; k++) {
          const ch = rawLine[k];
          if (ch === "'" && !inD) inS = !inS;
          else if (ch === '"' && !inS) inD = !inD;
          else if (ch === '%' && !inS && !inD) { code = rawLine.slice(0, k); comment = rawLine.slice(k); break; }
        }
      }
      const ct = code.trim();
      // comentario de linea completa
      if (ct === '' && comment) {
        if (comment.startsWith('%%')) push({ t: 'comment', kind: 'heading', text: comment.slice(2).trim() });
        else if (comment.startsWith('%--')) push({ t: 'comment', kind: 'hidden', text: comment.slice(3).trim() });
        else push({ t: 'comment', kind: 'plain', text: comment.slice(1).trim() });
        continue;
      }
      if (ct === '') { push({ t: 'blank' }); continue; }
      // for v = lo:hi   (MATLAB, sin #)
      const mFor = ct.match(/^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*:\s*(.+?)\s*$/);
      if (mFor) {
        const node = { t: 'for', v: mFor[1], lo: exprLabToCanon(mFor[2], arrays), hi: exprLabToCanon(mFor[3], arrays), body: [], suppress: false };
        push(node); stack.push(node.body); owners.push(node); continue;
      }
      if (/^end\b/.test(ct)) { popLevel(); continue; }
      // function [a,b]=f(x) ... end   /  function y=f(x)
      const mFun = ct.match(/^function\s+(?:\[([^\]]*)\]|([A-Za-z_]\w*))\s*=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/);
      if (mFun) {
        const outs = mFun[1] ? mFun[1].split(',').map(s => s.trim()) : (mFun[2] ? [mFun[2]] : []);
        const node = { t: 'funcdef', name: mFun[3], params: mFun[4].split(',').map(s => s.trim()).filter(Boolean), outs: outs, body: [], expr: null, suppress: false };
        push(node); stack.push(node.body); owners.push(node); continue;
      }
      // sentencias separadas por ';' (cada una con/ sin supresion)
      const endsSemi = ct.endsWith(';');
      const parts = splitTop(ct.replace(/;+\s*$/, ''), ';').map(s => s.trim()).filter(Boolean);
      parts.forEach((stmt, k) => {
        const suppress = (k < parts.length - 1) || endsSemi;
        // comentario inline solo en la ultima sentencia
        if (k === parts.length - 1 && comment) {
          // se agrega como comentario aparte despues
        }
        emitLabStmt(stmt, suppress, arrays, push);
      });
      // comentario inline -> comentario plain despues del codigo
      if (comment) {
        if (comment.startsWith('%%')) push({ t: 'comment', kind: 'heading', text: comment.slice(2).trim() });
        else if (comment.startsWith('%--')) push({ t: 'comment', kind: 'hidden', text: comment.slice(3).trim() });
        else push({ t: 'comment', kind: 'plain', text: comment.slice(1).trim() });
      }
    }
    return root;
  }

  function emitLabStmt(stmt, suppress, arrays, push) {
    // funcion anonima MATLAB: f = @(x, y) expr  ->  funcdef (en Calcpad: f(x; y) = expr)
    const mAnon = stmt.match(/^([A-Za-z_À-ɏ][\wÀ-ɏ]*)\s*=\s*@\(([^)]*)\)\s*([\s\S]+)$/);
    if (mAnon) {
      push({ t: 'funcdef', name: mAnon[1].trim(), params: mAnon[2].split(',').map(s => s.trim()).filter(Boolean), outs: [], body: null, expr: exprLabToCanon(mAnon[3].trim(), arrays), suppress: suppress });
      return;
    }
    // asignacion name = expr  (LHS puede ser indexado o [a,b])
    const mAsg = stmt.match(/^([A-Za-z_À-ɏ][\wÀ-ɏ]*(?:\([^)]*\))?|\[[^\]]*\])\s*=\s*(.+)$/);
    if (mAsg) {
      let name = mAsg[1].trim();
      // LHS indexado X(i,j) -> X.(i;j)
      name = exprLabToCanon(name, arrays);
      push({ t: 'assign', name: name, expr: exprLabToCanon(mAsg[2].trim(), arrays), suppress: suppress });
      return;
    }
    // fprintf/disp/tic/toc y demas -> raw (se preserva, no se traduce aun)
    push({ t: 'display', expr: exprLabToCanon(stmt, arrays), suppress: suppress });
  }

  // ================= EMITTERS (IR -> dialecto) =================

  function emitCalcpad(nodes, isSymbolic, indent) {
    indent = indent || '';
    const out = [];
    // agrupar nodos suppress consecutivos (incluido el #for) en un solo #hide ... #show
    const isHideable = (n) => n.suppress && n.t !== 'comment';     // assign/display/for ocultos
    let i = 0;
    while (i < nodes.length) {
      const n = nodes[i];
      if (isHideable(n)) {
        const blk = [];
        while (i < nodes.length && isHideable(nodes[i])) { blk.push(nodes[i]); i++; }
        out.push(indent + '#hide');
        for (const b of blk) out.push(emitCalcpadNode(b, isSymbolic, indent));
        out.push(indent + '#show');
        continue;
      }
      out.push(emitCalcpadNode(n, isSymbolic, indent));
      i++;
    }
    return out.join('\n');
  }

  // emite nodos SIN logica de #hide (para cuerpos de #for: la unidad de ocultar es el loop)
  function emitCalcpadPlain(nodes, isSymbolic, indent) {
    return nodes.map(n => n.t === 'blank' ? '' : emitCalcpadNode(n, isSymbolic, indent)).join('\n');
  }

  function emitCalcpadNode(n, isSymbolic, indent) {
    indent = indent || '';
    switch (n.t) {
      case 'blank': return '';
      case 'comment':
        if (n.kind === 'heading') return indent + '"' + n.text;
        if (n.kind === 'hidden') return indent + '#hide\n' + indent + "'" + n.text + '\n' + indent + '#show';
        return indent + "'" + n.text;
      case 'assign': return indent + n.name + ' = ' + n.expr;
      case 'display': return indent + n.expr;
      case 'funcdef':
        if (n.expr != null) return indent + n.name + '(' + n.params.join('; ') + ') = ' + n.expr;
        // bloque (venido de lab) -> #def ... #end def, retorno = ultimo out
        { const head = indent + '#def ' + n.name + '$(' + n.params.map(p => p + '$').join('; ') + ')';
          const body = emitCalcpad(n.body, isSymbolic, indent + '\t');
          const ret = (n.outs && n.outs[0]) ? '\n' + indent + '\t' + n.outs[0] : '';
          return head + '\n' + body + ret + '\n' + indent + '#end def'; }
      case 'for':
        return indent + '#for ' + n.v + ' = ' + n.lo + ' : ' + n.hi + '\n' +
               emitCalcpadPlain(n.body, isSymbolic, indent + '\t') + '\n' + indent + '#loop';
      case 'raw': return indent + n.text;
      default: return indent + (n.text || '');
    }
  }

  function emitLab(nodes, indent) {
    indent = indent || '';
    const out = [];
    for (const n of nodes) out.push(emitLabNode(n, indent));
    return out.join('\n');
  }

  function emitLabNode(n, indent) {
    indent = indent || '';
    const sc = (s, sup) => indent + s + (sup ? ';' : '');
    switch (n.t) {
      case 'blank': return '';
      case 'comment':
        if (n.kind === 'heading') return indent + '%% ' + n.text;
        if (n.kind === 'hidden') return indent + '%-- ' + n.text;
        return indent + '% ' + n.text;
      case 'assign': return sc(exprCanonToLab(n.name) + ' = ' + exprCanonToLab(n.expr), n.suppress);
      case 'display': return sc(exprCanonToLab(n.expr), n.suppress);
      case 'funcdef':
        // inline f(x) = expr -> funcion ANONIMA de MATLAB: f = @(x) expr  (NO f(x)=expr, que es array)
        if (n.expr != null) return indent + n.name + ' = @(' + n.params.join(', ') + ') ' + exprCanonToLab(n.expr) + (n.suppress ? ';' : '');
        { const outs = (n.outs && n.outs.length) ? (n.outs.length > 1 ? '[' + n.outs.join(', ') + ']' : n.outs[0]) + ' = ' : '';
          const head = indent + 'function ' + outs + n.name + '(' + n.params.join(', ') + ')';
          return head + '\n' + emitLab(n.body, indent) + '\n' + indent + 'end'; }
      case 'for':
        return indent + 'for ' + n.v + ' = ' + exprCanonToLab(n.lo) + ':' + exprCanonToLab(n.hi) + '\n' +
               emitLab(n.body, indent + '  ') + '\n' + indent + 'end';
      // directivas Calcpad (#rad, #deg, #round, #val...) NO existen en MATLAB -> comentar
      case 'raw': return indent + (n.text && n.text[0] === '#' ? '% ' + n.text : (n.text || ''));
      default: return indent + (n.text || '');
    }
  }

  // Definiciones MATLAB (2017a) de las funciones cp* que replican $Slope/$Area/$Plot/$Map.
  // Se anexan como FUNCIONES LOCALES al final del script (regla MATLAB 2017a: funciones al final).
  const CP_LAB_DEFS = {
    cpSlope: "function d = cpSlope(f, x0)\n  h = max(1e-7, abs(x0)*1e-7);\n  d = (f(x0+h) - f(x0-h)) / (2*h);\nend",
    cpArea: "function A = cpArea(f, a, b)\n  n = 200; h = (b-a)/n; x = a:h:b; y = arrayfun(f, x);\n  A = h/3 * (y(1) + y(end) + 4*sum(y(2:2:end-1)) + 2*sum(y(3:2:end-2)));\nend",
    cpPlot: "function cpPlot(f, a, b)\n  x = linspace(a, b, 300); y = arrayfun(f, x);\n  figure; plot(x, y, 'LineWidth', 1.5); grid on; xlabel('x'); ylabel('f(x)');\nend",
    cpMap: "function cpMap(f, x0, x1, y0, y1)\n  [X, Y] = meshgrid(linspace(x0,x1,40), linspace(y0,y1,40));\n  Z = arrayfun(f, X, Y);\n  figure; contourf(X, Y, Z, 20); colorbar; axis equal; xlabel('x'); ylabel('y');\nend"
  };

  // ================= API =================
  function parse(src, dialect) {
    if (dialect === 'lab') return parseLab(src);
    return parseCalcpad(src, dialect === 'symbolic');
  }
  function emit(nodes, dialect) {
    if (dialect === 'lab') {
      let code = emitLab(nodes, '');
      // anexar las funciones cp* USADAS al final (script MATLAB 2017a autocontenido)
      const used = [];
      for (const name of Object.keys(CP_LAB_DEFS))
        if (new RegExp('\\b' + name + '\\s*\\(').test(code)) used.push(CP_LAB_DEFS[name]);
      if (used.length) code += "\n\n% --- Funciones auxiliares Calcpad Lab (van al final en MATLAB) ---\n" + used.join("\n\n");
      return code;
    }
    return emitCalcpad(nodes, dialect === 'symbolic', '');
  }
  function translateDialect(src, from, to) {
    if (from === to) return src;
    return emit(parse(src, from), to);
  }

  if (typeof window !== 'undefined') window.translateDialect = translateDialect;
  if (typeof module !== 'undefined' && module.exports) module.exports = { translateDialect, parse, emit };
})();
