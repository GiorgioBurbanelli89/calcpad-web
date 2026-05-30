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

  // ---------- helpers DOM ----------
  const txt = u8 => new TextDecoder('utf-8').decode(u8).replace(/^﻿/, '');
  const kids = (el, name) => Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;
  const elChildren = el => Array.from(el.childNodes).filter(n => n.nodeType === 1);

  // ml:apply -> expresion Calcpad
  const OP = { mult: '*', div: '/', plus: '+', minus: '-', pow: '^' };
  function exprToCalcpad(el, paren) {
    const ln = el.localName;
    if (ln === 'real') return el.textContent.trim();
    if (ln === 'id') return el.textContent.trim();
    // sequence de indices: i, j  ->  "i; j"
    if (ln === 'sequence') return elChildren(el).map(c => exprToCalcpad(c)).join('; ');
    if (ln === 'apply') {
      const ch = elChildren(el), op = ch[0].localName;
      if (op === 'neg') return '-' + exprToCalcpad(ch[1], true);
      // indexer: base[idx] o base[i,j]  ->  base.(idx) / base.(i; j)
      if (op === 'indexer') {
        const base = exprToCalcpad(ch[1], true);
        const idxEl = ch[2];
        const idx = (idxEl && idxEl.localName === 'sequence')
          ? exprToCalcpad(idxEl)
          : ch.slice(2).map(c => exprToCalcpad(c)).join('; ');
        return base + '.(' + idx + ')';
      }
      const sym = OP[op];
      if (sym) {
        const parts = ch.slice(1).map(c => exprToCalcpad(c, true));
        const s = parts.join(' ' + sym + ' ');
        return paren ? '(' + s + ')' : s;
      }
      return ch.slice(1).map(c => exprToCalcpad(c)).join(' ');
    }
    if (ln === 'matrix') return matrixToCalcpad(el);
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
        if (val && val.localName === 'program') { lines.push(indent + exprToCalcpad(target) + ' = ?'); }
        else lines.push(indent + exprToCalcpad(target) + ' = ' + exprToCalcpad(val));
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
    // auto-inicializar vectores/matrices indexados (Calcpad necesita la forma previa)
    const idxRe = /^([\p{L}_][\p{L}\p{N}_]*)\.\(([^)]*)\)\s*=/u;
    const forRe = /^#for\s+\S+\s*=\s*\S+\s*:\s*(\S+)/u;
    const sizeMatch = lines.map(l => l.trim().match(forRe)).find(Boolean);
    const N = sizeMatch ? sizeMatch[1] : '0';
    const seen = new Set(), inits = [];
    for (const l of lines) {
      const m = l.trim().match(idxRe);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        const ndim = m[2].split(';').length;
        inits.push(m[1] + ' = ' + (ndim >= 2 ? 'matrix(' + N + '; ' + N + ')' : 'vector(' + N + ')'));
      }
    }
    let firstFor = lines.findIndex(l => l.trim().startsWith('#for'));
    if (firstFor < 0) firstFor = lines.length;
    const all = lines.slice(0, firstFor).concat(inits, lines.slice(firstFor));
    if (ret) all.push(name + ' = ' + exprToCalcpad(ret));
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

  // procesa una <region> (math/text/Area) y agrega lineas Calcpad
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
    const math = kid(region, 'math');
    if (math) { const e = mathToCalcpad(math); if (e) out.push(pre + e); }
  }

  // <math> -> linea Calcpad (define / eval)
  function mathToCalcpad(math) {
    const def = kid(math, 'define');
    if (def) {
      const ch = elChildren(def), name = ch[0].textContent.trim(), val = ch[1];
      if (val.localName === 'program') return expandProgram(val, name);
      if (val.localName === 'matrix') return name + ' = ' + matrixToCalcpad(val);
      if (val.localName === 'real') return name + ' = ' + val.textContent.trim();
      return name + ' = ' + exprToCalcpad(val);
    }
    const ev = kid(math, 'eval');
    if (ev) { const id = kid(ev, 'id'); if (id) return id.textContent.trim(); }
    return '';
  }

  async function mcdxToCalcpad(buf) {
    const zip = await readZip(buf);
    const wsU8 = zip.get('mathcad/worksheet.xml'); if (!wsU8) throw new Error('no hay worksheet.xml');
    const ws = new DOMParser().parseFromString(txt(wsU8), 'application/xml');
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
    return out.join('\n');
  }

  window.mcdxToCalcpad = mcdxToCalcpad;
})();
