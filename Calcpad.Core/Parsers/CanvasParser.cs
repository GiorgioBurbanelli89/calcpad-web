using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Canvas command - Modular 2D canvas drawing system
    ///
    /// MODULAR SYNTAX:
    ///
    /// 1. Create objects (stored internally):
    ///    rect1 = $Canvas{rect; x; y; width; height; "#color"}
    ///    circle1 = $Canvas{circle; x; y; radius; "#color"}
    ///    line1 = $Canvas{line; x1; y1; x2; y2; "#color"; width}
    ///    text1 = $Canvas{text; x; y; "content"; size; "#color"}
    ///    path1 = $Canvas{path; "M 10 10 L 100 100"; "#color"; width}
    ///    image1 = $Canvas{image; url; x; y; width; height}
    ///    arc1 = $Canvas{arc; x; y; radius; startAngle; endAngle; "#color"}
    ///
    /// 2. Render canvas combining objects:
    ///    $Canvas{800; 600; "#ffffff" | rect1 | circle1 | line1 | text1}
    ///
    /// 3. Or define inline:
    ///    $Canvas{800; 600; "#fff" | rect; 10; 10; 100; 50; "#blue" | circle; 50; 30; 20; "#red"}
    /// </summary>
    internal class CanvasParser : PlotParser
    {
        // Static registry for named objects
        private static readonly Dictionary<string, CanvasObject> _objectRegistry = new Dictionary<string, CanvasObject>();

        private string _targetVariable = null;

        internal CanvasParser(MathParser parser, PlotSettings settings) : base(parser, settings) { }

        internal void SetTargetVariable(string name)
        {
            _targetVariable = name;
        }

        public static void ClearRegistry()
        {
            _objectRegistry.Clear();
        }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            int startBrace = script.IndexOf('{');
            if (startBrace < 0)
                return "<span class=\"err\">$Canvas: Missing opening brace</span>";

            int endBrace = FindMatchingBrace(script, startBrace);
            if (endBrace < 0)
                return "<span class=\"err\">$Canvas: Missing closing brace</span>";

            var content = script.Slice(startBrace + 1, endBrace - startBrace - 1).ToString().Trim();

            if (!calculate)
                return GetHtmlText(content);

            try
            {
                var pipeIndex = content.IndexOf('|');
                var firstPart = pipeIndex > 0 ? content.Substring(0, pipeIndex).Trim() : content;
                var firstParams = SplitTopLevel(firstPart, ';');

                if (firstParams.Length == 0)
                    return "<span class=\"err\">$Canvas: Empty content</span>";

                var firstToken = firstParams[0].Trim().ToLowerInvariant();

                // Check if it's an object type
                if (IsObjectType(firstToken))
                {
                    return ParseObjectCreation(firstToken, firstParams);
                }
                // Check if it's a canvas (first param is numeric - width)
                else if (double.TryParse(firstToken, NumberStyles.Float, CultureInfo.InvariantCulture, out double width))
                {
                    return ParseCanvasCreation(content, width);
                }
                else
                {
                    return $"<span class=\"err\">$Canvas: Unknown command '{firstToken}'</span>";
                }
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">$Canvas error: {ex.Message}</span>";
            }
        }

        private bool IsObjectType(string token)
        {
            return token == "rect" || token == "circle" || token == "line" ||
                   token == "text" || token == "path" || token == "image" ||
                   token == "arc" || token == "polygon" || token == "ellipse";
        }

        private string ParseObjectCreation(string objectType, string[] parts)
        {
            var obj = new CanvasObject
            {
                Name = _targetVariable ?? $"obj_{Guid.NewGuid():N}",
                ObjectType = objectType
            };

            // Parse parameters based on object type
            switch (objectType)
            {
                case "rect":
                    // rect; x; y; width; height; fill; stroke; strokeWidth
                    if (parts.Length < 5) return "<span class=\"err\">$Canvas rect: requires x, y, width, height</span>";
                    obj.X = ParseDouble(parts[1]);
                    obj.Y = ParseDouble(parts[2]);
                    obj.Width = ParseDouble(parts[3]);
                    obj.Height = ParseDouble(parts[4]);
                    if (parts.Length > 5) obj.Fill = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.Stroke = parts[6].Trim().Trim('"', '\'');
                    if (parts.Length > 7) obj.StrokeWidth = ParseDouble(parts[7]);
                    break;

                case "circle":
                    // circle; x; y; radius; fill; stroke; strokeWidth
                    if (parts.Length < 4) return "<span class=\"err\">$Canvas circle: requires x, y, radius</span>";
                    obj.X = ParseDouble(parts[1]);
                    obj.Y = ParseDouble(parts[2]);
                    obj.Radius = ParseDouble(parts[3]);
                    if (parts.Length > 4) obj.Fill = parts[4].Trim().Trim('"', '\'');
                    if (parts.Length > 5) obj.Stroke = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.StrokeWidth = ParseDouble(parts[6]);
                    break;

                case "line":
                    // line; x1; y1; x2; y2; stroke; strokeWidth
                    if (parts.Length < 5) return "<span class=\"err\">$Canvas line: requires x1, y1, x2, y2</span>";
                    obj.X1 = ParseDouble(parts[1]);
                    obj.Y1 = ParseDouble(parts[2]);
                    obj.X2 = ParseDouble(parts[3]);
                    obj.Y2 = ParseDouble(parts[4]);
                    if (parts.Length > 5) obj.Stroke = parts[5].Trim().Trim('"', '\'');
                    if (parts.Length > 6) obj.StrokeWidth = ParseDouble(parts[6]);
                    break;

                case "text":
                    // text; x; y; content; fontSize; fill
                    if (parts.Length < 4) return "<span class=\"err\">$Canvas text: requires x, y, content</span>";
                    obj.X = ParseDouble(parts[1]);
                    obj.Y = ParseDouble(parts[2]);
                    obj.Text = parts[3].Trim().Trim('"', '\'');
                    if (parts.Length > 4) obj.FontSize = ParseDouble(parts[4]);
                    if (parts.Length > 5) obj.Fill = parts[5].Trim().Trim('"', '\'');
                    break;
            }

            // Register the object
            if (!string.IsNullOrEmpty(obj.Name))
            {
                _objectRegistry[obj.Name] = obj;
            }

            return $"<span class=\"eq\" style=\"color:#888;font-size:0.9em;\">🖌️ Canvas.{obj.ObjectType}: {obj.Name}</span>";
        }

        private string ParseCanvasCreation(string content, double width)
        {
            var pipeParts = SplitByPipe(content);
            var headerParams = SplitTopLevel(pipeParts[0], ';');

            var canvasObj = new CanvasObject
            {
                ObjectType = "canvas",
                Width = width,
                Height = 400,
                Fill = "#ffffff"
            };

            if (headerParams.Length > 1 && double.TryParse(headerParams[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double height))
                canvasObj.Height = height;
            if (headerParams.Length > 2)
                canvasObj.Fill = headerParams[2].Trim().Trim('"', '\'');

            var children = new List<CanvasObject>();

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
                else
                {
                    if (_objectRegistry.TryGetValue(section, out var refObj))
                    {
                        children.Add(refObj);
                    }
                }
            }

            return GenerateCanvasHtml(canvasObj, children);
        }

        private string GenerateCanvasHtml(CanvasObject canvas, List<CanvasObject> children)
        {
            var canvasId = $"canvas_{Guid.NewGuid():N}";
            var sb = new StringBuilder();

            sb.AppendLine($@"<div style=""margin:10px auto;width:{(int)canvas.Width}px;"">");
            sb.AppendLine($@"<canvas id=""{canvasId}"" width=""{(int)canvas.Width}"" height=""{(int)canvas.Height}"" style=""border:1px solid #ddd;background:{canvas.Fill};""></canvas>");
            sb.AppendLine("</div>");

            sb.AppendLine("<script>");
            sb.AppendLine($"(function(){{");
            sb.AppendLine($"var canvas=document.getElementById('{canvasId}');");
            sb.AppendLine($"if(!canvas)return;");
            sb.AppendLine($"var ctx=canvas.getContext('2d');");

            foreach (var child in children)
            {
                sb.AppendLine(GenerateCanvasJs(child));
            }

            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private string GenerateCanvasJs(CanvasObject obj)
        {
            var sb = new StringBuilder();

            switch (obj.ObjectType)
            {
                case "rect":
                    if (!string.IsNullOrEmpty(obj.Fill))
                    {
                        sb.AppendLine($"ctx.fillStyle='{obj.Fill}';");
                        sb.AppendLine($"ctx.fillRect({obj.X},{obj.Y},{obj.Width},{obj.Height});");
                    }
                    if (!string.IsNullOrEmpty(obj.Stroke))
                    {
                        sb.AppendLine($"ctx.strokeStyle='{obj.Stroke}';");
                        sb.AppendLine($"ctx.lineWidth={obj.StrokeWidth};");
                        sb.AppendLine($"ctx.strokeRect({obj.X},{obj.Y},{obj.Width},{obj.Height});");
                    }
                    break;

                case "circle":
                    sb.AppendLine("ctx.beginPath();");
                    sb.AppendLine($"ctx.arc({obj.X},{obj.Y},{obj.Radius},0,2*Math.PI);");
                    if (!string.IsNullOrEmpty(obj.Fill))
                    {
                        sb.AppendLine($"ctx.fillStyle='{obj.Fill}';");
                        sb.AppendLine("ctx.fill();");
                    }
                    if (!string.IsNullOrEmpty(obj.Stroke))
                    {
                        sb.AppendLine($"ctx.strokeStyle='{obj.Stroke}';");
                        sb.AppendLine($"ctx.lineWidth={obj.StrokeWidth};");
                        sb.AppendLine("ctx.stroke();");
                    }
                    break;

                case "line":
                    sb.AppendLine("ctx.beginPath();");
                    sb.AppendLine($"ctx.moveTo({obj.X1},{obj.Y1});");
                    sb.AppendLine($"ctx.lineTo({obj.X2},{obj.Y2});");
                    sb.AppendLine($"ctx.strokeStyle='{obj.Stroke ?? "#000"}';");
                    sb.AppendLine($"ctx.lineWidth={obj.StrokeWidth};");
                    sb.AppendLine("ctx.stroke();");
                    break;

                case "text":
                    sb.AppendLine($"ctx.font='{obj.FontSize}px Arial';");
                    sb.AppendLine($"ctx.fillStyle='{obj.Fill ?? "#000"}';");
                    sb.AppendLine($"ctx.fillText('{obj.Text}',{obj.X},{obj.Y});");
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

        private string GetLastKey(Dictionary<string, CanvasObject> dict)
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
            return $"<p><strong>$Canvas</strong>{{{content}}}</p>";
        }
    }

    internal class CanvasObject
    {
        public string Name { get; set; }
        public string ObjectType { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public double X1 { get; set; }
        public double Y1 { get; set; }
        public double X2 { get; set; }
        public double Y2 { get; set; }
        public double Radius { get; set; }
        public string Fill { get; set; } = "#4a90d9";
        public string Stroke { get; set; } = "#2c5aa0";
        public double StrokeWidth { get; set; } = 2;
        public string Text { get; set; }
        public double FontSize { get; set; } = 14;
    }
}
