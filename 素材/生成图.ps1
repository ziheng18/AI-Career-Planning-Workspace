# 调用本地 ComfyUI 生成图像（Qwen-Image-2.1）
# 用法: pwsh -File 素材/生成图.ps1 -Name ui-test -Prompt "..." [-Width 512] [-Height 512] [-Steps 8] [-Cfg 1] [-Turbo]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Prompt,
  [string]$Negative = "低质量, 模糊, 文字乱码, 水印, 变形, 多余的手指",
  [int]$Width = 512,
  [int]$Height = 512,
  [int]$Steps = 8,
  [double]$Cfg = 1.0,
  [switch]$Turbo,
  [int]$Seed = 0
)

$ErrorActionPreference = "Stop"
$Comfy = "http://127.0.0.1:8188"

if ($Seed -eq 0) { $Seed = Get-Random -Minimum 1 -Maximum 2147483647 }

# turbo 版用 8 步 / cfg 1；标准版用 15 步 / cfg 2.5
if ($Turbo) {
  $unet = "qwen_image_2.1_turbo_Q4_K_S.gguf"
} else {
  $unet = "qwen-image-2.1-Q4_K_S.gguf"
  if ($Steps -eq 8) { $Steps = 15 }
  if ($Cfg -eq 1.0) { $Cfg = 2.5 }
}

# 说明：Qwen-Image-2.1 必须用 TextEncodeQwenImage21 做文本编码。
# 用通用的 CLIPTextEncode 会报 "mat1 and mat2 shapes cannot be multiplied (48x4096 and 2048x4096)"，
# 因为 Qwen3VL 文本编码器在这个节点下的投影维度不匹配。
$promptGraph = [ordered]@{
  "1"  = @{ class_type = "UnetLoaderGGUF";     inputs = @{ unet_name = $unet } }
  "2"  = @{ class_type = "CLIPLoader";         inputs = @{ clip_name = "qwen3vl_8b_w4a8.safetensors"; type = "qwen_image"; device = "default" } }
  "3"  = @{ class_type = "VAELoader";          inputs = @{ vae_name = "qwen_image_2.1_vae_bf16.safetensors" } }
  "4"  = @{ class_type = "QwenImage21Cache";   inputs = @{ model = @("1", 0); device = "cpu"; dtype = "int8" } }
  # 0=CONDITIONING(正向)  1=CONDITIONING(负向)  2=LATENT(编辑模式的初始潜变量)
  "5"  = @{ class_type = "TextEncodeQwenImage21"; inputs = @{
              clip = @("2", 0); prompt = $Prompt; negative_prompt = $Negative; resolution = 0; images = @() } }
  "7"  = @{ class_type = "EmptyLatentImage";   inputs = @{ width = $Width; height = $Height; batch_size = 1 } }
  "8"  = @{ class_type = "KSampler";           inputs = @{
              model = @("4", 0); seed = $Seed; steps = $Steps; cfg = $Cfg
              sampler_name = "euler"; scheduler = "simple"
              positive = @("5", 0); negative = @("5", 1); latent_image = @("7", 0); denoise = 1.0 } }
  "9"  = @{ class_type = "VAEDecode";          inputs = @{ samples = @("8", 0); vae = @("3", 0) } }
  "10" = @{ class_type = "SaveImage";          inputs = @{ images = @("9", 0); filename_prefix = $Name } }
}

$body = @{ prompt = $promptGraph; client_id = "career-workbench" } | ConvertTo-Json -Depth 24 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

Write-Output "[$Name] 模型: $unet  ${Width}x${Height}  steps=$Steps cfg=$Cfg seed=$Seed"
try {
  $resp = Invoke-RestMethod -Uri "$Comfy/prompt" -Method Post -Body $bytes -ContentType "application/json" -TimeoutSec 60
} catch {
  Write-Output "提交失败: $($_.Exception.Message)"
  if ($_.ErrorDetails) { Write-Output $_.ErrorDetails.Message }
  exit 1
}
Write-Output "[$Name] 已入队 prompt_id=$($resp.prompt_id)"
Write-Output $resp.prompt_id
