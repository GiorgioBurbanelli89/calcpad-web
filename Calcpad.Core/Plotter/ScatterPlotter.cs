using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Plotter for scatter charts using Chart.js
    /// </summary>
    internal class ScatterPlotter : JsPlotter
    {
        private readonly List<ScatterSeries> _series;

        internal ScatterPlotter(MathParser parser, PlotSettings settings, List<ScatterSeries> series)
            : base(parser, settings)
        {
            _series = series;
        }

        public override string Plot()
        {
            GetImageSize();
            var chartId = GetChartId();

            var sb = new StringBuilder();

            // Container + Log Panel
            sb.AppendLine(GenerateContainer(chartId));
            sb.AppendLine(GenerateLogPanel(chartId));

            // Script
            sb.AppendLine("<script>");
            sb.AppendLine("(function(){");
            sb.AppendLine("const startTime = performance.now();");
            sb.AppendLine(JsLogInit(chartId, "Scatter"));

            // Check dependencies
            sb.AppendLine($"const canvas = document.getElementById('{chartId}');");
            sb.AppendLine($"if (!canvas) {{ {JsLog(chartId, "'ERROR: Canvas no encontrado'")} return; }}");
            sb.AppendLine($"if (typeof Chart === 'undefined') {{ {JsLog(chartId, "'ERROR: Chart.js no cargado!'")} return; }}");
            sb.AppendLine(JsLog(chartId, "'Chart.js v' + Chart.version + ' OK'"));

            sb.AppendLine("const ctx = canvas.getContext('2d');");

            // Build datasets
            sb.AppendLine("const datasets = [");
            for (int i = 0; i < _series.Count; i++)
            {
                var s = _series[i];
                if (i > 0) sb.AppendLine(",");

                sb.AppendLine("{");
                sb.AppendLine($"  label: '{EscapeJs(s.Label)}',");
                sb.AppendLine($"  data: {ToJsPointArray(s.XData, s.YData)},");
                sb.AppendLine($"  backgroundColor: '{GetColorAlpha(i, 0.7)}',");
                sb.AppendLine($"  borderColor: '{GetColor(i)}',");
                sb.AppendLine("  borderWidth: 1,");
                sb.AppendLine("  pointRadius: 5,");
                sb.AppendLine("  pointHoverRadius: 7");
                sb.Append("}");
            }
            sb.AppendLine("];");
            sb.AppendLine(JsLog(chartId, $"'Datos: {_series[0].XData.Length} puntos'"));

            // Create chart
            sb.AppendLine($@"
new Chart(ctx, {{
  type: 'scatter',
  data: {{ datasets: datasets }},
  options: {{
    responsive: true,
    maintainAspectRatio: false,
    plugins: {{
      legend: {{
        display: {(_series.Count > 1 ? "true" : "false")},
        position: 'top'
      }},
      tooltip: {{
        callbacks: {{
          label: function(context) {{
            return context.dataset.label + ': (' +
                   context.parsed.x.toFixed(3) + ', ' +
                   context.parsed.y.toFixed(3) + ')';
          }}
        }}
      }}
    }},
    scales: {{
      x: {{
        type: 'linear',
        position: 'bottom',
        grid: {{
          color: 'rgba(0,0,0,0.1)'
        }}
      }},
      y: {{
        grid: {{
          color: 'rgba(0,0,0,0.1)'
        }}
      }}
    }}
  }}
}});
{JsLog(chartId, "'Renderizado en ' + (performance.now() - startTime).toFixed(1) + ' ms'")}");
            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }
    }
}
