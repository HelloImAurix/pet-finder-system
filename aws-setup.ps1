# AWS EC2 Auto-Setup Script for Pet Finder Bots
# This script automates EC2 instance creation for running bot accounts
# Requirements: AWS CLI installed and configured

Write-Host "=== AWS EC2 Pet Finder Bot Setup ===" -ForegroundColor Cyan
Write-Host ""

# Configuration
$INSTANCE_COUNT = 10  # Number of EC2 instances to create
$INSTANCE_TYPE = "t2.micro"  # Free tier eligible
$AMI_ID = ""  # Will be auto-detected (Windows Server 2022)
$KEY_NAME = "pet-finder-key"
$SECURITY_GROUP = "pet-finder-sg"
$REGION = "us-east-1"  # Change to your preferred region

# Check if AWS CLI is installed
Write-Host "Checking AWS CLI..." -ForegroundColor Yellow
try {
    $awsVersion = aws --version
    Write-Host "✓ AWS CLI found: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ AWS CLI not found!" -ForegroundColor Red
    Write-Host "Please install AWS CLI: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Check AWS credentials
Write-Host "Checking AWS credentials..." -ForegroundColor Yellow
try {
    $identity = aws sts get-caller-identity 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ AWS credentials configured" -ForegroundColor Green
    } else {
        Write-Host "✗ AWS credentials not configured!" -ForegroundColor Red
        Write-Host "Run: aws configure" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "✗ Error checking credentials" -ForegroundColor Red
    exit 1
}

# Get Windows AMI ID (Windows Server 2022)
Write-Host "Finding Windows Server 2022 AMI..." -ForegroundColor Yellow
$amiQuery = aws ec2 describe-images --region $REGION --owners amazon --filters "Name=name,Values=Windows_Server-2022-English-Full-Base-*" "Name=state,Values=available" --query "Images | sort_by(@, &CreationDate) | [-1].ImageId" --output text
if ($amiQuery) {
    $AMI_ID = $amiQuery
    Write-Host "✓ Found AMI: $AMI_ID" -ForegroundColor Green
} else {
    Write-Host "✗ Could not find Windows AMI" -ForegroundColor Red
    Write-Host "Please manually set AMI_ID in the script" -ForegroundColor Yellow
    exit 1
}

# Create Key Pair
Write-Host "Creating key pair..." -ForegroundColor Yellow
$keyExists = aws ec2 describe-key-pairs --region $REGION --key-names $KEY_NAME 2>&1
if ($LASTEXITCODE -ne 0) {
    aws ec2 create-key-pair --region $REGION --key-name $KEY_NAME --query 'KeyMaterial' --output text > "$KEY_NAME.pem"
    Write-Host "✓ Key pair created: $KEY_NAME.pem" -ForegroundColor Green
    Write-Host "  IMPORTANT: Save this file securely!" -ForegroundColor Yellow
} else {
    Write-Host "✓ Key pair already exists" -ForegroundColor Green
}

# Create Security Group
Write-Host "Creating security group..." -ForegroundColor Yellow
$sgExists = aws ec2 describe-security-groups --region $REGION --group-names $SECURITY_GROUP 2>&1
if ($LASTEXITCODE -ne 0) {
    $sgId = aws ec2 create-security-group --region $REGION --group-name $SECURITY_GROUP --description "Pet Finder Bot Security Group" --query 'GroupId' --output text
    Write-Host "✓ Security group created: $sgId" -ForegroundColor Green
    
    # Allow RDP (port 3389)
    aws ec2 authorize-security-group-ingress --region $REGION --group-id $sgId --protocol tcp --port 3389 --cidr 0.0.0.0/0 2>&1 | Out-Null
    Write-Host "✓ RDP (3389) allowed" -ForegroundColor Green
    
    # Allow HTTP/HTTPS (for API calls)
    aws ec2 authorize-security-group-ingress --region $REGION --group-id $sgId --protocol tcp --port 80 --cidr 0.0.0.0/0 2>&1 | Out-Null
    aws ec2 authorize-security-group-ingress --region $REGION --group-id $sgId --protocol tcp --port 443 --cidr 0.0.0.0/0 2>&1 | Out-Null
    Write-Host "✓ HTTP/HTTPS allowed" -ForegroundColor Green
} else {
    $sgId = aws ec2 describe-security-groups --region $REGION --group-names $SECURITY_GROUP --query 'SecurityGroups[0].GroupId' --output text
    Write-Host "✓ Security group already exists: $sgId" -ForegroundColor Green
}

# User Data Script (runs on instance startup)
$userDataScript = @"
<powershell>
# Install Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Roblox (via Chocolatey or manual download)
# choco install roblox -y

# Create bot directory
New-Item -ItemType Directory -Force -Path C:\PetFinderBot
Write-Host "Bot directory created" | Out-File C:\PetFinderBot\setup.log

# Download PetFinderBot.lua (you'll need to upload this manually or host it)
# Invoke-WebRequest -Uri "https://your-url.com/PetFinderBot.lua" -OutFile "C:\PetFinderBot\PetFinderBot.lua"

Write-Host "Setup complete. Please install Roblox and executor manually." | Out-File C:\PetFinderBot\setup.log -Append
</powershell>
"@

$userDataBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($userDataScript))

