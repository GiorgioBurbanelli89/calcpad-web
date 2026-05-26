using System;
using System.Text;
using System.Globalization;
using System.Collections.Generic;

namespace Calcpad.Core
{
    /// <summary>
    /// Simple SVG drawing functions like Python/matplotlib.
    /// No need for complicated ' syntax.
    ///
    /// Single elements with optional style:
    ///   $rect{x; y; w; h}  or  $rect{x; y; w; h; fill; stroke; stroke-width}
    ///   $circle{cx; cy; r}  or  $circle{cx; cy; r; fill; stroke}
    ///   $line{x1; y1; x2; y2}  or  $line{x1; y1; x2; y2; stroke; width}
    ///   $ellipse{cx; cy; rx; ry; fill; stroke}
    ///   $text{x; y; "content"}  or  $text{x; y; "content"; size; color; font}
    ///   $polygon{x1;y1; x2;y2; x3;y3; ...; fill; stroke}
    ///   $polyline{x1;y1; x2;y2; ...; stroke; width}
    ///
    /// Colors: blue, red, green, yellow, black, white, gray, #RRGGBB, rgb(r,g,b)
    ///
    /// Combined drawing:
    ///   $draw{rect(0;0;100;50;blue) | circle(50;25;10;red) | line(0;0;100;50)}
    /// </summary>
    internal class SimpleSvgParser
    {
        private readonly MathParser _parser;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        // Default styles
        private const string DefaultFill = "#4a90d9";
        private const string DefaultStroke = "#2c5aa0";
        private const string DefaultTextFill = "#333";
        private const double DefaultStrokeWidth = 2;
        private const double DefaultFontSize = 14;

        // Block mode state
        private readonly bool _blockMode;
        private readonly string _blockFill;
        private readonly string _blockStroke;
        private readonly double _blockStrokeWidth;
        private readonly double _blockFillOpacity;
        private readonly double _blockStrokeOpacity;

        internal SimpleSvgParser(MathParser parser) : this(parser, false, DefaultFill, DefaultStroke, DefaultStrokeWidth, 1.0, 1.0)
        {
        }

        internal SimpleSvgParser(MathParser parser, bool blockMode, string fill, string stroke, double strokeWidth, double fillOpacity = 1.0, double strokeOpacity = 1.0)
        {
            _parser = parser;
            _blockMode = blockMode;
            _blockFill = fill;
            _blockStroke = stroke;
            _blockStrokeWidth = strokeWidth;
            _blockFillOpacity = fillOpacity;
            _blockStrokeOpacity = strokeOpacity;
        }

        internal string ParseRect(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$rect</strong>{x; y; w; h}</p>";
            return ParseShape(s, "rect");
        }

        internal string ParseCircle(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$circle</strong>{cx; cy; r}</p>";
            return ParseShape(s, "circle");
        }

        internal string ParseLine(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$line</strong>{x1; y1; x2; y2}</p>";
            return ParseShape(s, "line");
        }

        internal string ParseEllipse(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$ellipse</strong>{cx; cy; rx; ry}</p>";
            return ParseShape(s, "ellipse");
        }

        internal string ParseText(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$text</strong>{x; y; content}</p>";
            return ParseShape(s, "text");
        }

        internal string ParsePolygon(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$polygon</strong>{x1;y1; x2;y2; x3;y3; ...}</p>";
            return ParseShape(s, "polygon");
        }

        internal string ParsePolyline(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$polyline</strong>{x1;y1; x2;y2; ...}</p>";
            return ParseShape(s, "polyline");
        }

        internal string ParseDraw(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate) return "<p><strong>$draw</strong>{rect(...) | circle(...) | line(...)}</p>";
            return ParseCombinedDraw(s);
        }

        /// <summary>
        /// Unified SVG function: $svg{type; params...}
        /// Examples:
        ///   $svg{line; x1; y1; x2; y2}
        ///   $svg{line; x1; y1; x2; y2; color}
        ///   $svg{line; x1; y1; x2; y2; color; width}
        ///   $svg{rect; x; y; w; h}
        ///   $svg{rect; x; y; w; h; fill; stroke}
        ///   $svg{circle; cx; cy; r}
        ///   $svg{circle; cx; cy; r; fill; stroke}
        ///   $svg{text; x; y; "content"}
        ///   $svg{text; x; y; "content"; size; color; font}
        /// </summary>
        internal string ParseSvg(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate)
                return "<p><strong>$svg</strong>{type; params...} - type: line, rect, circle, ellipse, text, polygon, polyline</p>";

