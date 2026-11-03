$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputDirectory = Join-Path $repository 'releases'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$outputPath = Join-Path $outputDirectory 'WingsOnHair-v2.6-source.zip'

# Explicit allowlist: no local SDK paths, signing keys, dependencies, or build caches.
$rootFiles = @('.gitignore', '.gitattributes', 'LICENSE', 'app.js', 'capacitor.config.json', 'index.html', 'package.json', 'package-lock.json', 'playwright.config.js', 'README.md', 'style.css', 'vite.config.js')
$paths = [System.Collections.Generic.List[string]]::new()
foreach ($relative in $rootFiles) {
    $paths.Add((Join-Path $repository $relative))
}
foreach ($directory in @('src', 'public', 'docs', 'tests', 'scripts', '.github', 'firmware/WingsOnHair_Firmware')) {
    Get-ChildItem -LiteralPath (Join-Path $repository $directory) -File -Recurse -Force | ForEach-Object {
        $sourceRelative = [System.IO.Path]::GetRelativePath($repository, $_.FullName).Replace('\', '/')
        if ($sourceRelative -eq 'docs/CALIBRATION.md') { return }
        if ($sourceRelative -notmatch '(^|/)(build|\.tooling|node_modules)/') { $paths.Add($_.FullName) }
    }
}
foreach ($relative in @('firmware/README.md', 'firmware/.gitignore')) { $paths.Add((Join-Path $repository $relative)) }
Get-ChildItem -LiteralPath (Join-Path $repository 'android') -File -Recurse -Force | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($repository, $_.FullName).Replace('\', '/')
    if ($relative -match '(^|/)(build|\.gradle|\.idea|capacitor-cordova-android-plugins)/') { return }
    if ($relative -match '^android/app/src/main/assets/(public/|capacitor\.(config|plugins)\.json$)') { return }
    if ($relative -eq 'android/local.properties' -or $relative -eq 'android/app/src/main/res/xml/config.xml') { return }
    if ($relative -match '\.(jks|keystore|log)$') { return }
    $paths.Add($_.FullName)
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($outputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
$archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($path in ($paths | Sort-Object -Unique)) {
        $relative = [System.IO.Path]::GetRelativePath($repository, $path).Replace('\', '/')
        if ($relative.StartsWith('..')) { throw "Source file escaped project directory: $relative" }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $path, "WingsOnHair/$relative", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose(); $stream.Dispose() }

$verify = [System.IO.Compression.ZipFile]::OpenRead($outputPath)
try {
    foreach ($required in @('package.json', 'app.js', 'android/gradle/wrapper/gradle-wrapper.jar', 'firmware/WingsOnHair_Firmware/WingsOnHair_Firmware.ino')) {
        if (-not $verify.GetEntry("WingsOnHair/$required")) { throw "Archive is missing $required" }
    }
    Write-Output "Source package verified: $($verify.Entries.Count) files."
} finally { $verify.Dispose() }
Get-Item -LiteralPath $outputPath | Select-Object FullName, Length
Get-FileHash -LiteralPath $outputPath -Algorithm SHA256 | Select-Object Hash
