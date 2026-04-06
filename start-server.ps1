$nodeBin = "C:\Users\adylee\.workbuddy\binaries\node\versions\20.18.0.installing.16224.__extract_temp__\node-v20.18.0-win-x64"
$projectDir = "C:\Users\adylee\WorkBuddy\20260406101012\digital-transform-system"

# 启动服务器
$proc = Start-Process -FilePath "$nodeBin\node.exe" -ArgumentList "server.js" -WorkingDirectory $projectDir -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

# 测试
try {
    $status = (Invoke-WebRequest -Uri "http://localhost:8899" -TimeoutSec 5 -UseBasicParsing).StatusCode
    Write-Host "Server status: $status"
} catch {
    Write-Host "Server error: $_"
}

$proc
