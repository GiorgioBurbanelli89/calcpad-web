using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Animate command - Universal animation system
    ///
    /// SYNTAX:
    ///
    /// For Three.js:
    ///    $Animate{three; targetId; rotate; axis; speed}
    ///    $Animate{three; targetId; move; x; y; z; duration}
    ///    $Animate{three; targetId; scale; factor; duration}
    ///
    /// For Canvas:
    ///    $Animate{canvas; canvasId; frames; fps}
    ///    $Animate{canvas; canvasId; loop; function}
    ///
    /// For SVG:
    ///    $Animate{svg; elementId; attribute; from; to; duration}
    ///    $Animate{svg; elementId; path; motionPath; duration}
    ///
    /// For Plotly:
    ///    $Animate{plotly; plotId; data; frames; duration}
    ///    $Animate{plotly; plotId; transition; property; frames}
    ///
    /// Examples:
    ///    $Animate{three; "myStructure"; rotate; "y"; 0.01}
    ///    $Animate{canvas; "myCanvas"; loop; 60}
    ///    $Animate{svg; "circle1"; "r"; 10; 50; 2}
    ///    $Animate{plotly; "plot1"; transition; "x"; 100}
    /// </summary>
    internal class AnimationParser : PlotParser
    {
        internal AnimationParser(MathParser parser, PlotSettings settings) : base(parser, settings) { }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            int startBrace = script.IndexOf('{');
            if (startBrace < 0)
                return "<span class=\"err\">$Animate: Missing opening brace</span>";

            int endBrace = FindMatchingBrace(script, startBrace);
            if (endBrace < 0)
                return "<span class=\"err\">$Animate: Missing closing brace</span>";

            var content = script.Slice(startBrace + 1, endBrace - startBrace - 1).ToString().Trim();

            if (!calculate)
                return GetHtmlText(content);

            try
            {
                var parts = SplitTopLevel(content, ';');

                if (parts.Length < 2)
                    return "<span class=\"err\">$Animate: Requires at least type and target</span>";

                var animType = parts[0].Trim().ToLowerInvariant();

                switch (animType)
                {
                    case "three":
                        return ParseThreeAnimation(parts);
                    case "canvas":
                        return ParseCanvasAnimation(parts);
                    case "svg":
                        return ParseSvgAnimation(parts);
                    case "plotly":
                        return ParsePlotlyAnimation(parts);
                    default:
                        return $"<span class=\"err\">$Animate: Unknown type '{animType}'</span>";
                }
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">$Animate error: {ex.Message}</span>";
            }
        }

        private string ParseThreeAnimation(string[] parts)
        {
            // $Animate{three; targetId; animType; ...params}
            if (parts.Length < 3)
                return "<span class=\"err\">$Animate three: Requires targetId and animation type</span>";

            var targetId = parts[1].Trim().Trim('"', '\'');
            var animType = parts[2].Trim().ToLowerInvariant();
            var animId = $"anim_{Guid.NewGuid():N}";

            var sb = new StringBuilder();
            sb.AppendLine($"<script id=\"{animId}\">");
            sb.AppendLine("(function(){");

            switch (animType)
            {
                case "rotate":
                    // rotate; axis; speed
                    var axis = parts.Length > 3 ? parts[3].Trim().Trim('"', '\'').ToLower() : "y";
                    var speed = parts.Length > 4 ? ParseDouble(parts[4]) : 0.01;

                    sb.AppendLine($@"
var target = window.{targetId};
if(target && typeof requestAnimationFrame !== 'undefined') {{
    function animate() {{
        target.rotation.{axis} += {speed.ToString("G", CultureInfo.InvariantCulture)};
        requestAnimationFrame(animate);
    }}
    animate();
}}");
                    break;

                case "move":
                    // move; x; y; z; duration
                    var x = parts.Length > 3 ? ParseDouble(parts[3]) : 0;
                    var y = parts.Length > 4 ? ParseDouble(parts[4]) : 0;
                    var z = parts.Length > 5 ? ParseDouble(parts[5]) : 0;
                    var duration = parts.Length > 6 ? ParseDouble(parts[6]) : 1000;

                    sb.AppendLine($@"
var target = window.{targetId};
if(target) {{
    var startPos = {{x: target.position.x, y: target.position.y, z: target.position.z}};
    var endPos = {{x: {x}, y: {y}, z: {z}}};
    var startTime = Date.now();
    var duration = {duration};

    function animate() {{
        var elapsed = Date.now() - startTime;
        var progress = Math.min(elapsed / duration, 1);
        target.position.x = startPos.x + (endPos.x - startPos.x) * progress;
        target.position.y = startPos.y + (endPos.y - startPos.y) * progress;
        target.position.z = startPos.z + (endPos.z - startPos.z) * progress;
        if(progress < 1) requestAnimationFrame(animate);
    }}
    animate();
}}");
                    break;

                case "scale":
                    // scale; factor; duration
                    var factor = parts.Length > 3 ? ParseDouble(parts[3]) : 2;
                    var scaleDuration = parts.Length > 4 ? ParseDouble(parts[4]) : 1000;

                    sb.AppendLine($@"
var target = window.{targetId};
if(target) {{
    var startScale = {{x: target.scale.x, y: target.scale.y, z: target.scale.z}};
    var factor = {factor.ToString("G", CultureInfo.InvariantCulture)};
    var startTime = Date.now();
    var duration = {scaleDuration};

    function animate() {{
        var elapsed = Date.now() - startTime;
        var progress = Math.min(elapsed / duration, 1);
        target.scale.set(
            startScale.x * (1 + (factor - 1) * progress),
            startScale.y * (1 + (factor - 1) * progress),
            startScale.z * (1 + (factor - 1) * progress)
        );
        if(progress < 1) requestAnimationFrame(animate);
    }}
    animate();
}}");
                    break;
            }

            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private string ParseCanvasAnimation(string[] parts)
        {
            // $Animate{canvas; canvasId; loop; fps}
            if (parts.Length < 3)
                return "<span class=\"err\">$Animate canvas: Requires canvasId and animation type</span>";

            var canvasId = parts[1].Trim().Trim('"', '\'');
            var animType = parts[2].Trim().ToLowerInvariant();
            var animId = $"anim_{Guid.NewGuid():N}";

            var sb = new StringBuilder();
            sb.AppendLine($"<script id=\"{animId}\">");
            sb.AppendLine("(function(){");

            if (animType == "loop")
            {
                var fps = parts.Length > 3 ? ParseDouble(parts[3]) : 60;
                var interval = 1000.0 / fps;

                sb.AppendLine($@"
var canvas = document.getElementById('{canvasId}');
if(canvas) {{
    var ctx = canvas.getContext('2d');
    var frame = 0;
    var interval = {interval.ToString("G", CultureInfo.InvariantCulture)};

    setInterval(function() {{
        // User animation code should be inserted here
        // For now, just increment frame counter
        frame++;
    }}, interval);
}}");
            }

            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private string ParseSvgAnimation(string[] parts)
        {
            // $Animate{svg; elementId; attribute; from; to; duration}
            if (parts.Length < 6)
                return "<span class=\"err\">$Animate svg: Requires elementId, attribute, from, to, duration</span>";

            var elementId = parts[1].Trim().Trim('"', '\'');
            var attribute = parts[2].Trim().Trim('"', '\'');
            var from = parts[3].Trim();
            var to = parts[4].Trim();
            var duration = parts[5].Trim();

            var animId = $"anim_{Guid.NewGuid():N}";

            // Generate SMIL animation
            var sb = new StringBuilder();
            sb.AppendLine($"<script id=\"{animId}\">");
            sb.AppendLine("(function(){");
            sb.AppendLine($@"
var elem = document.getElementById('{elementId}');
if(elem) {{
    var animate = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animate.setAttribute('attributeName', '{attribute}');
    animate.setAttribute('from', '{from}');
    animate.setAttribute('to', '{to}');
    animate.setAttribute('dur', '{duration}s');
    animate.setAttribute('repeatCount', 'indefinite');
    elem.appendChild(animate);
    animate.beginElement();
}}");
            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private string ParsePlotlyAnimation(string[] parts)
        {
            // $Animate{plotly; plotId; transition; property; frames}
            if (parts.Length < 4)
                return "<span class=\"err\">$Animate plotly: Requires plotId, type, and parameters</span>";

            var plotId = parts[1].Trim().Trim('"', '\'');
            var animType = parts[2].Trim().ToLowerInvariant();
            var animId = $"anim_{Guid.NewGuid():N}";

            var sb = new StringBuilder();
            sb.AppendLine($"<script id=\"{animId}\">");
            sb.AppendLine("(function(){");

            if (animType == "transition")
            {
                var property = parts[3].Trim().Trim('"', '\'');
                var frames = parts.Length > 4 ? (int)ParseDouble(parts[4]) : 100;

                sb.AppendLine($@"
var plotDiv = document.getElementById('{plotId}');
if(plotDiv && typeof Plotly !== 'undefined') {{
    // Plotly animation implementation
    var frames = {frames};
    var counter = 0;

    setInterval(function() {{
        counter = (counter + 1) % frames;
        // Update Plotly data here
        Plotly.animate(plotDiv, {{
            data: [/* animated data */],
            traces: [0],
            layout: {{}}
        }}, {{
            transition: {{duration: 50}},
            frame: {{duration: 50, redraw: false}}
        }});
    }}, 50);
}}");
            }

            sb.AppendLine("})();");
            sb.AppendLine("</script>");

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
            return $"<p><strong>$Animate</strong>{{{content}}}</p>";
        }
    }
}
