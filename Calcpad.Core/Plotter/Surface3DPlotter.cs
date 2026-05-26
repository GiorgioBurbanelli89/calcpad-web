using System;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Plotter for 3D surface charts using Three.js
    /// Renders interactive 3D surfaces with rotation, zoom, and pan
    /// </summary>
    internal class Surface3DPlotter : JsPlotter
    {
        private readonly Func<IValue> _function;
        private readonly Variable _varX;
        private readonly Variable _varY;
        private readonly double _startX, _endX, _startY, _endY;
        private readonly bool _wireframe;
        private const int Resolution = 50; // Grid resolution

        internal Surface3DPlotter(MathParser parser, PlotSettings settings,
            Func<IValue> function, Variable varX, Variable varY,
            double startX, double endX, double startY, double endY, bool wireframe)
            : base(parser, settings)
        {
            _function = function;
            _varX = varX;
            _varY = varY;
            _startX = startX;
            _endX = endX;
            _startY = startY;
            _endY = endY;
            _wireframe = wireframe;
        }

        public override string Plot()
        {
            GetImageSize();
            var chartId = GetChartId();

            // Calculate surface data
            var (vertices, zMin, zMax) = CalculateSurface();

            var sb = new StringBuilder();

            // Container + Log Panel
            sb.AppendLine(GenerateContainer(chartId, "div"));
            sb.AppendLine(GenerateLogPanel(chartId));

            // Script with Three.js
            sb.AppendLine("<script>");
            sb.AppendLine("(function(){");
            sb.AppendLine("const startTime = performance.now();");

            // Visual log init
            if (EnableVisualLog)
            {
                sb.AppendLine($"var logPanel = document.getElementById('log_{chartId}');");
                sb.AppendLine($"function vlog(msg) {{ if(logPanel) logPanel.innerHTML += '<br>' + msg; console.log('[Surface3D]', msg); }}");
                sb.AppendLine("vlog('<b>[Surface3D]</b> Iniciando...');");
            }

            // Data
            sb.AppendLine($"const vertices = {vertices};");
            sb.AppendLine(EnableVisualLog ? "vlog('Vértices: ' + vertices.length + ' puntos');" : "");
            sb.AppendLine($"const nx = {Resolution};");
            sb.AppendLine($"const ny = {Resolution};");
            sb.AppendLine($"const xMin = {_startX.ToString("G", CultureInfo.InvariantCulture)};");
            sb.AppendLine($"const xMax = {_endX.ToString("G", CultureInfo.InvariantCulture)};");
            sb.AppendLine($"const yMin = {_startY.ToString("G", CultureInfo.InvariantCulture)};");
            sb.AppendLine($"const yMax = {_endY.ToString("G", CultureInfo.InvariantCulture)};");
            sb.AppendLine($"const zMin = {zMin.ToString("G", CultureInfo.InvariantCulture)};");
            sb.AppendLine($"const zMax = {zMax.ToString("G", CultureInfo.InvariantCulture)};");

            var logCheck = EnableVisualLog ? "vlog" : "console.log";
            var logErr = EnableVisualLog ? "vlog" : "console.error";

            sb.AppendLine($@"
// Scene setup
const container = document.getElementById('{chartId}');
if (!container) {{
    {logErr}('ERROR: Container no encontrado');
    return;
}}

if (typeof THREE === 'undefined') {{
    {logErr}('ERROR: THREE.js no cargado!');
    return;
}}
{logCheck}('THREE.js r' + THREE.REVISION + ' OK');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(60, {Width}/{Height}, 0.1, 1000);
let renderer;
try {{
    renderer = new THREE.WebGLRenderer({{ antialias: true }});
    renderer.setSize({Width}, {Height});
    container.appendChild(renderer.domElement);
    {logCheck}('WebGL renderer OK');
}} catch (e) {{
    {logErr}('ERROR WebGL: ' + e.message);
    return;
}}

// Calculate scale to normalize the surface
const xRange = xMax - xMin;
const yRange = yMax - yMin;
const zRange = zMax - zMin || 1;
const maxRange = Math.max(xRange, yRange, zRange);
const scale = 4 / maxRange;

// Create geometry
const geometry = new THREE.BufferGeometry();
const positions = [];
const colors = [];
const indices = [];

// Build vertices with color based on height
for (let i = 0; i < vertices.length; i++) {{
    const v = vertices[i];
    const x = (v[0] - (xMin + xMax) / 2) * scale;
    const y = (v[2] - (zMin + zMax) / 2) * scale; // Z becomes Y (up)
    const z = (v[1] - (yMin + yMax) / 2) * scale; // Y becomes Z (depth)
    positions.push(x, y, z);

    // Color based on height (rainbow gradient)
    const t = zRange > 0 ? (v[2] - zMin) / zRange : 0.5;
    const color = new THREE.Color();
    color.setHSL(0.7 - t * 0.7, 1, 0.5);
    colors.push(color.r, color.g, color.b);
}}

// Build indices for triangles
for (let i = 0; i < nx - 1; i++) {{
    for (let j = 0; j < ny - 1; j++) {{
        const a = i * ny + j;
        const b = i * ny + j + 1;
        const c = (i + 1) * ny + j;
        const d = (i + 1) * ny + j + 1;

        // Check for valid vertices (not NaN)
        const va = vertices[a], vb = vertices[b], vc = vertices[c], vd = vertices[d];
        if (va && vb && vc && vd &&
            !isNaN(va[2]) && !isNaN(vb[2]) && !isNaN(vc[2]) && !isNaN(vd[2])) {{
            indices.push(a, b, d);
            indices.push(a, d, c);
        }}
    }}
}}

geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
geometry.setIndex(indices);
geometry.computeVertexNormals();
{logCheck}('Geometría: ' + (positions.length/3) + ' vértices, ' + (indices.length/3) + ' triángulos');

// Material
const material = {(_wireframe ?
    "new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true })" :
    "new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: false })")};

const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
directionalLight2.position.set(-5, -5, -5);
scene.add(directionalLight2);

// Add axes like Awatif (arrows + labels)
const axisSize = 2.5;
const arrowSize = 0.15;
const arrowRadius = 0.12;

// X axis (red)
const xArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 0),
    axisSize, 0xff0000, arrowSize, arrowRadius
);
scene.add(xArrow);

// Y axis (up - green)
const yArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 0),
    axisSize, 0x00ff00, arrowSize, arrowRadius
);
scene.add(yArrow);

