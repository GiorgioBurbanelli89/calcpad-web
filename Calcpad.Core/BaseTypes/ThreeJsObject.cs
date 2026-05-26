using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Types of Tweakpane controls
    /// </summary>
    internal enum TweakpaneControlType
    {
        Slider,     // Number slider
        Checkbox,   // Boolean checkbox
        Color,      // Color picker
        Text,       // Text input
        Button      // Action button
    }

    /// <summary>
    /// Represents a custom Tweakpane control
    /// </summary>
    internal class TweakpaneControl
    {
        public TweakpaneControlType Type { get; set; }
        public string Name { get; set; }        // Parameter name (e.g., "velocity")
        public string Label { get; set; }       // Display label (e.g., "Velocity")
        public string Value { get; set; }       // Initial value
        public double Min { get; set; } = 0;    // Min value (for slider)
        public double Max { get; set; } = 100;  // Max value (for slider)
        public double Step { get; set; } = 1;   // Step (for slider)
        public string Target { get; set; }      // Target property (e.g., "lines.opacity", "spheres.visible")
    }

    /// <summary>
    /// Types of 3D objects for $Three command
    /// </summary>
    internal enum ThreeJsObjectType
    {
        // Primitives
        Points,     // Point cloud from matrix
        Lines,      // Line segments from connectivity
        Spheres,    // Sphere at each point
        Boxes,      // Box at each point
        Arrows,     // Arrow vectors

        // Scene elements
        Grid,       // Grid helper
        Axes,       // Axes helper

        // Advanced
        Mesh,       // Triangular mesh surface
        ColorMap,   // Color-mapped mesh (FEM results)
        Labels,     // Text labels at points

        // UI Controls
        Tweakpane,  // Custom Tweakpane control

        // Container
        Window      // Render window combining objects
    }

    /// <summary>
    /// Represents a 3D object that can be stored in a Calcpad variable
    /// and composed with other objects in a $Three window
    /// </summary>
    internal class ThreeJsObject
    {
        public ThreeJsObjectType ObjectType { get; set; }
        public string Name { get; set; }

        // Data sources (variable names or matrices)
        public Matrix Positions { get; set; }      // Node positions Nx3
        public Matrix Connectivity { get; set; }   // Element connectivity Ex2 or Ex3
        public Matrix Values { get; set; }         // Scalar values for colormap
        public Vector Indices { get; set; }        // Indices for specific nodes

        // Visual properties
        public string Color { get; set; } = "#ffffff";
        public double Size { get; set; } = 1.0;
        public double LineWidth { get; set; } = 2.0;
        public double Opacity { get; set; } = 1.0;

        // For grid/axes
        public double GridSize { get; set; } = 10.0;
        public double AxesSize { get; set; } = 2.0;

        // For colormap
        public string ColorScale { get; set; } = "viridis"; // viridis, jet, rainbow, etc.
        public double MinValue { get; set; } = double.NaN;
        public double MaxValue { get; set; } = double.NaN;

        // For labels
        public string[] LabelTexts { get; set; }
        public bool ShowIndices { get; set; } = false;

        // For window
        public double Width { get; set; } = 800;
        public double Height { get; set; } = 500;
        public string BackgroundColor { get; set; } = "#1a1a2e";
        public List<ThreeJsObject> Children { get; set; } = new List<ThreeJsObject>();
        public bool ShowControls { get; set; } = true;

        // For custom Tweakpane controls
        public List<TweakpaneControl> CustomControls { get; set; } = new List<TweakpaneControl>();

        /// <summary>
        /// Generate unique ID for this object in JavaScript
        /// </summary>
        public string GetJsId()
        {
            return $"obj_{Name?.Replace(" ", "_") ?? ObjectType.ToString().ToLower()}_{GetHashCode():X8}";
        }

        /// <summary>
        /// Generate JavaScript code to create this object in Three.js scene
        /// </summary>
        public string GenerateJavaScript(string sceneName = "scene")
        {
            var sb = new StringBuilder();
            var jsId = GetJsId();

            switch (ObjectType)
            {
                case ThreeJsObjectType.Points:
                    sb.AppendLine(GeneratePointsJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Lines:
                    sb.AppendLine(GenerateLinesJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Spheres:
                    sb.AppendLine(GenerateSpheresJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Boxes:
                    sb.AppendLine(GenerateBoxesJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Arrows:
                    sb.AppendLine(GenerateArrowsJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Grid:
                    sb.AppendLine(GenerateGridJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Axes:
                    sb.AppendLine(GenerateAxesJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Mesh:
                    sb.AppendLine(GenerateMeshJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.ColorMap:
                    sb.AppendLine(GenerateColorMapJs(jsId, sceneName));
                    break;
                case ThreeJsObjectType.Labels:
                    sb.AppendLine(GenerateLabelsJs(jsId, sceneName));
                    break;
            }

            return sb.ToString();
        }

        private string GeneratePointsJs(string jsId, string scene)
        {
            if (Positions is null) return $"// {jsId}: No positions data";

            var positions = MatrixToJsArray(Positions);
            return $@"
// Points: {Name ?? jsId}
window.{jsId} = new THREE.Group();
var {jsId}_material = new THREE.PointsMaterial({{color: {ColorToHex(Color)}, size: {Size.ToString("G", CultureInfo.InvariantCulture)}}});
var {jsId}_geometry = new THREE.BufferGeometry();
var {jsId}_positions = new Float32Array({positions}.flat());
{jsId}_geometry.setAttribute('position', new THREE.BufferAttribute({jsId}_positions, 3));
{jsId}.add(new THREE.Points({jsId}_geometry, {jsId}_material));
{scene}.add({jsId});
";
        }

        private string GenerateLinesJs(string jsId, string scene)
        {
            if (Positions is null || Connectivity is null) return $"// {jsId}: No data";

            var nodes = MatrixToJsArray(Positions);
            var elements = MatrixToJsArrayInt(Connectivity);

            return $@"
// Lines: {Name ?? jsId}
window.{jsId} = new THREE.Group();
var {jsId}_nodes = {nodes};
var {jsId}_elements = {elements};
var {jsId}_material = new THREE.LineBasicMaterial({{color: {ColorToHex(Color)}, linewidth: {LineWidth.ToString("G", CultureInfo.InvariantCulture)}}});
for(var i=0; i<{jsId}_elements.length; i++) {{
    var ni = {jsId}_elements[i][0], nj = {jsId}_elements[i][1];
    if(ni>=0 && ni<{jsId}_nodes.length && nj>=0 && nj<{jsId}_nodes.length) {{
        var pts = [
            new THREE.Vector3({jsId}_nodes[ni][0], {jsId}_nodes[ni][1], {jsId}_nodes[ni][2]),
            new THREE.Vector3({jsId}_nodes[nj][0], {jsId}_nodes[nj][1], {jsId}_nodes[nj][2])
        ];
        var geom = new THREE.BufferGeometry().setFromPoints(pts);
        {jsId}.add(new THREE.Line(geom, {jsId}_material));
    }}
}}
{scene}.add({jsId});
";
        }

        private string GenerateSpheresJs(string jsId, string scene)
        {
            if (Positions is null) return $"// {jsId}: No positions data";

            var nodes = MatrixToJsArray(Positions);

            return $@"
// Spheres: {Name ?? jsId}
window.{jsId} = new THREE.Group();
var {jsId}_nodes = {nodes};
var {jsId}_material = new THREE.MeshBasicMaterial({{color: {ColorToHex(Color)}, transparent: true, opacity: {Opacity.ToString("G", CultureInfo.InvariantCulture)}}});
var {jsId}_geometry = new THREE.SphereGeometry({Size.ToString("G", CultureInfo.InvariantCulture)}, 16, 16);
for(var i=0; i<{jsId}_nodes.length; i++) {{
    var mesh = new THREE.Mesh({jsId}_geometry, {jsId}_material);
    mesh.position.set({jsId}_nodes[i][0], {jsId}_nodes[i][1], {jsId}_nodes[i][2]);
    {jsId}.add(mesh);
}}
{scene}.add({jsId});
";
        }

        private string GenerateBoxesJs(string jsId, string scene)
        {
            if (Positions is null) return $"// {jsId}: No positions data";

            var nodes = MatrixToJsArray(Positions);

            return $@"
// Boxes: {Name ?? jsId}
window.{jsId} = new THREE.Group();
var {jsId}_nodes = {nodes};
var {jsId}_material = new THREE.MeshBasicMaterial({{color: {ColorToHex(Color)}, transparent: true, opacity: {Opacity.ToString("G", CultureInfo.InvariantCulture)}}});
var {jsId}_geometry = new THREE.BoxGeometry({Size.ToString("G", CultureInfo.InvariantCulture)}, {Size.ToString("G", CultureInfo.InvariantCulture)}, {Size.ToString("G", CultureInfo.InvariantCulture)});
for(var i=0; i<{jsId}_nodes.length; i++) {{
    var mesh = new THREE.Mesh({jsId}_geometry, {jsId}_material);
    mesh.position.set({jsId}_nodes[i][0], {jsId}_nodes[i][1], {jsId}_nodes[i][2]);
    {jsId}.add(mesh);
}}
{scene}.add({jsId});
";
        }

        private string GenerateArrowsJs(string jsId, string scene)
        {
            if (Positions is null || Values is null) return $"// {jsId}: No arrow data";

            var origins = MatrixToJsArray(Positions);
            var directions = MatrixToJsArray(Values); // Values contains direction vectors

            return $@"
// Arrows: {Name ?? jsId}
window.{jsId} = new THREE.Group();
var {jsId}_origins = {origins};
var {jsId}_dirs = {directions};
for(var i=0; i<{jsId}_origins.length && i<{jsId}_dirs.length; i++) {{
    var dir = new THREE.Vector3({jsId}_dirs[i][0], {jsId}_dirs[i][1], {jsId}_dirs[i][2]);
    var len = dir.length();
    if(len > 0.001) {{
        dir.normalize();
        var arrow = new THREE.ArrowHelper(dir,
            new THREE.Vector3({jsId}_origins[i][0], {jsId}_origins[i][1], {jsId}_origins[i][2]),
            len * {Size.ToString("G", CultureInfo.InvariantCulture)}, {ColorToHex(Color)}, len * 0.2 * {Size.ToString("G", CultureInfo.InvariantCulture)}, len * 0.1 * {Size.ToString("G", CultureInfo.InvariantCulture)});
        {jsId}.add(arrow);
    }}
}}
{scene}.add({jsId});
";
        }

        private string GenerateGridJs(string jsId, string scene)
        {
            // Grid on XY plane at Z=0 (Awatif-style)
            return $@"
// Grid: {Name ?? jsId}
window.{jsId} = new THREE.GridHelper({GridSize.ToString("G", CultureInfo.InvariantCulture)}, 20, 0x404040, 0x404040);
{jsId}.position.set({(GridSize / 2).ToString("G", CultureInfo.InvariantCulture)}, {(GridSize / 2).ToString("G", CultureInfo.InvariantCulture)}, 0);
{jsId}.rotateX(Math.PI / 2);
{scene}.add({jsId});
";
        }

        private string GenerateAxesJs(string jsId, string scene)
        {
            // Awatif-style axes: three ArrowHelper objects with arrow heads
            // size = 0.05 * gridSize (we use AxesSize directly as the scale factor)
            var size = AxesSize * 0.05;
            return $@"
// Axes: {Name ?? jsId} (Awatif-style with arrow heads)
window.{jsId} = new THREE.Group();
var {jsId}_xArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),  // direction
    new THREE.Vector3(0, 0, 0),  // origin
    1,                           // length
    0x666666,                    // color (gray)
    0.2,                         // headLength
    0.2                          // headWidth
);
var {jsId}_yArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 0),
    1,
    0x666666,
    0.2,
    0.2
);
var {jsId}_zArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, 0),
    1,
    0x666666,
    0.2,
    0.2
);
{jsId}_xArrow.scale.set({size.ToString("G", CultureInfo.InvariantCulture)}, {size.ToString("G", CultureInfo.InvariantCulture)}, {size.ToString("G", CultureInfo.InvariantCulture)});
{jsId}_yArrow.scale.set({size.ToString("G", CultureInfo.InvariantCulture)}, {size.ToString("G", CultureInfo.InvariantCulture)}, {size.ToString("G", CultureInfo.InvariantCulture)});
{jsId}_zArrow.scale.set({size.ToString("G", CultureInfo.InvariantCulture)}, {size.ToString("G", CultureInfo.InvariantCulture)}, {size.ToString("G", CultureInfo.InvariantCulture)});
{jsId}.add({jsId}_xArrow, {jsId}_yArrow, {jsId}_zArrow);
{scene}.add({jsId});
";
        }

        private string GenerateMeshJs(string jsId, string scene)
        {
            if (Positions is null || Connectivity is null) return $"// {jsId}: No mesh data";

            var vertices = MatrixToJsArrayFlat(Positions);
            var indices = MatrixToJsArrayIntFlat(Connectivity);

            return $@"
// Mesh: {Name ?? jsId}
window.{jsId} = new THREE.Mesh();
var {jsId}_geometry = new THREE.BufferGeometry();
var {jsId}_vertices = new Float32Array({vertices});
var {jsId}_indices = new Uint16Array({indices});
{jsId}_geometry.setAttribute('position', new THREE.BufferAttribute({jsId}_vertices, 3));
{jsId}_geometry.setIndex(new THREE.BufferAttribute({jsId}_indices, 1));
{jsId}_geometry.computeVertexNormals();
var {jsId}_material = new THREE.MeshBasicMaterial({{
    color: {ColorToHex(Color)},
    side: THREE.DoubleSide,
    transparent: true,
    opacity: {Opacity.ToString("G", CultureInfo.InvariantCulture)},
    wireframe: false
}});
{jsId} = new THREE.Mesh({jsId}_geometry, {jsId}_material);
{scene}.add({jsId});
";
        }

        private string GenerateColorMapJs(string jsId, string scene)
        {
            if (Positions is null || Connectivity is null || Values is null)
                return $"// {jsId}: No colormap data";

            var vertices = MatrixToJsArrayFlat(Positions);
            var indices = MatrixToJsArrayIntFlat(Connectivity);
            var values = MatrixColToJsArray(Values, 0);

            // Calculate min/max if not provided
            var minV = double.IsNaN(MinValue) ? "Math.min(...values)" : MinValue.ToString("G", CultureInfo.InvariantCulture);
            var maxV = double.IsNaN(MaxValue) ? "Math.max(...values)" : MaxValue.ToString("G", CultureInfo.InvariantCulture);

            return $@"
// ColorMap: {Name ?? jsId}
(function() {{
    var values = {values};
    var minVal = {minV};
    var maxVal = {maxV};
    var range = maxVal - minVal || 1;

    function getColor(t) {{
        // {ColorScale} colormap
        var r, g, b;
        if(t < 0.25) {{ r = 0; g = 4*t; b = 1; }}
        else if(t < 0.5) {{ r = 0; g = 1; b = 1 - 4*(t-0.25); }}
        else if(t < 0.75) {{ r = 4*(t-0.5); g = 1; b = 0; }}
        else {{ r = 1; g = 1 - 4*(t-0.75); b = 0; }}
        return new THREE.Color(r, g, b);
    }}

    var {jsId}_geometry = new THREE.BufferGeometry();
    var vertices = new Float32Array({vertices});
    var indices = new Uint16Array({indices});
    {jsId}_geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    {jsId}_geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Vertex colors
    var colors = new Float32Array(vertices.length);
    for(var i = 0; i < values.length; i++) {{
        var t = (values[i] - minVal) / range;
        var c = getColor(Math.max(0, Math.min(1, t)));
        colors[i*3] = c.r;
        colors[i*3+1] = c.g;
        colors[i*3+2] = c.b;
    }}
    {jsId}_geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    {jsId}_geometry.computeVertexNormals();

    var {jsId}_material = new THREE.MeshBasicMaterial({{
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: {Opacity.ToString("G", CultureInfo.InvariantCulture)}
    }});

    var {jsId} = new THREE.Mesh({jsId}_geometry, {jsId}_material);
    {scene}.add({jsId});
    window.{jsId} = {jsId};
}})();
";
        }

        private string GenerateLabelsJs(string jsId, string scene)
        {
            if (Positions is null) return $"// {jsId}: No positions for labels";

            var nodes = MatrixToJsArray(Positions);

            // Generate label texts
            string labelsArray;
            if (LabelTexts != null && LabelTexts.Length > 0)
            {
                labelsArray = "[" + string.Join(",", Array.ConvertAll(LabelTexts, t => $"\"{t}\"")) + "]";
            }
            else if (ShowIndices)
            {
                // Generate index labels
                var indices = new string[Positions.RowCount];
                for (int i = 0; i < indices.Length; i++)
                    indices[i] = $"\"{i}\"";
                labelsArray = "[" + string.Join(",", indices) + "]";
            }
            else
            {
                return $"// {jsId}: No label texts";
            }

            return $@"
// Labels: {Name ?? jsId}
window.{jsId} = new THREE.Group();
var {jsId}_nodes = {nodes};
var {jsId}_labels = {labelsArray};

// User-controlled scale parameter (visual size in 3D world)
var userScale = {Size.ToString("G", CultureInfo.InvariantCulture)};

for(var i=0; i<{jsId}_nodes.length && i<{jsId}_labels.length; i++) {{
    // Create high-resolution canvas for crisp text (Awatif-style)
    var labelCanvas = document.createElement('canvas');
    var ctx = labelCanvas.getContext('2d');

    // High resolution for sharp rendering (independent of visual scale)
    var resolution = 30;
    var fontHeightPx = resolution * (window.devicePixelRatio || 1);
    ctx.font = fontHeightPx + 'px Arial';
    var textWidth = ctx.measureText({jsId}_labels[i]).width;

    labelCanvas.width = textWidth;
    labelCanvas.height = fontHeightPx;

    // DO NOT draw background - leave transparent
    // Only draw the text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '{Color}';
    var toMargin = 0.9;
    ctx.font = (fontHeightPx * toMargin) + 'px Arial';
    var toCenterTextV = 0.08 * labelCanvas.height;
    ctx.fillText({jsId}_labels[i], textWidth / 2, fontHeightPx / 2 + toCenterTextV);

    var texture = new THREE.CanvasTexture(labelCanvas);
    texture.needsUpdate = true;

    // Sharp texture filtering (no blur)
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    var spriteMaterial = new THREE.SpriteMaterial({{
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
    }});

    var sprite = new THREE.Sprite(spriteMaterial);
    sprite.renderOrder = 999;

    // Scale sprite to match user's desired size
    sprite.scale.set((textWidth / fontHeightPx) * userScale, userScale, 1);
    sprite.position.set({jsId}_nodes[i][0], {jsId}_nodes[i][1], {jsId}_nodes[i][2] + userScale * 0.5);

    {jsId}.add(sprite);
}}
{scene}.add({jsId});
";
        }

        #region Helper Methods

        private static string ColorToHex(string color)
        {
            if (string.IsNullOrEmpty(color))
                return "0xffffff";

            color = color.Trim().Trim('"', '\'');

            if (color.StartsWith("#"))
                return "0x" + color.Substring(1);

            return "0x" + color;
        }

        private static string MatrixToJsArray(Matrix m)
        {
            if (m is null) return "[]";

            var sb = new StringBuilder("[");
            bool is3D = m.ColCount >= 3;

            for (int i = 0; i < m.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('[');
                sb.Append(GetVal(m, i, 0));
                sb.Append(',');
                sb.Append(m.ColCount > 1 ? GetVal(m, i, 1) : "0");
                sb.Append(',');
                sb.Append(is3D ? GetVal(m, i, 2) : "0");
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private static string MatrixToJsArrayFlat(Matrix m)
        {
            if (m is null) return "[]";

            var sb = new StringBuilder("[");
            bool is3D = m.ColCount >= 3;

            for (int i = 0; i < m.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(GetVal(m, i, 0));
                sb.Append(',');
                sb.Append(m.ColCount > 1 ? GetVal(m, i, 1) : "0");
                sb.Append(',');
                sb.Append(is3D ? GetVal(m, i, 2) : "0");
            }
            sb.Append(']');
            return sb.ToString();
        }

        private static string MatrixToJsArrayInt(Matrix m)
        {
            if (m is null) return "[]";

            // Detect if indices are 1-based
            double minIdx = double.MaxValue;
            for (int i = 0; i < m.RowCount; i++)
            {
                for (int j = 0; j < m.ColCount; j++)
                {
                    var v = m[i, j].D;
                    if (v < minIdx) minIdx = v;
                }
            }
            int offset = minIdx >= 1 ? 1 : 0;

            var sb = new StringBuilder("[");
            for (int i = 0; i < m.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('[');
                for (int j = 0; j < m.ColCount; j++)
                {
                    if (j > 0) sb.Append(',');
                    sb.Append((int)m[i, j].D - offset);
                }
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private static string MatrixToJsArrayIntFlat(Matrix m)
        {
            if (m is null) return "[]";

            // Detect if indices are 1-based
            double minIdx = double.MaxValue;
            for (int i = 0; i < m.RowCount; i++)
            {
                for (int j = 0; j < m.ColCount; j++)
                {
                    var v = m[i, j].D;
                    if (v < minIdx) minIdx = v;
                }
            }
            int offset = minIdx >= 1 ? 1 : 0;

            var sb = new StringBuilder("[");
            bool first = true;
            for (int i = 0; i < m.RowCount; i++)
            {
                for (int j = 0; j < m.ColCount; j++)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    sb.Append((int)m[i, j].D - offset);
                }
            }
            sb.Append(']');
            return sb.ToString();
        }

        private static string MatrixColToJsArray(Matrix m, int col)
        {
            if (m is null || col >= m.ColCount) return "[]";

            var sb = new StringBuilder("[");
            for (int i = 0; i < m.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(GetVal(m, i, col));
            }
            sb.Append(']');
            return sb.ToString();
        }

        private static string GetVal(Matrix m, int row, int col)
        {
            if (row >= m.RowCount || col >= m.ColCount) return "0";
            var val = m[row, col].D;
            return double.IsNaN(val) ? "0" : val.ToString("G", CultureInfo.InvariantCulture);
        }

        #endregion
    }
}
