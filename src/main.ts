// Calcpad-Symbolic Web — main entry point
// - Editor with syntax-aware output rendering
// - File open (.cpd / .txt)
// - 4 prebuilt FEM examples (cube, soil point, soil rect, cantilever)
// - Native C3D8 solver with SAP2000-style color map + clipping planes

import { evalCalcpad, OutputBlock } from './parser/CalcpadParser';
import { EXAMPLES, ExampleResult } from './examples';
import { fem3d } from './viz/fem3d';

const editor = document.getElementById('editor') as HTMLTextAreaElement;
const output = document.getElementById('output') as HTMLDivElement;
const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnHelp = document.getElementById('btn-help') as HTMLButtonElement;
const exampleSelect = document.getElementById('example-select') as HTMLSelectElement;
const statusLines = document.getElementById('status-lines')!;
const statusTime = document.getElementById('status-time')!;
const statusVars = document.getElementById('status-vars')!;

// Add file open button programmatically
const btnOpen = document.createElement('button');
btnOpen.id = 'btn-open';
btnOpen.title = 'Abrir archivo .cpd';
btnOpen.textContent = '📁 Abrir';
btnClear.parentNode!.insertBefore(btnOpen, btnClear.nextSibling);

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
  runScript();
};

// --- Render output blocks ---
function renderBlocks(blocks: OutputBlock[]): void {
  output.innerHTML = '';
  let fem3dCounter = 0;

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const h = document.createElement('div');
        h.className = 'heading';
        h.textContent = block.text;
        output.appendChild(h);
        break;
      }
      case 'comment': {
        const p = document.createElement('div');
        p.className = 'comment';
        // Allow simple HTML: <b>...</b>
        p.innerHTML = block.text;
        output.appendChild(p);
        break;
      }
      case 'assignment':
      case 'value': {
        const p = document.createElement('div');
        p.className = 'var-line';
        const name = block.kind === 'assignment' ? block.name : block.name;
        p.innerHTML = `<span class="value">${escapeHtml(name)}</span> = ${block.text}`;
        output.appendChild(p);
        break;
      }
      case 'fem3d': {
        const wrap = document.createElement('div');
        wrap.className = 'canvas-wrapper';
        const id = `fem3d_${fem3dCounter++}`;
        wrap.id = id;
        output.appendChild(wrap);
        // Defer rendering (needs container in DOM)
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

// --- Run prebuilt TypeScript example ---
function runExample(key: string): void {
  const runner = EXAMPLES[key];
  if (!runner) return;
  output.innerHTML = '';
  const t0 = performance.now();

  let result: ExampleResult;
  try {
    result = runner();
  } catch (err) {
    output.innerHTML = `<div class="err">Error ejecutando ejemplo: ${(err as Error).message}</div>`;
    console.error(err);
    return;
  }

  // Render header + summary
  const h = document.createElement('div');
  h.className = 'heading';
  h.textContent = result.title;
  output.appendChild(h);

  const sum = document.createElement('div');
  sum.className = 'comment';
  sum.textContent = result.summary;
  output.appendChild(sum);

  // Scalars
  for (const [k, v] of Object.entries(result.scalars)) {
    const p = document.createElement('div');
    p.className = 'var-line';
    p.innerHTML = `<span class="value">${escapeHtml(k)}</span> = ${escapeHtml(String(v))}`;
    output.appendChild(p);
  }

  // Timings
  const t = document.createElement('div');
  t.className = 'var-line';
  t.innerHTML = `<span class="value">Tiempo</span> = assembly ${result.timings.assembleMs.toFixed(0)} ms · solve ${result.timings.solveMs.toFixed(0)} ms · total ${result.timings.totalMs.toFixed(0)} ms`;
  output.appendChild(t);

  // 3D contour plot
  const wrap = document.createElement('div');
  wrap.className = 'canvas-wrapper';
  wrap.id = 'example_fem3d';
  output.appendChild(wrap);

  setTimeout(() => {
    try {
      fem3d('example_fem3d', {
        nodes: result.nodes,
        elements: result.elements,
        values: result.values,
        options: { width: 750, height: 520, title: result.valueLabel },
      });
    } catch (err) {
      wrap.innerHTML = `<div class="err">Fem3D: ${(err as Error).message}</div>`;
      console.error(err);
    }
  }, 0);

  const dt = performance.now() - t0;
  statusLines.textContent = `ejemplo: ${key}`;
  statusTime.textContent = `${dt.toFixed(0)} ms`;
  statusVars.textContent = `${result.nodes.length} nudos · ${result.elements.length} elems`;
}

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
</div>
`;
});

exampleSelect.addEventListener('change', () => {
  const v = exampleSelect.value;
  if (v) runExample(v);
});

// Ctrl+Enter to run
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runScript();
  }
});

// Default welcome script
editor.value = `' Calcpad-Symbolic Web — bienvenido!
' Selecciona un ejemplo del menu "📂 Ejemplos" o escribe tu propio script.
' Atajo: Ctrl+Enter para ejecutar.

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

runScript();
