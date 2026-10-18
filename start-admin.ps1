$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$port = 4001
while ($true) {
  $probe = $null
  try {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $probe.Start()
    $probe.Stop()
    break
  } catch {
    if ($probe) { try { $probe.Stop() } catch {} }
    $port++
  }
}

Write-Host ("Starting StrayCat admin on port {0}..." -f $port)
$env:PORT = [string]$port
$node = Start-Process -FilePath 'node.exe' -ArgumentList 'admin.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru

for ($i = 0; $i -lt 60; $i++) {
  if ($node.HasExited) {
    throw "Admin process exited early with code $($node.ExitCode)."
  }
  $client = $null
  try {
    $client = [System.Net.Sockets.TcpClient]::new('127.0.0.1', $port)
    $client.Close()
    Start-Process ("http://localhost:{0}" -f $port)
    Write-Host ("Admin is ready: http://localhost:{0}" -f $port)
    exit 0
  } catch {
    if ($client) { try { $client.Close() } catch {} }
    Start-Sleep -Milliseconds 250
  }
}

throw 'Admin startup timed out. Check Node.js and port availability.'
