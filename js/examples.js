// Default: load Rectangular Slab FEA from server
const DEFAULT_EXAMPLE_PATH = 'Mechanics/Finite Elements/Mesa Torsion DKE Completo.cpd';
let DEFAULT_EXAMPLE = '';

async function loadExampleIndex() {
    try {
        const res = await fetch('examples/index.json');
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

function populateExamples(select, index) {
    if (!index || !index.groups) return;

    // "Mechanics / Finite Elements" first, then the rest alphabetically
    const priorityKey = 'Mechanics / Finite Elements';
    const entries = Object.entries(index.groups);
    const sorted = entries.sort(([a], [b]) => {
        if (a === priorityKey) return -1;
        if (b === priorityKey) return 1;
        return a.localeCompare(b);
    });

    sorted.forEach(([group, files]) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group;

        files.forEach(file => {
            const opt = document.createElement('option');
            opt.value = file.path;
            opt.textContent = file.name;
            optgroup.appendChild(opt);
        });

        select.appendChild(optgroup);
    });
}

async function loadExampleFile(path) {
    // If path already has extension, use it directly
    if (path.endsWith('.cpd') || path.endsWith('.m')) {
        try {
            const url = 'examples/' + path.split('/').map(encodeURIComponent).join('/');
            const res = await fetch(url);
            if (res.ok) return await res.text();
        } catch {}
        return null;
    }
    // Otherwise try .cpd, .m, raw
    for (const ext of ['.cpd', '.m', '']) {
        try {
            const url = 'examples/' + (path + ext).split('/').map(encodeURIComponent).join('/');
            const res = await fetch(url);
            if (res.ok) return await res.text();
        } catch {}
    }
    return null;
}
