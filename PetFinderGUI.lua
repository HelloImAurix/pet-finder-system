repeat task.wait() until game:IsLoaded() and game.Players.LocalPlayer
task.wait(1)

local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local CoreGui = game:GetService("CoreGui")
local Workspace = game:GetService("Workspace")
local LocalPlayer = Players.LocalPlayer

pcall(function()
    HttpService.HttpEnabled = true
end)

local API_URL = "https://empathetic-transformation-production.up.railway.app/api/finds/recent"
local VERIFY_URL = "https://empathetic-transformation-production.up.railway.app/api/verify-key"

-- Key storage file path
local KEY_FILE = "luji_hub_key.txt"

-- LuArmor Key (will be obfuscated by LuArmor)
local LUARMOR_KEY = nil
local KEY_VERIFIED = false

-- Function to save key to file
local function saveKey(key)
    if writefile then
        pcall(function()
            writefile(KEY_FILE, key)
        end)
    elseif isfile then
        pcall(function()
            if isfile(KEY_FILE) then
                writefile(KEY_FILE, key)
            else
                writefile(KEY_FILE, key)
            end
        end)
    end
end

-- Function to load key from file
local function loadKey()
    if readfile and isfile then
        local success, key = pcall(function()
            if isfile(KEY_FILE) then
                return readfile(KEY_FILE)
            end
        end)
        if success and key and key ~= "" then
            return key
        end
    end
    return nil
end

-- Function to delete saved key
local function deleteKey()
    if delfile then
        pcall(function()
            if isfile and isfile(KEY_FILE) then
                delfile(KEY_FILE)
            end
        end)
    end
end

-- Luji Hub Colors (matching sabLujiHub.lua)
local Colors = {
    Background = Color3.fromRGB(25, 25, 30),
    Secondary = Color3.fromRGB(35, 35, 40),
    Accent = Color3.fromRGB(175, 82, 222),
    AccentHover = Color3.fromRGB(200, 100, 255),
    Text = Color3.fromRGB(255, 255, 255),
    TextSecondary = Color3.fromRGB(200, 200, 200),
    TabInactive = Color3.fromRGB(40, 40, 45),
    TabActive = Color3.fromRGB(175, 82, 222),
    Button = Color3.fromRGB(45, 45, 50),
    ButtonHover = Color3.fromRGB(60, 50, 70),
    ToggleOff = Color3.fromRGB(76, 42, 97),
    ToggleOn = Color3.fromRGB(138, 43, 226),
    CloseButton = Color3.fromRGB(220, 50, 50),
    CloseButtonHover = Color3.fromRGB(255, 70, 70),
    PurpleGlow = Color3.fromRGB(175, 82, 222),
    Green = Color3.fromRGB(76, 175, 80),
}

local isMobile = UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled

local function getViewportSize()
    local camera = Workspace.CurrentCamera
    if camera and camera.ViewportSize then
        return camera.ViewportSize
    end
    return Vector2.new(1920, 1080)
end

local viewportSize = getViewportSize()
Workspace:GetPropertyChangedSignal("CurrentCamera"):Connect(function()
    viewportSize = getViewportSize()
end)
if Workspace.CurrentCamera then
    Workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(function()
        viewportSize = getViewportSize()
    end)
end

local MOBILE_WIDTH = math.min(viewportSize.X * 0.85, 340)
local MOBILE_HEIGHT = math.min(viewportSize.Y * 0.8, 285)
local WIDTH = isMobile and MOBILE_WIDTH or 340
local HEIGHT = isMobile and MOBILE_HEIGHT or 285

-- Create GUI
local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name = "LujiHubAutoJoiner"
ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
ScreenGui.ResetOnSpawn = false
ScreenGui.Parent = CoreGui

local MainFrame = Instance.new("Frame")
MainFrame.Name = "MainFrame"
MainFrame.Size = UDim2.new(0, WIDTH, 0, HEIGHT)
MainFrame.Position = UDim2.new(0.5, -WIDTH / 2, 0.5, -HEIGHT / 2)
MainFrame.BackgroundColor3 = Colors.Background
MainFrame.BorderSizePixel = 0
MainFrame.Parent = ScreenGui

