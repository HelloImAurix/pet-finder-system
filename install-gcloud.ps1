# Google Cloud SDK Installation Script for Windows
# This script downloads and installs the Google Cloud SDK automatically

Write-Host "=== Google Cloud SDK Installation ===" -ForegroundColor Cyan
Write-Host ""

# Check if already installed
Write-Host "Checking if gcloud is already installed..." -ForegroundColor Yellow
try {
    $version = $null
    $version = gcloud --version 2>&1 | Select-Object -First 1
    if ($version -and $version -match "Google Cloud SDK") {
        Write-Host "Google Cloud SDK is already installed!" -ForegroundColor Green
        Write-Host "  $version" -ForegroundColor Gray
        Write-Host ""
        $continue = Read-Host "Do you want to reinstall? (y/n)"
        if ($continue -ne "y") {
            Write-Host "Installation cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
} catch {
    Write-Host "Google Cloud SDK not found. Proceeding with installation..." -ForegroundColor Yellow
}

# Download URL
$installerUrl = "https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe"
$installerPath = "$env:TEMP\GoogleCloudSDKInstaller.exe"

Write-Host ""
Write-Host "Step 1: Downloading Google Cloud SDK installer..." -ForegroundColor Cyan
Write-Host "This may take a few minutes..." -ForegroundColor Gray

try {
    # Download installer
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
    Write-Host "Download complete!" -ForegroundColor Green
    Write-Host "  Saved to: $installerPath" -ForegroundColor Gray
} catch {
    Write-Host "Failed to download installer" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please download manually from:" -ForegroundColor Yellow
    Write-Host "https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe" -ForegroundColor Cyan
    exit 1
}

Write-Host ""
Write-Host "Step 2: Starting installer..." -ForegroundColor Cyan
Write-Host ""
Write-Host "=========================================================" -ForegroundColor Yellow
Write-Host "  INSTALLATION WIZARD INSTRUCTIONS" -ForegroundColor Yellow
Write-Host "=========================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "When the installer opens, please:" -ForegroundColor White
Write-Host "  1. Accept the license agreement" -ForegroundColor Green
Write-Host "  2. Keep default installation location" -ForegroundColor Green
Write-Host "  3. Leave 'Install Bundled Python' checked" -ForegroundColor Green
Write-Host "  4. UNCHECK 'Start the shell to configure gcloud'" -ForegroundColor Red
Write-Host "  5. Click 'Install' and wait for completion" -ForegroundColor Green
Write-Host ""
Write-Host "=========================================================" -ForegroundColor Yellow
Write-Host ""

# Run installer
Write-Host "Launching installer..." -ForegroundColor Yellow
Start-Process -FilePath $installerPath -Wait

# Clean up
Remove-Item $installerPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Step 3: Verifying installation..." -ForegroundColor Cyan

# Wait a bit for installation to complete
Start-Sleep -Seconds 3

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Check if installation was successful
Write-Host "Checking if gcloud is available..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

try {
    # Try to find gcloud in common locations
    $gcloudPaths = @(
        "$env:ProgramFiles\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        "${env:ProgramFiles(x86)}\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    )
    
    $gcloudFound = $false
    foreach ($path in $gcloudPaths) {
        if (Test-Path $path) {
            $env:Path += ";$(Split-Path $path)"
            $gcloudFound = $true
            break
        }
    }
    
    if ($gcloudFound) {
        try {
            $version = & gcloud --version 2>&1 | Select-Object -First 1
            if ($version -and $version -match "Google Cloud SDK") {
                Write-Host "Google Cloud SDK installed successfully!" -ForegroundColor Green
                Write-Host "  $version" -ForegroundColor Gray
            } else {
                throw "gcloud not found"
            }
        } catch {
            throw "gcloud not found"
        }
    } else {
        # Try direct command
        try {
            $version = gcloud --version 2>&1 | Select-Object -First 1
            if ($version -and $version -match "Google Cloud SDK") {
                Write-Host "Google Cloud SDK installed successfully!" -ForegroundColor Green
                Write-Host "  $version" -ForegroundColor Gray
            } else {
                throw "gcloud not found"
            }
        } catch {
            throw "gcloud not found"
        }
    }
} catch {
    Write-Host "Installation completed, but gcloud command not immediately available" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This is normal! Please:" -ForegroundColor White
    Write-Host "  1. CLOSE this PowerShell window" -ForegroundColor Yellow
    Write-Host "  2. OPEN a NEW PowerShell window" -ForegroundColor Yellow
    Write-Host "  3. Run: gcloud --version" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "If it still doesn't work, add to PATH manually:" -ForegroundColor White
    Write-Host "  C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin" -ForegroundColor Gray
    exit 0
}

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Green
Write-Host "  INSTALLATION COMPLETE!" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Initialize gcloud:" -ForegroundColor White
Write-Host "   gcloud init" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Sign in with your Google account (browser will open)" -ForegroundColor White
Write-Host ""
Write-Host "3. Create a project:" -ForegroundColor White
Write-Host "   gcloud projects create pet-finder-bots" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Set the project:" -ForegroundColor White
Write-Host "   gcloud config set project pet-finder-bots" -ForegroundColor Cyan
Write-Host ""
Write-Host "5. Enable billing (required but free tier won't charge):" -ForegroundColor White
Write-Host "   https://console.cloud.google.com/billing" -ForegroundColor Cyan
Write-Host ""
Write-Host "6. Run the GCP setup script:" -ForegroundColor White
Write-Host "   .\gcp-setup.ps1" -ForegroundColor Cyan
Write-Host ""
