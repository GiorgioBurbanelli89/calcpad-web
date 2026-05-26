using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Three command - Modular 3D structural visualization with Three.js
    ///
    /// NEW MODULAR SYNTAX:
    ///
    /// 1. Create objects (stored internally):
    ///    puntos = $Three{points; nodes; "#fff"; 0.1}
    ///    lineas = $Three{lines; nodes; elements; "#4cc9f0"; 2}
    ///    esferas = $Three{spheres; nodes; "#ff0000"; 0.5}
    ///    cajas = $Three{boxes; nodes; "#00ff00"; 0.3}
    ///    flechas = $Three{arrows; nodes; directions; "#ffff00"; 1.0}
    ///    malla = $Three{mesh; nodes; triangles; "#cccccc"; 0.8}
    ///    colores = $Three{colormap; nodes; triangles; values; "viridis"}
    ///    etiquetas = $Three{labels; nodes; "indices"; 0.5}
    ///    rejilla = $Three{grid; 10}
    ///    ejes = $Three{axes; 2}
    ///
    /// 2. Render window combining objects:
    ///    $Three{800; 400; "#1a1a2e" | grid; 10 | axes; 2 | puntos | lineas}
    ///
    /// LEGACY SYNTAX (still supported):
    ///    $Three{nodes; elements}
    ///    $Three{nodes; elements; deformed; loads; supports | scale}
    /// </summary>
    internal class ThreeJsParser : PlotParser
    {
        // Static registry for named objects
        private static readonly Dictionary<string, ThreeJsObject> _objectRegistry = new Dictionary<string, ThreeJsObject>();

        // Variable name for storing the current object (set by ExpressionParser)
        private string _targetVariable = null;

        internal ThreeJsParser(MathParser parser, PlotSettings settings) : base(parser, settings) { }

        /// <summary>
        /// Set target variable name for object storage
        /// </summary>
        internal void SetTargetVariable(string name)
        {
            _targetVariable = name;
        }

        /// <summary>
        /// Clear the object registry (call when starting a new document)
        /// </summary>
        public static void ClearRegistry()
        {
            _objectRegistry.Clear();
        }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            // Find the opening brace
            int startBrace = script.IndexOf('{');
            if (startBrace < 0)
                return "<span class=\"err\">$Three: Missing opening brace</span>";

            // Find the closing brace (accounting for nested braces)
            int endBrace = FindMatchingBrace(script, startBrace);
            if (endBrace < 0)
                return "<span class=\"err\">$Three: Missing closing brace</span>";

            // Extract content between braces
            var content = script.Slice(startBrace + 1, endBrace - startBrace - 1).ToString().Trim();

            if (!calculate)
                return GetHtmlText(content);

            try
            {
                // Determine syntax type by first parameter
                var pipeIndex = content.IndexOf('|');
                var firstPart = pipeIndex > 0 ? content.Substring(0, pipeIndex).Trim() : content;
                var firstParams = SplitTopLevel(firstPart, ';');

                if (firstParams.Length == 0)
                    return "<span class=\"err\">$Three: Empty content</span>";

                var firstToken = firstParams[0].Trim().ToLowerInvariant();

                // Check if it's an object type
                if (IsObjectType(firstToken))
                {
                    return ParseObjectCreation(firstToken, firstParams);
                }
                // Check if it's a window (first param is numeric - width)
                else if (double.TryParse(firstToken, NumberStyles.Float, CultureInfo.InvariantCulture, out double width))
                {
                    return ParseWindowCreation(content, width);
                }
                // Legacy syntax: nodes; elements; ...
                else
                {
                    return ParseLegacySyntax(content);
                }
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">Error in $Three: {ex.Message}</span>";
            }
        }

        private bool IsObjectType(string token)
        {
            return token switch
            {
                "points" or "puntos" => true,
                "lines" or "lineas" => true,
                "spheres" or "esferas" => true,
                "boxes" or "cajas" => true,
                "arrows" or "flechas" => true,
                "mesh" or "malla" => true,
                "colormap" or "colores" => true,
                "labels" or "etiquetas" => true,
                "grid" or "rejilla" => true,
                "axes" or "ejes" => true,
                "tweakpane" => true,
                _ => false
            };
        }

        private ThreeJsObjectType GetObjectType(string token)
        {
            return token.ToLowerInvariant() switch
            {
                "points" or "puntos" => ThreeJsObjectType.Points,
                "lines" or "lineas" => ThreeJsObjectType.Lines,
                "spheres" or "esferas" => ThreeJsObjectType.Spheres,
                "boxes" or "cajas" => ThreeJsObjectType.Boxes,
                "arrows" or "flechas" => ThreeJsObjectType.Arrows,
                "mesh" or "malla" => ThreeJsObjectType.Mesh,
                "colormap" or "colores" => ThreeJsObjectType.ColorMap,
                "labels" or "etiquetas" => ThreeJsObjectType.Labels,
                "grid" or "rejilla" => ThreeJsObjectType.Grid,
                "axes" or "ejes" => ThreeJsObjectType.Axes,
                "tweakpane" => ThreeJsObjectType.Tweakpane,
                _ => ThreeJsObjectType.Points
            };
        }

        private string ParseObjectCreation(string objectType, string[] parts)
        {
            var obj = new ThreeJsObject
            {
                ObjectType = GetObjectType(objectType),
                Name = _targetVariable ?? $"obj_{Guid.NewGuid():N}"
            };

            switch (obj.ObjectType)
            {
                case ThreeJsObjectType.Points:
                    // $Three{points; nodes; "#fff"; 0.1}
                    if (parts.Length < 2)
                        return "<span class=\"err\">$Three points: requires nodes matrix</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    if (obj.Positions is null)
                        return $"<span class=\"err\">$Three points: '{parts[1].Trim()}' must be a matrix</span>";
                    if (parts.Length > 2) obj.Color = parts[2].Trim().Trim('"', '\'');
                    if (parts.Length > 3 && double.TryParse(parts[3].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double ps)) obj.Size = ps;
                    break;

                case ThreeJsObjectType.Lines:
                    // $Three{lines; nodes; elements; "#4cc9f0"; 2}
                    if (parts.Length < 3)
                        return "<span class=\"err\">$Three lines: requires nodes and elements matrices</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    obj.Connectivity = GetMatrix(parts[2].Trim());
                    if (obj.Positions is null || obj.Connectivity is null)
                        return "<span class=\"err\">$Three lines: nodes and elements must be matrices</span>";
                    if (parts.Length > 3) obj.Color = parts[3].Trim().Trim('"', '\'');
                    if (parts.Length > 4 && double.TryParse(parts[4].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double lw)) obj.LineWidth = lw;
                    break;

                case ThreeJsObjectType.Spheres:
                    // $Three{spheres; nodes; "#ff0000"; 0.5}
                    if (parts.Length < 2)
                        return "<span class=\"err\">$Three spheres: requires nodes matrix</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    if (obj.Positions is null)
                        return $"<span class=\"err\">$Three spheres: '{parts[1].Trim()}' must be a matrix</span>";
                    if (parts.Length > 2) obj.Color = parts[2].Trim().Trim('"', '\'');
                    if (parts.Length > 3 && double.TryParse(parts[3].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double ss)) obj.Size = ss;
                    break;

                case ThreeJsObjectType.Boxes:
                    // $Three{boxes; nodes; "#00ff00"; 0.3}
                    if (parts.Length < 2)
                        return "<span class=\"err\">$Three boxes: requires nodes matrix</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    if (obj.Positions is null)
                        return $"<span class=\"err\">$Three boxes: '{parts[1].Trim()}' must be a matrix</span>";
                    if (parts.Length > 2) obj.Color = parts[2].Trim().Trim('"', '\'');
                    if (parts.Length > 3 && double.TryParse(parts[3].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double bs)) obj.Size = bs;
                    break;

                case ThreeJsObjectType.Arrows:
                    // $Three{arrows; nodes; directions; "#ffff00"; 1.0}
                    if (parts.Length < 3)
                        return "<span class=\"err\">$Three arrows: requires nodes and directions matrices</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    obj.Values = GetMatrix(parts[2].Trim());
                    if (obj.Positions is null || obj.Values is null)
                        return "<span class=\"err\">$Three arrows: nodes and directions must be matrices</span>";
                    if (parts.Length > 3) obj.Color = parts[3].Trim().Trim('"', '\'');
                    if (parts.Length > 4 && double.TryParse(parts[4].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double as2)) obj.Size = as2;
                    break;

                case ThreeJsObjectType.Mesh:
                    // $Three{mesh; nodes; triangles; "#cccccc"; 0.8}
                    if (parts.Length < 3)
                        return "<span class=\"err\">$Three mesh: requires nodes and triangles matrices</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    obj.Connectivity = GetMatrix(parts[2].Trim());
                    if (obj.Positions is null || obj.Connectivity is null)
                        return "<span class=\"err\">$Three mesh: nodes and triangles must be matrices</span>";
                    if (parts.Length > 3) obj.Color = parts[3].Trim().Trim('"', '\'');
                    if (parts.Length > 4 && double.TryParse(parts[4].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double op)) obj.Opacity = op;
                    break;

                case ThreeJsObjectType.ColorMap:
                    // $Three{colormap; nodes; triangles; values; "viridis"}
                    if (parts.Length < 4)
                        return "<span class=\"err\">$Three colormap: requires nodes, triangles, and values</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    obj.Connectivity = GetMatrix(parts[2].Trim());
                    var valuesName = parts[3].Trim();
                    var valuesVar = Parser.GetVariableRef(valuesName);
                    if (valuesVar?.Value is Vector v)
                        obj.Values = VectorToColumnMatrix(v);
                    else if (valuesVar?.Value is Matrix m)
                        obj.Values = m;
                    else
                        return $"<span class=\"err\">$Three colormap: '{valuesName}' must be a vector or matrix</span>";
                    if (obj.Positions is null || obj.Connectivity is null)
                        return "<span class=\"err\">$Three colormap: nodes and triangles must be matrices</span>";
                    if (parts.Length > 4) obj.ColorScale = parts[4].Trim().Trim('"', '\'');
                    break;

                case ThreeJsObjectType.Labels:
                    // $Three{labels; nodes; "indices"; 0.5}
                    if (parts.Length < 2)
                        return "<span class=\"err\">$Three labels: requires nodes matrix</span>";
                    obj.Positions = GetMatrix(parts[1].Trim());
                    if (obj.Positions is null)
                        return $"<span class=\"err\">$Three labels: '{parts[1].Trim()}' must be a matrix</span>";
                    if (parts.Length > 2)
                    {
                        var labelType = parts[2].Trim().Trim('"', '\'').ToLowerInvariant();
                        obj.ShowIndices = labelType == "indices" || labelType == "index" || labelType == "i";
                    }
                    if (parts.Length > 3 && double.TryParse(parts[3].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double ls)) obj.Size = ls;
                    if (parts.Length > 4) obj.Color = parts[4].Trim().Trim('"', '\'');
                    else obj.Color = "#ffffff";
                    break;

                case ThreeJsObjectType.Grid:
                    // $Three{grid; 10}
                    if (parts.Length > 1 && double.TryParse(parts[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double gs)) obj.GridSize = gs;
                    break;

                case ThreeJsObjectType.Axes:
                    // $Three{axes; 2}
                    if (parts.Length > 1 && double.TryParse(parts[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double axs)) obj.AxesSize = axs;
                    break;

                case ThreeJsObjectType.Tweakpane:
                    // $Three{tweakpane; tipo; nombre; valor; [min; max; step]; [target]}
                    // Examples:
                    //   $Three{tweakpane; slider; opacity; 0.8; 0; 1; 0.1; lines.opacity}
                    //   $Three{tweakpane; checkbox; show_grid; true; spheres.visible}
                    //   $Three{tweakpane; color; line_color; #00ff00; lines.color}
                    if (parts.Length < 4)
                        return "<span class=\"err\">$Three tweakpane: requires at least tipo, nombre, valor</span>";

                    var control = new TweakpaneControl
                    {
                        Name = parts[2].Trim(),
                        Label = ToTitleCase(parts[2].Trim().Replace("_", " ")),
                        Value = parts[3].Trim()
                    };

                    var tipo = parts[1].Trim().ToLowerInvariant();
                    control.Type = tipo switch
                    {
                        "slider" => TweakpaneControlType.Slider,
                        "checkbox" => TweakpaneControlType.Checkbox,
                        "color" => TweakpaneControlType.Color,
                        "text" => TweakpaneControlType.Text,
                        "button" => TweakpaneControlType.Button,
                        _ => TweakpaneControlType.Slider
                    };

                    // Parse parameters based on control type
                    if (control.Type == TweakpaneControlType.Slider)
                    {
                        // Slider: tweakpane; slider; name; value; min; max; [step]; [target]
                        if (parts.Length > 4 && double.TryParse(parts[4].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double min))
                            control.Min = min;
                        if (parts.Length > 5 && double.TryParse(parts[5].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double max))
                            control.Max = max;
                        if (parts.Length > 6 && double.TryParse(parts[6].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double step))
                            control.Step = step;
                        else
                            control.Step = (control.Max - control.Min) / 100.0; // Auto step

                        // Target is last parameter if it's not a number
                        if (parts.Length > 7 && !double.TryParse(parts[7].Trim(), out _))
                            control.Target = parts[7].Trim();
                        else if (parts.Length > 6 && !double.TryParse(parts[6].Trim(), out _))
                            control.Target = parts[6].Trim();
                    }
                    else if (control.Type == TweakpaneControlType.Checkbox ||
                             control.Type == TweakpaneControlType.Color ||
                             control.Type == TweakpaneControlType.Text)
                    {
                        // Checkbox/Color/Text: tweakpane; type; name; value; [target]
                        if (parts.Length > 4)
                            control.Target = parts[4].Trim();
                    }

                    obj.CustomControls.Add(control);
                    break;
            }

            // Register the object
            if (!string.IsNullOrEmpty(obj.Name))
            {
                _objectRegistry[obj.Name] = obj;
            }

            // Return minimal HTML indicating object was created
            return $"<span class=\"eq\" style=\"color:#888;font-size:0.9em;\">📦 {obj.ObjectType}: {obj.Name}</span>";
        }

        private string ParseWindowCreation(string content, double width)
        {
            // $Three{800; 400; "#1a1a2e" | grid; 10 | axes; 2 | puntos | lineas}
            var pipeParts = SplitByPipe(content);

            if (pipeParts.Length < 1)
                return "<span class=\"err\">$Three window: invalid syntax</span>";

            // Parse header: width; height; bgcolor
            var headerParams = SplitTopLevel(pipeParts[0], ';');

            var windowObj = new ThreeJsObject
            {
                ObjectType = ThreeJsObjectType.Window,
                Width = width,
                Height = 500,
                BackgroundColor = "#1a1a2e"
            };

            if (headerParams.Length > 1 && double.TryParse(headerParams[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double h))
                windowObj.Height = h;
            if (headerParams.Length > 2)
                windowObj.BackgroundColor = headerParams[2].Trim().Trim('"', '\'');

            // Parse each pipe section as either an inline object or a reference
            for (int i = 1; i < pipeParts.Length; i++)
            {
                var section = pipeParts[i].Trim();
                if (string.IsNullOrEmpty(section)) continue;

                var sectionParams = SplitTopLevel(section, ';');
                var firstToken = sectionParams[0].Trim().ToLowerInvariant();

                // Check if it's an inline object definition
                if (IsObjectType(firstToken))
                {
                    // Create inline object
                    var inlineResult = ParseObjectCreation(firstToken, sectionParams);
                    if (inlineResult.Contains("err"))
                        return inlineResult;

                    // Add to window's children (but skip Tweakpane objects - they only add controls)
                    var inlineName = $"inline_{Guid.NewGuid():N}";
                    if (_objectRegistry.TryGetValue(inlineName, out var inlineObj))
                    {
                        if (inlineObj.ObjectType != ThreeJsObjectType.Tweakpane)
                            windowObj.Children.Add(inlineObj);
                        else
                            windowObj.CustomControls.AddRange(inlineObj.CustomControls);
                    }
                    else if (_objectRegistry.Count > 0)
                    {
                        // Get the last added object
                        var lastKey = GetLastKey(_objectRegistry);
                        if (_objectRegistry.TryGetValue(lastKey, out var lastObj))
                        {
                            if (lastObj.ObjectType != ThreeJsObjectType.Tweakpane)
                                windowObj.Children.Add(lastObj);
                            else
                                windowObj.CustomControls.AddRange(lastObj.CustomControls);
                        }
                    }
                }
                else
                {
                    // It's a reference to a previously created object
                    var objName = sectionParams[0].Trim();
                    if (_objectRegistry.TryGetValue(objName, out var refObj))
                    {
                        if (refObj.ObjectType != ThreeJsObjectType.Tweakpane)
                            windowObj.Children.Add(refObj);
                        else
                            windowObj.CustomControls.AddRange(refObj.CustomControls);
                    }
                    else
                    {
                        // Try to find by case-insensitive match
                        bool found = false;
                        foreach (var kv in _objectRegistry)
                        {
                            if (kv.Key.Equals(objName, StringComparison.OrdinalIgnoreCase))
                            {
                                if (kv.Value.ObjectType != ThreeJsObjectType.Tweakpane)
                                    windowObj.Children.Add(kv.Value);
                                else
                                    windowObj.CustomControls.AddRange(kv.Value.CustomControls);
                                found = true;
                                break;
                            }
                        }
                        if (!found)
                        {
                            return $"<span class=\"err\">$Three window: object '{objName}' not found</span>";
                        }
                    }
                }
            }

            // Generate the window HTML
            return GenerateWindowHtml(windowObj);
        }

        private string GetLastKey(Dictionary<string, ThreeJsObject> dict)
        {
            string lastKey = null;
            foreach (var key in dict.Keys)
                lastKey = key;
            return lastKey;
        }

        private string GenerateWindowHtml(ThreeJsObject window)
        {
            var chartId = GetChartId();
            var sb = new StringBuilder();

            // Add Tweakpane CSS and JS (Awatif UI style) - using CDN 3.1.9
            sb.AppendLine(@"<script src=""https://cdn.jsdelivr.net/npm/tweakpane@3.1.9/dist/tweakpane.min.js""></script>");

            // Container
            sb.AppendLine($@"<div id=""{chartId}"" class=""three-viewer"" style=""width:{(int)window.Width}px;height:{(int)window.Height}px;margin:10px auto;background:{window.BackgroundColor};position:relative;border-radius:4px;"">");

            // Tweakpane container (will be populated by JavaScript)
            if (window.ShowControls)
            {
                sb.AppendLine($@"<div id=""{chartId}_settings"" style=""position:absolute;top:0px;left:8px;width:300px;z-index:10;""></div>");
            }

            sb.AppendLine("</div>");

            // Generate JavaScript
            sb.AppendLine("<script>");
            sb.AppendLine("(function(){");

            // Calculate bounding box from all objects with positions
            sb.AppendLine(@"
var allPositions = [];
");
            foreach (var child in window.Children)
            {
                if (child.Positions is not null)
                {
                    var nodesArray = MatrixToJsArray(child.Positions);
                    sb.AppendLine($"allPositions = allPositions.concat({nodesArray});");
                }
            }

            sb.AppendLine(@"
var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
if(allPositions.length > 0) {
    for(var i=0;i<allPositions.length;i++){
        var n=allPositions[i];
        if(n[0]<minX)minX=n[0];if(n[0]>maxX)maxX=n[0];
        if(n[1]<minY)minY=n[1];if(n[1]>maxY)maxY=n[1];
        if(n[2]<minZ)minZ=n[2];if(n[2]>maxZ)maxZ=n[2];
    }
} else {
    minX=minY=minZ=-5; maxX=maxY=maxZ=5;
}
var cx=(minX+maxX)/2,cy=(minY+maxY)/2,cz=(minZ+maxZ)/2;
var size=Math.max(maxX-minX,maxY-minY,maxZ-minZ)||10;
");

            // Three.js setup (Awatif-style: Z is up)
            sb.AppendLine($@"
var container=document.getElementById('{chartId}');
if(!container)return;

if(typeof THREE==='undefined'){{
    container.innerHTML='<p style=""color:red;text-align:center;padding-top:50px;"">Three.js not loaded</p>';
    return;
}}

// Set Z as up (engineering convention like Awatif)
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

var scene=new THREE.Scene();
scene.background=new THREE.Color('{window.BackgroundColor}');

var camera=new THREE.PerspectiveCamera(45,container.clientWidth/container.clientHeight,0.1,size*100);
// Camera position: looking from front-left-above
camera.position.set(cx+size*0.8, cy-size*1.5, cz+size*0.8);
camera.up.set(0, 0, 1);

var renderer=new THREE.WebGLRenderer({{antialias:true}});
renderer.setSize(container.clientWidth,container.clientHeight);
container.appendChild(renderer.domElement);

var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.target.set(cx,cy,cz);
controls.enableDamping=true;
controls.update();
");

            // Add each child object
            foreach (var child in window.Children)
            {
                sb.AppendLine(child.GenerateJavaScript("scene"));
            }

            // Animation loop
            sb.AppendLine(@"
function animate(){
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene,camera);
}
animate();

window.addEventListener('resize',function(){
    var w=container.clientWidth,h=container.clientHeight;
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    renderer.setSize(w,h);
});
");

            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            // Tweakpane controls (Awatif UI style) - separate script to execute after Tweakpane library loads
            if (window.ShowControls && window.Children.Count > 0)
            {
                sb.AppendLine(@"<script>");
                sb.AppendLine($@"
// Initialize Tweakpane (execute after library loads) - WITH DEBUG LOGS
console.log('=== TWEAKPANE DEBUG START ===');
console.log('1. Script cargado');

window.addEventListener('load', function() {{
    console.log('2. window.load event fired');
    console.log('3. typeof Tweakpane:', typeof Tweakpane);

    const container = document.getElementById('{chartId}_settings');
    console.log('3.5 Container element:', container);

    if(typeof Tweakpane === 'undefined') {{
        console.error('❌ ERROR: Tweakpane NO está definido');
        if(container) {{
            container.innerHTML = '<div style=""background:red;color:white;padding:15px;margin:10px;border-radius:8px;font-size:16px;font-weight:bold;text-align:center;"">❌ ERROR: Tweakpane NO cargó<br>Revisa la consola (F12)</div>';
        }}
        return;
    }}

    console.log('✅ 4. Tweakpane está definido');
    console.log('5. Container element:', container);

    if(!container) {{
        console.error('❌ ERROR: No se encontró el contenedor {chartId}_settings');
        return;
    }}

    console.log('✅ 6. Container encontrado');

    try {{
        console.log('7. Creando Tweakpane.Pane...');
        const pane = new Tweakpane.Pane({{
            title: 'Settings',
            expanded: true,
            container: container
        }});
        console.log('✅ 8. Pane creado:', pane);

        // Settings object
        const PARAMS = {{
            displayScale: 1,
");

                // Add toggle for each object
                foreach (var child in window.Children)
                {
                    var jsId = child.GetJsId();
                    sb.AppendLine($"            {jsId}: true,");
                }

                sb.AppendLine(@"        };

        console.log('9. PARAMS object:', PARAMS);

        // Display scale slider (-10 to 10)
        console.log('10. Agregando Display scale slider...');

        // Save original scales for all arrows
        const arrowOriginalScales = new Map();
");

                // Initialize original scales for each arrow group
                foreach (var child in window.Children)
                {
                    if (child.ObjectType == ThreeJsObjectType.Arrows)
                    {
                        var jsId = child.GetJsId();
                        sb.AppendLine($@"        if(typeof {jsId} !== 'undefined') {{
            {jsId}.children.forEach((arrow, idx) => {{
                if(arrow.type === 'ArrowHelper') {{
                    // Get original length from line geometry
                    const line = arrow.children[0]; // First child is the line
                    if(line && line.geometry) {{
                        const positions = line.geometry.attributes.position.array;
                        const len = Math.sqrt(positions[3]*positions[3] + positions[4]*positions[4] + positions[5]*positions[5]);
                        const key = '{jsId}_' + idx;
                        arrowOriginalScales.set(key, len);
                        console.log('Arrow', idx, 'original length:', len);
                    }}
                }}
            }});
        }}");
                    }
                }

                sb.AppendLine(@"
        console.log('Original scales saved:', arrowOriginalScales.size);

        pane.addInput(PARAMS, 'displayScale', {
            label: 'Display scale',
            min: -10,
            max: 10,
            step: 1
        }).on('change', (ev) => {
            console.log('Display scale changed to:', ev.value);
            const scale = ev.value === 0 ? 1 : (ev.value > 0 ? ev.value : -1 / ev.value);
            console.log('Computed scale:', scale);
");

                // Scale arrows based on display scale using original scales
                foreach (var child in window.Children)
                {
                    if (child.ObjectType == ThreeJsObjectType.Arrows)
                    {
                        var jsId = child.GetJsId();
                        sb.AppendLine($@"            if(typeof {jsId} !== 'undefined') {{
                {jsId}.children.forEach((arrow, idx) => {{
                    if(arrow.type === 'ArrowHelper') {{
                        const key = '{jsId}_' + idx;
                        const originalLength = arrowOriginalScales.get(key);
                        if(originalLength) {{
                            // Apply scale to original length using setLength method
                            const newLength = originalLength * scale;
                            arrow.setLength(newLength, newLength * 0.2, newLength * 0.1);
                            console.log('Arrow', idx, 'scaled to:', newLength);
                        }}
                    }}
                }});
            }}");
                    }
                }

                sb.AppendLine(@"        });

        console.log('11. Display scale slider agregado');

        // Custom Tweakpane controls
        console.log('11.5 Agregando controles personalizados...');
");

                // Use custom controls from window object (already collected during parsing)
                var customControls = window.CustomControls;

                // Generate JavaScript for custom controls
                if (customControls != null && customControls.Count > 0)
                {
                    // First, add the custom parameters to PARAMS (we need to inject them earlier)
                    // For now, we'll add them dynamically
                    foreach (var control in customControls)
                    {
                        var paramName = control.Name;
                        var paramValue = control.Value;

                        // Add parameter to PARAMS object dynamically
                        sb.AppendLine($"        PARAMS.{paramName} = {GetJsValue(control)};");

                        // Generate onChange/onClick code based on target
                        var targetCode = GenerateTargetCode(control, window);

                        // Generate the appropriate Tweakpane control
                        switch (control.Type)
                        {
                            case TweakpaneControlType.Slider:
                                sb.AppendLine($@"        pane.addInput(PARAMS, '{paramName}', {{
            label: '{control.Label}',
            min: {control.Min.ToString(CultureInfo.InvariantCulture)},
            max: {control.Max.ToString(CultureInfo.InvariantCulture)},
            step: {control.Step.ToString(CultureInfo.InvariantCulture)}
        }}).on('change', (ev) => {{
{targetCode}
        }});
");
                                break;

                            case TweakpaneControlType.Checkbox:
                                sb.AppendLine($@"        pane.addInput(PARAMS, '{paramName}', {{
            label: '{control.Label}'
        }}).on('change', (ev) => {{
{targetCode}
        }});
");
                                break;

                            case TweakpaneControlType.Color:
                                sb.AppendLine($@"        pane.addInput(PARAMS, '{paramName}', {{
            label: '{control.Label}',
            view: 'color'
        }}).on('change', (ev) => {{
{targetCode}
        }});
");
                                break;

                            case TweakpaneControlType.Text:
                                sb.AppendLine($@"        pane.addInput(PARAMS, '{paramName}', {{
            label: '{control.Label}'
        }}).on('change', (ev) => {{
{targetCode}
        }});
");
                                break;

                            case TweakpaneControlType.Button:
                                sb.AppendLine($@"        pane.addButton({{
            title: '{control.Label}'
        }}).on('click', () => {{
{targetCode}
        }});
");
                                break;
                        }
                    }
                }

                sb.AppendLine(@"
        // Object visibility toggles
        console.log('12. Agregando toggles de visibilidad...');
");

                foreach (var child in window.Children)
                {
                    var jsId = child.GetJsId();
                    var displayName = (child.Name != null && child.Name.StartsWith("obj_"))
                        ? child.ObjectType.ToString()
                        : (child.Name ?? child.ObjectType.ToString());
                    sb.AppendLine($@"        pane.addInput(PARAMS, '{jsId}', {{
            label: '{displayName}'
        }}).on('change', (ev) => {{
            if(typeof {jsId} !== 'undefined') {jsId}.visible = ev.value;
        }});
");
                }

                sb.AppendLine(@"
        console.log('13. Todos los toggles agregados');
        console.log('✅ 14. Panel Tweakpane completamente configurado');
        console.log('=== TWEAKPANE DEBUG END ===');

    } catch(error) {
        console.error('❌ ERROR al crear panel Tweakpane:');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Full error:', error);
    }
});
");
                sb.AppendLine("</script>");
            }

            return sb.ToString();
        }

        private static string GetObjectIcon(ThreeJsObjectType type)
        {
            return type switch
            {
                ThreeJsObjectType.Points => "⚫",
                ThreeJsObjectType.Lines => "📏",
                ThreeJsObjectType.Spheres => "🔵",
                ThreeJsObjectType.Boxes => "📦",
                ThreeJsObjectType.Arrows => "➡️",
                ThreeJsObjectType.Grid => "⊞",
                ThreeJsObjectType.Axes => "✚",
                ThreeJsObjectType.Mesh => "△",
                ThreeJsObjectType.ColorMap => "🌈",
                ThreeJsObjectType.Labels => "🏷️",
                _ => "•"
            };
        }

        private string ParseLegacySyntax(string content)
        {
            // Legacy: $Three{nodes; elements; deformed; loads; supports | scale}
            double scale = 100.0;
            int pipeIndex = content.LastIndexOf('|');
            if (pipeIndex > 0)
            {
                var scaleStr = content.Substring(pipeIndex + 1).Trim();
                if (double.TryParse(scaleStr, NumberStyles.Float, CultureInfo.InvariantCulture, out double s))
                    scale = s;
                content = content.Substring(0, pipeIndex).Trim();
            }

            var parts = SplitTopLevel(content, ';');

            if (parts.Length < 2)
                return "<span class=\"err\">$Three: Requires at least nodes and elements matrices</span>";

            // Get nodes matrix
            var nodesName = parts[0].Trim();
            var nodes = GetMatrix(nodesName);
            if (nodes is null)
                return $"<span class=\"err\">$Three: '{nodesName}' must be a matrix (nodes)</span>";

            // Get elements matrix
            var elementsName = parts[1].Trim();
            var elements = GetMatrix(elementsName);
            if (elements is null)
                return $"<span class=\"err\">$Three: '{elementsName}' must be a matrix (elements)</span>";

            // Parse optional matrices
            Matrix deformed = parts.Length > 2 ? GetMatrix(parts[2].Trim()) : null;
            Matrix loads = parts.Length > 3 ? GetMatrix(parts[3].Trim()) : null;
            Vector supports = null;

            if (parts.Length > 4)
            {
                var supportsName = parts[4].Trim();
                var supportsVar = Parser.GetVariableRef(supportsName);
                if (supportsVar?.Value is Vector v)
                    supports = v;
                else if (supportsVar?.Value is Matrix m && m.ColCount == 1)
                {
                    var arr = new RealValue[m.RowCount];
                    for (int i = 0; i < m.RowCount; i++)
                        arr[i] = m[i, 0];
                    supports = new Vector(arr);
                }
            }

            var plotter = new ThreeJsPlotter(Parser, Settings, nodes, elements, deformed, loads, supports, scale);
            return plotter.Plot();
        }

        private Matrix GetMatrix(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            var varRef = Parser.GetVariableRef(name);
            return varRef?.Value as Matrix;
        }

        private static Matrix VectorToColumnMatrix(Vector v)
        {
            var rows = v.Length;
            var result = new Matrix(rows, 1);
            for (int i = 0; i < rows; i++)
                result[i, 0] = v[i];
            return result;
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
                sb.Append(GetValue(m, i, 0));
                sb.Append(',');
                sb.Append(m.ColCount > 1 ? GetValue(m, i, 1) : "0");
                sb.Append(',');
                sb.Append(is3D ? GetValue(m, i, 2) : "0");
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private static string GetValue(Matrix m, int row, int col)
        {
            if (row >= m.RowCount || col >= m.ColCount) return "0";
            var val = m[row, col].D;
            return double.IsNaN(val) ? "0" : val.ToString("G", CultureInfo.InvariantCulture);
        }

        private string[] SplitByPipe(string content)
        {
            var result = new List<string>();
            int depth = 0;
            int start = 0;

            for (int i = 0; i < content.Length; i++)
            {
                char c = content[i];
                if (c == '{' || c == '[' || c == '(') depth++;
                else if (c == '}' || c == ']' || c == ')') depth--;
                else if (c == '|' && depth == 0)
                {
                    result.Add(content.Substring(start, i - start));
                    start = i + 1;
                }
            }
            result.Add(content.Substring(start));
            return result.ToArray();
        }

        private static int FindMatchingBrace(ReadOnlySpan<char> script, int start)
        {
            int count = 0;
            for (int i = start; i < script.Length; i++)
            {
                if (script[i] == '{') count++;
                else if (script[i] == '}') count--;

                if (count == 0) return i;
            }
            return -1;
        }

        private static string[] SplitTopLevel(string content, char separator)
        {
            var result = new List<string>();
            int depth = 0;
            int start = 0;

            for (int i = 0; i < content.Length; i++)
            {
                char c = content[i];
                if (c == '{' || c == '[' || c == '(') depth++;
                else if (c == '}' || c == ']' || c == ')') depth--;
                else if (c == separator && depth == 0)
                {
                    result.Add(content.Substring(start, i - start));
                    start = i + 1;
                }
            }
            result.Add(content.Substring(start));
            return result.ToArray();
        }

        private static string GetHtmlText(string content)
        {
            var truncated = content.Length > 60 ? content.Substring(0, 57) + "..." : content;
            return $"<span class=\"eq\"><span class=\"cond\">$Three</span>{{{truncated}}}</span>";
        }

        private string GetChartId()
        {
            return $"three_{Guid.NewGuid():N}";
        }

        /// <summary>
        /// Convert TweakpaneControl value to JavaScript value
        /// </summary>
        private static string GetJsValue(TweakpaneControl control)
        {
            return control.Type switch
            {
                TweakpaneControlType.Checkbox => control.Value.ToLowerInvariant() == "true" || control.Value == "1" ? "true" : "false",
                TweakpaneControlType.Color => $"'{control.Value}'",
                TweakpaneControlType.Slider => control.Value,
                TweakpaneControlType.Text => $"'{control.Value}'",
                _ => control.Value
            };
        }

        /// <summary>
        /// Convert string to Title Case (capitalize first letter of each word)
        /// </summary>
        private static string ToTitleCase(string text)
        {
            if (string.IsNullOrEmpty(text))
                return text;

            var words = text.Split(' ');
            for (int i = 0; i < words.Length; i++)
            {
                if (words[i].Length > 0)
                {
                    words[i] = char.ToUpper(words[i][0]) + (words[i].Length > 1 ? words[i].Substring(1).ToLower() : "");
                }
            }
            return string.Join(" ", words);
        }

        /// <summary>
        /// Generate JavaScript code to update target property when control changes
        /// </summary>
        private string GenerateTargetCode(TweakpaneControl control, ThreeJsObject window)
        {
            // Default: just log
            if (string.IsNullOrEmpty(control.Target))
            {
                return $"            console.log('{control.Label} changed to:', ev.value);";
            }

            // Parse target: "objectName.property" or "objectName.subprop.property"
            var parts = control.Target.Split('.');
            if (parts.Length < 2)
            {
                return $"            console.log('{control.Label} changed to:', ev.value); // Invalid target: {control.Target}";
            }

            var objectName = parts[0].Trim().ToLowerInvariant();
            var propertyPath = string.Join(".", parts.Skip(1));

            // Find matching object by type or name
            ThreeJsObject targetObj = null;
            foreach (var child in window.Children)
            {
                var childTypeName = child.ObjectType.ToString().ToLowerInvariant();
                var childName = child.Name?.ToLowerInvariant() ?? "";

                if (childTypeName == objectName || childName == objectName ||
                    (objectName == "lines" && child.ObjectType == ThreeJsObjectType.Lines) ||
                    (objectName == "spheres" && child.ObjectType == ThreeJsObjectType.Spheres) ||
                    (objectName == "arrows" && child.ObjectType == ThreeJsObjectType.Arrows) ||
                    (objectName == "mesh" && child.ObjectType == ThreeJsObjectType.Mesh) ||
                    (objectName == "grid" && child.ObjectType == ThreeJsObjectType.Grid) ||
                    (objectName == "axes" && child.ObjectType == ThreeJsObjectType.Axes))
                {
                    targetObj = child;
                    break;
                }
            }

            if (targetObj == null)
            {
                return $"            console.log('{control.Label} changed to:', ev.value); // Object '{objectName}' not found";
            }

            var jsId = targetObj.GetJsId();
            var code = new StringBuilder();

            code.AppendLine($"            console.log('{control.Label} changed to:', ev.value);");
            code.AppendLine($"            if(typeof {jsId} !== 'undefined') {{");

            // Check if target is a Group (Lines, Spheres, Arrows, etc.)
            bool isGroup = targetObj.ObjectType == ThreeJsObjectType.Lines ||
                          targetObj.ObjectType == ThreeJsObjectType.Spheres ||
                          targetObj.ObjectType == ThreeJsObjectType.Arrows ||
                          targetObj.ObjectType == ThreeJsObjectType.Mesh;

            // Generate code based on property type
            if (propertyPath == "opacity")
            {
                if (isGroup)
                {
                    // For Groups: iterate over children and update each material
                    code.AppendLine($"                {jsId}.children.forEach(function(child) {{");
                    code.AppendLine($"                    if(child.material) {{");
                    code.AppendLine($"                        child.material.opacity = ev.value;");
                    code.AppendLine($"                        child.material.transparent = ev.value < 1;");
                    code.AppendLine($"                        child.material.needsUpdate = true;");
                    code.AppendLine($"                    }}");
                    code.AppendLine($"                }});");
                }
                else
                {
                    // For single objects: update material directly
                    code.AppendLine($"                if({jsId}.material) {{");
                    code.AppendLine($"                    {jsId}.material.opacity = ev.value;");
                    code.AppendLine($"                    {jsId}.material.transparent = ev.value < 1;");
                    code.AppendLine($"                    {jsId}.material.needsUpdate = true;");
                    code.AppendLine($"                }}");
                }
            }
            else if (propertyPath == "color")
            {
                if (isGroup)
                {
                    // For Groups: iterate over children and update each material
                    code.AppendLine($"                {jsId}.children.forEach(function(child) {{");
                    code.AppendLine($"                    if(child.material) {{");
                    code.AppendLine($"                        child.material.color.set(ev.value);");
                    code.AppendLine($"                        child.material.needsUpdate = true;");
                    code.AppendLine($"                    }}");
                    code.AppendLine($"                }});");
                }
                else
                {
                    // For single objects: update material directly
                    code.AppendLine($"                if({jsId}.material) {{");
                    code.AppendLine($"                    {jsId}.material.color.set(ev.value);");
                    code.AppendLine($"                    {jsId}.material.needsUpdate = true;");
                    code.AppendLine($"                }}");
                }
            }
            else if (propertyPath == "visible")
            {
                code.AppendLine($"                {jsId}.visible = ev.value;");
            }
            else if (propertyPath.StartsWith("material."))
            {
                var matProp = propertyPath.Substring(9);
                if (isGroup)
                {
                    // For Groups: iterate over children
                    code.AppendLine($"                {jsId}.children.forEach(function(child) {{");
                    code.AppendLine($"                    if(child.material) {{");
                    code.AppendLine($"                        child.material.{matProp} = ev.value;");
                    code.AppendLine($"                        child.material.needsUpdate = true;");
                    code.AppendLine($"                    }}");
                    code.AppendLine($"                }});");
                }
                else
                {
                    code.AppendLine($"                if({jsId}.material) {{");
                    code.AppendLine($"                    {jsId}.material.{matProp} = ev.value;");
                    code.AppendLine($"                    {jsId}.material.needsUpdate = true;");
                    code.AppendLine($"                }}");
                }
            }
            else
            {
                // Generic property assignment
                code.AppendLine($"                {jsId}.{propertyPath} = ev.value;");
            }

            code.Append($"            }}");

            return code.ToString();
        }
    }
}
