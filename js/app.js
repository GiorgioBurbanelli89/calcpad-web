let API_URL = 'api/convert';
let parserMode = 'calcpad'; // 'calcpad' | 'matlab' (Lab) | 'symbolic'

// --- Selector de dialecto (lista): Calcpad FEM / Calcpad Lab / Calcpad Symbolic ---
// Symbolic renderiza por el mismo motor de Calcpad (maneja $Slope/$Area/#noc); Lab usa el parser JS MATLAB.
const MODES = [
    { id: 'calcpad',  label: 'Calcpad FEM',      api: 'api/convert',        cls: null,       ph: 'Escribe expresiones Calcpad aqui...',                  idx: 'examples/index.json' },
    { id: 'matlab',   label: 'Calcpad Lab',      api: 'api/convert-matlab', cls: 'lab',      ph: '% Escribe codigo MATLAB aqui...',                      idx: 'examples/index-lab.json' },
    { id: 'symbolic', label: 'Calcpad Symbolic', api: 'api/convert',        cls: 'symbolic', ph: "' Codigo Calcpad-Symbolic ($Slope, $Area, #noc)...",   idx: 'examples/index.json' },
];
const modeSelect = document.getElementById('modeSelect');
function setMode(id, loadIdx) {
    const m = MODES.find(x => x.id === id) || MODES[0];
    parserMode = m.id;
    API_URL = m.api;
    if (modeSelect) {
        modeSelect.value = m.id;
        modeSelect.classList.remove('lab', 'symbolic');
        if (m.cls) modeSelect.classList.add(m.cls);
    }
    textarea.placeholder = m.ph;
    // cambiar de modo NO sobrescribe el editor; los ejemplos siguen en el desplegable
    if (loadIdx !== false) switchExampleIndex(m.idx);
    updateLineNumbers();
    statusMsg.textContent = 'Modo: ' + m.label;
}
if (modeSelect) modeSelect.addEventListener('change', () => {
    const fromMode = parserMode;              // dialecto ACTUAL (antes de cambiar)
    const toMode = modeSelect.value;          // 'calcpad' | 'matlab' | 'symbolic'
    const fromD = fromMode === 'matlab' ? 'lab' : fromMode;   // el traductor usa 'lab', no 'matlab'
    const toD = toMode === 'matlab' ? 'lab' : toMode;
    // Traducir el script al nuevo dialecto (Calcpad <-> Lab <-> Symbolic)
    if (fromD !== toD && textarea.value.trim() && typeof window.translateDialect === 'function') {
        try { textarea.value = window.translateDialect(textarea.value, fromD, toD); }
        catch (e) { statusMsg.textContent = 'Error al traducir: ' + e.message; }
    }
    setMode(toMode, false);                   // cambiar modo sin recargar el indice de ejemplos
    if (typeof convertToHtml === 'function') convertToHtml(true);   // re-renderizar el script traducido
});

