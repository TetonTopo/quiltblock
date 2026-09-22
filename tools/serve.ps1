<#
.SYNOPSIS
    Serve the QuiltBlock site locally with nothing installed.

.DESCRIPTION
    The app is plain ES modules, so it only needs a static file server - but ES
    modules will not load over file://, so you cannot just double-click
    index.html. This uses the HTTP listener built into Windows, so it works on a
    machine with no Node, no Python and no build step.

    If you do have Node, `npx serve .` from the repo root does the same job.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8100
#>
param(
    [int]$Port = 8099,
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
    '.woff2' = 'font/woff2'
    '.md'   = 'text/markdown; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "QuiltBlock serving $Root"
Write-Host "  http://localhost:$Port/"
Write-Host "  Ctrl+C to stop."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $rel = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

        $full = Join-Path $Root $rel
        # Never serve anything outside the repo, whatever the URL asks for.
        $resolved = $null
        try { $resolved = (Resolve-Path -LiteralPath $full -ErrorAction Stop).Path } catch { }

        if ($resolved -and $resolved.StartsWith($Root) -and (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
            $type = $mime[$ext]
            if (-not $type) { $type = 'application/octet-stream' }
            $bytes = [System.IO.File]::ReadAllBytes($resolved)
            $context.Response.ContentType = $type
            $context.Response.Headers.Add('Cache-Control', 'no-store')
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        else {
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 - $rel")
            $context.Response.StatusCode = 404
            $context.Response.ContentType = 'text/plain; charset=utf-8'
            $context.Response.ContentLength64 = $body.Length
            $context.Response.OutputStream.Write($body, 0, $body.Length)
        }
        $context.Response.OutputStream.Close()
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
