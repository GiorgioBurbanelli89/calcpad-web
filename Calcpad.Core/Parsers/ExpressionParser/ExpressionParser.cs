using DocumentFormat.OpenXml.Presentation;
using Markdig;
using Markdig.Renderers;
using System;
using System.Collections.Frozen;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using System.Web;

namespace Calcpad.Core
{
    public partial class ExpressionParser
    {
        private const int MaxHtmlLines = 200000;
        private int _errorCount;
        private int _isVal;
        private int _startLine;
        private int _currentLine;
        private int _htmlLines;
        private int _decimals;
        private bool _calculate;
        private bool _isVisible;
        private bool _isPausedByUser;
        private int _pauseCharCount;
        private bool _isMarkdownOn;
        // SVG block state
        private bool _inSvgBlock;
        private double _svgWidth;
        private double _svgHeight;
        private StringBuilder _svgElements;
        private string _svgFill = "#4a90d9";
        private string _svgStroke = "#2c5aa0";
        private double _svgStrokeWidth = 2;
        private double _svgFillOpacity = 1.0;
        private double _svgStrokeOpacity = 1.0;
        private MathParser _parser;
        private readonly StringBuilder _sb = new(10000);
        private Queue<int> _errors;
        private LineInfo[] _lineCache;
        private static bool[] IsLineExtension = new bool[128];

        public Settings Settings { get; set; } = new();
        public string HtmlResult { get; private set; }
        public static bool IsUs
        {
            get => Unit.IsUs;
            set => Unit.IsUs = value;
        }
        public bool IsPaused => _startLine > 0;
        public bool Debug { get; set; }
        public bool ShowWarnings { get; set; } = true;
        public readonly List<string> OpenXmlExpressions = new(100);

        static ExpressionParser()
        {
            foreach (var c in ";|&@:({[") IsLineExtension[c] = true;
            InitKeyWordStrings();
        }

        public void Cancel() => _parser?.Cancel();
        public void Pause() => _isPausedByUser = true;

        private string HtmlId =>
            Debug && (_loops.Count == 0 || _loops.Peek().Iteration == 1) ?
            $" id=\"line-{_currentLine + 1}\" class=\"line\"" :
            string.Empty;

        public void Parse(string sourceCode, bool calculate = true, bool getXml = true) =>
            Parse(sourceCode.AsSpan(), calculate, getXml);