// --- Traductor de dialectos (Calcpad puro / Symbolic / Lab) ---
// Detecta el dialecto de origen del texto actual por heuristica.
function detectDialect(src) {
    const lines = src.split(/\r?\n/);
    // El modo activo manda primero
    if (parserMode === 'matlab') return 'lab';
    if (parserMode === 'symbolic') return 'symbolic';
    // Lab/MATLAB por contenido: comentarios %, 'for..end'/'function..end' sin #
    if (/^\s*%/.test(src) || /^\s*function\b/m.test(src) || (/^\s*for\b.*=/m.test(src) && !/^\s*#for\b/m.test(src) && /^\s*end\b/m.test(src))) return 'lab';
    // Symbolic por contenido: #svg / #sym / operador & / $Slope / $Area
    if (/^\s*#svg\b/m.test(src) || /^\s*#sym\b/m.test(src) || /\s&\s/.test(src) || /\$Slope\b/.test(src) || /\$Area\b/.test(src)) return 'symbolic';
    return 'calcpad';
}

const translateTo = document.getElementById('translateTo');
if (translateTo) translateTo.addEventListener('change', () => {
    const to = translateTo.value;
    translateTo.value = '';                       // reset el selector
    if (!to) return;
    if (typeof window.translateDialect !== 'function') { statusMsg.textContent = 'Traductor no cargado'; return; }
    const src = textarea.value;
    const from = detectDialect(src);
    if (from === to) { statusMsg.textContent = `Ya esta en ${to}`; return; }
    try {
        const out = window.translateDialect(src, from, to);
        textarea.value = out;
        // ajustar el modo de render al dialecto destino (lab->matlab; calcpad/symbolic igual nombre)
        setMode(to === 'lab' ? 'matlab' : to, false);
        updateLineNumbers();
        if (typeof convertToHtml === 'function') convertToHtml(true);
        statusMsg.textContent = `Traducido ${from} → ${to}`;
    } catch (e) {
        statusMsg.textContent = 'Error al traducir: ' + e.message;
    }
});

async function switchExampleIndex(indexUrl) {
    exampleSelect.innerHTML = '<option value="">-- Ejemplos --</option>';
    try {
        const res = await fetch(indexUrl);
        if (!res.ok) return;
        const index = await res.json();
        populateExamples(exampleSelect, index);
    } catch {}
}

// DOM refs
const textarea = document.getElementById('calcpadInput');
const lineNumbersEl = document.getElementById('lineNumbers');

// --- Line numbers ---
function updateLineNumbers() {
    const lines = textarea.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= lines; i++) html += i + '\n';
    lineNumbersEl.textContent = html;
}
textarea.addEventListener('input', updateLineNumbers);
textarea.addEventListener('scroll', () => { lineNumbersEl.scrollTop = textarea.scrollTop; });
setTimeout(updateLineNumbers, 0);
const resultFrame = document.getElementById('resultFrame');
const exampleSelect = document.getElementById('exampleSelect');
const btnAutorun = document.getElementById('btnAutorun');
const btnConvert = document.getElementById('btnConvert');
const btnClear = document.getElementById('btnClear');
const btnComplex = document.getElementById('btnComplex');
const settingDecimals = document.getElementById('settingDecimals');
const settingDegrees = document.getElementById('settingDegrees');
const statusMsg = document.getElementById('statusMsg');
const lineInfo = document.getElementById('lineInfo');
const convertTime = document.getElementById('convertTime');

// State
let autorun = true;
let isComplex = false;
let lastLine = -1;
let lastText = '';
let convertTimer = null;
let isConverting = false;
let currentFileName = '';
let currentGroup = '';

function getSettings() {
    return {
        decimals: parseInt(settingDecimals.value) || 4,
        degrees: parseInt(settingDegrees.value),
        isComplex: isComplex
    };
}

// --- Complex toggle ---
btnComplex.addEventListener('click', () => {
    isComplex = !isComplex;
    btnComplex.textContent = isComplex ? 'Complex' : 'Real';
    btnComplex.classList.toggle('btn-complex-on', isComplex);
    convertToHtml(false);
});

// Settings changes trigger reconvert
settingDecimals.addEventListener('change', () => convertToHtml(false));
settingDegrees.addEventListener('change', () => convertToHtml(false));

// --- Examples ---
async function initExamples() {
    const index = await loadExampleIndex();
    if (index) populateExamples(exampleSelect, index);
}

exampleSelect.addEventListener('change', async () => {
    const path = exampleSelect.value;
    if (!path) return;

    // Extract folder from path (e.g. "Mechanics/Finite Elements/file.cpd" → "Mechanics/Finite Elements")
    const parts = path.split('/');
    parts.pop();
    currentGroup = parts.join('/');
    currentFileName = path.split('/').pop().replace(/\.cpd$/, '');

    statusMsg.textContent = 'Cargando ejemplo...';
    const content = await loadExampleFile(path);
    if (content) {
        textarea.value = content;
        localStorage.setItem('calcpadFemInput', content);
        lastText = content;
        updateLineNumbers();
        const loaded = await loadPreRendered(path);
        if (!loaded) convertToHtml(true);
    } else {
        statusMsg.textContent = 'Error cargando ejemplo';
        statusMsg.className = 'error';
    }
});

// --- Autorun ---
btnAutorun.addEventListener('click', () => {
    autorun = !autorun;
    btnAutorun.classList.toggle('btn-active', autorun);
    statusMsg.textContent = autorun ? 'Autorun ON' : 'Autorun OFF';
});

// --- Convert ---
btnConvert.addEventListener('click', () => convertToHtml(false));

// --- New ---
const btnNew = document.getElementById('btnNew');
btnNew.addEventListener('click', () => {
    textarea.value = '';
    currentFileName = '';
    currentGroup = '';
    lastText = '';
    lastLine = -1;
    localStorage.removeItem('calcpadFemInput');
    exampleSelect.value = '';
    resultFrame.innerHTML = '<div class="empty-state"><span>Escribe codigo y presiona Convertir</span><kbd>Ctrl + Enter</kbd></div>';
    statusMsg.textContent = 'Nuevo documento';
    statusMsg.className = '';
    convertTime.textContent = '';
    textarea.focus();
});

// --- Clear ---
btnClear.addEventListener('click', () => {
    textarea.value = '';
    localStorage.removeItem('calcpadFemInput');
    resultFrame.innerHTML = '<div class="empty-state"><span>Escribe codigo y presiona Convertir</span><kbd>Ctrl + Enter</kbd></div>';
    statusMsg.textContent = 'Limpiado';
    convertTime.textContent = '';
});

// --- PDF ---
const btnPdf = document.getElementById('btnPdf');
btnPdf.addEventListener('click', printOutput);

// --- Exportar a Mathcad Prime (.mcdx) ---
const btnMathcad = document.getElementById('btnMathcad');
btnMathcad.addEventListener('click', () => {
    try {
        if (!window.buildMcdxBytes) throw new Error('motor .mcdx no cargado');
        const bytes = window.buildMcdxBytes(textarea.value || '');
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'calcpad.mcdx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        statusMsg.textContent = 'Exportado a Mathcad (.mcdx) -> Descargas';
    } catch (e) {
        statusMsg.textContent = 'Error exportando a Mathcad: ' + e.message;
        console.error(e);
    }
});

function printOutput() {
    const iframe = resultFrame.querySelector('iframe');
    if (!iframe || !iframe.contentWindow) {
        statusMsg.textContent = 'Primero ejecuta la conversion';
        statusMsg.className = 'error';
        return;
    }
    // Remove the line-link arrows before printing
    try {
        iframe.contentDocument.querySelectorAll('a[title^="Linea"]').forEach(a => a.remove());
    } catch {}
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
}

// --- Keyboard ---
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        convertToHtml(false);
    }
    if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        printOutput();
    }
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        doSave();
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        doSaveAs();
    }
    if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        fileInput.click();
    }
});

textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 4;
    }
});

// --- Cursor tracking (autorun on line change) ---
function getLineNumber() {
    const text = textarea.value.substring(0, textarea.selectionStart);
    return text.split('\n').length;
}

function updateLineInfo() {
    const ln = getLineNumber();
    const total = textarea.value.split('\n').length;
    lineInfo.textContent = `Ln ${ln}/${total}`;
}

function onCursorMove() {
    updateLineInfo();
    if (!autorun) return;

    const currentLine = getLineNumber();
    const currentText = textarea.value;

    if (currentLine !== lastLine && lastLine !== -1 && currentText !== lastText) {
        lastLine = currentLine;
        lastText = currentText;
        localStorage.setItem('calcpadFemInput', currentText);
        scheduleConvert();
    } else {
        lastLine = currentLine;
    }
}

function scheduleConvert() {
    if (convertTimer) clearTimeout(convertTimer);
    convertTimer = setTimeout(() => {
        if (!isConverting) convertToHtml(true);
    }, 400);
}

textarea.addEventListener('keyup', onCursorMove);
textarea.addEventListener('mouseup', onCursorMove);
// Autorun también al escribir (debounced), no solo al cambiar de línea — así
// tras "Nuevo" o en un documento de una sola línea los resultados aparecen.
textarea.addEventListener('input', () => {
    updateLineInfo();
    if (!autorun) return;
    lastText = textarea.value;
    localStorage.setItem('calcpadFemInput', textarea.value);
    scheduleConvert();
});

// --- Line navigation: click [N] in output → jump to line N in input ---
function goToLine(lineNum) {
    const lines = textarea.value.split('\n');
    if (lineNum < 1 || lineNum > lines.length) return;
    let pos = 0;
    for (let i = 0; i < lineNum - 1; i++) pos += lines[i].length + 1;
    textarea.focus();
    textarea.setSelectionRange(pos, pos + lines[lineNum - 1].length);
    // Scroll to center the line in view
    const lineHeight = textarea.scrollHeight / lines.length;
    const targetScroll = Math.max(0, (lineNum - 1) * lineHeight - textarea.clientHeight / 2);
    textarea.scrollTop = targetScroll;
    updateLineInfo();
    // Flash highlight
    textarea.style.transition = 'background 0.3s';
    textarea.style.background = '#fffbe6';
    setTimeout(() => { textarea.style.background = ''; textarea.style.transition = ''; }, 400);
}

// Search output text in source and jump to best matching line
function findAndGoToLine(outputText) {
    if (!outputText) return;
    const lines = textarea.value.split('\n');
    // Clean the output text: strip units, extra spaces
    const clean = outputText.replace(/\s+/g, ' ').trim().toLowerCase();
    // Try to find a line that contains key parts of the output text
    // Extract variable names and numbers from the output
    const keywords = clean.match(/[a-zα-ωΑ-Ω_][a-zα-ωΑ-Ω0-9_]*/g) || [];
    const firstKeyword = keywords[0] || '';

    let bestLine = -1;
    let bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
        const srcClean = lines[i].replace(/'/g, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!srcClean) continue;
        // Score: count how many keywords match
        let score = 0;
        for (const kw of keywords) {
            if (srcClean.includes(kw)) score++;
        }
        // Bonus for first keyword match
        if (firstKeyword && srcClean.includes(firstKeyword)) score += 2;
        // Bonus for exact substring match
        if (srcClean.includes(clean.substring(0, 20))) score += 5;
        if (score > bestScore) {
            bestScore = score;
            bestLine = i + 1;
        }
    }
    if (bestLine > 0) goToLine(bestLine);
}

function addMapTooltips(iframe) {
    try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        // Make SVG overlays work: position them over the preceding img.plot
        const svgs = doc.querySelectorAll('svg');
        svgs.forEach(svg => {
            const circles = svg.querySelectorAll('circle[fill="transparent"]');
            if (circles.length === 0) return;
            // Find preceding img.plot
            let prev = svg.previousElementSibling;
            while (prev && !prev.classList.contains('plot')) prev = prev.previousElementSibling;
            if (!prev) return;
            // Wrap img + svg in a relative container
            const wrapper = doc.createElement('div');
            wrapper.style.cssText = 'position:relative;display:inline-block;';
            prev.parentNode.insertBefore(wrapper, prev);
            wrapper.appendChild(prev);
            svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:all;';
            wrapper.appendChild(svg);
            // Make circles bigger hit targets
            circles.forEach(c => { c.setAttribute('r', '12'); c.style.cursor = 'crosshair'; });
        });
        // Add tooltip CSS
        const style = doc.createElement('style');
        style.textContent = 'circle[fill="transparent"]:hover{fill:rgba(255,255,0,0.3);stroke:rgba(0,0,0,0.5);stroke-width:1;}';
        doc.head.appendChild(style);
    } catch(e) { console.warn('[mapTooltips]', e); }
}

