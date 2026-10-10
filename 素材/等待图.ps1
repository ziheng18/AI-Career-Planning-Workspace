# 等待 ComfyUI 完成指定的 prompt，并报告结果
# 用法: pwsh -File 素材/等待图.ps1 -Id <prompt_id> [-TimeoutSec 300]
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [int]$TimeoutSec = 300
)

$Comfy = "http://127.0.0.1:8188"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$lastMsg = ""

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 4
  try {
    $h = Invoke-RestMethod -Uri "$Comfy/history/$Id" -TimeoutSec 15
  } catch {
    Write-Output "查询失败，重试: $($_.Exception.Message)"
    continue
  }
  if ($h.PSObject.Properties.Name -notcontains $Id) {
    # 还没进 history：看队列状态，便于判断是否在跑
    if (-not $lastMsg) { Write-Output "等待中（尚未完成）…" ; $lastMsg = "1" }
    continue
  }

  $entry = $h.$Id
  $st = $entry.status
  if ($st.completed) {
    Write-Output "完成：$Id"
    $found = $false
    $entry.outputs.PSObject.Properties | ForEach-Object {
      $_.Value.images | ForEach-Object {
        $found = $true
        $sub = if ($_.subfolder) { $_.subfolder } else { "" }
        Write-Output ("输出文件: " + (Join-Path (Join-Path "E:\AI\ComfyUI\output" $sub) $_.filename))
      }
    }
    if (-not $found) { Write-Output "完成但无图像输出（可能是缓存命中）" }
    exit 0
  }

  if ($st.status_str -eq "error") {
    Write-Output "执行失败：$Id"
    $st.messages | Where-Object { $_[0] -eq "execution_error" } | ForEach-Object {
      $e = $_[1]
      Write-Output ("  节点 " + $e.node_id + " (" + $e.node_type + ")")
      Write-Output ("  " + $e.exception_type + ": " + $e.exception_message)
    }
    exit 1
  }
}

Write-Output "超时（$TimeoutSec 秒）仍未完成：$Id"
exit 2
