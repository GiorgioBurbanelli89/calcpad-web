using System;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Plotter for 3D mesh visualization using Plotly.js
    /// Renders triangular meshes, surfaces, and irregular 3D shapes
    /// Syntax: $PlotlyMesh{nodes; elements}
    ///         $PlotlyMesh{nodes; elements; values}
    ///         $PlotlyMesh{nodes; elements; values | type}
    /// </summary>
    internal class PlotlyMeshPlotter : JsPlotter
    {
        private readonly Matrix _nodes;      // Nx3 matrix [x, y, z]
        private readonly Matrix _elements;   // ExM matrix (M=3 for triangles, M=4 for quads)
        private readonly Vector _values;     // Optional: values for coloring (per element or per node)
        private readonly string _plotType;   // mesh3d, surface, wireframe

        internal PlotlyMeshPlotter(MathParser parser, PlotSettings settings,
            Matrix nodes, Matrix elements, Vector values, string plotType)
            : base(parser, settings)
        {
            _nodes = nodes;
            _elements = elements;
            _values = values;
            _plotType = plotType?.ToLowerInvariant() ?? "mesh3d";
        }

        public override string Plot()
        {
            GetImageSize();
            var chartId = GetChartId();

            // Validate input
            if (_nodes is null || _nodes.RowCount < 3 || _nodes.ColCount < 2)
            {
                return "<span class=\"err\">$PlotlyMesh: nodes must be Nx2 or Nx3 matrix with at least 3 rows</span>";
            }
            if (_elements is null || _elements.RowCount < 1)
            {
                return "<span class=\"err\">$PlotlyMesh: elements must be ExM matrix with at least 1 row</span>";
            }

            var sb = new StringBuilder();

            // Container + Log Panel
            sb.AppendLine(GenerateContainer(chartId, "div"));
            sb.AppendLine(GenerateLogPanel(chartId));

            // Generate mesh data
            var nodeData = GenerateNodeData();
            var elementData = GenerateElementData();
            var valueData = GenerateValueData();

            // Script with Plotly.js
            sb.AppendLine("<script>");
            sb.AppendLine("(function(){");
            sb.AppendLine("const startTime = performance.now();");

            // Visual log init
            if (EnableVisualLog)
            {
                sb.AppendLine($"var logPanel = document.getElementById('log_{chartId}');");
                sb.AppendLine($"function vlog(msg) {{ if(logPanel) logPanel.innerHTML += '<br>' + msg; console.log('[PlotlyMesh]', msg); }}");
                sb.AppendLine("vlog('<b>[PlotlyMesh]</b> Iniciando...');");
            }

            var logCheck = EnableVisualLog ? "vlog" : "console.log";

            // Data arrays
            sb.AppendLine($"const x = {nodeData.x};");
            sb.AppendLine($"const y = {nodeData.y};");
            sb.AppendLine($"const z = {nodeData.z};");
            sb.AppendLine($"const i = {elementData.i};");
            sb.AppendLine($"const j = {elementData.j};");
            sb.AppendLine($"const k = {elementData.k};");
            if (!string.IsNullOrEmpty(valueData))
            {
                sb.AppendLine($"const intensity = {valueData};");
            }
            sb.AppendLine(EnableVisualLog ? $"vlog('Nodos: ' + x.length + ', Elementos: ' + i.length);" : "");

            sb.AppendLine($@"
const container = document.getElementById('{chartId}');
if (!container) {{
    {logCheck}('ERROR: Container no encontrado');
    return;
}}

if (typeof Plotly === 'undefined') {{
    {logCheck}('Plotly.js no cargado, cargando desde CDN...');
    var script = document.createElement('script');
    script.src = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
    script.onload = function() {{ renderPlot(); }};
    document.head.appendChild(script);
}} else {{
    {logCheck}('Plotly.js v' + Plotly.version + ' OK');
    renderPlot();
}}

function renderPlot() {{
    const data = [{{
        type: 'mesh3d',
        x: x,
        y: y,
        z: z,
        i: i,
        j: j,
        k: k,
        {(string.IsNullOrEmpty(valueData) ? "color: 'lightblue'," : "intensity: intensity, colorscale: 'Viridis', showscale: true,")}
        opacity: {(_plotType == "wireframe" ? "0.3" : "0.9")},
        flatshading: true,
        lighting: {{
            ambient: 0.6,
            diffuse: 0.5,
            specular: 0.2
        }}
    }}];

    const layout = {{
        width: {Width},
        height: {Height},
        margin: {{ l: 20, r: 20, t: 40, b: 20 }},
        scene: {{
            xaxis: {{ title: 'X', gridcolor: '#ccc' }},
            yaxis: {{ title: 'Y', gridcolor: '#ccc' }},
            zaxis: {{ title: 'Z', gridcolor: '#ccc' }},
            aspectmode: 'data',
            camera: {{
                eye: {{ x: 1.5, y: 1.5, z: 1.2 }}
            }}
        }}
    }};

    const config = {{
        responsive: true,
        displayModeBar: true
    }};

    Plotly.newPlot('{chartId}', data, layout, config);
    {logCheck}('Renderizado en ' + (performance.now() - startTime).toFixed(1) + ' ms');
}}
}})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private (string x, string y, string z) GenerateNodeData()
        {
            var xSb = new StringBuilder("[");
            var ySb = new StringBuilder("[");
            var zSb = new StringBuilder("[");

            int nNodes = _nodes.RowCount;
            bool has3D = _nodes.ColCount >= 3;

            for (int n = 0; n < nNodes; n++)
            {
                if (n > 0)
                {
                    xSb.Append(',');
                    ySb.Append(',');
                    zSb.Append(',');
                }

                double x = _nodes[n, 0].D;
                double y = _nodes[n, 1].D;
                double z = has3D ? _nodes[n, 2].D : 0;

                xSb.Append(x.ToString("G", CultureInfo.InvariantCulture));
                ySb.Append(y.ToString("G", CultureInfo.InvariantCulture));
                zSb.Append(z.ToString("G", CultureInfo.InvariantCulture));
            }

            xSb.Append(']');
            ySb.Append(']');
            zSb.Append(']');

            return (xSb.ToString(), ySb.ToString(), zSb.ToString());
        }

        private (string i, string j, string k) GenerateElementData()
        {
            var iSb = new StringBuilder("[");
            var jSb = new StringBuilder("[");
            var kSb = new StringBuilder("[");

            int nElements = _elements.RowCount;
            int nodesPerElem = _elements.ColCount;

            // For triangular elements (3 nodes per element)
            // For quads, split into 2 triangles
            for (int e = 0; e < nElements; e++)
            {
                if (e > 0)
                {
                    iSb.Append(',');
                    jSb.Append(',');
                    kSb.Append(',');
                }

                // Node indices (0-based in Plotly, may be 1-based in input)
                int n1 = (int)_elements[e, 0].D - 1;
                int n2 = (int)_elements[e, 1].D - 1;
                int n3 = (int)_elements[e, 2].D - 1;

                // Clamp to valid range
                n1 = Math.Max(0, n1);
                n2 = Math.Max(0, n2);
                n3 = Math.Max(0, n3);

                iSb.Append(n1);
                jSb.Append(n2);
                kSb.Append(n3);

                // If quad element, add second triangle
                if (nodesPerElem >= 4)
                {
                    int n4 = (int)_elements[e, 3].D - 1;
                    n4 = Math.Max(0, n4);

                    iSb.Append(',').Append(n1);
                    jSb.Append(',').Append(n3);
                    kSb.Append(',').Append(n4);
                }
            }

            iSb.Append(']');
            jSb.Append(']');
            kSb.Append(']');

            return (iSb.ToString(), jSb.ToString(), kSb.ToString());
        }

        private string GenerateValueData()
        {
            if (_values is null || _values.Length == 0)
                return null;

            var sb = new StringBuilder("[");
            int len = _values.Length;
            for (int i = 0; i < len; i++)
            {
                if (i > 0) sb.Append(',');
                double v = _values[i].D;
                sb.Append(v.ToString("G", CultureInfo.InvariantCulture));
            }
            sb.Append(']');
            return sb.ToString();
        }
    }
}
