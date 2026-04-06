$ErrorActionPreference = "Stop"
$nodeExe = "C:\Users\adylee\.workbuddy\binaries\node\versions\20.18.0.installing.16224.__extract_temp__\node-v20.18.0-win-x64\node.exe"
$projectDir = "C:\Users\adylee\WorkBuddy\20260406101012\digital-transform-system"

Write-Host "Node version: "
& $nodeExe --version

Write-Host "`nInstalling dependencies..."
& $nodeExe (Join-Path $projectDir "node_modules\npm\bin\npm-cli.js") install --prefix $projectDir

if (Test-Path (Join-Path $projectDir "node_modules\express")) {
    Write-Host "`n✅ 依赖安装成功!"
} else {
    Write-Host "`n❌ 依赖安装可能失败"
}
