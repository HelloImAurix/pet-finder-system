# Azure Setup Script for Pet Finder Bots
# This script automates Azure VM instance creation for running bot accounts
# Requirements: Azure CLI installed and configured

Write-Host "=== Azure Pet Finder Bot Setup ===" -ForegroundColor Cyan
Write-Host ""

# Configuration
$INSTANCE_COUNT = 5  # Number of VMs to create (adjust based on free tier)
$VM_SIZE = "Standard_B1s"  # Free tier eligible (1 vCPU, 1 GB RAM)
$RESOURCE_GROUP = "pet-finder-bots-rg"
$LOCATION = "eastus"  # Change to your preferred region
$VM_NAME_PREFIX = "pet-finder-bot"

# Check if Azure CLI is installed
Write-Host "Checking Azure CLI..." -ForegroundColor Yellow
try {
    $azVersion = az --version 2>&1 | Select-Object -First 1
    Write-Host "Azure CLI found: $azVersion" -ForegroundColor Green
} catch {
    Write-Host "Azure CLI not found!" -ForegroundColor Red
    Write-Host "Please install from: https://aka.ms/installazurecliwindows" -ForegroundColor Yellow
    exit 1
}

# Check if logged in
Write-Host "Checking authentication..." -ForegroundColor Yellow
try {
    $account = az account show 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Not logged in!" -ForegroundColor Red
        Write-Host "Run: az login" -ForegroundColor Yellow
        exit 1
    } else {
        $accountInfo = az account show --query "{name:name, id:id}" -o json | ConvertFrom-Json
        Write-Host "Logged in as: $($accountInfo.name)" -ForegroundColor Green
    }
} catch {
    Write-Host "Error checking authentication" -ForegroundColor Red
    exit 1
}

# Create resource group
Write-Host "Creating resource group..." -ForegroundColor Yellow
$rgExists = az group exists --name $RESOURCE_GROUP 2>&1
if ($rgExists -eq "false") {
    az group create --name $RESOURCE_GROUP --location $LOCATION 2>&1 | Out-Null
    Write-Host "Resource group created" -ForegroundColor Green
} else {
    Write-Host "Resource group already exists" -ForegroundColor Green
}

# Create network security group (allow RDP)
Write-Host "Creating network security group..." -ForegroundColor Yellow
$nsgName = "pet-finder-nsg"
az network nsg create --resource-group $RESOURCE_GROUP --name $nsgName --location $LOCATION 2>&1 | Out-Null
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $nsgName --name allow-rdp --priority 1000 --protocol Tcp --destination-port-ranges 3389 --access Allow 2>&1 | Out-Null
Write-Host "Network security group created" -ForegroundColor Green

# Create startup script
$startupScript = @"
# Create bot directory
New-Item -ItemType Directory -Force -Path C:\PetFinderBot
Write-Host "Bot directory created" | Out-File C:\PetFinderBot\setup.log
Write-Host "Please install Roblox and executor manually" | Out-File C:\PetFinderBot\setup.log -Append
"@

$startupScriptBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($startupScript))

# Launch VMs
Write-Host ""
Write-Host "Launching $INSTANCE_COUNT VM instances..." -ForegroundColor Cyan
Write-Host "Note: Azure free tier allows limited VMs. Adjust INSTANCE_COUNT if you hit limits." -ForegroundColor Yellow
Write-Host ""

$vmNames = @()

for ($i = 1; $i -le $INSTANCE_COUNT; $i++) {
    Write-Host "Creating VM $i/$INSTANCE_COUNT..." -ForegroundColor Yellow
    
    $vmName = "$VM_NAME_PREFIX-$i"
    
    $createResult = az vm create `
        --resource-group $RESOURCE_GROUP `
        --name $vmName `
        --image "Win2022Datacenter" `
        --size $VM_SIZE `
        --admin-username "azureuser" `
        --admin-password (Read-Host "Enter password for VM (min 12 chars, must have uppercase, lowercase, number, special char)" -AsSecureString | ConvertFrom-SecureString -AsPlainText) `
        --nsg $nsgName `
        --public-ip-sku Standard `
        --custom-data $startupScriptBase64 `
        2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $vmNames += $vmName
        Write-Host "  VM created: $vmName" -ForegroundColor Green
    } else {
        Write-Host "  Failed to create VM $i" -ForegroundColor Red
        Write-Host "  Error: $createResult" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds 3  # Rate limiting
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Created $($vmNames.Count) VMs:" -ForegroundColor Cyan
foreach ($name in $vmNames) {
    Write-Host "  - $name" -ForegroundColor White
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Get VM IPs:" -ForegroundColor White
Write-Host "   az vm list-ip-addresses --resource-group $RESOURCE_GROUP --output table" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Connect via RDP:" -ForegroundColor White
Write-Host "   - IP: From step 1" -ForegroundColor Gray
Write-Host "   - Username: azureuser" -ForegroundColor Gray
Write-Host "   - Password: The one you entered" -ForegroundColor Gray
Write-Host ""
Write-Host "3. On each VM:" -ForegroundColor White
Write-Host "   - Install Roblox" -ForegroundColor Gray
Write-Host "   - Install executor" -ForegroundColor Gray
Write-Host "   - Copy PetFinderBot.lua" -ForegroundColor Gray
Write-Host "   - Run bot script" -ForegroundColor Gray
Write-Host ""

# Save VM names
$vmNames | Out-File "azure-vm-names.txt"
Write-Host "VM names saved to: azure-vm-names.txt" -ForegroundColor Green
