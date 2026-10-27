# Builds without changing the user's permanent Java, Android SDK, or PATH settings.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskOriginalEnvironment = @{}
foreach ($taskEnvironmentName in @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'JAVA_TOOL_OPTIONS')) {
    $taskOriginalEnvironment[$taskEnvironmentName] = [Environment]::GetEnvironmentVariable($taskEnvironmentName, 'Process')
}
$taskExitCode = 0
$taskLocationPushed = $false

function Get-TaskJavaMajor {
    param([string]$TaskJavaHome)
    if (-not $TaskJavaHome) { return $null }
    $taskJavaExecutable = Join-Path $TaskJavaHome 'bin\java.exe'
    if (-not (Test-Path -LiteralPath $taskJavaExecutable -PathType Leaf)) { return $null }

    # Java writes its version to stderr. Do not treat a valid version line as a
    # terminating NativeCommandError on Windows PowerShell 5.1.
    $taskSavedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $taskVersionText = (& $taskJavaExecutable -version 2>&1 | Out-String)
        $taskProbeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $taskSavedPreference
    }
    if ($taskProbeExitCode -eq 0 -and $taskVersionText -match 'version "(?<major>\d+)(?:[.\-+"])') {
        return [int]$Matches['major']
    }
    return $null
}

function Invoke-TaskBuildCommand {
    param([string]$TaskCommand, [string[]]$TaskArguments)
    & $TaskCommand @TaskArguments
    if ($LASTEXITCODE -ne 0) {
        throw "$TaskCommand failed with exit code $LASTEXITCODE."
    }
}

try {
    $taskJavaCandidates = @($env:JAVA_HOME)
    if ($env:LOCALAPPDATA) {
        $taskToolCache = Join-Path $env:LOCALAPPDATA 'WingsOnHair\tools'
        if (Test-Path -LiteralPath $taskToolCache -PathType Container) {
            $taskJavaCandidates += @(Get-ChildItem -LiteralPath $taskToolCache -Directory -Filter 'jdk-21*' |
                Sort-Object LastWriteTime -Descending | ForEach-Object { $_.FullName })
        }
    }
    $taskJavaHome = $null
    foreach ($taskCandidate in ($taskJavaCandidates | Where-Object { $_ } | Select-Object -Unique)) {
        if ((Get-TaskJavaMajor $taskCandidate) -eq 21) {
            $taskJavaHome = $taskCandidate
            break
        }
    }
    if (-not $taskJavaHome) {
        throw 'JDK 21 is required. Set JAVA_HOME to a JDK 21 installation, or place an installed JDK 21 in %LOCALAPPDATA%\WingsOnHair\tools\jdk-21*. This script does not download toolchains.'
    }

    $taskSdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)
    if ($env:LOCALAPPDATA) { $taskSdkCandidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk') }
    $taskAndroidSdk = $null
    foreach ($taskCandidate in ($taskSdkCandidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-Path -LiteralPath (Join-Path $taskCandidate 'platforms\android-36\android.jar') -PathType Leaf) {
            $taskAndroidSdk = $taskCandidate
            break
        }
    }
    if (-not $taskAndroidSdk) {
        throw 'Android SDK Platform 36 was not found. Install it in Android Studio SDK Manager, then set ANDROID_HOME to that SDK directory if it is not in %LOCALAPPDATA%\Android\Sdk.'
    }

    $taskSocketDirectory = if ($env:WOH_JAVA_SOCKET_DIR) { $env:WOH_JAVA_SOCKET_DIR } else {
        Join-Path $taskProjectRoot 'android\.gradle\java-tmp'
    }
    if (-not [IO.Path]::IsPathRooted($taskSocketDirectory)) {
        throw 'WOH_JAVA_SOCKET_DIR must be an absolute directory path.'
    }
    $taskSocketDirectory = [IO.Path]::GetFullPath($taskSocketDirectory)
    if ($taskSocketDirectory.Length -gt 70) {
        throw 'The project path is too long for Java socket files. Set WOH_JAVA_SOCKET_DIR to a short, writable directory path, or move the project to a shorter path.'
    }
    New-Item -ItemType Directory -Force -Path $taskSocketDirectory | Out-Null

    $env:JAVA_HOME = $taskJavaHome
    $env:ANDROID_HOME = $taskAndroidSdk
    $env:ANDROID_SDK_ROOT = $taskAndroidSdk
    $taskSocketOption = '-Djdk.net.unixdomain.tmpdir="' + $taskSocketDirectory + '"'
    $env:JAVA_TOOL_OPTIONS = (@($taskOriginalEnvironment['JAVA_TOOL_OPTIONS'], $taskSocketOption) |
        Where-Object { $_ }) -join ' '

    Write-Host "Using JDK 21: $taskJavaHome"
    Write-Host "Using Android SDK: $taskAndroidSdk"
    Push-Location $taskProjectRoot
    $taskLocationPushed = $true
    Invoke-TaskBuildCommand 'npm.cmd' @('run', 'build')
    Invoke-TaskBuildCommand 'npx.cmd' @('cap', 'sync', 'android')
    Invoke-TaskBuildCommand (Join-Path $taskProjectRoot 'android\gradlew.bat') @(
        '-p', (Join-Path $taskProjectRoot 'android'), 'assembleDebug', '--no-daemon', '--console=plain'
    )
    $taskApkPath = Join-Path $taskProjectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $taskApkPath -PathType Leaf)) {
        throw 'Gradle completed without producing the expected debug APK.'
    }
    Write-Host "Debug APK ready: $taskApkPath"
} catch {
    $taskExitCode = 1
    Write-Error $_ -ErrorAction Continue
} finally {
    if ($taskLocationPushed) { Pop-Location }
    foreach ($taskEnvironmentName in $taskOriginalEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($taskEnvironmentName, $taskOriginalEnvironment[$taskEnvironmentName], 'Process')
    }
}
exit $taskExitCode
