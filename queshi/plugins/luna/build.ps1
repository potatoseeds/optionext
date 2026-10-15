# Luna plugin build: wasm + dict pack + base64 assets
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
python build.py