function addLineLinks(iframe) {
    try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        if (doc.body.dataset.lineLinksAdded) return;
        doc.body.dataset.lineLinksAdded = '1';

        var css = doc.createElement('style');
        css.textContent = '.line-arrow{color:#0ea5e9;text-decoration:none;font-size:13px;cursor:pointer;visibility:hidden;margin-left:4px;}.line:hover .line-arrow{visibility:visible;}.line:hover{background:#f0f9ff;}.lineLink{color:#b0e0ff !important;visibility:hidden;}.line:hover .lineLink{visibility:visible;}';
        doc.head.appendChild(css);

        doc.querySelectorAll('.line').forEach(function(el) {
            var lineId = el.id;
            if (!lineId || !lineId.startsWith('line-')) return;
            var lineNum = parseInt(lineId.split('-')[1]);
            if (isNaN(lineNum)) return;

            // Remove template's lineLink if exists, add our own
            el.querySelectorAll('.lineLink').forEach(function(old) { old.remove(); });

            var a = doc.createElement('a');
            a.href = '#';
            a.className = 'line-arrow';
            a.textContent = ' ← L' + lineNum;
            a.title = 'Ir a linea ' + lineNum;
            el.appendChild(a);
            a.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                el.style.background = '#dbeafe';
                setTimeout(function() { el.style.background = ''; }, 500);
                goToLine(lineNum);
            });
        });

        console.log('[lineLinks] done, .line elements:', doc.querySelectorAll('.line').length);
    } catch (e) {
        console.error('[lineLinks]', e);
    }
}

