import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const worker = new Worker("./muro_worker.js?v=19", { type: "module" });
let reqId = 0;
let inFlight = false;
let pending = null;
const $ = (id) => document.getElementById(id);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ABQ = [
  [0, 0, 215],
  [0, 0, 255],
  [0, 92, 255],
  [0, 185, 255],
  [0, 255, 231],
  [0, 255, 139],
  [0, 255, 46],
  [46, 255, 0],
  [139, 255, 0],
  [231, 255, 0],
  [255, 185, 0],
  [255, 92, 0],
  [255, 0, 0],
  [179, 0, 0]
];
function jet(t) {
  t = clamp01(t);
  const i = Math.min(ABQ.length - 1, Math.floor(t * ABQ.length));
  const c = ABQ[i];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}
function abqSmooth(t) {
  t = clamp01(t);
  const f = t * (ABQ.length - 1), i = Math.min(ABQ.length - 2, Math.floor(f)), u = f - i;
  const a = ABQ[i], b = ABQ[i + 1];
  return [(a[0] + (b[0] - a[0]) * u) / 255, (a[1] + (b[1] - a[1]) * u) / 255, (a[2] + (b[2] - a[2]) * u) / 255];
}
let H = null;
let frame = 0;
let dmgMode = "T";
let accDmgSeis = null;
let mirrorIdx = null;
let loadMode = "lateral";
let useBEg = true;
let leWg = 450;
let tBEg = 200;
let beAlignG = "centrado";
let gravG = 0;
let faceElem = [];
function meshFor(W, Ht) {
  const es = 90;
  const nx = Math.max(6, Math.min(40, Math.round(W / es)));
  const ny = Math.max(6, Math.min(60, Math.round(Ht / es)));
  return { nx, ny };
}
function solve() {
  const lw = +$("lw").value, hwm = +$("hw_m").value;
  const HW = hwm / lw, ft = +$("ft").value;
  const weak = $("weak").checked ? 1 : 0;
  const useBE = $("useBE").checked;
  useBEg = useBE;
  const fc = +$("fc").value;
  const v = (id) => +$(id).value, Ar = (dd) => Math.PI / 4 * dd * dd;
  const tt = v("t"), fy = v("fy");
  const bcCore = tt - 2 * v("cover");
  const rhoS = 2 * Ar(v("dbEst")) / (v("sEst") * bcCore);
  const conf = useBE ? Math.min(3, Math.max(1, 1 + 8 * rhoS * fy / fc)) : 1;
  $("vConf").textContent = useBE ? conf.toFixed(2) : "1.00 (sin borde)";
  const rhoW = 2 * Ar(v("dbW")) / (tt * v("sW"));
  const nPerim = 2 * v("nBEx") + 2 * v("nBEy") - 4;
  const rhoBE = nPerim * Ar(v("dbBE")) / (v("leFrac") * lw * tt);
  const ctrlWeb = Math.min(0.75, rhoW * fy / (ft * 4));
  const ctrlBE = useBE ? Math.min(0.88, rhoBE * fy / (ft * 4)) : ctrlWeb;
  const modeN = loadMode === "axial" ? 1 : 0;
  const leWidth = useBE ? v("leFrac") * lw : 0;
  const tBE = useBE ? Math.max(tt, v("tBE")) : tt;
  leWg = v("leFrac") * lw;
  tBEg = tBE;
  beAlignG = $("beAlign").value === "lindero" ? "lindero" : "centrado";
  const gravVal = loadMode === "lateral" ? v("grav") : 0;
  gravG = gravVal;
  const { nx, ny } = meshFor(lw, hwm), ns = 55;
  postSolve({ HW, ft, conf, weak, mode: modeN, nx, ny, ns, fc, ctrlWeb, ctrlBE, le: leWidth, tw: tt, tbe: tBE, grav: gravVal, lw });
}
function postSolve(params) {
  reqId++;
  params.reqId = reqId;
  $("status").textContent = "\u23F3 calculando\u2026";
  showCalc();
  if (inFlight) {
    pending = params;
  } else {
    inFlight = true;
    worker.postMessage(params);
  }
}
worker.onmessage = (ev) => {
  const r = ev.data;
  if (r.reqId === reqId) onResult(r);
  if (pending) {
    const p = pending;
    pending = null;
    inFlight = true;
    worker.postMessage(p);
  } else {
    inFlight = false;
    hideCalc();
  }
};
function onResult(r) {
  const wasAnim = animReq !== 0;
  if (animMode) stopSismo();
  animU = null;
  const m = r.meta, ns = r.ns;
  const nx = m[2] | 0, ny = m[3] | 0, NE = m[1] | 0, NN = m[0] | 0, ng = 2 * NN;
  const W = m[4], Ht = m[5], flex = m[7] > 0.5;
  const X = new Float64Array(NN), Y = new Float64Array(NN);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    X[j * (nx + 1) + i] = W * i / nx;
    Y[j * (nx + 1) + i] = Ht * j / ny;
  }
  const els = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const n0 = j * (nx + 1) + i;
    els.push([n0, n0 + 1, n0 + nx + 2, n0 + nx + 1]);
  }
  mirrorIdx = new Int32Array(NE);
  for (let e = 0; e < NE; e++) {
    const i = e % nx, j = e / nx | 0;
    mirrorIdx[e] = j * nx + (nx - 1 - i);
  }
  accDmgSeis = null;
  H = {
    nx,
    ny,
    NE,
    NN,
    ng,
    ns,
    W,
    Ht,
    t: +$("t").value,
    umax: (loadMode === "axial" ? 13e-4 : 3e-3) * Ht,
    X,
    Y,
    els,
    flex,
    dmg: r.dmg,
    dmgC: r.dmgC,
    U: r.U,
    sig: r.sig,
    force: r.force
  };
  $("status").textContent = `listo (${NE} elem, WASM C++ \xB7 worker)`;
  mechLabel($("weak").checked, flex);
  loadLabel();
  detailing();
  build3D();
  buildDims();
  buildRebar();
  buildBE();
  buildLoadArrows();
  if (wasAnim && !pending) playSismo();
}
function mechLabel(weak, flex) {
  const e = $("mech");
  if (loadMode === "axial") {
    e.textContent = "APLASTAMIENTO POR COMPRESI\xD3N (AXIAL)";
    e.style.background = "#5a3a7a";
  } else if (weak) {
    e.textContent = "DESLIZAMIENTO EN LA BASE";
    e.style.background = "#7a3b1e";
  } else if (flex) {
    e.textContent = "FALLA FLEXURAL";
    e.style.background = "#1e5a7a";
  } else {
    e.textContent = "FALLA POR CORTANTE (DIAGONAL)";
    e.style.background = "#7a1e2e";
  }
  explainMech(weak, flex);
}
const EXP = {
  cortante: "<b>\xBFPor qu\xE9 se agrieta as\xED?</b> Un muro <b>chato</b> (poca altura frente al largo) resiste el sismo como un panel a <b>cortante</b>. El cortante genera tracci\xF3n <b>a 45\xB0</b> (esfuerzo principal de tracci\xF3n); cuando supera la resistencia a tracci\xF3n del hormig\xF3n <b>ft</b>, se abre una <b>grieta diagonal</b> (el hormig\xF3n trabaja como un puntal en compresi\xF3n y la grieta es el tensor). La <b>malla horizontal del alma</b> cose esa grieta. Sin suficiente refuerzo la falla es <b>fr\xE1gil</b> (s\xFAbita).",
  flexion: "<b>\xBFPor qu\xE9 se agrieta as\xED?</b> Un muro <b>esbelto</b> trabaja como un <b>voladizo</b> (columna en cantil\xE9ver). El <b>momento m\xE1ximo est\xE1 en la base</b> \u2192 tracci\xF3n en el borde de barlovento. Aparece una <b>grieta horizontal en la base</b>; las <b>varillas del elemento de borde</b> toman esa tracci\xF3n de flexi\xF3n. Si el borde est\xE1 bien confinado la falla es <b>d\xFActil</b> (avisa).",
  deslizamiento: "<b>\xBFPor qu\xE9 se agrieta as\xED?</b> Cuando la <b>junta de la base</b> (interfaz con la fundaci\xF3n o una junta de hormigonado) es d\xE9bil, el muro <b>desliza horizontalmente</b> sobre ese plano en vez de agrietarse diagonal. El da\xF1o se concentra en la <b>fila inferior</b>. Gobiernan el <b>corte por fricci\xF3n</b> (shear-friction) y las barras que cruzan la junta (pasadores/dowels).",
  compresion: "<b>\xBFPor qu\xE9 se agrieta as\xED?</b> Bajo <b>carga axial</b> (el peso de los pisos que baja por el muro), el hormig\xF3n se <b>aplasta</b> cuando la compresi\xF3n supera ~<b>f\u2032c</b>. Los <b>puntales diagonales</b> concentran el aplastamiento en forma de <b>X</b>. El <b>confinamiento de los estribos</b> sube la resistencia (f\u2032cc) y la ductilidad \u2192 los bordes confinados resisten y cruje primero el alma."
};
function hoverGloss(k) {
  const P = k === "cortante" ? "tau" : k === "flexion" ? "s1" : k === "deslizamiento" ? "gmax" : "dc";
  const item = (id, label, txt) => `<div style="padding:3px 6px;border-radius:4px;margin:2px 0;${P === id ? "background:#22384f" : ""}">${label} \u2014 ${txt}${P === id ? ' <b style="color:#7fd6ff">\u2190 el que manda en esta falla</b>' : ""}</div>`;
  return `<details style="margin-top:8px"><summary style="cursor:pointer;color:#ffd27f;font-weight:600;font-size:11.5px">\u{1F4CA} \xBFQu\xE9 significan los n\xFAmeros del cursor?</summary>
    <div style="font-size:11px;line-height:1.5;margin-top:4px">
    ${item("s1", "<b>\u03C3\u2081</b> (tracci\xF3n)", "cu\xE1nto se <b>estira</b> el hormig\xF3n ah\xED. Si pasa de ft, se agrieta.")}
    ${item("tau", "<b>\u03C4max</b> (cortante)", "cu\xE1nto se <b>desgarra</b> (fuerzas que cortan en diagonal).")}
    ${item("e1", "<b>\u03B5\u2081</b> (estiramiento)", "cu\xE1nto se alarga el material (n\xFAmero chico, sin unidad).")}
    ${item("gmax", "<b>\u03B3max</b> (distorsi\xF3n)", "cu\xE1nto se <b>tuerce</b> el cuadradito de material.")}
    ${item("dt", "<b>DAMAGET</b> 0\u21920.9", "grieta por tracci\xF3n: 0=sano, 0.9=fisurado (rojo).")}
    ${item("dc", "<b>DAMAGEC</b> 0\u21920.6", "aplastamiento por compresi\xF3n: 0=sano, 0.6=triturado.")}
    </div></details>`;
}
const SLIDER_GLOSS = `<details style="margin-top:6px"><summary style="cursor:pointer;color:#ffd27f;font-weight:600;font-size:11.5px">\u{1F39A}\uFE0F \xBFQu\xE9 hace cada slider?</summary>
  <div style="font-size:11px;line-height:1.55;margin-top:4px">
  <b>l_w / h_w</b> \u2014 largo y alto del muro; su relaci\xF3n decide la falla (chato\u2192corte, alto\u2192flexi\xF3n).<br>
  <b>t (espesor)</b> \u2014 m\xE1s grueso resiste m\xE1s corte y aplastamiento.<br>
  <b>Cortante basal</b> \u2014 cu\xE1nta fuerza lateral (sismo) le met\xE9s.<br>
  <b>Gravedad</b> \u2014 el peso de los pisos que baja por el muro.<br>
  <b>ft</b> \u2014 resistencia a tracci\xF3n: manda cu\xE1ndo se <b>agrieta</b>.<br>
  <b>f\u2032c</b> \u2014 resistencia a compresi\xF3n: manda cu\xE1ndo se <b>aplasta</b>.<br>
  <b>Malla (\xD8/sep)</b> \u2014 barras del alma que <b>cosen</b> las grietas (m\xE1s juntas o m\xE1s gruesas = menos grieta).<br>
  <b>Elemento de borde</b> \u2014 las "columnas" en las puntas: toman la tracci\xF3n de flexi\xF3n y confinan.<br>
  <b>Estribo (\xD8/sep)</b> \u2014 abraza el borde: m\xE1s juntos = m\xE1s confinamiento = m\xE1s <b>d\xFActil</b>.<br>
  <b>Recubrimiento</b> \u2014 hormig\xF3n entre la cara y el acero (protege del \xF3xido/fuego).</div></details>`;