            try
            {
                var startIdx = s.IndexOf('{');
                var endIdx = s.LastIndexOf('}');
                if (startIdx == -1 || endIdx <= startIdx)
                    return "<p style='color:red;'>Error: Missing braces in $svg</p>";

                var content = s.Slice(startIdx + 1, endIdx - startIdx - 1).ToString();
                var parts = content.Split(';');

                if (parts.Length < 1)
                    return "<p style='color:red;'>$svg requires: type; params...</p>";

                var shapeType = parts[0].Trim().ToLower();

                // Rebuild content without the type for parsing
                var paramsContent = string.Join(";", parts, 1, parts.Length - 1);
                var p = ParseParameters(paramsContent);

                return shapeType switch
                {
                    "line" => GenerateLine(p),
                    "rect" => GenerateRect(p),
                    "circle" => GenerateCircle(p),
                    "ellipse" => GenerateEllipse(p),
                    "text" => GenerateText(p, paramsContent),
                    "polygon" => GeneratePolygon(p),
                    "polyline" => GeneratePolyline(p),
                    _ => $"<p style='color:red;'>Unknown SVG type: {shapeType}. Use: line, rect, circle, ellipse, text, polygon, polyline</p>"
                };
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error in $svg: {ex.Message}</p>";
            }
        }

        private string ParseShape(ReadOnlySpan<char> s, string shapeType)
        {
            try
            {
                var startIdx = s.IndexOf('{');
                var endIdx = s.LastIndexOf('}');
                if (startIdx == -1 || endIdx <= startIdx)
                    return $"<p style='color:red;'>Error: Missing braces in ${shapeType}</p>";

                var content = s.Slice(startIdx + 1, endIdx - startIdx - 1).ToString();
                var p = ParseParameters(content);

                return shapeType switch
                {
                    "rect" => GenerateRect(p),
                    "circle" => GenerateCircle(p),
                    "line" => GenerateLine(p),
                    "ellipse" => GenerateEllipse(p),
                    "text" => GenerateText(p, content),
                    "polygon" => GeneratePolygon(p),
                    "polyline" => GeneratePolyline(p),
                    _ => $"<p style='color:red;'>Unknown shape: {shapeType}</p>"
                };
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error in ${shapeType}: {ex.Message}</p>";
            }
        }

        private class ShapeParams
        {
            public List<double> Values { get; } = new List<double>();
            public string Fill { get; set; } = DefaultFill;
            public string Stroke { get; set; } = DefaultStroke;
            public double StrokeWidth { get; set; } = DefaultStrokeWidth;
            public double FontSize { get; set; } = DefaultFontSize;
            public string Font { get; set; } = "sans-serif";
            public string TextContent { get; set; } = "";
        }

        private ShapeParams ParseParameters(string content)
        {
            var result = new ShapeParams();
            var parts = content.Split(';');

            foreach (var part in parts)
            {
                var trimmed = part.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;

                // Check for text content in quotes
                if (trimmed.StartsWith("\"") && trimmed.EndsWith("\""))
                {
                    result.TextContent = trimmed.Substring(1, trimmed.Length - 2);
                    continue;
                }
                if (trimmed.StartsWith("'") && trimmed.EndsWith("'"))
                {
                    result.TextContent = trimmed.Substring(1, trimmed.Length - 2);
                    continue;
                }

                // Check for color names or hex colors
                if (IsColor(trimmed))
                {
                    var color = ParseColor(trimmed);
                    // First color is fill, second is stroke
                    if (result.Fill == DefaultFill)
                        result.Fill = color;
                    else
                        result.Stroke = color;
                    continue;
                }

                // Check for font names
                if (IsFont(trimmed))
                {
                    result.Font = trimmed;
                    continue;
                }

                // Try to parse as number
                try
                {
                    _parser.Parse(trimmed);
                    result.Values.Add(_parser.CalculateReal());
                }
                catch
                {
                    // Skip invalid parameters
                }
            }

            return result;
        }

        private bool IsColor(string s)
        {
            s = s.ToLower();
            return s.StartsWith("#") ||
                   s.StartsWith("rgb") ||
                   s == "blue" || s == "red" || s == "green" || s == "yellow" ||
                   s == "black" || s == "white" || s == "gray" || s == "grey" ||
                   s == "orange" || s == "purple" || s == "cyan" || s == "magenta" ||
                   s == "navy" || s == "teal" || s == "lime" || s == "maroon" ||
                   s == "silver" || s == "olive" || s == "aqua" || s == "fuchsia" ||
                   s == "none" || s == "transparent" ||
                   // Extended CSS colors for FEM visualization
                   s == "seagreen" || s == "lightpink" || s == "orangered" ||
                   s == "lightgreen" || s == "darkgreen" || s == "lightblue" ||
                   s == "darkblue" || s == "coral" || s == "salmon" ||
                   s == "gold" || s == "khaki" || s == "pink" ||
                   s == "brown" || s == "tan" || s == "beige" ||
                   s == "crimson" || s == "tomato" || s == "indianred" ||
                   s == "firebrick" || s == "darkred" || s == "lightgray" ||
                   s == "darkgray" || s == "dimgray" || s == "slategray";
        }

        private string ParseColor(string s)
        {
            s = s.ToLower();
            return s switch
            {
                "blue" => "#0066cc",
                "red" => "#cc3333",
                "green" => "#33aa33",
                "yellow" => "#ffcc00",
                "black" => "#000000",
                "white" => "#ffffff",
                "gray" or "grey" => "#888888",
                "orange" => "#ff8800",
                "purple" => "#8833aa",
                "cyan" => "#00cccc",
                "magenta" => "#cc33cc",
                "navy" => "#000080",
                "teal" => "#008080",
                "lime" => "#00ff00",
                "maroon" => "#800000",
                "silver" => "#c0c0c0",
                "olive" => "#808000",
                "aqua" => "#00ffff",
                "fuchsia" => "#ff00ff",
                "none" or "transparent" => "none",
                // Extended CSS colors for FEM visualization
                "seagreen" => "#2e8b57",
                "lightpink" => "#ffb6c1",
                "orangered" => "#ff4500",
                "lightgreen" => "#90ee90",
                "darkgreen" => "#006400",
                "lightblue" => "#add8e6",
                "darkblue" => "#00008b",
                "coral" => "#ff7f50",
                "salmon" => "#fa8072",
                "gold" => "#ffd700",
                "khaki" => "#f0e68c",
                "pink" => "#ffc0cb",
                "brown" => "#a52a2a",
                "tan" => "#d2b48c",
                "beige" => "#f5f5dc",
                "crimson" => "#dc143c",
                "tomato" => "#ff6347",
                "indianred" => "#cd5c5c",
                "firebrick" => "#b22222",
                "darkred" => "#8b0000",
                "lightgray" => "#d3d3d3",
                "darkgray" => "#a9a9a9",
                "dimgray" => "#696969",
                "slategray" => "#708090",
                _ => s // Return as-is for hex colors or rgb()
            };
        }

        private bool IsFont(string s)
        {
            s = s.ToLower();
            return s == "arial" || s == "helvetica" || s == "verdana" ||
                   s == "times" || s == "courier" || s == "georgia" ||
                   s == "sans-serif" || s == "serif" || s == "monospace";
        }

        private string GenerateRect(ShapeParams p)
        {
            var v = p.Values;
            if (v.Count < 4)
                return "<p style='color:red;'>$rect requires: x; y; w; h</p>";

            double x = v[0], y = v[1], w = v[2], h = v[3];

            // Use block styles as defaults if in block mode
            string fill = p.Fill != DefaultFill ? p.Fill : (_blockMode ? _blockFill : DefaultFill);
            string stroke = p.Stroke != DefaultStroke ? p.Stroke : (_blockMode ? _blockStroke : DefaultStroke);
            double strokeWidth = _blockMode ? _blockStrokeWidth : p.StrokeWidth;
            double fillOpacity = _blockMode ? _blockFillOpacity : 1.0;
            double strokeOpacity = _blockMode ? _blockStrokeOpacity : 1.0;

            string opacityAttr = "";
            if (fillOpacity < 1.0)
                opacityAttr += string.Format(Inv, " fill-opacity=\"{0:F2}\"", fillOpacity);
            if (strokeOpacity < 1.0)
                opacityAttr += string.Format(Inv, " stroke-opacity=\"{0:F2}\"", strokeOpacity);

            var element = string.Format(Inv, "<rect x=\"{0:F1}\" y=\"{1:F1}\" width=\"{2:F1}\" height=\"{3:F1}\" fill=\"{4}\" stroke=\"{5}\" stroke-width=\"{6:F1}\"{7}/>\n",
                x, y, w, h, fill, stroke, strokeWidth, opacityAttr);

            if (_blockMode)
                return element;

            // Standalone mode: wrap in SVG
            double svgW = Math.Max(x + w + 40, 100);
            double svgH = Math.Max(y + h + 40, 80);
            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n", svgW, svgH);
            sb.AppendFormat(Inv, "<rect x=\"{0:F1}\" y=\"{1:F1}\" width=\"{2:F1}\" height=\"{3:F1}\" fill=\"{4}\" stroke=\"{5}\" stroke-width=\"{6:F1}\"{7}/>\n",
                20 + x, 20 + y, w, h, fill, stroke, strokeWidth, opacityAttr);
            sb.AppendLine("</svg>");
            return sb.ToString();
        }

        private string GenerateCircle(ShapeParams p)
        {
            var v = p.Values;
            if (v.Count < 3)
                return "<p style='color:red;'>$circle requires: cx; cy; r</p>";

            double cx = v[0], cy = v[1], r = v[2];

            string fill = p.Fill != DefaultFill ? p.Fill : (_blockMode ? _blockFill : DefaultFill);
            string stroke = p.Stroke != DefaultStroke ? p.Stroke : (_blockMode ? _blockStroke : DefaultStroke);
            double strokeWidth = _blockMode ? _blockStrokeWidth : p.StrokeWidth;
            double fillOpacity = _blockMode ? _blockFillOpacity : 1.0;
            double strokeOpacity = _blockMode ? _blockStrokeOpacity : 1.0;

            string opacityAttr = "";
            if (fillOpacity < 1.0)
                opacityAttr += string.Format(Inv, " fill-opacity=\"{0:F2}\"", fillOpacity);
            if (strokeOpacity < 1.0)
                opacityAttr += string.Format(Inv, " stroke-opacity=\"{0:F2}\"", strokeOpacity);

            var element = string.Format(Inv, "<circle cx=\"{0:F1}\" cy=\"{1:F1}\" r=\"{2:F1}\" fill=\"{3}\" stroke=\"{4}\" stroke-width=\"{5:F1}\"{6}/>\n",
                cx, cy, r, fill, stroke, strokeWidth, opacityAttr);

            if (_blockMode)
                return element;

            double svgW = Math.Max(cx + r + 40, 100);
            double svgH = Math.Max(cy + r + 40, 100);
            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n", svgW, svgH);
            sb.AppendFormat(Inv, "<circle cx=\"{0:F1}\" cy=\"{1:F1}\" r=\"{2:F1}\" fill=\"{3}\" stroke=\"{4}\" stroke-width=\"{5:F1}\"{6}/>\n",
                20 + cx, 20 + cy, r, fill, stroke, strokeWidth, opacityAttr);
            sb.AppendLine("</svg>");
            return sb.ToString();
        }

        private string GenerateLine(ShapeParams p)
        {
            var v = p.Values;
            if (v.Count < 4)
                return "<p style='color:red;'>$line requires: x1; y1; x2; y2</p>";

            double x1 = v[0], y1 = v[1], x2 = v[2], y2 = v[3];

            // For lines, use Fill as stroke color (lines don't have fill)
            // In block mode, use _blockFill for stroke (first color in $style)
            string strokeColor;
            if (p.Fill != DefaultFill)
                strokeColor = p.Fill;  // Inline color specified
            else if (_blockMode && _blockFill != DefaultFill)
                strokeColor = _blockFill;  // Block style fill used as stroke
            else if (_blockMode)
                strokeColor = _blockStroke;
            else
                strokeColor = p.Stroke;
            double strokeWidth = _blockMode ? _blockStrokeWidth : p.StrokeWidth;

            var element = string.Format(Inv, "<line x1=\"{0:F1}\" y1=\"{1:F1}\" x2=\"{2:F1}\" y2=\"{3:F1}\" stroke=\"{4}\" stroke-width=\"{5:F1}\"/>\n",
                x1, y1, x2, y2, strokeColor, strokeWidth);

            if (_blockMode)
                return element;

            double maxX = Math.Max(x1, x2);
            double maxY = Math.Max(y1, y2);
            double svgW = Math.Max(maxX + 40, 100);
            double svgH = Math.Max(maxY + 40, 80);
            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n", svgW, svgH);
            sb.AppendFormat(Inv, "<line x1=\"{0:F1}\" y1=\"{1:F1}\" x2=\"{2:F1}\" y2=\"{3:F1}\" stroke=\"{4}\" stroke-width=\"{5:F1}\"/>\n",
                20 + x1, 20 + y1, 20 + x2, 20 + y2, strokeColor, strokeWidth);
            sb.AppendLine("</svg>");
            return sb.ToString();
        }

        private string GenerateEllipse(ShapeParams p)
        {
            var v = p.Values;
            if (v.Count < 4)
                return "<p style='color:red;'>$ellipse requires: cx; cy; rx; ry</p>";

            double cx = v[0], cy = v[1], rx = v[2], ry = v[3];

            string fill = p.Fill != DefaultFill ? p.Fill : (_blockMode ? _blockFill : DefaultFill);
            string stroke = p.Stroke != DefaultStroke ? p.Stroke : (_blockMode ? _blockStroke : DefaultStroke);
            double strokeWidth = _blockMode ? _blockStrokeWidth : p.StrokeWidth;

            var element = string.Format(Inv, "<ellipse cx=\"{0:F1}\" cy=\"{1:F1}\" rx=\"{2:F1}\" ry=\"{3:F1}\" fill=\"{4}\" stroke=\"{5}\" stroke-width=\"{6:F1}\"/>\n",
                cx, cy, rx, ry, fill, stroke, strokeWidth);

            if (_blockMode)
                return element;

            double svgW = Math.Max(cx + rx + 40, 100);
            double svgH = Math.Max(cy + ry + 40, 100);
            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n", svgW, svgH);
            sb.AppendFormat(Inv, "<ellipse cx=\"{0:F1}\" cy=\"{1:F1}\" rx=\"{2:F1}\" ry=\"{3:F1}\" fill=\"{4}\" stroke=\"{5}\" stroke-width=\"{6:F1}\"/>\n",
                20 + cx, 20 + cy, rx, ry, fill, stroke, strokeWidth);
            sb.AppendLine("</svg>");
            return sb.ToString();
        }

        private string GenerateText(ShapeParams p, string content)
        {
            var v = p.Values;
            if (v.Count < 2)
                return "<p style='color:red;'>$text requires: x; y; \"content\"</p>";

            double x = v[0], y = v[1];

            // Text content can be: quoted string OR numeric value at v[2]
            // $text{x; y; "string"} or $text{x; y; "string"; fontSize} - p.TextContent is set
            // $text{x; y; numericValue; fontSize} - p.TextContent is empty, use v[2] as text
            string text;
            double fontSize;

            if (!string.IsNullOrEmpty(p.TextContent))
            {
                // Quoted string provided
                text = p.TextContent;
                fontSize = v.Count >= 3 ? v[2] : p.FontSize;
            }
            else if (v.Count >= 3)
            {
                // Third parameter is numeric - use as text content
                text = v[2].ToString(Inv);
                fontSize = v.Count >= 4 ? v[3] : p.FontSize;
            }
            else
            {
                text = "Text";
                fontSize = p.FontSize;
            }

            string color = p.Fill != DefaultFill ? p.Fill : (_blockMode ? _blockFill : DefaultTextFill);

            var element = string.Format(Inv, "<text x=\"{0:F1}\" y=\"{1:F1}\" fill=\"{2}\" font-family=\"{3}\" font-size=\"{4:F0}\">{5}</text>\n",
                x, y, color, p.Font, fontSize, System.Web.HttpUtility.HtmlEncode(text));

            if (_blockMode)
                return element;

            double svgW = Math.Max(x + text.Length * fontSize * 0.6 + 40, 150);
            double svgH = Math.Max(y + 40, 60);
            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n", svgW, svgH);
            sb.AppendFormat(Inv, "<text x=\"{0:F1}\" y=\"{1:F1}\" fill=\"{2}\" font-family=\"{3}\" font-size=\"{4:F0}\">{5}</text>\n",
                20 + x, 20 + y, color, p.Font, fontSize, System.Web.HttpUtility.HtmlEncode(text));
            sb.AppendLine("</svg>");
            return sb.ToString();
        }

        private string GeneratePolygon(ShapeParams p)
        {
            var v = p.Values;
            if (v.Count < 6)
                return "<p style='color:red;'>$polygon requires at least 3 points: x1;y1; x2;y2; x3;y3</p>";

            string fill = p.Fill != DefaultFill ? p.Fill : (_blockMode ? _blockFill : DefaultFill);
            string stroke = p.Stroke != DefaultStroke ? p.Stroke : (_blockMode ? _blockStroke : DefaultStroke);
            double strokeWidth = _blockMode ? _blockStrokeWidth : p.StrokeWidth;

            var points = new StringBuilder();
            var pointsOffset = new StringBuilder();
            double maxX = 0, maxY = 0;

            for (int i = 0; i < v.Count - 1; i += 2)
            {
                double px = v[i], py = v[i + 1];
                if (px > maxX) maxX = px;
                if (py > maxY) maxY = py;
                if (points.Length > 0) { points.Append(" "); pointsOffset.Append(" "); }
                points.AppendFormat(Inv, "{0:F1},{1:F1}", px, py);
                pointsOffset.AppendFormat(Inv, "{0:F1},{1:F1}", 20 + px, 20 + py);
            }

            var element = string.Format(Inv, "<polygon points=\"{0}\" fill=\"{1}\" stroke=\"{2}\" stroke-width=\"{3:F1}\"/>\n",
                points, fill, stroke, strokeWidth);

            if (_blockMode)
                return element;

            double svgW = Math.Max(maxX + 40, 100);
            double svgH = Math.Max(maxY + 40, 100);
            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n", svgW, svgH);
            sb.AppendFormat(Inv, "<polygon points=\"{0}\" fill=\"{1}\" stroke=\"{2}\" stroke-width=\"{3:F1}\"/>\n",
                pointsOffset, fill, stroke, strokeWidth);
            sb.AppendLine("</svg>");
            return sb.ToString();
        }

        private string GeneratePolyline(ShapeParams p)
        {
            var v = p.Values;
            if (v.Count < 4)
                return "<p style='color:red;'>$polyline requires at least 2 points</p>";

            // For polylines, use Fill as stroke color (polylines don't use fill)
            // In block mode, use _blockFill for stroke (first color in $style)
            string strokeColor;
            if (p.Fill != DefaultFill)
                strokeColor = p.Fill;  // Inline color specified
            else if (_blockMode && _blockFill != DefaultFill)
                strokeColor = _blockFill;  // Block style fill used as stroke
            else if (_blockMode)
                strokeColor = _blockStroke;
            else
                strokeColor = p.Stroke;
            double strokeWidth = _blockMode ? _blockStrokeWidth : p.StrokeWidth;

            var points = new StringBuilder();
            var pointsOffset = new StringBuilder();
            double maxX = 0, maxY = 0;

            for (int i = 0; i < v.Count - 1; i += 2)
            {
                double px = v[i], py = v[i + 1];
                if (px > maxX) maxX = px;
                if (py > maxY) maxY = py;
                if (points.Length > 0) { points.Append(" "); pointsOffset.Append(" "); }
                points.AppendFormat(Inv, "{0:F1},{1:F1}", px, py);
                pointsOffset.AppendFormat(Inv, "{0:F1},{1:F1}", 20 + px, 20 + py);
            }

            var element = string.Format(Inv, "<polyline points=\"{0}\" fill=\"none\" stroke=\"{1}\" stroke-width=\"{2:F1}\"/>\n",
                points, strokeColor, strokeWidth);

            if (_blockMode)
                return element;

            double svgW = Math.Max(maxX + 40, 100);
            double svgH = Math.Max(maxY + 40, 100);
            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n", svgW, svgH);
            sb.AppendFormat(Inv, "<polyline points=\"{0}\" fill=\"none\" stroke=\"{1}\" stroke-width=\"{2:F1}\"/>\n",
                pointsOffset, strokeColor, strokeWidth);
            sb.AppendLine("</svg>");
            return sb.ToString();
        }

        private string ParseCombinedDraw(ReadOnlySpan<char> s)
        {
            try
            {
                var startIdx = s.IndexOf('{');
                var endIdx = s.LastIndexOf('}');
                if (startIdx == -1 || endIdx <= startIdx)
                    return "<p style='color:red;'>Error: Missing braces in $draw</p>";

                var content = s.Slice(startIdx + 1, endIdx - startIdx - 1).ToString();
                var shapes = content.Split('|');

                var elements = new List<string>();
                double maxX = 100, maxY = 100;

                foreach (var shape in shapes)
                {
                    var trimmed = shape.Trim();
                    if (string.IsNullOrEmpty(trimmed)) continue;

                    var (element, mx, my) = ParseDrawElement(trimmed);
                    if (!string.IsNullOrEmpty(element))
                    {
                        elements.Add(element);
                        if (mx > maxX) maxX = mx;
                        if (my > maxY) maxY = my;
                    }
                }

                if (elements.Count == 0)
                    return "<p style='color:red;'>No valid shapes in $draw</p>";

                var sb = new StringBuilder();
                sb.AppendFormat(Inv, "<svg width=\"{0:F0}\" height=\"{1:F0}\" style=\"background:#fafafa;border:1px solid #ddd;margin:5px;\">\n",
                    maxX + 40, maxY + 40);
                foreach (var elem in elements)
                    sb.AppendLine(elem);
                sb.AppendLine("</svg>");

                return sb.ToString();
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error in $draw: {ex.Message}</p>";
            }
        }

        private (string element, double maxX, double maxY) ParseDrawElement(string shape)
        {
            double ox = 20, oy = 20;
            double maxX = 0, maxY = 0;

            // Parse shape type and parameters: rect(x;y;w;h;fill;stroke)
            var parenStart = shape.IndexOf('(');
            var parenEnd = shape.LastIndexOf(')');
            if (parenStart == -1 || parenEnd <= parenStart)
                return ("", 0, 0);

            var shapeType = shape.Substring(0, parenStart).Trim().ToLower();
            var paramsStr = shape.Substring(parenStart + 1, parenEnd - parenStart - 1);
            var p = ParseParameters(paramsStr);
            var v = p.Values;

            string element = "";

            switch (shapeType)
            {
                case "rect":
                    if (v.Count >= 4)
                    {
                        maxX = v[0] + v[2];
                        maxY = v[1] + v[3];
                        element = string.Format(Inv, "<rect x=\"{0:F1}\" y=\"{1:F1}\" width=\"{2:F1}\" height=\"{3:F1}\" fill=\"{4}\" stroke=\"{5}\" stroke-width=\"{6:F1}\"/>",
                            ox + v[0], oy + v[1], v[2], v[3], p.Fill, p.Stroke, p.StrokeWidth);
                    }
                    break;

                case "circle":
                    if (v.Count >= 3)
                    {
                        maxX = v[0] + v[2];
                        maxY = v[1] + v[2];
                        element = string.Format(Inv, "<circle cx=\"{0:F1}\" cy=\"{1:F1}\" r=\"{2:F1}\" fill=\"{3}\" stroke=\"{4}\" stroke-width=\"{5:F1}\"/>",
                            ox + v[0], oy + v[1], v[2], p.Fill, p.Stroke, p.StrokeWidth);
                    }
                    break;

                case "line":
                    if (v.Count >= 4)
                    {
                        maxX = Math.Max(v[0], v[2]);
                        maxY = Math.Max(v[1], v[3]);
                        element = string.Format(Inv, "<line x1=\"{0:F1}\" y1=\"{1:F1}\" x2=\"{2:F1}\" y2=\"{3:F1}\" stroke=\"{4}\" stroke-width=\"{5:F1}\"/>",
                            ox + v[0], oy + v[1], ox + v[2], oy + v[3], p.Stroke, p.StrokeWidth);
                    }
                    break;

                case "ellipse":
                    if (v.Count >= 4)
                    {
                        maxX = v[0] + v[2];
                        maxY = v[1] + v[3];
                        element = string.Format(Inv, "<ellipse cx=\"{0:F1}\" cy=\"{1:F1}\" rx=\"{2:F1}\" ry=\"{3:F1}\" fill=\"{4}\" stroke=\"{5}\" stroke-width=\"{6:F1}\"/>",
                            ox + v[0], oy + v[1], v[2], v[3], p.Fill, p.Stroke, p.StrokeWidth);
                    }
                    break;
            }

            return (element, maxX, maxY);
        }
    }
}
