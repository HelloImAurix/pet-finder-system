# Google Cloud Platform (GCP) Setup Script for Pet Finder Bots
# This script automates GCP VM instance creation for running bot accounts
# Requirements: Google Cloud SDK (gcloud) installed and configured

Write-Host "=== GCP Pet Finder Bot Setup ===" -ForegroundColor Cyan
Write-Host ""

# Configuration
$INSTANCE_COUNT = 10  # Number of VM instances to create
$MACHINE_TYPE = "e2-micro"  # Free tier eligible
$ZONE = "us-central1-a"  # Change to your preferred zone
$PROJECT_ID = ""  # Will prompt if not set
$IMAGE_FAMILY = "windows-2022"  # Windows Server 2022
$IMAGE_PROJECT = "windows-cloud"
$NETWORK = "default"

# Check if gcloud is installed
Write-Host "Checking Google Cloud SDK..." -ForegroundColor Yellow
try {
    $gcloudVersion = gcloud --version 2>&1 | Select-Object -First 1
    Write-Host "✓ Google Cloud SDK found: $gcloudVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Google Cloud SDK not found!" -ForegroundColor Red
    Write-Host "Please install from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Check if authenticated
Write-Host "Checking authentication..." -ForegroundColor Yellow
try {
    $auth = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>&1
    if ($auth) {
        Write-Host "✓ Authenticated as: $auth" -ForegroundColor Green
    } else {
        Write-Host "✗ Not authenticated!" -ForegroundColor Red
        Write-Host "Run: gcloud auth login" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "✗ Error checking authentication" -ForegroundColor Red
    exit 1
}

# Get or set project ID
if ([string]::IsNullOrEmpty($PROJECT_ID)) {
    $currentProject = gcloud config get-value project 2>&1
    if ($currentProject -and $currentProject -ne "None") {
        $PROJECT_ID = $currentProject
        Write-Host "✓ Using project: $PROJECT_ID" -ForegroundColor Green
    } else {
        Write-Host "No project set. Please set a project:" -ForegroundColor Yellow
        $PROJECT_ID = Read-Host "Enter GCP Project ID"
        gcloud config set project $PROJECT_ID
    }
} else {
    gcloud config set project $PROJECT_ID
}

# Enable required APIs
Write-Host "Enabling required APIs..." -ForegroundColor Yellow
gcloud services enable compute.googleapis.com --project=$PROJECT_ID 2>&1 | Out-Null
Write-Host "✓ Compute API enabled" -ForegroundColor Green

# Create firewall rule for RDP (if doesn't exist)
Write-Host "Creating firewall rule for RDP..." -ForegroundColor Yellow
$firewallExists = gcloud compute firewall-rules describe allow-rdp --project=$PROJECT_ID 2>&1
if ($LASTEXITCODE -ne 0) {
    gcloud compute firewall-rules create allow-rdp `
        --allow tcp:3389 `
        --source-ranges 0.0.0.0/0 `
        --description "Allow RDP for Pet Finder Bots" `
        --project=$PROJECT_ID 2>&1 | Out-Null
    Write-Host "✓ Firewall rule created" -ForegroundColor Green
} else {
    Write-Host "✓ Firewall rule already exists" -ForegroundColor Green
}

# Create startup script
$startupScript = @"
# Install Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Create bot directory
New-Item -ItemType Directory -Force -Path C:\PetFinderBot
Write-Host "Bot directory created" | Out-File C:\PetFinderBot\setup.log

# Note: Install Roblox and executor manually after connecting
Write-Host "Setup complete. Please install Roblox and executor manually." | Out-File C:\PetFinderBot\setup.log -Append
"@

$startupScriptPath = "$env:TEMP\gcp-startup-script.ps1"
$startupScript | Out-File -FilePath $startupScriptPath -Encoding UTF8

# Launch Instances
Write-Host ""
Write-Host "Launching $INSTANCE_COUNT VM instances..." -ForegroundColor Cyan
$instanceNames = @()

for ($i = 1; $i -le $INSTANCE_COUNT; $i++) {
    Write-Host "Creating instance $i/$INSTANCE_COUNT..." -ForegroundColor Yellow
    
    $instanceName = "pet-finder-bot-$i"
    
    $createResult = gcloud compute instances create $instanceName `
        --zone=$ZONE `
        --machine-type=$MACHINE_TYPE `
        --image-family=$IMAGE_FAMILY `
        --image-project=$IMAGE_PROJECT `
        --boot-disk-size=30GB `
        --boot-disk-type=pd-standard `
        --tags=pet-finder-bot `
        --metadata-from-file windows-startup-script-ps1=$startupScriptPath `
        --project=$PROJECT_ID 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $instanceNames += $instanceName
        Write-Host "  ✓ Instance created: $instanceName" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Failed to create instance $i" -ForegroundColor Red
        Write-Host "  Error: $createResult" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds 2  # Rate limiting
}

# Clean up temp file
Remove-Item $startupScriptPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Created $($instanceNames.Count) instances:" -ForegroundColor Cyan
foreach ($name in $instanceNames) {
    Write-Host "  - $name" -ForegroundColor White
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Wait 2-3 minutes for instances to initialize" -ForegroundColor White
Write-Host "2. Get instance IPs:" -ForegroundColor White
Write-Host "   gcloud compute instances list --filter='tags.items=pet-finder-bot' --format='table(name,zone,EXTERNAL_IP,STATUS)' --project=$PROJECT_ID" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Get Windows password:" -ForegroundColor White
Write-Host "   gcloud compute reset-windows-password INSTANCE_NAME --zone=$ZONE --project=$PROJECT_ID" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Connect via RDP:" -ForegroundColor White
Write-Host "   - IP: From step 2" -ForegroundColor Gray
Write-Host "   - Username: From step 3" -ForegroundColor Gray
Write-Host "   - Password: From step 3" -ForegroundColor Gray
Write-Host ""
Write-Host "5. On each instance:" -ForegroundColor White
Write-Host "   - Install Roblox" -ForegroundColor Gray
Write-Host "   - Install executor" -ForegroundColor Gray
Write-Host "   - Copy PetFinderBot.lua" -ForegroundColor Gray
Write-Host "   - Run bot script" -ForegroundColor Gray
Write-Host ""
Write-Host "6. Monitor instances:" -ForegroundColor White
Write-Host "   gcloud compute instances list --filter='tags.items=pet-finder-bot' --project=$PROJECT_ID" -ForegroundColor Gray
Write-Host ""

# Save instance names to file
$instanceNames | Out-File "gcp-instance-names.txt"
Write-Host "Instance names saved to: gcp-instance-names.txt" -ForegroundColor Green
