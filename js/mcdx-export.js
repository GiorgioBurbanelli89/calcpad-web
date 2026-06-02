/* Export Calcpad -> Mathcad Prime (.mcdx), 100% en el navegador (DOM, sin libs).
   Usa window.MCDX_PARTS (partes OPC fijas de la plantilla, ver mcdx-parts.js).
   Expone: window.buildMcdxBytes(calcpadText) -> Uint8Array (.mcdx). */
(function () {
  'use strict';

  const TEXT_FONT = 'Gabriola';                // fuente del texto (cambiar aqui). Math usa Mathcad UniMath Prime.
  const MATH_INLINE_SIZE = 8;                  // tamano de las operaciones embebidas en texto (texto=11, operaciones=8)

  // ---------- ZIP writer (STORE, sin compresion) + CRC32 ----------
  let CRC;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC[n] = c >>> 0; } }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ CRC[(crc ^ u8[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

  function zipStore(files) {                 // files: [{name, bytes:Uint8Array}]
    const enc = new TextEncoder();
    const locals = [], centrals = []; let offset = 0;
    for (const f of files) {
      const nameB = enc.encode(f.name), data = f.bytes, crc = crc32(data);
      const lh = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
      const local = new Uint8Array(lh.length + nameB.length + data.length);
      local.set(lh, 0); local.set(nameB, lh.length); local.set(data, lh.length + nameB.length);
      locals.push(local);
      const ch = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset));
      const cen = new Uint8Array(ch.length + nameB.length);
      cen.set(ch, 0); cen.set(nameB, ch.length); centrals.push(cen);
      offset += local.length;
    }
    const cenSize = centrals.reduce((a, c) => a + c.length, 0), cenOff = offset;
    const eocd = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length), u32(cenSize), u32(cenOff), u16(0)));
    const total = locals.reduce((a, c) => a + c.length, 0) + cenSize + eocd.length;
    const out = new Uint8Array(total); let p = 0;
    for (const c of locals) { out.set(c, p); p += c.length; }
    for (const c of centrals) { out.set(c, p); p += c.length; }
    out.set(eocd, p); return out;
  }

  const ENC = new TextEncoder();
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- parser de expresiones (recursive descent) -> MathML de Mathcad ----------
  // contenido de un id, con subindice: N_ele -> N<pw:Subscript>ele</pw:Subscript>
  function idContent(name) {
    const m = String(name).match(/^([A-Za-zα-ωΑ-Ω′″]+)_(.+)$/);
    if (m) return `<Span xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:pw="clr-namespace:Ptc.Wpf;assembly=Ptc.Core">${esc(m[1])}<pw:Subscript>${esc(m[2])}</pw:Subscript></Span>`;
    return esc(name);
  }
  function idRef(n) { return `<ml:id labels="VARIABLE" label-is-contextual="true" xml:space="preserve">${idContent(n)}</ml:id>`; }
  function topLevelIndex(s, ch) {                         // indice del primer 'ch' fuera de llaves/parentesis
    let d = 0;
    for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '{' || c === '(') d++; else if (c === '}' || c === ')') d--; else if (c === ch && d === 0) return i; }
    return -1;
  }
  function exprMathML(src) {
    src = String(src); let pos = 0;
    const skip = () => { while (pos < src.length && /\s/.test(src[pos])) pos++; };
    const peek = () => src[pos];
    function parseExpr() { return parseAdd(); }
    function parseAdd() {
      let l = parseMul();
      for (;;) { skip(); const c = peek(); if (c === '+' || c === '-') { pos++; l = `<ml:apply><ml:${c === '+' ? 'plus' : 'minus'} />${l}${parseMul()}</ml:apply>`; } else break; }
      return l;
    }
    function parseMul() {
      let l = parsePow();
      for (;;) { skip(); const c = peek(); if (c === '*' || c === '/' || c === '·') { pos++; l = `<ml:apply><ml:${c === '/' ? 'div' : 'mult'} />${l}${parsePow()}</ml:apply>`; } else break; }
      return l;
    }
    function parsePow() {
      const l = parseUnary(); skip();
      if (peek() === '^') { pos++; return `<ml:apply><ml:pow />${l}${parsePow()}</ml:apply>`; }
      return l;
    }
    function parseUnary() {
      skip(); if (peek() === '-') { pos++; return `<ml:apply><ml:neg />${parseUnary()}</ml:apply>`; }
      if (peek() === '+') { pos++; return parseUnary(); }
      return parsePostfix();
    }
    // indexacion postfija. Calcpad encadena RIGHT-assoc: y_j.s_j.i = y_j[s_j[i]] (Mathcad no vectoriza indices)
    function parsePostfix() {
      const base = parseAtom();
      const idxs = [];                                // cadena de indices: {single} o {multi:[..]}
      for (;;) {
        skip();
        if (peek() === '.') {
          pos++; skip();
          if (peek() === '(') {                       // .(i; j) matriz
            pos++; const a = []; skip();
            if (peek() !== ')') { a.push(parseExpr()); skip(); while (peek() === ';' || peek() === ',') { pos++; a.push(parseExpr()); skip(); } }
            if (peek() === ')') pos++;
            idxs.push({ multi: a });
          } else idxs.push({ single: parseIndexAtom() });   // .j atomico
        } else break;
      }
      if (idxs.length === 0) return base;
      const ix = (b, i) => `<ml:apply><ml:indexer />${b}${i}</ml:apply>`;
      const sq = a => a.length === 1 ? a[0] : `<ml:sequence>${a.join('')}</ml:sequence>`;
      // anidar a la derecha: el indice de cada nivel es el resto de la cadena
      const L = idxs.length;
      let acc;
      if (idxs[L - 1].multi) { acc = L >= 2 ? ix(idxs[L - 2].single, sq(idxs[L - 1].multi)) : sq(idxs[L - 1].multi); }
      else acc = idxs[L - 1].single;
      const start = idxs[L - 1].multi ? L - 3 : L - 2;
      for (let k = start; k >= 0; k--) acc = ix(idxs[k].single, acc);
      return ix(base, acc);
    }
    function parseIndexAtom() {                        // un solo id o numero como indice
      skip(); const c = peek();
      if ((c >= '0' && c <= '9')) { let n = ''; while (pos < src.length && /[0-9.]/.test(src[pos])) n += src[pos++]; return `<ml:real>${n}</ml:real>`; }
      if (/[A-Za-z_α-ωΑ-ΩЀ-ӿ′″]/.test(c || '')) { let id = ''; while (pos < src.length && /[A-Za-z0-9_α-ωΑ-Ω′″]/.test(src[pos])) id += src[pos++]; return idRef(id); }
      return '<ml:real>0</ml:real>';
    }
    function parseAtom() {
      skip(); const c = peek();
      if (c === '[') {                                 // literal de matriz/vector [a; b | c; d]
        pos++; skip(); const rows = [[]];
        while (pos < src.length && peek() !== ']') {
          rows[rows.length - 1].push(parseExpr()); skip();
          if (peek() === ';') { pos++; skip(); }
          else if (peek() === '|') { pos++; rows.push([]); skip(); }
          else break;
        }
        if (peek() === ']') pos++;
        if (rows.length === 1) {                       // [a; b; c] sin '|' -> stack(a;b;c): concatena vertical (aplana vectores como Calcpad)
          const col = rows[0];
          if (col.length === 1) return col[0];
          return `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">stack</ml:id><ml:sequence>${col.join('')}</ml:sequence></ml:apply>`;
        }
        const R = rows.length, C = rows[0].length; let el = '';
        for (let j = 0; j < C; j++) for (let i = 0; i < R; i++) el += (rows[i][j] || '<ml:real>0</ml:real>');  // column-major
        return `<ml:matrix rows="${R}" cols="${C}">${el}</ml:matrix>`;
      }
      if (c === '$') {                                   // directiva $Area{...} -> integral; otras -> placeholder
        pos++; let nm = ''; while (pos < src.length && /[A-Za-z]/.test(src[pos])) nm += src[pos++];
        if (peek() === '{') {
          let depth = 1, inner = ''; pos++;
          while (pos < src.length && depth > 0) { const ch = src[pos]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { pos++; break; } } inner += ch; pos++; }
          if (nm === 'Area') {
            const at = topLevelIndex(inner, '@');
            const rm = at >= 0 ? inner.slice(at + 1).match(/^\s*([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*)\s*=\s*(.+?)\s*:\s*(.+)$/) : null;
            if (rm) return `<ml:apply><ml:integral /><ml:lambda><ml:boundVars><ml:id labels="VARIABLE" xml:space="preserve">${idContent(rm[1])}</ml:id></ml:boundVars>${exprMathML(inner.slice(0, at))}</ml:lambda><ml:lowerBound>${exprMathML(rm[2])}</ml:lowerBound><ml:upperBound>${exprMathML(rm[3])}</ml:upperBound></ml:apply>`;
          }
          return '<ml:placeholder />';                   // $Plot/$Map/$Repeat dentro de expr -> placeholder
        }
        return '<ml:real>0</ml:real>';
      }
      if (c === '(') { pos++; const e = parseExpr(); skip(); if (peek() === ')') pos++; return `<ml:parens>${e}</ml:parens>`; }
      if ((c >= '0' && c <= '9') || c === '.') { let n = ''; while (pos < src.length && /[0-9.]/.test(src[pos])) n += src[pos++]; return `<ml:real>${n}</ml:real>`; }
      if (/[A-Za-z_α-ωΑ-ΩЀ-ӿ′″]/.test(c || '')) {
        // identificador: letras/digitos/_/primes/subindices Unicode/cirilico; ademas coma DENTRO del nombre (Calcpad usa ; para args -> , es de nombres)
        const IDC = /[A-Za-z0-9_α-ωΑ-ΩЀ-ӿ′″₀-ₜᵢ-ᵪⱼ]/;
        let id = '';
        while (pos < src.length) {
          const ch = src[pos];
          if (IDC.test(ch)) { id += ch; pos++; }
          else if (ch === ',' && IDC.test(src[pos + 1] || '')) { id += ch; pos++; }
          else break;
        }
        skip();
        if (peek() === '(') {  // llamada a funcion: nombre(args)
          pos++; const args = []; skip();
          if (peek() !== ')') { args.push(parseExpr()); skip(); while (peek() === ';' || peek() === ',') { pos++; args.push(parseExpr()); skip(); } }
          if (peek() === ')') pos++;
          // sqr/sqrt (raiz cuadrada de Calcpad) -> potencia ^0.5 (Mathcad no tiene funcion 'sqrt')
          if ((id === 'sqr' || id === 'sqrt') && args.length === 1)
            return `<ml:apply><ml:pow /><ml:parens>${args[0]}</ml:parens><ml:real>0.5</ml:real></ml:apply>`;
          // transp(M) (Calcpad) -> operador transpuesta nativo de Mathcad
          if (id === 'transp' && args.length === 1)
            return `<ml:apply><ml:transpose />${args[0]}</ml:apply>`;
          // row(M; i) / col(M; i) (Calcpad) -> operadores matrow/matcol nativos
          if (id === 'row' && args.length === 2) return `<ml:apply><ml:matrow />${args[0]}${args[1]}</ml:apply>`;
          if (id === 'col' && args.length === 2) return `<ml:apply><ml:matcol />${args[0]}${args[1]}</ml:apply>`;
          // spline de Calcpad -> funciones replica splineCp/splineVec (inyectadas aparte)
          if (id === 'spline' && args.length === 3)   // spline(p; q; M) -> splineCp(M; p; q)
            return `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">splineCp</ml:id><ml:sequence>${args[2]}${args[0]}${args[1]}</ml:sequence></ml:apply>`;
          if (id === 'spline' && args.length === 2)   // spline(t; v) -> splineVec(v; t)
            return `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">splineVec</ml:id><ml:sequence>${args[1]}${args[0]}</ml:sequence></ml:apply>`;
          // take(idx; v1; v2; ...; vn) (Calcpad) -> vector [v1;..;vn] indexado por idx
          if (id === 'take' && args.length >= 2) {
            const els = args.slice(1);
            return `<ml:apply><ml:indexer /><ml:matrix rows="${els.length}" cols="1">${els.join('')}</ml:matrix>${args[0]}</ml:apply>`;
          }
          // sum(v) (Calcpad) -> vsum(v) helper (Mathcad no tiene funcion 'sum', usa operador Sigma)
          if (id === 'sum' && args.length === 1)
            return `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">vsum</ml:id>${args[0]}</ml:apply>`;
          // extract(V; idx) (Calcpad, sub-vector por vector de indices) -> extractIdx(V; idx) helper
          if (id === 'extract' && args.length === 2)
            return `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">extractIdx</ml:id><ml:sequence>${args[0]}${args[1]}</ml:sequence></ml:apply>`;
          // slice(v; a; b) (Calcpad) -> submatrix(v, a, b, 1, 1) de Mathcad
          if (id === 'slice' && args.length === 3) args.push('<ml:real>1</ml:real>', '<ml:real>1</ml:real>');
          // row(M; i) (Calcpad, fila i) -> submatrix(M, i, i, 1, cols)  (aprox: fila como submatriz)
          // nombres de funcion que difieren entre Calcpad y Mathcad
          const FN = { clsolve: 'lsolve', slice: 'submatrix' };
          const fname = FN[id] || id;
          // Mathcad: 1 arg -> directo; 2+ args -> envuelto en <ml:sequence>
          const argsML = args.length === 1 ? args[0] : `<ml:sequence>${args.join('')}</ml:sequence>`;
          return `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">${idContent(fname)}</ml:id>${argsML}</ml:apply>`;
        }
        return idRef(id);
      }
      pos++; return '<ml:real>0</ml:real>';
    }
    try { return parseExpr() || '<ml:real>0</ml:real>'; } catch (e) { return '<ml:real>0</ml:real>'; }
  }
  const funcOrExprMathML = exprMathML;  // exprMathML ya maneja llamadas a funcion

  // ---------- helpers de spline: funciones Mathcad que replican el spline de Calcpad (Catmull-Rom monotono) ----------
  function splineDefs() {
    const id = n => `<ml:id labels="VARIABLE" xml:space="preserve">${n}</ml:id>`;
    const fid = n => `<ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">${n}</ml:id>`;
    const r = n => `<ml:real>${n}</ml:real>`;
    const o = (op, ...c) => `<ml:apply><ml:${op} />${c.join('')}</ml:apply>`;
    const sq = (...a) => `<ml:sequence>${a.join('')}</ml:sequence>`;
    const cl = (n, ...a) => `<ml:apply>${fid(n)}${a.length === 1 ? a[0] : sq(...a)}</ml:apply>`;
    const ix = (b, i) => `<ml:apply><ml:indexer />${b}${i}</ml:apply>`;
    const pr = e => `<ml:parens>${e}</ml:parens>`;
    const ld = (t, v) => `<ml:localDefine>${t}${v}</ml:localDefine>`;
    const pIf = (c, b) => `<ml:if><ml:test>${c}</ml:test><ml:then><ml:program>${b}</ml:program></ml:then></ml:if>`;
    const V = id('v'), T = id('t'), N = id('n'), J = id('j'), D = id('d'), S = id('s'), A = id('a'), B = id('b'), TT = id('tt'), Y0 = id('y0'), Y1 = id('y1'), WL = id('wL'), WR = id('wR');
    const Vj = ix(V, J), Vj1 = ix(V, o('plus', J, r(1))), yL = ix(V, cl('max', o('minus', J, r(1)), r(1))), yR = ix(V, cl('min', o('plus', J, r(2)), N));
    const svBody = ld(N, cl('rows', V)) + ld(J, cl('min', cl('floor', cl('min', cl('max', T, r(1)), N)), o('minus', N, r(1)))) + ld(Y0, Vj) + ld(Y1, Vj1) + ld(D, o('minus', Y1, Y0)) + ld(S, cl('sign', D)) + ld(A, D) + ld(B, D) +
      pIf(o('greaterThan', J, r(1)), ld(WL, r('0.25')) + pIf(o('equal', cl('sign', o('minus', Y0, yL)), S), ld(WL, r('0.5'))) + ld(A, o('mult', pr(o('minus', Y1, yL)), WL))) +
      pIf(o('lessThan', J, o('minus', N, r(1))), ld(WR, r('0.25')) + pIf(o('equal', cl('sign', o('minus', yR, Y1)), S), ld(WR, r('0.5'))) + ld(B, o('mult', pr(o('minus', yR, Y0)), WR))) +
      pIf(o('equal', J, r(1)), ld(A, o('plus', A, o('div', pr(o('minus', A, B)), r(2))))) +
      pIf(o('equal', J, o('minus', N, r(1))), ld(B, o('plus', B, o('div', pr(o('minus', B, A)), r(2))))) +
      ld(TT, o('minus', T, J)) +
      o('plus', Y0, o('mult', o('plus', o('mult', o('mult', pr(o('minus', Y1, Y0)), pr(o('minus', r(3), o('mult', r(2), TT)))), TT), o('mult', pr(o('minus', o('mult', pr(o('plus', A, B)), TT), A)), pr(o('minus', TT, r(1))))), TT));
    const svDef = `<ml:define><ml:function>${id('splineVec')}<ml:boundVars>${id('v')}${id('t')}</ml:boundVars></ml:function><ml:program>${svBody}</ml:program></ml:define>`;
    const M = id('M'), NR = id('nr'), COL = id('col'), R = id('r'), rowR = `<ml:apply><ml:matcol />${o('transpose', M)}${R}</ml:apply>`;
    const scBody = `<ml:program>${ld(NR, cl('rows', M))}<ml:localDefine>${COL}<ml:program><ml:for>${id('r')}<ml:range>${r(1)}${NR}</ml:range><ml:program>${ld(ix(COL, R), cl('splineVec', rowR, id('q')))}</ml:program></ml:for>${COL}</ml:program></ml:localDefine>${cl('splineVec', COL, id('p'))}</ml:program>`;
    const scDef = `<ml:define><ml:function>${id('splineCp')}<ml:boundVars>${id('M')}${id('p')}${id('q')}</ml:boundVars></ml:function>${scBody}</ml:define>`;
    return { svDef, scDef };
  }

  // symUpper(M): replica la matriz symmetric() de Calcpad. El ensamblaje solo llena el triangulo
  // superior (estricto) + bloques diagonales; este helper copia M y refleja el superior al inferior.
  //   symUpper(M) := | n <- rows(M) ; S <- M
  //                  | for r in 2..n: for c in 1..r-1: S[r,c] <- M[c,r]
  //                  | S
  function symUpperDef() {
    const id = n => `<ml:id labels="VARIABLE" xml:space="preserve">${n}</ml:id>`;
    const r = n => `<ml:real>${n}</ml:real>`;
    const o = (op, ...c) => `<ml:apply><ml:${op} />${c.join('')}</ml:apply>`;
    const sq = (...a) => `<ml:sequence>${a.join('')}</ml:sequence>`;
    const cl = (n, ...a) => `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">${n}</ml:id>${a.length === 1 ? a[0] : sq(...a)}</ml:apply>`;
    const ix2 = (b, i, j) => `<ml:apply><ml:indexer />${b}${sq(i, j)}</ml:apply>`;
    const ld = (t, v) => `<ml:localDefine>${t}${v}</ml:localDefine>`;
    const M = id('M'), S = id('S'), N = id('n'), R = id('r'), C = id('c');
    const innerFor = `<ml:for>${id('c')}<ml:range>${r(1)}${o('minus', R, r(1))}</ml:range><ml:program>${ld(ix2(S, R, C), ix2(M, C, R))}</ml:program></ml:for>`;
    const outerFor = `<ml:for>${id('r')}<ml:range>${r(2)}${N}</ml:range><ml:program>${innerFor}</ml:program></ml:for>`;
    const body = ld(N, cl('rows', M)) + ld(S, M) + outerFor + S;
    return `<ml:define><ml:function>${id('symUpper')}<ml:boundVars>${id('M')}</ml:boundVars></ml:function><ml:program>${body}</ml:program></ml:define>`;
  }

  // vsum(v) = suma de elementos; extractIdx(V, idx) = sub-vector V en las posiciones idx.
  // Replican sum()/extract() de Calcpad (Mathcad no los tiene como funciones).
  function sumExtractDefs() {
    const id = n => `<ml:id labels="VARIABLE" xml:space="preserve">${n}</ml:id>`;
    const r = n => `<ml:real>${n}</ml:real>`;
    const o = (op, ...c) => `<ml:apply><ml:${op} />${c.join('')}</ml:apply>`;
    const cl = (n, a) => `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">${n}</ml:id>${a}</ml:apply>`;
    const ix = (b, i) => `<ml:apply><ml:indexer />${b}${i}</ml:apply>`;
    const ld = (t, v) => `<ml:localDefine>${t}${v}</ml:localDefine>`;
    const forL = (v, lo, hi, b) => `<ml:for>${id(v)}<ml:range>${lo}${hi}</ml:range><ml:program>${b}</ml:program></ml:for>`;
    const pIf = (c, b) => `<ml:if><ml:test>${c}</ml:test><ml:then><ml:program>${b}</ml:program></ml:then></ml:if>`;
    // vsum(v) := s<-0; for k in 1..rows(v): s<-s+v_k; s
    const V = id('v'), S = id('s'), K = id('k');
    const vsumBody = ld(S, r(0)) + forL('k', r(1), cl('rows', V), ld(S, o('plus', S, ix(V, K)))) + S;
    const vsumDef = `<ml:define><ml:function>${id('vsum')}<ml:boundVars>${id('v')}</ml:boundVars></ml:function><ml:program>${vsumBody}</ml:program></ml:define>`;
    // extractIdx(V, idx) := ix<-idx; if fila -> transponer a columna; for k: out_k <- V_(ix_k); out
    const VV = id('V'), IDX = id('idx'), OUT = id('out'), IXX = id('ix');
    const exBody = `<ml:program>${ld(IXX, IDX)}${pIf(o('equal', cl('rows', IDX), r(1)), ld(IXX, o('transpose', IDX)))}${forL('k', r(1), cl('rows', IXX), ld(ix(OUT, K), ix(VV, ix(IXX, K))))}${OUT}</ml:program>`;
    const extractDef = `<ml:define><ml:function>${id('extractIdx')}<ml:boundVars>${id('V')}${id('idx')}</ml:boundVars></ml:function>${exBody}</ml:define>`;
    return { vsumDef, extractDef };
  }

  // altura estimada (px) de una region matematica segun su contenido (filas de matriz, fracciones)
  function estHeight(body) {
    let h = 28;
    const m = body.match(/<ml:matrix rows="(\d+)"/);
    if (m) h = Math.max(h, (+m[1]) * 21 + 14);                  // ~21px por fila
    else if (/<ml:div/.test(body)) h = Math.max(h, 46);         // fraccion apilada
    if (/<ml:program>/.test(body)) {                           // programa -> alto segun sentencias + resultado + indent de for
      const nst = (body.match(/<ml:localDefine|<ml:if\b|<ml:for\b/g) || []).length;
      h = Math.max(h, nst * 26 + 64);
    }
    return h;
  }

  // ---------- generador .mcdx ----------
  function Gen() {
    this.regions = []; this.rels = []; this.xaml = {}; this.rid = 0; this.ref = 0; this.fd = 0; this.top = 30;
    this.dims = {};                                             // filas conocidas de cada variable vector/matriz
    this.scalars = {};                                          // valor numerico de escalares (para inferir tamano de loops)
    this.matInit = {};                                          // dimensiones {r,c} del init de ceros de cada acumulador
    this.recentScalars = {};                                    // escalares asignados recientemente (posibles contadores de loops)
  }
  Gen.prototype.idDef = function (n) { return `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(n)}</ml:id>`; };
  Gen.prototype.mathRegion = function (body, top, left, w, h) {
    const id = this.rid++, r = this.ref++;
    return `<region region-id="${id}" actualWidth="${w || 220}" actualHeight="${h || 40}" top="${top}" left="${left}"><math resultRef="${r}">${body}</math></region>`;
  };
  Gen.prototype.evalBody = function (n) { return `<ml:eval>${exprMathML(n)}<ml:unitOverride><ml:placeholder /></ml:unitOverride></ml:eval>`; };
  Gen.prototype.defScalarOrExpr = function (name, rhs) { return `<ml:define>${this.idDef(name)}${exprMathML(rhs)}</ml:define>`; };
  Gen.prototype.defMatrix = function (name, rows) {
    const r = rows.length, c = rows[0].length, el = [];
    for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) el.push(`<ml:real>${rows[i][j]}</ml:real>`);
    return `<ml:define>${this.idDef(name)}<ml:matrix rows="${r}" cols="${c}">${el.join('')}</ml:matrix></ml:define>`;
  };
  Gen.prototype.defVector = function (name, col) {
    const el = col.map(x => `<ml:real>${x}</ml:real>`).join('');
    return `<ml:define>${this.idDef(name)}<ml:matrix rows="${col.length}" cols="1">${el}</ml:matrix></ml:define>`;
  };
  // f(x; y) = expr  ->  <ml:define><ml:function>...<ml:boundVars>...</ml:boundVars></ml:function>BODY</ml:define>
  Gen.prototype.defFunction = function (name, params, bodyML) {
    const boundVars = params.map(p => `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(p)}</ml:id>`).join('');
    const fn = `<ml:function><ml:id labels="VARIABLE" xml:space="preserve">${idContent(name)}</ml:id><ml:boundVars>${boundVars}</ml:boundVars></ml:function>`;
    return `<ml:define>${fn}${bodyML}</ml:define>`;
  };
  Gen.prototype.text = function (s, bold, size) {
    size = size || 11; this.fd++;
    if (bold) this.top += 14;                                 // respiro antes de un encabezado
    const relid = 'Rtext' + this.fd, target = `/mathcad/xaml/FlowDocument${this.fd}.XamlPackage`;
    const fw = bold ? 'Bold' : 'Normal';
    const id = this.rid++;
    const FSZ = (size * 1.3333).toFixed(4);                   // pt -> px (11pt = 14.67), consistente con textWithMath/Test_1
    this.regions.push(`<region region-id="${id}" width="650" actualWidth="650" actualHeight="${(size * 1.7).toFixed(1)}" top="${this.top}" left="19.2"><text item-idref="${relid}"><FlowDocument FontFamily="${TEXT_FONT}" FontStyle="Normal" FontWeight="${fw}" FontSize="${FSZ}" Foreground="#FF000000" TextAlignment="Left" xml:lang="es-es" Typography.Variants="Normal" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" /></text></region>`);
    this.rels.push(`<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/flowDocument" Target="${target}" Id="${relid}" />`);
    const doc = `<Section xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xml:space="preserve" TextAlignment="Left" xml:lang="es-es" FontFamily="${TEXT_FONT}" FontStyle="Normal" FontWeight="${fw}" FontSize="${FSZ}" Foreground="#FF000000"><Paragraph><Run xml:lang="es-es" FontWeight="${fw}">${esc(s)}</Run></Paragraph></Section>`;
    const ct = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xaml" ContentType="application/vnd.ms-wpf.xaml+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /></Types>';
    const rels = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/wpf/2005/10/xaml/entry" Target="/Xaml/Document.xaml" Id="Rentry${this.fd}" /></Relationships>`;
    this.xaml[`mathcad/xaml/FlowDocument${this.fd}.XamlPackage`] = zipStore([
      { name: 'Xaml/Document.xaml', bytes: ENC.encode(doc) },
      { name: '_rels/.rels', bytes: ENC.encode(rels) },
      { name: '[Content_Types].xml', bytes: ENC.encode(ct) }]);
    this.top += size * 1.55 + 5;
  };
  // Texto con math EMBEBIDA inline (estilo Calcpad 'desc:' X). parts = [{text} | {ml}].
  // El caret avanza por la longitud del texto + un estimado del ancho de cada math.
  Gen.prototype.textWithMath = function (parts, size) {
    size = size || 11; this.fd++;
    const relid = 'Rtext' + this.fd, target = `/mathcad/xaml/FlowDocument${this.fd}.XamlPackage`;
    const FONT = TEXT_FONT, FSZ = (size * 1.3333).toFixed(4);
    let runs = '', nested = '', caret = 0;
    for (const p of parts) {
      if (p.text != null) { runs += `<Run xml:lang="es-es">${esc(p.text)}</Run>`; caret += p.text.length; }
      else if (p.ml) {
        const rid = this.rid++, r = this.ref++;
        // texto a 11, operaciones (math embebida) a 8 -> formattingOverride FontSize="8"
        nested += `<region region-id="${rid}" actualWidth="60" actualHeight="12.8" text-caret-position="${caret}"><math resultRef="${r}">${p.ml}<resultFormat><matrix size="12,12" offset="0,0" show-indices="false" expand-nested-arrays="false" /></resultFormat><formattingOverride FontSize="${MATH_INLINE_SIZE}" /></math></region>`;
        caret += 6;                                                    // estimado del ancho de la ecuacion en glifos
      }
    }
    const id = this.rid++;
    this.regions.push(`<region region-id="${id}" width="650" actualWidth="650" actualHeight="${(size * 1.9).toFixed(1)}" top="${this.top}" left="19.2"><text item-idref="${relid}"><FlowDocument FontFamily="${FONT}" FontStyle="Normal" FontWeight="Normal" FontSize="${FSZ}" Foreground="#FF000000" Background="#00FFFFFF" TextAlignment="Left" xml:lang="es-es" Typography.Variants="Normal" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" /><regions>${nested}</regions></text></region>`);
    this.rels.push(`<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/flowDocument" Target="${target}" Id="${relid}" />`);
    const doc = `<Section xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xml:space="preserve" TextAlignment="Left" xml:lang="es-es" FontFamily="${FONT}" FontStyle="Normal" FontWeight="Normal" FontSize="${FSZ}" Foreground="#FF000000"><Paragraph>${runs}</Paragraph></Section>`;
    const ct = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xaml" ContentType="application/vnd.ms-wpf.xaml+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /></Types>';
    const rels = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/wpf/2005/10/xaml/entry" Target="/Xaml/Document.xaml" Id="Rentry${this.fd}" /></Relationships>`;
    this.xaml[`mathcad/xaml/FlowDocument${this.fd}.XamlPackage`] = zipStore([
      { name: 'Xaml/Document.xaml', bytes: ENC.encode(doc) },
      { name: '_rels/.rels', bytes: ENC.encode(rels) },
      { name: '[Content_Types].xml', bytes: ENC.encode(ct) }]);
    this.top += size * 2.2 + 6;
  };
  // Mathcad ancla el contenido matematico por su CENTRO vertical en 'top' -> anclar en top + h/2
  Gen.prototype.defAndEval = function (body, name) {
    const d = this.dims[name];                                        // si el valor es un vector, su display puede ser mas alto que la def
    const vh = d ? Math.min(d, 18) * 24 + 50 : 0;
    const h = Math.max(estHeight(body), vh), c = this.top + h / 2;
    this.regions.push(this.mathRegion(body, c, 19.2, 260, h));
    this.regions.push(this.mathRegion(this.evalBody(name), c, 320, 260, h));
    this.top += h + 8;
  };
  Gen.prototype.defOnly = function (body, hOverride) {
    const h = hOverride || estHeight(body), c = this.top + h / 2;
    this.regions.push(this.mathRegion(body, c, 19.2, 320, h)); this.top += h + 8;
  };
  Gen.prototype.evalOnly = function (name) {
    let d = this.dims[name];
    if (d === undefined) {                                            // estimar filas para expresiones (transp/row) -> altura correcta
      const md = this.matDims || {};
      const tm = name.match(/^transp\s*\(\s*([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*\)$/);
      if (tm && md[tm[1]]) { const cc = evalScalar(md[tm[1]].c, this.scalars); if (cc) d = Math.min(Math.round(cc), 40); }  // transp -> filas = columnas del original
    }
    // Mathcad trunca vectores largos a ~12-13 filas + "..." -> cap la altura a las filas que muestra (+ margen)
    const rows = d ? Math.min(d, 13) : 0;
    const h = rows ? Math.max(28, rows * 25 + 60) : 28, c = this.top + h / 2;
    this.regions.push(this.mathRegion(this.evalBody(name), c, 19.2, 260, h)); this.top += h + 8;
  };
  // Envuelve las regiones emitidas desde el indice 'mark' en un Area colapsada (computa pero no se ve).
  // 'topStart' es g.top justo antes de 'mark'. Deja g.top en una linea despues del area.
  Gen.prototype.collapseRegionsFrom = function (mark, topStart) {
    const hidden = this.regions.splice(mark).map(r => r.replace(/top="([\d.]+)"/, (m, t) => `top="${Math.max(0, parseFloat(t) - topStart).toFixed(1)}"`));
    if (hidden.length) this.regions.push(`<region region-id="${this.rid++}" height="1" width="699" actualWidth="699" actualHeight="0.5" top="${topStart}" left="19.2"><Area IsCollapsed="true" AreaHeight="0.5"><regions>${hidden.join('')}</regions></Area></region>`);
    this.top = topStart + 26;
  };
  // Tras el ensamblaje, simetriza una matriz declarada symmetric() (una sola vez), redefiniendo
  // NAME := symUpper(NAME). Inyecta la def de symUpper la primera vez.
  Gen.prototype.ensureSym = function (name) {
    if (!this.symMatrices || !this.symMatrices.has(name)) return;
    this.symDone = this.symDone || new Set();
    if (this.symDone.has(name)) return;
    this.symDone.add(name);
    const mark = this.regions.length, topStart = this.top;
    if (!this.symInjected) { this.defOnly(symUpperDef(), 150); this.symInjected = true; }
    const rhs = `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">symUpper</ml:id>${exprMathML(name)}</ml:apply>`;
    this.defOnly(`<ml:define>${this.idDef(name)}${rhs}</ml:define>`, 30);
    this.collapseRegionsFrom(mark, topStart);                          // ocultar plumbing de simetrizacion
  };
  // loop -> RET := eval( program{ for..; RET } ), con eval de RET a la derecha
  Gen.prototype.loopDefine = function (retName, forML) {
    const ret = `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(retName)}</ml:id>`;
    const prog = `<ml:program>${forML}${ret}</ml:program>`;
    const rhs = `<ml:eval>${prog}<ml:unitOverride><ml:placeholder /></ml:unitOverride></ml:eval>`;
    const defBody = `<ml:define>${ret}${rhs}</ml:define>`;
    // filas mostradas del programa: cada sentencia/for/if/else + la linea de retorno
    const nStmt = (forML.match(/<ml:localDefine|<ml:for\b|<ml:if\b|<ml:else\b/g) || []).length + 1;
    const ifPad = (forML.match(/<ml:if\b/g) || []).length * 26;       // if/else renderizan mas alto
    const nFors = (forML.match(/<ml:for\b/g) || []).length;           // cada for (anidado/fusionado) ocupa mas alto
    // el programa muestra el resultado inline (vector/matriz) -> reservar alto MUY generoso (sin solape)
    const h = Math.max(nStmt * 28 + 70 + ifPad + nFors * 55, ((this.dims[retName] || 8) + 4) * 23 + 60), c = this.top + h / 2;
    this.regions.push(this.mathRegion(defBody, c, 19.2, 320, h));
    this.regions.push(this.mathRegion(this.evalBody(retName), c, 380, 240, h));
    this.top += h + 30;
    if (!this.dims[retName]) this.dims[retName] = 8;            // alto por defecto para usos posteriores
  };
  // $Map{f @ x=a:b & y=c:d} -> superficie 3D + contorno 2D de Mathcad
  // CLAVE: dominio fijo (auto-scale="false" + startValue/endValue reales) para que Mathcad
  // muestree SOLO el rango valido [x0,x1]x[y0,y1]; con auto-scale="true" Mathcad va a -10..10
  // y la funcion (spline sobre matriz finita) extrapola y rompe el grafico.
  Gen.prototype.contourPlot = function (funcML, x0, x1, y0, y1) {
    const rNum = () => this.ref++;
    // --- superficie 3D ---
    const grid5 = `<axisGrid><gridFrequency>5</gridFrequency><gridLabels display="true" /><gridLines /><tickMarks display="true" /></axisGrid>`;
    const dom3 = (t, s, e) => `<${t} scale-type="linear" allow-negative-values="true" auto-scale="false"><startValue><ml:real>${s}</ml:real></startValue><endValue><ml:real>${e}</ml:real></endValue></${t}>`;
    const dom3auto = (t) => `<${t} scale-type="linear" allow-negative-values="true" auto-scale="true"><startValue /><endValue /></${t}>`;
    const ax3 = (n, s, e, dt) => `<${n} start="${s}" end="${e}" rank="1"><axisLine />${grid5}<axisLabel />${dt}</${n}>`;
    const cam = `<CameraTransformMatrix Rows="4" Columns="4"><Cells><Cell>0.9938</Cell><Cell>0.0016</Cell><Cell>-0.1111</Cell><Cell>0</Cell><Cell>-0.0012</Cell><Cell>0.99999</Cell><Cell>0.004</Cell><Cell>0</Cell><Cell>0.1111</Cell><Cell>-0.0039</Cell><Cell>0.9938</Cell><Cell>0</Cell><Cell>0</Cell><Cell>0</Cell><Cell>0</Cell><Cell>1</Cell></Cells></CameraTransformMatrix>`;
    const id3 = this.rid++, r3 = rNum();
    const plot3D = `<region region-id="${id3}" actualWidth="287" actualHeight="291" top="${this.top}" left="0"><plot><plot3D><traces><trace3D num-of-points="41" resultRef="${r3}"><traceStyle color="#FF000000" automaticStyle="true">surface</traceStyle></trace3D></traces><graph-size width="230.4" height="230.4" /><axes>${ax3('xAxis', x0, x1, dom3('xyDomain', x0, x1))}${ax3('yAxis', y0, y1, dom3('xyDomain', y0, y1))}${ax3('zAxis', 0, 1, dom3auto('zDomain'))}</axes><plotEquations><plotEquation><math>${funcML}</math><math><ml:placeholder /></math></plotEquation></plotEquations>${cam}</plot3D></plot></region>`;
    this.regions.push(plot3D);
    this.top += 305;
    // --- contorno 2D ---
    const id2 = this.rid++, r2 = rNum();
    const gridC = `<axisGrid><gridFrequency>11</gridFrequency><gridLabels display="true" /><gridLines /><tickMarks display="true" /></axisGrid>`;
    const domC = (t, s, e) => `<${t} scale-type="linear" auto-scale="false"><startValue><ml:real>${s}</ml:real></startValue><endValue><ml:real>${e}</ml:real></endValue></${t}>`;
    const domCauto = (t) => `<${t} scale-type="linear" auto-scale="true"><startValue><ml:placeholder /></startValue><endValue><ml:placeholder /></endValue></${t}>`;
    const xAxis = `<xAxis rank="1" legend-position="PlotBoundaryBottom" start="${x0}" end="${x1}"><axisLine position="ticknumberlock" positionticmark="0" legendWidth="0" />${gridC}<axisLabel /><markers />${domC('xyDomain', x0, x1)}</xAxis>`;
    const yAxis = `<yAxis rank="1" legend-position="PlotBoundaryLeft" start="${y0}" end="${y1}"><axisLine position="ticknumberlock" positionticmark="0" legendWidth="0" />${gridC}<axisLabel /><markers />${domC('xyDomain', y0, y1)}</yAxis>`;
    const zAxis = `<zAxis rank="1" start="0" end="1"><axisLine position="origin" positionticmark="5" legendWidth="0" />${gridC}<axisLabel /><markers />${domCauto('zDomain')}</zAxis>`;
    const region = `<region region-id="${id2}" actualWidth="305" actualHeight="286" top="${this.top}" left="0"><plot background-type="white"><contourPlot><axes>${xAxis}${yAxis}${zAxis}</axes><contour color="#FF000000" show-lables="false" resultRef="${r2}" /><graph-size width="230.4" height="230.4" /><plotEquation><math>${funcML}</math><math><ml:placeholder /></math></plotEquation></contourPlot></plot></region>`;
    this.regions.push(region);
    this.top += 300;
  };
  // xyPlot: nube de puntos (xVar, yVar) -> grafica 2D nativa de Mathcad (ej. nodos de la malla)
  Gen.prototype.xyPlot = function (xVar, yVar) {
    const id = this.rid++, r = this.ref++;
    const dom = (tag) => `<${tag} scale-type="linear" auto-scale="true"><startValue><ml:placeholder /></startValue><endValue><ml:placeholder /></endValue></${tag}>`;
    const grid = `<axisGrid><gridFrequency>11</gridFrequency><gridLabels display="true" /><gridLines /><tickMarks display="true" /></axisGrid>`;
    const xAxis = `<xAxis rank="1" legend-position="PlotBoundaryBottom" start="0" end="1"><axisLine position="origin" positionticmark="0" legendWidth="67" />${grid}<axisLabel /><markers /><plotEquations><plotEquation><math>${exprMathML(xVar)}</math><math><ml:placeholder /></math></plotEquation></plotEquations>${dom('xyDomain')}</xAxis>`;
    const yAxis = `<yAxis rank="1" legend-position="PlotBoundaryLeft" start="0" end="1"><axisLine position="origin" positionticmark="0" legendWidth="67" />${grid}<axisLabel /><markers /><plotEquations><plotEquation><math>${exprMathML(yVar)}</math><math><ml:placeholder /></math></plotEquation></plotEquations>${dom('xyDomain')}</yAxis>`;
    const traces = `<traces><trace resultRef="${r}"><traceStyle color="#FFCC0000" symbol="circle" line-weight="2" line-style="None">lines</traceStyle></trace></traces>`;
    const region = `<region region-id="${id}" height="298" width="360" actualWidth="360" actualHeight="298" top="${this.top}" left="18.9"><plot origin-positioning="true"><xyPlot><title /><legend />${traces}<graph-size width="290" height="231" /><axes>${xAxis}${yAxis}</axes></xyPlot></plot></region>`;
    this.regions.push(region);
    this.top += 300;
  };

  // meshPlot: dibuja el MALLADO 2D (grilla) + nudos + APOYOS (cuadrados en los bordes detectados) + FLECHA de carga.
  // Todo como polilineas (Mathcad no tiene simbolos de cuadrado/flecha). supEdges = Set de 'bottom/top/left/right'.
  Gen.prototype.meshPlot = function (na, nb, a1, b1, supEdges, load, vVar) {
    vVar = vVar || 'y_j';
    const V = vVar === 'z_j' ? 'Z' : 'Y';                             // prefijo del eje vertical (XZ -> Z, XY -> Y)
    const a = na * a1, b = nb * b1, X = [], Y = [];
    for (let i = 0; i <= na; i++) {                                    // grilla: verticales (serpentea)
      const x = i * a1;
      if (i % 2 === 0) { X.push(x, x); Y.push(0, b); } else { X.push(x, x); Y.push(b, 0); }
    }
    let atRight = true; const atTop = (na % 2 === 0);
    for (let k = 0; k <= nb; k++) {                                    // grilla: horizontales
      const j = atTop ? (nb - k) : k, y = j * b1;
      if (atRight) { X.push(a, 0); Y.push(y, y); atRight = false; } else { X.push(0, a); Y.push(y, y); atRight = true; }
    }
    // APOYOS = cuadritos en los bordes con restriccion (detectados del source)
    supEdges = (supEdges && supEdges.size) ? supEdges : new Set(['bottom', 'top', 'left', 'right']);
    const s = 0.15 * Math.min(a1, b1), Xs = [], Ys = [];
    const sq = (nx, ny, tx, ty, ox, oy) => {                          // cuadrado en (nx,ny), tangente (tx,ty), normal exterior (ox,oy)
      Xs.push(nx + s * tx, nx + s * tx + 2 * s * ox, nx - s * tx + 2 * s * ox, nx - s * tx, nx + s * tx);
      Ys.push(ny + s * ty, ny + s * ty + 2 * s * oy, ny - s * ty + 2 * s * oy, ny - s * ty, ny + s * ty);
    };
    if (supEdges.has('bottom')) for (let i = 0; i <= na; i++) sq(i * a1, 0, 1, 0, 0, -1);
    if (supEdges.has('top')) for (let i = 0; i <= na; i++) sq(i * a1, b, 1, 0, 0, 1);
    if (supEdges.has('left')) for (let j = 0; j <= nb; j++) sq(0, j * b1, 0, 1, -1, 0);
    if (supEdges.has('right')) for (let j = 0; j <= nb; j++) sq(a, j * b1, 0, 1, 1, 0);
    // FLECHA(s) de carga (distribuidas si es borde completo)
    const arr = buildLoadArrows(na, nb, a1, b1, load);
    let Xa = arr ? arr.Xa : null, Ya = arr ? arr.Ya : null;
    const rnd = arr => arr.map(v => +v.toFixed(6));
    const mark = this.regions.length, top0 = this.top;
    this.defOnly(this.defVector('X_mesh', rnd(X))); this.defOnly(this.defVector(V + '_mesh', rnd(Y)));
    this.defOnly(this.defVector('X_sup', rnd(Xs))); this.defOnly(this.defVector(V + '_sup', rnd(Ys)));
    if (Xa) { this.defOnly(this.defVector('X_arr', rnd(Xa))); this.defOnly(this.defVector(V + '_arr', rnd(Ya))); }
    this.collapseRegionsFrom(mark, top0);
    const id = this.rid++, r0 = this.ref++, r1 = this.ref++, r2 = this.ref++, r3 = Xa ? this.ref++ : null;
    const dom = (tag) => `<${tag} scale-type="linear" auto-scale="true"><startValue><ml:placeholder /></startValue><endValue><ml:placeholder /></endValue></${tag}>`;
    const grid = `<axisGrid><gridFrequency>11</gridFrequency><gridLabels display="true" /><gridLines /><tickMarks display="true" /></axisGrid>`;
    const peN = (vs) => `<plotEquations>${vs.map(v => `<plotEquation><math>${exprMathML(v)}</math><math><ml:placeholder /></math></plotEquation>`).join('')}</plotEquations>`;
    const xv = ['X_mesh', 'x_j', 'X_sup'], yv = [V + '_mesh', vVar, V + '_sup'];
    if (Xa) { xv.push('X_arr'); yv.push(V + '_arr'); }
    const xAxis = `<xAxis rank="1" legend-position="PlotBoundaryBottom" start="0" end="1"><axisLine position="origin" positionticmark="0" legendWidth="67" />${grid}<axisLabel /><markers />${peN(xv)}${dom('xyDomain')}</xAxis>`;
    const yAxis = `<yAxis rank="1" legend-position="PlotBoundaryLeft" start="0" end="1"><axisLine position="origin" positionticmark="0" legendWidth="67" />${grid}<axisLabel /><markers />${peN(yv)}${dom('xyDomain')}</yAxis>`;
    let traces = `<trace resultRef="${r0}"><traceStyle color="#FF2E8B57" line-weight="1" line-style="Solid">lines</traceStyle></trace>`;
    traces += `<trace resultRef="${r1}"><traceStyle color="#FFCC0000" symbol="circle" line-weight="2" line-style="None">lines</traceStyle></trace>`;
    traces += `<trace resultRef="${r2}"><traceStyle color="#FFCC0000" line-weight="2" line-style="Solid">lines</traceStyle></trace>`;
    if (Xa) traces += `<trace resultRef="${r3}"><traceStyle color="#FFCC0000" line-weight="3" line-style="Solid">lines</traceStyle></trace>`;
    const region = `<region region-id="${id}" height="298" width="360" actualWidth="360" actualHeight="298" top="${this.top}" left="18.9"><plot origin-positioning="true"><xyPlot><title /><legend />${`<traces>${traces}</traces>`}<graph-size width="290" height="231" /><axes>${xAxis}${yAxis}</axes></xyPlot></plot></region>`;
    this.regions.push(region);
    this.top += 300;
  };
  Gen.prototype.ensureExtractIdx = function () {                      // inyecta el helper extractIdx (si no esta)
    if (this.extractInjected) return;
    this.extractInjected = true;
    const mark = this.regions.length, top0 = this.top;
    this.defOnly(sumExtractDefs().extractDef, 120);
    this.collapseRegionsFrom(mark, top0);
  };
  // meshPlotDeformed: malla DEFORMADA (nodos en xd_j/zd_j) conectados segun la topologia del grid.
  Gen.prototype.meshPlotDeformed = function (na, nb, a1, b1, supEdges, load, vVar) {
    this.ensureExtractIdx();
    const V = (vVar || 'z_j') === 'z_j' ? 'Z' : 'Y';                  // prefijo vertical
    const hd = 'xd_j', vd = (vVar === 'y_j') ? 'yd_j' : 'zd_j';       // coords deformadas (horizontal/vertical)
    const a = na * a1, b = nb * b1, node = (c, r) => c * (nb + 1) + r + 1, seq = [];
    for (let c = 0; c <= na; c++) { if (c % 2 === 0) for (let r = 0; r <= nb; r++) seq.push(node(c, r)); else for (let r = nb; r >= 0; r--) seq.push(node(c, r)); }
    const atTop = (na % 2 === 0); let atRight = true;
    for (let k = 0; k <= nb; k++) { const r = atTop ? (nb - k) : k; if (atRight) for (let c = na; c >= 0; c--) seq.push(node(c, r)); else for (let c = 0; c <= na; c++) seq.push(node(c, r)); atRight = !atRight; }
    supEdges = (supEdges && supEdges.size) ? supEdges : new Set(['bottom']);
    const s = 0.15 * Math.min(a1, b1), Xs = [], Ys = [];
    const sq = (nx, ny, tx, ty, ox, oy) => { Xs.push(nx + s * tx, nx + s * tx + 2 * s * ox, nx - s * tx + 2 * s * ox, nx - s * tx, nx + s * tx); Ys.push(ny + s * ty, ny + s * ty + 2 * s * oy, ny - s * ty + 2 * s * oy, ny - s * ty, ny + s * ty); };
    if (supEdges.has('bottom')) for (let i = 0; i <= na; i++) sq(i * a1, 0, 1, 0, 0, -1);
    if (supEdges.has('top')) for (let i = 0; i <= na; i++) sq(i * a1, b, 1, 0, 0, 1);
    if (supEdges.has('left')) for (let j = 0; j <= nb; j++) sq(0, j * b1, 0, 1, -1, 0);
    if (supEdges.has('right')) for (let j = 0; j <= nb; j++) sq(a, j * b1, 0, 1, 1, 0);
    const arr = buildLoadArrows(na, nb, a1, b1, load);
    let Xa = arr ? arr.Xa : null, Ya = arr ? arr.Ya : null;
    const rnd = arr => arr.map(v => +v.toFixed(6));
    const mark = this.regions.length, top0 = this.top;
    this.defOnly(this.defVector('mesh_seq', seq));
    this.defOnly(`<ml:define>${this.idDef('X_def')}${exprMathML('extractIdx(' + hd + '; mesh_seq)')}</ml:define>`);
    this.defOnly(`<ml:define>${this.idDef(V + '_def')}${exprMathML('extractIdx(' + vd + '; mesh_seq)')}</ml:define>`);
    this.defOnly(this.defVector('X_sup', rnd(Xs))); this.defOnly(this.defVector(V + '_sup', rnd(Ys)));
    if (Xa) { this.defOnly(this.defVector('X_arr', rnd(Xa))); this.defOnly(this.defVector(V + '_arr', rnd(Ya))); }
    this.collapseRegionsFrom(mark, top0);
    const id = this.rid++, r0 = this.ref++, r1 = this.ref++, r2 = this.ref++, r3 = Xa ? this.ref++ : null;
    const dom = (t) => `<${t} scale-type="linear" auto-scale="true"><startValue><ml:placeholder /></startValue><endValue><ml:placeholder /></endValue></${t}>`;
    const grid = `<axisGrid><gridFrequency>11</gridFrequency><gridLabels display="true" /><gridLines /><tickMarks display="true" /></axisGrid>`;
    const peN = (vs) => `<plotEquations>${vs.map(v => `<plotEquation><math>${exprMathML(v)}</math><math><ml:placeholder /></math></plotEquation>`).join('')}</plotEquations>`;
    const xv = ['X_def', hd, 'X_sup'], yv = [V + '_def', vd, V + '_sup'];
    if (Xa) { xv.push('X_arr'); yv.push(V + '_arr'); }
    const xAxis = `<xAxis rank="1" legend-position="PlotBoundaryBottom" start="0" end="1"><axisLine position="origin" positionticmark="0" legendWidth="67" />${grid}<axisLabel /><markers />${peN(xv)}${dom('xyDomain')}</xAxis>`;
    const yAxis = `<yAxis rank="1" legend-position="PlotBoundaryLeft" start="0" end="1"><axisLine position="origin" positionticmark="0" legendWidth="67" />${grid}<axisLabel /><markers />${peN(yv)}${dom('xyDomain')}</yAxis>`;
    let traces = `<trace resultRef="${r0}"><traceStyle color="#FFCC0000" line-weight="1" line-style="Solid">lines</traceStyle></trace>`;
    traces += `<trace resultRef="${r1}"><traceStyle color="#FFCC0000" symbol="circle" line-weight="2" line-style="None">lines</traceStyle></trace>`;
    traces += `<trace resultRef="${r2}"><traceStyle color="#FF000000" line-weight="2" line-style="Solid">lines</traceStyle></trace>`;
    if (Xa) traces += `<trace resultRef="${r3}"><traceStyle color="#FFCC0000" line-weight="3" line-style="Solid">lines</traceStyle></trace>`;
    const region = `<region region-id="${id}" height="298" width="360" actualWidth="360" actualHeight="298" top="${this.top}" left="18.9"><plot origin-positioning="true"><xyPlot><title /><legend />${`<traces>${traces}</traces>`}<graph-size width="290" height="231" /><axes>${xAxis}${yAxis}</axes></xyPlot></plot></region>`;
    this.regions.push(region);
    this.top += 300;
  };
  // detecta que bordes tienen apoyo (a partir de las condiciones #if cercanas a '+ k_s')
  function detectSupportEdges(lines) {
    const edges = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (!/k_s/.test(lines[i]) || /k_s\s*=/.test(lines[i])) continue;
      for (let k = i; k >= Math.max(0, i - 12); k--) {
        const c = lines[k];
        if (/#if/i.test(c)) {
          if (/[yz]_j/.test(c) && /≡\s*0/.test(c)) edges.add('bottom');   // vertical = y_j (XY) o z_j (XZ)
          if (/[yz]_j/.test(c) && /≡\s*b\b/.test(c)) edges.add('top');
          if (/x_j/.test(c) && /≡\s*0/.test(c)) edges.add('left');
          if (/x_j/.test(c) && /≡\s*a\b/.test(c)) edges.add('right');
        }
        if (/#for\b/i.test(c)) break;
      }
    }
    return edges;
  }
  // detecta la carga puntual: ubicacion (borde x/y) a partir de las condiciones #if cercanas a 'F.(...) ='
  function detectLoad(lines) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!/^F\s*\.\s*\(/.test(t) || !/=/.test(t)) continue;
      const load = { x: null, y: null };
      for (let k = i; k >= Math.max(0, i - 12); k--) {
        const c = lines[k];
        if (/x_j/.test(c) && /≡\s*0/.test(c)) load.x = 'left';
        if (/x_j/.test(c) && /≡\s*a\b/.test(c)) load.x = 'right';
        if (/[yz]_j/.test(c) && /≡\s*0/.test(c)) load.y = 'bottom';
        if (/[yz]_j/.test(c) && /≡\s*b\b/.test(c)) load.y = 'top';
        if (/#for\b/i.test(c)) break;
      }
      if (load.x || load.y) return load;
    }
    return null;
  }
  // construye la(s) flecha(s) de carga como polilinea. Si la carga es de borde completo (un solo
  // eje en el #if) -> flechas DISTRIBUIDAS en cada nudo del borde; si es puntual (x e y) -> una flecha.
  function buildLoadArrows(na, nb, a1, b1, load) {
    if (!load) return null;
    const a = na * a1, b = nb * b1, L = 1.3 * a1, h = 0.38 * a1, tips = [];
    let dir = 1;
    if (load.x === 'left' || load.x === 'right') {                    // flechas horizontales en borde vertical (x=0/a)
      dir = load.x === 'right' ? -1 : 1;
      const tx = load.x === 'right' ? a : 0;
      if (load.y) tips.push([tx, load.y === 'top' ? b : (load.y === 'bottom' ? 0 : b / 2)]);
      else for (let j = 0; j <= nb; j++) tips.push([tx, j * b1]);     // repartida en toda la altura z
    } else if (load.y === 'top' || load.y === 'bottom') {             // carga lateral en cabeza/base -> flechas horizontales (+x)
      dir = 1;
      const tz = load.y === 'top' ? b : 0;
      for (let i = 0; i <= na; i++) tips.push([i * a1, tz]);
    } else return null;
    const Xa = [], Ya = [];
    for (const [tx, tz] of tips) {                                    // cada flecha: tail->tip->cabeza->tip->tail (conector por la linea de cola)
      const sx = tx - dir * L;
      Xa.push(sx, tx, tx - dir * h, tx, tx - dir * h, tx, sx);
      Ya.push(tz, tz, tz + h, tz, tz - h, tz, tz);
    }
    return { Xa, Ya };
  }

  Gen.prototype.build = function () {
    const P = window.MCDX_PARTS;
    const ws = P.ws_prefix + '<regions>' + this.regions.join('') + '</regions></worksheet>';
    const result = '<?xml version="1.0" encoding="utf-8"?><resultsList xmlns:ml="http://schemas.mathsoft.com/math50" xmlns:u="http://schemas.mathsoft.com/units10" xmlns="http://schemas.mathsoft.com/result10"></resultsList>';
    let ct = P.parts['[Content_Types].xml'];
    const hasText = Object.keys(this.xaml).length > 0;
    if (hasText && ct.indexOf('XamlPackage') < 0)
      ct = ct.replace('</Types>', '<Default Extension="XamlPackage" ContentType="application/zip" /></Types>');
    const files = [];
    for (const name in P.parts) {
      if (name === '[Content_Types].xml') files.push({ name, bytes: ENC.encode(ct) });
      else files.push({ name, bytes: ENC.encode(P.parts[name]) });
    }
    files.push({ name: 'mathcad/worksheet.xml', bytes: ENC.encode(ws) });
    files.push({ name: 'mathcad/result.xml', bytes: ENC.encode(result) });
    if (hasText) {
      const wr = '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + this.rels.join('') + '</Relationships>';
      files.push({ name: 'mathcad/_rels/worksheet.xml.rels', bytes: ENC.encode(wr) });
      for (const path in this.xaml) files.push({ name: path, bytes: this.xaml[path] });
    }
    return zipStore(files);
  };

  // ---------- parser Calcpad -> generador ----------
  function parseBracket(rhs) {                // "[1; 2 | 3; 4]" -> {rows} o {col}
    const inner = rhs.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    const rowParts = inner.split('|');
    if (rowParts.length === 1) {             // vector columna
      return { vector: rowParts[0].split(';').map(s => s.trim()).filter(s => s !== '') };
    }
    return { matrix: rowParts.map(r => r.split(';').map(s => s.trim()).filter(s => s !== '')) };
  }
  function isNum(s) { return /^-?\d+\.?\d*$/.test(s.trim()); }
  // evalua aritmetica simple usando escalares ya conocidos (para inferir tamano de vectores/loops); null si no se puede
  function evalScalar(expr, scalars) {
    let ok = true;
    let e = String(expr).replace(/·/g, '*').replace(/\^/g, '**');
    e = e.replace(/[A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*/g, (id) => {
      if (scalars[id] !== undefined) return '(' + scalars[id] + ')';
      ok = false; return '0';
    });
    if (!ok || !/^[-+*/().\d\s]*$/.test(e.replace(/\*\*/g, '*'))) return null;   // solo aritmetica segura
    try { const v = Function('"use strict";return (' + e + ')')(); return (typeof v === 'number' && isFinite(v)) ? v : null; } catch (err) { return null; }
  }

  // estima cuantas FILAS produce una expresion (para la altura del display de su valor).
  // Maneja: [a;b;c] (stack, suma), [..|..] (matriz, n filas), slice/submatrix (rango),
  // producto A*B*C (filas del 1er factor no-escalar), llamada a funcion (g.funcRetDim), variable (dims).
  function retDim(g, expr) {
    expr = String(expr).trim().replace(/·/g, '*');
    if (!expr) return 1;
    if (expr[0] === '[') {
      const inner = expr.slice(1, expr.lastIndexOf(']'));
      if (inner.includes('|')) return splitTopLevel(inner, '|').length;
      return splitTopLevel(inner, ';').reduce((s, p) => s + retDim(g, p), 0);
    }
    const e2 = expr.replace(/^-/, '').trim();                          // menos unario
    const prod = splitTopLevel(e2, '*');                              // producto -> filas del 1er factor no-escalar
    if (prod.length > 1) { for (const p of prod) { const r = retDim(g, p.trim()); if (r > 1) return r; } return 1; }
    const fm = e2.match(/^([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″,]*)\s*\(([\s\S]*)\)$/);
    if (fm) {
      const fn = fm[1], args = splitTopLevel(fm[2], ';').map(s => s.trim()), sc = g.retScope || g.scalars;
      if ((fn === 'slice' || fn === 'submatrix') && args.length >= 3) {
        const a = evalScalar(args[1], sc), b = evalScalar(args[2], sc);
        if (a != null && b != null) return Math.max(1, Math.round(b - a + 1));
      }
      if (g.funcRetDim && g.funcRetDim[fn]) return g.funcRetDim[fn];
      return 1;
    }
    if (g.dims && /^[A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*$/.test(e2) && g.dims[e2]) return g.dims[e2];
    return 1;
  }

  // Calcpad usa HTML para formato; Mathcad no lo entiende -> limpiar/convertir antes de emitir texto.
  // limpia HTML de Calcpad -> texto plano + estilo. Devuelve {text, bold, size}.
  function cleanHtmlText(seg, defBold, defSize) {
    let s = seg, bold = defBold, size = defSize;
    const h = s.match(/<h([1-6])>([\s\S]*?)<\/h\1>/i);
    if (h) { s = h[2]; bold = true; size = [0, 18, 16, 14, 13, 12, 11][+h[1]] || 13; }
    s = s.replace(/<br\s*\/?>/gi, ' ');
    s = s.replace(/<sub>([\s\S]*?)<\/sub>/gi, '_$1');
    s = s.replace(/<sup>([\s\S]*?)<\/sup>/gi, '^$1');
    s = s.replace(/<hr\s*\/?>/gi, '');
    s = s.replace(/<img[^>]*\/?>/gi, '');
    s = s.replace(/<\/?(?:table|tr|td|th|thead|tbody|var|b|i|strong|em|span|div|p|a|ul|ol|li)[^>]*>/gi, '');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    s = s.replace(/\s{2,}/g, ' ');
    return { text: s, bold, size };
  }
  function emitText(g, seg, defBold, defSize) {
    const r = cleanHtmlText(seg, defBold, defSize);
    const s = r.text.trim();
    if (s) g.text(s, r.bold, r.size);
  }
  // MathML de un segmento inline (define simple o eval) para embeber en texto. null si no es inlineable.
  function segMathML(g, seg) {
    seg = seg.trim();
    const eq = seg.indexOf('=');
    if (eq < 0) {                                                      // expresion -> eval (muestra valor)
      const expr = seg.split("'")[0].trim();
      if (!/^[A-Za-z_α-ωΑ-ΩЀ-ӿ]/.test(expr)) return null;
      return `<ml:eval>${exprMathML(expr)}<ml:unitOverride><ml:placeholder /></ml:unitOverride></ml:eval>`;
    }
    const name = seg.slice(0, eq).trim(), rhs = seg.slice(eq + 1).trim();
    if (!/^[A-Za-zα-ωΑ-ΩЀ-ӿ_][\wα-ωΑ-ΩЀ-ӿ′″₀-ₜᵢ-ᵪⱼ]*$/.test(name)) return null;   // solo nombre simple (no indexada/funcion)
    if (/^(vector|matrix|zeros|symmetric|utriang|identity|diagonal)\s*\(/i.test(rhs) || rhs[0] === '[') return null;  // init/matriz -> region propia
    if (isNum(rhs)) { g.scalars[name] = parseFloat(rhs); g.recentScalars[name] = exprMathML(rhs); }   // tracking escalar
    else { const v = evalScalar(rhs, g.scalars); if (v !== null) g.scalars[name] = v; }
    return `<ml:define>${g.idDef(name)}${exprMathML(rhs)}</ml:define>`;
  }

  // ---------- Parte 4: loops #for..#loop  (y Parte 5: #if) -> <ml:program><ml:for>/<ml:if> ----------
  function collectBlock(lines, start, openRe, closeRe) {              // recolecta cuerpo de un bloque (con anidamiento)
    let depth = 1, i = start + 1; const body = [];
    for (; i < lines.length; i++) {
      const t = lines[i].trim();
      if (openRe.test(t)) depth++;
      else if (closeRe.test(t)) { depth--; if (depth === 0) break; }
      body.push(lines[i]);
    }
    return { body, end: i };
  }
  function condMathML(s) {                                            // condicion de #if: logicos y comparaciones
    s = s.trim();
    for (const [sym, op] of [['∨', 'or'], ['||', 'or'], [' or ', 'or']]) {       // OR (menor precedencia)
      const k = s.indexOf(sym); if (k > 0) return `<ml:apply><ml:${op} />${condMathML(s.slice(0, k))}${condMathML(s.slice(k + sym.length))}</ml:apply>`;
    }
    for (const [sym, op] of [['∧', 'and'], ['&&', 'and'], [' and ', 'and']]) {   // AND
      const k = s.indexOf(sym); if (k > 0) return `<ml:apply><ml:${op} />${condMathML(s.slice(0, k))}${condMathML(s.slice(k + sym.length))}</ml:apply>`;
    }
    const ops = [['≤', 'lessOrEqual'], ['<=', 'lessOrEqual'], ['≥', 'greaterOrEqual'], ['>=', 'greaterOrEqual'],
    ['≡', 'equal'], ['≠', 'notEqual'], ['!=', 'notEqual'], ['==', 'equal'], ['<', 'lessThan'], ['>', 'greaterThan'], ['=', 'equal']];
    for (const [sym, op] of ops) { const k = s.indexOf(sym); if (k > 0) return `<ml:apply><ml:${op} />${exprMathML(s.slice(0, k))}${exprMathML(s.slice(k + sym.length))}</ml:apply>`; }
    return exprMathML(s);
  }
  function assignLocalDefine(line) {                                  // sentencia de asignacion -> <ml:localDefine>
    const eq = line.indexOf('='); if (eq < 0) return '';
    const lhs = line.slice(0, eq).trim(), rhs = line.slice(eq + 1).trim();
    const fnM = lhs.match(/^([A-Za-z_α-ωΑ-ΩЀ-ӿ][\wα-ωΑ-ΩЀ-ӿ′″₀-ₜᵢ-ᵪⱼ,]*)\s*\(\s*([^()]*?)\s*\)$/);
    if (fnM) {
      const bv = fnM[2].split(';').map(s => s.trim()).filter(Boolean).map(p => `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(p)}</ml:id>`).join('');
      return `<ml:localDefine><ml:function><ml:id labels="VARIABLE" xml:space="preserve">${idContent(fnM[1])}</ml:id><ml:boundVars>${bv}</ml:boundVars></ml:function>${exprMathML(rhs)}</ml:localDefine>`;
    }
    const target = /^[A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*$/.test(lhs) ? `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(lhs)}</ml:id>` : exprMathML(lhs);
    return `<ml:localDefine>${target}${exprMathML(rhs)}</ml:localDefine>`;
  }
  function stmtMathML(lines, idx) {                                   // una sentencia del cuerpo de un programa
    const line = lines[idx].trim();
    if (/^#for\b/i.test(line)) { const b = collectBlock(lines, idx, /^#for\b/i, /^#loop\b/i); return { ml: buildFor(line, b.body), next: b.end + 1 }; }
    if (/^#if\b/i.test(line)) { const b = collectBlock(lines, idx, /^#if\b/i, /^#end\s*if\b/i); return { ml: buildIf(line, b.body), next: b.end + 1 }; }
    if (/^#/.test(line) || line === '' || line[0] === "'" || line[0] === '"') return { ml: '', next: idx + 1 };  // saltar texto/directivas dentro del programa
    const addM = line.match(/^add\s*\(([\s\S]+)\)$/i);             // add(block; M; r; c) -> acumulacion por elemento
    if (addM) return { ml: expandAdd(addM[1]), next: idx + 1 };
    return { ml: assignLocalDefine(line), next: idx + 1 };
  }
  function buildProgram(bodyLines) {
    let out = '', i = 0;
    while (i < bodyLines.length) { const r = stmtMathML(bodyLines, i); out += r.ml; i = r.next; }
    return out;
  }
  function buildFor(header, bodyLines) {                              // #for VAR = A : B
    const m = header.match(/^#for\s+([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*=\s*(.+?)\s*:\s*(.+)$/i);
    if (!m) return '';
    const idv = `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(m[1])}</ml:id>`;
    const range = `<ml:range>${exprMathML(m[2])}${exprMathML(m[3])}</ml:range>`;
    return `<ml:for>${idv}${range}<ml:program>${buildProgram(bodyLines)}</ml:program></ml:for>`;
  }
  function buildIf(header, bodyLines) {                               // #if COND ... [#else ...] #end if
    const m = header.match(/^#if\s+(.+)$/i); if (!m) return '';
    let depth = 0, elseAt = -1;
    for (let k = 0; k < bodyLines.length; k++) {
      const t = bodyLines[k].trim();
      if (/^#(for|if)\b/i.test(t)) depth++; else if (/^#(loop|end\s*if)\b/i.test(t)) depth--;
      else if (depth === 0 && /^#else\b/i.test(t)) { elseAt = k; break; }
    }
    const thenL = elseAt < 0 ? bodyLines : bodyLines.slice(0, elseAt);
    const elseL = elseAt < 0 ? null : bodyLines.slice(elseAt + 1);
    let s = `<ml:if><ml:test>${condMathML(m[1].trim())}</ml:test><ml:then><ml:program>${buildProgram(thenL)}</ml:program></ml:then>`;
    if (elseL) s += `<ml:else><ml:program>${buildProgram(elseL)}</ml:program></ml:else>`;
    return s + '</ml:if>';
  }
  function findAccumulator(bodyLines) {                               // variable de retorno del loop
    for (const ln of bodyLines) { const m = ln.trim().match(/^([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*\.\s*[\(A-Za-z0-9_]/); if (m) return m[1]; }
    for (const ln of bodyLines) { const m = ln.trim().match(/^([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*=/); if (m) return m[1]; }
    return 'res';
  }
  // acumuladores indexados (variables asignadas por M.(..)= ) -> un programa por cada uno (opcion A)
  function findAccumulators(bodyLines) {
    const seen = [], set = {}, add = (n) => { if (n && !set[n]) { set[n] = 1; seen.push(n); } };
    for (const ln of bodyLines) {
      const t = ln.trim();
      let m = t.match(/^([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*\.\s*[\(A-Za-z0-9_]/);   // X.(..) =
      if (m) add(m[1]);
      m = t.match(/^add\s*\(\s*[^;]+;\s*([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*;/i);      // add(block; M; ..) -> M
      if (m) add(m[1]);
    }
    return seen;
  }
  function hasTextLine(bodyLines) { return bodyLines.some(l => { const t = l.trim(); return t[0] === "'" || t[0] === '"'; }); }
  function splitTopLevel(s, sep) {                                    // split por 'sep' fuera de parentesis/llaves
    const parts = []; let d = 0, last = 0;
    for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(' || c === '{' || c === '[') d++; else if (c === ')' || c === '}' || c === ']') d--; else if (c === sep && d === 0) { parts.push(s.slice(last, i)); last = i + 1; } }
    parts.push(s.slice(last)); return parts;
  }
  // add(block; M; r0; c0) (Calcpad, suma block dentro de M en (r0,c0) por mutacion)
  // -> loops por elemento que acumulan: M.(r0+br-1; c0+bc-1) += block.(br; bc)
  function expandAdd(argsStr) {
    const p = splitTopLevel(argsStr, ';').map(s => s.trim());
    if (p.length < 4) return '';
    const [block, Mname, r0, c0] = p;
    const iv = n => `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(n)}</ml:id>`;
    const fcall = (fn, a) => `<ml:apply><ml:id labels="FUNCTION" label-is-contextual="true" xml:space="preserve">${fn}</ml:id>${a}</ml:apply>`;
    const BLK = iv('blk'), BR = iv('br'), BC = iv('bc');
    const rIdx = `<ml:apply><ml:minus /><ml:apply><ml:plus />${exprMathML(r0)}${BR}</ml:apply><ml:real>1</ml:real></ml:apply>`;
    const cIdx = `<ml:apply><ml:minus /><ml:apply><ml:plus />${exprMathML(c0)}${BC}</ml:apply><ml:real>1</ml:real></ml:apply>`;
    const Midx = `<ml:apply><ml:indexer />${iv(Mname)}<ml:sequence>${rIdx}${cIdx}</ml:sequence></ml:apply>`;
    const blkIdx = `<ml:apply><ml:indexer />${BLK}<ml:sequence>${BR}${BC}</ml:sequence></ml:apply>`;
    const accum = `<ml:localDefine>${Midx}<ml:apply><ml:plus />${Midx}${blkIdx}</ml:apply></ml:localDefine>`;
    const innerFor = `<ml:for>${BC}<ml:range><ml:real>1</ml:real>${fcall('cols', BLK)}</ml:range><ml:program>${accum}</ml:program></ml:for>`;
    const outerFor = `<ml:for>${BR}<ml:range><ml:real>1</ml:real>${fcall('rows', BLK)}</ml:range><ml:program>${innerFor}</ml:program></ml:for>`;
    return `<ml:localDefine>${BLK}${exprMathML(block)}</ml:localDefine>${outerFor}`;
  }
  // init de ceros del acumulador dentro del programa: M.(r; c) = 0  (fuerza el tamano, el resto auto-cero)
  function initZeros(name, dim) {
    const iv = `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(name)}</ml:id>`;
    const idxr = `<ml:apply><ml:indexer />${iv}<ml:sequence>${exprMathML(dim.r)}${exprMathML(dim.c)}</ml:sequence></ml:apply>`;
    return `<ml:localDefine>${idxr}<ml:real>0</ml:real></ml:localDefine>`;
  }
  // $Repeat{ BODY @ var = a : b }  (loop inline de Calcpad, posiblemente anidado) -> <ml:for> de Mathcad
  function repeatToForML(content) {
    const at = topLevelIndex(content, '@');
    if (at < 0) return assignLocalDefine(content.trim());             // sentencia base
    const rm = content.slice(at + 1).trim().match(/^([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*=\s*(.+?)\s*:\s*(.+)$/);
    if (!rm) return '';
    const idv = `<ml:id labels="VARIABLE" xml:space="preserve">${idContent(rm[1])}</ml:id>`;
    const range = `<ml:range>${exprMathML(rm[2])}${exprMathML(rm[3])}</ml:range>`;
    const body = content.slice(0, at).trim();
    const rep = body.match(/^\$Repeat\s*\{([\s\S]*)\}$/i);
    const innerML = rep ? repeatToForML(rep[1]) : assignLocalDefine(body);
    return `<ml:for>${idv}${range}<ml:program>${innerML}</ml:program></ml:for>`;
  }
  function repeatAccumulator(content) {                                // variable indexada que construye el $Repeat
    const m = content.match(/([A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*)\s*\.\s*[\(A-Za-z0-9_][^=]*?=/);
    return m ? m[1] : 'res';
  }

  function parseCalcpad(text) {
    const g = new Gen();
    // Calcpad es ESTRICTAMENTE 1-based (verificado: A.(0;0) y v.0 dan error en Calcpad).
    // Por eso un script Calcpad valido SIEMPRE es 1-based -> ORIGIN := 1.
    g.defOnly('<ml:define><ml:id labels="VARIABLE" xml:space="preserve">ORIGIN</ml:id><ml:real>1</ml:real></ml:define>');
    // si el script usa spline(...), inyectar las funciones replica (splineVec 1D + splineCp 2D)
    if (/\bspline\s*\(/.test(text)) {
      const sd = splineDefs();
      const mark = g.regions.length, topStart = g.top;
      g.text('Funciones spline (replica del spline de Calcpad — Catmull-Rom monotono):', false, 9);
      g.defOnly(sd.svDef, 500); g.defOnly(sd.scDef, 250);
      g.collapseRegionsFrom(mark, topStart);                            // ocultar plumbing: computan pero no estorban
    }
    if (/\b(sum|extract)\s*\(/.test(text)) {                            // helpers para sum()/extract() de Calcpad
      const se = sumExtractDefs();
      const mark = g.regions.length, topStart = g.top;
      g.defOnly(se.vsumDef, 120); g.defOnly(se.extractDef, 120);
      g.collapseRegionsFrom(mark, topStart);
      g.extractInjected = true;
    }
    const rawLines = text.split(/\r?\n/);
    const lines = [];                                                 // unir continuaciones de linea (terminan en ' _')
    for (let k = 0; k < rawLines.length; k++) {
      let l = rawLines[k];
      while (/\s_\s*$/.test(l) && k + 1 < rawLines.length) l = l.replace(/\s_\s*$/, ' ') + rawLines[++k].trim();
      lines.push(l);
    }
    // renombrar colisiones funcion/variable: Calcpad permite que NAME(i;j) y NAME / NAME.(i;j) coexistan; Mathcad no.
    // -> renombrar la forma FUNCION a NAME_f (def y llamadas), dejando la matriz/variable como NAME.
    (function () {
      const fn = new Set(), vr = new Set();
      for (const l of lines) {
        const t = l.trim();
        let m = t.match(/^([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*)\s*\([^)]*\)\s*=/); if (m) fn.add(m[1]);
        m = t.match(/^([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*)\s*=/); if (m) vr.add(m[1]);
        m = t.match(/^([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*)\s*\.\s*\(/); if (m) vr.add(m[1]);
      }
      const coll = [...fn].filter(n => vr.has(n));
      for (const n of coll) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(?<![\\wα-ωΑ-Ω′″,])' + esc + '\\(', 'g');  // ,w( es cola de nombre N_1,w -> no renombrar
        for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(re, n + '_f(');
      }
    })();
    // pre-escaneo: TODAS las variables globales definidas (incluso dentro de #hide), para detectar
    // colisiones con variables de eje de $Map sin depender del orden de procesamiento.
    g.definedVars = new Set();
    for (const l of lines) {
      // captura variables (name=, name.(), name(args)=) Y nombres de FUNCION (name(...)) -> no usarlos como var de eje
      const m = l.trim().match(/^([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″,]*)\s*(?:\.\s*\(|\(|=)/);
      if (m) g.definedVars.add(m[1]);
    }
    let inSvg = false, hideMark = null, hideTop = 0;                  // estado de bloque #hide (area colapsada)
    let hideHadLoop = false, hideForce = false;                      // hideHadLoop: el bloque #hide contiene un loop; hideForce: doble #hide -> forzar cuadro colapsado
    const macros = {};                                               // macros #def para expansion en sus llamadas
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li], line = raw.trim();
      // bloque SVG (dibujo de malla en Calcpad) -> reemplazar por xyPlot nativo de los nodos x_j vs y_j
      if (!inSvg && /<svg[\s>]/i.test(line)) {
        inSvg = true;
        const na = g.scalars['n_a'], nb = g.scalars['n_b'], a1 = g.scalars['a_1'], b1 = g.scalars['b_1'];
        const vVar = g.dims['z_j'] ? 'z_j' : 'y_j';                    // coordenada vertical (XZ -> z_j, XY -> y_j)
        const deformed = g.dims['xd_j'] && g.dims['zd_j'];            // 2do mesh tras el solve -> malla deformada
        if (na && nb && a1 && b1 && deformed) { g.text('Deformed mesh (in-plane)', true, 11); g.meshPlotDeformed(Math.round(na), Math.round(nb), a1, b1, detectSupportEdges(lines), detectLoad(lines), vVar); }
        else if (na && nb && a1 && b1) { g.text('Mesh (joints)', true, 11); g.meshPlot(Math.round(na), Math.round(nb), a1, b1, detectSupportEdges(lines), detectLoad(lines), vVar); }
        else if (g.dims['x_j'] && g.dims[vVar]) { g.text('Mesh (joints)', true, 11); g.xyPlot('x_j', vVar); }                  // fallback: solo nodos
      }
      if (inSvg) { if (/<\/svg>/i.test(line)) inSvg = false; continue; }  // saltar todo el SVG (texto y loops de dibujo)
      if (/^#def\b/i.test(line)) {                                    // macro Calcpad #def
        const hdr = line.match(/^#def\s+([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*\$?)\s*\(([^)]*)\)\s*(=\s*([\s\S]+))?$/i);
        if (!hdr) { li = collectBlock(lines, li, /^#def\b/i, /^#end\s*def\b/i).end; continue; }
        const rawName = hdr[1], rawParams = hdr[2].split(';').map(s => s.trim()).filter(Boolean);
        const fname = rawName.replace(/\$$/, ''), pnames = rawParams.map(p => p.replace(/\$$/, ''));
        const subst = (l) => { let s = l; rawParams.forEach((rp, k) => { s = s.split(rp).join(pnames[k]); }); return s; };
        const callRepl = (from) => { for (let k = from; k < lines.length; k++) lines[k] = lines[k].split(rawName + '(').join(fname + '('); };
        const singleRHS = hdr[3] ? hdr[4].trim() : null;
        if (singleRHS != null) {                                       // #def f$(x$) = RHS (una linea)
          if (singleRHS[0] === "'" || /<[A-Za-z]/.test(singleRHS))      // dibujo/texto SVG -> expansion inline (no va a Mathcad)
            macros[rawName] = { params: rawParams, body: [singleRHS] };
          else {                                                       // operacion matematica -> FUNCION Mathcad: f(x) := expr
            g.defOnly(g.defFunction(fname, pnames, exprMathML(subst(singleRHS)))); callRepl(li + 1);
          }
          continue;
        }
        const blk = collectBlock(lines, li, /^#def\b/i, /^#end\s*def\b/i);
        if (blk.body.some(l => /^#for\b/i.test(l.trim()))) {           // bloque con #for -> FUNCION-PROGRAMA Mathcad
          const body2 = blk.body.map(subst);
          let resultML = ''; const stmtLines = [];                     // separar el resultado (expresion sola al final) del cuerpo
          for (const bl of body2) { const t = bl.trim(); if (t && t[0] !== '#' && t[0] !== "'" && t[0] !== '"' && t.indexOf('=') < 0) resultML = exprMathML(t); else stmtLines.push(bl); }
          g.defOnly(g.defFunction(fname, pnames, `<ml:program>${buildProgram(stmtLines) + resultML}</ml:program>`)); callRepl(blk.end + 1);
        } else                                                         // bloque de dibujo (line$/circle$...) -> inline
          macros[rawName] = { params: rawParams, body: blk.body };
        li = blk.end;
        continue;
      }
      // llamada a macro NAME$(args) -> expandir (sustituir params$ por args) e insertar las lineas resultantes
      const mcall = line.match(/^([A-Za-zα-ωΑ-Ω_][\wα-ωΑ-Ω′″]*\$)\s*\(([^()]*)\)$/);
      if (mcall && macros[mcall[1]]) {
        const mac = macros[mcall[1]], args = splitTopLevel(mcall[2], ';').map(s => s.trim());
        const expanded = mac.body.map(l => { let s = l; mac.params.forEach((p, k) => { s = s.split(p).join(args[k] != null ? args[k] : ''); }); return s; });
        lines.splice(li + 1, 0, ...expanded);                         // procesar las lineas expandidas a continuacion
        continue;
      }
      if (/^#for\b/i.test(line)) {                                    // grupo de loops -> programa(s) Mathcad
        // recolectar loops consecutivos que comparten acumulador (para que los contadores compartidos persistan)
        const blocks = [], groupAccs = []; const accSet = {}; let cur = li, ub0 = null;
        while (cur < lines.length) {
          const t = lines[cur].trim();
          if (/^#for\b/i.test(t)) {
            const b = collectBlock(lines, cur, /^#for\b/i, /^#loop\b/i);
            const a = findAccumulators(b.body);
            if (a.length === 0) { cur = b.end + 1; continue; }        // loop de visualizacion/efecto -> omitir
            if (blocks.length && !a.some(x => accSet[x])) break;      // ya hay grupo y este no comparte -> cortar
            a.forEach(x => { if (!accSet[x]) { accSet[x] = 1; groupAccs.push(x); } });
            if (ub0 == null) ub0 = (t.match(/:\s*(.+)$/) || [])[1];
            blocks.push({ header: t, body: b.body });
            cur = b.end + 1;
          } else if (t === '' || t === "'") { cur++; }                // saltar solo lineas vacias entre loops
          else break;                                                 // no-loop o #hide/#show -> fin del grupo (no consumir #show)
        }
        if (groupAccs.length === 0) { li = collectBlock(lines, li, /^#for\b/i, /^#loop\b/i).end; continue; }
        const allBody = blocks.flatMap(b => b.body);
        // contadores compartidos: escalares con init reciente, leidos Y escritos en los cuerpos
        let carried = '';
        for (const nm of Object.keys(g.recentScalars)) {
          const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (allBody.some(l => new RegExp('^' + esc + '\\s*=.*' + esc).test(l.trim()))) {
            carried += `<ml:localDefine><ml:id labels="VARIABLE" xml:space="preserve">${idContent(nm)}</ml:id>${g.recentScalars[nm]}</ml:localDefine>`;
            delete g.recentScalars[nm];
          }
        }
        const forML = blocks.map(b => buildFor(b.header, b.body)).join('');
        const n = ub0 ? evalScalar(ub0.trim(), g.scalars) : null;
        // inicializar TODOS los acumuladores del grupo (cada programa los usa, ej. M_j Y el contador c_j)
        let allInit = '';
        for (const a of groupAccs) if (g.matInit[a]) allInit += initZeros(a, g.matInit[a]);
        for (const a of groupAccs) delete g.matInit[a];
        for (const acc of groupAccs) {
          if (n) g.dims[acc] = Math.min(Math.round(n), 40);
          g.loopDefine(acc, carried + allInit + forML);
        }
        if (hideMark != null) hideHadLoop = true;                     // loop dentro de #hide -> marca para no colapsar (salvo doble #hide)
        li = cur - 1;
        continue;
      }
      if (line === '' || line === "'") { g.top += 6; continue; }        // separador
      // $Map{ f(x;y) @ x = a : b & y = c : d } -> contourPlot
      const mapM = line.match(/^\$Map\s*\{\s*([\s\S]+?)\s*@\s*([A-Za-z_]\w*)\s*=\s*([^:]+?)\s*:\s*([\s\S]+?)\s*&\s*([A-Za-z_]\w*)\s*=\s*([^:]+?)\s*:\s*([\s\S]+?)\s*\}$/);
      if (mapM) {
        // los limites de los ejes deben ser NUMERICOS en Mathcad -> evaluar (a->6, b->4); si no, defaults
        const nb = (e, d) => { const v = evalScalar(e.trim(), g.scalars); return v !== null ? v : d; };
        // todos los campos (w, M_x, M_y, M_xy) se grafican NEGADOS -> la superficie va hacia abajo (deflexion fisica)
        const mapFn = mapM[1].trim().startsWith('-') ? mapM[1].trim() : '-' + mapM[1].trim();
        let funcML = funcOrExprMathML(mapFn);
        // Las variables de eje deben ser LIBRES en Mathcad. Si colisionan con un escalar/matriz global
        // (ej. x=0, y=0 en RSlab por los #hide), Mathcad fija x=0 en el trace -> plot vacio/linea.
        // Solucion: renombrar la variable de eje a un nombre libre y emitirla PLANA (sin label-is-contextual).
        const taken = new Set([...(g.definedVars || []), ...Object.keys(g.scalars || {}), ...Object.keys(g.dims || {})]);
        const pool = ['u', 'v', 'uu', 'vv', 'ww', 'pp', 'qq', 'rr'];   // evitar letras-unidad de Mathcad (s=segundo, etc.)
        for (const av of [mapM[2], mapM[5]]) {
          let nm = av;
          if (taken.has(av)) { nm = pool.find(c => !taken.has(c)) || (av + 'p'); taken.add(nm); }
          taken.add(av);
          const esc = av.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // forma etiquetada -> plana con nombre libre
          funcML = funcML.replace(new RegExp('<ml:id labels="VARIABLE" label-is-contextual="true" xml:space="preserve">' + esc + '</ml:id>', 'g'), '<ml:id xml:space="preserve">' + nm + '</ml:id>');
          // forma ya plana (por si acaso) -> nombre libre
          if (nm !== av) funcML = funcML.replace(new RegExp('<ml:id xml:space="preserve">' + esc + '</ml:id>', 'g'), '<ml:id xml:space="preserve">' + nm + '</ml:id>');
        }
        g.contourPlot(funcML, nb(mapM[3], 0), nb(mapM[4], 10), nb(mapM[6], 0), nb(mapM[7], 10));
        continue;
      }
      // $Repeat{ stmt @ var = a : b }  -> loop-programa que construye la matriz/vector
      const repM = line.match(/^\$Repeat\s*\{([\s\S]*)\}$/i);
      if (repM) {
        const forML = repeatToForML(repM[1]);
        if (forML) {
          const acc = repeatAccumulator(repM[1]);
          const ubm = (content => { const at = topLevelIndex(content, '@'); return at >= 0 ? content.slice(at + 1).match(/:\s*(.+)$/) : null; })(repM[1]);
          const n = ubm ? evalScalar(ubm[1].trim(), g.scalars) : null;
          if (n) g.dims[acc] = Math.min(Math.round(n), 40);
          const init = g.matInit[acc] ? initZeros(acc, g.matInit[acc]) : '';
          delete g.matInit[acc];
          g.loopDefine(acc, init + forML);
        }
        continue;
      }
      if (/^#hide\b/i.test(line)) {                                     // inicio de bloque oculto; un 2o #hide seguido = doble -> forzar cuadro colapsado
        if (hideMark != null) hideForce = true;                        // #hide #hide -> el bloque ira a cuadro colapsado aunque sea loop
        else { hideMark = g.regions.length; hideTop = g.top; hideHadLoop = false; hideForce = false; }
        continue;
      }
      if (/^#show\b/i.test(line)) {                                     // fin de bloque #hide
        // Convencion: loop con #hide simple -> programa compacto VISIBLE (no box, ya es compacto en Mathcad).
        //             #hide #hide (doble) -> cuadro colapsado. no-loop con #hide simple -> cuadro colapsado.
        if (hideMark != null) {
          if (hideForce || !hideHadLoop) g.collapseRegionsFrom(hideMark, hideTop);   // colapsar; si fue loop simple, dejar visible
          hideMark = null; hideHadLoop = false; hideForce = false;
        }
        continue;
      }
      if (line[0] === '#') continue;                                    // otras directivas (#noc, etc.) -> omitir
      if (line[0] === '"') { emitText(g, line.replace(/^"/, '').replace(/"$/, '').trim(), true, 14); continue; }
      if (line[0] === "'") {                                           // texto Calcpad: ' alterna texto<->expr
        // segmentos pares = texto, impares = expresion/definicion (puede haber varias por linea)
        const segs = line.slice(1).split("'");
        // intentar texto+math EMBEBIDO en una sola linea (estilo Calcpad)
        const parts = []; let hasMath = false, hasText = false, inlineOk = true;
        for (let i = 0; i < segs.length; i++) {
          if (i % 2 === 0) {                                           // texto
            if (!segs[i].trim()) continue;
            const ct = cleanHtmlText(segs[i], false, 11);
            if (ct.bold) { inlineOk = false; break; }                  // encabezado -> no inline
            if (ct.text.trim()) { parts.push({ text: ct.text }); hasText = true; }
          } else {                                                     // math
            if (!segs[i].trim()) continue;
            const ml = segMathML(g, segs[i]);
            if (!ml) { inlineOk = false; break; }
            parts.push({ ml }); hasMath = true;
          }
        }
        if (inlineOk && hasMath && hasText) { g.textWithMath(parts, 11); continue; }
        // fallback: regiones separadas (comportamiento original)
        segs.forEach((seg, i) => {
          seg = seg.trim();
          if (!seg) return;
          if (i % 2 === 0) emitText(g, seg, false, 11);
          else processMath(g, seg);
        });
        continue;
      }
      processMath(g, line);
    }
    return g.build();
  }
  function processMath(g, line) {
    const eq = line.indexOf('=');
    if (eq < 0) {                                                      // expresion sola -> eval (nombre, indice, func)
      const expr = line.split("'")[0].trim();                         // quitar unidad/comentario inline (ej. x_j'm -> x_j)
      if (g.symMatrices && g.symMatrices.has(expr)) g.ensureSym(expr); // display de K (symmetric) -> simetrizar primero
      if (/^[A-Za-z_α-ωΑ-ΩЀ-ӿ]/.test(expr)) g.evalOnly(expr);
      return;
    }
    const name = line.slice(0, eq).trim(), rhs = line.slice(eq + 1).trim();
    // si el RHS usa una matriz symmetric() como valor (ej. clsolve(K;F)), simetrizarla antes
    if (g.symMatrices) for (const sm of g.symMatrices) {
      if (sm !== name && new RegExp('(?<![\\wα-ωΑ-Ω′″,.])' + sm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\wα-ωΑ-Ω′″])').test(rhs)) g.ensureSym(sm);
    }
    // asignacion indexada de elemento: v.j = rhs  o  M.(i; j) = rhs
    if (/^[A-Za-z_α-ωΑ-Ω][\wα-ωΑ-Ω′″]*\s*\.\s*(?:\(|[A-Za-z0-9_])/.test(name)) {
      g.defOnly(`<ml:define>${exprMathML(name)}${exprMathML(rhs)}</ml:define>`);
      return;
    }
    // definicion de funcion: f(x; y) = expr  (nombre puede tener coma: N_1,w)
    const fnM = name.match(/^([A-Za-z_α-ωΑ-ΩЀ-ӿ][\wα-ωΑ-ΩЀ-ӿ′″₀-ₜᵢ-ᵪⱼ,]*)\s*\(\s*([^()]*?)\s*\)$/);
    if (fnM) {
      const params = fnM[2].split(';').map(s => s.trim()).filter(Boolean);   // Calcpad: args separados por ;
      // estimar filas que devuelve la funcion (params=1) -> altura de display de quien la use
      const saved = g.retScope; g.retScope = Object.assign({}, g.scalars); params.forEach(p => { g.retScope[p] = 1; });
      const rd = retDim(g, rhs); g.retScope = saved;
      if (rd > 1) (g.funcRetDim = g.funcRetDim || {})[fnM[1]] = rd;
      g.defOnly(g.defFunction(fnM[1], params, exprMathML(rhs)));
      return;
    }
    if (!/^[A-Za-zα-ωΑ-ΩЀ-ӿ_][\wα-ωΑ-ΩЀ-ӿ′″₀-ₜᵢ-ᵪⱼ]*$/.test(name)) return;     // no es definicion simple (acepta griego/subindices)
    const initM = rhs.match(/^(vector|matrix|zeros|symmetric|utriang|identity|diagonal)\s*\(([\s\S]*)\)\s*$/i);
    if (initM) {                                                       // init de ceros/matriz -> lo construye el loop; rastrear dimensiones
      const fn = initM[1].toLowerCase(), a = splitTopLevel(initM[2], ';').map(s => s.trim());
      const szEval = evalScalar(a[0], g.scalars);                       // tamano real (n_s->20, n_e->24) para altura de display
      g.dims[name] = szEval ? Math.min(Math.round(szEval), 40) : (g.dims[name] || 8);
      if (fn === 'vector') g.matInit[name] = { r: a[0], c: '1' };
      else if (fn === 'matrix' || fn === 'zeros') g.matInit[name] = { r: a[0], c: a[1] || a[0] };
      else g.matInit[name] = { r: a[0], c: a[0] };                    // symmetric/utriang/identity/diagonal -> n x n
      (g.matDims = g.matDims || {})[name] = g.matInit[name];          // dims persistentes (matInit se borra al consumir el loop)
      if (fn === 'symmetric') (g.symMatrices = g.symMatrices || new Set()).add(name);  // simetrizar tras ensamblaje
      return;
    }
    if (rhs[0] === '[') {
      const p = parseBracket(rhs);
      if (p.vector) { g.dims[name] = p.vector.length; g.defAndEval(g.defVector(name, p.vector), name); }
      else { g.dims[name] = p.matrix.length; g.defAndEval(g.defMatrix(name, p.matrix), name); }
    } else if (isNum(rhs)) {
      g.scalars[name] = parseFloat(rhs);                              // recordar valor para inferir tamano de loops
      g.recentScalars[name] = exprMathML(rhs);                        // contador potencial (init antes de loops)
      g.defAndEval(g.defScalarOrExpr(name, rhs), name);
    } else {
      const v = evalScalar(rhs, g.scalars);                           // si es aritmetica de escalares conocidos, recordar valor
      if (v !== null) g.scalars[name] = v;
      else { const rd = retDim(g, rhs.split("'")[0]); if (rd > 1) g.dims[name] = rd; }  // (sin comentario 'mm) resultado vectorial -> altura
      g.defAndEval(g.defScalarOrExpr(name, rhs), name);               // expresion (m*acc, etc.)
    }
  }

  window.buildMcdxBytes = parseCalcpad;
})();
