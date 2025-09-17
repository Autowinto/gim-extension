using System.Text.Json;
using System.Text.Encodings.Web;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.MSBuild;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

if (args.Length == 0)
{
    Console.WriteLine("Usage: Analyzer <path-to-(dir|.sln|.csproj)>");
    return;
}

var targetPath = ResolveTargetPath(args[0]);
if (targetPath is null)
{
    Console.Error.WriteLine($"Could not find any .sln or .csproj under '{args[0]}'.");
    return;
}

if (!MSBuildLocator.IsRegistered)
    MSBuildLocator.RegisterDefaults();

using var workspace = MSBuildWorkspace.Create();
workspace.WorkspaceFailed += (_, e) => Console.Error.WriteLine($"[Workspace] {e.Diagnostic}");

Solution solution = targetPath.EndsWith(".sln", StringComparison.OrdinalIgnoreCase)
    ? await workspace.OpenSolutionAsync(targetPath)
    : (await workspace.OpenProjectAsync(targetPath)).Solution;

var results = new List<object>();

foreach (var project in solution.Projects)
{
    if (project.Language != LanguageNames.CSharp) continue;

    var compilation = await project.GetCompilationAsync();
    foreach (var doc in project.Documents)
    {
        if (doc.FilePath is null || doc.FilePath.Contains("/obj/")) continue;

        var tree = await doc.GetSyntaxTreeAsync();
        if (tree is null) continue;

        var model = compilation!.GetSemanticModel(tree);
        var root = await tree.GetRootAsync();

        var walker = new ApiWalker(model);
        walker.Visit(root);

        results.Add(new {
            Project = project.Name,
            Document = doc.FilePath,
            Classes = walker.Classes,
            Methods = walker.Methods.Select(m => new { Signature = m.signature, Body = m.body }),
            Calls = walker.Calls.Select(c => new { Caller = c.caller, Callee = c.callee })
        });
    }
}

// Write to a file (pretty-printed)
var outputPath = Path.GetFullPath("analysis-output.json");

var options = new JsonSerializerOptions
{
    WriteIndented = true,
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
};

await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(results, options));

Console.WriteLine($"Analysis complete! Output written to: {outputPath}");


// ---- Helper: Resolve target path ----
static string? ResolveTargetPath(string input)
{
    var path = Path.GetFullPath(input);
    if (File.Exists(path))
        return path;

    if (Directory.Exists(path))
    {
        var sln = Directory.EnumerateFiles(path, "*.sln", SearchOption.AllDirectories).FirstOrDefault();
        if (sln is not null) return sln;
        var proj = Directory.EnumerateFiles(path, "*.csproj", SearchOption.AllDirectories).FirstOrDefault();
        if (proj is not null) return proj;
    }

    return null;
}


// ---- Syntax Walker ----
class ApiWalker : CSharpSyntaxWalker
{
    private readonly SemanticModel _model;

    public List<string> Classes { get; } = new();
    public List<(string signature, string body)> Methods { get; } = new();
    public List<(string caller, string callee)> Calls { get; } = new();

    private string? _currentMethod;

    public ApiWalker(SemanticModel model) : base(SyntaxWalkerDepth.Token) => _model = model;

    public override void VisitClassDeclaration(ClassDeclarationSyntax node)
    {
        var sym = _model.GetDeclaredSymbol(node);
        if (sym != null) Classes.Add(sym.ToDisplayString());
        base.VisitClassDeclaration(node);
    }

    public override void VisitMethodDeclaration(MethodDeclarationSyntax node)
    {
        var sym = _model.GetDeclaredSymbol(node);
        _currentMethod = sym?.ToDisplayString();

        if (_currentMethod != null)
        {
            string body = "";
            if (node.Body != null)
                body = node.Body.NormalizeWhitespace().ToFullString();
            else if (node.ExpressionBody != null)
                body = node.ExpressionBody.NormalizeWhitespace().ToFullString();
                body = body.Replace("\r\n", "\n");

            Methods.Add((_currentMethod, body));
        }

        base.VisitMethodDeclaration(node);
        _currentMethod = null;
    }

    public override void VisitInvocationExpression(InvocationExpressionSyntax node)
    {
        var target = _model.GetSymbolInfo(node).Symbol as IMethodSymbol;
        if (_currentMethod != null && target != null)
        {
            Calls.Add((_currentMethod, $"{target.ContainingType.ToDisplayString()}.{target.Name}"));
        }
        base.VisitInvocationExpression(node);
    }
}

