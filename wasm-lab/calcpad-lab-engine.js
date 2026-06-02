// Motor real de Calcpad-Lab (MATLAB) en WASM. Expone window.calcpadLabWasm.convert(code).
import { dotnet } from './_framework/dotnet.js';
try {
  const { getAssemblyExports, getConfig, runMain } = await dotnet.create();
  const config = getConfig();
  const exports = await getAssemblyExports(config.mainAssemblyName);
  window.calcpadLabWasm = { ready: true, convert: (code) => exports.CalcpadLabEngine.ConvertLab(code || '') };
  window.dispatchEvent(new Event('calcpad-lab-wasm-ready'));
  console.log('[calcpad-lab-wasm] motor Lab (MATLAB real) listo');
  runMain();
} catch (e) { console.error('[calcpad-lab-wasm] fallo:', e); }
