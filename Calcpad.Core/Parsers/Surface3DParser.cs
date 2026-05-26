using System;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Surface3D command - 3D surface plots with Three.js
    /// Syntax: $Surface3D{f(x; y) @ x = x1 : x2 & y = y1 : y2}
    ///         $Surface3D{f(x; y) @ x = x1 : x2 & y = y1 : y2 | wireframe}
    /// </summary>
    internal class Surface3DParser : PlotParser
    {
        private Func<IValue> _function;

        internal Surface3DParser(MathParser parser, PlotSettings settings) : base(parser, settings) { }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            // Delimiters: { @ = : & = : }
            const int n = 7;
            ReadOnlySpan<char> delimiters = ['{', '@', '=', ':', '&', '=', ':', '}'];
            var input = new string[n];
            var index = 0;
            var bracketCount = 0;
            var ts = new TextSpan(script);
            var del = delimiters[0];

            for (int i = 0, len = script.Length; i < len; ++i)
            {
                var c = script[i];
                if (c == '{')
                    ++bracketCount;

                if (c == del && bracketCount == 1)
                {
                    if (index > 0)
                        input[index - 1] = ts.Cut().Trim().ToString();

                    ++index;
                    if (index > n)
                        break;
                    del = delimiters[index];
                    ts.Reset(i + 1);
                }
                else
                    ts.Expand();

                if (c == '}')
                    --bracketCount;
            }

            if (index <= n)
                return string.Format(Messages.Missing_delimiter_0_in_plot_command, delimiters[index].ToString(), script.ToString());

            for (int j = 0; j < n; ++j)
                if (string.IsNullOrWhiteSpace(input[j]))
                    return string.Format(Messages.Missing_0_in_plot_command_1, GetPartName(j), script.ToString());

            // Check for options after the range (e.g., | wireframe)
            bool wireframe = false;
            var lastPart = input[6];
            if (lastPart.Contains('|'))
            {
                var optionIndex = lastPart.IndexOf('|');
                var option = lastPart.Substring(optionIndex + 1).Trim().ToLowerInvariant();
                input[6] = lastPart.Substring(0, optionIndex).Trim();
                wireframe = option.Contains("wire");
            }

            if (!calculate)
                return GetHtmlText(input);

            try
            {
                // Parse variable names
                var varXName = input[1].Trim();
                var varYName = input[4].Trim();

                // Create parameters
                ReadOnlySpan<Parameter> parameters = [new(varXName), new(varYName)];

                // Compile the function
                _function = Parser.Compile(input[0], parameters);

                // Parse bounds
                Parser.Parse(input[2]);
                var startX = Parser.CalculateReal();
                Parser.Parse(input[3]);
                var endX = Parser.CalculateReal();
                Parser.Parse(input[5]);
                var startY = Parser.CalculateReal();
                Parser.Parse(input[6]);
                var endY = Parser.CalculateReal();

                var varX = parameters[0].Variable;
                var varY = parameters[1].Variable;

                // Calculate the surface data
                var plotter = new Surface3DPlotter(Parser, Settings, _function, varX, varY,
                    startX, endX, startY, endY, wireframe);
                return plotter.Plot();
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">Error in $Surface3D: {ex.Message}</span>";
            }
        }

        private static string GetPartName(int index)
        {
            return index switch
            {
                0 => "function",
                1 => "first variable name",
                2 => "first variable start",
                3 => "first variable end",
                4 => "second variable name",
                5 => "second variable start",
                6 => "second variable end",
                _ => "unknown"
            };
        }

        private static string GetHtmlText(string[] input)
        {
            return $"<span class=\"eq\"><span class=\"cond\">$Surface3D</span>{{{input[0]} @ {input[1]} = {input[2]} : {input[3]} & {input[4]} = {input[5]} : {input[6]}}}</span>";
        }
    }
}
