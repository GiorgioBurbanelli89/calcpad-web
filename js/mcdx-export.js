/* Export Calcpad -> Mathcad Prime (.mcdx), 100% en el navegador (DOM, sin libs).
   Usa window.MCDX_PARTS (partes OPC fijas de la plantilla, ver mcdx-parts.js).
   Expone: window.buildMcdxBytes(calcpadText) -> Uint8Array (.mcdx). */
(function () {
  'use strict';

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

  // ---------- mini parser de expresiones (shunting-yard) -> MathML ----------
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  const OPEL = { '+': 'plus', '-': 'minus', '*': 'mult', '/': 'div', '^': 'pow' };
  function tokenize(s) {
    const t = []; const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[+\-*/^()·])/g; let m;
    while ((m = re.exec(s))) t.push(m[1] === '·' ? '*' : m[1]);
    return t;
  }
  function idRef(n) { return `<ml:id labels="VARIABLE" label-is-contextual="true" xml:space="preserve">${esc(n)}</ml:id>`; }
  function exprMathML(s) {
    const out = [], ops = [], toks = tokenize(s);
    const apply = op => { const b = out.pop(), a = out.pop(); out.push(`<ml:apply><ml:${OPEL[op]}/>${a}${b}</ml:apply>`); };
    for (const tk of toks) {
      if (/^[A-Za-z_]/.test(tk)) out.push(idRef(tk));
      else if (/^\d/.test(tk)) out.push(`<ml:real>${tk}</ml:real>`);
      else if (tk === '(') ops.push(tk);
      else if (tk === ')') { while (ops.length && ops[ops.length - 1] !== '(') apply(ops.pop()); ops.pop(); }
      else { const r = tk === '^'; while (ops.length && ops[ops.length - 1] !== '(' && (PREC[ops[ops.length - 1]] > PREC[tk] || (!r && PREC[ops[ops.length - 1]] === PREC[tk]))) apply(ops.pop()); ops.push(tk); }
    }
    while (ops.length) apply(ops.pop());
    return out.length === 1 ? out[0] : (out[0] || '<ml:real>0</ml:real>');
  }

  // ---------- generador .mcdx ----------
  function Gen() {
    this.regions = []; this.rels = []; this.xaml = {}; this.rid = 0; this.ref = 0; this.fd = 0; this.top = 30;
  }
  Gen.prototype.idDef = function (n) { return `<ml:id labels="VARIABLE" xml:space="preserve">${esc(n)}</ml:id>`; };
  Gen.prototype.mathRegion = function (body, top, left, w, h) {
    const id = this.rid++, r = this.ref++;
    return `<region region-id="${id}" actualWidth="${w || 220}" actualHeight="${h || 40}" top="${top}" left="${left}"><math resultRef="${r}">${body}</math></region>`;
  };
  Gen.prototype.evalBody = function (n) { return `<ml:eval>${idRef(n)}<ml:unitOverride><ml:placeholder /></ml:unitOverride></ml:eval>`; };
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
  Gen.prototype.text = function (s, bold, size) {
    size = size || 11; this.fd++;
    const relid = 'Rtext' + this.fd, target = `/mathcad/xaml/FlowDocument${this.fd}.XamlPackage`;
    const fw = bold ? 'Bold' : 'Normal';
    const id = this.rid++;
    this.regions.push(`<region region-id="${id}" width="650" actualWidth="650" actualHeight="${(size * 1.7).toFixed(1)}" top="${this.top}" left="19.2"><text item-idref="${relid}"><FlowDocument FontFamily="Euclid" FontStyle="Normal" FontWeight="${fw}" FontSize="${size}" Foreground="#FF000000" TextAlignment="Left" xml:lang="es-es" Typography.Variants="Normal" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" /></text></region>`);
    this.rels.push(`<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/flowDocument" Target="${target}" Id="${relid}" />`);
    const doc = `<Section xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xml:space="preserve" TextAlignment="Left" xml:lang="es-es" FontFamily="Euclid" FontStyle="Normal" FontWeight="${fw}" FontSize="${size}" Foreground="#FF000000"><Paragraph><Run xml:lang="es-es" FontWeight="${fw}">${esc(s)}</Run></Paragraph></Section>`;
    const ct = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xaml" ContentType="application/vnd.ms-wpf.xaml+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /></Types>';
    const rels = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/wpf/2005/10/xaml/entry" Target="/Xaml/Document.xaml" Id="Rentry${this.fd}" /></Relationships>`;
    this.xaml[`mathcad/xaml/FlowDocument${this.fd}.XamlPackage`] = zipStore([
      { name: 'Xaml/Document.xaml', bytes: ENC.encode(doc) },
      { name: '_rels/.rels', bytes: ENC.encode(rels) },
      { name: '[Content_Types].xml', bytes: ENC.encode(ct) }]);
    this.top += size * 2.6 + 22;
  };
  Gen.prototype.defAndEval = function (body, name) {
    this.regions.push(this.mathRegion(body, this.top, 19.2));
    this.regions.push(this.mathRegion(this.evalBody(name), this.top, 320));
    this.top += 70;
  };
  Gen.prototype.defOnly = function (body) { this.regions.push(this.mathRegion(body, this.top, 19.2)); this.top += 60; };
  Gen.prototype.evalOnly = function (name) { this.regions.push(this.mathRegion(this.evalBody(name), this.top, 19.2)); this.top += 60; };

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

  function parseCalcpad(text) {
    const g = new Gen();
    const lines = text.split(/\r?\n/);
    for (let raw of lines) {
      const line = raw.trim();
      if (line === '' || line === "'") { g.top += 12; continue; }      // separador
      if (line[0] === '#') continue;                                    // directivas (#hide/#noc) -> TODO
      if (line[0] === '"') { g.text(line.replace(/^"/, '').replace(/"$/, '').trim(), true, 14); continue; }
      if (line[0] === "'") {                                           // texto (y posible expr inline)
        const m = line.match(/^'([^']*)'?\s*(.*)$/);
        const txt = (m ? m[1] : line.slice(1)).trim();
        if (txt) g.text(txt, false, 11);
        const rest = m ? m[2].trim() : '';
        if (rest) processMath(g, rest);
        continue;
      }
      processMath(g, line);
    }
    return g.build();
  }
  function processMath(g, line) {
    const eq = line.indexOf('=');
    if (eq < 0) {                                                      // solo nombre -> eval
      if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(line)) g.evalOnly(line);
      return;
    }
    const name = line.slice(0, eq).trim(), rhs = line.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;                // no es definicion simple
    if (rhs[0] === '[') {
      const p = parseBracket(rhs);
      if (p.vector) g.defAndEval(g.defVector(name, p.vector), name);
      else g.defAndEval(g.defMatrix(name, p.matrix), name);
    } else if (isNum(rhs)) {
      g.defAndEval(g.defScalarOrExpr(name, rhs), name);
    } else {
      g.defAndEval(g.defScalarOrExpr(name, rhs), name);               // expresion (m*acc, etc.)
    }
  }

  window.buildMcdxBytes = parseCalcpad;
})();
