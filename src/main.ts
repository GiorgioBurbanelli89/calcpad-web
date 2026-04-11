// Calcpad-Symbolic Web — main entry point
// - Editor with syntax-aware output rendering
// - Autorun on input change (debounced)
// - File open/save (.cpd)
// - 390+ examples loaded from public/examples/index.json

import { evalCalcpad, OutputBlock } from './parser/CalcpadParser';
import { fem3d } from './viz/fem3d';

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
        const p = document.createElement('p');
        const eq = document.createElement('span');
        eq.className = 'eq';
        eq.innerHTML = `<i>sym</i> ${escapeHtml(block.expr)} = <var>${escapeHtml(block.result)}</var>`;
        p.appendChild(eq);
        output.appendChild(p);
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

function runScript(): void {
  const src = editor.value;
  const t0 = performance.now();
  try {
    const result = evalCalcpad(src);
    renderBlocks(result.blocks);
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
