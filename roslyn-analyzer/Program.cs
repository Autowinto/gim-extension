using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.MSBuild;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

if (!MSBuildLocator.IsRegistered)
    MSBuildLocator.RegisterDefaults();

if (args.Length > 0 && args[0].ToLower() == "server")
{
    var listener = new HttpListener();
    listener.Prefixes.Add("http://127.0.0.1:8080/");
    listener.Start();
    Console.WriteLine("Listening for requests on http://127.0.0.1:8080/...");

    var cts = new CancellationTokenSource();
    var listenTask = Task.Run(() => ListenForRequests(listener, cts.Token));

    await listenTask;
}
else
{
    // If not server, we just do normal one-time roslyn analysis
    if (args.Length == 0)
    {
        Console.WriteLine("Usage: Analyzer <path-to-(dir|.sln|.csproj)> or Analyzer server");
        return;
    }

    var targetPath = ResolveTargetPath(args[0]);
    if (targetPath is null)
    {
        Console.Error.WriteLine($"Could not find any .sln or .csproj under '{args[0]}'.");
        return;
    }

    var results = await RunAnalysisAsync(targetPath);

    // Write to a file (pretty-printed)
    var outputPath = Path.GetFullPath("analysis-output.json");

    var options = new JsonSerializerOptions
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(results, options));

    Console.WriteLine($"Analysis complete! Output written to: {outputPath}");
}

// Listener for the server
static async Task ListenForRequests(HttpListener listener, CancellationToken cancellationToken)
{
    while (!cancellationToken.IsCancellationRequested)
    {
        try
        {
            var context = await listener.GetContextAsync();
            Console.WriteLine($"Received a request for: {context.Request.Url!.AbsolutePath}");
            await ProcessRequestAsync(context);
        }
        catch (HttpListenerException)
        {
            break;
        }
        catch (TaskCanceledException)
        {
            break;
        }
    }
}

static async Task ProcessRequestAsync(HttpListenerContext context)
{
    var response = context.Response;
    response.ContentType = "application/json";
    try
    {
        if (context.Request.HttpMethod == "POST" && context.Request.Url!.AbsolutePath == "/update-codebase-indexes")
        {
            using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding);
            var body = await reader.ReadToEndAsync();
            var payload = JsonSerializer.Deserialize<Dictionary<string, string>>(body);

            Console.WriteLine("Processing update-codebase-indexes request...");
            // if payload does not exist, we return 400
            if (payload == null || !payload.TryGetValue("projectPath", out var targetPath))
            {
                response.StatusCode = (int)HttpStatusCode.BadRequest;
                var errorJson = JsonSerializer.Serialize(new { error = "Missing 'projectPath' in request body." });
                var errorBuffer = Encoding.UTF8.GetBytes(errorJson);
                Console.WriteLine("Error: Missing 'projectPath' in request body.");
                response.ContentLength64 = errorBuffer.Length;
                await response.OutputStream.WriteAsync(errorBuffer, 0, errorBuffer.Length);
                return;
            }

            // Determines if we can find the project or not
            var resolvedPath = ResolveTargetPath(targetPath);
            if (resolvedPath is null)
            {
                response.StatusCode = (int)HttpStatusCode.NotFound;
                var errorJson = JsonSerializer.Serialize(new { error = $"Could not find .sln or .csproj at '{targetPath}'." });
                var errorBuffer = Encoding.UTF8.GetBytes(errorJson);
                response.ContentLength64 = errorBuffer.Length;
                await response.OutputStream.WriteAsync(errorBuffer, 0, errorBuffer.Length);
                return;
            }

            // Run the analysis and return the results -> this is where we might want to save it to a DB instead
            var analysisResults = await RunAnalysisAsync(resolvedPath);
            var options = new JsonSerializerOptions
            {
                WriteIndented = true,
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
            };
            // Save analysis results to file
            var timestamp = DateTime.Now.ToString("yyyyMMddHHmmss");
            var outputFilename = $"analysis-{timestamp}.json";
            var outputPath = Path.GetFullPath(outputFilename);
            
            await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(analysisResults, options));

            // Send request to sql server on 1270.0.0.1:8000
            using var httpClient = new HttpClient();
            var sqlServerContent = new StringContent(JsonSerializer.Serialize(analysisResults, options), Encoding.UTF8, "application/json");
            try
            {
                var sqlServerRequest = new HttpRequestMessage(HttpMethod.Post, "http://127.0.0.1:8000/update-indexes")
                {
                    Content = sqlServerContent
                };
                var sqlServerResponse = await httpClient.SendAsync(sqlServerRequest);
                if (!sqlServerResponse.IsSuccessStatusCode)
                {
                    Console.WriteLine($"Warning: SQL server responded with status code {sqlServerResponse.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Warning: Could not connect to SQL server: {ex.Message}");
            }
            // Send success response
            var successResponse = JsonSerializer.Serialize(new { 
                success = true, 
                message = $"Analysis complete! Output saved to {outputFilename}",
                filePath = outputPath 
            });
            var buffer = Encoding.UTF8.GetBytes("ok");
            response.ContentLength64 = buffer.Length;
            await response.OutputStream.WriteAsync(buffer, 0, buffer.Length);
        }
        else
        {
            response.StatusCode = (int)HttpStatusCode.NotFound;
            var errorJson = JsonSerializer.Serialize(new { error = "Invalid route or method. Use POST on /update-codebase-indexes." });
            var errorBuffer = Encoding.UTF8.GetBytes(errorJson);
            response.ContentLength64 = errorBuffer.Length;
            await response.OutputStream.WriteAsync(errorBuffer, 0, errorBuffer.Length);
        }
    }
    catch (Exception ex)
    {
        response.StatusCode = (int)HttpStatusCode.InternalServerError;
        var errorJson = JsonSerializer.Serialize(new { error = ex.Message });
        var errorBuffer = Encoding.UTF8.GetBytes(errorJson);
        response.ContentLength64 = errorBuffer.Length;
        await response.OutputStream.WriteAsync(errorBuffer, 0, errorBuffer.Length);
        Console.WriteLine(ex);
    }
    finally
    {
        response.Close();
    }
}

