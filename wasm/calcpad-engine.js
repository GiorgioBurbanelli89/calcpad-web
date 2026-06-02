// Cargador del motor Calcpad en WASM (Calcpad.Core compilado a WebAssembly).
// Expone window.calcpadWasm.convert(code) -> HTML del resultado. Corre igual en
// local (server.js) y en el deploy estatico (GitHub Pages), sin backend.
import { dotnet } from './_framework/dotnet.js';

try {
    const { getAssemblyExports, getConfig, runMain } = await dotnet.create();
    const config = getConfig();
    const exports = await getAssemblyExports(config.mainAssemblyName);
    window.calcpadWasm = {
        ready: true,
        convert: (code) => exports.CalcpadEngine.Convert(code || '')
    };
    window.dispatchEvent(new Event('calcpad-wasm-ready'));
    console.log('[calcpad-wasm] motor real listo (window.calcpadWasm.convert)');
    runMain();
} catch (e) {
    console.error('[calcpad-wasm] fallo al cargar el motor WASM:', e);
}