// --- Local parser (browser-side, instant) ---
function convertLocal(input) {
    const t0 = performance.now();
    let result;
    try {
        // Calcpad Lab → parser MATLAB (% comments, ';' suprime); FEM → Calcpad.
        result = CalcpadParser.evalCalcpad(input, parserMode === 'matlab' ? 'matlab' : 'calcpad');
    } catch (e) {
        console.warn('[local] parser crashed, falling back to CLI:', e.message);
        return false; // signal: fall back to CLI
    }
    const elapsed = Math.round(performance.now() - t0);

    // CSS real de Calcpad (template-calcpad.css, copia exacta del repo) + extras del editor web
    const cssUrl = new URL('template-calcpad.css?v=3', document.baseURI).href;
    const css = `
        /* resultados en negro como Calcpad (solo las variables/nombres van en azul) */
        .val { color:#000; font-weight:400; }
        .cmt { color:#475569; }
        .muted { opacity:0.5; font-size:0.85em; font-style:italic; }
        /* valores de matriz/vector en negro, como Calcpad (no heredan el azul de .val) */
        .matrix .td { color:#000; font-weight:400; }
        /* vector horizontal estilo Calcpad: corchetes [ ] (b0) + valores espaciados, negros */
        .cp-vecm[data-h="1"] { color:#000; font-weight:400; }
        .cp-vecm[data-h="1"] .vnum { padding:0 0.35em; }
        .cp-vecm[data-h="1"] .b0 { color:#000; }
        /* control de orientacion (horizontal / vertical) — discreto al lado del vector */
        .cp-orient { color:#94a3b8; cursor:pointer; user-select:none; font-size:0.8em; margin-left:2pt; vertical-align:middle; text-decoration:none; }
        .cp-orient:hover { color:#0ea5e9; }
        /* grip en el vertice (esquina) para alargar / acortar arrastrando */
        .cp-gripwrap { position:relative; display:inline-block; vertical-align:middle; }
        .cp-grip { position:absolute; right:-4px; bottom:-4px; width:12px; height:12px; cursor:nwse-resize; z-index:5; }
        .cp-grip::after { content:''; position:absolute; right:1px; bottom:1px; border-left:9px solid transparent; border-bottom:9px solid #0ea5e9; opacity:0.5; }
        .cp-grip:hover::after { opacity:1; }
        .cphide { display:none !important; }
        .matrix .tr.cp-lastvis .td:first-child, .matrix .tr.cp-lastvis .td:last-child { border-bottom:solid 1pt #222; }
    `;
    let html = '';
    for (const b of result.blocks) {
        try {
            switch (b.kind) {
                case 'heading':
                    html += `<h3>${b.text}</h3>`;
                    break;
                case 'comment':
                    html += `<p class="cmt">${b.text}</p>`;
                    break;
                case 'assignment': {
                    const display = typeof b.text === 'string' && b.text.startsWith('<') ? b.text : escHtml(String(b.text));
                    const exprT = String(b.expr).trim();
                    // literal (numero o [vector/matriz]): Calcpad NO repite -> "nombre = valor"
                    const isLiteral = /^[-+]?[\d.]+(?:[eE][-+]?\d+)?$/.test(exprT) || /^\[[\s\S]*\]$/.test(exprT);
                    if (isLiteral) {
                        html += `<p class="eq"><var>${escHtml(b.name)}</var> = <span class="val">${display}</span></p>`;
                    } else {
                        // forma simbolica + (substituida si hay variables) + valor, como Calcpad
                        const eh = b.exprHtml || escHtml(b.expr);
                        const es = b.exprSubHtml || eh;
                        const mid = (es && es !== eh) ? ` = ${es}` : '';
                        html += `<p class="eq"><var>${escHtml(b.name)}</var> = ${eh}${mid} = <span class="val">${display}</span></p>`;
                    }
                    break;
                }
                case 'value': {
                    const display = typeof b.text === 'string' && b.text.startsWith('<') ? b.text : escHtml(String(b.text));
                    html += `<p class="eq"><var>${escHtml(b.name)}</var> = <span class="val">${display}</span></p>`;
                    break;
                }
                case 'error':
                    html += `<p class="err">[${b.line}] ${escHtml(b.message)}</p>`;
                    break;
                case 'plot': case 'fem3d': case 'svg':
                    if (b.html) html += b.html;
                    else html += `<p class="muted">[grafica]</p>`;
                    break;
                default:
                    if (b.text) html += `<p>${b.text}</p>`;
            }
        } catch (renderErr) {
            html += `<p class="err">${escHtml(renderErr.message)}</p>`;
        }
    }

    const errCount = result.errors.length;
    const banner = errCount > 0
        ? `<div style="padding:6px 12px;background:#fef3c7;color:#92400e;font-size:0.8rem;border-bottom:1px solid #fde68a;">${errCount} error(es) — ver consola</div>`
        : '';
    if (errCount > 0) console.warn('[local] errors:', result.errors);

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';
    resultFrame.innerHTML = '';
    resultFrame.appendChild(iframe);
    const expandJs = `<script>(function(){
      var VEC_INIT=12, MAT_INIT=6;
      function rows(m){ return Array.prototype.filter.call(m.children,function(c){return c.classList&&c.classList.contains('tr');}); }
      // estilo Calcpad: vector HORIZONTAL con corchetes tipograficos [ ] (b0) y valores en linea;
      // VERTICAL como matriz columna con corchetes rectangulares escalables.
      function vecHtml(vals, horizontal){
        if(horizontal){
          var h='<span class="cp-vecm" data-h="1"><b class="b0">[</b>';
          for(var i=0;i<vals.length;i++) h+='<span class="vnum">'+vals[i]+'</span>';
          h+='<b class="b0">]</b></span>';
          return h;
        }
        var o='<span class="matrix cp-vecm" data-h="0">';
        for(var j=0;j<vals.length;j++) o+='<span class="tr"><span class="td"></span><span class="td">'+vals[j]+'</span><span class="td"></span></span>';
        o+='</span>';
        return o;
      }
      function readVals(vm){
        if(vm.getAttribute('data-h')==='1') return Array.prototype.slice.call(vm.querySelectorAll('.vnum')).map(function(t){return t.innerHTML;});
        return rows(vm).map(function(tr){var t=tr.querySelectorAll('.td');return t[1]?t[1].innerHTML:'';});
      }
      // mostrar solo 'n' filas (matriz / vector vertical)
      function setRows(m, n){
        var trs=rows(m);
        trs.forEach(function(tr){ tr.classList.remove('cp-lastvis'); });
        trs.forEach(function(tr,i){ tr.classList.toggle('cphide', i>=n); });
        if(n<trs.length && n>0) trs[n-1].classList.add('cp-lastvis');
      }
      // mostrar solo 'n' elementos de un vector horizontal (b0)
      function setCols(vm, n){
        Array.prototype.slice.call(vm.querySelectorAll('.vnum')).forEach(function(el,i){ el.classList.toggle('cphide', i>=n); });
      }
      // adjunta un grip en el vertice; al arrastrar cambia cuantos elementos/filas se muestran
      function addGrip(target, total, kind){
        var wrap=document.createElement('span'); wrap.className='cp-gripwrap';
        target.replaceWith(wrap); wrap.appendChild(target);
        var grip=document.createElement('span'); grip.className='cp-grip'; grip.title='arrastrar para alargar / acortar';
        wrap.appendChild(grip);
        var shown=Math.min(total, kind==='mat'?MAT_INIT:VEC_INIT);
        function apply(){
          if(kind==='vecH') setCols(target, shown); else setRows(target, shown);
        }
        apply();
        grip.addEventListener('mousedown', function(e){
          e.preventDefault();
          var sx=e.clientX, sy=e.clientY, s0=shown;
          var horiz=(kind==='vecH');
          function mm(ev){
            var d = horiz ? (ev.clientX-sx)/26 : (ev.clientY-sy)/19;
            shown=Math.max(1, Math.min(total, Math.round(s0+d)));
            apply();
          }
          function mu(){ document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); }
          document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu);
        });
        return wrap;
      }
      function plainName(vr){ return vr.textContent.replace(/⃗/g,'').trim(); }
      function addArrow(vr){ if(vr.querySelector('.vec')) return; var a=document.createElement('span'); a.className='vec'; a.textContent='⃗'; vr.insertBefore(a, vr.firstChild); }
      function enhance(){
        var vecNames={};
        document.querySelectorAll('.matrix:not(.cp-done)').forEach(function(m){
          m.classList.add('cp-done');
          var trs=rows(m); if(!trs.length) return;
          var dataCols=trs[0].querySelectorAll('.td').length-2;
          if(dataCols===1 && trs.length>1){
            // VECTOR: horizontal por defecto + boton orientar + grip si es largo
            var pEl=m.closest('p');
            var vals=trs.map(function(tr){var t=tr.querySelectorAll('.td');return t[1]?t[1].innerHTML:'';});
            var sp=document.createElement('span'); sp.innerHTML=vecHtml(vals,true); var vm=sp.firstChild; vm.classList.add('cp-done');
            m.replaceWith(vm);
            // registrar el nombre del vector (para marcar TODAS sus apariciones con flecha)
            if(pEl){ var vr=pEl.querySelector('var'); if(vr) vecNames[plainName(vr)]=1; }
            var anchor=vm;
            if(vals.length>VEC_INIT) anchor=addGrip(vm, vals.length, 'vecH');
            var ob=document.createElement('a'); ob.className='cp-orient'; ob.title='horizontal / vertical'; ob.textContent='⇅';
            anchor.insertAdjacentElement('afterend', ob);
          } else if(dataCols>=2 && trs.length>MAT_INIT){
            // MATRIZ alta: grip en el vertice para mostrar mas/menos filas
            addGrip(m, trs.length, 'mat');
          }
        });
        // flecha v⃗ en TODAS las apariciones de cada variable-vector (como Calcpad)
        var names=Object.keys(vecNames).filter(function(n){return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);});
        if(names.length){
          // 1) las que ya son <var>
          document.querySelectorAll('.eq var').forEach(function(vr){
            if(vecNames[plainName(vr)]) addArrow(vr);
          });
          // 2) las que aparecen como texto plano dentro de una expresion (ej. "v + v")
          var re=new RegExp('(^|[^A-Za-z0-9_⃗])('+names.join('|')+')(?![A-Za-z0-9_])','g');
          document.querySelectorAll('.eq').forEach(function(eq){
            Array.prototype.slice.call(eq.childNodes).forEach(function(node){
              if(node.nodeType===3 && node.nodeValue && re.test(node.nodeValue)){
                re.lastIndex=0;
                var holder=document.createElement('span');
                holder.innerHTML=node.nodeValue.replace(re,function(m,pre,nm){ return pre+'<var><span class="vec">⃗</span>'+nm+'</var>'; });
                node.replaceWith.apply(node, Array.prototype.slice.call(holder.childNodes));
              }
            });
          });
        }
      }
      enhance();
      document.addEventListener('click',function(e){
        var or=e.target.closest&&e.target.closest('.cp-orient'); if(!or) return;
        var prev=or.previousElementSibling;
        var wrap = (prev.classList&&prev.classList.contains('cp-gripwrap')) ? prev : null;
        var vm = wrap ? wrap.querySelector('.cp-vecm') : (prev.classList&&prev.classList.contains('cp-vecm')?prev:null);
        if(!vm) return;
        var vals=readVals(vm);
        var newHoriz = vm.getAttribute('data-h')!=='1';   // alternar
        var sp=document.createElement('span'); sp.innerHTML=vecHtml(vals,newHoriz); var nv=sp.firstChild; nv.classList.add('cp-done');
        (wrap||vm).replaceWith(nv);
        or.remove();
        var anchor=nv;
        if(vals.length>VEC_INIT) anchor=addGrip(nv, vals.length, newHoriz?'vecH':'vecV');
        var nob=document.createElement('a'); nob.className='cp-orient'; nob.title='horizontal / vertical'; nob.textContent='⇅';
        anchor.insertAdjacentElement('afterend', nob);
      });
    })();<\/script>`;
    iframe.contentDocument.open();
    iframe.contentDocument.write(`<!DOCTYPE html><html><head><link rel="stylesheet" href="${cssUrl}"><style>${css}</style></head><body>${banner}${html}${expandJs}</body></html>`);
    iframe.contentDocument.close();

    statusMsg.textContent = `OK (local${errCount ? ', ' + errCount + ' err' : ''})`;
    statusMsg.className = errCount ? '' : 'success';
    convertTime.textContent = `${elapsed} ms`;
    return true; // success
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// --- CLI API call (full render with Calcpad template) ---
async function convertCli(input) {
    const settings = getSettings();
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input, settings, folder: currentGroup })
    });
    if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
    return await response.text();
}

