# Calcpad-Symbolic Web

**Versión web de Calcpad-Symbolic** — corre en el navegador sin instalación.
Incluye motor C3D8 FEM nativo, álgebra lineal con math.js, colormap SAP2000 y
clipping planes interactivos (Tweakpane).

🌐 **Demo en vivo:** https://giorgioburbanelli89.github.io/calcpad-web/

## ¿Qué puede hacer?

- **Parser Calcpad subset**: asignaciones, matrices `[1;2;3|4;5;6]`, indexación
  `A.(i;j)`, bucles `#for/#loop`, condicionales `#if/#else/#end if`,
  `#hide/#show`, funciones built-in de math.js.
- **Motor FEM C3D8 nativo TS** (portado desde `Symbolic.Core/Calculator/FemSolver.cs`):
  - `mesh_hex8_nodes([Lx;Ly;Lz;nx;ny;nz;centered])`
  - `mesh_hex8_elems([nx;ny;nz])`
  - `mesh_soil_specs([Lx;Ly;Lz;nx;ny;nz;centered;Pz])`
  - `mesh_soil_specs_rect([Lx;Ly;Lz;nx;ny;nz;centered;Rx;Ry;q])`
  - `fem_hex8(nodes; elems; E; nu; specs)` — resuelve Ku = F
  - `fem_hex8_stress(nodes; elems; E; nu; u)` — σ_zz nodal
- **Visualización 3D** con Three.js + Tweakpane clipping planes + colormap SAP2000
- **Abrir archivo** `.cpd` desde el disco local
- **4 ejemplos FEM prebuilt**:
  1. Cubo 1×1×1 — validación contra σ = P·L/(A·E) analítico
  2. Masa de suelo — carga puntual (6×6×4 hex8)
  3. Masa de suelo — carga rectangular distribuida (Serquén SF-70, 8×8×5)
  4. Voladizo 3D — vs δ = P·L³/(3·E·I)

## ⚠️ Limitaciones actuales

- **Solver denso** `lusolve` de math.js: recomendado hasta **~1500 DOFs**
  (~500 hex8). Para mallas mayores (32000 hex8 como el PDF de Serquén),
  se requiere **WASM Eigen sparse** (tarea futura — reutilizar el compilado
  de `awatif-fem/src/cpp/built/`).
- **Subset de Calcpad**: no soporta `#sym`/`#python`/`#maxima`, unidades
  físicas, `$Chart`/`$Plot`/`$Map`, ni `#function` definitions.
- **Stress** se evalúa en el centro de cada elemento (no Gauss → Barlow).
  Para el bulbo de Serquén la diferencia es ~6-7% vs el PDF.

## Instalación local

```bash
cd calcpad-web
npm install
npm run dev         # dev server en http://localhost:4800
npm run build       # build estático en dist/
npm run preview     # preview del build
```

## Despliegue a GitHub Pages

El repo incluye `.github/workflows/deploy.yml` — se despliega automáticamente
al hacer push a `main`. Para habilitar:

1. Settings → Pages → Source → **GitHub Actions**
2. Push a `main`
3. Sitio disponible en `https://<user>.github.io/calcpad-web/`

## Arquitectura

```
calcpad-web/
├── index.html              — shell con editor + output panel
├── src/
│   ├── main.ts             — UI, eventos, renderer de bloques
│   ├── parser/
│   │   └── CalcpadParser.ts — parser del subset Calcpad (evalCalcpad)
│   ├── fem/
│   │   └── FemSolver.ts    — solveHex8, computeSigmaZZ, meshHex8Box
│   ├── viz/
│   │   ├── fem3d.ts        — Three.js contour plot (copiado de calcpad-viz)
│   │   └── colormap.ts     — colormap SAP2000 (14 colores)
│   └── examples/
│       └── index.ts        — 4 ejemplos FEM prebuilt
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .github/workflows/deploy.yml
```

## Desktop equivalente

Para problemas grandes (>5000 hex8), SAP2000-style contours en WPF, bucles
simbólicos, y análisis completos — usa la versión desktop:

👉 **https://github.com/GiorgioBurbanelli89/Calcpad-Symbolic**

## Créditos

- **CalcpadCE** original: Ned Ganchovski (proektsoft.bg)
- **Fork CalcpadCE → Calcpad-Symbolic**: Jorge Burbano
- **Motor FEM C3D8**: portado desde `Symbolic.Core/Calculator/FemSolver.cs`
- **Visualización**: `calcpad-viz` (Three.js + Tweakpane)
- **math.js** — álgebra lineal en el navegador
- **katex** — render de ecuaciones LaTeX

## Licencia

MIT — igual que Calcpad-Symbolic.