static async Task<List<object>> RunAnalysisAsync(string targetPath)
{
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

            results.Add(new
            {
                Project = project.Name,
                Document = doc.FilePath,
                Classes = walker.Classes,
                Methods = walker.Methods.Select(m => new { 
                    Signature = m.signature, 
                    Body = m.body,
                    StartLine = m.startLine,
                    EndLine = m.endLine
                }),
                Calls = walker.Calls.Select(c => new { Caller = c.caller, Callee = c.callee })
            });
        }
    }
    return results;
}

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


class ApiWalker : CSharpSyntaxWalker
{
    private readonly SemanticModel _model;

    public List<string> Classes { get; } = new();
    public List<(string signature, string body, int startLine, int endLine)> Methods { get; } = new();
    public List<(string caller, string callee)> Calls { get; } = new();

    private string? _currentMethod;

    // 👇 Custom format: include return type, parameter names, and containing type
    private static readonly SymbolDisplayFormat SignatureFormat = new SymbolDisplayFormat(
        memberOptions:
            SymbolDisplayMemberOptions.IncludeParameters |
            SymbolDisplayMemberOptions.IncludeContainingType |
            SymbolDisplayMemberOptions.IncludeType,
        parameterOptions:
            SymbolDisplayParameterOptions.IncludeType |
            SymbolDisplayParameterOptions.IncludeName,
        genericsOptions:
            SymbolDisplayGenericsOptions.IncludeTypeParameters,
        miscellaneousOptions:
            SymbolDisplayMiscellaneousOptions.UseSpecialTypes
    );

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
        _currentMethod = sym?.ToDisplayString(SignatureFormat); // 👈 use our new format

        if (_currentMethod != null)
        {
            string body = "";
            if (node.Body != null)
                body = node.Body.NormalizeWhitespace().ToFullString();
            else if (node.ExpressionBody != null)
                body = node.ExpressionBody.NormalizeWhitespace().ToFullString();
            
            var startLine = node.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
            var endLine = node.GetLocation().GetLineSpan().EndLinePosition.Line + 1;
            body = body.Replace("\r\n", "\n");
            Methods.Add((_currentMethod, body, startLine, endLine));
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
