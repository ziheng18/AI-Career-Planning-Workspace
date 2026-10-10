# 批量生成工作台所需视觉素材
# 全部为"无文字"图形：Qwen-Image-2.1 不会写字，文字一律交给 HTML。
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$gen  = Join-Path $here "生成图.ps1"
$wait = Join-Path $here "等待图.ps1"

$items = @(
  @{
    Name = "hero"
    W = 1024; H = 640
    Prompt = "abstract editorial vector illustration, wide banner, a flowing constellation of small connected nodes rising left to right like a growth path, soft teal and deep indigo palette on a very light neutral background, generous empty space on the left, faint geometric grid, calm professional academic mood, flat design, no text, no letters, no numbers, no people"
    Neg = "文字, 字母, 数字, 单词, 水印, 签名, 人物, 人脸, 照片写实, 杂乱, 深色背景, 边框"
  },
  @{
    Name = "radar-watermark"
    W = 1024; H = 1024
    Prompt = "extremely minimal abstract background texture, faint concentric polygons and thin radial lines radiating from the center, very light pale teal lines on an almost white background, delicate and unobtrusive, like a faint blueprint watermark, flat vector, high key, no text, no letters, no numbers"
    Neg = "文字, 字母, 数字, 水印文字, 签名, 人物, 照片写实, 深色, 高对比, 粗线条"
  },
  @{
    Name = "cover"
    W = 1024; H = 1024
    Prompt = "abstract editorial cover artwork, clean geometric composition of layered translucent shapes and a subtle rising staircase motif, teal and indigo with soft warm accent, lots of clean negative space, flat vector design, professional academic report cover, light background, no text, no letters, no numbers, no people"
    Neg = "文字, 字母, 数字, 单词, 水印, 签名, 人物, 照片写实, 杂乱, 深色"
  }
)

foreach ($it in $items) {
  Write-Output "=== 生成 $($it.Name) ($($it.W)x$($it.H)) ==="
  $out = & pwsh -File $gen -Name $it.Name -Prompt $it.Prompt -Negative $it.Neg -Width $it.W -Height $it.H 2>&1
  $out | ForEach-Object { $_ }
  $id = ($out | Where-Object { $_ -match '^[0-9a-f]{8}-' } | Select-Object -Last 1)
  if (-not $id) { Write-Output "!! 未取到 prompt_id，跳过"; continue }
  & pwsh -File $wait -Id $id -TimeoutSec 600 2>&1 | ForEach-Object { $_ }
  Write-Output ""
}

Write-Output "全部完成"
