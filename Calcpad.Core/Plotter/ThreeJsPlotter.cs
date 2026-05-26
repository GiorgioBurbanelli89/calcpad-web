using System;
using System.Globalization;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Plotter for 3D structural visualization using Three.js
    /// Replicates Awatif-style viewer with nodes, elements, loads, supports, and deformed shape
    /// Syntax: $Three{nodes; elements; deformed; loads; supports | scale}
    /// </summary>
    internal class ThreeJsPlotter : JsPlotter
    {
        private readonly Matrix _nodes;
        private readonly Matrix _elements;
        private readonly Matrix _deformed;
        private readonly Matrix _loads;
        private readonly Vector _supports;
        private readonly double _scale;

        private bool HasDeformed => _deformed is not null && _deformed.RowCount > 0;
        private bool HasLoads => _loads is not null && _loads.RowCount > 0;
        private bool HasSupports => _supports is not null && _supports.Length > 0;

        internal ThreeJsPlotter(MathParser parser, PlotSettings settings,
            Matrix nodes, Matrix elements, Matrix deformed, Matrix loads, Vector supports, double scale)
            : base(parser, settings)
        {
            _nodes = nodes;
            _elements = elements;
            _deformed = deformed;
            _loads = loads;
            _supports = supports;
            _scale = scale;
        }

        public override string Plot()
        {
            GetImageSize();
            var chartId = GetChartId();

            // Validate inputs
            if (_nodes is null || _nodes.RowCount < 2 || _nodes.ColCount < 2)
                return "<span class=\"err\">$Three: nodes must be Nx2 or Nx3 matrix with at least 2 rows</span>";

            if (_elements is null || _elements.RowCount < 1 || _elements.ColCount < 2)
                return "<span class=\"err\">$Three: elements must be Ex2 matrix with at least 1 row</span>";

            var sb = new StringBuilder();

            // Container with controls panel
            sb.AppendLine($@"<div id=""{chartId}"" class=""three-viewer"" style=""width:{Width}px;height:{Height}px;margin:10px auto;background:#1a1a2e;position:relative;border-radius:4px;"">");

            // Control panel (Awatif-style)
            sb.AppendLine($@"<div style=""position:absolute;top:10px;left:10px;z-index:10;background:#fff;padding:8px;border-radius:4px;font-size:11px;font-family:sans-serif;"">");
            sb.AppendLine($@"<label><input type=""checkbox"" id=""{chartId}_chkN"" checked> Nodes</label><br>");
            sb.AppendLine($@"<label><input type=""checkbox"" id=""{chartId}_chkE"" checked> Elements</label><br>");
            if (HasLoads)
                sb.AppendLine($@"<label><input type=""checkbox"" id=""{chartId}_chkL"" checked> Loads</label><br>");
            if (HasSupports)
                sb.AppendLine($@"<label><input type=""checkbox"" id=""{chartId}_chkS"" checked> Supports</label><br>");
            if (HasDeformed)
            {
                sb.AppendLine($@"<label><input type=""checkbox"" id=""{chartId}_chkD""> Deformed</label><br>");
                sb.AppendLine($@"<input type=""range"" id=""{chartId}_scl"" min=""1"" max=""200"" value=""{_scale}"" style=""width:80px"">");
            }
            sb.AppendLine("</div>");

            // Legend panel
            sb.AppendLine($@"<div style=""position:absolute;bottom:10px;right:10px;z-index:10;background:rgba(255,255,255,0.9);padding:4px 8px;border-radius:3px;font-size:10px;font-family:sans-serif;"">");
            sb.AppendLine(@"<span style=""color:#fff;background:#333;padding:1px 4px;border-radius:2px;"">Nodes</span> ");
            sb.AppendLine(@"<span style=""color:#4cc9f0;"">Elements</span> ");
            if (HasLoads)
                sb.AppendLine(@"<span style=""color:#ee9b00;"">Loads</span> ");
            if (HasSupports)
                sb.AppendLine(@"<span style=""color:#9b2226;"">Supports</span> ");
            if (HasDeformed)
                sb.AppendLine(@"<span style=""color:#00ff00;"">Deformed</span>");
            sb.AppendLine("</div>");

            sb.AppendLine("</div>");

            // Generate JavaScript
            sb.AppendLine("<script>");
            sb.AppendLine("(function(){");

            // Data arrays
            sb.AppendLine($"var nodes = {GenerateNodesArray()};");
            sb.AppendLine($"var elements = {GenerateElementsArray()};");

            if (HasDeformed)
                sb.AppendLine($"var deformed = {GenerateDeformedArray()};");
            else
                sb.AppendLine("var deformed = null;");

            if (HasLoads)
                sb.AppendLine($"var loads = {GenerateLoadsArray()};");
            else
                sb.AppendLine("var loads = null;");

            if (HasSupports)
                sb.AppendLine($"var supports = {GenerateSupportsArray()};");
            else
                sb.AppendLine("var supports = null;");

            sb.AppendLine($"var scale = {_scale.ToString("G", CultureInfo.InvariantCulture)};");
            sb.AppendLine($"var chartId = '{chartId}';");

            // Calculate bounding box for camera positioning
            sb.AppendLine(@"
var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
for(var i=0;i<nodes.length;i++){
    var n=nodes[i];
    if(n[0]<minX)minX=n[0];if(n[0]>maxX)maxX=n[0];
    if(n[1]<minY)minY=n[1];if(n[1]>maxY)maxY=n[1];
    if(n[2]<minZ)minZ=n[2];if(n[2]>maxZ)maxZ=n[2];
}
var cx=(minX+maxX)/2,cy=(minY+maxY)/2,cz=(minZ+maxZ)/2;
var size=Math.max(maxX-minX,maxY-minY,maxZ-minZ)||10;
var nodeSize=size*0.02;
");

            // Three.js setup (Awatif-style: Z is up)
            sb.AppendLine($@"
var container=document.getElementById(chartId);
if(!container)return;

// Check if THREE is available
if(typeof THREE==='undefined'){{
    container.innerHTML='<p style=""color:red;text-align:center;padding-top:50px;"">Three.js not loaded</p>';
    return;
}}

// Set Z as up (engineering convention like Awatif)
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

var scene=new THREE.Scene();
scene.background=new THREE.Color(0x1a1a2e);

var camera=new THREE.PerspectiveCamera(45,container.clientWidth/container.clientHeight,0.1,size*100);
camera.position.set(cx+size*0.8, cy-size*1.5, cz+size*0.8);
camera.up.set(0, 0, 1);

var renderer=new THREE.WebGLRenderer({{antialias:true}});
renderer.setSize(container.clientWidth,container.clientHeight);
container.appendChild(renderer.domElement);

var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.target.set(cx,cy,cz);
controls.enableDamping=true;
controls.update();

// Grid (on XY plane at minZ, Awatif-style)
var gridSize=Math.ceil(size/5)*10;
var grid=new THREE.GridHelper(gridSize, 20, 0x404040, 0x404040);
grid.position.set(cx, cy, minZ);
grid.rotateX(Math.PI/2);
scene.add(grid);

// Axes
var axes=new THREE.AxesHelper(size*0.15);
axes.position.set(minX,minY,minZ);
scene.add(axes);

// Nodes group
var nodesGroup=new THREE.Group();
var nodeMaterial=new THREE.MeshBasicMaterial({{color:0xffffff}});
var nodeGeometry=new THREE.SphereGeometry(nodeSize,12,12);
for(var i=0;i<nodes.length;i++){{
    var mesh=new THREE.Mesh(nodeGeometry,nodeMaterial);
    mesh.position.set(nodes[i][0],nodes[i][1],nodes[i][2]);
    nodesGroup.add(mesh);
}}
scene.add(nodesGroup);

// Elements group
var elementsGroup=new THREE.Group();
var lineMaterial=new THREE.LineBasicMaterial({{color:0x4cc9f0,linewidth:2}});
for(var i=0;i<elements.length;i++){{
    var ni=elements[i][0],nj=elements[i][1];
    if(ni>=0&&ni<nodes.length&&nj>=0&&nj<nodes.length){{
        var pts=[new THREE.Vector3(nodes[ni][0],nodes[ni][1],nodes[ni][2]),
                 new THREE.Vector3(nodes[nj][0],nodes[nj][1],nodes[nj][2])];
        var geom=new THREE.BufferGeometry().setFromPoints(pts);
        elementsGroup.add(new THREE.Line(geom,lineMaterial));
    }}
}}
scene.add(elementsGroup);
");

            // Loads group (if available)
            if (HasLoads)
            {
                sb.AppendLine(@"
// Loads group
var loadsGroup=new THREE.Group();
if(loads){
    var arrowLen=size*0.15;
    for(var i=0;i<loads.length;i++){
        var l=loads[i];
        var nodeIdx=Math.round(l[0]);
        if(nodeIdx>=0&&nodeIdx<nodes.length){
            var p=nodes[nodeIdx];
            var dir=new THREE.Vector3(l[1],l[2],l[3]).normalize();
            if(dir.length()>0.001){
                var arrow=new THREE.ArrowHelper(dir,new THREE.Vector3(p[0],p[1],p[2]),arrowLen,0xee9b00,arrowLen*0.3,arrowLen*0.15);
                loadsGroup.add(arrow);
            }
        }
    }
}
scene.add(loadsGroup);
");
            }

            // Supports group (if available)
            if (HasSupports)
            {
                sb.AppendLine(@"
// Supports group
var supportsGroup=new THREE.Group();
if(supports){
    var boxSize=nodeSize*2;
    var boxMaterial=new THREE.MeshBasicMaterial({color:0x9b2226});
    var boxGeometry=new THREE.BoxGeometry(boxSize,boxSize,boxSize);
    for(var i=0;i<supports.length;i++){
        var idx=Math.round(supports[i]);
        if(idx>=0&&idx<nodes.length){
            var p=nodes[idx];
            var box=new THREE.Mesh(boxGeometry,boxMaterial);
            box.position.set(p[0],p[1],p[2]-boxSize/2);
            supportsGroup.add(box);
        }
    }
}
scene.add(supportsGroup);
");
            }

            // Deformed group (if available)
            if (HasDeformed)
            {
                sb.AppendLine(@"
// Deformed group
var deformedGroup=new THREE.Group();
deformedGroup.visible=false;
var defMaterial=new THREE.LineBasicMaterial({color:0x00ff00});

function updateDeformed(sc){
    deformedGroup.clear();
    if(!deformed)return;
    var defNodes=nodes.map(function(p,i){
        var d=deformed[i]||[0,0,0];
        return[p[0]+d[0]*sc,p[1]+d[1]*sc,p[2]+d[2]*sc];
    });
    for(var i=0;i<elements.length;i++){
        var ni=elements[i][0],nj=elements[i][1];
        if(ni>=0&&ni<defNodes.length&&nj>=0&&nj<defNodes.length){
            var pts=[new THREE.Vector3(defNodes[ni][0],defNodes[ni][1],defNodes[ni][2]),
                     new THREE.Vector3(defNodes[nj][0],defNodes[nj][1],defNodes[nj][2])];
            deformedGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),defMaterial));
        }
    }
}
updateDeformed(scale);
scene.add(deformedGroup);
");
            }

            // Event handlers
            sb.AppendLine($@"
// Event handlers
document.getElementById(chartId+'_chkN').onchange=function(e){{nodesGroup.visible=e.target.checked;}};
document.getElementById(chartId+'_chkE').onchange=function(e){{elementsGroup.visible=e.target.checked;}};
");
            if (HasLoads)
                sb.AppendLine($@"document.getElementById(chartId+'_chkL').onchange=function(e){{loadsGroup.visible=e.target.checked;}};");
            if (HasSupports)
                sb.AppendLine($@"document.getElementById(chartId+'_chkS').onchange=function(e){{supportsGroup.visible=e.target.checked;}};");
            if (HasDeformed)
            {
                sb.AppendLine($@"document.getElementById(chartId+'_chkD').onchange=function(e){{deformedGroup.visible=e.target.checked;}};");
                sb.AppendLine($@"document.getElementById(chartId+'_scl').oninput=function(e){{updateDeformed(parseFloat(e.target.value));}};");
            }

            // Animation loop
            sb.AppendLine(@"
// Animation loop
function animate(){
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene,camera);
}
animate();

// Handle resize
window.addEventListener('resize',function(){
    var w=container.clientWidth,h=container.clientHeight;
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    renderer.setSize(w,h);
});
");

            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }

        private string GenerateNodesArray()
        {
            var sb = new StringBuilder("[");
            bool is3D = _nodes.ColCount >= 3;

            for (int i = 0; i < _nodes.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('[');
                sb.Append(GetValue(_nodes, i, 0));
                sb.Append(',');
                sb.Append(_nodes.ColCount > 1 ? GetValue(_nodes, i, 1) : "0");
                sb.Append(',');
                sb.Append(is3D ? GetValue(_nodes, i, 2) : "0");
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private string GenerateElementsArray()
        {
            var sb = new StringBuilder("[");

            // Detect if indices are 0-based or 1-based
            double minIdx = double.MaxValue;
            for (int i = 0; i < _elements.RowCount; i++)
            {
                var v0 = _elements[i, 0].D;
                var v1 = _elements[i, 1].D;
                if (v0 < minIdx) minIdx = v0;
                if (v1 < minIdx) minIdx = v1;
            }
            int offset = minIdx >= 1 ? 1 : 0; // Convert to 0-based if 1-based

            for (int i = 0; i < _elements.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('[');
                var ni = (int)_elements[i, 0].D - offset;
                var nj = (int)_elements[i, 1].D - offset;
                sb.Append(ni);
                sb.Append(',');
                sb.Append(nj);
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private string GenerateDeformedArray()
        {
            if (!HasDeformed) return "null";

            var sb = new StringBuilder("[");
            bool is3D = _deformed.ColCount >= 3;

            for (int i = 0; i < _deformed.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('[');
                sb.Append(GetValue(_deformed, i, 0));
                sb.Append(',');
                sb.Append(_deformed.ColCount > 1 ? GetValue(_deformed, i, 1) : "0");
                sb.Append(',');
                sb.Append(is3D ? GetValue(_deformed, i, 2) : "0");
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private string GenerateLoadsArray()
        {
            if (!HasLoads) return "null";

            var sb = new StringBuilder("[");

            for (int i = 0; i < _loads.RowCount; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('[');
                // [node, Fx, Fy, Fz]
                sb.Append(GetValue(_loads, i, 0));
                sb.Append(',');
                sb.Append(_loads.ColCount > 1 ? GetValue(_loads, i, 1) : "0");
                sb.Append(',');
                sb.Append(_loads.ColCount > 2 ? GetValue(_loads, i, 2) : "0");
                sb.Append(',');
                sb.Append(_loads.ColCount > 3 ? GetValue(_loads, i, 3) : "0");
                sb.Append(']');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private string GenerateSupportsArray()
        {
            if (!HasSupports) return "null";

            var sb = new StringBuilder("[");

            for (int i = 0; i < _supports.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(_supports[i].D.ToString("G", CultureInfo.InvariantCulture));
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
    }
}