local ShadowFrame = Instance.new("Frame")
ShadowFrame.Name = "Shadow"
ShadowFrame.Size = UDim2.new(1, 6, 1, 6)
ShadowFrame.Position = UDim2.new(0, -3, 0, -3)
ShadowFrame.BackgroundColor3 = Color3.new(0, 0, 0)
ShadowFrame.BackgroundTransparency = 0.7
ShadowFrame.BorderSizePixel = 0
ShadowFrame.ZIndex = -1
ShadowFrame.Parent = MainFrame

local ShadowCorner = Instance.new("UICorner")
ShadowCorner.CornerRadius = UDim.new(0, 13)
ShadowCorner.Parent = ShadowFrame

local UICorner = Instance.new("UICorner")
UICorner.CornerRadius = UDim.new(0, 10)
UICorner.Parent = MainFrame

local UIStroke = Instance.new("UIStroke")
UIStroke.Color = Colors.Accent
UIStroke.Thickness = isMobile and 1.5 or 2
UIStroke.Transparency = 0.2
UIStroke.Parent = MainFrame

local HEADER_HEIGHT = isMobile and 28 or 30
local HeaderFrame = Instance.new("Frame")
HeaderFrame.Size = UDim2.new(1, 0, 0, HEADER_HEIGHT)
HeaderFrame.BackgroundColor3 = Colors.Secondary
HeaderFrame.BorderSizePixel = 0
HeaderFrame.Parent = MainFrame

local HeaderCorner = Instance.new("UICorner")
HeaderCorner.CornerRadius = UDim.new(0, 10)
HeaderCorner.Parent = HeaderFrame

local HeaderMask = Instance.new("Frame")
HeaderMask.Size = UDim2.new(1, 0, 0, 10)
HeaderMask.Position = UDim2.new(0, 0, 1, -10)
HeaderMask.BackgroundColor3 = Colors.Secondary
HeaderMask.BorderSizePixel = 0
HeaderMask.Parent = HeaderFrame

local TitleLabel = Instance.new("TextLabel")
TitleLabel.Size = UDim2.new(0, 200, 0, HEADER_HEIGHT)
TitleLabel.Position = UDim2.new(0, 10, 0, 0)
TitleLabel.BackgroundTransparency = 1
TitleLabel.Text = "Luji Hub | Auto Joiner"
TitleLabel.TextColor3 = Colors.Accent
TitleLabel.TextSize = isMobile and 12 or 13
TitleLabel.Font = Enum.Font.GothamBold
TitleLabel.TextXAlignment = Enum.TextXAlignment.Left
TitleLabel.Parent = HeaderFrame

local CloseButton = Instance.new("TextButton")
CloseButton.Size = UDim2.new(0, HEADER_HEIGHT - 2, 0, HEADER_HEIGHT - 2)
CloseButton.Position = UDim2.new(1, -(HEADER_HEIGHT + 2), 0, 1)
CloseButton.BackgroundColor3 = Colors.CloseButton
CloseButton.Text = "×"
CloseButton.TextColor3 = Colors.Text
CloseButton.TextSize = isMobile and 20 or 18
CloseButton.Font = Enum.Font.GothamBold
CloseButton.BorderSizePixel = 0
CloseButton.AutoButtonColor = false
CloseButton.Parent = HeaderFrame

local CloseCorner = Instance.new("UICorner")
CloseCorner.CornerRadius = UDim.new(0, 5)
CloseCorner.Parent = CloseButton

CloseButton.MouseEnter:Connect(function()
    CloseButton.BackgroundColor3 = Colors.CloseButtonHover
end)
CloseButton.MouseLeave:Connect(function()
    CloseButton.BackgroundColor3 = Colors.CloseButton
end)
CloseButton.MouseButton1Click:Connect(function()
    ScreenGui.Enabled = not ScreenGui.Enabled
end)

local dragging = false
local dragStart = nil
local startPos = nil
local dragInput = nil
local hasMoved = false

local function update(input)
    if not dragging or not dragStart or not startPos then return end
    if not MainFrame or not MainFrame.Parent then return end

    local delta = input.Position - dragStart
    if math.abs(delta.X) > 2 or math.abs(delta.Y) > 2 then
        hasMoved = true
    end
    if not hasMoved then return end

    local newX = startPos.X.Offset + delta.X
    local newY = startPos.Y.Offset + delta.Y
    newX = math.clamp(newX, 0, viewportSize.X - WIDTH)
    newY = math.clamp(newY, 0, viewportSize.Y - HEIGHT)
    MainFrame.Position = UDim2.new(0, newX, 0, newY)
