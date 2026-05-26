const API_URL = '/api/convert';

// DOM refs
const textarea = document.getElementById('calcpadInput');
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
        convertToHtml(true);
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
textarea.addEventListener('input', updateLineInfo);

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

function addLineLinks(iframe) {
    try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        if (doc.body.dataset.lineLinksAdded) return;
        doc.body.dataset.lineLinksAdded = '1';

        // Pure vanilla JS line arrows — no jQuery needed
        var css = doc.createElement('style');
        css.textContent = '.line-arrow{color:#0ea5e9;text-decoration:none;font-size:13px;cursor:pointer;visibility:hidden;margin-left:4px;}.line:hover .line-arrow{visibility:visible;}.line:hover{background:#f0f9ff;}';
        doc.head.appendChild(css);

        doc.querySelectorAll('.line').forEach(function(el) {
            var a = doc.createElement('a');
            a.href = '#';
            a.className = 'line-arrow';
            a.textContent = '←';
            el.appendChild(a);
            a.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                el.style.background = '#dbeafe';
                setTimeout(function() { el.style.background = ''; }, 500);
                var ratio = el.offsetTop / (doc.body.scrollHeight || 1);
                textarea.scrollTop = Math.max(0, ratio * textarea.scrollHeight - textarea.clientHeight / 2);
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
        result = CalcpadParser.evalCalcpad(input);
    } catch (e) {
        console.warn('[local] parser crashed, falling back to CLI:', e.message);
        return false; // signal: fall back to CLI
    }
    const elapsed = Math.round(performance.now() - t0);

    // Render blocks as simple HTML
    const css = `
        body { font-family: 'Georgia Pro','Century Schoolbook','Times New Roman',serif; font-size:11pt; margin:5mm; max-width:190mm; color:#222; }
        h3 { font-family:'Arial Nova',Helvetica,sans-serif; color:#0f172a; border-bottom:2px solid #0ea5e9; padding-bottom:2px; margin:14px 0 6px; }
        .eq var { color:#06d; font-style:italic; }
        .eq b { font-weight:600; }
        .val { color:#0284c7; }
        .err { color:#b91c1c; background:#fee2e2; padding:4px 8px; border-radius:3px; font-family:monospace; margin:4px 0; font-size:0.85em; }
        .cmt { color:#475569; }
        p { margin:3px 0; line-height:150%; }
        .muted { opacity:0.5; font-size:0.85em; font-style:italic; }
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
                    html += `<p class="eq"><var>${escHtml(b.name)}</var> = ${escHtml(b.expr)} = <b class="val">${display}</b></p>`;
                    break;
                }
                case 'value': {
                    const display = typeof b.text === 'string' && b.text.startsWith('<') ? b.text : escHtml(String(b.text));
                    html += `<p class="eq"><var>${escHtml(b.name)}</var> = <b class="val">${display}</b></p>`;
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
    iframe.contentDocument.open();
    iframe.contentDocument.write(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${banner}${html}</body></html>`);
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

// --- Unified convert: auto uses local parser, manual uses CLI ---
async function convertToHtml(auto) {
    const input = textarea.value.trim();
    if (!input) return;

    isConverting = true;

    // AUTO mode: use CLI with cache (parser TS not yet complete for full Calcpad syntax)
    // The CLI cache makes repeated runs instant (~25ms)

    // MANUAL mode (Convertir button): use CLI for full render
    btnConvert.disabled = true;
    btnConvert.textContent = '...';
    statusMsg.textContent = 'Convirtiendo...';
    statusMsg.className = '';
    resultFrame.innerHTML = '<div class="loading-state"><span>Calculando...</span></div>';

    const t0 = performance.now();

    try {
        const htmlContent = await convertCli(input);
        const elapsed = Math.round(performance.now() - t0);

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';
        resultFrame.innerHTML = '';
        resultFrame.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(htmlContent);
        iframe.contentDocument.close();
        // Wait for iframe to fully render before adding line links
        iframe.addEventListener('load', () => addLineLinks(iframe));
        // Also try immediately in case load already fired
        setTimeout(() => addLineLinks(iframe), 200);

        localStorage.setItem('calcpadFemInput', input);
        statusMsg.textContent = 'OK (CLI)';
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
    const reader = new FileReader();
    reader.onload = () => {
        textarea.value = reader.result;
        currentFileName = file.name.replace(/\.cpd$/, '');
        currentGroup = '';
        lastText = textarea.value;
        localStorage.setItem('calcpadFemInput', textarea.value);
        statusMsg.textContent = `Abierto: ${file.name}`;
        statusMsg.className = 'success';
        convertToHtml(true);
    };
    reader.readAsText(file);
    fileInput.value = '';
});

// GUARDAR — save to current name, or prompt if new
async function doSave() {
    const content = textarea.value.trim();
    if (!content) { statusMsg.textContent = 'Nada que guardar'; return; }
    if (!currentFileName) return doSaveAs();
    await saveToServer(currentFileName, currentGroup, content);
}

// GUARDAR COMO — native file picker (File System Access API) or fallback download
async function doSaveAs() {
    const content = textarea.value.trim();
    if (!content) { statusMsg.textContent = 'Nada que guardar'; return; }

    const fileName = (currentFileName || 'documento') + '.cpd';

    // Try native "Save As" dialog (Chrome/Edge)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{ description: 'Calcpad', accept: { 'text/plain': ['.cpd'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            currentFileName = handle.name.replace(/\.cpd$/, '');
            statusMsg.textContent = `Guardado: ${handle.name}`;
            statusMsg.className = 'success';
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }

    // Fallback: trigger download
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    statusMsg.textContent = `Descargado: ${fileName}`;
    statusMsg.className = 'success';
}

async function saveToServer(name, group, content) {
    statusMsg.textContent = 'Guardando...';
    try {
        const res = await fetch('/api/save', {
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

// --- Init ---
window.onload = async function () {
    console.log('[init] starting...');
    await initExamples();

    // Always load Rectangular Slab FEA as default
    try {
        console.log('[init] loading default example:', DEFAULT_EXAMPLE_PATH);
        const defaultContent = await loadExampleFile(DEFAULT_EXAMPLE_PATH);
        if (defaultContent) {
            textarea.value = defaultContent;
            currentFileName = 'Mesa Torsion DKE Completo';
            currentGroup = 'Mechanics/Finite Elements';
            console.log('[init] loaded', defaultContent.length, 'chars');
        } else {
            console.error('[init] failed to load default example');
        }
    } catch (e) {
        console.error('[init] error loading default:', e);
    }

    lastText = textarea.value;
    updateLineInfo();
    if (textarea.value.trim()) {
        console.log('[init] starting local conversion...');
        convertToHtml(true);  // auto=true → uses local parser (instant)
    }
};
