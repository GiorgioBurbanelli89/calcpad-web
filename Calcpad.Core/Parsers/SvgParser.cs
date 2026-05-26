using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Svg command - Modular SVG drawing system
    ///
    /// MODULAR SYNTAX:
    ///
    /// 1. Create objects (stored internally):
    ///    rect1 = $Svg{rect; x; y; width; height; fill; stroke; stroke-width}
    ///    circle1 = $Svg{circle; cx; cy; r; fill; stroke}
    ///    line1 = $Svg{line; x1; y1; x2; y2; stroke; stroke-width}
    ///    ellipse1 = $Svg{ellipse; cx; cy; rx; ry; fill; stroke}
    ///    polygon1 = $Svg{polygon; points; fill; stroke}
    ///    polyline1 = $Svg{polyline; points; stroke; stroke-width}
    ///    path1 = $Svg{path; d; fill; stroke; stroke-width}
    ///    text1 = $Svg{text; x; y; "content"; font-size; fill}
    ///    group1 = $Svg{group; transform}
    ///
    /// 2. Render SVG combining objects:
    ///    $Svg{800; 600; "#ffffff" | rect1 | circle1 | line1 | text1}
    ///
    /// 3. Or define inline:
    ///    $Svg{600; 400; "#fff" | rect; 10; 10; 100; 50; "#blue"; "#navy"; 2 | circle; 200; 100; 40; "#red"}
    ///
    /// 4. Advanced features:
    ///    - Gradients: $Svg{gradient; linear; id; x1; y1; x2; y2; stops}
    ///    - Filters: $Svg{filter; blur; id; stdDeviation}
    ///    - Patterns: $Svg{pattern; id; width; height; patternUnits}
    ///    - Clips: $Svg{clipPath; id; shapes}
    /// </summary>
    internal class SvgParser : PlotParser
    {
        // Static registry for named objects
        private static readonly Dictionary<string, SvgObject> _objectRegistry = new Dictionary<string, SvgObject>();
        private static readonly Dictionary<string, SvgDef> _defsRegistry = new Dictionary<string, SvgDef>();

        private string _targetVariable = null;

        internal SvgParser(MathParser parser, PlotSettings settings) : base(parser, settings) { }

        internal void SetTargetVariable(string name)
        {
            _targetVariable = name;
        }

        public static void ClearRegistry()
        {
            _objectRegistry.Clear();
            _defsRegistry.Clear();
        }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            int startBrace = script.IndexOf('{');
            if (startBrace < 0)
                return "<span class=\"err\">$Svg: Missing opening brace</span>";

            int endBrace = FindMatchingBrace(script, startBrace);
            if (endBrace < 0)
                return "<span class=\"err\">$Svg: Missing closing brace</span>";

            var content = script.Slice(startBrace + 1, endBrace - startBrace - 1).ToString().Trim();

            if (!calculate)
                return GetHtmlText(content);

            try
            {
                var pipeIndex = content.IndexOf('|');
                var firstPart = pipeIndex > 0 ? content.Substring(0, pipeIndex).Trim() : content;
                var firstParams = SplitTopLevel(firstPart, ';');

                if (firstParams.Length == 0)
                    return "<span class=\"err\">$Svg: Empty content</span>";

                var firstToken = firstParams[0].Trim().ToLowerInvariant();

                // Check if it's an object type
                if (IsObjectType(firstToken))
                {
                    return ParseObjectCreation(firstToken, firstParams);
                }
                // Check if it's an SVG canvas (first param is numeric - width)
                else if (double.TryParse(firstToken, NumberStyles.Float, CultureInfo.InvariantCulture, out double width))
                {
                    return ParseSvgCreation(content, width);
                }
                // Check if it's a definition (gradient, filter, pattern, etc.)
                else if (IsDefType(firstToken))
                {
                    return ParseDefCreation(firstToken, firstParams);
                }
                else
                {
                    return $"<span class=\"err\">$Svg: Unknown command '{firstToken}'</span>";
                }
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">$Svg error: {ex.Message}</span>";
            }
        }

        private bool IsObjectType(string token)
        {
            return token == "rect" || token == "circle" || token == "line" ||
                   token == "ellipse" || token == "polygon" || token == "polyline" ||
                   token == "path" || token == "text" || token == "group" ||
                   token == "image" || token == "use";
        }

        private bool IsDefType(string token)
        {
            return token == "gradient" || token == "lineargradient" || token == "radialgradient" ||
                   token == "filter" || token == "pattern" || token == "clippath" ||
                   token == "marker" || token == "mask";
        }

        private string ParseObjectCreation(string objectType, string[] parts)
        {
            var obj = new SvgObject
            {
                Name = _targetVariable ?? $"obj_{Guid.NewGuid():N}",
                ObjectType = objectType
            };

            // Parse parameters based on object type
            switch (objectType)
            {
                case "rect":
                    // rect; x; y; width; height; fill; stroke; stroke-width; rx; ry
                    if (parts.Length < 5) return "<span class=\"err\">$Svg rect: requires x, y, width, height</span>";
                    obj.X = ParseDouble(parts[1]);
                    obj.Y = ParseDouble(parts[2]);
                    obj.Width = ParseDouble(parts[3]);
                    obj.Height = ParseDouble(parts[4]);
                    if (parts.Length > 5) obj.Fill = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.Stroke = parts[6].Trim().Trim('"', '\'');
                    if (parts.Length > 7) obj.StrokeWidth = ParseDouble(parts[7]);
                    if (parts.Length > 8) obj.Rx = ParseDouble(parts[8]);
                    if (parts.Length > 9) obj.Ry = ParseDouble(parts[9]);
                    break;

                case "circle":
                    // circle; cx; cy; r; fill; stroke; stroke-width
                    if (parts.Length < 4) return "<span class=\"err\">$Svg circle: requires cx, cy, r</span>";
                    obj.Cx = ParseDouble(parts[1]);
                    obj.Cy = ParseDouble(parts[2]);
                    obj.R = ParseDouble(parts[3]);
                    if (parts.Length > 4) obj.Fill = parts[4].Trim().Trim('"', '\'');
                    if (parts.Length > 5) obj.Stroke = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.StrokeWidth = ParseDouble(parts[6]);
                    break;

                case "line":
                    // line; x1; y1; x2; y2; stroke; stroke-width
                    if (parts.Length < 5) return "<span class=\"err\">$Svg line: requires x1, y1, x2, y2</span>";
                    obj.X1 = ParseDouble(parts[1]);
                    obj.Y1 = ParseDouble(parts[2]);
                    obj.X2 = ParseDouble(parts[3]);
                    obj.Y2 = ParseDouble(parts[4]);
                    if (parts.Length > 5) obj.Stroke = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.StrokeWidth = ParseDouble(parts[6]);
                    break;

                case "ellipse":
                    // ellipse; cx; cy; rx; ry; fill; stroke; stroke-width
                    if (parts.Length < 5) return "<span class=\"err\">$Svg ellipse: requires cx, cy, rx, ry</span>";
                    obj.Cx = ParseDouble(parts[1]);
                    obj.Cy = ParseDouble(parts[2]);
                    obj.Rx = ParseDouble(parts[3]);
                    obj.Ry = ParseDouble(parts[4]);
                    if (parts.Length > 5) obj.Fill = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.Stroke = parts[6].Trim().Trim('"', '\'');
                    if (parts.Length > 7) obj.StrokeWidth = ParseDouble(parts[7]);
                    break;

                case "polygon":
                    // polygon; points; fill; stroke; stroke-width
                    if (parts.Length < 2) return "<span class=\"err\">$Svg polygon: requires points</span>";
                    obj.Points = parts[1].Trim().Trim('"', '\'');
                    if (parts.Length > 2) obj.Fill = parts[2].Trim().Trim('"', '\'');
                    if (parts.Length > 3) obj.Stroke = parts[3].Trim().Trim('"', '\'');
                    if (parts.Length > 4) obj.StrokeWidth = ParseDouble(parts[4]);
                    break;

                case "polyline":
                    // polyline; points; stroke; stroke-width; fill
                    if (parts.Length < 2) return "<span class=\"err\">$Svg polyline: requires points</span>";
                    obj.Points = parts[1].Trim().Trim('"', '\'');
                    if (parts.Length > 2) obj.Stroke = parts[2].Trim().Trim('"', '\'');
                    if (parts.Length > 3) obj.StrokeWidth = ParseDouble(parts[3]);
                    if (parts.Length > 4) obj.Fill = parts[4].Trim().Trim('"', '\'');
                    else obj.Fill = "none";
                    break;

                case "path":
                    // path; d; fill; stroke; stroke-width
                    if (parts.Length < 2) return "<span class=\"err\">$Svg path: requires d attribute</span>";
                    obj.D = parts[1].Trim().Trim('"', '\'');
                    if (parts.Length > 2) obj.Fill = parts[2].Trim().Trim('"', '\'');
                    if (parts.Length > 3) obj.Stroke = parts[3].Trim().Trim('"', '\'');
                    if (parts.Length > 4) obj.StrokeWidth = ParseDouble(parts[4]);
                    break;

                case "text":
                    // text; x; y; content; font-size; fill; font-family
                    if (parts.Length < 4) return "<span class=\"err\">$Svg text: requires x, y, content</span>";
                    obj.X = ParseDouble(parts[1]);
                    obj.Y = ParseDouble(parts[2]);
                    obj.TextContent = parts[3].Trim().Trim('"', '\'');
                    if (parts.Length > 4) obj.FontSize = ParseDouble(parts[4]);
                    if (parts.Length > 5) obj.Fill = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.FontFamily = parts[6].Trim().Trim('"', '\'');
                    break;

                case "group":
                    // group; transform; id
                    obj.Transform = parts.Length > 1 ? parts[1].Trim().Trim('"', '\'') : "";
                    obj.Id = parts.Length > 2 ? parts[2].Trim().Trim('"', '\'') : $"group_{Guid.NewGuid():N}";
                    break;
            }

            // Register the object
            if (!string.IsNullOrEmpty(obj.Name))
            {
                _objectRegistry[obj.Name] = obj;
            }

            return $"<span class=\"eq\" style=\"color:#888;font-size:0.9em;\">🎨 SVG.{obj.ObjectType}: {obj.Name}</span>";
        }

        private string ParseDefCreation(string defType, string[] parts)
        {
            var def = new SvgDef
            {
                Name = _targetVariable ?? $"def_{Guid.NewGuid():N}",
                DefType = defType
            };

            switch (defType)
            {
                case "gradient":
                case "lineargradient":
                    // gradient; linear; id; x1; y1; x2; y2
                    if (parts.Length < 3) return "<span class=\"err\">$Svg gradient: requires type and id</span>";
                    def.Id = parts[2].Trim().Trim('"', '\'');
                    if (parts.Length > 3) def.X1 = ParseDouble(parts[3]);
                    if (parts.Length > 4) def.Y1 = ParseDouble(parts[4]);
                    if (parts.Length > 5) def.X2 = ParseDouble(parts[5]);
                    if (parts.Length > 6) def.Y2 = ParseDouble(parts[6]);
                    break;

                case "radialgradient":
                    // radialgradient; id; cx; cy; r
                    if (parts.Length < 2) return "<span class=\"err\">$Svg radialGradient: requires id</span>";
                    def.Id = parts[1].Trim().Trim('"', '\'');
                    if (parts.Length > 2) def.Cx = ParseDouble(parts[2]);
                    if (parts.Length > 3) def.Cy = ParseDouble(parts[3]);
                    if (parts.Length > 4) def.R = ParseDouble(parts[4]);
                    break;

                case "filter":
                    // filter; id; filterType; params...
                    if (parts.Length < 3) return "<span class=\"err\">$Svg filter: requires id and type</span>";
                    def.Id = parts[1].Trim().Trim('"', '\'');
                    def.FilterType = parts[2].Trim().ToLowerInvariant();
                    break;
            }

            if (!string.IsNullOrEmpty(def.Name))
            {
                _defsRegistry[def.Name] = def;
            }

            return $"<span class=\"eq\" style=\"color:#888;font-size:0.9em;\">✨ SVG.def.{def.DefType}: {def.Name}</span>";
        }

        private string ParseSvgCreation(string content, double width)
        {
            var pipeParts = SplitByPipe(content);
            var headerParams = SplitTopLevel(pipeParts[0], ';');

            var svgObj = new SvgObject
            {
                ObjectType = "svg",
                Width = width,
                Height = 400,
                ViewBox = ""
            };

            if (headerParams.Length > 1 && double.TryParse(headerParams[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double height))
                svgObj.Height = height;
            if (headerParams.Length > 2)
                svgObj.Fill = headerParams[2].Trim().Trim('"', '\'');

            var children = new List<SvgObject>();
            var defs = new List<SvgDef>();

            // Parse children
            for (int i = 1; i < pipeParts.Length; i++)
            {
                var section = pipeParts[i].Trim();
                if (string.IsNullOrEmpty(section)) continue;

                var sectionParams = SplitTopLevel(section, ';');
                var firstToken = sectionParams[0].Trim().ToLowerInvariant();

                if (IsObjectType(firstToken))
                {
                    var inlineResult = ParseObjectCreation(firstToken, sectionParams);
                    if (inlineResult.Contains("err")) return inlineResult;

                    var lastKey = GetLastKey(_objectRegistry);
                    if (_objectRegistry.TryGetValue(lastKey, out var lastObj))
                    {
                        children.Add(lastObj);
                    }
                }
                else if (IsDefType(firstToken))
                {
                    var defResult = ParseDefCreation(firstToken, sectionParams);
                    if (defResult.Contains("err")) return defResult;

                    var lastKey = GetLastKey(_defsRegistry);
                    if (_defsRegistry.TryGetValue(lastKey, out var lastDef))
                    {
                        defs.Add(lastDef);
                    }
                }
                else
                {
                    // Try to find referenced object
                    if (_objectRegistry.TryGetValue(section, out var refObj))
                    {
                        children.Add(refObj);
                    }
                }
            }

            return GenerateSvgHtml(svgObj, children, defs);
        }

        private string GenerateSvgHtml(SvgObject svg, List<SvgObject> children, List<SvgDef> defs)
        {
            var svgId = $"svg_{Guid.NewGuid():N}";
            var sb = new StringBuilder();

            var viewBox = string.IsNullOrEmpty(svg.ViewBox) ? $"0 0 {(int)svg.Width} {(int)svg.Height}" : svg.ViewBox;
            var bgStyle = !string.IsNullOrEmpty(svg.Fill) ? $"background:{svg.Fill};" : "";

            sb.AppendLine($@"<div style=""margin:10px auto;width:{(int)svg.Width}px;"">");
            sb.AppendLine($@"<svg id=""{svgId}"" width=""{(int)svg.Width}"" height=""{(int)svg.Height}"" viewBox=""{viewBox}"" xmlns=""http://www.w3.org/2000/svg"" style=""{bgStyle}border:1px solid #ddd;"">");

            // Add defs if any
            if (defs.Count > 0)
            {
                sb.AppendLine("<defs>");
                foreach (var def in defs)
                {
                    sb.AppendLine(GenerateSvgDef(def));
                }
                sb.AppendLine("</defs>");
            }

            // Add children
            foreach (var child in children)
            {
                sb.AppendLine(GenerateSvgElement(child));
            }

            sb.AppendLine("</svg>");
            sb.AppendLine("</div>");

            return sb.ToString();
        }

        private string GenerateSvgElement(SvgObject obj)
        {
            var sb = new StringBuilder();
            var fillAttr = !string.IsNullOrEmpty(obj.Fill) ? $" fill=\"{obj.Fill}\"" : "";
            var strokeAttr = !string.IsNullOrEmpty(obj.Stroke) ? $" stroke=\"{obj.Stroke}\"" : "";
            var strokeWidthAttr = obj.StrokeWidth > 0 ? $" stroke-width=\"{obj.StrokeWidth.ToString("G", CultureInfo.InvariantCulture)}\"" : "";
            var idAttr = !string.IsNullOrEmpty(obj.Id) ? $" id=\"{obj.Id}\"" : "";
            var transformAttr = !string.IsNullOrEmpty(obj.Transform) ? $" transform=\"{obj.Transform}\"" : "";

            switch (obj.ObjectType)
            {
                case "rect":
                    var rxAttr = obj.Rx > 0 ? $" rx=\"{obj.Rx.ToString("G", CultureInfo.InvariantCulture)}\"" : "";
                    var ryAttr = obj.Ry > 0 ? $" ry=\"{obj.Ry.ToString("G", CultureInfo.InvariantCulture)}\"" : "";
                    sb.Append($"<rect x=\"{obj.X.ToString("G", CultureInfo.InvariantCulture)}\" y=\"{obj.Y.ToString("G", CultureInfo.InvariantCulture)}\" width=\"{obj.Width.ToString("G", CultureInfo.InvariantCulture)}\" height=\"{obj.Height.ToString("G", CultureInfo.InvariantCulture)}\"{fillAttr}{strokeAttr}{strokeWidthAttr}{rxAttr}{ryAttr}{idAttr}{transformAttr}/>");
                    break;

                case "circle":
                    sb.Append($"<circle cx=\"{obj.Cx.ToString("G", CultureInfo.InvariantCulture)}\" cy=\"{obj.Cy.ToString("G", CultureInfo.InvariantCulture)}\" r=\"{obj.R.ToString("G", CultureInfo.InvariantCulture)}\"{fillAttr}{strokeAttr}{strokeWidthAttr}{idAttr}{transformAttr}/>");
                    break;

                case "line":
                    sb.Append($"<line x1=\"{obj.X1.ToString("G", CultureInfo.InvariantCulture)}\" y1=\"{obj.Y1.ToString("G", CultureInfo.InvariantCulture)}\" x2=\"{obj.X2.ToString("G", CultureInfo.InvariantCulture)}\" y2=\"{obj.Y2.ToString("G", CultureInfo.InvariantCulture)}\"{strokeAttr}{strokeWidthAttr}{idAttr}{transformAttr}/>");
                    break;

                case "ellipse":
                    sb.Append($"<ellipse cx=\"{obj.Cx.ToString("G", CultureInfo.InvariantCulture)}\" cy=\"{obj.Cy.ToString("G", CultureInfo.InvariantCulture)}\" rx=\"{obj.Rx.ToString("G", CultureInfo.InvariantCulture)}\" ry=\"{obj.Ry.ToString("G", CultureInfo.InvariantCulture)}\"{fillAttr}{strokeAttr}{strokeWidthAttr}{idAttr}{transformAttr}/>");
                    break;

                case "polygon":
                    sb.Append($"<polygon points=\"{obj.Points}\"{fillAttr}{strokeAttr}{strokeWidthAttr}{idAttr}{transformAttr}/>");
                    break;

                case "polyline":
                    sb.Append($"<polyline points=\"{obj.Points}\"{fillAttr}{strokeAttr}{strokeWidthAttr}{idAttr}{transformAttr}/>");
                    break;

                case "path":
                    sb.Append($"<path d=\"{obj.D}\"{fillAttr}{strokeAttr}{strokeWidthAttr}{idAttr}{transformAttr}/>");
                    break;

                case "text":
                    var fontSizeAttr = obj.FontSize > 0 ? $" font-size=\"{obj.FontSize.ToString("G", CultureInfo.InvariantCulture)}\"" : "";
                    var fontFamilyAttr = !string.IsNullOrEmpty(obj.FontFamily) ? $" font-family=\"{obj.FontFamily}\"" : "";
                    sb.Append($"<text x=\"{obj.X.ToString("G", CultureInfo.InvariantCulture)}\" y=\"{obj.Y.ToString("G", CultureInfo.InvariantCulture)}\"{fillAttr}{fontSizeAttr}{fontFamilyAttr}{idAttr}{transformAttr}>{obj.TextContent}</text>");
                    break;

                case "group":
                    sb.Append($"<g{idAttr}{transformAttr}></g>");
                    break;
            }

            return sb.ToString();
        }

        private string GenerateSvgDef(SvgDef def)
        {
            var sb = new StringBuilder();

            switch (def.DefType)
            {
                case "gradient":
                case "lineargradient":
                    sb.Append($"<linearGradient id=\"{def.Id}\" x1=\"{def.X1}%\" y1=\"{def.Y1}%\" x2=\"{def.X2}%\" y2=\"{def.Y2}%\">");
                    sb.Append("<stop offset=\"0%\" style=\"stop-color:rgb(255,255,0);stop-opacity:1\"/>");
                    sb.Append("<stop offset=\"100%\" style=\"stop-color:rgb(255,0,0);stop-opacity:1\"/>");
                    sb.Append("</linearGradient>");
                    break;

                case "radialgradient":
                    sb.Append($"<radialGradient id=\"{def.Id}\" cx=\"{def.Cx}%\" cy=\"{def.Cy}%\" r=\"{def.R}%\">");
                    sb.Append("<stop offset=\"0%\" style=\"stop-color:rgb(255,255,255);stop-opacity:1\"/>");
                    sb.Append("<stop offset=\"100%\" style=\"stop-color:rgb(0,0,255);stop-opacity:1\"/>");
                    sb.Append("</radialGradient>");
                    break;

                case "filter":
                    sb.Append($"<filter id=\"{def.Id}\">");
                    if (def.FilterType == "blur")
                        sb.Append("<feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"5\"/>");
                    sb.Append("</filter>");
                    break;
            }

            return sb.ToString();
        }

        private double ParseDouble(string s)
        {
            Parser.Parse(s.Trim());
            return Parser.CalculateReal();
        }

        private string[] SplitTopLevel(string s, char delimiter)
        {
            var result = new List<string>();
            var current = new StringBuilder();
            int depth = 0;

            foreach (char c in s)
            {
                if (c == '{' || c == '[' || c == '(') depth++;
                else if (c == '}' || c == ']' || c == ')') depth--;
                else if (c == delimiter && depth == 0)
                {
                    result.Add(current.ToString());
                    current.Clear();
                    continue;
                }
                current.Append(c);
            }

            if (current.Length > 0)
                result.Add(current.ToString());

            return result.ToArray();
        }

        private string[] SplitByPipe(string s)
        {
            return SplitTopLevel(s, '|');
        }

        private string GetLastKey(Dictionary<string, SvgObject> dict)
        {
            string lastKey = null;
            foreach (var key in dict.Keys)
                lastKey = key;
            return lastKey;
        }

        private string GetLastKey(Dictionary<string, SvgDef> dict)
        {
            string lastKey = null;
            foreach (var key in dict.Keys)
                lastKey = key;
            return lastKey;
        }

        private int FindMatchingBrace(ReadOnlySpan<char> s, int start)
        {
            int depth = 0;
            for (int i = start; i < s.Length; i++)
            {
                if (s[i] == '{') depth++;
                else if (s[i] == '}')
                {
                    depth--;
                    if (depth == 0) return i;
                }
            }
            return -1;
        }

        private string GetHtmlText(string content)
        {
            return $"<p><strong>$Svg</strong>{{{content}}}</p>";
        }
    }

    internal class SvgObject
    {
        public string Name { get; set; }
        public string ObjectType { get; set; }
        public string Id { get; set; }

        // Common attributes
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }

        // Circle/Ellipse
        public double Cx { get; set; }
        public double Cy { get; set; }
        public double R { get; set; }
        public double Rx { get; set; }
        public double Ry { get; set; }

        // Line
        public double X1 { get; set; }
        public double Y1 { get; set; }
        public double X2 { get; set; }
        public double Y2 { get; set; }

        // Polygon/Polyline
        public string Points { get; set; }

        // Path
        public string D { get; set; }

        // Text
        public string TextContent { get; set; }
        public double FontSize { get; set; } = 14;
        public string FontFamily { get; set; } = "Arial";

        // Styling
        public string Fill { get; set; } = "#4a90d9";
        public string Stroke { get; set; } = "#2c5aa0";
        public double StrokeWidth { get; set; } = 2;

        // Transform
        public string Transform { get; set; }

        // SVG root
        public string ViewBox { get; set; }
    }

    internal class SvgDef
    {
        public string Name { get; set; }
        public string DefType { get; set; }
        public string Id { get; set; }

        // Gradient
        public double X1 { get; set; }
        public double Y1 { get; set; }
        public double X2 { get; set; } = 100;
        public double Y2 { get; set; }
        public double Cx { get; set; } = 50;
        public double Cy { get; set; } = 50;
        public double R { get; set; } = 50;

        // Filter
        public string FilterType { get; set; }
    }
}