end

HeaderFrame.InputBegan:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
        dragging = true
        hasMoved = false
        dragStart = input.Position
        startPos = MainFrame.Position
        input.Changed:Connect(function()
            if input.UserInputState == Enum.UserInputState.End then
                dragging = false
                dragStart = nil
                startPos = nil
                dragInput = nil
                hasMoved = false
            end
        end)
    end
end)

HeaderFrame.InputChanged:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch then
        dragInput = input
    end
end)

UserInputService.InputChanged:Connect(function(input)
    if input == dragInput and dragging then
        update(input)
    end
end)

UserInputService.InputEnded:Connect(function(input)
    if (input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch) and dragging then
        dragging = false
        dragStart = nil
        startPos = nil
        dragInput = nil
        hasMoved = false
    end
end)

-- Key Input Frame (shown when key is not verified)
local KeyInputFrame = Instance.new("Frame")
KeyInputFrame.Size = UDim2.new(1, -20, 0, 120)
KeyInputFrame.Position = UDim2.new(0, 10, 0, 50)
KeyInputFrame.BackgroundColor3 = Colors.Secondary
KeyInputFrame.BorderSizePixel = 0
KeyInputFrame.Visible = false
KeyInputFrame.Parent = MainFrame

local KeyInputCorner = Instance.new("UICorner")
KeyInputCorner.CornerRadius = UDim.new(0, 8)
KeyInputCorner.Parent = KeyInputFrame

local KeyInputStroke = Instance.new("UIStroke")
KeyInputStroke.Color = Colors.PurpleGlow
KeyInputStroke.Thickness = 1.5
KeyInputStroke.Transparency = 0.3
KeyInputStroke.Parent = KeyInputFrame

local KeyLabel = Instance.new("TextLabel")
KeyLabel.Size = UDim2.new(1, -12, 0, isMobile and 22 or 25)
KeyLabel.Position = UDim2.new(0, 6, 0, 6)
KeyLabel.BackgroundTransparency = 1
KeyLabel.Text = "Enter LuArmor Key:"
KeyLabel.TextColor3 = Colors.Text
KeyLabel.TextSize = isMobile and 12 or 13
KeyLabel.Font = Enum.Font.GothamBold
KeyLabel.TextXAlignment = Enum.TextXAlignment.Left
KeyLabel.Parent = KeyInputFrame

local KeyTextBox = Instance.new("TextBox")
KeyTextBox.Size = UDim2.new(1, -12, 0, isMobile and 32 or 35)
KeyTextBox.Position = UDim2.new(0, 6, 0, isMobile and 32 or 35)
KeyTextBox.BackgroundColor3 = Colors.Background
KeyTextBox.TextColor3 = Colors.Text
KeyTextBox.TextSize = isMobile and 11 or 12
KeyTextBox.Font = Enum.Font.Gotham
KeyTextBox.PlaceholderText = "Paste your LuArmor key here..."
KeyTextBox.PlaceholderColor3 = Colors.TextSecondary
KeyTextBox.ClearTextOnFocus = false
KeyTextBox.Text = ""
KeyTextBox.Parent = KeyInputFrame

local KeyTextBoxCorner = Instance.new("UICorner")
KeyTextBoxCorner.CornerRadius = UDim.new(0, 6)
KeyTextBoxCorner.Parent = KeyTextBox

local KeyTextBoxPadding = Instance.new("UIPadding")
KeyTextBoxPadding.PaddingLeft = UDim.new(0, 8)
KeyTextBoxPadding.PaddingRight = UDim.new(0, 8)
KeyTextBoxPadding.Parent = KeyTextBox

local VerifyButton = Instance.new("TextButton")
VerifyButton.Size = UDim2.new(1, -12, 0, isMobile and 28 or 30)
VerifyButton.Position = UDim2.new(0, 6, 0, isMobile and 72 or 78)
VerifyButton.BackgroundColor3 = Colors.Button
VerifyButton.Text = "VERIFY KEY"
VerifyButton.TextColor3 = Colors.Text
VerifyButton.TextSize = isMobile and 10 or 11
VerifyButton.Font = Enum.Font.GothamBold
VerifyButton.BorderSizePixel = 0
VerifyButton.AutoButtonColor = false
VerifyButton.Parent = KeyInputFrame

