// Batch-check all 390 Calcpad examples using the live parser in the
// running preview/dev server.
//
// Usage (from the browser console on the calcpad-web preview page):
//     await checkAll()            // check every example
//     await checkAll({ limit: 20 }) // first 20 only
//     await checkAll({ filter: 'Finite Elements' }) // only matching paths
//
// The function is exposed as `window.checkAll` by main.ts after the
// parser has loaded.

(function installCheckAll() {
  async function checkAll(opts = {}) {
    const { limit = Infinity, filter = '', verbose = false } = opts;
    const api = window.__calcpad;
    if (!api || typeof api.evalCalcpad !== 'function') {
      console.error('window.__calcpad.evalCalcpad not found — is main.ts loaded?');
      return;
    }
    const baseUrl = document.baseURI.replace(/\/[^/]*$/, '/');
    const idxRes = await fetch(baseUrl + 'examples/index.json');
    if (!idxRes.ok) {
      console.error('index.json not found at', baseUrl + 'examples/index.json');
      return;
    }
    const idx = await idxRes.json();

    // Flatten groups → list of { group, path, name }
    const all = [];
    for (const [group, items] of Object.entries(idx.groups)) {
      for (const it of items) all.push({ group, path: it.path, name: it.name });
    }
    const targets = all.filter(t => !filter || t.path.includes(filter)).slice(0, limit);

    const results = {
      total: targets.length,
      ok: 0,
      withErrors: 0,
      fetchFailed: 0,
      threwException: 0,
      slow: [],      // { path, ms }
      errors: [],    // { path, errors: [{line, message}] }
      crashed: [],   // { path, message }
    };

    const t0 = performance.now();
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (verbose) console.log(`[${i + 1}/${targets.length}] ${t.path}`);
      let src;
      try {
        const r = await fetch(baseUrl + 'examples/' + t.path);
        if (!r.ok) {
          results.fetchFailed++;
          results.crashed.push({ path: t.path, message: `HTTP ${r.status}` });
          continue;
        }
        src = await r.text();
      } catch (err) {
        results.fetchFailed++;
        results.crashed.push({ path: t.path, message: 'fetch: ' + err.message });
        continue;
      }

      const t1 = performance.now();
      let result;
      try {
        result = api.evalCalcpad(src);
      } catch (err) {
        results.threwException++;
        results.crashed.push({ path: t.path, message: 'eval threw: ' + (err && err.message) });
        continue;
      }
      const dt = performance.now() - t1;
      if (dt > 1000) results.slow.push({ path: t.path, ms: Math.round(dt) });

      if (result.errors && result.errors.length > 0) {
        results.withErrors++;
        results.errors.push({ path: t.path, errors: result.errors.slice(0, 5), total: result.errors.length });
      } else {
        results.ok++;
      }
    }
    results.elapsedMs = Math.round(performance.now() - t0);

    // Pretty summary
    console.log('%c===== Calcpad-Web examples check =====', 'font-weight: bold; color: #06c');
    console.log(`Total: ${results.total}   OK: ${results.ok}   With errors: ${results.withErrors}   Fetch-failed: ${results.fetchFailed}   Crashed: ${results.threwException}`);
    console.log(`Elapsed: ${results.elapsedMs} ms`);

    if (results.errors.length) {
      console.groupCollapsed(`⚠ ${results.errors.length} files with parse errors`);
      // Aggregate error messages to find the most common ones
      const msgCount = {};
      for (const e of results.errors) {
        for (const er of e.errors) {
          const key = (er.message || '').slice(0, 80);
          msgCount[key] = (msgCount[key] || 0) + 1;
        }
      }
      const top = Object.entries(msgCount).sort((a, b) => b[1] - a[1]).slice(0, 15);
      console.log('Top error messages:');
      for (const [m, n] of top) console.log(`  ${n}×  ${m}`);
      console.log('---');
      for (const e of results.errors) {
        console.log(`• ${e.path}  (${e.total} errors)`);
        for (const er of e.errors) console.log(`     line ${er.line}: ${er.message}`);
      }
      console.groupEnd();
    }
    if (results.crashed.length) {
      console.groupCollapsed(`💥 ${results.crashed.length} files crashed`);
      for (const c of results.crashed) console.log(`• ${c.path} — ${c.message}`);
      console.groupEnd();
    }
    if (results.slow.length) {
      console.groupCollapsed(`🐢 ${results.slow.length} slow files (>1s)`);
      results.slow.sort((a, b) => b.ms - a.ms);
      for (const s of results.slow.slice(0, 20)) console.log(`• ${s.ms} ms  ${s.path}`);
      console.groupEnd();
    }
    return results;
  }

  window.checkAll = checkAll;
  console.log('checkAll() ready — call from console. Options: { limit, filter, verbose }');
})();
