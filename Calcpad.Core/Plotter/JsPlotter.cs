using System;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Base class for JavaScript-based chart rendering using Chart.js and Three.js
    /// </summary>
    internal abstract class JsPlotter
    {
        protected readonly MathParser Parser;
        protected readonly PlotSettings Settings;
        protected readonly StringBuilder Sb;
        protected int Width;
        protected int Height;
        protected static int ChartCounter = 0;

        // Enable visual logging panel in HTML output
        public static bool EnableVisualLog = true;

        protected JsPlotter(MathParser parser, PlotSettings settings)
        {
            Parser = parser;
            Settings = settings;
            Sb = new StringBuilder();
        }

        /// <summary>
        /// Generates a visual log panel div with a unique ID
        /// </summary>
        protected static string GenerateLogPanel(string chartId)
        {
            if (!EnableVisualLog) return "";
            return $"<div id=\"log_{chartId}\" style=\"font-family:monospace;font-size:10px;color:#666;background:#f8f8f8;border:1px solid #ddd;padding:4px 8px;margin:4px auto;max-width:480px;border-radius:3px;\"></div>";
        }

        /// <summary>
        /// Generates JavaScript code to add a log entry to the visual panel
        /// </summary>
        protected static string JsLog(string chartId, string message)
        {
            if (!EnableVisualLog) return $"console.log({message});";
            return $"(function(){{ var p=document.getElementById('log_{chartId}'); if(p) p.innerHTML += '<br>' + {message}; console.log({message}); }})();";
        }

        /// <summary>
        /// Generates JavaScript code to initialize the log panel
        /// </summary>
        protected static string JsLogInit(string chartId, string title)
        {
            if (!EnableVisualLog) return $"console.log('[{title}] Starting...');";
            return $"(function(){{ var p=document.getElementById('log_{chartId}'); if(p) p.innerHTML = '<b>[{title}]</b> Iniciando...'; }})();";
        }

        protected void GetImageSize()
        {
            Width = (int)Parser.PlotWidth;
            Height = (int)Parser.PlotHeight;
            if (Width <= 0) Width = 500;
            if (Height <= 0) Height = 400;
        }

        protected string GetChartId()
        {
            return $"chart_{++ChartCounter}";
        }

        /// <summary>
        /// Generates the HTML container for the chart
        /// </summary>
        protected string GenerateContainer(string chartId, string chartType = "canvas")
        {
            if (chartType == "canvas")
                return $"<div class=\"js-chart\" style=\"width:{Width}px;height:{Height}px;margin:10px auto;\"><canvas id=\"{chartId}\"></canvas></div>";
            else
                return $"<div id=\"{chartId}\" class=\"js-chart\" style=\"width:{Width}px;height:{Height}px;margin:10px auto;\"></div>";
        }

        /// <summary>
        /// Converts a double array to JavaScript array string
        /// </summary>
        protected static string ToJsArray(double[] values)
        {
            var sb = new StringBuilder("[");
            for (int i = 0; i < values.Length; i++)
            {
                if (i > 0) sb.Append(',');
                if (double.IsNaN(values[i]) || double.IsInfinity(values[i]))
                    sb.Append("null");
                else
                    sb.Append(values[i].ToString("G", CultureInfo.InvariantCulture));
            }
            sb.Append(']');
            return sb.ToString();
        }

        /// <summary>
        /// Converts a string array to JavaScript array string
        /// </summary>
        protected static string ToJsArray(string[] values)
        {
            var sb = new StringBuilder("[");
            for (int i = 0; i < values.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(EscapeJs(values[i])).Append('"');
            }
            sb.Append(']');
            return sb.ToString();
        }

        /// <summary>
        /// Converts point data to JavaScript array for scatter plots
        /// </summary>
        protected static string ToJsPointArray(double[] x, double[] y)
        {
            var sb = new StringBuilder("[");
            int len = Math.Min(x.Length, y.Length);
            for (int i = 0; i < len; i++)
            {
                if (i > 0) sb.Append(',');
                if (double.IsNaN(x[i]) || double.IsInfinity(x[i]) ||
                    double.IsNaN(y[i]) || double.IsInfinity(y[i]))
                    continue;
                sb.Append('{');
                sb.Append("x:").Append(x[i].ToString("G", CultureInfo.InvariantCulture));
                sb.Append(",y:").Append(y[i].ToString("G", CultureInfo.InvariantCulture));
                sb.Append('}');
            }
            sb.Append(']');
            return sb.ToString();
        }

        /// <summary>
        /// Converts 3D point data to JavaScript array
        /// </summary>
        protected static string ToJs3DPointArray(double[] x, double[] y, double[] z)
        {
            var sb = new StringBuilder("[");
            int len = Math.Min(Math.Min(x.Length, y.Length), z.Length);
            for (int i = 0; i < len; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('[');
                sb.Append(x[i].ToString("G", CultureInfo.InvariantCulture)).Append(',');
                sb.Append(y[i].ToString("G", CultureInfo.InvariantCulture)).Append(',');
                sb.Append(z[i].ToString("G", CultureInfo.InvariantCulture));
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        /// <summary>
        /// Escape string for JavaScript
        /// </summary>
        protected static string EscapeJs(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            return s.Replace("\\", "\\\\")
                   .Replace("\"", "\\\"")
                   .Replace("'", "\\'")
                   .Replace("\n", "\\n")
                   .Replace("\r", "\\r");
        }

        /// <summary>
        /// Get color from palette
        /// </summary>
        protected static string GetColor(int index)
        {
            string[] colors = [
                "rgb(255,99,71)",      // Tomato
                "rgb(154,205,50)",     // YellowGreen
                "rgb(100,149,237)",    // CornflowerBlue
                "rgb(240,208,0)",      // Gold
                "rgb(199,21,133)",     // MediumVioletRed
                "rgb(0,250,154)",      // MediumSpringGreen
                "rgb(138,43,226)",     // BlueViolet
                "rgb(255,160,122)",    // LightSalmon
                "rgb(255,20,147)",     // DeepPink
                "rgb(0,206,209)"       // DarkTurquoise
            ];
            return colors[index % colors.Length];
        }

        /// <summary>
        /// Get color with alpha from palette
        /// </summary>
        protected static string GetColorAlpha(int index, double alpha)
        {
            string[] colors = [
                $"rgba(255,99,71,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(154,205,50,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(100,149,237,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(240,208,0,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(199,21,133,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(0,250,154,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(138,43,226,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(255,160,122,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(255,20,147,{alpha.ToString("F2", CultureInfo.InvariantCulture)})",
                $"rgba(0,206,209,{alpha.ToString("F2", CultureInfo.InvariantCulture)})"
            ];
            return colors[index % colors.Length];
        }

        /// <summary>
        /// Generates Chart.js library script (embedded or CDN reference)
        /// </summary>
        protected static string GetChartJsScript()
        {
            // Using CDN for simplicity - could be embedded as resource
            return @"<script src=""https://cdn.jsdelivr.net/npm/chart.js""></script>";
        }

        /// <summary>
        /// Generates Three.js library script for 3D charts
        /// </summary>
        protected static string GetThreeJsScript()
        {
            // Three.js 0.128.0 is already loaded in template.html
            // This method returns empty string to avoid duplicate loading
            return "";
        }

        /// <summary>
        /// Abstract method to generate the chart
        /// </summary>
        public abstract string Plot();
    }
}