local VerifyButtonCorner = Instance.new("UICorner")
VerifyButtonCorner.CornerRadius = UDim.new(0, 6)
VerifyButtonCorner.Parent = VerifyButton

local VerifyButtonStroke = Instance.new("UIStroke")
VerifyButtonStroke.Color = Colors.PurpleGlow
VerifyButtonStroke.Thickness = 1.5
VerifyButtonStroke.Transparency = 0.3
VerifyButtonStroke.Parent = VerifyButton

VerifyButton.MouseEnter:Connect(function()
    TweenService:Create(VerifyButton, TweenInfo.new(0.2), {
        BackgroundColor3 = Colors.ButtonHover,
    }):Play()
    TweenService:Create(VerifyButtonStroke, TweenInfo.new(0.2), {
        Transparency = 0,
    }):Play()
end)

VerifyButton.MouseLeave:Connect(function()
    TweenService:Create(VerifyButton, TweenInfo.new(0.2), {
        BackgroundColor3 = Colors.Button,
    }):Play()
    TweenService:Create(VerifyButtonStroke, TweenInfo.new(0.2), {
        Transparency = 0.3,
    }):Play()
end)

local StatusLabel = Instance.new("TextLabel")
StatusLabel.Size = UDim2.new(1, -12, 0, isMobile and 18 or 20)
StatusLabel.Position = UDim2.new(0, 6, 1, -(isMobile and 22 or 25))
StatusLabel.BackgroundTransparency = 1
StatusLabel.Text = ""
StatusLabel.TextColor3 = Colors.TextSecondary
StatusLabel.TextSize = isMobile and 9 or 10
StatusLabel.Font = Enum.Font.Gotham
StatusLabel.TextXAlignment = Enum.TextXAlignment.Left
StatusLabel.Parent = KeyInputFrame

-- Scroll Frame for finds
local ScrollFrame = Instance.new("ScrollingFrame")
ScrollFrame.Size = UDim2.new(1, -10, 1, -45)
ScrollFrame.Position = UDim2.new(0, 5, 0, 40)
ScrollFrame.BackgroundTransparency = 1
ScrollFrame.BorderSizePixel = 0
ScrollFrame.ScrollBarThickness = 4
ScrollFrame.ScrollBarImageColor3 = Colors.Accent
ScrollFrame.Parent = MainFrame

local ListLayout = Instance.new("UIListLayout")
ListLayout.Padding = UDim.new(0, 6)
ListLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
ListLayout.SortOrder = Enum.SortOrder.LayoutOrder
ListLayout.Parent = ScrollFrame

local Padding = Instance.new("UIPadding")
Padding.PaddingLeft = UDim.new(0, 4)
Padding.PaddingRight = UDim.new(0, 4)
Padding.PaddingTop = UDim.new(0, 4)
Padding.PaddingBottom = UDim.new(0, 4)
Padding.Parent = ScrollFrame

local function updateCanvasSize()
    if not ScrollFrame or not ScrollFrame.Parent then return end
    local contentSize = ListLayout.AbsoluteContentSize
    local padding = Padding.PaddingTop.Offset + Padding.PaddingBottom.Offset
    ScrollFrame.CanvasSize = UDim2.new(0, 0, 0, contentSize.Y + padding + 8)
end

ListLayout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(updateCanvasSize)
ScrollFrame:GetPropertyChangedSignal("AbsoluteSize"):Connect(updateCanvasSize)

task.spawn(function()
    while ScrollFrame and ScrollFrame.Parent do
        updateCanvasSize()
        task.wait(0.1)
    end
end)

