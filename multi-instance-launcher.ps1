# Multi-Instance Roblox Launcher for Pet Finder Bots
# Launches multiple Roblox instances with bot script auto-loaded
# Works on Windows with Roblox installed

param(
    [int]$InstanceCount = 10,
    [string]$BotScriptPath = "PetFinderBot.lua",
    [string]$RobloxPath = "",
    [int]$DelayBetweenLaunches = 3
)

Write-Host "=== Multi-Instance Roblox Launcher ===" -ForegroundColor Cyan
Write-Host ""

# Find Roblox installation
if ([string]::IsNullOrEmpty($RobloxPath)) {
    $possiblePaths = @(
        "$env:LOCALAPPDATA\Roblox\Versions\RobloxPlayerBeta.exe",
        "$env:PROGRAMFILES\Roblox\Versions\RobloxPlayerBeta.exe",
        "$env:PROGRAMFILES(X86)\Roblox\Versions\RobloxPlayerBeta.exe"
    )
    
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $RobloxPath = $path
            Write-Host "✓ Found Roblox: $RobloxPath" -ForegroundColor Green
            break
        }
    }
    
    if ([string]::IsNullOrEmpty($RobloxPath)) {
        Write-Host "✗ Roblox not found!" -ForegroundColor Red
        Write-Host "Please specify Roblox path with -RobloxPath parameter" -ForegroundColor Yellow
        exit 1
    }
} else {
    if (-not (Test-Path $RobloxPath)) {
        Write-Host "✗ Roblox path not found: $RobloxPath" -ForegroundColor Red
        exit 1
    }
}

# Check if bot script exists
if (-not (Test-Path $BotScriptPath)) {
    Write-Host "✗ Bot script not found: $BotScriptPath" -ForegroundColor Red
    Write-Host "Please ensure PetFinderBot.lua is in the same directory" -ForegroundColor Yellow
    exit 1
}

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Instances: $InstanceCount" -ForegroundColor White
Write-Host "  Bot Script: $BotScriptPath" -ForegroundColor White
Write-Host "  Roblox Path: $RobloxPath" -ForegroundColor White
Write-Host "  Delay: $DelayBetweenLaunches seconds" -ForegroundColor White
Write-Host ""

# Get game place ID (Steal A Brainrot default, change if needed)
$placeId = Read-Host "Enter Roblox Place ID (or press Enter for default: 0)"
if ([string]::IsNullOrEmpty($placeId)) {
    $placeId = "0"  # Change this to your game's place ID
}

Write-Host ""
Write-Host "Starting $InstanceCount Roblox instances..." -ForegroundColor Cyan
Write-Host "NOTE: You'll need to log in to each instance manually" -ForegroundColor Yellow
Write-Host ""

$processes = @()

for ($i = 1; $i -le $InstanceCount; $i++) {
    Write-Host "Launching instance $i/$InstanceCount..." -ForegroundColor Yellow
    
    # Launch Roblox with place ID
    $process = Start-Process -FilePath $RobloxPath -ArgumentList "-placeId $placeId" -PassThru
    
    if ($process) {
        $processes += $process
        Write-Host "  ✓ Instance $i launched (PID: $($process.Id))" -ForegroundColor Green
        
        # Wait before launching next instance
        if ($i -lt $InstanceCount) {
            Start-Sleep -Seconds $DelayBetweenLaunches
        }
    } else {
        Write-Host "  ✗ Failed to launch instance $i" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Launch Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Launched $($processes.Count) Roblox instances" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Log in to each Roblox instance with different accounts" -ForegroundColor White
Write-Host "2. In your executor, load: $BotScriptPath" -ForegroundColor White
Write-Host "3. Each bot will automatically start scanning and sending finds to API" -ForegroundColor White
Write-Host ""
Write-Host "To stop all instances, close this window or press Ctrl+C" -ForegroundColor Yellow
Write-Host ""

# Keep script running and monitor processes
Write-Host "Monitoring instances... (Press Ctrl+C to stop)" -ForegroundColor Cyan
try {
    while ($true) {
        $running = ($processes | Where-Object { -not $_.HasExited }).Count
        if ($running -eq 0) {
            Write-Host "All instances have closed." -ForegroundColor Yellow
            break
        }
        Start-Sleep -Seconds 10
    }
} catch {
    Write-Host "Stopped monitoring." -ForegroundColor Yellow
}
