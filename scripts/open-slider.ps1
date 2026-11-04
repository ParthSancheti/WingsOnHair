$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskPython = (& python -c 'import sys; print(sys.executable)').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Python is required to open the USB slider.' }
$taskPythonWindow = Join-Path (Split-Path -Parent $taskPython) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $taskPythonWindow)) { $taskPythonWindow = $taskPython }
Start-Process -FilePath $taskPythonWindow -ArgumentList @((Join-Path $PSScriptRoot 'servo-slider.py')) -WorkingDirectory $taskProjectRoot
