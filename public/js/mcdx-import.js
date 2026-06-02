/* Import Mathcad Prime (.mcdx) -> Calcpad, en el navegador (sin libs).
   Descomprime el OPC (ZIP, deflate via DecompressionStream), parsea worksheet.xml
   (MathML) y reconstruye texto Calcpad. Expone window.mcdxToCalcpad(arrayBuffer). */
(function () {
  'use strict';

  // ---------- ZIP reader (store + deflate) ----------
  const dv = (u8, o) => u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24);
  const wv = (u8, o) => u8[o] | (u8[o + 1] << 8);

  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(buf) {                 // buf: ArrayBuffer -> Map<name, Uint8Array>
    const u8 = new Uint8Array(buf), map = new Map();
    // localizar EOCD
    let eo = u8.length - 22;
    while (eo >= 0 && dv(u8, eo) !== 0x06054b50) eo--;
    if (eo < 0) throw new Error('ZIP invalido (sin EOCD)');
    const count = wv(u8, eo + 10); let cd = dv(u8, eo + 16);
    for (let i = 0; i < count; i++) {
      if (dv(u8, cd) !== 0x02014b50) break;
      const method = wv(u8, cd + 10), csize = dv(u8, cd + 20);
      const nlen = wv(u8, cd + 28), elen = wv(u8, cd + 30), clen = wv(u8, cd + 32);
      const lho = dv(u8, cd + 42);
      const name = new TextDecoder().decode(u8.subarray(cd + 46, cd + 46 + nlen));
      // datos via local header
      const lnlen = wv(u8, lho + 26), lelen = wv(u8, lho + 28);
      const dstart = lho + 30 + lnlen + lelen;
      const raw = u8.subarray(dstart, dstart + csize);
      map.set(name, method === 8 ? await inflateRaw(raw) : raw.slice());
      cd += 46 + nlen + elen + clen;
    }
    return map;
  }

  // Calcpad es SIEMPRE 1-based. Si el .mcdx declara ORIGIN := 0, sus indices son 0-based
  // -> al importar hay que sumar 1 a cada indice para que cuadre con Calcpad.
  let ORIGIN_ZERO = false;
  function shiftIndex(s) {                  // indice 0-based -> 1-based para Calcpad
    s = String(s).trim();
    if (/^\d+$/.test(s)) return String(+s + 1);          // literal -> +1
    return '(' + s + ' + 1)';                            // expresion -> (expr + 1)
  }

  // ---------- helpers DOM ----------
  const txt = u8 => new TextDecoder('utf-8').decode(u8).replace(/^﻿/, '');
  const kids = (el, name) => Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;
  const elChildren = el => Array.from(el.childNodes).filter(n => n.nodeType === 1);

  // lee un <ml:id> manejando subindices: <Span>N<pw:Subscript>ele</pw:Subscript></Span> -> N_ele
  // Convierte apostrofes de Mathcad a caracteres prime que Calcpad acepta: '' -> ″, ' -> ′
  function idText(el) {
    let out = '';
    const walk = node => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) { if (c.localName === 'Subscript') out += '_' + c.textContent; else walk(c); }
      }
    };
    walk(el);
    return out.trim().replace(/''/g, '″').replace(/'/g, '′');
  }
  // <ml:lambda><ml:boundVars>VAR</ml:boundVars>BODY</ml:lambda> -> {varName, body}
  function lambdaParts(lambda) {
    const bv = kid(lambda, 'boundVars');
    const varName = bv ? elChildren(bv).map(c => idText(c)).join('; ') : 'x';
    const bodyEl = elChildren(lambda).find(c => c.localName !== 'boundVars');
    return { varName, body: bodyEl ? exprToCalcpad(bodyEl) : '' };
  }
  // objetivo de un define: nombre simple o funcion name(args)
  function targetToCalcpad(el) {
    if (el.localName === 'function') {
      const nm = idText(kid(el, 'id'));
      const bv = kid(el, 'boundVars');
      const args = bv ? elChildren(bv).map(c => idText(c)).join('; ') : '';
      return nm + '(' + args + ')';
    }
    return exprToCalcpad(el);
  }

  // ml:apply -> expresion Calcpad
  const OP = { mult: '*', div: '/', plus: '+', minus: '-', pow: '^' };
  function exprToCalcpad(el, paren) {
    const ln = el.localName;
    if (ln === 'real') return el.textContent.trim();
    if (ln === 'id') return idText(el);
    if (ln === 'parens') return '(' + exprToCalcpad(elChildren(el)[0]) + ')';
    if (ln === 'sequence') return elChildren(el).map(c => exprToCalcpad(c)).join('; ');
    if (ln === 'matrix') return matrixToCalcpad(el);
    if (ln === 'lambda') return lambdaParts(el).body;
    if (ln === 'apply') {
      const ch = elChildren(el), opEl = ch[0], op = opEl.localName;
      if (op === 'neg') return '-' + exprToCalcpad(ch[1], true);
      if (op === 'transpose') return 'transp(' + exprToCalcpad(ch[1]) + ')';
      if (op === 'indexer') {
        const base = exprToCalcpad(ch[1], true);
        const idxEl = ch[2];
        let parts = (idxEl && idxEl.localName === 'sequence')
          ? elChildren(idxEl).map(c => exprToCalcpad(c))
          : ch.slice(2).map(c => exprToCalcpad(c));
        if (ORIGIN_ZERO) parts = parts.map(shiftIndex);    // 0-based mcdx -> 1-based Calcpad (+1)
        return base + '.(' + parts.join('; ') + ')';
      }
      // integral definida -> $Area{ body @ var = lo : hi }
      if (op === 'integral') {
        const lam = ch.find(c => c.localName === 'lambda');
        const lo = ch.find(c => c.localName === 'lowerBound');
        const hi = ch.find(c => c.localName === 'upperBound');
        const { varName, body } = lam ? lambdaParts(lam) : { varName: 'x', body: '' };
        const a = lo ? exprToCalcpad(elChildren(lo)[0]) : '0', b = hi ? exprToCalcpad(elChildren(hi)[0]) : '1';
        return '$Area{' + body + ' @ ' + varName + ' = ' + a + ' : ' + b + '}';
      }
      // derivada -> $Slope (pendiente en el punto)
      if (op === 'derivative') {
        const lam = ch.find(c => c.localName === 'lambda');
        const { varName, body } = lam ? lambdaParts(lam) : { varName: 'x', body: '' };
        return '$Slope{' + body + ' @ ' + varName + ' = ' + varName + '}';
      }
      // llamada a funcion: <ml:id [labels=FUNCTION]>name</ml:id> args...
      if (op === 'id') {
        const fname = idText(opEl);
        const argEls = ch.slice(1);
        const args = (argEls.length === 1 && argEls[0].localName === 'sequence') ? exprToCalcpad(argEls[0]) : argEls.map(c => exprToCalcpad(c)).join('; ');
        return fname + '(' + args + ')';
      }
      const sym = OP[op];
      if (sym) {
        const s = ch.slice(1).map(c => exprToCalcpad(c, true)).join(' ' + sym + ' ');
        return paren ? '(' + s + ')' : s;
      }
      return ch.slice(1).map(c => exprToCalcpad(c)).join(' ');
    }
    return el.textContent.trim();
  }

  // ml:program (define con bucle) -> lineas Calcpad #for/#loop
  // Empuja statements a `lines`; devuelve el nodo de valor de retorno (o null).
  function programBody(prog, lines, indent) {
    let ret = null;
    for (const st of elChildren(prog)) {
      const n = st.localName;
      if (n === 'localDefine') {
        const dch = elChildren(st), target = dch[0], val = dch[1];
        if (val && val.localName === 'program') { lines.push(indent + targetToCalcpad(target) + ' = ?'); }
        else lines.push(indent + targetToCalcpad(target) + ' = ' + exprToCalcpad(val));
      } else if (n === 'for') {
        const fch = elChildren(st);
        const v = exprToCalcpad(fch[0]);
        const range = fch.find(x => x.localName === 'range');
        const rch = range ? elChildren(range) : [];
        const lo = rch[0] ? exprToCalcpad(rch[0]) : '1';
        const hi = rch[1] ? exprToCalcpad(rch[1]) : '1';
        lines.push(indent + '#for ' + v + ' = ' + lo + ' : ' + hi);
        const inner = fch.find(x => x.localName === 'program');
        if (inner) programBody(inner, lines, indent + '\t');
        lines.push(indent + '#loop');
      } else {
        ret = st; // expresion suelta = valor de retorno del programa
      }
    }
    return ret;
  }

  // expande <ml:program> a un bloque Calcpad, asignado a `name`
  function expandProgram(prog, name) {
    const lines = [];
    const ret = programBody(prog, lines, '');
    const idxRe = /^([\p{L}_][\p{L}\p{N}_]*)\.\(([^)]*)\)\s*=/u;
    const zeroInitRe = /^([\p{L}_][\p{L}\p{N}_]*)\.\(([^)]*)\)\s*=\s*0$/u;     // X.(..) = 0 -> init de ceros (se descarta)
    const forRe = /^#for\s+\S+\s*=\s*\S+\s*:\s*(\S+)/u;
    const sizeMatch = lines.map(l => l.trim().match(forRe)).find(Boolean);
    const N = sizeMatch ? sizeMatch[1] : '0';
    let firstFor = lines.findIndex(l => l.trim().startsWith('#for'));
    if (firstFor < 0) firstFor = lines.length;
    const loopLines = lines.slice(firstFor);
    // auto-init de acumuladores indexados: las dims salen de las ESCRITURAS dentro del bucle
    // (a.(i) -> vector(N); K.(i;j) -> matrix(N;N)). NO del init de ceros (que puede venir como N;1).
    const seen = new Set(), inits = [];
    for (const l of loopLines) {
      const m = l.trim().match(idxRe);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        const ndim = m[2].split(';').length;
        inits.push(m[1] + ' = ' + (ndim >= 2 ? 'matrix(' + N + '; ' + N + ')' : 'vector(' + N + ')'));
      }
    }
    // defs = lineas pre-bucle, descartando los init-de-ceros de un acumulador (los cubre el auto-init).
    const defs = lines.slice(0, firstFor).filter(l => { const z = l.trim().match(zeroInitRe); return !(z && seen.has(z[1])); });
    const all = defs.slice();
    if (inits.length || loopLines.length) {
      all.push('#hide');
      all.push(...inits);      // matrices/vectores de ceros — ocultos
      all.push(...loopLines);  // el bucle — oculto
      all.push('#show');
    }
    // resultado: si el retorno ES el propio acumulador (ret == name), el bucle ya lo define -> no emitir "a = a".
    if (ret) { const r = exprToCalcpad(ret); if (r !== name) all.push(name + ' = ' + r); }
    return all.join('\n');
  }

  // ml:matrix -> Calcpad. Vector (Nx1 o 1xN) -> "[a; b; c]" (elementos con ;).
  // Matriz (R>1 y C>1) -> "[a; b | c; d]" (; = columnas dentro de fila, | = filas).
  // Los hijos vienen column-major.
  function matrixToCalcpad(mEl) {
    const R = +mEl.getAttribute('rows'), C = +mEl.getAttribute('cols');
    const cells = elChildren(mEl).map(c => c.localName === 'real' ? c.textContent.trim() : exprToCalcpad(c));
    // vector: una sola columna o una sola fila -> un solo grupo separado por ';'
    if (C === 1 || R === 1) return '[' + cells.join('; ') + ']';
    const rows = [];
    for (let i = 0; i < R; i++) { const row = []; for (let j = 0; j < C; j++) row.push(cells[j * R + i]); rows.push(row.join('; ')); }
    return '[' + rows.join(' | ') + ']';
  }

  // texto de un FlowDocument.XamlPackage (zip interno store)
  async function xamlText(zip, target) {
    const path = target.replace(/^\//, '');
    const pkg = zip.get(path) || zip.get('mathcad/xaml/' + path.split('/').pop());
    if (!pkg) return { text: '', bold: false };
    const inner = await readZip(pkg.buffer.slice(pkg.byteOffset, pkg.byteOffset + pkg.byteLength));
    const docU8 = inner.get('Xaml/Document.xaml'); if (!docU8) return { text: '', bold: false };
    const doc = new DOMParser().parseFromString(txt(docU8), 'application/xml');
    const runs = doc.getElementsByTagName('Run');
    let s = '', bold = false;
    for (const r of runs) { s += r.textContent; if ((r.getAttribute('FontWeight') || '') === 'Bold') bold = true; }
    const sec = doc.getElementsByTagName('Section')[0];
    if (sec && (sec.getAttribute('FontWeight') === 'Bold' || +(sec.getAttribute('FontSize') || 0) >= 13)) bold = true;
    return { text: s.trim(), bold };
  }

  // descendientes por localName (ignora namespaces)
  function descByLocal(el, name) {
    const out = [];
    const walk = n => { for (const c of elChildren(n)) { if (c.localName === name) out.push(c); else walk(c); } };
    walk(el);
    return out;
  }
  // <plot> / <chartComponent> -> $Plot / $Map de Calcpad
  function plotToCalcpad(plotEl) {
    if (plotEl.localName === 'chartComponent') return "'[grafica avanzada OLE — no convertible a Calcpad]";
    const inner = elChildren(plotEl).find(c => /Plot$|plot3D/.test(c.localName));
    if (!inner) return '';
    const type = inner.localName;
    // funcion: primer plotEquation/math cuyo contenido no sea placeholder
    let fn = '';
    for (const eq of descByLocal(inner, 'plotEquation')) {
      for (const m of elChildren(eq).filter(c => c.localName === 'math')) {
        const c0 = elChildren(m)[0];
        if (c0 && c0.localName !== 'placeholder') { fn = exprToCalcpad(c0); break; }
      }
      if (fn) break;
    }
    const ax = (nm) => { const a = descByLocal(inner, nm)[0]; return a ? (a.getAttribute('start') + ' : ' + a.getAttribute('end')) : '0 : 1'; };
    if (type === 'xyPlot') return fn ? '$Plot{' + fn + ' @ x = ' + ax('xAxis') + '}' : "'[grafica $Plot sin funcion (placeholder)]";
    if (type === 'contourPlot' || type === 'plot3D') return fn ? '$Map{' + fn + ' @ x = ' + ax('xAxis') + ' & y = ' + ax('yAxis') + '}' : "'[grafica " + (type === 'plot3D' ? 'superficie 3D' : 'mapa') + " $Map sin funcion (placeholder)]";
    if (type === 'polarPlot') return "'[grafica polar — Calcpad no tiene equivalente directo]";
    return '';
  }

  // procesa una <region> (math/text/Area/plot) y agrega lineas Calcpad
  async function handleRegion(region, zip, rels, out, indent) {
    const pre = indent || '';
    const area = kid(region, 'Area');
    if (area) {
      out.push('#hide');
      const inner = kid(area, 'regions');
      if (inner) for (const r of kids(inner, 'region')) await handleRegion(r, zip, rels, out, pre);
      out.push('#show');
      return;
    }
    const tnode = kid(region, 'text');
    if (tnode) {
      const idref = tnode.getAttribute('item-idref');
      const target = rels[idref];
      const t = target ? await xamlText(zip, target) : { text: '', bold: false };
      let line = (t.bold ? '"' : "'") + t.text;
      // math embebida dentro del texto
      const emb = kid(tnode, 'regions');
      if (emb) {
        for (const r of kids(emb, 'region')) {
          const m = kid(r, 'math'); if (m) { const e = mathToCalcpad(m); if (e) line += ' ' + e; }
        }
      }
      out.push(line);
      return;
    }
    const plot = kid(region, 'plot') || kid(region, 'chartComponent');
    if (plot) { const e = plotToCalcpad(plot); if (e) out.push(pre + e); return; }
    const math = kid(region, 'math');
    if (math) { const e = mathToCalcpad(math); if (e) out.push(pre + e); }
  }

  // <math> -> linea Calcpad (define / eval)
  function mathToCalcpad(math) {
    const def = kid(math, 'define');
    if (def) {
      const ch = elChildren(def), name = targetToCalcpad(ch[0]);
      let val = ch[1];
      // name = eval(program)  -> el programa esta envuelto en <ml:eval>
      if (val && val.localName === 'eval') {
        const prog = kid(val, 'program');
        if (prog) return expandProgram(prog, name);
        const inner = elChildren(val)[0];
        if (inner) val = inner;
      }
      if (val.localName === 'program') return expandProgram(val, name);
      if (val.localName === 'matrix') return name + ' = ' + matrixToCalcpad(val);
      if (val.localName === 'real') return name + ' = ' + val.textContent.trim();
      return name + ' = ' + exprToCalcpad(val);
    }
    const ev = kid(math, 'eval');
    if (ev) {                                              // eval de cualquier expresion (id, indice, funcion...)
      const content = elChildren(ev).find(c => c.localName !== 'unitOverride');
      if (content) return exprToCalcpad(content);
    }
    return '';
  }

  async function mcdxToCalcpad(buf) {
    const zip = await readZip(buf);
    const wsU8 = zip.get('mathcad/worksheet.xml'); if (!wsU8) throw new Error('no hay worksheet.xml');
    const wsText = txt(wsU8);
    // detectar ORIGIN := 0 en el mcdx -> activar shift +1 al importar a Calcpad (1-based)
    ORIGIN_ZERO = />ORIGIN<\/ml:id>\s*<ml:real>\s*0\s*<\/ml:real>/.test(wsText);
    const ws = new DOMParser().parseFromString(wsText, 'application/xml');
    // relaciones idref -> target (FlowDocument)
    const rels = {};
    const relU8 = zip.get('mathcad/_rels/worksheet.xml.rels');
    if (relU8) {
      const rdoc = new DOMParser().parseFromString(txt(relU8), 'application/xml');
      for (const r of rdoc.getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
    }
    const regionsEl = ws.getElementsByTagName('regions')[0];
    const out = [];
    if (regionsEl) {
      // solo regiones top-level (hijas directas de <regions> raiz)
      for (const r of Array.from(regionsEl.childNodes).filter(n => n.nodeType === 1 && n.localName === 'region'))
        await handleRegion(r, zip, rels, out, '');
    }
    // Calcpad no usa ORIGIN -> quitar esa linea (los indices ya quedaron 1-based)
    return out.filter(l => !/^\s*ORIGIN\s*=/.test(l)).join('\n');
  }

  window.mcdxToCalcpad = mcdxToCalcpad;
})();