-- Function to create a card for a find
local function createCard(find)
    local CARD_HEIGHT = isMobile and 80 or 85
    local card = Instance.new("Frame")
    card.Size = UDim2.new(1, -8, 0, CARD_HEIGHT)
    card.BackgroundColor3 = Colors.Secondary
    card.BorderSizePixel = 0
    card.Parent = ScrollFrame
    
    local cardCorner = Instance.new("UICorner")
    cardCorner.CornerRadius = UDim.new(0, 8)
    cardCorner.Parent = card
    
    local cardStroke = Instance.new("UIStroke")
    cardStroke.Color = Colors.PurpleGlow
    cardStroke.Thickness = 1.5
    cardStroke.Transparency = 0.3
    cardStroke.Parent = card
    
    local BUTTON_WIDTH = isMobile and 55 or 60
    local BUTTON_HEIGHT = isMobile and 30 or 32
    
    -- Pet name
    local nameLabel = Instance.new("TextLabel")
    nameLabel.Size = UDim2.new(1, -(BUTTON_WIDTH + 12), 0, isMobile and 22 or 25)
    nameLabel.Position = UDim2.new(0, 6, 0, 6)
    nameLabel.BackgroundTransparency = 1
    nameLabel.Text = "📦 " .. (find.petName or "Unknown")
    nameLabel.TextColor3 = Colors.Accent
    nameLabel.TextSize = isMobile and 12 or 13
    nameLabel.Font = Enum.Font.GothamBold
    nameLabel.TextXAlignment = Enum.TextXAlignment.Left
    nameLabel.TextTruncate = Enum.TextTruncate.AtEnd
    nameLabel.Parent = card
    
    -- Generation and MPS
    local genLabel = Instance.new("TextLabel")
    genLabel.Size = UDim2.new(1, -(BUTTON_WIDTH + 12), 0, isMobile and 18 or 20)
    genLabel.Position = UDim2.new(0, 6, 0, isMobile and 28 or 30)
    genLabel.BackgroundTransparency = 1
    genLabel.Text = "Gen: " .. (find.generation or "N/A") .. " | MPS: " .. (find.mps or 0)
    genLabel.TextColor3 = Colors.TextSecondary
    genLabel.TextSize = isMobile and 10 or 11
    genLabel.Font = Enum.Font.Gotham
    genLabel.TextXAlignment = Enum.TextXAlignment.Left
    genLabel.TextTruncate = Enum.TextTruncate.AtEnd
    genLabel.Parent = card
    
    -- Account and players
    local infoLabel = Instance.new("TextLabel")
    infoLabel.Size = UDim2.new(1, -(BUTTON_WIDTH + 12), 0, isMobile and 16 or 18)
    infoLabel.Position = UDim2.new(0, 6, 0, isMobile and 48 or 52)
    infoLabel.BackgroundTransparency = 1
    infoLabel.Text = "👤 " .. (find.accountName or "Unknown") .. " | 👥 " .. (find.playerCount or 0) .. "/" .. (find.maxPlayers or 6)
    infoLabel.TextColor3 = Colors.TextSecondary
    infoLabel.TextSize = isMobile and 9 or 10
    infoLabel.Font = Enum.Font.Gotham
    infoLabel.TextXAlignment = Enum.TextXAlignment.Left
    infoLabel.TextTruncate = Enum.TextTruncate.AtEnd
    infoLabel.Parent = card
    
    -- Join button
    local joinButton = Instance.new("TextButton")
    joinButton.Size = UDim2.new(0, BUTTON_WIDTH, 0, BUTTON_HEIGHT)
    joinButton.Position = UDim2.new(1, -(BUTTON_WIDTH + 6), 0.5, -BUTTON_HEIGHT / 2)
    joinButton.BackgroundColor3 = Colors.Green
    joinButton.Text = "JOIN"
    joinButton.TextColor3 = Colors.Text
    joinButton.TextSize = isMobile and 10 or 11
    joinButton.Font = Enum.Font.GothamBold
    joinButton.BorderSizePixel = 0
    joinButton.AutoButtonColor = false
    joinButton.ZIndex = 10
    joinButton.Parent = card
    
    local joinCorner = Instance.new("UICorner")
    joinCorner.CornerRadius = UDim.new(0, 6)
    joinCorner.Parent = joinButton
    
    local joinStroke = Instance.new("UIStroke")
    joinStroke.Color = Colors.Accent
    joinStroke.Thickness = 1.5
    joinStroke.Transparency = 0.3
    joinStroke.Parent = joinButton
    
    -- Button hover effects
    joinButton.MouseEnter:Connect(function()
        TweenService:Create(joinButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Color3.fromRGB(102, 187, 106),
        }):Play()
        TweenService:Create(joinStroke, TweenInfo.new(0.2), {
            Transparency = 0,
        }):Play()
    end)
    
    joinButton.MouseLeave:Connect(function()
        TweenService:Create(joinButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Colors.Green,
        }):Play()
        TweenService:Create(joinStroke, TweenInfo.new(0.2), {
            Transparency = 0.3,
        }):Play()
    end)
    
    -- Join functionality
    joinButton.MouseButton1Click:Connect(function()
        if find.placeId and find.jobId then
            joinButton.Text = "JOINING..."
            joinButton.BackgroundColor3 = Color3.fromRGB(255, 165, 0)
            TeleportService:Teleport(tonumber(find.placeId), LocalPlayer, {find.jobId})
            task.wait(1.5)
            joinButton.Text = "JOIN"
            joinButton.BackgroundColor3 = Colors.Green
        end
    end)
    
    return card
