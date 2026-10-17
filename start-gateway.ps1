# Starts the QU32 gateway on Windows. Requires Node.js 20+ and OpenSSL (bundled with Git for Windows).
# Optional: $env:QU32_MIXER_IP = "192.168.1.100" ; $env:QU32_LAN_IP = "192.168.1.50"
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20+ is required: https://nodejs.org" }

if (-not $env:QU32_OPENSSL) {
  $candidates = @(
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files\Git\mingw64\bin\openssl.exe",
    "C:\Program Files (x86)\Git\usr\bin\openssl.exe"
  )
  $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($found) { $env:QU32_OPENSSL = $found }
  elseif (-not (Get-Command openssl -ErrorAction SilentlyContinue)) { throw "OpenSSL not found. Install Git for Windows or set QU32_OPENSSL." }
}

if (-not (Test-Path "gateway\dist\main.js")) { throw "gateway\dist\main.js missing. Run: npm install ; npm run build" }
node gateway\dist\main.js