// Z axis (blue)
const zArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, 0),
    axisSize, 0x0000ff, arrowSize, arrowRadius
);
scene.add(zArrow);

// Add axis labels
function createLabel(text, color, position) {{
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({{ map: texture }});
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(position);
    sprite.scale.set(0.5, 0.5, 0.5);
    return sprite;
}}
scene.add(createLabel('X', '#ff0000', new THREE.Vector3(axisSize + 0.3, 0, 0)));
scene.add(createLabel('Y', '#00ff00', new THREE.Vector3(0, axisSize + 0.3, 0)));
scene.add(createLabel('Z', '#0000ff', new THREE.Vector3(0, 0, axisSize + 0.3)));

// Add grid plane (XZ)
const gridHelper = new THREE.GridHelper(5, 10, 0x888888, 0xcccccc);
scene.add(gridHelper);

// Camera position
camera.position.set(5, 5, 5);
camera.lookAt(0, 0, 0);

// Orbit controls - with fallback if not loaded
let controls = null;
let controlsRetries = 0;
function setupControls() {{
    if (THREE.OrbitControls) {{
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enableZoom = true;
        controls.enablePan = true;
        {logCheck}('OrbitControls OK');
    }} else if (controlsRetries < 20) {{
        controlsRetries++;
        {logCheck}('OrbitControls: reintento ' + controlsRetries + '...');
        setTimeout(setupControls, 100);
    }} else {{
        {logCheck}('OrbitControls: no disponible (rotación deshabilitada)');
    }}
}}
setupControls();

// Animation loop
let frameCount = 0;
function animate() {{
    requestAnimationFrame(animate);
    if (controls) controls.update();
    renderer.render(scene, camera);
    frameCount++;
    if (frameCount === 1) {{
        {logCheck}('Renderizado en ' + (performance.now() - startTime).toFixed(1) + ' ms');
    }}
}}
animate();
}})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private (string vertices, double zMin, double zMax) CalculateSurface()
        {
            var sb = new StringBuilder("[");
            double zMin = double.MaxValue;
            double zMax = double.MinValue;

            double dx = (_endX - _startX) / (Resolution - 1);
            double dy = (_endY - _startY) / (Resolution - 1);

            bool first = true;
            for (int i = 0; i < Resolution; i++)
            {
                double x = _startX + i * dx;
                _varX.SetNumber(x);

                for (int j = 0; j < Resolution; j++)
                {
                    double y = _startY + j * dy;
                    _varY.SetNumber(y);

                    double z;
                    try
                    {
                        Parser.BreakIfCanceled();
                        var value = _function();
                        z = IValue.AsValue(value).Re;
                    }
                    catch
                    {
                        z = double.NaN;
                    }

                    if (!first) sb.Append(',');
                    first = false;

                    if (double.IsNaN(z) || double.IsInfinity(z))
                    {
                        sb.Append("[");
                        sb.Append(x.ToString("G", CultureInfo.InvariantCulture)).Append(',');
                        sb.Append(y.ToString("G", CultureInfo.InvariantCulture)).Append(',');
                        sb.Append("NaN]");
                    }
                    else
                    {
                        if (z < zMin) zMin = z;
                        if (z > zMax) zMax = z;

                        sb.Append("[");
                        sb.Append(x.ToString("G", CultureInfo.InvariantCulture)).Append(',');
                        sb.Append(y.ToString("G", CultureInfo.InvariantCulture)).Append(',');
                        sb.Append(z.ToString("G", CultureInfo.InvariantCulture)).Append(']');
                    }
                }
            }
            sb.Append(']');

            if (zMin == double.MaxValue) zMin = 0;
            if (zMax == double.MinValue) zMax = 1;

            return (sb.ToString(), zMin, zMax);
        }
    }
}