end

-- Function to verify LuArmor key
local function verifyKey(key)
    if not key or key == "" then
        return false, "Key cannot be empty"
    end
    
    local success, response, statusCode = pcall(function()
        if syn and syn.request then
            local res = syn.request({
                Url = VERIFY_URL,
                Method = "POST",
                Headers = {
                    ["Content-Type"] = "application/json",
                    ["X-API-Key"] = key
                },
                Body = HttpService:JSONEncode({key = key, user_key = key})
            })
            return res.Body, res.StatusCode
        elseif request then
            local res = request({
                Url = VERIFY_URL,
                Method = "POST",
                Headers = {
                    ["Content-Type"] = "application/json",
                    ["X-API-Key"] = key
                },
                Body = HttpService:JSONEncode({key = key, user_key = key})
            })
            return res.Body, res.StatusCode
        else
            local response = HttpService:PostAsync(VERIFY_URL, HttpService:JSONEncode({key = key, user_key = key}), Enum.HttpContentType.ApplicationJson, false, {
                ["X-API-Key"] = key
            })
            return response, 200
        end
    end)
    
    if success and response then
        -- Check if response is HTML (error page)
        if type(response) == "string" and (response:sub(1, 1) == "<" or response:find("<!DOCTYPE") or response:find("<html")) then
            return false, "Server returned HTML instead of JSON. Check server status."
        end
        
        local success2, data = pcall(function()
            return HttpService:JSONDecode(response)
        end)
        
        if success2 and data then
            if data.success then
                return true, "Key verified successfully"
            else
                return false, data.error or "Key verification failed"
            end
        else
            -- Try to extract error message from response
            local errorMsg = "Invalid response from server"
            if type(response) == "string" and #response < 200 then
                errorMsg = "Server error: " .. response:sub(1, 100)
            end
            return false, errorMsg
        end
    else
        local errorMsg = "Failed to connect to server"
        if response and type(response) == "string" then
            errorMsg = errorMsg .. ": " .. response:sub(1, 100)
        end
        return false, errorMsg
    end
end

-- Function to fetch and display finds
local function fetchFinds()
    -- Only fetch if key is verified
    if not KEY_VERIFIED or not LUARMOR_KEY then
        return
    end
    local success, response = pcall(function()
        if syn and syn.request then
            local res = syn.request({
                Url = API_URL,
                Method = "GET"
            })
            return res.Body
        elseif request then
            local res = request({
                Url = API_URL,
                Method = "GET"
            })
            return res.Body
        else
            return HttpService:GetAsync(API_URL, true)
        end
    end)
    
    if success and response then
        local success2, data = pcall(function()
            return HttpService:JSONDecode(response)
        end)
        
        if success2 and data and data.finds then
            -- Clear existing cards
            for _, child in pairs(ScrollFrame:GetChildren()) do
                if child:IsA("Frame") then
                    child:Destroy()
                end
            end
            
            -- Create cards for each find
            for i, find in ipairs(data.finds) do
                local card = createCard(find)
                card.LayoutOrder = i
            end
            
            -- Update scroll canvas size
            local contentSize = ListLayout.AbsoluteContentSize
            ScrollFrame.CanvasSize = UDim2.new(0, 0, 0, contentSize.Y + 10)
            
            TitleLabel.Text = "Luji Hub | Auto Joiner - " .. #data.finds .. " Finds"
        else
            TitleLabel.Text = "Luji Hub | Auto Joiner - No Finds"
        end
    end
