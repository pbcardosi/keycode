using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// Minimal launcher for the Windows portable build. It starts the bundled
// node.exe on the bundled CLI, forwards arguments, and returns the CLI exit
// code. stdin/stdout/stderr are inherited so the TUI and prompts work.
internal static class Program
{
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "node.exe");
        string entry = Path.Combine(root, "app", "node_modules", "keycode-ai", "dist", "cli", "index.js");

        if (!File.Exists(node) || !File.Exists(entry))
        {
            Console.Error.WriteLine("KeyCode installation is incomplete (missing node.exe or app files).");
            return 1;
        }

        var start = new ProcessStartInfo(node)
        {
            UseShellExecute = false,
            WorkingDirectory = Environment.CurrentDirectory,
            Arguments = Quote(entry) + Join(args),
        };

        try
        {
            using (Process process = Process.Start(start))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("KeyCode launcher failed: " + error.Message);
            return 1;
        }
    }

    private static string Join(string[] args)
    {
        if (args.Length == 0) return string.Empty;
        var builder = new StringBuilder();
        foreach (string arg in args)
        {
            builder.Append(' ');
            builder.Append(Quote(arg));
        }
        return builder.ToString();
    }

    // Follows the CommandLineToArgvW quoting rules used by the C runtime.
    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return value;
        }

        var builder = new StringBuilder();
        builder.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                builder.Append('\\', backslashes * 2 + 1);
                builder.Append('"');
                backslashes = 0;
                continue;
            }
            builder.Append('\\', backslashes);
            backslashes = 0;
            builder.Append(character);
        }
        builder.Append('\\', backslashes * 2);
        builder.Append('"');
        return builder.ToString();
    }
}