// Envuelve el HtmlResult del motor WASM con el CSS de Calcpad (igual que HtmlApplyWorksheet del CLI).
let __cpTemplateCss;
async function wrapCalcpadHtml(body) {
    if (__cpTemplateCss === undefined) {
        try { __cpTemplateCss = await (await fetch('template-calcpad.css')).text(); }
        catch { __cpTemplateCss = ''; }
    }
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + __cpTemplateCss +
        '</style></head><body>' + (body || '') + '</body></html>';
}

// --- Unified convert: auto uses local parser, manual uses CLI ---
async function convertToHtml(auto) {
    const input = textarea.value.trim();
    if (!input) return;

    isConverting = true;

    btnConvert.disabled = true;
    btnConvert.textContent = '...';
    statusMsg.textContent = 'Convirtiendo...';
    statusMsg.className = '';
    resultFrame.innerHTML = '<div class="loading-state"><span>Calculando...</span></div>';

    const t0 = performance.now();

    try {
        let htmlContent;
        let mode = 'local';
        // Calcpad Lab (.m) -> parser JS (el motor WASM es Calcpad.Core, no MATLAB)
        if (parserMode === 'matlab') {
            if (convertLocal(input)) {
                isConverting = false; btnConvert.disabled = false; btnConvert.textContent = 'Convertir';
                return;
            }
            throw new Error('Parser Lab no pudo procesar');
        }
        // Calcpad / Symbolic -> MOTOR WASM real (mismo motor local y web, sin backend).
        // Fallbacks: CLI del server (si esta), luego parser JS.
        if (window.calcpadWasm && window.calcpadWasm.ready) {
            htmlContent = await wrapCalcpadHtml(window.calcpadWasm.convert(input));
            mode = 'WASM';
        } else {
            try {
                htmlContent = await convertCli(input);
                mode = 'CLI';
            } catch {
                if (convertLocal(input)) {
                    isConverting = false; btnConvert.disabled = false; btnConvert.textContent = 'Convertir';
                    return;
                }
                throw new Error('Parser local no pudo procesar la expresion');
            }
        }
        const elapsed = Math.round(performance.now() - t0);

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';
        resultFrame.innerHTML = '';
        resultFrame.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(htmlContent);
        iframe.contentDocument.close();
        iframe.addEventListener('load', () => addLineLinks(iframe));
        setTimeout(() => addLineLinks(iframe), 200);

        localStorage.setItem('calcpadFemInput', input);
        statusMsg.textContent = `OK (${mode})`;
        statusMsg.className = 'success';
        convertTime.textContent = `${elapsed} ms`;
        updateMacroPanel(input);
    } catch (error) {
        const elapsed = Math.round(performance.now() - t0);
        statusMsg.textContent = `Error: ${error.message}`;
        statusMsg.className = 'error';
        convertTime.textContent = `${elapsed} ms`;
        resultFrame.innerHTML = `<div style="padding:1rem;color:#b91c1c;background:#fef2f2;margin:0.5rem;border-radius:0.3rem;font-size:0.8rem;"><strong>Error:</strong> ${error.message}</div>`;
    } finally {
        btnConvert.disabled = false;
        btnConvert.textContent = 'Convertir';
        isConverting = false;
    }
}

