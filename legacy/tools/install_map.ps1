# Converts a map exported by BAR Map Maker (.sdz zip) into a .sd7 (7-Zip, LZMA2, non-solid,
# the format BAR's own maps use) and installs it into the BAR maps folder.
# Uses the 7-Zip that ships with the BAR launcher.
param([Parameter(Mandatory = $true)][string]$MapFile)

$ErrorActionPreference = 'Stop'
$bar = Join-Path $env:LOCALAPPDATA 'Programs\Beyond-All-Reason'
$sevenZip = Join-Path $bar 'resources\app.asar.unpacked\node_modules\7zip-bin\win\x64\7za.exe'
$maps = Join-Path $bar 'data\maps'
if (-not (Test-Path $sevenZip)) { throw "BAR's 7-Zip not found at $sevenZip - is BAR installed somewhere else?" }

$src = Get-Item $MapFile
$work = Join-Path ([IO.Path]::GetTempPath()) ('barmap_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
try {
    & $sevenZip x -y "-o$work" $src.FullName | Out-Null
    if (-not (Test-Path (Join-Path $work 'mapinfo.lua'))) { throw 'Not a map archive (no mapinfo.lua).' }
    $name = $src.BaseName -replace '_(\d+)_(\d+)$', '_$1.$2'
    $out = Join-Path $src.DirectoryName ($name + '.sd7')
    if (Test-Path $out) { Remove-Item $out }
    Push-Location $work
    & $sevenZip a -t7z -m0=LZMA2 -mx=7 -ms=off $out * | Out-Null
    Pop-Location
    Write-Host "Created $out"
    if (Test-Path $maps) {
        Copy-Item $out $maps -Force
        Write-Host "Installed into $maps"
        Write-Host 'Restart BAR (or the lobby) to see the map.'
    } else {
        Write-Host "BAR maps folder not found ($maps) - copy the .sd7 there yourself."
    }
} finally {
    Remove-Item $work -Recurse -Force
}
