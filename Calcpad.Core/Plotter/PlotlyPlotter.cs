using System;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Plotter for interactive charts using Plotly.js
    /// Supports: surface, contour, heatmap, scatter3d
    /// Syntax: $Plotly{f(x; y) @ x = x1 : x2 & y = y1 : y2 | type}
    /// </summary>
    internal class PlotlyPlotter : JsPlotter
    {
        private readonly Func<IValue> _function;
        private readonly Variable _varX;
        private readonly Variable _varY;
        private readonly string _varXName;
        private readonly string _varYName;
        private readonly double _startX, _endX, _startY, _endY;
        private readonly string _plotType;
        private const int Resolution = 40; // Grid resolution

        internal PlotlyPlotter(MathParser parser, PlotSettings settings,
            Func<IValue> function, Variable varX, Variable varY,
            string varXName, string varYName,
            double startX, double endX, double startY, double endY, string plotType)
            : base(parser, settings)
        {
            _function = function;
            _varX = varX;
            _varY = varY;
            _varXName = varXName;
            _varYName = varYName;
            _startX = startX;
            _endX = endX;
            _startY = startY;
            _endY = endY;
            _plotType = plotType.ToLowerInvariant();
        }

        public override string Plot()
        {
            GetImageSize();
            var chartId = GetChartId();

            // Calculate surface data
            var (xData, yData, zData, zMin, zMax) = CalculateSurface();

            var sb = new StringBuilder();

            // Container + Log Panel
            sb.AppendLine(GenerateContainer(chartId, "div"));
            sb.AppendLine(GenerateLogPanel(chartId));

            // Script with Plotly.js
            sb.AppendLine("<script>");
            sb.AppendLine("(function(){");
            sb.AppendLine("const startTime = performance.now();");

            // Visual log init
            if (EnableVisualLog)
            {
                sb.AppendLine($"var logPanel = document.getElementById('log_{chartId}');");
                sb.AppendLine($"function vlog(msg) {{ if(logPanel) logPanel.innerHTML += '<br>' + msg; console.log('[Plotly]', msg); }}");
                sb.AppendLine("vlog('<b>[Plotly]</b> Iniciando...');");
            }

            // Data arrays
            sb.AppendLine($"const x = {xData};");
            sb.AppendLine($"const y = {yData};");
            sb.AppendLine($"const z = {zData};");
            sb.AppendLine(EnableVisualLog ? $"vlog('Datos: ' + z.length + 'x' + z[0].length + ' puntos');" : "");

            var logCheck = EnableVisualLog ? "vlog" : "console.log";

            // Check if Plotly is available
            sb.AppendLine($@"
const container = document.getElementById('{chartId}');
if (!container) {{
    {logCheck}('ERROR: Container no encontrado');
    return;
}}

if (typeof Plotly === 'undefined') {{
    {logCheck}('ERROR: Plotly.js no cargado! Cargando desde CDN...');
    var script = document.createElement('script');
    script.src = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
    script.onload = function() {{ renderPlot(); }};
    document.head.appendChild(script);
}} else {{
    {logCheck}('Plotly.js v' + Plotly.version + ' OK');
    renderPlot();
}}

function renderPlot() {{
");

            // Generate trace based on plot type
            switch (_plotType)
            {
                case "contour":
                    sb.AppendLine(GenerateContourTrace());
                    break;
                case "heatmap":
                    sb.AppendLine(GenerateHeatmapTrace());
                    break;
                case "scatter3d":
                    sb.AppendLine(GenerateScatter3DTrace());
                    break;
                case "surface":
                default:
                    sb.AppendLine(GenerateSurfaceTrace());
                    break;
            }

            // Layout configuration
            var is3D = _plotType == "surface" || _plotType == "scatter3d";
            sb.AppendLine(GenerateLayout(is3D));

            // Config and render
            sb.AppendLine($@"
    const config = {{
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['sendDataToCloud']
    }};

    Plotly.newPlot('{chartId}', data, layout, config);
    {logCheck}('Renderizado en ' + (performance.now() - startTime).toFixed(1) + ' ms');
}}
}})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private string GenerateSurfaceTrace()
        {
            return @"
    const data = [{
        type: 'surface',
        x: x,
        y: y,
        z: z,
        colorscale: 'Viridis',
        showscale: true,
        contours: {
            z: {
                show: true,
                usecolormap: true,
                highlightcolor: '#fff',
                project: { z: true }
            }
        }
    }];";
        }

        private string GenerateContourTrace()
        {
            return @"
    const data = [{
        type: 'contour',
        x: x,
        y: y,
        z: z,
        colorscale: 'Viridis',
        showscale: true,
        contours: {
            coloring: 'heatmap',
            showlabels: true,
            labelfont: { size: 10, color: 'white' }
        }
    }];";
        }

        private string GenerateHeatmapTrace()
        {
            return @"
    const data = [{
        type: 'heatmap',
        x: x,
        y: y,
        z: z,
        colorscale: 'Viridis',
        showscale: true
    }];";
        }

        private string GenerateScatter3DTrace()
        {
            return @"
    // Flatten data for scatter3d
    const xs = [], ys = [], zs = [], cs = [];
    for (let i = 0; i < z.length; i++) {
        for (let j = 0; j < z[i].length; j++) {
            if (!isNaN(z[i][j])) {
                xs.push(x[j]);
                ys.push(y[i]);
                zs.push(z[i][j]);
                cs.push(z[i][j]);
            }
        }
    }
    const data = [{
        type: 'scatter3d',
        mode: 'markers',
        x: xs,
        y: ys,
        z: zs,
        marker: {
            size: 4,
            color: cs,
            colorscale: 'Viridis',
            showscale: true
        }
    }];";
        }

        private string GenerateLayout(bool is3D)
        {
            var xTitle = _varXName ?? "x";
            var yTitle = _varYName ?? "y";

            if (is3D)
            {
                return $@"
    const layout = {{
        width: {Width},
        height: {Height},
        margin: {{ l: 20, r: 20, t: 40, b: 20 }},
        scene: {{
            xaxis: {{ title: '{xTitle}', gridcolor: '#ccc' }},
            yaxis: {{ title: '{yTitle}', gridcolor: '#ccc' }},
            zaxis: {{ title: 'f({xTitle},{yTitle})', gridcolor: '#ccc' }},
            camera: {{
                eye: {{ x: 1.5, y: 1.5, z: 1.2 }}
            }}
        }}
    }};";
            }
            else
            {
                return $@"
    const layout = {{
        width: {Width},
        height: {Height},
        margin: {{ l: 60, r: 20, t: 40, b: 50 }},
        xaxis: {{ title: '{xTitle}', gridcolor: '#eee' }},
        yaxis: {{ title: '{yTitle}', gridcolor: '#eee', scaleanchor: 'x' }}
    }};";
            }
        }

        private (string xData, string yData, string zData, double zMin, double zMax) CalculateSurface()
        {
            var xSb = new StringBuilder("[");
            var ySb = new StringBuilder("[");
            var zSb = new StringBuilder("[");

            double zMin = double.MaxValue;
            double zMax = double.MinValue;

            double dx = (_endX - _startX) / (Resolution - 1);
            double dy = (_endY - _startY) / (Resolution - 1);

            // Generate x array
            for (int j = 0; j < Resolution; j++)
            {
                if (j > 0) xSb.Append(',');
                double x = _startX + j * dx;
                xSb.Append(x.ToString("G", CultureInfo.InvariantCulture));
            }
            xSb.Append(']');

            // Generate y array
            for (int i = 0; i < Resolution; i++)
            {
                if (i > 0) ySb.Append(',');
                double y = _startY + i * dy;
                ySb.Append(y.ToString("G", CultureInfo.InvariantCulture));
            }
            ySb.Append(']');

            // Generate z array (2D array)
            for (int i = 0; i < Resolution; i++)
            {
                double y = _startY + i * dy;
                _varY.SetNumber(y);

                if (i > 0) zSb.Append(',');
                zSb.Append('[');

                for (int j = 0; j < Resolution; j++)
                {
                    double x = _startX + j * dx;
                    _varX.SetNumber(x);

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

                    if (j > 0) zSb.Append(',');

                    if (double.IsNaN(z) || double.IsInfinity(z))
                    {
                        zSb.Append("null");
                    }
                    else
                    {
                        if (z < zMin) zMin = z;
                        if (z > zMax) zMax = z;
                        zSb.Append(z.ToString("G", CultureInfo.InvariantCulture));
                    }
                }
                zSb.Append(']');
            }
            zSb.Append(']');

            if (zMin == double.MaxValue) zMin = 0;
            if (zMax == double.MinValue) zMax = 1;

            return (xSb.ToString(), ySb.ToString(), zSb.ToString(), zMin, zMax);
        }
    }
}