// --- File operations ---
const btnOpen = document.getElementById('btnOpen');
const btnSave = document.getElementById('btnSave');
const btnSaveAs = document.getElementById('btnSaveAs');
const btnSaveDef = document.getElementById('btnSaveDef');
const fileInput = document.getElementById('fileInput');

// ABRIR — load .cpd from disk
btnOpen.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const finish = (text) => {
        textarea.value = text;
        currentFileName = file.name.replace(/\.(cpd|mcdx)$/i, '');
        currentGroup = '';
        lastText = textarea.value;
        localStorage.setItem('calcpadFemInput', textarea.value);
        statusMsg.textContent = `Abierto: ${file.name}`;
        statusMsg.className = 'success';
        convertToHtml(true);
    };
    if (/\.mcdx$/i.test(file.name)) {                 // Mathcad Prime -> Calcpad
        if (!window.mcdxToCalcpad) { statusMsg.textContent = 'Importador .mcdx no cargado'; return; }
        file.arrayBuffer()
            .then(buf => window.mcdxToCalcpad(buf))
            .then(finish)
            .catch(err => { statusMsg.textContent = 'Error importando .mcdx: ' + err.message; console.error(err); });
    } else {
        const reader = new FileReader();
        reader.onload = () => finish(reader.result);
        reader.readAsText(file);
    }
    fileInput.value = '';
});

// GUARDAR — save to current name, or prompt if new
async function doSave() {
    const content = textarea.value.trim();
    if (!content) { statusMsg.textContent = 'Nada que guardar'; return; }
    if (!currentFileName) return doSaveAs();
    await saveToServer(currentFileName, currentGroup, content);
}

// Librería de funciones Calcpad-Lab (cp*) — se descarga junto al script .m si lo usa.
const CP_LAB_LIB = "% calcpad_lab_lib.m — funciones que replican los $-constructs de Calcpad en MATLAB.\n" +
"% Incluí este archivo con tu script Lab para que cpSlope/cpArea/cpPlot/cpMap funcionen.\n\n" +
"function d = cpSlope(f, x0)\n    h = max(1e-7, abs(x0)*1e-7);\n    d = (f(x0+h) - f(x0-h)) / (2*h);\nend\n\n" +
"function A = cpArea(f, a, b, n)\n    if nargin < 4, n = 200; end\n    if mod(n,2)==1, n = n+1; end\n    h = (b-a)/n; x = a:h:b; y = arrayfun(f, x);\n    A = h/3 * (y(1) + y(end) + 4*sum(y(2:2:end-1)) + 2*sum(y(3:2:end-2)));\nend\n\n" +
"function cpPlot(f, a, b)\n    x = linspace(a,b,300); y = arrayfun(f,x);\n    figure; plot(x,y,'LineWidth',1.5); grid on; xlabel('x'); ylabel('f(x)');\nend\n\n" +
"function cpMap(f, x0, x1, y0, y1, n)\n    if nargin < 6, n = 40; end\n    [X,Y] = meshgrid(linspace(x0,x1,n), linspace(y0,y1,n));\n    Z = arrayfun(f, X, Y);\n    figure; contourf(X,Y,Z,20); colorbar; axis equal; xlabel('x'); ylabel('y');\nend\n";

