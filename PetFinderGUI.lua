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

-- Scroll Frame for finds
local CONTENT_HEIGHT = HEIGHT - HEADER_HEIGHT
local ScrollFrame = Instance.new("ScrollingFrame")
ScrollFrame.Size = UDim2.new(1, -8, 0, CONTENT_HEIGHT)
ScrollFrame.Position = UDim2.new(0, 4, 0, HEADER_HEIGHT)
ScrollFrame.BackgroundTransparency = 1
ScrollFrame.BorderSizePixel = 0
ScrollFrame.ScrollBarThickness = isMobile and 4 or 3
ScrollFrame.ScrollBarImageColor3 = Colors.PurpleGlow
ScrollFrame.ScrollingEnabled = true
ScrollFrame.ScrollingDirection = Enum.ScrollingDirection.Y
ScrollFrame.ElasticBehavior = Enum.ElasticBehavior.Always
ScrollFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
ScrollFrame.Visible = true
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

-- Function to fetch and display finds
local function fetchFinds()
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
            updateCanvasSize()
            
            TitleLabel.Text = "Luji Hub | Auto Joiner - " .. #data.finds .. " Finds"
        else
            TitleLabel.Text = "Luji Hub | Auto Joiner - No Finds"
        end
    end
end

-- Start fetching finds on startup
ScrollFrame.Visible = true
task.spawn(function()
    while ScreenGui.Parent do
        fetchFinds()
        task.wait(1)
    end
end)

-- Initial fetch
task.wait(0.5)
fetchFinds()

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if not gameProcessed and input.KeyCode == Enum.KeyCode.LeftControl then
        ScreenGui.Enabled = not ScreenGui.Enabled
    end
end)