        private void Parse(ReadOnlySpan<char> code, bool calculate, bool getXml)
        {
            var lines = new List<int> { 0 };
            var len = code.Length;
            for (int i = 0; i < len; ++i)
                if (code[i] == '\n')
                    lines.Add(i + 1);

            if (lines[^1] < len)
                lines.Add(len);

            Initialize(calculate, lines.Count);
            var lineCount = lines.Count - 1;
            var s = string.Empty;
            var textSpan = s.AsSpan();
            try
            {
                while (++_currentLine < lineCount)
                {
                    ref var currentLineCache = ref _lineCache[_currentLine];
                    var keyword = currentLineCache.Keyword;
                    if (keyword == Keyword.SkipLine)
                        continue;
                    if (keyword == Keyword.Continue)
                    {
                        ParseKeywordContinue();
                        continue;
                    }
                    if (currentLineCache.IsCached && keyword == Keyword.None)
                    {
                        if (IsEnabled())
                        {
                            _condition.SetCondition(-1);
                            _parser.IsCalculation = _isVal != -1;
                            ParseLine(currentLineCache.Tokens, Keyword.None);
                        }
                        continue;
                    }
                    var i1 = lines[_currentLine];
                    var i2 = lines[_currentLine + 1];
                    var lineSpan = code[i1..i2];
                    var eolIndex = lineSpan.IndexOf('\v');
                    if (eolIndex > -1)
                    {
                        _parser.Line = int.Parse(lineSpan[(eolIndex + 1)..]);
                        lineSpan = lineSpan[..eolIndex];
                    }
                    else
                        _parser.Line = _currentLine + 1;

                    lineSpan = lineSpan.Trim();
                    if (HasLineExtension(textSpan.TrimEnd()))
                    {
                        var c = textSpan[^1];
                        if (c == '_')
                            s = textSpan[0..^2].ToString() + lineSpan.ToString();
                        else
                            s = $"{textSpan} {lineSpan}";

                        textSpan = s.AsSpan();
                    }
                    else
                        textSpan = lineSpan;

                    if (HasLineExtension(textSpan.TrimEnd()))
                    {
                        _lineCache[_currentLine] = new(null, Keyword.SkipLine);
                        continue;
                    }

                    if (_parser.IsCanceled)
                        break;

                    if (textSpan.IsEmpty)
                    {
                        if (_isVisible && _isVal != 1 && _htmlLines < MaxHtmlLines && IsEnabled())
                            _sb.AppendLine($"<p{HtmlId}>&nbsp;</p>");

                        continue;
                    }
                    var lineCache = _currentLine;
                    var result = ParseKeyword(textSpan, ref keyword);
                    if (keyword != currentLineCache.Keyword)
                        _lineCache[lineCache] = new(currentLineCache.Tokens, keyword);

                    if (result == KeywordResult.Continue)
                        continue;
                    else if (result == KeywordResult.Break)
                        break;

                    _parser.IsCalculation = _isVal != -1;
                    if ((textSpan[0] != '$' || !ParsePlot(textSpan)) &&
                        ParseCondition(textSpan, keyword))
                    {
                        List<Token> tokens;
                        if (_lineCache[_currentLine].IsCached)
                            tokens = _lineCache[_currentLine].Tokens;
                        else
                        {
                            tokens = GetTokens(textSpan[_condition.KeywordLength..]);
                            if (_isMarkdownOn)
                                ParseMarkDown(tokens);

                            _lineCache[_currentLine] = new(tokens, keyword);
                        }
                        _parser.HasInputFields = false;
                        ParseLine(tokens, keyword);
                        //If the line has input fields, the line cach is cleared, to allow #input to work
                        if (_parser.HasInputFields)
                            _lineCache[_currentLine] = new(null, keyword);
                    }
                }
                ApplyUnits(_sb, _calculate);
                if (_currentLine == lineCount && (_calculate || !IsPaused))
                {
                    if (_condition.Id > 0 && !_condition.IsLoop)
                        _sb.Append(ErrHtml(Messages.if_block_not_closed_Missing_end_if, _currentLine));
                    if (_loops.Count != 0)
                        _sb.Append(ErrHtml(Messages.Iteration_block_not_closed_Missing_loop, _currentLine));
                    if (Debug && (_condition.Id > 0 || _loops.Count != 0))
                        _errors.Enqueue(_currentLine);
                }
            }
            catch (MathParserException ex)
            {
                AppendError(textSpan.ToString(), ex.Message, _currentLine);
            }
            catch (Exception ex)
            {
                _sb.Append(ErrHtml(string.Format(Messages.Unexpected_error_0_Please_check_the_expression_consistency, ex.Message), _currentLine));
                if (Debug)
                    _errors.Enqueue(_currentLine);
            }
            finally
            {
                Finalize(lineCount);
            }

            [MethodImpl(MethodImplOptions.AggressiveInlining)]
            bool IsEnabled() => _condition.IsSatisfied &&
                (_loops.Count == 0 || !_loops.Peek().IsBroken) ||
                !_calculate;

            [MethodImpl(MethodImplOptions.AggressiveInlining)]
            bool HasLineExtension(ReadOnlySpan<char> s) => s.EndsWith(" _") || s.Length > 0 && CheckIsLineExtension(s[^1]) && !Validator.IsComment(s);

            [MethodImpl(MethodImplOptions.AggressiveInlining)]
            bool CheckIsLineExtension(char c) => c < 128 && IsLineExtension[c];

            bool ParsePlot(ReadOnlySpan<char> s)
            {
                PlotParser plotParser = null;

                // Check for mesh commands first
                if (s.StartsWith("$mesh_triangle", StringComparison.OrdinalIgnoreCase))
                {
                    if (_isVisible && IsEnabled())
                    {
                        var triangleMeshParser = new TriangleMeshParser(_parser);
                        try
                        {
                            var s1 = triangleMeshParser.Parse(s, _calculate);
                            _sb.Append(InsertAttribute(s1, HtmlId));
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }

                // $style{fill; stroke; width} - sets style for subsequent SVG elements in block mode
                if (s.StartsWith("$style", StringComparison.OrdinalIgnoreCase))
                {
                    if (_calculate && _inSvgBlock)
                    {
                        ParseSvgStyle(s);
                    }
                    return true;
                }

                // Simple SVG functions (like Python/matplotlib) - ONLY in block mode
                // For standalone modular $Svg{}, use the modular SvgParser below
                if (_inSvgBlock && (
                    s.StartsWith("$svg", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$rect", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$circle", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$line", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$ellipse", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$polygon", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$polyline", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$text", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$draw", StringComparison.OrdinalIgnoreCase)))
                {
                    if (_isVisible && IsEnabled())
                    {
                        var svgParser = new SimpleSvgParser(_parser, _inSvgBlock, _svgFill, _svgStroke, _svgStrokeWidth, _svgFillOpacity, _svgStrokeOpacity);
                        try
                        {
                            string s1;
                            // $svg{type; params} is the unified function
                            if (s.StartsWith("$svg", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParseSvg(s, _calculate);
                            else if (s.StartsWith("$rect", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParseRect(s, _calculate);
                            else if (s.StartsWith("$circle", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParseCircle(s, _calculate);
                            else if (s.StartsWith("$line", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParseLine(s, _calculate);
                            else if (s.StartsWith("$ellipse", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParseEllipse(s, _calculate);
                            else if (s.StartsWith("$polygon", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParsePolygon(s, _calculate);
                            else if (s.StartsWith("$polyline", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParsePolyline(s, _calculate);
                            else if (s.StartsWith("$text", StringComparison.OrdinalIgnoreCase))
                                s1 = svgParser.ParseText(s, _calculate);
                            else
                                s1 = svgParser.ParseDraw(s, _calculate);

                            // In block mode, append to _svgElements; otherwise append to main output
                            if (_inSvgBlock && _svgElements != null)
                                _svgElements.Append(s1);
                            else
                                _sb.Append(InsertAttribute(s1, HtmlId));
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }

                // Simple mesh functions (like Python/Octave)
                // $mesh2d{polygon; area} - generates and shows 2D mesh
                if (s.StartsWith("$mesh2d", StringComparison.OrdinalIgnoreCase))
                {
                    if (_isVisible && IsEnabled())
                    {
                        var simpleMeshParser = new SimpleMeshParser(_parser);
                        try
                        {
                            var s1 = simpleMeshParser.ParseMesh2D(s, _calculate);
                            _sb.Append(InsertAttribute(s1, HtmlId));
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }

                // $mesh3d{polygon; area} - generates and shows 3D mesh
                if (s.StartsWith("$mesh3d", StringComparison.OrdinalIgnoreCase))
                {
                    if (_isVisible && IsEnabled())
                    {
                        var simpleMeshParser = new SimpleMeshParser(_parser);
                        try
                        {
                            var s1 = simpleMeshParser.ParseMesh3D(s, _calculate);
                            _sb.Append(InsertAttribute(s1, HtmlId));
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }

                // Mesh 2D viewer with SVG (advanced - requires $Mesh_Triangle first)
                if (s.StartsWith("$mesh_view2d", StringComparison.OrdinalIgnoreCase))
                {
                    if (_isVisible && IsEnabled())
                    {
                        var meshView2DParser = new MeshView2DParser(_parser);
                        try
                        {
                            var s1 = meshView2DParser.Parse(s, _calculate);
                            _sb.Append(InsertAttribute(s1, HtmlId));
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }

                // Contour lines for mesh values
                // $Contour{values} or $Contour{values; n_levels}
                if (s.StartsWith("$contour", StringComparison.OrdinalIgnoreCase))
                {
                    if (_isVisible && IsEnabled())
                    {
                        var contourParser = new ContourParser(_parser);
                        try
                        {
                            var s1 = contourParser.Parse(s, _calculate);
                            _sb.Append(InsertAttribute(s1, HtmlId));
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }

                // Mesh 3D viewer with Three.js (like awatif getViewer)
                // $Mesh_View3D{} or $Mesh_View{} (alias)
                if (s.StartsWith("$mesh_view3d", StringComparison.OrdinalIgnoreCase) ||
                    s.StartsWith("$mesh_view", StringComparison.OrdinalIgnoreCase))
                {
                    if (_isVisible && IsEnabled())
                    {
                        var meshViewParser = new MeshViewParser(_parser);
                        try
                        {
                            var s1 = meshViewParser.Parse(s, _calculate);
                            _sb.Append(InsertAttribute(s1, HtmlId));
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }

                // Check for plot commands (order matters - longer prefixes first!)
                if (s.StartsWith("$plotlymesh", StringComparison.OrdinalIgnoreCase))
                    plotParser = new PlotlyMeshParser(_parser, Settings.Plot);
                else if (s.StartsWith("$plotly", StringComparison.OrdinalIgnoreCase))
                    plotParser = new PlotlyParser(_parser, Settings.Plot);
                else if (s.StartsWith("$plot", StringComparison.OrdinalIgnoreCase))
                    plotParser = new ChartParser(_parser, Settings.Plot);
                else if (s.StartsWith("$map", StringComparison.OrdinalIgnoreCase))
                    plotParser = new MapParser(_parser, Settings.Plot);
                // NEW: JavaScript-based charts
                else if (s.StartsWith("$scatter", StringComparison.OrdinalIgnoreCase))
                    plotParser = new ScatterParser(_parser, Settings.Plot);
                else if (s.StartsWith("$barh", StringComparison.OrdinalIgnoreCase))
                    plotParser = new BarParser(_parser, Settings.Plot, horizontal: true);
                else if (s.StartsWith("$bar", StringComparison.OrdinalIgnoreCase))
                    plotParser = new BarParser(_parser, Settings.Plot, horizontal: false);
                else if (s.StartsWith("$surface3d", StringComparison.OrdinalIgnoreCase))
                    plotParser = new Surface3DParser(_parser, Settings.Plot);
                // NEW: Table command for generating HTML tables from matrices/vectors
                else if (s.StartsWith("$table", StringComparison.OrdinalIgnoreCase))
                    plotParser = new TableParser(_parser, Settings.Plot);
                // NEW: Three.js 3D structural viewer
                else if (s.StartsWith("$three", StringComparison.OrdinalIgnoreCase))
                    plotParser = new ThreeJsParser(_parser, Settings.Plot);
                // NEW: Canvas 2D modular drawing system
                else if (s.StartsWith("$canvas", StringComparison.OrdinalIgnoreCase))
                    plotParser = new CanvasParser(_parser, Settings.Plot);
                // NEW: Universal animation system
                else if (s.StartsWith("$animate", StringComparison.OrdinalIgnoreCase))
                    plotParser = new AnimationParser(_parser, Settings.Plot);
                // NEW: SVG modular drawing system
                else if (s.StartsWith("$svg", StringComparison.OrdinalIgnoreCase))
                    plotParser = new SvgParser(_parser, Settings.Plot);

                if (plotParser != null)
                {
                    if (_isVisible && IsEnabled())
                    {
                        try
                        {
                            _parser.IsPlotting = true;
                            var s1 = plotParser.Parse(s, _calculate);
                            _sb.Append(InsertAttribute(s1, HtmlId));
                            _parser.IsPlotting = false;
                        }
                        catch (MathParserException ex)
                        {
                            AppendError(s.ToString(), ex.Message, _currentLine);
                        }
                    }
                    return true;
                }
                return false;
            }

            void ParseMarkDown(List<Token> tokens)
            {
                if (tokens.Count == 0)
                    return;

                const char rs = '\u001E';
                StringBuilder sb = new();
                var startsWithExpression = tokens[0].Type == TokenTypes.Expression;
                if (startsWithExpression)
                    sb.Append(rs);

                var n = tokens.Count;
                for (int i = 0; i < n; ++i)
                {
                    var token = tokens[i];
                    if (token.Type != TokenTypes.Expression)
                    {
                        if (n == 1)
                            sb.Append(token.Value.TrimEnd());
                        else
                            sb.Append(token.Value).Append(rs);
                    }
                }
                var pipeline = new MarkdownPipelineBuilder().UseEmphasisExtras().UseListExtras().Build();
                var document = Markdown.Parse(sb.ToString(), pipeline);
                using StringWriter writer = new();
                HtmlRenderer renderer = new(writer)
                {
                    ImplicitParagraph = true
                };
                pipeline.Setup(renderer);
                renderer.Render(document); // using the renderer directly
                var result = writer.ToString();
                var sections = result.AsSpan().EnumerateSplits(rs);
                var cs = sections.Current;
                if (startsWithExpression)
                {
                    if (cs.IsEmpty)
                        sections.MoveNext();
                    else
                    {
                        tokens.Insert(0, new Token(cs.ToString(), TokenTypes.Html));
                        ++n;
                    }
                }
                for (int i = 0; i < n; ++i)
                {
                    var t = tokens[i].Type;
                    if (t != TokenTypes.Expression)
                    {
                        if (!sections.MoveNext())
                            break;

                        cs = sections.Current;
                        if (cs.StartsWith("<"))
                            t = TokenTypes.Html;

                        tokens[i] = new Token(cs.ToString(), t);
                    }
                }
                while (sections.MoveNext())
                {
                    cs = sections.Current;
                    if (!cs.IsEmpty)
                        tokens.Add(new Token(cs.ToString(), TokenTypes.Html));

                }
            }

            bool ParseCondition(ReadOnlySpan<char> s, Keyword keyword)
            {

                if (IsPaused && !_calculate)
                {
                    _condition.SetCondition(-1);
                    return keyword == Keyword.None;
                }
                _condition.SetCondition(keyword - Keyword.If);
                if (IsEnabled())
                {
                    if (_condition.KeywordLength == s.Length)
                    {
                        if (_condition.IsUnchecked)
                            throw Exceptions.ConditionEmpty();

                        if (_isVisible && !_calculate)
                        {
                            if (keyword == Keyword.Else)
                                _sb.Append($"</div><p{HtmlId}>{_condition.ToHtml()}</p><div class = \"indent\">");
                            else
                                _sb.Append($"</div><p{HtmlId}>{_condition.ToHtml()}</p>");
                        }
                    }
                    else if (_condition.KeywordLength > 0 &&
                             _condition.IsFound &&
                             _condition.IsUnchecked &&
                             _calculate)
                        _condition.Check(0.0);
                    else
                        return true;
                }
                return false;
            }

            void ParseLine(List<Token> tokens, Keyword keyword)
            {
                var kwdLength = _condition.KeywordLength;
                var isOutput = _isVisible &&
                    (!_calculate || kwdLength == 0) &&
                    _htmlLines < MaxHtmlLines;

                if (isOutput)
                {
                    ++_htmlLines;
                    if (_htmlLines == MaxHtmlLines)
                        AppendError(string.Concat(tokens), string.Format(Messages.The_output_is_longer_than_0_lines_The_rest_will_be_skipped, MaxHtmlLines), _currentLine);
                    else
                    {
                        bool isIndent = keyword == Keyword.Else_If || keyword == Keyword.End_If;
                        var lineType = tokens.Count != 0 ?
                            tokens[0].Type :
                            TokenTypes.Text;


                        string htmlId = null;
                        if (_isVal != 1)
                        {
                            htmlId = HtmlId;
                            AppendHtmlLineStart(lineType, isIndent);
                        }
                        if (lineType == TokenTypes.Html && !string.IsNullOrEmpty(htmlId))
                            tokens[0] = new Token(InsertAttribute(tokens[0].Value, htmlId), TokenTypes.Html);

                        if (kwdLength > 0)
                            _sb.Append(_condition.ToHtml());

                        ParseTokens(tokens, true, getXml);
                        if (_isVal != 1)
                            AppendHtmlLineEnd(lineType, keyword == Keyword.If);
                    }
                }
                else
                    ParseTokens(tokens, false, getXml);

                if (_condition.IsUnchecked)
                {
                    if (_calculate)
                        _condition.Check(_parser.Result);
                    else
                        _condition.Check();
                }
            }

            void AppendHtmlLineStart(TokenTypes lineType, bool isIndent)
            {
                if (isIndent)
                    _sb.Append("</div>");

                if (lineType == TokenTypes.Heading)
                    _sb.Append($"<h3{HtmlId}>");
                else if (lineType != TokenTypes.Html)
                    _sb.Append($"<p{HtmlId}>");
            }

            void AppendHtmlLineEnd(TokenTypes lineType, bool indent)
            {
                if (lineType == TokenTypes.Heading)
                    _sb.Append("</h3>");
                else if (lineType != TokenTypes.Html)
                    _sb.Append("</p>");

                if (indent)
                    _sb.Append("<div class = \"indent\">");

                _sb.AppendLine();
            }
        }

        private void Initialize(bool calculate, int lineCount)
        {
            _htmlLines = 0;
            _errorCount = 0;
            _calculate = calculate;
            _errors = new();
            if (!_calculate)
                _startLine = 0;

            if (_startLine == 0)
            {
                Settings.Math.FormatString = null;
                _parser = new MathParser(Settings.Math)
                {
                    ShowWarnings = ShowWarnings
                };
                _decimals = Settings.Math.Decimals;
                _lineCache = new LineInfo[lineCount];
                _sb.Clear();
                _condition = new();
                _loops.Clear();
                _isVal = 0;
                _parser.SetVariable("Units", new RealValue(UnitsFactor()));
                _previousKeyword = Keyword.None;
                _isMarkdownOn = false;
                OpenXmlExpressions.Clear();
            }
            else
            {
                if (_lineCache.Length < lineCount)
                    Array.Resize(ref _lineCache, lineCount);

                var n = _sb.Length - _pauseCharCount;
                if (n > 0)
                    _sb.Remove(_pauseCharCount, n);
            }
            _parser.IsEnabled = _calculate;
            _currentLine = _startLine - 1;
            _isVisible = true;
        }

        private void Finalize(int lineCount)
        {
            if (_currentLine == lineCount && _calculate)
                _startLine = 0;

            if (_startLine > 0)
                _sb.Append(Messages.Paused_Press_F5_to_continue);

            if (Debug && lineCount > 30 && _errors.Count != 0)
                AppendErrors();

            HtmlResult = _sb.ToString();

            if (_calculate && _startLine == 0)
            {
                _parser.ClearCache();
                _parser = null;
            }
        }

        private void AppendErrors()
        {
            if (_errors.Count == 1)
                _sb.AppendLine(Messages.Error_found_on_line);
            else
                _sb.AppendLine(string.Format(Messages.Errors_found_on_lines, _errors.Count));
            var count = 0;
            var prevLine = 0;
            while (_errors.Count != 0 && count < 20)
            {
                var errLine = _errors.Dequeue() + 1;
                if (errLine != prevLine)
                {
                    ++count;
                    _sb.Append($" <span class=\"roundBox\" data-line=\"{errLine}\">{errLine}</span>");
                }
                prevLine = errLine;
            }
            if (_errors.Count > 0)
                _sb.Append(" ...");

            _sb.Append("</div>");
            _sb.AppendLine("<style>body {padding-top:1em;}</style>");
            _errors.Clear();
        }

        private void ParseTokens(List<Token> tokens, bool isOutput, bool getXml)
        {
            var isLoop = _loops.Count > 0 && _calculate && _isVal > -1;
            for (int i = 0, count = tokens.Count; i < count; ++i)
            {
                var token = tokens[i];
                if (token.Type == TokenTypes.Expression)
                {
                    try
                    {
                        var cacheID = token.CacheID;
                        if (cacheID < 0)
                        {
                            _parser.Parse(token.Value);
                            if (isLoop)
                                tokens[i].CacheID = _parser.WriteEquationToCache(isOutput);
                        }
                        else
                            _parser.ReadEquationFromCache(cacheID);

                        if (_calculate && _isVal > -1)
                            _parser.Calculate(isOutput, cacheID);
                        else
                            _parser.DefineCustomUnits();

                        if (isOutput)
                        {
                            if (_isVal == 1 && _calculate)
                                _sb.Append(_parser.ResultAsVal);
                            else
                            {
                                var html = _parser.ToHtml();
                                if (getXml && Settings.Math.FormatEquations)
                                {
                                    var xml = _parser.ToXml();
                                    OpenXmlExpressions.Add(xml);
                                    _sb.Append($"<span class=\"eq\" id=\"eq-{OpenXmlExpressions.Count - 1}\">{html}</span>");
                                }
                                else
                                    _sb.Append($"<span class=\"eq\">{html}</span>");
                            }
                        }
                    }
                    catch (MathParserException ex)
                    {
                        _parser.ResetStack();
                        string errText;
                        if (!_calculate && token.Value.Contains('?'))
                            errText = token.Value.Replace("?", "<input type=\"text\" size=\"2\" name=\"Var\">");
                        else
                            errText = HttpUtility.HtmlEncode(token.Value);
                        errText = string.Format(Messages.Error_in_0_on_line_1_2, errText, LineHtml(_currentLine), ex.Message);
                        _sb.Append($"<span class=\"err\"{Id(_currentLine)}>{errText}</span>");
                        if (Debug)
                            _errors.Enqueue(_currentLine);

                        if (++_errorCount == 40)
                            throw new MathParserException(Messages.Too_many_errors);
                    }
                }
                else if (isOutput)
                    _sb.Append(token.Value);
            }
        }

        void AppendError(string lineContent, string text, int line)
        {
            string s = lineContent.Replace("<", "&lt;").Replace(">", "&gt;");
            _sb.Append(ErrHtml(string.Format(Messages.Error_in_0_on_line_1_2, s, LineHtml(line), text), line));

            if (Debug)
                _errors.Enqueue(line);
        }

        private static string LineHtml(int line) => $"[<a href=\"#0\" data-text=\"{line + 1}\">{line + 1}</a>]";
        private string ErrHtml(string text, int line) => $"<p class=\"err\"{Id(line)}\">{text}</p>";
        private string Id(int line) => Debug ? $" id=\"line-{line + 1}\"" : string.Empty;

        private static string InsertAttribute(ReadOnlySpan<char> s, string attr)
        {
            if (s.Length > 2 && s[0] == '<' && char.IsLetter(s[1]))
            {
                var i = s.IndexOf('>');
                if (i > 1)
                {
                    var j = i;
                    while (j > 1)
                    {
                        --j;
                        if (s[j] != ' ')
                        {
                            if (s[j] == '/')
                                i = j;

                            break;
                        }
                    }
                    return s[..i].ToString() + attr + s[i..].ToString();
                }
            }
            return s.ToString();
        }

        private void ApplyUnits(StringBuilder sb, bool calculate)
        {
            string unitsHtml = calculate ?
                Settings.Units :
                string.Concat("<span class=\"Units\">", Settings.Units, "</span>");

            long len = sb.Length;
            sb.Replace("%u", unitsHtml);
            if (calculate || sb.Length == len)
                return;

            sb.Insert(0, "<select id=\"Units\" name=\"Units\"><option value=\"m\"> m </option><option value=\"cm\"> cm </option><option value=\"mm\"> mm </option></select>");
        }

        private double UnitsFactor() => Settings.Units switch
        {
            "mm" => 1000,
            "cm" => 100,
            "m" => 1,
            _ => 0
        };

        private void ParseSvgStyle(ReadOnlySpan<char> s)
        {
            // Parse $style{fill; stroke; width; fill-opacity; stroke-opacity}
            var startIdx = s.IndexOf('{');
            var endIdx = s.LastIndexOf('}');
            if (startIdx == -1 || endIdx <= startIdx)
                return;

            var content = s.Slice(startIdx + 1, endIdx - startIdx - 1).ToString();
            var parts = content.Split(';');

            // Reset to defaults, then apply new values
            _svgFill = "#4a90d9";
            _svgStroke = "#2c5aa0";
            _svgStrokeWidth = 2;
            _svgFillOpacity = 1.0;
            _svgStrokeOpacity = 1.0;
            bool fillSet = false;
            int numberCount = 0;

            foreach (var part in parts)
            {
                var trimmed = part.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;

                // Check if it's a color
                if (IsColor(trimmed))
                {
                    var color = ParseColor(trimmed);
                    // First color is fill, second is stroke
                    if (!fillSet)
                    {
                        _svgFill = color;
                        fillSet = true;
                    }
                    else
                    {
                        _svgStroke = color;
                    }
                }
                // Check if it's a number
                else if (double.TryParse(trimmed, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var val))
                {
                    numberCount++;
                    if (numberCount == 1)
                        _svgStrokeWidth = val;
                    else if (numberCount == 2)
                        _svgFillOpacity = val;
                    else if (numberCount == 3)
                        _svgStrokeOpacity = val;
                }
            }
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
                   s == "seagreen" || s == "lightpink" || s == "orangered" ||
                   s == "none" || s == "transparent";
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
                "seagreen" => "#2e8b57",
                "lightpink" => "#ffb6c1",
                "orangered" => "#ff4500",
                "none" or "transparent" => "none",
                _ => s
            };
        }
    }
}