function downloadFile(name, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// Si el script (modo Lab) usa funciones cp*, descargar TAMBIÉN la librería (2º archivo).
function maybeDownloadLib(content) {
    if (parserMode === 'matlab' && /\bcp(Slope|Area|Plot|Map|Surf)\s*\(/.test(content)) {
        downloadFile('calcpad_lab_lib.m', CP_LAB_LIB);
        return true;
    }
    return false;
}

// GUARDAR COMO — native file picker (File System Access API) or fallback download
async function doSaveAs() {
    const content = textarea.value.trim();
    if (!content) { statusMsg.textContent = 'Nada que guardar'; return; }

    const ext = parserMode === 'matlab' ? '.m' : '.cpd';
    const fileName = (currentFileName || 'documento') + ext;

    const accept = parserMode === 'matlab'
        ? { description: 'Calcpad Lab (MATLAB)', accept: { 'text/plain': ['.m'] } }
        : { description: 'Calcpad', accept: { 'text/plain': ['.cpd'] } };
    // Try native "Save As" dialog (Chrome/Edge)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [accept] });
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            currentFileName = handle.name.replace(/\.(cpd|m)$/, '');
            const lib = maybeDownloadLib(content);   // 2º archivo: la librería de funciones
            statusMsg.textContent = `Guardado: ${handle.name}` + (lib ? ' + calcpad_lab_lib.m' : '');
            statusMsg.className = 'success';
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }

    // Fallback: trigger download
    downloadFile(fileName, content);
    const lib = maybeDownloadLib(content);           // 2º archivo: la librería de funciones
    statusMsg.textContent = `Descargado: ${fileName}` + (lib ? ' + calcpad_lab_lib.m' : '');
    statusMsg.className = 'success';
}

async function saveToServer(name, group, content) {
    statusMsg.textContent = 'Guardando...';
    try {
        const res = await fetch('api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, group, content })
        });
        if (!res.ok) throw new Error(await res.text());
        statusMsg.textContent = `Guardado: ${name}.cpd`;
        statusMsg.className = 'success';
        exampleSelect.innerHTML = '<option value="">-- Ejemplos --</option>';
        await initExamples();
    } catch (e) {
        statusMsg.textContent = `Error: ${e.message}`;
        statusMsg.className = 'error';
    }
}

btnSave.addEventListener('click', doSave);
btnSaveAs.addEventListener('click', doSaveAs);

// #DEF — extract #def blocks and save each as .cpd incluible
btnSaveDef.addEventListener('click', async () => {
    const content = textarea.value;
    const defs = extractDefs(content);
    if (defs.length === 0) {
        statusMsg.textContent = 'No se encontraron bloques #def';
        statusMsg.className = 'error';
        return;
    }
    const folder = prompt(`Se encontraron ${defs.length} macro(s). Carpeta para guardar:`, 'Macros');
    if (!folder) return;

    let saved = 0;
    for (const def of defs) {
        try {
            await saveToServer(def.name, folder, def.body);
            saved++;
        } catch {}
    }
    statusMsg.textContent = `${saved}/${defs.length} macros guardadas en ${folder}/`;
    statusMsg.className = 'success';
});

function extractDefs(src) {
    const defs = [];
    const lines = src.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        // Inline: #def name$(args) = ...
        const inlineMatch = line.match(/^#def\s+([A-Za-z_][A-Za-z0-9_]*)\$?\s*\(/);
        if (inlineMatch && line.includes('=') && !line.match(/#end\s+def/i)) {
            defs.push({ name: inlineMatch[1], body: lines[i] });
            i++; continue;
        }
        // Block: #def name$(args) ... #end def
        const blockMatch = line.match(/^#def\s+([A-Za-z_][A-Za-z0-9_]*)\$?\s*\(/);
        if (blockMatch) {
            const name = blockMatch[1];
            const start = i;
            i++;
            while (i < lines.length && !lines[i].trim().match(/^#end\s+def/i)) i++;
            const body = lines.slice(start, i + 1).join('\n');
            defs.push({ name, body });
            i++; continue;
        }
        i++;
    }
    return defs;
}

// --- Load pre-rendered HTML for an example path ---
async function loadPreRendered(cpdPath) {
    const basePath = cpdPath.replace(/\.(cpd|m)$/, '');
    const htmlPath = 'examples/' + (basePath + '.html').split('/').map(encodeURIComponent).join('/');
    try {
        const res = await fetch(htmlPath);
        if (!res.ok) return false;
        const html = await res.text();
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';
        resultFrame.innerHTML = '';
        resultFrame.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(html);
        iframe.contentDocument.close();
        iframe.addEventListener('load', () => {
            try {
                addLineLinks(iframe);
                addMapTooltips(iframe);
            } catch(e) { console.warn('[lineLinks]', e); }
        });
        statusMsg.textContent = 'OK (pre-rendered)';
        statusMsg.className = 'success';
        return true;
    } catch { return false; }
}

// --- Init ---
window.onload = async function () {
    console.log('[init] starting...');
    await initExamples();

    try {
        console.log('[init] loading default example:', DEFAULT_EXAMPLE_PATH);
        const defaultContent = await loadExampleFile(DEFAULT_EXAMPLE_PATH);
        if (defaultContent) {
            textarea.value = defaultContent;
            currentFileName = 'Mesa Torsion DKE Completo';
            currentGroup = 'Mechanics/Finite Elements';
            console.log('[init] loaded', defaultContent.length, 'chars');
        }
    } catch (e) {
        console.error('[init] error loading default:', e);
    }

    lastText = textarea.value;
    updateLineInfo();
    updateLineNumbers();
    // Try pre-rendered first, then fallback to convert
    if (textarea.value.trim()) {
        const loaded = await loadPreRendered(DEFAULT_EXAMPLE_PATH);
        if (!loaded) convertToHtml(true);
    }
};
