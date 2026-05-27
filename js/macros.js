// Macro panel - sliding drawer that appears only when #def is used
const macroDrawer = document.getElementById('macroDrawer');
const macroContent = document.getElementById('macroContent');
const macroHandle = document.getElementById('macroHandle');
const macroClose = document.getElementById('macroClose');
const macroCount = document.getElementById('macroCount');

let macroDrawerOpen = false;
let macroDrawerWidth = 300;

function parseMacros(code) {
    const macros = [];
    const lines = code.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trimStart();

        if (line.toLowerCase().startsWith('#def ')) {
            const isBlock = !line.includes('=') || line.trimEnd().endsWith(')');
            if (isBlock) {
                let block = line + '\n';
                i++;
                while (i < lines.length) {
                    block += lines[i] + '\n';
                    if (lines[i].trimStart().toLowerCase().startsWith('#end def')) break;
                    i++;
                }
                macros.push({ type: 'block', code: block.trimEnd(), line: i });
            } else {
                macros.push({ type: 'inline', code: line, line: i + 1 });
            }
        }
        i++;
    }
    return macros;
}

function updateMacroPanel(code) {
    const macros = parseMacros(code);
    macroCount.textContent = macros.length;

    if (macros.length === 0) {
        closeMacroDrawer();
        macroDrawer.style.display = 'none';
        return;
    }

    macroDrawer.style.display = 'flex';

    let html = '';
    macros.forEach((m, idx) => {
        const escaped = m.code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const badge = m.type === 'block' ? 'block' : 'inline';
        html += `<div class="macro-item">`;
        html += `<div class="macro-badge">${badge}</div>`;
        html += `<pre class="macro-code">${escaped}</pre>`;
        html += `</div>`;
    });
    macroContent.innerHTML = html;
}

function openMacroDrawer() {
    macroDrawerOpen = true;
    macroDrawer.style.width = macroDrawerWidth + 'px';
    macroDrawer.classList.add('open');
}

function closeMacroDrawer() {
    macroDrawerOpen = false;
    macroDrawer.style.width = '';
    macroDrawer.classList.remove('open');
}

// Toggle on handle click
macroHandle.addEventListener('click', () => {
    if (macroDrawerOpen) closeMacroDrawer();
    else openMacroDrawer();
});

macroClose.addEventListener('click', closeMacroDrawer);

// Drag to resize
(function () {
    const resizer = document.getElementById('macroResizer');
    let startX, startW;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = macroDrawer.offsetWidth;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
    });

    function onDrag(e) {
        const newW = Math.max(200, Math.min(600, startW + (startX - e.clientX)));
        macroDrawerWidth = newW;
        macroDrawer.style.width = newW + 'px';
    }

    function stopDrag() {
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    }
})();