function explainMech(weak, flex) {
  const el = $("explain");
  if (!el) return;
  const k = loadMode === "axial" ? "compresion" : weak ? "deslizamiento" : flex ? "flexion" : "cortante";
  el.innerHTML = EXP[k] + `<div id="detailBox" style="margin-top:8px"></div>` + hoverGloss(k) + SLIDER_GLOSS;
  updateDetail();
}
let seisEvents = [];
let seisPkV = 0, seisPkDrift = 0;
function mechKey() {
  const weak = $("weak").checked, flex = H ? H.flex : false;
  return loadMode === "axial" ? "compresion" : weak ? "deslizamiento" : flex ? "flexion" : "cortante";
}
function analyzeCrack(getD) {
  const nx = H.nx, ny = H.ny;
  let dmax = 0, tot = 0, base = 0, d1 = 0, d2 = 0, sx = 0, sy = 0, ncr = 0;
  for (let e = 0; e < H.NE; e++) {
    const d = getD(e);
    if (d > dmax) dmax = d;
    if (d > 0.1) ncr++;
    const i = e % nx, j = e / nx | 0, u = (i + 0.5) / nx, v = (j + 0.5) / ny;
    tot += d;
    sx += d * u;
    sy += d * v;
    if (v < 0.25) base += d;
    if (Math.abs(u - v) < 0.18) d1 += d;
    if (Math.abs(u - (1 - v)) < 0.18) d2 += d;
  }
  const mx = Math.max(d1, d2, 1e-9);
  return {
    dmax,
    baseFrac: tot > 0 ? base / tot : 0,
    cx: tot > 0 ? sx / tot : 0.5,
    cy: tot > 0 ? sy / tot : 0.5,
    ncr,
    diagBoth: Math.min(d1, d2) / mx > 0.4 && Math.min(d1, d2) > 0.08 * mx,
    d1,
    d2
  };
}
function updateDetail() {
  const box = document.getElementById("detailBox");
  if (!box || !H) return;
  const k = mechKey(), dScale = dmgMode === "C" ? 0.6 : 0.9;
  const useAcc = !!(accDmgSeis && animMode && animShowCrack);
  const linElastic = animMode && !animShowCrack;
  const fo = frame < 0 ? 0 : frame;
  const getD = linElastic ? (_e) => 0 : useAcc ? (e) => accDmgSeis[e] : (e) => H.dmg[Math.min(fo, H.ns - 1) * H.NE + e];
  const a = analyzeCrack(getD);
  const V = useAcc ? seisPkV : H.force ? Math.abs(H.force[Math.min(fo, H.ns - 1)]) * calF() / 9806.65 : 0;
  const drift = useAcc ? seisPkDrift : H.umax * (fo + 1) / H.ns / H.Ht * 100;
  const ft = +$("ft").value, fc = +$("fc").value;
  const dPct = Math.min(100, Math.round(a.dmax / dScale * 100));
  const estado = a.dmax < 0.05 ? ["SANO", "#7cff9e", "el\xE1stico, sin grieta"] : a.dmax < 0.3 ? ["FISURA INCIPIENTE", "#bfe9ff", "empieza a agrietarse"] : a.dmax < 0.6 ? ["AGRIETADO", "#ffd27f", "grieta abierta, el acero la cose"] : a.dmax < 0.85 ? ["DA\xD1O SEVERO", "#ff9a5a", "grieta grande, poca reserva"] : ["CR\xCDTICO", "#ff6b6b", "los elementos ceden (falla)"];
  let loc;
  if (k === "cortante") loc = a.dmax < 0.05 ? "\u2014" : a.diagBoth ? "las <b>DOS diagonales</b> (forma de X): el sismo empuj\xF3 de ida y de vuelta" : a.d1 >= a.d2 ? "la <b>diagonal \u2197</b> (abajo-izq \u2192 arriba-der)" : "la <b>diagonal \u2198</b> (abajo-der \u2192 arriba-izq)";
  else if (k === "flexion") loc = a.dmax < 0.05 ? "\u2014" : "la <b>base</b> (borde traccionado por el momento de vuelco)";
  else if (k === "deslizamiento") loc = a.dmax < 0.05 ? "\u2014" : "la <b>fila inferior</b> (la junta d\xE9bil de la base)";
  else loc = a.dmax < 0.05 ? "\u2014" : "los <b>extremos/talones</b> (aplastamiento por compresi\xF3n)";
  const why = {
    cortante: `El cortante <b>V=${V.toFixed(0)} tonf</b> genera tracci\xF3n a 45\xB0. Donde esa tracci\xF3n supera <b>ft=${ft} MPa</b>, el hormig\xF3n se abre en diagonal (trabaja como puntal en compresi\xF3n, la grieta es el tensor).`,
    flexion: `El momento de vuelco <b>M=V\xB7h=${(V * H.Ht / 1e3).toFixed(0)} tonf\xB7m</b> tracciona el borde de barlovento. Cuando pasa <b>ft=${ft} MPa</b> se abre una grieta horizontal; las barras del borde toman esa tracci\xF3n.`,
    deslizamiento: `El cortante <b>V=${V.toFixed(0)} tonf</b> se concentra en la junta d\xE9bil de la base y el muro <b>desliza</b> por corte-fricci\xF3n en vez de agrietarse diagonal.`,
    compresion: `La compresi\xF3n axial se acerca a <b>f'c=${fc} MPa</b> y el hormig\xF3n se <b>aplasta</b> en los talones; el confinamiento de los estribos sube la resistencia.`
  };
  let html;
  if (linElastic) {
    html = `<div style="background:#10141b;border:1px solid #263041;border-radius:7px;padding:8px 10px;font-size:11.3px;line-height:1.55;color:#c7d3df">
      <div style="font-weight:700;color:#ffd27f;margin-bottom:3px">\u{1F52C} Qu\xE9 est\xE1 pasando (con tus datos):</div>
      Estado: <b style="color:#7fb8ff">EL\xC1STICO</b> \u2014 el muro oscila y <b>vuelve a su forma, SIN agrietarse</b>.<br>
      En el an\xE1lisis <b>lineal</b> el hormig\xF3n se supone el\xE1stico: la tracci\xF3n no supera ft, as\xED que <b>no hay da\xF1o</b> (DAMAGET=0). El muro se mueve con el sismo y no queda grieta. Para ver la grieta us\xE1 <b>3 \xB7 S\xEDsmico NO lineal</b>.
      </div>`;
  } else {
    html = `<div style="background:#10141b;border:1px solid #263041;border-radius:7px;padding:8px 10px;font-size:11.3px;line-height:1.55;color:#c7d3df">
    <div style="font-weight:700;color:#ffd27f;margin-bottom:3px">\u{1F52C} Qu\xE9 est\xE1 pasando (con tus datos):</div>
    Estado: <b style="color:${estado[1]}">${estado[0]}</b> \u2014 ${estado[2]}.<br>
    ${why[k]}<br>
    ${a.dmax >= 0.05 ? `\u{1F4CD} El da\xF1o se concentra en ${loc}.<br>` : ""}
    <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 12px">
      <span>\u{1FA79} <b>DAMAGET = ${a.dmax.toFixed(2)}</b> (${dPct}%)</span>
      <span>\u{1F4AA} <b>V = ${V.toFixed(0)} tonf</b></span>
      <span>\u{1F4D0} deriva <b>${drift.toFixed(2)}%</b></span>
      ${a.ncr > 0 ? `<span>\u{1F9F1} ${a.ncr} elem. agrietados</span>` : ""}
    </div></div>`;
  }
  if (seisEvents.length) {
    html += `<div style="margin-top:7px;background:#0e1620;border:1px solid #26384a;border-radius:7px;padding:8px 10px;font-size:11px;line-height:1.5;color:#bfe9ff">
      <div style="font-weight:700;color:#7fd6ff;margin-bottom:3px">\u23F1\uFE0F L\xEDnea de tiempo del sismo:</div>` + seisEvents.map((ev) => `<div><b style="color:#8fd0ff">t=${ev.t.toFixed(1)} s</b> \xB7 ${ev.msg}</div>`).join("") + `</div>`;
  }
  box.innerHTML = html;
}
function detailing() {
  if (!H) return;
  const W = H.W, t = H.t, hw = H.Ht;
  const val = (id) => +$(id).value;
  const fc = val("fc"), fy = val("fy"), lam = 1, sqfc = Math.sqrt(fc);
  const cover = val("cover"), leFrac = val("leFrac");
  const dbW = val("dbW"), sW = val("sW");
  const nBEx = val("nBEx"), nBEy = val("nBEy");
  const nBEu = 2 * nBEx + 2 * nBEy - 4;
  const dbBE = val("dbBE");
  const dbEst = val("dbEst"), sEst = val("sEst");
  const zero = frame < 0, fo = zero ? 0 : frame;
  const Vu = zero ? 0 : Math.abs(H.force[fo]) * calF();
  const Mu = Vu * hw;
  const ar = hw / W;
  const Acv = W * t;
  const ac = ar <= 1.5 ? 0.25 : ar >= 2 ? 0.17 : 0.25 + (0.17 - 0.25) * (ar - 1.5) / 0.5;
  const phiV = 0.75, phiM = 0.9;
  const Vc = ac * lam * sqfc * Acv;
  const VnMax = 0.66 * sqfc * Acv;
  const shearFail = Vu > phiV * VnMax;
  const rhoTmax = (VnMax / Acv - ac * sqfc) / fy;
  let rhoT = Math.max(25e-4, Math.min((Vu / phiV - Vc) / (Acv * fy), rhoTmax));
  const rhoL = ar <= 2 ? Math.max(25e-4, rhoT) : 25e-4;
  const AbW = Math.PI / 4 * dbW * dbW;
  const rhoWprov = 2 * AbW / (t * sW);
  const webOK = rhoWprov >= rhoT - 1e-9;
  const clampS = (r) => Math.max(50, Math.min(450, Math.floor(2 * AbW / (r * t) / 25) * 25));
  const sTreq = clampS(rhoT), sLreq = clampS(rhoL);
  const As = Mu / (phiM * fy * 0.8 * W);
  const AbBE = Math.PI / 4 * dbBE * dbBE;
  const Asprov = nBEu * AbBE;
  const flexOK = Asprov >= As - 1e-9;
  let nBEreq = Math.max(6, Math.ceil(As / AbBE));
  if (nBEreq % 2) nBEreq++;
  const I = t * W * W * W / 12, sigma = Mu * (W / 2) / I;
  const sbe = sigma > 0.2 * fc;
  showBE(sbe && useBEg);
  const le = useBEg ? Math.round(leFrac * W) : 0;
  const bc = t - 2 * cover;
  const AshReq = 0.09 * fc / fy * sEst * bc, AshProv = 2 * Math.PI / 4 * dbEst * dbEst;
  const confOK = AshProv >= AshReq - 1e-9;
  const sBElong = Math.round((le - 2 * cover) / Math.max(1, nBEx - 1));
  const rhoBE = nBEu * AbBE / (le * t) * 100;
  const ld = Math.round(fy / (1.7 * lam * sqfc) * dbBE);
  const drift = zero ? 0 : H.umax * (fo + 1) / H.ns / hw * 100;
  const driftMax = 2;
  const x0 = 22, Lpx = 576, s = Lpx / W, yT = 34, yB = 104, lePx = le * s;
  const cols = nBEx;
  let g = "";
  for (const yy of [yT + 9, yB - 9])
    g += `<line x1="${(x0 + lePx).toFixed(1)}" y1="${yy}" x2="${(x0 + Lpx - lePx).toFixed(1)}" y2="${yy}" stroke="#5ec8ff" stroke-width="1.3" opacity="0.85"/>`;
  for (const yy of [yT + 9, yB - 9])
    for (let x = x0 + lePx + sW * s; x < x0 + Lpx - lePx - 1; x += sW * s)
      g += `<circle cx="${x.toFixed(1)}" cy="${yy}" r="2.4" fill="#dfe3ea"/>`;
  const pxT = (yB - yT) / t;
  const beH = useBEg ? Math.min(150, Math.max(tBEg, t) * pxT) : yB - yT;
  const beYt = beAlignG === "lindero" ? yB - beH : (yT + yB) / 2 - beH / 2;
  if (useBEg) for (const side of [0, 1]) {
    const bx = side ? x0 + Lpx - lePx : x0;
    const bcol = sbe ? "#f5b76b" : "#8a9099", fill = sbe ? "#3a2a17" : "#242a33";
    g += `<rect x="${bx.toFixed(1)}" y="${beYt.toFixed(1)}" width="${lePx.toFixed(1)}" height="${beH.toFixed(1)}" fill="${fill}" stroke="${bcol}" stroke-width="1"/>`;
    g += `<rect x="${(bx + 6).toFixed(1)}" y="${(beYt + 6).toFixed(1)}" width="${(lePx - 12).toFixed(1)}" height="${(beH - 12).toFixed(1)}" fill="none" stroke="#5ec8ff" stroke-width="1.4"/>`;
    const xa = bx + 9, xb2 = bx + lePx - 9, ya = beYt + 14, yb2 = beYt + beH - 14;
    const dot = (X, Y) => `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3.4" fill="${bcol}"/>`;
    for (let c = 0; c < nBEx; c++) {
      const X = nBEx === 1 ? (xa + xb2) / 2 : xa + (xb2 - xa) * c / (nBEx - 1);
      g += dot(X, ya) + dot(X, yb2);
    }
    for (let r = 1; r < nBEy - 1; r++) {
      const Y = ya + (yb2 - ya) * r / (nBEy - 1);
      g += dot(xa, Y) + dot(xb2, Y);
    }
  }
  const xR = (x0 + Lpx - lePx).toFixed(0);
  const svg = `<svg viewBox="0 0 620 158" width="100%" style="background:#0c0f15;border-radius:6px">
    <rect x="${x0}" y="${yT}" width="${Lpx}" height="${yB - yT}" fill="#1b2330" stroke="#6a9bff" stroke-width="1.5"/>${g}
    <line x1="${x0}" y1="122" x2="${x0 + Lpx}" y2="122" stroke="#7a8090"/>
    <line x1="${x0}" y1="118" x2="${x0}" y2="126" stroke="#7a8090"/><line x1="${x0 + Lpx}" y1="118" x2="${x0 + Lpx}" y2="126" stroke="#7a8090"/>
    <text x="${x0 + Lpx / 2}" y="138" fill="#cfd3da" font-size="11" text-anchor="middle">l_w = ${W} mm</text>
    <text x="10" y="72" fill="#9aa0aa" font-size="10" transform="rotate(-90 10 72)" text-anchor="middle">t = ${t} mm</text>
    ${useBEg ? `<line x1="${x0}" y1="28" x2="${(x0 + lePx).toFixed(0)}" y2="28" stroke="#d09a5a"/>
    <line x1="${xR}" y1="28" x2="${x0 + Lpx}" y2="28" stroke="#d09a5a"/>
    <text x="${(x0 + lePx / 2).toFixed(0)}" y="23" fill="#d09a5a" font-size="9.5" text-anchor="middle">le=${le}</text>
    <text x="${(x0 + Lpx - lePx / 2).toFixed(0)}" y="23" fill="#d09a5a" font-size="9.5" text-anchor="middle">le=${le}</text>` : `<text x="${x0 + Lpx / 2}" y="23" fill="#ff9a6b" font-size="10" text-anchor="middle">SIN elementos de borde</text>`}
    <circle cx="${x0 + 60}" cy="147" r="2.4" fill="#dfe3ea"/><text x="${x0 + 66}" y="150" fill="#9aa0aa" font-size="9">vertical (long)</text>
    <line x1="${x0 + 145}" y1="147" x2="${x0 + 160}" y2="147" stroke="#5ec8ff" stroke-width="1.3"/><text x="${x0 + 164}" y="150" fill="#9aa0aa" font-size="9">horizontal + estribo (transversal)</text>
  </svg>`;
  const eb = 178, sE = Math.min(244 / W, eb / hw), wpx = W * sE, hpx = hw * sE, ox = (300 - wpx) / 2, oy = 8;
  let ev = `<rect x="${ox.toFixed(1)}" y="${oy}" width="${wpx.toFixed(1)}" height="${hpx.toFixed(1)}" fill="#1b2330" stroke="#6a9bff" stroke-width="1.3"/>`;
  for (let x = sW; x < W; x += sW) {
    const xp = ox + x * sE;
    ev += `<line x1="${xp.toFixed(1)}" y1="${oy}" x2="${xp.toFixed(1)}" y2="${(oy + hpx).toFixed(1)}" stroke="#6fe0ff" stroke-width="0.4" opacity="0.55"/>`;
  }
  for (let y = sW; y < hw; y += sW) {
    const yp = oy + hpx - y * sE;
    ev += `<line x1="${ox.toFixed(1)}" y1="${yp.toFixed(1)}" x2="${(ox + wpx).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#6fe0ff" stroke-width="0.4" opacity="0.55"/>`;
  }
  const ncolE = nBEx;
  if (useBEg) for (const bx of [0, W - le]) {
    const xp = ox + bx * sE, wle = le * sE;
    ev += `<rect x="${xp.toFixed(1)}" y="${oy}" width="${wle.toFixed(1)}" height="${hpx.toFixed(1)}" fill="#f5b76b" opacity="0.12"/>`;
    for (let c = 0; c < ncolE; c++) {
      const xx = xp + wle * (c + 0.5) / ncolE;
      ev += `<line x1="${xx.toFixed(1)}" y1="${oy}" x2="${xx.toFixed(1)}" y2="${(oy + hpx).toFixed(1)}" stroke="#ffb454" stroke-width="1.2"/>`;
    }
    for (let y = sEst; y < hw; y += sEst) {
      const yp = oy + hpx - y * sE;
      ev += `<line x1="${xp.toFixed(1)}" y1="${yp.toFixed(1)}" x2="${(xp + wle).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#ffb454" stroke-width="0.7"/>`;
    }
  }
  const elev = `<div style="font-size:10.5px;color:#9aa0aa;margin:8px 0 2px">Elevaci\xF3n (barras vert. + horiz. \xB7 bordes confinados)</div>
    <svg viewBox="0 0 300 ${(oy * 2 + hpx).toFixed(0)}" width="100%" style="background:#0c0f15;border-radius:6px">${ev}</svg>`;
  const tonf = (n) => (n / 9806.65).toFixed(0);
  const warn = shearFail ? `<div style="background:#5a1e2e;color:#ffd7de;font-size:10.5px;padding:4px 7px;border-radius:4px;margin:5px 0">\u26A0 Vu &gt; \u03C6Vn,m\xE1x (${tonf(phiV * VnMax)} tonf): secci\xF3n insuficiente por corte \u2192 aumentar t o f'c</div>` : "";
  const beBanner = !useBEg ? `<div style="font-size:10.5px;padding:5px 8px;border-radius:4px;margin:5px 0;background:#5a1e2e;color:#ffd7de">
        \u{1F7E5} <b>SIN elementos de borde</b> \u2014 extremos sin confinar (conf=1). Mir\xE1 c\xF3mo el da\xF1o y el aplastamiento
        crecen en los bordes.${sbe ? ` <b>\u26A0 el dise\xF1o los REQUIERE</b> (\u03C3=${sigma.toFixed(2)}&gt;0.2f\u2032c=${(0.2 * fc).toFixed(2)} MPa)` : ""}</div>` : `<div style="font-size:10.5px;padding:5px 8px;border-radius:4px;margin:5px 0;background:${sbe ? "#4a2a10" : "#1e2a1e"};color:${sbe ? "#ffb454" : "#8fce8f"}">
        ${sbe ? "\u{1F7E7} <b>Elementos de borde REQUERIDOS</b>" : "\u{1F7E9} <b>Elementos de borde NO requeridos</b>"} \xB7 \u03C3=${sigma.toFixed(2)} ${sbe ? "&gt;" : "\u2264"} 0.2f\u2032c=${(0.2 * fc).toFixed(2)} MPa</div>`;
  const chk = (ok) => ok ? ` <span style="color:#4fd08a">\u2713</span>` : ` <span style="color:#ff6b6b">\u2717 falta</span>`;
  const tbl = `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">
    <tr style="color:#9aa0aa"><td colspan="2"><b style="color:#e8e8ea">Demanda del modelo</b> (hw/lw=${ar.toFixed(2)}, fy=${fy})</td></tr>
    <tr><td>Cortante Vu</td><td style="text-align:right;color:#4fd08a">${tonf(Vu)} tonf</td></tr>
    <tr><td>Momento Mu = Vu\xB7hw</td><td style="text-align:right;color:#4fd08a">${tonf(Mu / 1e3)} tonf\xB7m</td></tr>
    <tr style="color:#9aa0aa"><td colspan="2" style="padding-top:5px"><b style="color:#e8e8ea">Alma</b> \u2014 provisto vs requerido</td></tr>
    <tr><td>Malla (tu slider)</td><td style="text-align:right;color:#f5b76b">\xD8${dbW} @ ${sW} doble</td></tr>
    <tr><td>\u03C1 provista / requerida</td><td style="text-align:right">${(rhoWprov * 100).toFixed(2)}% / ${(rhoT * 100).toFixed(2)}%${chk(webOK)}</td></tr>
    <tr style="color:#9aa0aa"><td colspan="2" style="padding-top:5px"><b style="color:#e8e8ea">Elemento de borde</b> ${le}\xD7${t} mm</td></tr>
    <tr><td>Long. borde (per\xEDmetro)</td><td style="text-align:right;color:#f5b76b">Nx${nBEx}\xB7Ny${nBEy} = ${nBEu}\xD8${dbBE}</td></tr>
    <tr><td>As provisto / requerido</td><td style="text-align:right">${(Asprov / 100).toFixed(1)} / ${(As / 100).toFixed(1)} cm\xB2${chk(flexOK)}</td></tr>
    <tr><td>Cuant\xEDa \u03C1 borde (1\u20136%)</td><td style="text-align:right;color:${rhoBE > 6 ? "#ff9a6b" : rhoBE < 1 ? "#9aa0aa" : "#4fd08a"}">${rhoBE.toFixed(2)} %</td></tr>
    <tr><td>Estribo (tu slider)</td><td style="text-align:right;color:#f5b76b">\xD8${dbEst} @ ${sEst}</td></tr>
    <tr><td>Ash provisto / requerido</td><td style="text-align:right">${AshProv.toFixed(0)} / ${AshReq.toFixed(0)} mm\xB2${chk(confOK)}</td></tr>
    <tr><td>\xBFElemento de borde especial?</td><td style="text-align:right;color:${sbe ? "#ff9a6b" : "#9aa0aa"}">${sbe ? "S\xCD requerido" : "no (\u03C3<0.2f\u2032c)"}</td></tr>
    <tr style="color:#9aa0aa"><td colspan="2" style="padding-top:5px"><b style="color:#e8e8ea">Detallado</b></td></tr>
    <tr><td>Recubrimiento</td><td style="text-align:right">${cover} mm</td></tr>
    <tr><td>Long. desarrollo ld (\xD8${dbBE})</td><td style="text-align:right">${ld} mm</td></tr>
    <tr><td>Deriva \u03B4/hw (\u2264${driftMax}%)</td><td style="text-align:right;color:${drift > driftMax ? "#ff9a6b" : "#4fd08a"}">${drift.toFixed(2)} %</td></tr>
  </table>`;
  let maxDT = 0, maxDC = 0;
  if (!zero) for (let e = 0; e < H.NE; e++) {
    maxDT = Math.max(maxDT, H.dmg[fo * H.NE + e]);
    maxDC = Math.max(maxDC, H.dmgC[fo * H.NE + e]);
  }
  const recs = [];
  if (!webOK) recs.push({ sev: 2, msg: `Malla del alma <b>insuficiente por corte</b> (\u03C1 ${(rhoWprov * 100).toFixed(2)}%&lt;${(rhoT * 100).toFixed(2)}%). \u2192 pon\xE9 <b>\xD8${dbW}@${sTreq}</b> mm (baj\xE1 el espaciamiento sW) o sub\xED el \xD8 de la malla.` });
  if (maxDT > 0.45) recs.push({ sev: maxDT > 0.7 ? 2 : 1, msg: `<b>Grieta de tracci\xF3n</b> (DAMAGET=${maxDT.toFixed(2)}). \u2192 sub\xED <b>ft</b> (mejor hormig\xF3n), densific\xE1 la malla (\u2193 sW) ${useBEg ? "" : "o <b>activ\xE1 elementos de borde</b>"}.` });
  if (maxDC > 0.4) recs.push({ sev: maxDC > 0.6 ? 2 : 1, msg: `<b>Aplastamiento</b> del tal\xF3n (DAMAGEC=${maxDC.toFixed(2)}). \u2192 aument\xE1 el <b>espesor t</b> o <b>f\u2032c</b>, y confin\xE1 el borde (\u2193 estribo sEst).` });
  if (shearFail) recs.push({ sev: 2, msg: `<b>Corte agota la secci\xF3n</b> (Vu&gt;\u03C6Vn,m\xE1x). \u2192 aument\xE1 <b>t</b> o <b>f\u2032c</b> (no alcanza con m\xE1s acero).` });
  if (sbe && useBEg && !flexOK) recs.push({ sev: 2, msg: `Acero de borde <b>insuficiente a flexi\xF3n</b> (${(Asprov / 100).toFixed(1)}&lt;${(As / 100).toFixed(1)} cm\xB2). \u2192 sub\xED a <b>${nBEreq}\xD8${dbBE}</b> o us\xE1 \xD8 mayor.` });
  if (sbe && useBEg && !confOK) recs.push({ sev: 1, msg: `Confinamiento del borde flojo (Ash ${AshProv.toFixed(0)}&lt;${AshReq.toFixed(0)} mm\xB2). \u2192 baj\xE1 el <b>estribo sEst</b> o sub\xED su \xD8.` });
  if (sbe && !useBEg) recs.push({ sev: 2, msg: `El esfuerzo pide <b>elementos de borde</b> (\u03C3=${sigma.toFixed(1)}&gt;0.2f\u2032c) y est\xE1n apagados. \u2192 <b>activalos</b>.` });
  if (drift > driftMax) recs.push({ sev: 1, msg: `<b>Deriva ${drift.toFixed(2)}%&gt;2%</b> (NEC). \u2192 rigidiz\xE1: \u2191 <b>t</b>, \u2191 <b>l_w</b> o \u2193 <b>h_w</b>.` });
  if (!recs.length) {
    const holgado = webOK && flexOK && maxDT < 0.15 && maxDC < 0.2;
    recs.push(holgado ? { sev: 0, msg: `\u2705 <b>El muro cumple con holgura.</b> Pod\xE9s <b>optimizar material</b>: sub\xED sW o baj\xE1 el \xD8 de borde y observ\xE1 que el da\xF1o no crezca.` } : { sev: 0, msg: `\u2705 <b>El muro cumple</b> los chequeos con este armado.` });
  }
  recs.sort((a, b) => b.sev - a.sev);
  const col = (s2) => s2 === 2 ? "#ff6b6b" : s2 === 1 ? "#ffd27f" : "#4fd08a";
  const bg = (s2) => s2 === 2 ? "#3a1520" : s2 === 1 ? "#3a2e12" : "#12251a";
  const optim = `<div style="margin:2px 0 8px"><div style="font-size:12px;font-weight:700;color:#ffd27f;margin-bottom:5px">\u{1F527} Asistente de optimizaci\xF3n</div>` + recs.slice(0, 4).map((r) => `<div style="font-size:11px;line-height:1.5;color:#e6ebf2;background:${bg(r.sev)};border-left:3px solid ${col(r.sev)};border-radius:4px;padding:6px 9px;margin-bottom:5px">${r.msg}</div>`).join("") + `</div>`;
  $("detail").innerHTML = optim + svg + warn + beBanner + tbl + elev;
}
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(987414);
const camera = new THREE.PerspectiveCamera(45, 1, 1, 4e4);
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2e5);
let activeCam = camera;
let viewMode = "3d";
let seisTab = "espectro";
let seisZeta = 0.05;
let seisTrib = 4;
let seisScale = 1;
let seisDeg = true;
let seisGeom = null;
let animU = null;
let animV = null;
let animDt = 0.01, animReq = 0, animT0 = 0;
let animMode = false;
let animShowCrack = true;
let hystPipOn = false;
let hystPipLastI = -1;
const APP_VER = "v104";
{
  const vb = document.createElement("div");
  vb.textContent = APP_VER;
  vb.style.cssText = "position:fixed;left:5px;bottom:5px;z-index:90;background:#12151dcc;color:#6a7482;font:10px system-ui;padding:2px 7px;border-radius:4px;pointer-events:none";
  document.body.appendChild(vb);
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
function render() {
  renderer.render(scene, activeCam);
}
function setView(mode) {
  viewMode = mode;
  if (mode !== "3d" && hystPipOn) {
    hystPipOn = false;
    const p = document.getElementById("hystPip");
    if (p) p.style.display = "none";
    canvas.style.height = "100%";
    onResize();
  }
  const draw = document.getElementById("drawing");
  if (mode === "3d") {
    if (draw) draw.style.display = "none";
    canvas.style.visibility = "visible";
    render();
    return;
  }
  if (!H || !draw) return;
  if (mode === "sismico")
    draw.innerHTML = `<div style="min-height:100%;display:flex;flex-direction:column;padding-top:46px;box-sizing:border-box">${seisToolbar()}<div id="seisChart" style="flex:1 1 320px;position:relative">${drawSeismic()}</div></div><div id="seisTip" style="position:absolute;display:none;pointer-events:none;background:#12151dee;border:1px solid #3a4557;border-radius:6px;padding:5px 8px;font:600 12px system-ui;color:#e6ebf2;z-index:30;white-space:nowrap"></div>`;
  else
    draw.innerHTML = mode === "planta" ? drawPlan() : drawElevation();
  draw.style.display = "block";
  canvas.style.visibility = "hidden";
}
const rvv = (id) => +document.getElementById(id).value;
function necSa(T, Z, Fa, Fd, Fs, eta, r) {
  const T0 = 0.1 * Fs * Fd / Fa, Tc = 0.55 * Fs * Fd / Fa;
  if (T < T0) return Z * Fa * (1 + (eta - 1) * T / T0);
  if (T <= Tc) return eta * Z * Fa;
  return eta * Z * Fa * Math.pow(Tc / T, r);
}
const NEC = { Z: 0.4, Fa: 1.2, Fd: 1.19, Fs: 1.28, eta: 1.8, r: 1, R: 3 };
const saNEC = (T) => necSa(T, NEC.Z, NEC.Fa, NEC.Fd, NEC.Fs, NEC.eta, NEC.r);
const G0 = 9.80665;
const gmCache = { NS: null, EW: null, UP: null };
let seisComp = "NS";
let userGM = null;
let userGMName = "";
function parseRecord(text) {
  const rows = [];
  for (const ln of text.split(/\r?\n/)) {
    const nums = ln.trim().split(/[\s,;\t]+/).map(Number).filter((x) => isFinite(x));
    if (nums.length) rows.push(nums);
  }
  if (rows.length < 3) return null;
  const twoCol = rows[0].length >= 2;
  const t = [], a = [];
  for (const r of rows) {
    if (twoCol) {
      if (r.length < 2) continue;
      t.push(r[0]);
      a.push(r[1]);
    } else a.push(r[0]);
  }
  if (a.length < 3) return null;
  const dt = twoCol && t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 0.02;
  let mx = 0;
  for (const v of a) if (isFinite(v)) mx = Math.max(mx, Math.abs(v));
  const scale = mx < 3 ? G0 : mx < 40 ? 1 : 0.01;
  return { ag: Float64Array.from(a, (v) => (isFinite(v) ? v : 0) * scale), dt: dt > 1e-4 ? dt : 0.02 };
}
function loadNorthridge() {
  $("status").textContent = "\u23F3 cargando Northridge\u2026";
  fetch("./northridge.txt").then((r) => r.text()).then((txt) => {
    const gm = parseRecord(txt);
    if (!gm) {
      alert("No pude leer northridge.txt");
      return;
    }
    userGM = gm;
    userGMName = "Northridge 1994 (0.57g)";
    seisComp = "FILE";
    if (seisTab === "espectro" || seisTab === "desplaz") seisTab = "registro";
    animU = null;
    setView("sismico");
  }).catch(() => alert("No pude descargar el registro Northridge"));
}
function loadElCentro() {
  $("status").textContent = "\u23F3 cargando El Centro\u2026";
  fetch("./elcentro.txt").then((r) => r.text()).then((txt) => {
    const gm = parseRecord(txt);
    if (!gm) {
      alert("No pude leer elcentro.txt");
      return;
    }
    userGM = gm;
    userGMName = "El Centro 1940 (0.32g)";
    seisComp = "FILE";
    if (seisTab === "espectro" || seisTab === "desplaz") seisTab = "registro";
    animU = null;
    setView("sismico");
  }).catch(() => alert("No pude descargar el registro El Centro"));
}
function rngS(seed) {
  return function() {
    seed |= 0;
    seed = seed + 1831565813 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function newmarkPeakS(ag, dt, wn, zeta) {
  const m = 1, k = wn * wn, c = 2 * zeta * wn, b = 0.25, gm = 0.5;
  const a0 = 1 / (b * dt * dt), a1 = gm / (b * dt), a2 = 1 / (b * dt), a3 = 1 / (2 * b) - 1, a4 = gm / b - 1, a5 = dt * (gm / (2 * b) - 1);
  const kh = k + a0 * m + a1 * c;
  let u = 0, v = 0, acc = -ag[0], peak = 0;
  for (let i = 1; i < ag.length; i++) {
    const rhs = -m * ag[i] + m * (a0 * u + a2 * v + a3 * acc) + c * (a1 * u + a4 * v + a5 * acc);
    const un = rhs / kh, an = a0 * (un - u) - a2 * v - a3 * acc, vn = v + dt * ((1 - gm) * acc + gm * an);
    u = un;
    v = vn;
    acc = an;
    if (Math.abs(u) > peak) peak = Math.abs(u);
  }
  return peak;
}
function respSpectrumS(ag, dt, Ts, zeta = 0.05) {
  return Ts.map((T) => {
    const wn = 2 * Math.PI / T;
    return newmarkPeakS(ag, dt, wn, zeta) * wn * wn / G0;
  });
}
function genGMS(dt, N, seed = 12345) {
  const rnd = rngS(seed), nf = 250, fmin = 0.1, fmax = 15, df = (fmax - fmin) / (nf - 1);
  const dw = 2 * Math.PI * df, pk = 2.8, zeta = 0.05;
  const w = [], amp = [], ph = [];
  for (let k = 0; k < nf; k++) {
    const f2 = fmin + k * df, wk = 2 * Math.PI * f2, Sa = saNEC(1 / f2) * G0;
    const Gp = 2 * zeta / (Math.PI * wk) * (Sa * Sa) / (pk * pk);
    w.push(wk);
    amp.push(Math.sqrt(2 * Gp * dw));
    ph.push(2 * Math.PI * rnd());
  }
  const td = N * dt, t1 = 0.12 * td, t2 = 0.55 * td;
  const env = (t) => t < t1 ? t / t1 * (t / t1) : t < t2 ? 1 : Math.exp(-0.9 * (t - t2) / (td - t2));
  const ag = new Float64Array(N);
  const build = () => {
    for (let i = 0; i < N; i++) {
      const t = i * dt;
      let s = 0;
      for (let k = 0; k < nf; k++) s += amp[k] * Math.sin(w[k] * t + ph[k]);
      ag[i] = env(t) * s;
    }
  };
  build();
  const Tband = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], Sr = respSpectrumS(ag, dt, Tband, 0.05);
  const ratios = Tband.map((T, j) => saNEC(T) / Sr[j]).sort((a, b) => a - b);
  const f = ratios[ratios.length >> 1];
  for (let k = 0; k < nf; k++) amp[k] *= f;
  build();
  let mean = 0;
  for (let i = 0; i < N; i++) mean += ag[i];
  mean /= N;
  for (let i = 0; i < N; i++) ag[i] -= mean;
  return { ag, dt };
}
function getGM() {
  const c = seisComp;
  let base;
  if (c === "FILE") base = userGM || genGMS(0.01, 2e3, 12345);
  else {
    if (!gmCache[c]) {
      const seed = c === "NS" ? 12345 : c === "EW" ? 54321 : 33333;
      const g = genGMS(0.01, 2e3, seed);
      if (c === "UP") for (let i = 0; i < g.ag.length; i++) g.ag[i] *= 2 / 3;
      gmCache[c] = g;
    }
    base = gmCache[c];
  }
  return seisScale === 1 ? base : { ag: Float64Array.from(base.ag, (a) => a * seisScale), dt: base.dt };
}
function envVS(bb, d) {
  if (d <= bb[0].d) return bb[0].V * d / bb[0].d;
  for (let i = 1; i < bb.length; i++) if (d <= bb[i].d) {
    const t = (d - bb[i - 1].d) / (bb[i].d - bb[i - 1].d);
    return bb[i - 1].V + t * (bb[i].V - bb[i - 1].V);
  }
  return bb[bb.length - 1].V;
}
function newmarkNLS(ag, dt, M, bb, zeta) {
  const k0 = bb[0].V / bb[0].d * 1e3, wn = Math.sqrt(k0 / M), c = 2 * zeta * wn * M, T = 2 * Math.PI / wn;
  const ss = Math.max(1, Math.min(64, Math.ceil(dt / (T / 20)))), dts = dt / ss;
  const b = 0.25, gm = 0.5, a0 = 1 / (b * dts * dts), a1 = gm / (b * dts), N = ag.length, dmax = bb[bb.length - 1].d;
  const U = new Float64Array(N), Vt = new Float64Array(N);
  const Fs = (umm) => (Math.sign(umm) || 1) * envVS(bb, Math.min(Math.abs(umm), dmax));
  const tang = (umm) => {
    const au = Math.abs(umm), h = Math.max(0.01, dmax * 1e-3);
    return (envVS(bb, Math.min(au + h, dmax)) - envVS(bb, Math.max(0, au - h))) / (2 * h) * 1e3;
  };
  let u = 0, v = 0, acc = 0;
  for (let i = 1; i < N; i++) {
    for (let s = 1; s <= ss; s++) {
      const agS = ag[i - 1] + (ag[i] - ag[i - 1]) * (s / ss);
      const p = -M * agS;
      let un = u;
      for (let it = 0; it < 12; it++) {
        const fs = Fs(un * 1e3), kt = Math.max(tang(un * 1e3), k0 * 0.02), keff = kt + a0 * M + a1 * c;
        const accN2 = a0 * (un - u) - 1 / (b * dts) * v - (1 / (2 * b) - 1) * acc, velN = v + dts * ((1 - gm) * acc + gm * accN2);
        const du = -(M * accN2 + c * velN + fs - p) / keff;
        un += du;
        if (Math.abs(du) < 1e-9) break;
      }
      const accN = a0 * (un - u) - 1 / (b * dts) * v - (1 / (2 * b) - 1) * acc;
      u = un;
      v = v + dts * ((1 - gm) * acc + gm * accN);
      acc = accN;
    }
    U[i] = u * 1e3;
    Vt[i] = Fs(u * 1e3);
  }
  return { U, Vt, wn, T };
}
function newmarkLinS(ag, dt, M, bb, zeta) {
  const k0mm = bb[0].V / bb[0].d, k0 = k0mm * 1e3, wn = Math.sqrt(k0 / M), c = 2 * zeta * wn * M, T = 2 * Math.PI / wn;
  const ss = Math.max(1, Math.min(64, Math.ceil(dt / (T / 20)))), dts = dt / ss;
  const b = 0.25, gm = 0.5, N = ag.length;
  const a0 = 1 / (b * dts * dts), a1 = gm / (b * dts), a2 = 1 / (b * dts), a3 = 1 / (2 * b) - 1, a4 = gm / b - 1, a5 = dts * (gm / (2 * b) - 1);
  const kh = k0 + a0 * M + a1 * c;
  const U = new Float64Array(N), Vt = new Float64Array(N);
  let u = 0, v = 0, acc = 0;
  for (let i = 1; i < N; i++) {
    for (let s = 1; s <= ss; s++) {
      const agS = ag[i - 1] + (ag[i] - ag[i - 1]) * (s / ss);
      const p = -M * agS;
      const rhs = p + M * (a0 * u + a2 * v + a3 * acc) + c * (a1 * u + a4 * v + a5 * acc);
      const un = rhs / kh, an = a0 * (un - u) - a2 * v - a3 * acc, vn = v + dts * ((1 - gm) * acc + gm * an);
      u = un;
      v = vn;
      acc = an;
    }
    U[i] = u * 1e3;
    Vt[i] = k0mm * U[i];
  }
  return { U, Vt, wn, T };
}
function backboneFromH() {
  const bb = [];
  for (let fr = 0; fr < H.ns; fr++) {
    const d = H.umax * (fr + 1) / H.ns, V = Math.abs(H.force[fr]) * calF();
    if (fr === 0 || V > bb[bb.length - 1].V) bb.push({ d, V });
  }
  if (bb.length < 2) bb.push({ d: bb[0].d * 2, V: bb[0].V });
  return bb;
}
function hystLoopV(U, bb) {
  const dy = bb[0].d, k0mm = bb[0].V / dy, dmaxE = bb[bb.length - 1].d;
  const envMag = (a) => envVS(bb, Math.min(a, dmaxE));
  const V = new Float64Array(U.length);
  let Fprev = 0, uprev = 0;
  for (let i = 0; i < U.length; i++) {
    const u = U[i];
    let f = Fprev + k0mm * (u - uprev);
    const cap = envMag(Math.abs(u));
    if (f > cap) f = cap;
    else if (f < -cap) f = -cap;
    V[i] = f;
    Fprev = f;
    uprev = u;
  }
  return V;
}
function dynResponse(ag, dt, M, bb) {
  if (!seisDeg) return { ...newmarkLinS(ag, dt, M, bb, seisZeta), zeff: seisZeta, xi: 0 };
  const Vcap = bb[bb.length - 1].V;
  const r0 = newmarkNLS(ag, dt, M, bb, seisZeta);
  let Vel = 0;
  for (const v of r0.Vt) Vel = Math.max(Vel, Math.abs(v));
  const xi = Math.min(0.25, 0.32 * Vel / Vcap);
  const zeff = seisZeta + xi;
  return { ...newmarkNLS(ag, dt, M, bb, zeff), zeff, xi };
}
function seisToolbar() {
  const on = "background:#2b6cb0;color:#fff", off = "background:#1a2030;color:#9fb2c8";
  const b = (id, txt) => `<button data-seis="${id}" style="${seisTab === id ? on : off};border:1px solid #33507a;border-radius:6px;padding:5px 11px;font-size:12px;cursor:pointer;white-space:nowrap">${txt}</button>`;
  const sl = (attr, k, lbl, mn, mx, st, val, dec) => `<label style="display:inline-flex;align-items:center;gap:5px;margin:0 9px 4px 0;font-size:11.5px;color:#9fb2c8;white-space:nowrap">${lbl}
      <input type="range" ${attr}="${k}" min="${mn}" max="${mx}" step="${st}" value="${val}" style="width:74px;vertical-align:middle">
      <b style="color:#ffd27f;min-width:30px;display:inline-block">${val.toFixed(dec)}</b></label>`;
  const nec = (k, lbl, mn, mx, st, dec) => sl("data-nec", k, lbl, mn, mx, st, NEC[k], dec);
  const play = `<button id="playSismo" title="Anima el muro oscilando con el sismo (\u0394(t) del Newmark)" style="background:#1e7a4a;color:#fff;border:1px solid #2fae6b;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">\u25B6 Reproducir sismo</button>`;
  const pip = `<button id="hystPipBtn" title="Muestra la curva hister\xE9tica AL LADO del muro 3D y la traza en vivo al reproducir" style="background:${hystPipOn ? "#2b6cb0" : "#1a2030"};color:${hystPipOn ? "#fff" : "#8ef0b8"};border:1px solid #2fae6b;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">\u{1FA9F} Hist\xE9resis al lado del muro</button>`;
  const tabs = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">${b("espectro", "\u{1F4C8} Espectro aceleraci\xF3n")}${b("desplaz", "\u{1F4C9} Espectro desplazamiento")}${b("registro", "\u{1F30A} Registro + respuesta")}${b("histeresis", "\u{1F501} Hist\xE9resis")}${b("derivas", "\u{1F4D0} Derivas de piso")}${play}${pip}</div>`;
  const params = `<div style="padding:4px 2px 4px;border-top:1px solid #232a36;display:flex;flex-wrap:wrap;align-items:center">
      <span style="font-size:11px;color:#7a828f;margin-right:8px">NEC-15 (Ecuador):</span>
      ${nec("Z", "Z", 0.15, 0.5, 0.01, 2)}${nec("Fa", "Fa", 0.9, 1.5, 0.01, 2)}${nec("Fd", "Fd", 0.9, 1.9, 0.01, 2)}${nec("Fs", "Fs", 0.7, 1.6, 0.01, 2)}${nec("eta", "\u03B7", 1.8, 2.6, 0.01, 2)}${nec("R", "R", 1, 8, 0.5, 1)}
      <span style="font-size:11px;color:#7a828f;margin:0 8px 0 6px">Din\xE1mico:</span>
      ${sl("data-dyn", "zeta", "\u03B6%", 2, 12, 0.5, seisZeta * 100, 1)}${sl("data-dyn", "trib", "W trib\xD7", 1, 60, 1, seisTrib, 0)}${sl("data-dyn", "scale", "Sismo \xD7", 0.3, 15, 0.05, seisScale, 2)}
      <label title="Hormig\xF3n agrietado disipa energ\xEDa (amortiguamiento equivalente), como el CDP 3D de Abaqus" style="font-size:11px;color:#9fb2c8;white-space:nowrap;margin-left:4px"><input type="checkbox" id="degChk"${seisDeg ? " checked" : ""} style="vertical-align:middle"> \u{1F504} Degradaci\xF3n c\xEDclica</label></div>`;
  const onc = "background:#2b6cb0;color:#fff", offc = "background:#1a2030;color:#9fb2c8";
  const cb = (id, txt) => `<button data-comp="${id}" style="${seisComp === id ? onc : offc};border:1px solid #33507a;border-radius:5px;padding:3px 9px;font-size:11px;cursor:pointer;margin-right:5px">${txt}</button>`;
  const fileBtn = `<label style="${seisComp === "FILE" ? onc : offc};border:1px solid #33507a;border-radius:5px;padding:3px 9px;font-size:11px;cursor:pointer;margin-right:5px">\u{1F4C2} ${userGM ? userGMName.slice(0, 16) : "Cargar archivo"}<input type="file" id="recFile" accept=".txt,.csv,.dat,.prn" style="display:none"></label>`;
  const northOn = seisComp === "FILE" && userGMName.indexOf("Northridge") === 0;
  const elcOn = seisComp === "FILE" && userGMName.indexOf("El Centro") === 0;
  const northBtn = `<button id="recNorth" title="Registro REAL de Northridge 1994 (PGA 0.57g): pulso de falla cercana casi unidireccional" style="${northOn ? onc : "background:#3a1a1a;color:#ffb3b3"};border:1px solid #a05050;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;margin-right:5px">\u{1F30E} Northridge 0.57g</button>`;
  const elcBtn = `<button id="recElc" title="Registro REAL de El Centro 1940 (PGA 0.32g): muy C\xCDCLICO (muchos ciclos) \u2192 se ve el da\xF1o crecer y formar la X" style="${elcOn ? onc : "background:#1a2f3a;color:#9fe0ff"};border:1px solid #3a7ba0;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;margin-right:5px">\u{1F30A} El Centro 1940 0.32g</button>`;
  const comps = `<div style="padding:3px 2px 0;font-size:11px;color:#7a828f;display:flex;align-items:center;flex-wrap:wrap">
      Registro: <span style="margin:0 4px"></span>${cb("NS", "N\u2013S")}${cb("EW", "E\u2013O")}${cb("UP", "Vert \u2195")}${northBtn}${elcBtn}${userGM && !northOn && !elcOn ? cb("FILE", "\u{1F4C4} Mi registro") : ""}${fileBtn}<span style="color:#5f6772;margin-left:4px">\u2014 artificial NEC-15, sismo REAL o tu archivo</span></div>`;
  const msg = `<div style="margin-top:5px;padding:6px 9px;background:#12151d;border:1px solid #2a3540;border-radius:6px;font-size:10.8px;color:#9fb2c8;line-height:1.5">
      <b style="color:#ffd27f">\u{1F4A1} C\xF3mo usar:</b> <b>Z\xB7Fa\xB7Fd\xB7Fs\xB7\u03B7\xB7R</b> = el espectro NEC-15 (peligrosidad del sitio y el suelo). <b>\u03B6%</b> = amortiguamiento. <b>W trib\xD7</b> = masa que carga el muro (pisos). <b style="color:#ffb3b3">\u{1F30E} Sismo \xD7</b> = intensidad del registro: subilo hasta que se agriete (muro r\xEDgido = poca demanda). <b style="color:#9fe0ff">\u{1F30A} El Centro</b> es muy <b>c\xEDclico</b>: se ve la grieta <b>crecer</b> y formar la <b>X</b> (dos diagonales), como el da\xF1o CDP irreversible de Abaqus que se acumula ciclo a ciclo. <b>Northridge</b> es un pulso casi unidireccional (una sola diagonal). <b>Cada slider recalcula al instante.</b></div>`;
  return `<div style="padding:2px 4px 4px;flex:0 0 auto">${tabs}${params}${comps}${msg}</div>`;
}
function drawSeismicDyn() {
  if (!H) return "";
  const { ag, dt } = getGM();
  const N = ag.length;
  let pga = 0;
  for (const a of ag) pga = Math.max(pga, Math.abs(a));
  const Wmass = 24e-7 * H.W * H.Ht * H.t * G0 / 1e3;
  const Wseis = Wmass * seisTrib;
  const M = Wseis * 1e3 / G0;
  const bb = backboneFromH();
  const res = dynResponse(ag, dt, M, bb);
  animU = res.U;
  animV = res.Vt;
  animDt = dt;
  let umx = 0, vmx = 0, tumx = 0;
  for (let i = 0; i < N; i++) {
    if (Math.abs(res.U[i]) > umx) {
      umx = Math.abs(res.U[i]);
      tumx = i * dt;
    }
    if (Math.abs(res.Vt[i]) > vmx) vmx = Math.abs(res.Vt[i]);
  }
  const Vcap = bb[bb.length - 1].V;
  const k0 = bb[0].V / bb[0].d;
  const dy = Vcap / k0, mu = umx / dy, drift = 100 * umx / H.Ht;
  const VW = 940, VH = 560, P = 60, gw = VW - P - 300;
  const tMax = N * dt;
  const strip = (y0, h, data, col, amax, unit, title) => {
    const X = (i) => P + i / (N - 1) * gw, Y = (v) => y0 + h / 2 - v / amax * (h / 2 - 6);
    let pts = "";
    for (let i = 0; i < N; i += 2) pts += `${X(i).toFixed(1)},${Y(data[i]).toFixed(1)} `;
    let g = `<rect x="${P}" y="${y0}" width="${gw}" height="${h}" fill="#0e1420" stroke="#2a3540"/>`;
    g += `<line x1="${P}" y1="${(y0 + h / 2).toFixed(1)}" x2="${P + gw}" y2="${(y0 + h / 2).toFixed(1)}" stroke="#33414f" stroke-dasharray="2 3"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.3"/>`;
    g += svgTxt(P + 6, y0 + 15, title, col, 12.5, 0, "start");
    g += svgTxt(P - 8, y0 + 12, `${amax.toFixed(amax < 1 ? 2 : 0)}`, "#8a90a0", 10, 0, "end") + svgTxt(P - 8, y0 + h - 4, `-${amax.toFixed(amax < 1 ? 2 : 0)}`, "#8a90a0", 10, 0, "end");
    return g;
  };
  const h1 = 120, h2 = 120, h3 = 120, y1 = 44, y2 = y1 + h1 + 18, y3 = y2 + h2 + 18;
  const fuente = seisComp === "FILE" ? `\u{1F4C4} ${userGMName}` : `artificial NEC-15 \xB7 comp. ${seisComp === "NS" ? "N\u2013S" : seisComp === "EW" ? "E\u2013O" : "Vertical"}`;
  let svg = strip(y1, h1, ag.map((a) => a / G0), "#ff9a6b", Math.max(pga / G0, 0.1), "g", `Aceleraci\xF3n del suelo a\u2089(t) \u2014 ${fuente} \xB7 PGA=${(pga / G0).toFixed(2)} g \xB7 dt=${dt}s`);
  svg += strip(y2, h2, res.U, "#6fe0ff", Math.max(umx, 1) * 1.1, "mm", `Desplazamiento de techo \u0394(t) \u2014 Newmark no lineal`);
  svg += strip(y3, h3, res.Vt.map((v) => v / 9806.65), "#4fd08a", Math.max(vmx / 9806.65, 1) * 1.1, "tonf", `Cortante basal V(t) \u2014 respuesta del muro`);
  for (let ts = 0; ts <= tMax; ts += 5) {
    const x = P + ts / tMax * gw;
    svg += `<line x1="${x.toFixed(1)}" y1="${y3 + h3}" x2="${x.toFixed(1)}" y2="${y3 + h3 + 5}" stroke="#556"/>` + svgTxt(x, y3 + h3 + 18, `${ts}s`, "#8a90a0", 11);
  }
  const bx = VW - 285, colr = mu > 3 ? "#ff6b6b" : mu > 1 ? "#ffd27f" : "#4fd08a";
  svg += `<rect x="${bx}" y="${y1}" width="255" height="316" rx="8" fill="#12151d" stroke="#2a3540"/>`;
  const row = (yy, a, b2, c = "#c8ccd4") => svgTxt(bx + 16, yy, a, "#8a90a0", 12, 0, "start") + svgTxt(bx + 239, yy, b2, c, 13, 0, "end");
  svg += svgTxt(bx + 16, y1 + 26, "RESPUESTA DIN\xC1MICA", "#ffd27f", 13.5, 0, "start");
  svg += row(y1 + 54, "Per\xEDodo T\u2080", `${res.T.toFixed(3)} s`);
  svg += row(y1 + 80, "Peso s\xEDsmico W", `${Wseis.toFixed(0)} kN`);
  svg += row(y1 + 106, "\u0394 techo m\xE1x", `${umx.toFixed(1)} mm`);
  svg += row(y1 + 132, "Deriva \u0394/h", `${drift.toFixed(2)} %`);
  svg += row(y1 + 158, "V basal m\xE1x", `${(vmx / 9806.65).toFixed(1)} tonf`, "#4fd08a");
  svg += row(y1 + 184, "V capacidad", `${(Vcap / 9806.65).toFixed(1)} tonf`);
  svg += row(y1 + 210, "Demanda/Capac.", `${(vmx / Vcap * 100).toFixed(0)} %`, vmx > Vcap ? "#ff6b6b" : "#4fd08a");
  svg += row(y1 + 236, "Ductilidad \u03BC=\u0394/\u0394y", `${mu.toFixed(1)}`, colr);
  const estado = mu > 3 ? "DA\xD1O SEVERO" : mu > 1.5 ? "FLUENCIA / DA\xD1O" : mu > 1 ? "INICIO FLUENCIA" : "EL\xC1STICO (sin da\xF1o)";
  svg += `<rect x="${bx + 16}" y="${y1 + 254}" width="223" height="30" rx="6" fill="${colr}22" stroke="${colr}"/>` + svgTxt(bx + 127, y1 + 274, estado, colr, 13, 0, "middle");
  svg += svgTxt(bx + 16, y1 + 306, `t(\u0394m\xE1x) = ${tumx.toFixed(1)} s`, "#8a90a0", 11.5, 0, "start");
  const degTxt = seisDeg && res.xi > 1e-3 ? ` + ${(res.xi * 100).toFixed(0)}% por agrietamiento \u2192 \u03B6_ef=${(res.zeff * 100).toFixed(0)}%` : "";
  const foot = svgTxt(VW / 2, VH - 8, `Newmark (\u03B2=\xBC, \u03B3=\xBD) \xB7 \u03B6=${(seisZeta * 100).toFixed(0)}%${degTxt} \xB7 capacidad del FEM del muro`, "#7a828f", 11);
  seisGeom = {
    kind: "rec",
    P,
    gw,
    tMax,
    N,
    strips: [
      { y0: y1, h: h1, data: ag, div: G0, unit: "g", lbl: "a\u2089", col: "#ff9a6b" },
      { y0: y2, h: h2, data: res.U, div: 1, unit: "mm", lbl: "\u0394", col: "#6fe0ff" },
      { y0: y3, h: h3, data: res.Vt, div: 9806.65, unit: "tonf", lbl: "V", col: "#4fd08a" }
    ]
  };
  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0c0f15">${svg}${foot}</svg>`;
}
function drawHysteresis() {
  if (!H) return "";
  const { ag, dt } = getGM();
  const N = ag.length;
  const Wmass = 24e-7 * H.W * H.Ht * H.t * G0 / 1e3, Wseis = Wmass * seisTrib, M = Wseis * 1e3 / G0;
  const bb = backboneFromH();
  const res = dynResponse(ag, dt, M, bb);
  animU = res.U;
  animV = res.Vt;
  animDt = dt;
  const U = res.U, V = seisDeg ? hystLoopV(res.U, bb) : res.Vt;
  let umx = 0, vmx = 0, Ediss = 0;
  for (let i = 0; i < N; i++) {
    umx = Math.max(umx, Math.abs(U[i]));
    vmx = Math.max(vmx, Math.abs(V[i]));
  }
  for (let i = 1; i < N; i++) Ediss += V[i] * (U[i] - U[i - 1]);
  Ediss = Math.abs(Ediss) * 1e-6;
  const Vcap = bb[bb.length - 1].V, k0 = bb[0].V / bb[0].d, dyEq = Vcap / k0, mu = umx / dyEq;
  const VW = 940, VH = 560, gpw = 560, gph = 460, ox = 66, oy = 46;
  const cx = ox + gpw / 2, cy = oy + gph / 2;
  const Uax = Math.max(umx * 1.15, dyEq * 0.6), Vax = Math.max(vmx / 9806.65 * 1.15, 1);
  const sx = gpw / 2 / Uax, sy = gph / 2 / Vax;
  const X = (umm) => cx + umm * sx, Y = (vN) => cy - vN / 9806.65 * sy;
  let svg = `<rect x="${ox}" y="${oy}" width="${gpw}" height="${gph}" fill="#0e1420" stroke="#2a3540"/>`;
  const uStep = Uax > 40 ? 20 : Uax > 15 ? 5 : Uax > 6 ? 2 : 1, vStep = Vax > 80 ? 25 : Vax > 30 ? 10 : Vax > 12 ? 5 : 2;
  for (let u = -Math.floor(Uax / uStep) * uStep; u <= Uax; u += uStep) {
    svg += `<line x1="${X(u).toFixed(1)}" y1="${oy}" x2="${X(u).toFixed(1)}" y2="${oy + gph}" stroke="${Math.abs(u) < 1e-6 ? "#4a5568" : "#1e2530"}"/>` + (Math.abs(u) > 1e-6 ? svgTxt(X(u), oy + gph + 16, u.toFixed(0), "#7a828f", 10) : "");
  }
  for (let vv = -Math.floor(Vax / vStep) * vStep; vv <= Vax; vv += vStep) {
    svg += `<line x1="${ox}" y1="${Y(vv * 9806.65).toFixed(1)}" x2="${ox + gpw}" y2="${Y(vv * 9806.65).toFixed(1)}" stroke="${Math.abs(vv) < 1e-6 ? "#4a5568" : "#1e2530"}"/>` + (Math.abs(vv) > 1e-6 ? svgTxt(ox - 8, Y(vv * 9806.65) + 4, vv.toFixed(0), "#7a828f", 10, 0, "end") : "");
  }
  const cap = Math.min(bb[bb.length - 1].d, Uax);
  let envP = "";
  for (let d = -cap; d <= cap; d += cap / 50) envP += `${X(d).toFixed(1)},${Y((Math.sign(d) || 1) * envVS(bb, Math.min(Math.abs(d), bb[bb.length - 1].d))).toFixed(1)} `;
  svg += `<polyline points="${envP}" fill="none" stroke="#ffb15420" stroke-width="6"/><polyline points="${envP}" fill="none" stroke="#ffb154" stroke-width="1.4" stroke-dasharray="5 4"/>`;
  const NB = 32;
  for (let bnd = 0; bnd < NB; bnd++) {
    const i0 = Math.floor(bnd * (N - 1) / NB), i1 = Math.floor((bnd + 1) * (N - 1) / NB);
    let p = "";
    for (let i = i0; i <= i1; i++) p += `${X(U[i]).toFixed(1)},${Y(V[i]).toFixed(1)} `;
    svg += `<polyline points="${p}" fill="none" stroke="hsl(${(220 - 220 * bnd / NB).toFixed(0)},78%,60%)" stroke-width="1.05" opacity="0.9"/>`;
  }
  svg += svgTxt(cx, oy + gph + 34, "Desplazamiento de techo  \u0394 (mm)", "#9fb2c8", 12.5);
  svg += svgTxt(ox - 46, cy, "V basal (tonf)", "#9fb2c8", 12.5, -90);
  svg += svgTxt(cx, oy - 12, "CURVA HISTER\xC9TICA \u2014 cada lazo es un ciclo; el \xE1rea encerrada = energ\xEDa disipada", "#ffd27f", 13.5);
  const bx = ox + gpw + 24, colr = mu > 3 ? "#ff6b6b" : mu > 1.5 ? "#ffd27f" : "#4fd08a";
  svg += `<rect x="${bx}" y="${oy}" width="230" height="300" rx="8" fill="#12151d" stroke="#2a3540"/>`;
  const row = (yy, a, b2, c = "#c8ccd4") => svgTxt(bx + 15, yy, a, "#8a90a0", 12, 0, "start") + svgTxt(bx + 215, yy, b2, c, 13, 0, "end");
  svg += svgTxt(bx + 15, oy + 26, "HIST\xC9RESIS", "#ffd27f", 13.5, 0, "start");
  svg += row(oy + 54, "V basal m\xE1x", `${(vmx / 9806.65).toFixed(1)} tonf`, "#6fb3ff");
  svg += row(oy + 80, "\u0394 techo m\xE1x", `${umx.toFixed(1)} mm`, "#6fe0ff");
  svg += row(oy + 106, "Ductilidad \u03BC", `${mu.toFixed(1)}`, colr);
  svg += row(oy + 132, "Energ\xEDa disipada", `${Ediss.toFixed(1)} kJ`, "#4fd08a");
  svg += row(oy + 158, "Rigidez inicial k\u2080", `${(k0 / 1e3).toFixed(0)} kN/mm`);
  svg += row(oy + 184, "Modelo", seisDeg ? "no lineal" : "el\xE1stico");
  const nota = seisDeg ? "Los lazos son anchos porque el hormig\xF3n agrietado y el acero fluyen disipan energ\xEDa. La pendiente (rigidez) BAJA con los ciclos = degradaci\xF3n. El elemento NO se borra, solo se ablanda." : "En din\xE1mico LINEAL/el\xE1stico NO hay lazo (la curva se retraza sobre s\xED misma). Activ\xE1 \u{1F504} Degradaci\xF3n c\xEDclica para el modelo no lineal con lazos.";
  const words = nota.split(" ");
  let line = "", ly = oy + 218;
  const lines = [];
  for (const w of words) {
    if ((line + w).length > 30) {
      lines.push(line);
      line = w + " ";
    } else line += w + " ";
  }
  lines.push(line);
  for (const l of lines) {
    svg += svgTxt(bx + 15, ly, l, "#8a90a0", 10.5, 0, "start");
    ly += 15;
  }
  if (!seisDeg) svg += `<rect x="${ox + 12}" y="${oy + 10}" width="360" height="26" rx="6" fill="#ff6b6b22" stroke="#ff6b6b"/>` + svgTxt(ox + 20, oy + 27, "\u26A0 Modelo el\xE1stico: sin lazo. Activ\xE1 'no lineal' arriba.", "#ff9a9a", 11.5, 0, "start");
  seisGeom = { kind: "hyst", cx, cy, sx, sy, ox, oy, gpw, gph };
  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0c0f15">${svg}</svg>`;
}
function drawDispSpectrum() {
  if (!H) return "";
  const Ht = H.Ht;
  const Tw = 0.055 * Math.pow(Ht / 1e3, 0.75);
  const Sd = (T) => saNEC(T) * G0 * Math.pow(T / (2 * Math.PI), 2) * 1e3;
  const VW = 940, VH = 520, P = 68, gx = VW - 2 * P, gy = VH - 2 * P - 30;
  const Tmax = 3;
  let Sdmax = 0;
  for (let T = 0; T <= Tmax; T += 0.05) Sdmax = Math.max(Sdmax, Sd(T));
  Sdmax *= 1.1;
  const X = (T) => P + T / Tmax * gx, Y = (s) => VH - P - 30 - s / Sdmax * gy;
  let curve = "";
  for (let T = 0; T <= Tmax; T += 0.02) curve += `${X(T).toFixed(1)},${Y(Sd(T)).toFixed(1)} `;
  let ax = `<line x1="${P}" y1="${Y(0)}" x2="${VW - P}" y2="${Y(0)}" stroke="#556"/><line x1="${P}" y1="${Y(0)}" x2="${P}" y2="${P}" stroke="#556"/>`;
  const sStep = Sdmax > 100 ? 25 : Sdmax > 40 ? 10 : 5;
  for (let s = sStep; s <= Sdmax; s += sStep) ax += `<line x1="${P}" y1="${Y(s)}" x2="${VW - P}" y2="${Y(s)}" stroke="#2a3038" stroke-dasharray="2 3"/>` + svgTxt(P - 10, Y(s) + 4, s.toFixed(0), "#8a90a0", 12, 0, "end");
  for (let T = 0.5; T <= Tmax; T += 0.5) ax += `<line x1="${X(T)}" y1="${Y(0)}" x2="${X(T)}" y2="${Y(0) + 5}" stroke="#556"/>` + svgTxt(X(T), Y(0) + 20, T.toFixed(1), "#8a90a0", 12);
  const sw = Sd(Tw);
  const pt = `<line x1="${X(Tw)}" y1="${Y(0)}" x2="${X(Tw)}" y2="${Y(sw)}" stroke="#ff6b6b" stroke-dasharray="4 3"/><circle cx="${X(Tw).toFixed(1)}" cy="${Y(sw).toFixed(1)}" r="6" fill="#ff6b6b"/>`;
  const spec = `<polyline points="${curve}" fill="none" stroke="#63b3ff" stroke-width="2.5"/>`;
  const labs = svgTxt(VW / 2, 26, "ESPECTRO DE DESPLAZAMIENTO NEC-15 \u2014 Sd(T) = Sa(T)\xB7g\xB7(T/2\u03C0)\xB2", "#ffd27f", 15) + svgTxt(VW / 2, VH - 6, "Sd [mm]  vs  per\xEDodo T [s]", "#8a90a0", 12) + svgTxt(X(Tw), Y(sw) - 14, `T=${Tw.toFixed(2)}s \xB7 Sd=${sw.toFixed(1)}mm`, "#ff9a9a", 13);
  const box = `<rect x="${VW - 320}" y="${P}" width="270" height="98" rx="8" fill="#12151d" stroke="#2a3540"/>` + svgTxt(VW - 300, P + 26, "Demanda de DESPLAZAMIENTO", "#ffd27f", 13, 0, "start") + svgTxt(VW - 300, P + 50, `T \u2248 ${Tw.toFixed(2)} s`, "#c8ccd4", 13, 0, "start") + svgTxt(VW - 300, P + 74, `Sd = ${sw.toFixed(1)} mm  (deriva ${(100 * sw / Ht).toFixed(2)}%)`, "#63b3ff", 14, 0, "start");
  seisGeom = { kind: "sd", P, gx, Tmax };
  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0c0f15">${labs}${ax}${spec}${pt}${box}</svg>`;
}
function drawDrift() {
  if (!H) return "";
  const Ht = H.Ht, ny = H.ny, NNx = H.nx + 1;
  const { ag, dt } = getGM();
  const Wseis = 24e-7 * H.W * Ht * H.t * G0 / 1e3 * seisTrib, M = Wseis * 1e3 / G0;
  const res = dynResponse(ag, dt, M, backboneFromH());
  let dmaxDyn = 0;
  for (const u2 of res.U) dmaxDyn = Math.max(dmaxDyn, Math.abs(u2));
  const fo = H.ns - 1, ux = [], yv = [];
  for (let j = 0; j <= ny; j++) {
    let s = 0;
    for (let i = 0; i < NNx; i++) s += H.U[fo * H.ng + 2 * (j * NNx + i)];
    ux.push(s / NNx);
    yv.push(Ht * j / ny);
  }
  const uxTop = ux[ny] || 1e-9;
  const scale = dmaxDyn / uxTop;
  const u = ux.map((v) => v * scale);
  const nStory = Math.min(12, ny), story = [];
  for (let k = 0; k < nStory; k++) {
    const j0 = Math.round(k * ny / nStory), j1 = Math.round((k + 1) * ny / nStory);
    const dd = Math.abs(u[j1] - u[j0]), dh = yv[j1] - yv[j0];
    story.push({ y0: yv[j0], y1: yv[j1], drift: dh > 0 ? 100 * dd / dh : 0 });
  }
  const maxDrift = Math.max(...story.map((s) => s.drift)), lim = 2;
  const VW = 940, VH = 540, P = 70, gw = VW - 2 * P - 300, gh = VH - 2 * P;
  const dAxMax = Math.max(maxDrift * 1.2, lim * 1.25);
  const X = (d) => P + d / dAxMax * gw, Y = (y) => VH - P - y / Ht * gh;
  let g = `<rect x="${P}" y="${VH - P - gh}" width="${gw}" height="${gh}" fill="#0e1420" stroke="#2a3540"/>`;
  for (let d = 0.5; d <= dAxMax; d += 0.5) g += `<line x1="${X(d)}" y1="${VH - P}" x2="${X(d)}" y2="${VH - P - gh}" stroke="#232c38" stroke-dasharray="2 3"/>` + svgTxt(X(d), VH - P + 16, d.toFixed(1), "#8a90a0", 11);
  for (let y = 0; y <= Ht; y += Ht / 5) g += svgTxt(P - 10, Y(y) + 4, (y / 1e3).toFixed(1), "#8a90a0", 11, 0, "end");
  g += `<line x1="${X(lim)}" y1="${VH - P}" x2="${X(lim)}" y2="${VH - P - gh}" stroke="#ff6b6b" stroke-width="1.6" stroke-dasharray="5 3"/>` + svgTxt(X(lim), VH - P - gh - 6, "l\xEDmite NEC 2%", "#ff9a9a", 11.5);
  for (const s of story) {
    const col = s.drift > lim ? "#ff6b6b" : s.drift > lim * 0.7 ? "#ffd27f" : "#4fd08a";
    g += `<rect x="${P}" y="${Y(s.y1).toFixed(1)}" width="${(X(s.drift) - P).toFixed(1)}" height="${(Y(s.y0) - Y(s.y1) - 2).toFixed(1)}" fill="${col}" opacity="0.82"/>`;
  }
  const bx = VW - 285, colr = maxDrift > lim ? "#ff6b6b" : "#4fd08a";
  g += `<rect x="${bx}" y="${P}" width="255" height="150" rx="8" fill="#12151d" stroke="#2a3540"/>`;
  g += svgTxt(bx + 16, P + 26, "DERIVAS DE PISO", "#ffd27f", 14, 0, "start");
  g += svgTxt(bx + 16, P + 52, "\u0394 techo (sismo)", "#8a90a0", 12, 0, "start") + svgTxt(bx + 239, P + 52, `${dmaxDyn.toFixed(1)} mm`, "#6fe0ff", 13, 0, "end");
  g += svgTxt(bx + 16, P + 76, "Deriva m\xE1x", "#8a90a0", 12, 0, "start") + svgTxt(bx + 239, P + 76, `${maxDrift.toFixed(2)} %`, colr, 13, 0, "end");
  g += svgTxt(bx + 16, P + 100, "L\xEDmite NEC", "#8a90a0", 12, 0, "start") + svgTxt(bx + 239, P + 100, `${lim.toFixed(1)} %`, "#c8ccd4", 13, 0, "end");
  const ok = maxDrift <= lim;
  g += `<rect x="${bx + 16}" y="${P + 116}" width="223" height="26" rx="6" fill="${colr}22" stroke="${colr}"/>` + svgTxt(bx + 127, P + 133, ok ? "CUMPLE (\u0394/h \u2264 2%)" : "NO CUMPLE \u2014 deriva excesiva", colr, 12.5, 0, "middle");
  const title = svgTxt(VW / 2, 30, "DERIVAS DE PISO \u2014 perfil de deriva \u0394/h vs altura (demanda s\xEDsmica NEC-15)", "#ffd27f", 15);
  const axl = svgTxt(P + gw / 2, VH - P + 34, "deriva de entrepiso \u0394/h [%]", "#8a90a0", 12) + svgTxt(24, VH / 2, "altura [m]", "#8a90a0", 12, -90);
  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0c0f15">${title}${g}${axl}</svg>`;
}
function drawSeismic() {
  if (!H) return "";
  if (seisTab === "registro") return drawSeismicDyn();
  if (seisTab === "desplaz") return drawDispSpectrum();
  if (seisTab === "derivas") return drawDrift();
  if (seisTab === "histeresis") return drawHysteresis();
  const W = H.W, Ht = H.Ht, t = H.t;
  const { Z, Fa, Fd, Fs, eta, r, R } = NEC;
  const Tw = 0.055 * Math.pow(Ht / 1e3, 0.75);
  const Sa = saNEC(Tw);
  const Wmass = 24e-7 * W * Ht * t * G0 / 1e3;
  const Wseis = Wmass * seisTrib;
  const Vbasal = Sa * Wseis / R;
  const frF = frame < 0 ? 0 : frame;
  const VuMuro = Math.abs(H.force[frF]) * calF() / 1e3;
  const VW = 940, VH = 520, P = 64, gx = VW - 2 * P, gy = VH - 2 * P - 30;
  const Tmax = 3, Samax = eta * Z * Fa * 1.15;
  const X = (T) => P + T / Tmax * gx, Y = (s) => VH - P - 30 - s / Samax * gy;
  let curve = "";
  for (let T = 0; T <= Tmax; T += 0.02) {
    curve += `${X(T).toFixed(1)},${Y(saNEC(T)).toFixed(1)} `;
  }
  let ax = `<line x1="${P}" y1="${Y(0)}" x2="${VW - P}" y2="${Y(0)}" stroke="#556"/><line x1="${P}" y1="${Y(0)}" x2="${P}" y2="${P}" stroke="#556"/>`;
  for (let s = 0.5; s <= Samax; s += 0.5) ax += `<line x1="${P}" y1="${Y(s)}" x2="${VW - P}" y2="${Y(s)}" stroke="#2a3038" stroke-dasharray="2 3"/>` + svgTxt(P - 10, Y(s) + 4, s.toFixed(1), "#8a90a0", 12, 0, "end");
  for (let T = 0.5; T <= Tmax; T += 0.5) ax += `<line x1="${X(T)}" y1="${Y(0)}" x2="${X(T)}" y2="${Y(0) + 5}" stroke="#556"/>` + svgTxt(X(T), Y(0) + 20, T.toFixed(1), "#8a90a0", 12);
  const pt = `<line x1="${X(Tw)}" y1="${Y(0)}" x2="${X(Tw)}" y2="${Y(Sa)}" stroke="#ff6b6b" stroke-dasharray="4 3"/><circle cx="${X(Tw).toFixed(1)}" cy="${Y(Sa).toFixed(1)}" r="6" fill="#ff6b6b"/>`;
  const spec = `<polyline points="${curve}" fill="none" stroke="#4fd08a" stroke-width="2.5"/>`;
  const labs = svgTxt(VW / 2, 26, `ESPECTRO DE DISE\xD1O NEC-15 (aceleraci\xF3n) \u2014 Ecuador \xB7 Z=${Z.toFixed(2)} \xB7 \u03B7=${eta.toFixed(2)} \xB7 R=${R.toFixed(1)}`, "#ffd27f", 15) + svgTxt(VW / 2, VH - 6, "Sa [g]  vs  per\xEDodo T [s]", "#8a90a0", 12) + svgTxt(X(Tw), Y(Sa) - 14, `T=${Tw.toFixed(2)}s \xB7 Sa=${Sa.toFixed(2)}g`, "#ff9a9a", 13);
  const bx = VW - 330, dc = VuMuro > 0 ? Vbasal / VuMuro * 100 : 0;
  const box = `<rect x="${bx}" y="${P}" width="285" height="176" rx="8" fill="#12151d" stroke="#2a3540"/>` + svgTxt(bx + 18, P + 26, "CORTANTE BASAL", "#ffd27f", 14, 0, "start") + svgTxt(bx + 18, P + 50, `T \u2248 ${Tw.toFixed(2)} s \xB7 Sa(T) = ${Sa.toFixed(2)} g`, "#c8ccd4", 12.5, 0, "start") + svgTxt(bx + 18, P + 72, `Peso s\xEDsmico W \u2248 ${Wseis.toFixed(0)} kN`, "#c8ccd4", 12.5, 0, "start") + svgTxt(bx + 18, P + 100, "Demanda NEC  V=Sa\xB7W/R", "#8a90a0", 12, 0, "start") + svgTxt(bx + 267, P + 100, `${Vbasal.toFixed(0)} kN = ${(Vbasal / 9.80665).toFixed(1)} tonf`, "#63b3ff", 13, 0, "end") + svgTxt(bx + 18, P + 126, "Del MURO  (FEM, carga lat.)", "#8a90a0", 12, 0, "start") + svgTxt(bx + 267, P + 126, `${VuMuro.toFixed(0)} kN = ${(VuMuro / 9.80665).toFixed(1)} tonf`, "#4fd08a", 13, 0, "end") + svgTxt(bx + 18, P + 152, "Demanda / Capacidad muro", "#8a90a0", 12, 0, "start") + svgTxt(bx + 267, P + 152, `${dc.toFixed(0)} %`, dc > 100 ? "#ff6b6b" : "#4fd08a", 13, 0, "end");
  seisGeom = { kind: "sa", P, gx, Tmax, y0: Y(0), yTop: P };
  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0c0f15">${labs}${ax}${spec}${pt}${box}</svg>`;
}
const svgTxt = (x, y, s, col = "#cfd3da", sz = 15, rot = 0, anch = "middle") => `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" fill="${col}" font-size="${sz}" text-anchor="${anch}" font-family="system-ui,sans-serif"${rot ? ` transform="rotate(${rot} ${x.toFixed(0)} ${y.toFixed(0)})"` : ""}>${s}</text>`;
const dimLine = (x1, y1, x2, y2) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#9fb2c8" stroke-width="1"/>`;
function drawPlan() {
  const W = H.W, t = H.t, le = useBEg ? rvv("leFrac") * W : 0, tbe = Math.max(t, tBEg);
  const sW = rvv("sW"), ncx = rvv("nBEx"), ncy = rvv("nBEy"), sbe = useBEg;
  const VW = 1e3, P = 70, Lpx = VW - 2 * P, sx = Lpx / W;
  const bandH = Math.min(120, Math.max(72, t * sx * 4));
  const pxT = bandH / t, beH = Math.min(bandH * 1.5, tbe * pxT);
  const cyc = 130, yT = cyc - bandH / 2, yB = cyc + bandH / 2, ox = P;
  const X = (x) => ox + x * sx;
  const beYt = beAlignG === "lindero" ? yB - beH : cyc - beH / 2;
  const dot = (X0, Y0, r, c) => `<circle cx="${X0.toFixed(1)}" cy="${Y0.toFixed(1)}" r="${r}" fill="${c}"/>`;
  let g = `<rect x="${X(le).toFixed(1)}" y="${yT.toFixed(1)}" width="${((W - 2 * le) * sx).toFixed(1)}" height="${bandH.toFixed(1)}" fill="#1b2330" stroke="#6a9bff" stroke-width="1.5"/>`;
  const yc1 = yT + 11, yc2 = yB - 11;
  for (let x = le + sW; x < W - le - 1; x += sW) {
    g += dot(X(x), yc1, 3.4, "#6fe0ff") + dot(X(x), yc2, 3.4, "#6fe0ff");
  }
  for (let x = le + sW, k = 0; x < W - le - 1; x += sW, k++) if (k % 2 === 0)
    g += `<line x1="${X(x).toFixed(1)}" y1="${(yc1 - 2).toFixed(1)}" x2="${X(x).toFixed(1)}" y2="${(yc2 + 2).toFixed(1)}" stroke="#7f8899" stroke-width="1"/><path d="M${(X(x) - 4).toFixed(1)},${(yc1 + 3).toFixed(1)} L${X(x).toFixed(1)},${(yc1 - 2).toFixed(1)} M${(X(x) + 4).toFixed(1)},${(yc2 - 3).toFixed(1)} L${X(x).toFixed(1)},${(yc2 + 2).toFixed(1)}" stroke="#7f8899" stroke-width="1" fill="none"/>`;
  if (le > 0) for (const side of [0, 1]) {
    const bx = side ? W - le : 0, x0 = X(bx), wle = le * sx;
    const bcol = sbe ? "#f5b76b" : "#8a9099", fill = sbe ? "#3a2a17" : "#242a33";
    g += `<rect x="${x0.toFixed(1)}" y="${beYt.toFixed(1)}" width="${wle.toFixed(1)}" height="${beH.toFixed(1)}" fill="${fill}" stroke="${bcol}" stroke-width="1.6"/>`;
    g += `<rect x="${(x0 + 8).toFixed(1)}" y="${(beYt + 8).toFixed(1)}" width="${(wle - 16).toFixed(1)}" height="${(beH - 16).toFixed(1)}" rx="5" fill="none" stroke="#ffb454" stroke-width="1.8"/>`;
    const xa = x0 + 15, xb = x0 + wle - 15, ya = beYt + 15, yb2 = beYt + beH - 15;
    for (let c = 0; c < ncx; c++) {
      const xw = ncx === 1 ? (xa + xb) / 2 : xa + (xb - xa) * c / (ncx - 1);
      g += dot(xw, ya, 4.2, bcol) + dot(xw, yb2, 4.2, bcol);
    }
    for (let r = 1; r < ncy - 1; r++) {
      const yw = ya + (yb2 - ya) * r / (ncy - 1);
      g += dot(xa, yw, 4.2, bcol) + dot(xb, yw, 4.2, bcol);
    }
    for (let c = 1; c < ncx - 1; c++) {
      const xw = xa + (xb - xa) * c / (ncx - 1);
      g += `<line x1="${xw.toFixed(1)}" y1="${(ya - 2).toFixed(1)}" x2="${xw.toFixed(1)}" y2="${(yb2 + 2).toFixed(1)}" stroke="${bcol}" stroke-width="0.9" opacity="0.8"/>`;
    }
  }
  const yb = Math.max(yB, beYt + beH) + 30;
  let d = dimLine(X(0), yb, X(W), yb) + dimLine(X(0), yb - 6, X(0), yb + 6) + dimLine(X(W), yb - 6, X(W), yb + 6) + svgTxt(X(W / 2), yb + 20, `l_w = ${(W / 1e3).toFixed(2)} m`);
  if (le > 0) {
    d += dimLine(X(0), yb - 18, X(le), yb - 18) + dimLine(X(0), yb - 22, X(0), yb - 14) + dimLine(X(le), yb - 22, X(le), yb - 14) + svgTxt(X(le / 2), yb - 24, `le=${le | 0}`, "#f5b76b", 12);
  }
  const xr = X(W) + 28, y0be = Math.min(yT, beYt), y1be = Math.max(yB, beYt + beH);
  d += dimLine(xr, y0be, xr, y1be) + dimLine(xr - 6, y0be, xr + 6, y0be) + dimLine(xr - 6, y1be, xr + 6, y1be) + svgTxt(xr + 16, cyc, `t=${t}${tbe > t ? `/${tbe | 0}` : ""}`, "#f5b76b", 12, -90);
  const VH = yb + 70;
  const title = svgTxt(VW / 2, 30, "VISTA EN PLANTA \u2014 corte horizontal \xB7 armado (espesor exagerado)", "#ffd27f", 16);
  const leg = svgTxt(VW / 2, VH - 26, `\u25CF barra long. borde (${useBEg ? "confinado" : "sin borde"})    \u25CF malla alma (doble cortina)    \u25AD estribo cerrado    \u2571 gancho/crosstie 135\xB0`, "#8a90a0", 11.5);
  const note = svgTxt(VW / 2, VH - 10, "Barras horizontales del alma anclan DENTRO del estribo del borde (gancho a 90\xB0/135\xB0) \u2014 NEC-SE-HM \xA721 / ACI 318-19 \xA718.10", "#7a828f", 11);
  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0c0f15">${title}${g}${d}${leg}${note}</svg>`;
}
function drawElevation() {
  const W = H.W, Ht = H.Ht, le = useBEg ? rvv("leFrac") * W : 0;
  const sW = rvv("sW"), sEst = rvv("sEst"), ncx = rvv("nBEx"), dbBE = rvv("dbBE"), dbEst = rvv("dbEst"), dbW = rvv("dbW");
  const VW = 1e3, P = 96, sc = Math.min((VW - 2 * P) / W, 560 / Ht);
  const wpx = W * sc, hpx = Ht * sc, ox = (VW - wpx) / 2, oy = 50, VH = hpx + 150;
  const X = (x) => ox + x * sc, Y = (y) => oy + hpx - y * sc;
  let g = `<rect x="${(ox - 30).toFixed(1)}" y="${(oy + hpx).toFixed(1)}" width="${(wpx + 60).toFixed(1)}" height="16" fill="#20242c"/>`;
  for (let x = ox - 24; x < ox + wpx + 36; x += 12) g += `<line x1="${x.toFixed(1)}" y1="${(oy + hpx + 16).toFixed(1)}" x2="${(x - 10).toFixed(1)}" y2="${(oy + hpx).toFixed(1)}" stroke="#3a4150" stroke-width="1"/>`;
  g += `<rect x="${ox.toFixed(1)}" y="${oy}" width="${wpx.toFixed(1)}" height="${hpx.toFixed(1)}" fill="#151b28" stroke="#6a9bff" stroke-width="1.6"/>`;
  for (let x = le + sW; x < W - le - 1; x += sW) {
    const xp = X(x);
    g += `<line x1="${xp.toFixed(1)}" y1="${(oy + 3).toFixed(1)}" x2="${xp.toFixed(1)}" y2="${(oy + hpx - 3).toFixed(1)}" stroke="#5ec8ff" stroke-width="1"/>`;
  }
  for (let y = sW; y < Ht; y += sW) {
    const yp = Y(y);
    g += `<line x1="${(X(le) + 2).toFixed(1)}" y1="${yp.toFixed(1)}" x2="${(X(W - le) - 2).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#5ec8ff" stroke-width="1"/>`;
  }
  if (le > 0) for (const bx of [0, W - le]) {
    const xp = X(bx), wle = le * sc;
    g += `<rect x="${xp.toFixed(1)}" y="${oy}" width="${wle.toFixed(1)}" height="${hpx.toFixed(1)}" fill="rgba(245,183,107,0.14)" stroke="#f5b76b" stroke-width="1.3"/>`;
    const xa = xp + 7, xb = xp + wle - 7;
    for (let c = 0; c < ncx; c++) {
      const xx = ncx === 1 ? (xa + xb) / 2 : xa + (xb - xa) * c / (ncx - 1);
      g += `<line x1="${xx.toFixed(1)}" y1="${(oy + 4).toFixed(1)}" x2="${xx.toFixed(1)}" y2="${(oy + hpx - 4).toFixed(1)}" stroke="#ffae3b" stroke-width="2"/>`;
    }
    for (let y = sEst / 2; y < Ht; y += sEst) {
      const yp = Y(y);
      g += `<rect x="${(xp + 4).toFixed(1)}" y="${(yp - 1.5).toFixed(1)}" width="${(wle - 8).toFixed(1)}" height="3" rx="1.5" fill="none" stroke="#ffb454" stroke-width="1.3"/>`;
    }
  }
  let d = dimLine(ox, oy + hpx + 30, ox + wpx, oy + hpx + 30) + dimLine(ox, oy + hpx + 24, ox, oy + hpx + 36) + dimLine(ox + wpx, oy + hpx + 24, ox + wpx, oy + hpx + 36) + svgTxt(ox + wpx / 2, oy + hpx + 50, `l_w = ${(W / 1e3).toFixed(2)} m`);
  if (le > 0) d += svgTxt(X(le / 2), oy + hpx + 50, `le=${le | 0}`, "#f5b76b", 12) + svgTxt(X(W - le / 2), oy + hpx + 50, `le=${le | 0}`, "#f5b76b", 12);
  d += dimLine(ox - 40, oy, ox - 40, oy + hpx) + dimLine(ox - 46, oy, ox - 34, oy) + dimLine(ox - 46, oy + hpx, ox - 34, oy + hpx) + svgTxt(ox - 46, oy + hpx / 2, `h_w = ${(Ht / 1e3).toFixed(2)} m`, "#cfd3da", 14, -90);
  const xr = ox + wpx + 30;
  d += dimLine(xr, Y(0), xr, Y(sEst)) + dimLine(xr - 5, Y(0), xr + 5, Y(0)) + dimLine(xr - 5, Y(sEst), xr + 5, Y(sEst)) + svgTxt(xr + 8, Y(sEst / 2), `estribo @${sEst}`, "#ffb454", 10.5, -90);
  d += dimLine(xr + 26, Y(sW), xr + 26, Y(2 * sW)) + dimLine(xr + 21, Y(sW), xr + 31, Y(sW)) + dimLine(xr + 21, Y(2 * sW), xr + 31, Y(2 * sW)) + svgTxt(xr + 34, Y(1.5 * sW), `malla @${sW}`, "#5ec8ff", 10.5, -90);
  const title = svgTxt(VW / 2, 28, "VISTA EN ELEVACI\xD3N \u2014 frente \xB7 armado (bordes confinados + doble malla)", "#ffd27f", 15);
  const leg = svgTxt(VW / 2, VH - 24, `\u25A8 elemento de borde ${le | 0}mm (\xD8${dbBE} vert. + estribo \xD8${dbEst}@${sEst})    \u2502\u2500 doble malla \xD8${dbW}@${sW}`, "#8a90a0", 11.5);
  const note = svgTxt(VW / 2, VH - 8, "Barras del borde continuas de piso a piso; estribos cerrados que confinan el n\xFAcleo \u2014 NEC-SE-HM \xA721", "#7a828f", 11);
  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0c0f15">${title}${g}${d}${leg}${note}</svg>`;
}
controls.addEventListener("change", render);
scene.add(new THREE.HemisphereLight(16777215, 547, 1.1));
const key = new THREE.DirectionalLight(16777215, 1.6);
key.position.set(1, 2, 3);
scene.add(key);
const geom = new THREE.BufferGeometry();
function makeCmapTex() {
  const N = 256, data = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) {
    const c = abqSmooth(k / (N - 1));
    data[k * 4] = c[0] * 255;
    data[k * 4 + 1] = c[1] * 255;
    data[k * 4 + 2] = c[2] * 255;
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
const mat = new THREE.ShaderMaterial({
  uniforms: { uMap: { value: makeCmapTex() }, uOpacity: { value: 1 } },
  vertexShader: "attribute float dmg; varying float vd; void main(){ vd = dmg; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: "precision highp float; varying float vd; uniform sampler2D uMap; uniform float uOpacity; void main(){ vec3 c = texture2D(uMap, vec2(clamp(vd,0.0,1.0),0.5)).rgb; gl_FragColor = vec4(c, uOpacity); }",
  side: THREE.DoubleSide,
  transparent: false,
  depthWrite: true
});
const mesh = new THREE.Mesh(geom, mat);
scene.add(mesh);
const wire = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0, transparent: true, opacity: 0.12 })
);
scene.add(wire);
wire.visible = false;
const dimGroup = new THREE.Group();
scene.add(dimGroup);
function makeLabel(text, color = "#cfd3da", frac = 0.05) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const fs = 44;
  ctx.font = `bold ${fs}px sans-serif`;
  c.width = Math.ceil(ctx.measureText(text).width) + 24;
  c.height = fs + 18;
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const k = Math.max(H.W, H.Ht) * frac / c.height;
  sp.scale.set(c.width * k, c.height * k, 1);
  return sp;
}
function buildDims() {
  if (!H) return;
  while (dimGroup.children.length) {
    const o = dimGroup.children.pop();
    o.material?.map?.dispose?.();
    o.material?.dispose?.();
    o.geometry?.dispose?.();
  }
  const hw2 = H.W / 2, hh = H.Ht / 2, t = H.t, off = Math.max(H.W, H.Ht) * 0.09, tk = off * 0.28;
  const line = (pts) => dimGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 10465992 })
  ));
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const yb = -hh - off;
  line([V(-hw2, yb), V(hw2, yb)]);
  line([V(-hw2, yb - tk), V(-hw2, yb + tk)]);
  line([V(hw2, yb - tk), V(hw2, yb + tk)]);
  const a = makeLabel(`l_w = ${(H.W / 1e3).toFixed(2)} m`);
  a.position.set(0, yb - off * 0.75, 0);
  dimGroup.add(a);
  const xl = -hw2 - off;
  line([V(xl, -hh), V(xl, hh)]);
  line([V(xl - tk, -hh), V(xl + tk, -hh)]);
  line([V(xl - tk, hh), V(xl + tk, hh)]);
  const b = makeLabel(`h_w = ${(H.Ht / 1e3).toFixed(2)} m`);
  b.position.set(xl - off * 1.05, 0, 0);
  dimGroup.add(b);
  const c = makeLabel(`t = ${t} mm`);
  c.position.set(hw2 * 0.55, hh + off * 0.6, t / 2);
  dimGroup.add(c);
  if (useBEg) {
    const le = Math.round(+$("leFrac").value * H.W), yb2 = -hh - off * 0.42;
    line([V(-hw2, yb2), V(-hw2 + le, yb2)]);
    line([V(-hw2, yb2 - tk * 0.6), V(-hw2, yb2 + tk * 0.6)]);
    line([V(-hw2 + le, yb2 - tk * 0.6), V(-hw2 + le, yb2 + tk * 0.6)]);
    const d = makeLabel(`borde ${le}\xD7${t}`, "#f5b76b");
    d.position.set(-hw2 + le / 2, yb2 - off * 0.42, 0);
    dimGroup.add(d);
  }
  render();
}
const rebarGroup = new THREE.Group();
scene.add(rebarGroup);
rebarGroup.visible = false;
rebarGroup.renderOrder = 999;
const barMat = new THREE.MeshBasicMaterial({ color: 16756283, depthTest: false, transparent: true });
const webMat = new THREE.MeshBasicMaterial({ color: 7332095, depthTest: false, transparent: true, opacity: 0.9 });
const estMat = new THREE.MeshBasicMaterial({ color: 16756283, depthTest: false, transparent: true });
function buildRebar() {
  if (!H) return;
  while (rebarGroup.children.length) {
    const o = rebarGroup.children.pop();
    o.geometry?.dispose?.();
  }
  const rv = (id) => +$(id).value;
  const W = H.W, Ht = H.Ht, t = H.t, cover = rv("cover"), le = useBEg ? rv("leFrac") * W : 0;
  const sW = rv("sW"), sEst = rv("sEst"), ncx = rv("nBEx"), ncy = rv("nBEy"), dbEst = rv("dbEst"), dbBE = rv("dbBE"), dbW = rv("dbW");
  const hw2 = W / 2, hh = Ht / 2, z1 = cover, z2 = t - cover;
  let zBE0 = 0, zBE1 = t;
  if (useBEg && tBEg > t) {
    if (beAlignG === "centrado") {
      zBE0 = (t - tBEg) / 2;
      zBE1 = (t + tBEg) / 2;
    } else {
      zBE0 = 0;
      zBE1 = tBEg;
    }
  }
  const barR = Math.max(6, W / 260) * dbBE / 16;
  const estR = Math.max(2.5, W / 420) * dbEst / 10;
  const sInset = cover + estR;
  const bInset = sInset + estR + barR;
  const zb1 = zBE0 + bInset, zb2 = zBE1 - bInset;
  const hL = Ht - 2 * cover;
  const geoV = new THREE.CylinderGeometry(barR, barR, hL, 8);
  const vbar = (xw, zw) => {
    const m = new THREE.Mesh(geoV, barMat);
    m.position.set(xw, 0, zw);
    rebarGroup.add(m);
  };
  if (useBEg) for (const bx0 of [-hw2, hw2 - le]) {
    const xa = bx0 + bInset, xb2 = bx0 + le - bInset;
    for (let cx = 0; cx < ncx; cx++) {
      const xw = ncx === 1 ? (xa + xb2) / 2 : xa + (xb2 - xa) * cx / (ncx - 1);
      vbar(xw, zb1);
      vbar(xw, zb2);
    }
    for (let cy = 1; cy < ncy - 1; cy++) {
      const zw = zb1 + (zb2 - zb1) * cy / (ncy - 1);
      vbar(xa, zw);
      vbar(xb2, zw);
    }
  }
  const webR = Math.max(3, W / 340) * dbW / 12;
  const geoWV = new THREE.CylinderGeometry(webR, webR, Ht - 2 * cover, 6);
  const upY = new THREE.Vector3(0, 1, 0);
  const barBetween = (ax, ay, az, bx, by, bz) => {
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az), len = dir.length();
    if (len < 1) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(webR, webR, len, 6), webMat);
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.quaternion.setFromUnitVectors(upY, dir.normalize());
    rebarGroup.add(m);
  };
  const xLend = useBEg ? -hw2 + sInset : -hw2 + cover;
  const xRend = useBEg ? hw2 - sInset : hw2 - cover;
  const geoWHspan = new THREE.CylinderGeometry(webR, webR, xRend - xLend, 6);
  for (const zc of [z1, z2]) {
    for (let x = -hw2 + le + sW; x < hw2 - le; x += sW) {
      const m = new THREE.Mesh(geoWV, webMat);
      m.position.set(x, 0, zc);
      rebarGroup.add(m);
    }
    const za = zBE0 + sInset, zb = zBE1 - sInset;
    const zHook = zc < t / 2 ? za + estR : zb - estR;
    for (let y = -hh + cover; y <= hh - cover; y += sW) {
      const m = new THREE.Mesh(geoWHspan, webMat);
      m.position.set((xLend + xRend) / 2, y, zc);
      m.rotation.z = Math.PI / 2;
      rebarGroup.add(m);
      if (useBEg) {
        barBetween(xLend, y, zc, xLend + bInset * 0.55, y, zHook);
        barBetween(xRend, y, zc, xRend - bInset * 0.55, y, zHook);
      }
    }
  }
  if (useBEg) for (const bx0 of [-hw2, hw2 - le]) {
    const x0b = bx0 + sInset, x1b = bx0 + le - sInset, za = zBE0 + sInset, zb = zBE1 - sInset;
    const ccx = (x0b + x1b) / 2, ccz = (za + zb) / 2, lenX = x1b - x0b, lenZ = zb - za;
    const geoSH = new THREE.CylinderGeometry(estR, estR, lenX, 6);
    const geoSV = new THREE.CylinderGeometry(estR, estR, lenZ, 6);
    for (let y = -hh + cover; y <= hh - cover; y += sEst) {
      for (const zz of [za, zb]) {
        const m = new THREE.Mesh(geoSH, estMat);
        m.position.set(ccx, y, zz);
        m.rotation.z = Math.PI / 2;
        rebarGroup.add(m);
      }
      for (const xx of [x0b, x1b]) {
        const m = new THREE.Mesh(geoSV, estMat);
        m.position.set(xx, y, ccz);
        m.rotation.x = Math.PI / 2;
        rebarGroup.add(m);
      }
    }
  }
  render();
  if (viewMode !== "3d") setView(viewMode);
}
const beGroup = new THREE.Group();
scene.add(beGroup);
const beMat = new THREE.MeshBasicMaterial({ color: 16747546, transparent: true, opacity: 0.32, depthWrite: false });
function buildBE() {
  if (!H) return;
  while (beGroup.children.length) {
    const o = beGroup.children.pop();
    o.geometry?.dispose?.();
  }
  if (!useBEg) {
    render();
    return;
  }
  const W = H.W, Ht = H.Ht, t = H.t, le = +$("leFrac").value * W;
  const depth = Math.max(t, tBEg) * 1.02;
  const zc = beAlignG === "centrado" ? t / 2 : tBEg / 2;
  const g = new THREE.BoxGeometry(le, Ht, depth);
  for (const sgn of [-1, 1]) {
    const m = new THREE.Mesh(g, beMat);
    m.position.set(sgn * (W / 2 - le / 2), 0, zc);
    beGroup.add(m);
  }
  render();
}
function showBE(on) {
  if (beGroup.visible !== on) {
    beGroup.visible = on;
    render();
  }
}
const loadGroup = new THREE.Group();
scene.add(loadGroup);
loadGroup.renderOrder = 998;
function makeArrow(dir, base, len, color, rad) {
  const g = new THREE.Group();
  const headLen = Math.min(len * 0.34, rad * 4.5), shaftLen = Math.max(1, len - headLen);
  const mat2 = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.4, emissive: color, emissiveIntensity: 0.18 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, shaftLen, 16), mat2);
  shaft.position.y = shaftLen / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(rad * 2.3, headLen, 22), mat2);
  head.position.y = shaftLen + headLen / 2;
  g.add(shaft, head);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.position.copy(base);
  return g;
}
function buildLoadArrows() {
  if (!H) return;
  while (loadGroup.children.length) {
    const o = loadGroup.children.pop();
    o.traverse?.((c) => {
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    });
    o.material?.map?.dispose?.();
    o.material?.dispose?.();
    o.geometry?.dispose?.();
  }
  const W = H.W, Ht = H.Ht, t = H.t, hw2 = W / 2, hh = Ht / 2, zc = t / 2;
  const L = Math.min(W, Ht) * 0.26, rad = L * 0.05;
  if (loadMode === "axial") {
    const n = 5, gap = L * 0.14;
    for (let k = 0; k < n; k++) {
      const x = -hw2 + W * (k + 0.5) / n;
      loadGroup.add(makeArrow(new THREE.Vector3(0, -1, 0), new THREE.Vector3(x, hh + gap + L, zc), L, 16734780, rad));
    }
    const lb = makeLabel("P \u2014 compresi\xF3n axial", "#ffb08a", 0.037);
    lb.position.set(0, hh + gap + L * 1.28, zc);
    loadGroup.add(lb);
  } else {
    if (gravG > 0) {
      const n = 6, Lg = L * 0.65, gap = L * 0.12;
      for (let k = 0; k < n; k++) {
        const x = -hw2 + W * (k + 0.5) / n;
        loadGroup.add(makeArrow(new THREE.Vector3(0, -1, 0), new THREE.Vector3(x, hh + gap + Lg, zc), Lg, 5939455, rad * 0.8));
      }
      const lg = makeLabel("W \u2014 gravedad (carga vertical)", "#a9d0ff", 0.037);
      lg.position.set(0, hh + gap + Lg * 1.5, zc);
      loadGroup.add(lg);
    }
    const Ll = L * 0.92, x0 = -hw2 - Ll, yTop = hh * 0.9;
    loadGroup.add(makeArrow(new THREE.Vector3(1, 0, 0), new THREE.Vector3(x0, yTop, zc), Ll, 16731469, rad * 1.35));
    const lb = makeLabel("V \u2014 sismo lateral", "#ff9a9a", 0.037);
    lb.position.set(x0 + Ll * 0.55, yTop + Ht * 0.08, zc);
    loadGroup.add(lb);
  }
  render();
}
function build3D() {
  if (!H) return;
  const zero = frame < 0;
  const fo = zero ? 0 : frame, U = H.U, dmg = dmgMode === "C" ? H.dmgC : H.dmg, W = H.W, Ht = H.Ht, tz = H.t;
  const dScale = dmgMode === "C" ? 0.6 : 0.9;
  let mu = 1e-9;
  if (!zero) for (let d = 0; d < H.ng; d++) {
    const v = Math.abs(U[fo * H.ng + d]);
    if (v > mu) mu = v;
  }
  const sf = zero || animMode ? 0 : 0.12 * Math.min(W, Ht) / mu;
  const Xd = new Float64Array(H.NN), Yd = new Float64Array(H.NN);
  for (let n = 0; n < H.NN; n++) {
    Xd[n] = H.X[n] + sf * (zero ? 0 : U[fo * H.ng + 2 * n]);
    Yd[n] = H.Y[n] + sf * (zero ? 0 : U[fo * H.ng + 2 * n + 1]);
  }
  const dmgN = new Float64Array(H.NN), cntN = new Float64Array(H.NN);
  const useAcc = accDmgSeis && animMode && animShowCrack;
  const linElastic = animMode && !animShowCrack;
  for (let e = 0; e < H.NE; e++) {
    const de = zero || linElastic ? 0 : useAcc ? accDmgSeis[e] : dmg[fo * H.NE + e];
    for (const n of H.els[e]) {
      dmgN[n] += de;
      cntN[n]++;
    }
  }
  const tN = new Float64Array(H.NN);
  for (let n = 0; n < H.NN; n++) tN[n] = clamp01((cntN[n] ? dmgN[n] / cntN[n] : 0) / dScale);
  const pos = [], dmgA = [], wl = [];
  faceElem = [];
  let curE = 0;
  const cx = W / 2, cy = Ht / 2;
  const addTri = (ax, ay, az, ta, bx, by, bz, tb, cX, cY, cZ, tc) => {
    pos.push(ax - cx, ay - cy, az, bx - cx, by - cy, bz, cX - cx, cY - cy, cZ);
    dmgA.push(ta, tb, tc);
    faceElem.push(curE);
  };
  for (let e = 0; e < H.NE; e++) {
    curE = e;
    const el = H.els[e];
    const CC = el.map((n) => tN[n]);
    const P = el.map((n) => [Xd[n], Yd[n]]);
    const i = e % H.nx, j = e / H.nx | 0;
    const cxE = W * (i + 0.5) / H.nx;
    const isBE = useBEg && (cxE < leWg || cxE > W - leWg);
    let z0 = 0, z1 = tz;
    if (isBE && tBEg > tz) {
      if (beAlignG === "centrado") {
        z0 = (tz - tBEg) / 2;
        z1 = (tz + tBEg) / 2;
      } else {
        z0 = 0;
        z1 = tBEg;
      }
    }
    for (const z of [z0, z1]) {
      addTri(P[0][0], P[0][1], z, CC[0], P[1][0], P[1][1], z, CC[1], P[2][0], P[2][1], z, CC[2]);
      addTri(P[0][0], P[0][1], z, CC[0], P[2][0], P[2][1], z, CC[2], P[3][0], P[3][1], z, CC[3]);
    }
    const edges = [];
    if (isBE) {
      edges.push([0, 1], [1, 2], [2, 3], [3, 0]);
    } else {
      if (j === 0) edges.push([0, 1]);
      if (j === H.ny - 1) edges.push([2, 3]);
      if (i === 0) edges.push([3, 0]);
      if (i === H.nx - 1) edges.push([1, 2]);
    }
    for (const [a, b] of edges) {
      addTri(P[a][0], P[a][1], z0, CC[a], P[b][0], P[b][1], z0, CC[b], P[b][0], P[b][1], z1, CC[b]);
      addTri(P[a][0], P[a][1], z0, CC[a], P[b][0], P[b][1], z1, CC[b], P[a][0], P[a][1], z1, CC[a]);
    }
    for (let a = 0; a < 4; a++) {
      const b = (a + 1) % 4;
      wl.push(P[a][0] - cx, P[a][1] - cy, z0, P[b][0] - cx, P[b][1] - cy, z0);
    }
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("dmg", new THREE.Float32BufferAttribute(dmgA, 1));
  wire.geometry.setAttribute("position", new THREE.Float32BufferAttribute(wl, 3));
  const B = build3D;
  if (B._fw !== W || B._fh !== Ht) {
    B._fw = W;
    B._fh = Ht;
    fitView(false);
  }
  window.__dbg = { camera, controls, mesh, W, Ht, R: geom.boundingSphere?.radius };
  updateDetail();
  render();
}
function fitView(resetDir) {
  geom.computeBoundingSphere();
  let R = geom.boundingSphere ? geom.boundingSphere.radius : NaN;
  if (!isFinite(R) || R < 1) R = Math.max(build3D._fw || 3e3, build3D._fh || 3e3) * 0.62;
  const fov = camera.fov * Math.PI / 180;
  const fitH = R / Math.sin(fov / 2);
  const fitW = R / Math.sin(Math.atan(Math.tan(fov / 2) * camera.aspect));
  const dist = 1.18 * Math.max(fitH, fitW);
  let d = camera.position.clone().sub(controls.target);
  if (resetDir || !isFinite(d.x) || d.length() < 1) d.set(0.22, 0, 1);
  camera.position.copy(d.normalize().multiplyScalar(dist));
  controls.target.set(0, 0, 0);
  controls.update();
  render();
}
canvas.addEventListener("dblclick", () => {
  if (viewMode === "3d") fitView(true);
});
function onResize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (viewMode !== "3d") setView(viewMode);
}
addEventListener("resize", () => {
  onResize();
  render();
});
onResize();
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tip = $("tip");
function showTip(clientX, clientY) {
  if (!H) return;
  const r = canvas.getBoundingClientRect();
  ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, activeCam);
  const hit = ray.intersectObject(mesh, false);
  const e = hit.length ? faceElem[hit[0].faceIndex] : void 0;
  if (e == null) {
    tip.style.display = "none";
    return;
  }
  const zero = frame < 0, fo = zero ? 0 : frame, b = (fo * H.NE + e) * 4;
  const s1 = zero ? 0 : H.sig[b], tau = zero ? 0 : H.sig[b + 1];
  const e1 = zero ? 0 : H.sig[b + 2], gm = zero ? 0 : H.sig[b + 3];
  const dv = zero ? 0 : H.dmg[fo * H.NE + e], dvc = zero ? 0 : H.dmgC[fo * H.NE + e];
  const xi = H.W * (e % H.nx + 0.5) / H.nx, yi = H.Ht * ((e / H.nx | 0) + 0.5) / H.ny;
  tip.innerHTML = `x = ${xi.toFixed(0)} mm \xB7 y = ${yi.toFixed(0)} mm<br><b>\u03C3\u2081</b> = ${s1.toFixed(2)} MPa<br><b>\u03C4max</b> = ${tau.toFixed(2)} MPa<br><b>\u03B5\u2081</b> = ${e1.toExponential(2)}<br><b>\u03B3max</b> = ${gm.toExponential(2)}<br><b>DAMAGET</b> (tracci\xF3n) = ${dv.toFixed(3)}<br><b>DAMAGEC</b> (compresi\xF3n) = ${dvc.toFixed(3)}`;
  tip.style.display = "block";
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let lx = clientX - r.left + 14, ly = clientY - r.top + 14;
  if (lx + tw > r.width) lx = clientX - r.left - tw - 14;
  if (ly + th > r.height) ly = clientY - r.top - th - 14;
  tip.style.left = Math.max(2, lx) + "px";
  tip.style.top = Math.max(2, ly) + "px";
}
canvas.addEventListener("mousemove", (ev) => showTip(ev.clientX, ev.clientY));
canvas.addEventListener("mouseleave", () => {
  tip.style.display = "none";
});
canvas.addEventListener("touchstart", (ev) => {
  if (ev.touches.length) showTip(ev.touches[0].clientX, ev.touches[0].clientY);
}, { passive: true });
canvas.addEventListener("touchmove", (ev) => {
  if (ev.touches.length) showTip(ev.touches[0].clientX, ev.touches[0].clientY);
}, { passive: true });
let timer = null;
let calcDelayTimer = 0;
function showCalc() {
  if (calcDelayTimer) return;
  calcDelayTimer = window.setTimeout(() => {
    const c = document.getElementById("calc");
    if (c) c.style.display = "block";
    calcDelayTimer = 0;
  }, 240);
}
function hideCalc() {
  if (calcDelayTimer) {
    clearTimeout(calcDelayTimer);
    calcDelayTimer = 0;
  }
  const c = document.getElementById("calc");
  if (c) c.style.display = "none";
}
let autoRun = true, dirty = false;
function schedule() {
  if (!autoRun) {
    dirty = true;
    $("status").textContent = "\u270B manual \u2014 presion\xE1 \u26A1 Calcular";
    const b = $("calcBtn");
    b.style.display = "block";
    return;
  }
  $("status").textContent = "\u23F3 calculando\u2026";
  showCalc();
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(solve, 60);
}
document.addEventListener("mousemove", (e) => {
  const b = document.getElementById("calcBtn");
  if (!b || b.style.display === "none") return;
  const r = b.getBoundingClientRect();
  if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < 64) return;
  let x = e.clientX + 18, y = e.clientY + 18;
  if (x + 120 > innerWidth) x = e.clientX - 120;
  if (y + 42 > innerHeight) y = e.clientY - 42;
  b.style.left = x + "px";
  b.style.top = y + "px";
});
document.getElementById("calcBtn").addEventListener("click", () => {
  dirty = false;
  document.getElementById("calcBtn").style.display = "none";
  $("status").textContent = "\u23F3 calculando\u2026";
  showCalc();
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(solve, 30);
});
document.getElementById("autoRun").addEventListener("change", (e) => {
  autoRun = e.target.checked;
  const b = $("calcBtn");
  if (autoRun) {
    b.style.display = "none";
    if (dirty) {
      dirty = false;
      schedule();
    }
  } else if (dirty) b.style.display = "block";
});
const CAL_V = 0.31, CAL_A = 0.8;
function calF() {
  return loadMode === "axial" ? CAL_A : CAL_V;
}
function loadLabel() {
  if (!H) return;
  const lbl = $("lblLoad");
  if (lbl) lbl.textContent = loadMode === "axial" ? "Carga axial (compresi\xF3n):" : "Cortante basal (calibrado a 3D):";
  if (frame < 0) {
    $("vLoad").textContent = "0.0 tonf (0 kN) \xB7 0.0 mm";
    return;
  }
  const u = H.umax * (frame + 1) / H.ns;
  const FN = Math.abs(H.force[frame]) * calF();
  const tonf = FN / 9806.65, kN = FN / 1e3;
  $("vLoad").textContent = `${tonf.toFixed(1)} tonf (${kN.toFixed(0)} kN) \xB7 ${u.toFixed(1)} mm`;
}
function setLoad() {
  frame = +$("load").value - 1;
  if (H) {
    loadLabel();
    detailing();
    build3D();
  }
}
function updateGeomLabels() {
  const lw = +$("lw").value, hwm = +$("hw_m").value;
  $("vlw_m").textContent = (lw / 1e3).toFixed(2);
  $("vhw_m").textContent = (hwm / 1e3).toFixed(2);
  $("vHW").textContent = (hwm / lw).toFixed(2);
}
function resizeGeom() {
  if (!H) return;
  const lw = +$("lw").value, hwm = +$("hw_m").value, tv = +$("t").value;
  H.W = lw;
  H.Ht = hwm;
  H.t = tv;
  const NNx = H.nx + 1;
  for (let n = 0; n < H.NN; n++) {
    const i = n % NNx, j = n / NNx | 0;
    H.X[n] = lw * i / H.nx;
    H.Y[n] = hwm * j / H.ny;
  }
  H.umax = (loadMode === "axial" ? 13e-4 : 3e-3) * hwm;
  leWg = (useBEg ? +$("leFrac").value : 0) * lw;
  detailing();
  build3D();
  buildDims();
  buildRebar();
  buildBE();
}
$("lw").oninput = () => {
  updateGeomLabels();
  resizeGeom();
  schedule();
};
$("hw_m").oninput = () => {
  updateGeomLabels();
  resizeGeom();
  schedule();
};
$("fc").oninput = () => {
  $("vFc").textContent = (+$("fc").value).toFixed(0);
  if (H) detailing();
};
$("t").oninput = () => {
  $("vT").textContent = (+$("t").value).toFixed(0);
  resizeGeom();
  schedule();
};
const SLIDER_TIPS = {
  lw: "Ancho del muro (largo en planta). Junto con el alto define la esbeltez H/W: chato\u2192cortante, largo/alto\u2192flexi\xF3n.",
  hw_m: "Alto del muro. M\xE1s alto = m\xE1s esbelto = trabaja a flexi\xF3n (grieta en la base).",
  t: "Espesor del muro. M\xE1s grueso resiste m\xE1s cortante y aplastamiento.",
  load: "Cu\xE1nta fuerza lateral (sismo) le met\xE9s: mueve la carga hasta la falla.",
  grav: "Peso de los pisos que baja por el muro (carga axial de gravedad).",
  ft: "Resistencia a tracci\xF3n del hormig\xF3n: gobierna CU\xC1NDO se agrieta (grieta diagonal/flexi\xF3n).",
  fc: "Resistencia a compresi\xF3n f\u2032c: gobierna cu\xE1ndo se APLASTA (solo dise\xF1o/capacidad).",
  fy: "Fluencia del acero: a mayor fy, las barras toman m\xE1s carga antes de ceder.",
  cover: "Recubrimiento: hormig\xF3n entre la cara y el acero (protege del \xF3xido/fuego).",
  leFrac: "Largo del elemento de borde (fracci\xF3n del ancho): la 'columna' confinada en la punta.",
  tBE: "Espesor del elemento de borde (mancuerna): m\xE1s grueso confina y resiste m\xE1s el tal\xF3n.",
  dbW: "Di\xE1metro de la malla del alma: barras que COSEN las grietas del alma.",
  sW: "Separaci\xF3n de la malla del alma: m\xE1s juntas = menos grieta (m\xE1s refuerzo).",
  nBEx: "N\xBA de barras del borde a lo largo (cara larga del elemento de borde).",
  nBEy: "N\xBA de barras del borde en el ancho (por cara del elemento de borde).",
  dbBE: "Di\xE1metro de las barras longitudinales del borde: toman la tracci\xF3n de flexi\xF3n.",
  dbEst: "Di\xE1metro del estribo: abraza el borde; m\xE1s grueso = m\xE1s confinamiento.",
  sEst: "Separaci\xF3n del estribo: m\xE1s juntos = m\xE1s confinamiento = falla m\xE1s d\xFActil."
};
for (const id in SLIDER_TIPS) {
  const el = document.getElementById(id);
  if (el) el.title = SLIDER_TIPS[id];
}
$("rebar").addEventListener("change", () => {
  const on = $("rebar").checked;
  rebarGroup.visible = on;
  mat.uniforms.uOpacity.value = on ? 0.06 : 1;
  mat.transparent = on;
  mat.depthWrite = !on;
  mat.needsUpdate = true;
  wire.visible = false;
  render();
});
const crackAffecting = /* @__PURE__ */ new Set(["fy", "leFrac", "dbW", "sW", "nBEx", "nBEy", "dbBE", "dbEst", "sEst", "cover"]);
for (const id of ["fy", "cover", "leFrac", "dbW", "sW", "nBEx", "nBEy", "dbBE", "dbEst", "sEst"]) {
  const el = $(id);
  const span = $("v" + id.charAt(0).toUpperCase() + id.slice(1));
  el.oninput = () => {
    span.textContent = id === "leFrac" ? Math.round(+el.value * 3e3) + " mm" : el.value;
    if (H) {
      detailing();
      buildRebar();
    }
    if (crackAffecting.has(id)) schedule();
  };
}
$("ft").oninput = () => {
  $("vFt").textContent = (+$("ft").value).toFixed(1);
  schedule();
};
$("load").oninput = setLoad;
$("weak").addEventListener("change", schedule);
$("useBE").addEventListener("change", schedule);
$("tBE").oninput = () => {
  $("vTBE").textContent = (+$("tBE").value).toFixed(0) + " mm";
  schedule();
};
$("beAlign").addEventListener("change", () => {
  beAlignG = $("beAlign").value === "lindero" ? "lindero" : "centrado";
  if (H) {
    build3D();
    buildBE();
    buildRebar();
    detailing();
  }
});
$("grav").oninput = () => {
  $("vGrav").textContent = (+$("grav").value).toFixed(1) + " mm";
  schedule();
};
function setFailure(mode) {
  const keep = $("keepDim").checked;
  const setHW = (val) => {
    if (keep) return;
    const lw = +$("lw").value, hwm = Math.min(12e3, Math.max(1500, Math.round(+val * lw / 100) * 100));
    $("hw_m").value = String(hwm);
    updateGeomLabels();
  };
  const setWeak = (b) => {
    $("weak").checked = b;
  };
  const setLoad2 = (lt) => {
    loadMode = lt;
    $("loadType").value = lt;
  };
  if (mode === "cortante") {
    setHW("0.8");
    setWeak(false);
    setLoad2("lateral");
  } else if (mode === "flexion") {
    setHW("2.5");
    setWeak(false);
    setLoad2("lateral");
  } else if (mode === "deslizamiento") {
    setHW("0.8");
    setWeak(true);
    setLoad2("lateral");
  } else if (mode === "compresion") {
    setLoad2("axial");
    setWeak(false);
  }
  const dm = loadMode === "axial" ? "C" : "T";
  dmgMode = dm;
  $("dmgMode").value = dm;
  $("cbMax").textContent = dm === "C" ? "0.60" : "0.90";
  $("cbLbl").textContent = dm === "C" ? "DAMAGEC" : "DAMAGET";
  if (!keep) {
    $("load").value = "50";
    frame = 49;
  }
  schedule();
}
$("failMode").addEventListener("change", () => setFailure($("failMode").value));
$("analysis").addEventListener("change", () => {
  const a = $("analysis").value;
  if (animMode) stopSismo();
  if (a === "pushover") {
    setView("3d");
    return;
  }
  seisDeg = a === "dinnl";
  animShowCrack = a === "dinnl";
  if (a === "dinnl") seisTrib = 30;
  const d = $("degChk");
  if (d) d.checked = seisDeg;
  animU = null;
  seisTab = "registro";
  setView("sismico");
});
$("dmgMode").addEventListener("change", () => {
  dmgMode = $("dmgMode").value === "C" ? "C" : "T";
  $("cbMax").textContent = dmgMode === "C" ? "0.60" : "0.90";
  $("cbLbl").textContent = dmgMode === "C" ? "DAMAGEC" : "DAMAGET";
  if (H) build3D();
});
$("loadType").addEventListener("change", () => {
  loadMode = $("loadType").value === "axial" ? "axial" : "lateral";
  const dm = loadMode === "axial" ? "C" : "T";
  dmgMode = dm;
  $("dmgMode").value = dm;
  $("cbMax").textContent = dm === "C" ? "0.60" : "0.90";
  $("cbLbl").textContent = dm === "C" ? "DAMAGEC" : "DAMAGET";
  schedule();
});
document.querySelectorAll("#views button").forEach((b) => b.addEventListener("click", () => {
  if (animMode) stopSismo();
  setView(b.dataset.v);
  document.querySelectorAll("#views button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on");
}));
document.getElementById("drawing").addEventListener("click", (ev) => {
  if (ev.target.closest("#hystPipBtn")) {
    toggleHystPip();
    return;
  }
  if (ev.target.closest("#recNorth")) {
    loadNorthridge();
    return;
  }
  if (ev.target.closest("#recElc")) {
    loadElCentro();
    return;
  }
  if (ev.target.closest("#playSismo")) {
    playSismo();
    return;
  }
  const t = ev.target.closest("[data-seis]");
  if (t) {
    seisTab = t.dataset.seis;
    setView("sismico");
    return;
  }
  const c = ev.target.closest("[data-comp]");
  if (c) {
    seisComp = c.dataset.comp;
    setView("sismico");
  }
});
function setSceneSplit(on) {
  canvas.style.height = on ? "58%" : "100%";
  onResize();
  render();
}
function ensureHystPip() {
  let o = document.getElementById("hystPip");
  if (!o) {
    o = document.createElement("div");
    o.id = "hystPip";
    o.style.cssText = "position:absolute;left:0;right:0;bottom:0;z-index:40;height:42%;min-height:180px;background:#0c0f15;border-top:2px solid #2fae6b;box-shadow:0 -4px 16px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden";
    o.innerHTML = `<div style="background:#132018;border-bottom:1px solid #2a3540;padding:5px 10px;font:600 12px system-ui;color:#8ef0b8;display:flex;justify-content:space-between;align-items:center"><span>\u{1F501} Curva hister\xE9tica V\u2013\u0394 (en vivo con \u25B6)</span><span id="hystPipClose" style="cursor:pointer;color:#ff9a9a;font-weight:700;padding:0 5px">\u2715</span></div><div id="hystPipBody" style="flex:1;min-height:0"></div>`;
    document.getElementById("left").appendChild(o);
    o.querySelector("#hystPipClose").addEventListener("click", () => {
      hystPipOn = false;
      o.style.display = "none";
      setSceneSplit(false);
    });
  }
  o.style.display = "flex";
  return o;
}
function hystPipSVG(upto) {
  if (!animU || !H) return `<div style="color:#8a90a0;font:12px system-ui;padding:14px;line-height:1.5">Puls\xE1 <b style="color:#8ef0b8">\u25B6 Reproducir sismo</b> para ver el lazo y el punto movi\xE9ndose.</div>`;
  const bb = backboneFromH(), U = animU, V = hystLoopV(U, bb), N = U.length;
  let umx = 0, vmx = 0;
  for (let i = 0; i < N; i++) {
    umx = Math.max(umx, Math.abs(U[i]));
    vmx = Math.max(vmx, Math.abs(V[i] / 9806.65));
  }
  const W = 620, Hh = 250, ox = 52, oy = 12, gw = W - ox - 16, gh = Hh - oy - 30, cx = ox + gw / 2, cy = oy + gh / 2;
  const Uax = Math.max(umx * 1.12, 0.4), Vax = Math.max(vmx * 1.12, 1);
  const X = (u) => cx + u * (gw / 2) / Uax, Y = (vt) => cy - vt * (gh / 2) / Vax;
  let s = `<rect x="${ox}" y="${oy}" width="${gw}" height="${gh}" fill="#0e1420" stroke="#2a3540"/>`;
  const uStep = Uax > 20 ? 10 : Uax > 8 ? 4 : Uax > 3 ? 2 : Uax > 1.2 ? 0.5 : 0.2, vStep = Vax > 80 ? 40 : Vax > 30 ? 20 : Vax > 12 ? 10 : 5;
  for (let u = Math.ceil(-Uax / uStep) * uStep; u <= Uax; u += uStep) {
    s += `<line x1="${X(u).toFixed(1)}" y1="${oy}" x2="${X(u).toFixed(1)}" y2="${oy + gh}" stroke="${Math.abs(u) < 1e-9 ? "#4a5568" : "#1b222c"}"/>`;
    if (Math.abs(u) > 1e-9) s += svgTxt(X(u), oy + gh + 14, Math.abs(u) < 1 ? u.toFixed(1) : u.toFixed(0), "#7a828f", 9);
  }
  for (let vv = Math.ceil(-Vax / vStep) * vStep; vv <= Vax; vv += vStep) {
    s += `<line x1="${ox}" y1="${Y(vv).toFixed(1)}" x2="${ox + gw}" y2="${Y(vv).toFixed(1)}" stroke="${Math.abs(vv) < 1e-9 ? "#4a5568" : "#1b222c"}"/>`;
    if (Math.abs(vv) > 1e-9) s += svgTxt(ox - 6, Y(vv) + 3, vv.toFixed(0), "#7a828f", 9, 0, "end");
  }
  const cap = Math.min(bb[bb.length - 1].d, Uax);
  let ep = "";
  for (let d = -cap; d <= cap; d += cap / 40) ep += `${X(d).toFixed(1)},${Y((Math.sign(d) || 1) * envVS(bb, Math.min(Math.abs(d), bb[bb.length - 1].d)) / 9806.65).toFixed(1)} `;
  s += `<polyline points="${ep}" fill="none" stroke="#ffb15433" stroke-width="1.1" stroke-dasharray="4 4"/>`;
  let p = "";
  for (let i = 0; i < N; i += 2) p += `${X(U[i]).toFixed(1)},${Y(V[i] / 9806.65).toFixed(1)} `;
  s += `<polyline points="${p}" fill="none" stroke="#5fd0ff" stroke-width="1.15" opacity="0.9"/>`;
  const j = upto == null ? N - 1 : Math.min(N - 1, upto);
  if (j >= 0) s += `<circle cx="${X(U[j]).toFixed(1)}" cy="${Y(V[j] / 9806.65).toFixed(1)}" r="4" fill="#ff5a5a" stroke="#fff" stroke-width="1"/>`;
  s += svgTxt(cx, Hh - 6, "\u0394 techo (mm)", "#9fb2c8", 11) + svgTxt(ox - 40, cy, "V basal (tonf)", "#9fb2c8", 11, -90);
  s += svgTxt(ox + 6, oy + 13, `pico: V=${vmx.toFixed(0)} tonf \xB7 \u0394=${umx.toFixed(1)} mm \xB7 energ\xEDa\u222E`, "#7a828f", 9.5, 0, "start");
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}
function renderHystPip(upto) {
  if (!hystPipOn) return;
  ensureHystPip().querySelector("#hystPipBody").innerHTML = hystPipSVG(upto);
}
function toggleHystPip() {
  hystPipOn = !hystPipOn;
  const o = document.getElementById("hystPip");
  if (!hystPipOn) {
    if (o) o.style.display = "none";
    setSceneSplit(false);
    if (viewMode === "sismico") setView("sismico");
    return;
  }
  if (!animU) {
    const p = seisTab;
    seisTab = "registro";
    drawSeismic();
    seisTab = p;
  }
  setView("3d");
  ensureHystPip();
  setSceneSplit(true);
  renderHystPip();
}
function ensureAnimCtl() {
  let o = document.getElementById("animCtl");
  if (!o) {
    o = document.createElement("div");
    o.id = "animCtl";
    o.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:70;background:#12151def;border:1px solid #2fae6b;border-radius:8px;padding:7px 14px;color:#e6ebf2;font:600 13px system-ui;display:flex;align-items:center;gap:12px;box-shadow:0 4px 14px rgba(0,0,0,.5)";
    o.innerHTML = `<span id="animMode" style="font-weight:700"></span><span id="animT">t = 0.0 s</span><button id="animStop" style="background:#a33;color:#fff;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-weight:700">\u23F9 Detener</button>`;
    document.body.appendChild(o);
    o.querySelector("#animStop").addEventListener("click", stopSismo);
  }
  o.style.display = "flex";
  return o;
}
function stopSismo() {
  if (animReq) cancelAnimationFrame(animReq);
  animReq = 0;
  animMode = false;
  accDmgSeis = null;
  seisEvents = [];
  mesh.matrixAutoUpdate = true;
  mesh.matrix.identity();
  mesh.matrixWorldNeedsUpdate = true;
  dimGroup.visible = true;
  loadGroup.visible = true;
  beGroup.visible = true;
  frame = +$("load").value - 1;
  build3D();
  const o = document.getElementById("animCtl");
  if (o) o.style.display = "none";
  hystPipLastI = -1;
  if (hystPipOn) renderHystPip();
}
function playSismo() {
  if (animReq) {
    stopSismo();
    return;
  }
  if (!H) return;
  if (!animU) {
    const p = seisTab;
    seisTab = "registro";
    drawSeismic();
    seisTab = p;
  }
  if (!animU) return;
  setView("3d");
  fitView(true);
  dimGroup.visible = false;
  loadGroup.visible = false;
  beGroup.visible = false;
  const U = animU, dt = animDt, Ht = H.Ht, N = U.length, dur = N * dt, umax = H.umax, ns = H.ns;
  let maxD = 1e-6;
  for (const u of U) maxD = Math.max(maxD, Math.abs(u));
  let vpk = 0;
  if (animV) for (const vv of animV) vpk = Math.max(vpk, Math.abs(vv));
  seisPkV = vpk / 9806.65;
  seisPkDrift = maxD / Ht * 100;
  const amp = 0.1 * Ht / maxD;
  const runMax = new Float64Array(N);
  let rm = 0;
  for (let i = 0; i < N; i++) {
    rm = Math.max(rm, Math.abs(U[i]));
    runMax[i] = rm;
  }
  const ctl = ensureAnimCtl(), lbl = ctl.querySelector("#animT");
  const md = ctl.querySelector("#animMode");
  md.textContent = animShowCrack ? "\u{1F534} NO LINEAL \xB7 " : "\u{1F535} LINEAL (el\xE1stico) \xB7 ";
  md.style.color = animShowCrack ? "#ff8a6b" : "#7fb8ff";
  animMode = true;
  mesh.matrixAutoUpdate = false;
  const crackFrame = (i) => Math.min(ns - 1, Math.round(runMax[i] / umax * (ns - 1)));
  const NE = H.NE, srcDmg = dmgMode === "C" ? H.dmgC : H.dmg, dScaleA = dmgMode === "C" ? 0.6 : 0.9;
  const CYC = 0.6, ref = (ns - 1) * NE;
  accDmgSeis = new Float64Array(NE);
  let maxAcc = 0, prevDir = 0;
  const applyHalfCycle = (a, dir) => {
    const r = Math.min(1, a / umax);
    if (r < 0.03) return false;
    const neg = dir < 0, r2 = r * r;
    let grew = false;
    for (let e = 0; e < NE; e++) {
      const w = srcDmg[ref + (neg ? mirrorIdx[e] : e)] / dScaleA;
      if (w < 0.01) continue;
      const v = Math.min(dScaleA, accDmgSeis[e] + w * CYC * r2);
      if (v > accDmgSeis[e]) {
        accDmgSeis[e] = v;
        if (v > maxAcc) maxAcc = v;
        grew = true;
      }
    }
    return grew;
  };
  const accRange = (from, to) => {
    let grew = false;
    for (let j = Math.max(1, from + 1); j <= to; j++) {
      const dj = Math.sign(U[j] - U[j - 1]);
      if (dj !== 0) {
        if (prevDir !== 0 && dj !== prevDir) {
          if (applyHalfCycle(Math.abs(U[j - 1]), Math.sign(U[j - 1]) || 1)) grew = true;
        }
        prevDir = dj;
      }
    }
    return grew;
  };
  let tStart = 0, lastProcI = 0;
  if (animShowCrack) {
    let iC = 0;
    for (let i = 0; i < N; i++) if (crackFrame(i) >= 6) {
      iC = i;
      break;
    }
    tStart = Math.max(0, iC * dt - 2);
    const iStart = Math.floor(tStart / dt);
    accRange(0, iStart);
    lastProcI = iStart;
    frame = 1;
    build3D();
  } else {
    build3D();
  }
  const SPEED = Math.max(0.05, Math.min(1, (dur - tStart) / 62));
  const t0for = (ts) => performance.now() - ts / SPEED * 1e3;
  animT0 = t0for(tStart);
  seisEvents = [];
  let evInit = false, evDiag = false, evSevere = false, evCrit = false;
  const recEvent = (tt, msg) => {
    seisEvents.push({ t: tt, msg });
    updateDetail();
  };
  const kMech = mechKey(), whereInit = kMech === "flexion" ? "la <b>base</b> (borde traccionado)" : kMech === "deslizamiento" ? "la <b>junta de la base</b>" : kMech === "compresion" ? "los <b>talones</b>" : "una <b>diagonal a 45\xB0</b>";
  const loop = () => {
    let el = (performance.now() - animT0) / 1e3 * SPEED;
    if (el >= dur) {
      const iF = N - 1;
      if (animShowCrack) {
        accRange(lastProcI, N - 1);
        lastProcI = N - 1;
        build3D();
      }
      mesh.matrix.identity();
      mesh.matrixWorldNeedsUpdate = true;
      if (hystPipOn) renderHystPip(iF);
      const dmgF = animShowCrack ? Math.min(100, maxAcc / dScaleA * 100) : 0;
      if (animShowCrack && !seisEvents.some((e) => e.msg.indexOf("fin") >= 0))
        recEvent(dur, `<b>fin del sismo</b> \u2014 da\xF1o final DAMAGET ${maxAcc.toFixed(2)} (${dmgF.toFixed(0)}%). ${maxAcc < 0.1 ? "el muro <b>sobrevivi\xF3</b> casi el\xE1stico." : maxAcc < 0.6 ? "el muro qued\xF3 <b>agrietado pero en pie</b>." : "el muro qued\xF3 con <b>da\xF1o severo</b>."}`);
      lbl.innerHTML = animShowCrack ? `\u2713 Fin del sismo (${dur.toFixed(0)} s) \xB7 da\xF1o final = <b style="color:#ff8a6b">${dmgF.toFixed(0)}%</b> \xB7 puls\xE1 \u25B6 para repetir` : `\u2713 Fin del sismo (${dur.toFixed(0)} s) \xB7 el\xE1stico (sin da\xF1o) \xB7 puls\xE1 \u25B6 para repetir`;
      render();
      cancelAnimationFrame(animReq);
      animReq = 0;
      return;
    }
    const t = el, i = Math.min(N - 1, Math.floor(t / dt)), D = U[i];
    if (animShowCrack) {
      if (accRange(lastProcI, i)) build3D();
      lastProcI = i;
      if (maxAcc > 0) {
        if (!evInit && maxAcc >= 0.08) {
          evInit = true;
          recEvent(t, `la grieta <b>inicia</b> en ${whereInit} (DAMAGET 0.1)`);
        }
        if (!evDiag && kMech === "cortante" && maxAcc >= 0.2 && analyzeCrack((e) => accDmgSeis[e]).diagBoth) {
          evDiag = true;
          recEvent(t, `el sismo <b>invirti\xF3</b> la carga \u2192 se abre la <b>2\xAA diagonal</b> (forma la X)`);
        }
        if (!evSevere && maxAcc >= 0.6) {
          evSevere = true;
          recEvent(t, `grieta <b>severa</b> (DAMAGET 0.6, ~67% del rango)`);
        }
        if (!evCrit && maxAcc >= 0.85) {
          evCrit = true;
          recEvent(t, `da\xF1o <b>cr\xEDtico</b>: los elementos <b>ceden</b> (DAMAGET 0.9)`);
        }
      }
    }
    if (hystPipOn && (i - hystPipLastI >= 3 || i < hystPipLastI)) {
      hystPipLastI = i;
      renderHystPip(i);
    }
    const k = amp * D / Ht;
    mesh.matrix.set(1, k, 0, k * Ht / 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    mesh.matrixWorldNeedsUpdate = true;
    const V = animV ? Math.abs(animV[i]) / 9806.65 : 0;
    const dmg = animShowCrack ? Math.min(100, maxAcc / dScaleA * 100) : 0;
    lbl.innerHTML = animShowCrack ? `t=${t.toFixed(1)}s \xB7 <b style="color:#8fd0ff">ahora</b> \u0394=${D.toFixed(2)}mm V=${V.toFixed(1)}t \xB7 <b style="color:#ff8a6b">grieta acumulada</b> DAMAGET=${maxAcc.toFixed(2)} da\xF1o=${dmg.toFixed(0)}%` : `t=${t.toFixed(1)}s \xB7 \u0394=${D.toFixed(2)}mm \xB7 V=${V.toFixed(1)}tonf (el\xE1stico, sin da\xF1o)`;
    render();
    animReq = requestAnimationFrame(loop);
  };
  loop();
}
document.getElementById("drawing").addEventListener("change", (ev) => {
  const inp = ev.target;
  if (inp.id === "degChk") {
    seisDeg = inp.checked;
    setView("sismico");
    return;
  }
  if (inp.id !== "recFile" || !inp.files || !inp.files[0]) return;
  const f = inp.files[0], rd = new FileReader();
  rd.onload = () => {
    const gm = parseRecord(String(rd.result));
    if (!gm) {
      alert("No pude leer el registro. Us\xE1 txt/csv: 1 columna (aceleraci\xF3n) o 2 columnas (tiempo, aceleraci\xF3n).");
      return;
    }
    userGM = gm;
    userGMName = f.name;
    seisComp = "FILE";
    if (seisTab === "espectro" || seisTab === "desplaz") seisTab = "registro";
    setView("sismico");
  };
  rd.readAsText(f);
});
document.getElementById("drawing").addEventListener("mousemove", (ev) => {
  const chart = document.getElementById("seisChart"), tip2 = document.getElementById("seisTip");
  if (!chart || !tip2 || !seisGeom || viewMode !== "sismico") return;
  const svg = chart.querySelector("svg");
  if (!svg || !(ev.target instanceof Element) || !svg.contains(ev.target)) {
    tip2.style.display = "none";
    return;
  }
  const m = svg.getScreenCTM();
  if (!m) return;
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const uc = pt.matrixTransform(m.inverse());
  const G = seisGeom;
  let html = "";
  if (G.kind === "sa" || G.kind === "sd") {
    const T = (uc.x - G.P) / G.gx * G.Tmax;
    if (T < 0 || T > G.Tmax) {
      tip2.style.display = "none";
      return;
    }
    if (G.kind === "sa") html = `T = ${T.toFixed(2)} s<br>Sa = ${saNEC(T).toFixed(3)} g`;
    else {
      const Sd = saNEC(T) * G0 * Math.pow(T / (2 * Math.PI), 2) * 1e3;
      html = `T = ${T.toFixed(2)} s<br>Sd = ${Sd.toFixed(1)} mm`;
    }
  } else if (G.kind === "rec") {
    const t = (uc.x - G.P) / G.gw * G.tMax;
    if (t < 0 || t > G.tMax) {
      tip2.style.display = "none";
      return;
    }
    const s = G.strips.find((s2) => uc.y >= s2.y0 && uc.y <= s2.y0 + s2.h);
    if (!s) {
      tip2.style.display = "none";
      return;
    }
    const i = Math.min(G.N - 1, Math.max(0, Math.round(t / G.tMax * (G.N - 1))));
    html = `t = ${t.toFixed(2)} s<br>${s.lbl} = ${(s.data[i] / s.div).toFixed(s.div === 1 ? 1 : 3)} ${s.unit}`;
  } else if (G.kind === "hyst") {
    if (uc.x < G.ox || uc.x > G.ox + G.gpw || uc.y < G.oy || uc.y > G.oy + G.gph) {
      tip2.style.display = "none";
      return;
    }
    const u = (uc.x - G.cx) / G.sx, v = (G.cy - uc.y) / G.sy;
    html = `\u0394 = ${u.toFixed(1)} mm<br>V = ${v.toFixed(1)} tonf`;
  } else {
    tip2.style.display = "none";
    return;
  }
  const dr = document.getElementById("drawing").getBoundingClientRect();
  tip2.innerHTML = html;
  tip2.style.display = "block";
  tip2.style.left = ev.clientX - dr.left + 14 + "px";
  tip2.style.top = ev.clientY - dr.top + 14 + "px";
});
document.getElementById("drawing").addEventListener("mouseleave", () => {
  const t = document.getElementById("seisTip");
  if (t) t.style.display = "none";
});
document.getElementById("drawing").addEventListener("input", (ev) => {
  const t = ev.target, kn = t.dataset.nec, kd = t.dataset.dyn;
  if (!kn && !kd) return;
  let dec = 2;
  if (kn) {
    NEC[kn] = +t.value;
    gmCache.NS = gmCache.EW = gmCache.UP = null;
    dec = kn === "R" || kn === "r" ? 1 : 2;
  } else if (kd === "zeta") {
    seisZeta = +t.value / 100;
    dec = 1;
  } else if (kd === "trib") {
    seisTrib = +t.value;
    dec = 1;
  } else if (kd === "scale") {
    seisScale = +t.value;
    dec = 2;
  }
  animU = null;
  const bEl = t.parentElement.querySelector("b");
  if (bEl) bEl.textContent = (+t.value).toFixed(dec);
  const chart = document.getElementById("seisChart");
  if (chart) chart.innerHTML = drawSeismic();
});
$("load").value = "50";
frame = 49;
solve();
