[CmdletBinding()]
param(
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $ViewerUrl = "http://127.0.0.1:5173"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$viewerDemoUrl = "$ViewerUrl/?projectId=project_demo_001&modelVersionId=version_demo_001&userId=dev_user_001&displayName=%E7%A4%BA%E7%AF%84%E4%BD%BF%E7%94%A8%E8%80%85"

# B-scheme：只開 coordinator / viewer；外部平台由 tests/fakes 模擬，非 runtime UI。
Start-Process "$CoordinatorUrl/ui"
Start-Process $viewerDemoUrl

Write-Host "[demo] opened demo consoles"