# Launch Instances
Write-Host ""
Write-Host "Launching $INSTANCE_COUNT EC2 instances..." -ForegroundColor Cyan
$instanceIds = @()

for ($i = 1; $i -le $INSTANCE_COUNT; $i++) {
    Write-Host "Creating instance $i/$INSTANCE_COUNT..." -ForegroundColor Yellow
    
    $instanceName = "pet-finder-bot-$i"
    
    $launchResult = aws ec2 run-instances `
        --region $REGION `
        --image-id $AMI_ID `
        --instance-type $INSTANCE_TYPE `
        --key-name $KEY_NAME `
        --security-group-ids $sgId `
        --user-data $userDataBase64 `
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$instanceName},{Key=Purpose,Value=PetFinderBot}]" `
        --query 'Instances[0].InstanceId' `
        --output text
    
    if ($launchResult) {
        $instanceIds += $launchResult
        Write-Host "  ✓ Instance created: $launchResult ($instanceName)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Failed to create instance $i" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds 2  # Rate limiting
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Created $($instanceIds.Count) instances:" -ForegroundColor Cyan
foreach ($id in $instanceIds) {
    Write-Host "  - $id" -ForegroundColor White
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Wait 2-3 minutes for instances to initialize" -ForegroundColor White
Write-Host "2. Get public IPs:" -ForegroundColor White
Write-Host "   aws ec2 describe-instances --region $REGION --instance-ids $($instanceIds -join ',') --query 'Reservations[*].Instances[*].[InstanceId,PublicIpAddress,State.Name]' --output table" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Connect via RDP:" -ForegroundColor White
Write-Host "   - Username: Administrator" -ForegroundColor Gray
Write-Host "   - Password: Get from AWS Console -> EC2 -> Instances -> Select instance -> Connect -> Get password" -ForegroundColor Gray
Write-Host ""
Write-Host "4. On each instance:" -ForegroundColor White
Write-Host "   - Install Roblox" -ForegroundColor Gray
Write-Host "   - Install executor" -ForegroundColor Gray
Write-Host "   - Copy PetFinderBot.lua" -ForegroundColor Gray
Write-Host "   - Run bot script" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Monitor instances:" -ForegroundColor White
Write-Host "   aws ec2 describe-instances --region $REGION --filters 'Name=tag:Purpose,Values=PetFinderBot' --query 'Reservations[*].Instances[*].[InstanceId,PublicIpAddress,State.Name]' --output table" -ForegroundColor Gray
Write-Host ""

# Save instance IDs to file
$instanceIds | Out-File "instance-ids.txt"
Write-Host "Instance IDs saved to: instance-ids.txt" -ForegroundColor Green
