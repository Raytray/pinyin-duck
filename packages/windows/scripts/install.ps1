<#
.SYNOPSIS
  Installs the PinyinDuck Rime schemas into the Weasel user folder.

.DESCRIPTION
  Copies the two schemas, the default.yaml patch and the generated dictionaries into
  %APPDATA%\Rime, then makes Weasel rebuild them. Everything is copied from this
  repository's packages\windows\rime folder, so run `npm run build:rime` first: the
  dictionaries are generated from the shared CC-CEDICT asset and are not committed.

  Weasel recompiles a dictionary whenever the .dict.yaml file changes, so reinstalling
  after a rebuild is just this script again.

.PARAMETER Deploy
  Try to run Rime's command line deployer if the installed Weasel ships one. Older
  builds do, newer ones drive deployment from the tray menu, so this is best-effort and
  the script always prints the manual step as well.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packages\windows\scripts\install.ps1
#>
[CmdletBinding()]
param(
  [switch]$Deploy
)

$ErrorActionPreference = 'Stop'

$SourceDir = Join-Path $PSScriptRoot '..\rime'
$RimeDir = Join-Path $env:APPDATA 'Rime'

# Both dictionaries and both schemas have to be present together: a schema naming a
# dictionary that is missing fails to compile, and Weasel then silently falls back to
# its own default scheme, which looks like the install did nothing.
$RequiredFiles = @(
  'pinyinduck.schema.yaml',
  'pinyinduck_trad.schema.yaml',
  'default.custom.yaml',
  'pinyinduck.dict.yaml',
  'pinyinduck_trad.dict.yaml'
)

function Format-Size([long]$Bytes) {
  '{0:N1} MB' -f ($Bytes / 1MB)
}

Write-Host 'PinyinDuck -> Rime (Weasel)' -ForegroundColor Cyan
Write-Host ''

$missing = @()
foreach ($name in $RequiredFiles) {
  if (-not (Test-Path (Join-Path $SourceDir $name))) { $missing += $name }
}

if ($missing.Count -gt 0) {
  # The dictionaries are the only generated files, so this is almost always the cause.
  $dictMissing = $missing | Where-Object { $_ -like '*.dict.yaml' }
  if ($dictMissing.Count -gt 0) {
    Write-Error @"
The generated dictionaries are missing from $SourceDir.

Run this from the repository root first:

    npm run build:dict
    npm run build:rime
"@
  }
  Write-Error "Missing file(s): $($missing -join ', ')"
}

Write-Host "  source  $SourceDir"
Write-Host "  target  $RimeDir"
Write-Host ''

if (-not (Test-Path $RimeDir)) {
  New-Item -ItemType Directory -Path $RimeDir -Force | Out-Null
  Write-Host '  created the Rime user folder (Weasel may not be installed yet)'
}

foreach ($name in $RequiredFiles) {
  $source = Join-Path $SourceDir $name
  Copy-Item -Path $source -Destination (Join-Path $RimeDir $name) -Force
  $size = Format-Size (Get-Item $source).Length
  Write-Host ("  copied  {0,-28} {1,10}" -f $name, $size)
}

# Rime keeps compiled output in a build subfolder. Its checksums would otherwise make
# Weasel reuse a stale table if a dictionary were regenerated with the same name.
$buildDir = Join-Path $RimeDir 'build'
if (Test-Path $buildDir) {
  Write-Host '  cleared the previous build so the dictionaries are recompiled'
  Remove-Item -Path $buildDir -Recurse -Force
}

Write-Host ''

$deployed = $false
if ($Deploy) {
  $deployers = @(
    (Join-Path $env:ProgramFiles 'Rime\rime_deployer.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Rime\rime_deployer.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Rime\rime_deployer.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($deployer in $deployers) {
    Write-Host "  deploying with $deployer"
    & $deployer --build pinyinduck --build pinyinduck_trad deploy | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $deployed = $true
      break
    }
  }
}

Write-Host 'Installed.' -ForegroundColor Green
Write-Host ''
if (-not $deployed) {
  Write-Host 'Make Weasel rebuild the dictionaries:' -ForegroundColor Yellow
  Write-Host '  Right-click the Weasel tray icon -> 用户资料 -> 重新部署'
  Write-Host '  (User data -> Deploy)'
}
Write-Host ''
Write-Host 'Then add it to Windows:'
Write-Host '  1. Settings -> Time & language -> Language & region'
Write-Host '  2. Add a language -> 中文(中国) -> 拼音Duck is a Rime scheme, so it appears'
Write-Host '     under the Rime input once Weasel has been installed and deployed'
Write-Host '  3. Switch to it with Win+Space, and between the simplified and traditional'
Write-Host '     schemes with F4 or Ctrl+`'
Write-Host ''
Write-Host 'The first deploy compiles 122k rows and takes a few seconds. The second'
Write-Host 'scheme switch is instant.'
