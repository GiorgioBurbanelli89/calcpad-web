using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Plotter for bar charts using Chart.js
    /// </summary>
    internal class BarPlotter : JsPlotter
    {
        private readonly string[] _labels;
        private readonly List<BarSeries> _series;
        private readonly bool _horizontal;

        internal BarPlotter(MathParser parser, PlotSettings settings,
                           string[] labels, List<BarSeries> series, bool horizontal)
            : base(parser, settings)
        {
            _labels = labels;
            _series = series;
            _horizontal = horizontal;
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
            sb.AppendLine(JsLogInit(chartId, _horizontal ? "BarH" : "Bar"));

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
                sb.AppendLine($"  data: {ToJsArray(s.Values)},");
                sb.AppendLine($"  backgroundColor: '{GetColorAlpha(i, 0.7)}',");
                sb.AppendLine($"  borderColor: '{GetColor(i)}',");
                sb.AppendLine("  borderWidth: 1");
                sb.Append("}");
            }
            sb.AppendLine("];");
            sb.AppendLine(JsLog(chartId, $"'Datos: {_labels.Length} categorías, {_series.Count} series'"));

            // Labels
            sb.AppendLine($"const labels = {ToJsArray(_labels)};");

            // Create chart
            var indexAxis = _horizontal ? "'y'" : "'x'";

            sb.AppendLine($@"
new Chart(ctx, {{
  type: 'bar',
  data: {{
    labels: labels,
    datasets: datasets
  }},
  options: {{
    indexAxis: {indexAxis},
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
            return context.dataset.label + ': ' + context.parsed.{(_horizontal ? "x" : "y")}.toFixed(2);
          }}
        }}
      }}
    }},
    scales: {{
      x: {{
        grid: {{
          color: 'rgba(0,0,0,0.1)'
        }},
        beginAtZero: {(_horizontal ? "true" : "false")}
      }},
      y: {{
        grid: {{
          color: 'rgba(0,0,0,0.1)'
        }},
        beginAtZero: {(!_horizontal ? "true" : "false")}
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
