using Calcpad.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var htmlCache = new ConcurrentDictionary<string, string>();

static string CacheKey(string content, int decimals, int degrees, bool isComplex)
{
    var raw = $"{decimals}|{degrees}|{isComplex}|{content}";
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
    return Convert.ToHexString(hash);
}

app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    ctx.Response.Headers["Pragma"] = "no-cache";
    await next();
});

var publicDir = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "public"));
if (Directory.Exists(publicDir))
{
    var provider = new FileExtensionContentTypeProvider();
    provider.Mappings[".cpd"] = "text/plain";

    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(publicDir),
        RequestPath = "",
        ContentTypeProvider = provider
    });
}

var templatePath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
    "Calcpad", "doc", "template.html"
);
var htmlTemplate = File.Exists(templatePath)
    ? File.ReadAllText(templatePath)
    : "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body>";

htmlTemplate = htmlTemplate.Replace(
    "<script src=\"https://calcpad.local/jquery-3.6.3.min.js\"></script>", "");

app.MapPost("/api/convert", async (HttpContext ctx) =>
{
    using var reader = new StreamReader(ctx.Request.Body);
    var json = await reader.ReadToEndAsync();
    var doc = JsonDocument.Parse(json);
    var content = doc.RootElement.GetProperty("content").GetString();

    if (string.IsNullOrWhiteSpace(content))
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsync("Missing content");
        return;
    }

    var decimals = 4;
    var degrees = 0;
    var isComplex = false;

    if (doc.RootElement.TryGetProperty("settings", out var s))
    {
        if (s.TryGetProperty("decimals", out var d)) decimals = d.GetInt32();
        if (s.TryGetProperty("degrees", out var dg)) degrees = dg.GetInt32();
        if (s.TryGetProperty("isComplex", out var ic)) isComplex = ic.GetBoolean();
    }

    var key = CacheKey(content, decimals, degrees, isComplex);
    if (htmlCache.TryGetValue(key, out var cached))
    {
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.WriteAsync(cached);
        return;
    }

    try
    {
        var settings = new Settings
        {
            Units = "m",
            Math = new MathSettings
            {
                Decimals = decimals,
                Degrees = degrees,
                IsComplex = isComplex,
                Substitute = true,
                FormatEquations = true,
                MaxOutputCount = 20,
            },
            Plot = new PlotSettings
            {
                IsAdaptive = true,
                ScreenScaleFactor = 2.0,
                VectorGraphics = false,
                ColorScale = PlotSettings.ColorScales.Rainbow,
                Shadows = true,
                LightDirection = PlotSettings.LightDirections.NorthWest,
            }
        };

        var macroParser = new MacroParser();
        var hasMacroErrors = macroParser.Parse(content, out var unwrapped, null, 0, true);

        string htmlResult;
        if (hasMacroErrors)
        {
            htmlResult = "<p style='color:red;'>Macro parse error</p>";
        }
        else
        {
            var parser = new ExpressionParser { Settings = settings };
            parser.Parse(unwrapped, true, false);
            htmlResult = parser.HtmlResult;
        }

        var fullHtml = htmlTemplate + htmlResult + " </body></html>";
        htmlCache[key] = fullHtml;
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.WriteAsync(fullHtml);
    }
    catch (Exception ex)
    {
        ctx.Response.StatusCode = 500;
        await ctx.Response.WriteAsync($"Parse error: {ex.Message}");
    }
});

app.MapGet("/", async (HttpContext ctx) =>
{
    var indexPath = Path.Combine(publicDir, "index.html");
    if (File.Exists(indexPath))
    {
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.SendFileAsync(indexPath);
    }
    else
    {
        ctx.Response.StatusCode = 404;
        await ctx.Response.WriteAsync("index.html not found");
    }
});

// Pre-warm cache for heavy examples on startup
_ = Task.Run(() =>
{
    var examplesDir = Path.Combine(publicDir, "examples");
    if (!Directory.Exists(examplesDir)) return;

    foreach (var cpd in Directory.EnumerateFiles(examplesDir, "*.cpd", SearchOption.AllDirectories))
    {
        try
        {
            var src = File.ReadAllText(cpd);
            var k = CacheKey(src, 4, 0, false);
            if (htmlCache.ContainsKey(k)) continue;

            var settings = new Settings
            {
                Units = "m",
                Math = new MathSettings { Decimals = 4, Degrees = 0, IsComplex = false, Substitute = true, FormatEquations = true, MaxOutputCount = 20 },
                Plot = new PlotSettings { IsAdaptive = true, ScreenScaleFactor = 2.0, VectorGraphics = false, ColorScale = PlotSettings.ColorScales.Rainbow, Shadows = true, LightDirection = PlotSettings.LightDirections.NorthWest }
            };
            var mp = new MacroParser();
            var hasErr = mp.Parse(src, out var unwrapped, null, 0, true);
            string html;
            if (hasErr) { html = "<p style='color:red;'>Macro parse error</p>"; }
            else { var p = new ExpressionParser { Settings = settings }; p.Parse(unwrapped, true, false); html = p.HtmlResult; }
            htmlCache[k] = htmlTemplate + html + " </body></html>";
            Console.WriteLine($"[cache] pre-warmed: {Path.GetFileName(cpd)}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[cache] skip {Path.GetFileName(cpd)}: {ex.Message}");
        }
    }
    Console.WriteLine($"[cache] done — {htmlCache.Count} entries");
});

app.Run("http://localhost:4800");