end

-- Verify button click
VerifyButton.MouseButton1Click:Connect(function()
    local key = KeyTextBox.Text
    if key == "" then
        StatusLabel.Text = "Please enter a key"
        StatusLabel.TextColor3 = Color3.fromRGB(255, 100, 100)
        return
    end
    
    VerifyButton.Text = "VERIFYING..."
    VerifyButton.BackgroundColor3 = Color3.fromRGB(255, 165, 0)
    StatusLabel.Text = "Verifying key..."
    StatusLabel.TextColor3 = Colors.TextSecondary
    
    task.spawn(function()
        local verified, message = verifyKey(key)
        
        if verified then
            LUARMOR_KEY = key
            KEY_VERIFIED = true
            saveKey(key) -- Save the key
            KeyInputFrame.Visible = false
            ScrollFrame.Visible = true
            TitleLabel.Text = "Luji Hub | Auto Joiner"
            StatusLabel.Text = ""
            
            -- Start fetching finds
            task.spawn(function()
                while ScreenGui.Parent and KEY_VERIFIED do
                    fetchFinds()
                    task.wait(1)
                end
            end)
            
            -- Initial fetch
            task.wait(0.1)
            fetchFinds()
        else
            VerifyButton.Text = "VERIFY KEY"
            VerifyButton.BackgroundColor3 = Colors.Accent
            StatusLabel.Text = "Error: " .. message
            StatusLabel.TextColor3 = Color3.fromRGB(255, 100, 100)
            deleteKey() -- Delete invalid key
        end
    end)
end)

-- Enter key to verify
KeyTextBox.FocusLost:Connect(function(enterPressed)
    if enterPressed then
        VerifyButton.MouseButton1Click:Fire()
    end
end)

-- Try to load saved key on startup
local savedKey = loadKey()
if savedKey then
    KeyInputFrame.Visible = true
    ScrollFrame.Visible = false
    KeyTextBox.Text = savedKey
    StatusLabel.Text = "Auto-verifying saved key..."
    StatusLabel.TextColor3 = Colors.TextSecondary
    
    -- Auto-verify saved key
    task.spawn(function()
        task.wait(0.5)
        local verified, message = verifyKey(savedKey)
        
        if verified then
            LUARMOR_KEY = savedKey
            KEY_VERIFIED = true
            KeyInputFrame.Visible = false
            ScrollFrame.Visible = true
            TitleLabel.Text = "Luji Hub | Auto Joiner"
            StatusLabel.Text = ""
            
            -- Start fetching finds
            task.spawn(function()
                while ScreenGui.Parent and KEY_VERIFIED do
                    fetchFinds()
                    task.wait(1)
                end
            end)
            
            -- Initial fetch
            task.wait(0.1)
            fetchFinds()
        else
            KeyTextBox.Text = ""
            StatusLabel.Text = "Saved key invalid. Please enter a new key."
            StatusLabel.TextColor3 = Color3.fromRGB(255, 100, 100)
            deleteKey() -- Remove invalid saved key
        end
    end)
else
    -- Show key input on startup if no saved key
    KeyInputFrame.Visible = true
    ScrollFrame.Visible = false
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if not gameProcessed and input.KeyCode == Enum.KeyCode.LeftControl then
        ScreenGui.Enabled = not ScreenGui.Enabled
    end
end)

-- Periodic key re-verification (every 5 minutes)
task.spawn(function()
    while ScreenGui.Parent do
        task.wait(300) -- 5 minutes
        if KEY_VERIFIED and LUARMOR_KEY then
            local verified, _ = verifyKey(LUARMOR_KEY)
            if not verified then
                KEY_VERIFIED = false
                LUARMOR_KEY = nil
                KeyInputFrame.Visible = true
                ScrollFrame.Visible = false
                KeyTextBox.Text = ""
                TitleLabel.Text = "Luji Hub | Auto Joiner"
                StatusLabel.Text = "Key expired or invalid. Please re-enter."
                StatusLabel.TextColor3 = Color3.fromRGB(255, 100, 100)
                deleteKey() -- Remove expired key
            end
        end
    end
end)
