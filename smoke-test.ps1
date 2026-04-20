param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Token = "demo",
  [int]$StartupWaitSeconds = 60
)

$ErrorActionPreference = "Stop"
$script:failures = 0

function Write-Step([string]$message) {
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Pass([string]$message) {
  Write-Host "[PASS] $message" -ForegroundColor Green
}

function Fail([string]$message) {
  Write-Host "[FAIL] $message" -ForegroundColor Red
  $script:failures++
}

function Assert-True([bool]$condition, [string]$message) {
  if ($condition) {
    Pass $message
  }
  else {
    Fail $message
  }
}

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers,
    $Body = $null
  )

  $uri = "$BaseUrl$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Uri $uri -Method $Method -Headers $Headers
  }

  return Invoke-RestMethod -Uri $uri -Method $Method -Headers $Headers -Body ($Body | ConvertTo-Json -Depth 10)
}

$authHeaders = @{ Authorization = "Bearer $Token" }
$jsonHeaders = @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" }

Write-Step "Waiting for app readiness"
$healthy = $false
for ($i = 1; $i -le $StartupWaitSeconds; $i++) {
  try {
    $healthProbe = Invoke-Api -Method "GET" -Path "/api/health" -Headers $authHeaders
    if ($healthProbe.status -eq "ok") {
      $healthy = $true
      break
    }
  }
  catch {
    # keep retrying
  }
  Start-Sleep -Seconds 1
}
Assert-True $healthy "API became reachable within $StartupWaitSeconds seconds"

Write-Step "Checking unauthorized behavior"
try {
  Invoke-RestMethod -Uri "$BaseUrl/api/dashboard" -Method "GET" | Out-Null
  Fail "Unauthenticated dashboard request was rejected"
}
catch {
  $response = $_.Exception.Response
  $statusCode = if ($null -ne $response) { [int]$response.StatusCode } else { -1 }
  Assert-True ($statusCode -eq 401) "Unauthenticated dashboard request returns 401"
}

Write-Step "Validating health endpoint"
$health = Invoke-Api -Method "GET" -Path "/api/health" -Headers $authHeaders
Assert-True ($health.status -eq "ok") "Health status is ok"
Assert-True ([int]$health.glCount -gt 0) "Health reports GL rows > 0"
Assert-True ([int]$health.bankCount -gt 0) "Health reports bank rows > 0"

Write-Step "Validating dashboard before reconcile"
$dashboardBefore = Invoke-Api -Method "GET" -Path "/api/dashboard" -Headers $authHeaders
Assert-True ([int]$dashboardBefore.stats.totalGl -gt 0) "Dashboard totalGl > 0"
Assert-True ([int]$dashboardBefore.stats.totalBank -gt 0) "Dashboard totalBank > 0"

Write-Step "Running reconciliation"
$reconcile = Invoke-Api -Method "POST" -Path "/api/reconcile" -Headers $authHeaders
Assert-True ([int]$reconcile.matched -gt 0) "Reconcile returns matched > 0"
Assert-True ([int]$reconcile.proposed -ge 0) "Reconcile returns proposed >= 0"

Write-Step "Validating dashboard after reconcile"
$dashboardAfter = Invoke-Api -Method "GET" -Path "/api/dashboard" -Headers $authHeaders
Assert-True ([int]$dashboardAfter.stats.matched -gt 0) "Dashboard matched > 0 after reconcile"
Assert-True (($dashboardAfter.glExceptions -is [System.Array])) "Dashboard includes GL exceptions array"
Assert-True (($dashboardAfter.bankExceptions -is [System.Array])) "Dashboard includes bank exceptions array"

Write-Step "Testing explanation generation"
if (($dashboardAfter.glExceptions | Measure-Object).Count -gt 0) {
  $glId = [int]$dashboardAfter.glExceptions[0].id
  Invoke-Api -Method "POST" -Path "/api/explain/exception/gl/$glId" -Headers $authHeaders | Out-Null
  $explanation = Invoke-Api -Method "GET" -Path "/api/explanation/gl/$glId" -Headers $authHeaders

  Assert-True ($explanation.found -eq $true) "GL explanation found"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$explanation.provider)) "GL explanation provider is set"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$explanation.formatted)) "GL explanation formatted text is present"

  $provider = [string]$explanation.provider
  $model = [string]$explanation.model
  Write-Host "Explanation provider: $provider" -ForegroundColor Yellow
  if (-not [string]::IsNullOrWhiteSpace($model)) {
    Write-Host "Explanation model: $model" -ForegroundColor Yellow
  }
}
else {
  Fail "No GL exceptions available to test explanation endpoint"
}

Write-Host ""
if ($script:failures -eq 0) {
  Write-Host "Smoke test result: PASS" -ForegroundColor Green
  exit 0
}

Write-Host "Smoke test result: FAIL ($script:failures checks failed)" -ForegroundColor Red
exit 1
