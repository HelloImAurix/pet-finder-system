repeat task.wait() until game:IsLoaded() and game.Players.LocalPlayer
task.wait(1)

local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local CoreGui = game:GetService("CoreGui")
local Workspace = game:GetService("Workspace")
local StarterGui = game:GetService("StarterGui")
local LocalPlayer = Players.LocalPlayer

pcall(function()
    HttpService.HttpEnabled = true
end)

local API_URL = "https://empathetic-transformation-production.up.railway.app/api/finds/recent"
-- No API key needed - LuArmor obfuscation handles protection
local UPDATE_INTERVAL = 1

local Colors = {
    Background = Color3.fromRGB(25, 25, 30),
    Secondary = Color3.fromRGB(35, 35, 40),
    Accent = Color3.fromRGB(175, 82, 222),
    AccentHover = Color3.fromRGB(200, 100, 255),
    Text = Color3.fromRGB(255, 255, 255),
    TextSecondary = Color3.fromRGB(200, 200, 200),
    Green = Color3.fromRGB(76, 175, 80),
    GreenHover = Color3.fromRGB(102, 187, 106),
    GreenBright = Color3.fromRGB(129, 199, 132),
    GreenText = Color3.fromRGB(129, 199, 132),
    MinimizeButton = Color3.fromRGB(255, 193, 7),
    MinimizeButtonHover = Color3.fromRGB(255, 213, 79),
    CloseButton = Color3.fromRGB(220, 50, 50),
    CloseButtonHover = Color3.fromRGB(255, 70, 70),
    PurpleGlow = Color3.fromRGB(175, 82, 222),
    ToggleButton = Color3.fromRGB(175, 82, 222),
    ToggleButtonHover = Color3.fromRGB(200, 100, 255),
    Button = Color3.fromRGB(45, 45, 50),
    ButtonHover = Color3.fromRGB(60, 50, 70),
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

local MOBILE_WIDTH = math.min(viewportSize.X * 0.85, 400)
local MOBILE_HEIGHT = math.min(viewportSize.Y * 0.7, 240)
local WIDTH = isMobile and MOBILE_WIDTH or 400
local HEIGHT = isMobile and MOBILE_HEIGHT or 240

local isMinimized = false
local savedPosition = nil

local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name = "PetFinderGUI"
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
UIStroke.Color = Colors.PurpleGlow
UIStroke.Thickness = isMobile and 2 or 2.5
UIStroke.Transparency = 0
UIStroke.Parent = MainFrame

local HEADER_HEIGHT = isMobile and 24 or 26
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
TitleLabel.Size = UDim2.new(1, -90, 0, HEADER_HEIGHT)
TitleLabel.Position = UDim2.new(0, 8, 0, 0)
TitleLabel.BackgroundTransparency = 1
TitleLabel.Text = "luji hub | Auto Joiner"
TitleLabel.TextColor3 = Colors.Accent
TitleLabel.TextSize = isMobile and 11 or 12
TitleLabel.Font = Enum.Font.GothamBold
TitleLabel.TextXAlignment = Enum.TextXAlignment.Left
TitleLabel.Parent = HeaderFrame

local StatusLabel = Instance.new("TextLabel")
StatusLabel.Size = UDim2.new(0, 30, 0, HEADER_HEIGHT)
StatusLabel.Position = UDim2.new(1, -90, 0, 0)
StatusLabel.BackgroundTransparency = 1
StatusLabel.Text = "●"
StatusLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
StatusLabel.TextSize = 16
StatusLabel.Font = Enum.Font.GothamBold
StatusLabel.Parent = HeaderFrame

local MinimizeButton = Instance.new("TextButton")
MinimizeButton.Size = UDim2.new(0, HEADER_HEIGHT - 4, 0, HEADER_HEIGHT - 4)
MinimizeButton.Position = UDim2.new(1, -(HEADER_HEIGHT * 2 + 4), 0, 2)
MinimizeButton.BackgroundColor3 = Colors.MinimizeButton
MinimizeButton.Text = "−"
MinimizeButton.TextColor3 = Colors.Text
MinimizeButton.TextSize = isMobile and 20 or 22
MinimizeButton.Font = Enum.Font.GothamBold
MinimizeButton.BorderSizePixel = 0
MinimizeButton.AutoButtonColor = false
MinimizeButton.Parent = HeaderFrame

local MinimizeCorner = Instance.new("UICorner")
MinimizeCorner.CornerRadius = UDim.new(0, 5)
MinimizeCorner.Parent = MinimizeButton

MinimizeButton.MouseEnter:Connect(function()
    if not isMinimized then
        TweenService:Create(MinimizeButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Colors.MinimizeButtonHover
        }):Play()
    end
end)
MinimizeButton.MouseLeave:Connect(function()
    if not isMinimized then
        TweenService:Create(MinimizeButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Colors.MinimizeButton
        }):Play()
    end
end)

local CloseButton = Instance.new("TextButton")
CloseButton.Size = UDim2.new(0, HEADER_HEIGHT - 4, 0, HEADER_HEIGHT - 4)
CloseButton.Position = UDim2.new(1, -(HEADER_HEIGHT + 2), 0, 2)
CloseButton.BackgroundColor3 = Colors.CloseButton
CloseButton.Text = "×"
CloseButton.TextColor3 = Colors.Text
CloseButton.TextSize = isMobile and 20 or 22
CloseButton.Font = Enum.Font.GothamBold
CloseButton.BorderSizePixel = 0
CloseButton.AutoButtonColor = false
CloseButton.Parent = HeaderFrame

local CloseCorner = Instance.new("UICorner")
CloseCorner.CornerRadius = UDim.new(0, 5)
CloseCorner.Parent = CloseButton

CloseButton.MouseEnter:Connect(function()
    TweenService:Create(CloseButton, TweenInfo.new(0.2), {
        BackgroundColor3 = Colors.CloseButtonHover
    }):Play()
end)
CloseButton.MouseLeave:Connect(function()
    TweenService:Create(CloseButton, TweenInfo.new(0.2), {
        BackgroundColor3 = Colors.CloseButton
    }):Play()
end)

local ToggleButton = Instance.new("TextButton")
ToggleButton.Name = "ToggleButton"
ToggleButton.Size = UDim2.new(0, isMobile and 50 or 45, 0, isMobile and 50 or 45)
ToggleButton.Position = UDim2.new(1, -(isMobile and 60 or 55), 1, -(isMobile and 60 or 55))
ToggleButton.BackgroundColor3 = Colors.ToggleButton
ToggleButton.Text = "📋"
ToggleButton.TextColor3 = Colors.Text
ToggleButton.TextSize = isMobile and 24 or 20
ToggleButton.Font = Enum.Font.GothamBold
ToggleButton.BorderSizePixel = 0
ToggleButton.AutoButtonColor = false
ToggleButton.Visible = false
ToggleButton.ZIndex = 100
ToggleButton.Parent = ScreenGui

local ToggleCorner = Instance.new("UICorner")
ToggleCorner.CornerRadius = UDim.new(0, isMobile and 25 or 22)
ToggleCorner.Parent = ToggleButton

local ToggleStroke = Instance.new("UIStroke")
ToggleStroke.Color = Colors.PurpleGlow
ToggleStroke.Thickness = 2.5
ToggleStroke.Transparency = 0
ToggleStroke.Parent = ToggleButton

local ToggleShadow = Instance.new("Frame")
ToggleShadow.Name = "ToggleShadow"
ToggleShadow.Size = UDim2.new(1, 6, 1, 6)
ToggleShadow.Position = UDim2.new(0, -3, 0, -3)
ToggleShadow.BackgroundColor3 = Color3.new(0, 0, 0)
ToggleShadow.BackgroundTransparency = 0.6
ToggleShadow.BorderSizePixel = 0
ToggleShadow.ZIndex = 99
ToggleShadow.Parent = ToggleButton

local ToggleShadowCorner = Instance.new("UICorner")
ToggleShadowCorner.CornerRadius = UDim.new(0, isMobile and 28 or 25)
ToggleShadowCorner.Parent = ToggleShadow

ToggleButton.MouseEnter:Connect(function()
    TweenService:Create(ToggleButton, TweenInfo.new(0.2), {
        BackgroundColor3 = Colors.ToggleButtonHover,
        Size = UDim2.new(0, isMobile and 54 or 48, 0, isMobile and 54 or 48)
    }):Play()
end)
ToggleButton.MouseLeave:Connect(function()
    TweenService:Create(ToggleButton, TweenInfo.new(0.2), {
        BackgroundColor3 = Colors.ToggleButton,
        Size = UDim2.new(0, isMobile and 50 or 45, 0, isMobile and 50 or 45)
    }):Play()
end)

local function minimizeGUI()
    if isMinimized then return end
    isMinimized = true
    savedPosition = MainFrame.Position
    
    local minimizeTween = TweenService:Create(MainFrame, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
        Size = UDim2.new(0, WIDTH, 0, HEADER_HEIGHT),
        BackgroundTransparency = 0.95
    })
    
    local contentTween = TweenService:Create(ContentFrame, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
        Size = UDim2.new(1, -8, 0, 0),
        BackgroundTransparency = 1
    })
    
    minimizeTween:Play()
    contentTween:Play()
    
    minimizeTween.Completed:Connect(function()
        ContentFrame.Visible = false
        MinimizeButton.Text = "+"
        ToggleButton.Visible = true
    end)
end

local function maximizeGUI()
    if not isMinimized then return end
    isMinimized = false
    
    ContentFrame.Visible = true
    MinimizeButton.Text = "−"
    ToggleButton.Visible = false
    
    local maximizeTween = TweenService:Create(MainFrame, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
        Size = UDim2.new(0, WIDTH, 0, HEIGHT),
        BackgroundTransparency = 0
    })
    
    local contentTween = TweenService:Create(ContentFrame, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
        Size = UDim2.new(1, -8, 0, CONTENT_HEIGHT),
        BackgroundTransparency = 0
    })
    
    maximizeTween:Play()
    contentTween:Play()
end

MinimizeButton.MouseButton1Click:Connect(function()
    if isMinimized then
        maximizeGUI()
    else
        minimizeGUI()
    end
end)

ToggleButton.MouseButton1Click:Connect(function()
    maximizeGUI()
end)

CloseButton.MouseButton1Click:Connect(function()
    local destroyTween = TweenService:Create(MainFrame, TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {
        Size = UDim2.new(0, 0, 0, 0),
        BackgroundTransparency = 1
    })
    destroyTween:Play()
    destroyTween.Completed:Connect(function()
        ScreenGui:Destroy()
    end)
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

local function formatMPS(n)
    if not n or type(n) ~= "number" then return "0" end
    if n >= 1e15 then return string.format("%sQ", (n/1e15)%1==0 and math.floor(n/1e15) or string.format("%.2f", n/1e15))
    elseif n >= 1e12 then return string.format("%sT", (n/1e12)%1==0 and math.floor(n/1e12) or string.format("%.2f", n/1e12))
    elseif n >= 1e9 then return string.format("%sB", (n/1e9)%1==0 and math.floor(n/1e9) or string.format("%.2f", n/1e9))
    elseif n >= 1e6 then return string.format("%sM", (n/1e6)%1==0 and math.floor(n/1e6) or string.format("%.2f", n/1e6))
    elseif n >= 1e3 then return string.format("%sK", (n/1e3)%1==0 and math.floor(n/1e3) or string.format("%.2f", n/1e3))
    else return tostring(math.floor(n))
    end
end

local SPACING = 4
local CONTENT_HEIGHT = HEIGHT - HEADER_HEIGHT - SPACING

local MinMPSValue = Instance.new("NumberValue")
MinMPSValue.Name = "MinMPSValue"
MinMPSValue.Value = 0
MinMPSValue.Parent = ScreenGui

local cachedFinds = {}

local updatePetInfo = nil

local function filterAndDisplayFinds()
    if not ContentFrame or not ContentFrame.Parent then
        warn("[GUI] ContentFrame not available")
        return
    end
    
    -- Ensure ContentFrame is visible
    ContentFrame.Visible = true
    
    -- Clear existing cards (preserve layout elements)
    for _, child in pairs(ContentFrame:GetChildren()) do
        if child:IsA("Frame") and child.Name ~= "UIListLayout" and child.Name ~= "UIPadding" then
            child:Destroy()
        end
    end
    
    if updatePetInfo then
        updatePetInfo()
    end
    
    if #cachedFinds == 0 then
        local emptyFrame = Instance.new("Frame")
        emptyFrame.Name = "WaitingFrame"
        emptyFrame.Size = UDim2.new(1, -16, 0, 120)
        emptyFrame.BackgroundTransparency = 1
        emptyFrame.Parent = ContentFrame
        
        local emptyLabel = Instance.new("TextLabel")
        emptyLabel.Size = UDim2.new(1, 0, 1, 0)
        emptyLabel.BackgroundTransparency = 1
        emptyLabel.Text = "⏳ Waiting for finds...\n\nBots will appear here when they find pets above threshold."
        emptyLabel.TextColor3 = Colors.TextSecondary
        emptyLabel.TextSize = isMobile and 12 or 14
        emptyLabel.Font = Enum.Font.Gotham
        emptyLabel.TextWrapped = true
        emptyLabel.TextYAlignment = Enum.TextYAlignment.Center
        emptyLabel.Parent = emptyFrame
        
        StatusLabel.TextColor3 = Color3.fromRGB(255, 165, 0)
        TitleLabel.Text = "luji hub | Auto Joiner - Waiting..."
        return
    end
    
    local minMPS = MinMPSValue.Value
    local filteredFinds = {}
    local highestMPS = 0
    local highestPetName = "None"
    
    print("[GUI] Filtering finds. Total cached:", #cachedFinds, "MinMPS threshold:", minMPS)
    
    for _, find in ipairs(cachedFinds) do
        local findMPS = find.mps
        if findMPS == nil then
            findMPS = 0
        elseif type(findMPS) ~= "number" then
            findMPS = tonumber(findMPS) or 0
        end
        
        if findMPS >= minMPS then
            table.insert(filteredFinds, find)
        end
        
        if findMPS > highestMPS then
            highestMPS = findMPS
            highestPetName = find.petName or "Unknown"
        end
    end
    
    print("[GUI] After filtering:", #filteredFinds, "finds pass the threshold")
    
    if #filteredFinds > 0 then
        print("[GUI] Displaying", #filteredFinds, "filtered finds out of", #cachedFinds, "total. MinMPS:", minMPS)
        for i, find in ipairs(filteredFinds) do
            local success, card = pcall(function()
                return createFindCard(find)
            end)
            if success and card then
                card.LayoutOrder = i
                print("[GUI] Created card", i, "for:", find.petName or "Unknown", "MPS:", find.mps or 0)
            else
                warn("[GUI] Failed to create card for:", find.petName or "Unknown", "Error:", tostring(card))
            end
        end
        
        -- Force canvas size update after a brief delay
        task.spawn(function()
            task.wait(0.2)
            if ContentFrame and ContentFrame.Parent then
                updateCanvasSize()
            end
        end)
        
        StatusLabel.TextColor3 = Color3.fromRGB(0, 255, 0)
        TitleLabel.Text = "luji hub | Auto Joiner - " .. #filteredFinds .. "/" .. #cachedFinds .. " Finds | Top: " .. formatMPS(highestMPS) .. "/s"
    else
        local emptyFrame = Instance.new("Frame")
        emptyFrame.Size = UDim2.new(1, -16, 0, 100)
        emptyFrame.BackgroundTransparency = 1
        emptyFrame.Parent = ContentFrame
        
        local emptyLabel = Instance.new("TextLabel")
        emptyLabel.Size = UDim2.new(1, 0, 1, 0)
        emptyLabel.BackgroundTransparency = 1
        emptyLabel.Text = "⏳ No pets found above " .. formatMPS(minMPS) .. "/s"
        emptyLabel.TextColor3 = Colors.TextSecondary
        emptyLabel.TextSize = isMobile and 12 or 14
        emptyLabel.Font = Enum.Font.Gotham
        emptyLabel.TextWrapped = true
        emptyLabel.Parent = emptyFrame
        
        StatusLabel.TextColor3 = Color3.fromRGB(255, 165, 0)
        if #cachedFinds > 0 then
            TitleLabel.Text = "luji hub | Auto Joiner - 0/" .. #cachedFinds .. " Finds | Top: " .. formatMPS(highestMPS) .. "/s"
        else
            TitleLabel.Text = "luji hub | Auto Joiner - No Results"
        end
    end
end

local function updatePetInfo()
    -- Function kept for compatibility but no longer updates UI elements
end

local ContentFrame = Instance.new("ScrollingFrame")
ContentFrame.Size = UDim2.new(1, -8, 0, CONTENT_HEIGHT)
ContentFrame.Position = UDim2.new(0, 4, 0, HEADER_HEIGHT + SPACING)
ContentFrame.BackgroundTransparency = 1
ContentFrame.BorderSizePixel = 0
ContentFrame.ScrollBarThickness = isMobile and 5 or 4
ContentFrame.ScrollBarImageColor3 = Colors.PurpleGlow
ContentFrame.ScrollingEnabled = true
ContentFrame.ScrollingDirection = Enum.ScrollingDirection.Y
ContentFrame.ElasticBehavior = Enum.ElasticBehavior.Always
ContentFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
ContentFrame.Parent = MainFrame

local ContentLayout = Instance.new("UIListLayout")
ContentLayout.Padding = UDim.new(0, 6)
ContentLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
ContentLayout.SortOrder = Enum.SortOrder.LayoutOrder
ContentLayout.Parent = ContentFrame

MinMPSValue:GetPropertyChangedSignal("Value"):Connect(function()
    if #cachedFinds > 0 then
        filterAndDisplayFinds()
    else
        updatePetInfo()
    end
end)

local ContentPadding = Instance.new("UIPadding")
ContentPadding.PaddingLeft = UDim.new(0, 4)
ContentPadding.PaddingRight = UDim.new(0, 4)
ContentPadding.PaddingTop = UDim.new(0, 4)
ContentPadding.PaddingBottom = UDim.new(0, 4)
ContentPadding.Parent = ContentFrame

local function updateCanvasSize()
    if not ContentFrame or not ContentFrame.Parent then return end
    local contentSize = ContentLayout.AbsoluteContentSize
    local padding = ContentPadding.PaddingTop.Offset + ContentPadding.PaddingBottom.Offset
    ContentFrame.CanvasSize = UDim2.new(0, 0, 0, contentSize.Y + padding + 8)
end

ContentLayout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(updateCanvasSize)
ContentFrame:GetPropertyChangedSignal("AbsoluteSize"):Connect(updateCanvasSize)

task.spawn(function()
    while ContentFrame and ContentFrame.Parent do
        updateCanvasSize()
        task.wait(0.1)
    end
end)

local function createFindCard(find)
    local CARD_HEIGHT = isMobile and 90 or 95
    local BUTTON_WIDTH = isMobile and 55 or 60
    local BUTTON_HEIGHT = isMobile and 32 or 30
    
    local card = Instance.new("Frame")
    card.Size = UDim2.new(1, -8, 0, CARD_HEIGHT)
    card.BackgroundColor3 = Colors.Secondary
    card.BorderSizePixel = 0
    card.Visible = true
    card.ZIndex = 5
    card.Parent = ContentFrame
    
    local cardCorner = Instance.new("UICorner")
    cardCorner.CornerRadius = UDim.new(0, 8)
    cardCorner.Parent = card
    
    local cardStroke = Instance.new("UIStroke")
    cardStroke.Color = Colors.PurpleGlow
    cardStroke.Thickness = 1.5
    cardStroke.Transparency = 0.3
    cardStroke.Parent = card
    
    local nameLabel = Instance.new("TextLabel")
    nameLabel.Size = UDim2.new(1, -(BUTTON_WIDTH + 12), 0, 22)
    nameLabel.Position = UDim2.new(0, 6, 0, 6)
    nameLabel.BackgroundTransparency = 1
    nameLabel.Text = "📦 " .. (find.petName or "Unknown")
    nameLabel.TextColor3 = Colors.GreenText
    nameLabel.TextSize = isMobile and 12 or 13
    nameLabel.Font = Enum.Font.GothamBold
    nameLabel.TextXAlignment = Enum.TextXAlignment.Left
    nameLabel.TextTruncate = Enum.TextTruncate.AtEnd
    nameLabel.Visible = true
    nameLabel.ZIndex = 6
    nameLabel.Parent = card
    
    local genLabel = Instance.new("TextLabel")
    genLabel.Size = UDim2.new(1, -(BUTTON_WIDTH + 12), 0, 18)
    genLabel.Position = UDim2.new(0, 6, 0, 28)
    genLabel.BackgroundTransparency = 1
    genLabel.Text = "💰 " .. (find.generation or "N/A") .. " (" .. formatMPS(find.mps or 0) .. "/s)"
    genLabel.TextColor3 = Colors.GreenText
    genLabel.TextSize = isMobile and 10 or 11
    genLabel.Font = Enum.Font.Gotham
    genLabel.TextXAlignment = Enum.TextXAlignment.Left
    genLabel.TextTruncate = Enum.TextTruncate.AtEnd
    genLabel.Parent = card
    
    local infoLabel = Instance.new("TextLabel")
    infoLabel.Size = UDim2.new(1, -(BUTTON_WIDTH + 12), 0, 16)
    infoLabel.Position = UDim2.new(0, 6, 0, 48)
    infoLabel.BackgroundTransparency = 1
    infoLabel.Text = "👤 " .. (find.accountName or "Unknown") .. " | 👥 " .. (find.playerCount or 0) .. "/" .. (find.maxPlayers or 6)
    infoLabel.TextColor3 = Colors.GreenText
    infoLabel.TextSize = isMobile and 9 or 10
    infoLabel.Font = Enum.Font.Gotham
    infoLabel.TextXAlignment = Enum.TextXAlignment.Left
    infoLabel.TextTruncate = Enum.TextTruncate.AtEnd
    infoLabel.Parent = card
    
    if find.rarity and find.rarity ~= "Unknown" then
        local rarityLabel = Instance.new("TextLabel")
        rarityLabel.Size = UDim2.new(1, -(BUTTON_WIDTH + 12), 0, 14)
        rarityLabel.Position = UDim2.new(0, 6, 0, 66)
        rarityLabel.BackgroundTransparency = 1
        rarityLabel.Text = "⭐ " .. find.rarity
        rarityLabel.TextColor3 = Colors.GreenText
        rarityLabel.TextSize = isMobile and 9 or 10
        rarityLabel.Font = Enum.Font.Gotham
        rarityLabel.TextXAlignment = Enum.TextXAlignment.Left
        rarityLabel.Parent = card
    end
    
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
    joinStroke.Color = Colors.GreenBright
    joinStroke.Thickness = 1.5
    joinStroke.Transparency = 0.2
    joinStroke.Parent = joinButton
    
    joinButton.MouseEnter:Connect(function()
        TweenService:Create(joinButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Colors.GreenHover
        }):Play()
        TweenService:Create(joinStroke, TweenInfo.new(0.2), {
            Transparency = 0
        }):Play()
    end)
    
    joinButton.MouseLeave:Connect(function()
        TweenService:Create(joinButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Colors.Green
        }):Play()
        TweenService:Create(joinStroke, TweenInfo.new(0.2), {
            Transparency = 0.3
        }):Play()
    end)
    
    joinButton.MouseButton1Click:Connect(function()
        if not find.placeId or not find.jobId then
            StarterGui:SetCore("SendNotification", {
                Title = "Auto Joiner",
                Text = "Missing server data",
                Duration = 3
            })
            joinButton.Text = "NO DATA"
            task.wait(1)
            joinButton.Text = "JOIN"
            return
        end
        
        joinButton.Text = "JOINING..."
        joinButton.BackgroundColor3 = Colors.GreenHover
        
        local placeId = tonumber(find.placeId) or game.PlaceId
        local jobId = tostring(find.jobId)
        
        local success, result = pcall(function()
            TeleportService:TeleportToPlaceInstance(placeId, jobId, LocalPlayer)
        end)
        
        if not success then
            task.wait(0.1)
            success, result = pcall(function()
                TeleportService:TeleportToPlaceInstance(placeId, jobId)
            end)
        end
        
        if success then
            StarterGui:SetCore("SendNotification", {
                Title = "Auto Joiner",
                Text = "Teleporting to server...",
                Duration = 2
            })
        else
            local joinLink = string.format("https://www.roblox.com/games/%d?privateServerLinkCode=%s", placeId, jobId)
            
            if setclipboard then
                pcall(function()
                    setclipboard(joinLink)
                end)
            end
            
            StarterGui:SetCore("SendNotification", {
                Title = "Teleport Failed",
                Text = "Error 773: Place restricted. Join link copied.",
                Duration = 5
            })
            
            task.wait(1.5)
            joinButton.Text = "JOIN"
            joinButton.BackgroundColor3 = Colors.Green
        end
    end)
    
    return card
end

local function fetchFinds()
    if not API_KEY or API_KEY == "" then
        warn("[GUI] API_KEY not set! Set your LuArmor license key to view finds.")
        StatusLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
        TitleLabel.Text = "luji hub | Auto Joiner - No API Key"
        return
    end
    
    local success, response = pcall(function()
        if syn and syn.request then
            local res = syn.request({
                Url = API_URL,
                Method = "GET",
                Headers = {
                    ["X-API-Key"] = API_KEY
                }
            })
            return res.Body
        elseif request then
            local res = request({
                Url = API_URL,
                Method = "GET",
                Headers = {
                    ["X-API-Key"] = API_KEY
                }
            })
            return res.Body
        else
            -- HttpService RequestAsync with headers
            local response = HttpService:RequestAsync({
                Url = API_URL,
                Method = "GET",
                Headers = {
                    ["X-API-Key"] = API_KEY
                }
            })
            return response.Body
        end
    end)
    
    if success and response then
        local success2, data = pcall(function()
            return HttpService:JSONDecode(response)
        end)
        
        if success2 and data then
            local finds = nil
            if type(data) == "table" then
                if data.success and data.finds then
                    finds = data.finds
                elseif data.finds then
                    finds = data.finds
                elseif type(data[1]) == "table" then
                    finds = data
                end
            end
            
            if finds and type(finds) == "table" then
                local previousCount = #cachedFinds
                cachedFinds = finds
                
                print("[GUI] Received", #cachedFinds, "finds from API")
                
                if #cachedFinds > 0 then
                    print("[GUI] First find sample:", cachedFinds[1])
                    if cachedFinds[1] then
                        local keys = {}
                        for k in pairs(cachedFinds[1]) do
                            table.insert(keys, tostring(k))
                        end
                        print("[GUI] First find keys:", table.concat(keys, ", "))
                        print("[GUI] First find mps value:", cachedFinds[1].mps, "type:", type(cachedFinds[1].mps))
                    end
                end
                
                if #cachedFinds > 0 and previousCount == 0 then
                    for _, child in pairs(ContentFrame:GetChildren()) do
                        if child:IsA("Frame") and (child.Name == "WaitingFrame" or child.Name ~= "UIListLayout" and child.Name ~= "UIPadding") then
                            child:Destroy()
                        end
                    end
                end
                
                filterAndDisplayFinds()
                updatePetInfo()
            else
                warn("[GUI] API response format issue. Data type:", type(data), "Has finds:", data and data.finds ~= nil)
                if data and type(data) == "table" then
                    local keys = {}
                    for k in pairs(data) do
                        table.insert(keys, tostring(k))
                    end
                    print("[GUI] Response keys:", table.concat(keys, ", "))
                end
                if #cachedFinds == 0 then
                    cachedFinds = {}
                    for _, child in pairs(ContentFrame:GetChildren()) do
                        if child:IsA("Frame") and child.Name ~= "UIListLayout" and child.Name ~= "UIPadding" then
                            child:Destroy()
                        end
                    end
                    
                    local emptyFrame = Instance.new("Frame")
                    emptyFrame.Name = "WaitingFrame"
                    emptyFrame.Size = UDim2.new(1, -16, 0, 120)
                    emptyFrame.BackgroundTransparency = 1
                    emptyFrame.Parent = ContentFrame
                    
                    local emptyLabel = Instance.new("TextLabel")
                    emptyLabel.Size = UDim2.new(1, 0, 1, 0)
                    emptyLabel.BackgroundTransparency = 1
                    emptyLabel.Text = "⏳ Waiting for finds...\n\nBots will appear here when they find pets above threshold."
                    emptyLabel.TextColor3 = Colors.TextSecondary
                    emptyLabel.TextSize = isMobile and 12 or 14
                    emptyLabel.Font = Enum.Font.Gotham
                    emptyLabel.TextWrapped = true
                    emptyLabel.TextYAlignment = Enum.TextYAlignment.Center
                    emptyLabel.Parent = emptyFrame
                    
                    StatusLabel.TextColor3 = Color3.fromRGB(255, 165, 0)
                    TitleLabel.Text = "luji hub | Auto Joiner - Waiting..."
                    updatePetInfo()
                end
            end
        else
            warn("[GUI] Failed to decode API response:", tostring(response))
            if #cachedFinds == 0 then
                cachedFinds = {}
                for _, child in pairs(ContentFrame:GetChildren()) do
                    if child:IsA("Frame") and child.Name ~= "UIListLayout" and child.Name ~= "UIPadding" then
                        child:Destroy()
                    end
                end
                
                local emptyFrame = Instance.new("Frame")
                emptyFrame.Name = "WaitingFrame"
                emptyFrame.Size = UDim2.new(1, -16, 0, 120)
                emptyFrame.BackgroundTransparency = 1
                emptyFrame.Parent = ContentFrame
                
                local emptyLabel = Instance.new("TextLabel")
                emptyLabel.Size = UDim2.new(1, 0, 1, 0)
                emptyLabel.BackgroundTransparency = 1
                emptyLabel.Text = "⏳ Waiting for finds...\n\nBots will appear here when they find pets above threshold."
                emptyLabel.TextColor3 = Colors.TextSecondary
                emptyLabel.TextSize = isMobile and 12 or 14
                emptyLabel.Font = Enum.Font.Gotham
                emptyLabel.TextWrapped = true
                emptyLabel.TextYAlignment = Enum.TextYAlignment.Center
                emptyLabel.Parent = emptyFrame
                
                StatusLabel.TextColor3 = Color3.fromRGB(255, 165, 0)
                TitleLabel.Text = "luji hub | Auto Joiner - Waiting..."
                updatePetInfo()
            end
        end
    else
        warn("[GUI] Failed to fetch from API:", tostring(response))
        StatusLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
    end
end

task.spawn(function()
    while ScreenGui.Parent do
        fetchFinds()
        task.wait(UPDATE_INTERVAL)
    end
end)

task.wait(1)
fetchFinds()

task.spawn(function()
    if not getgenv().LoadedPetFinderUI then
        getgenv().LoadedPetFinderUI = true
        local OpenUI = Instance.new("ScreenGui")
        OpenUI.Name = "PetFinderOpenUI"
        OpenUI.Parent = CoreGui
        OpenUI.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
        OpenUI.ResetOnSpawn = false

        local BUTTON_SIZE = isMobile and 55 or 45
        local ToggleButton = Instance.new("TextButton")
        ToggleButton.Size = UDim2.new(0, BUTTON_SIZE, 0, BUTTON_SIZE)
        ToggleButton.Position = UDim2.new(0, 10, 0, 10)
        ToggleButton.BackgroundColor3 = Colors.Secondary
        ToggleButton.Text = "PF"
        ToggleButton.TextColor3 = Colors.Accent
        ToggleButton.TextSize = isMobile and 9 or 8
        ToggleButton.Font = Enum.Font.GothamBold
        ToggleButton.BorderSizePixel = 0
        ToggleButton.AutoButtonColor = false
        ToggleButton.ZIndex = 10
        ToggleButton.Parent = OpenUI

        local toggleCorner = Instance.new("UICorner")
        toggleCorner.CornerRadius = UDim.new(0, isMobile and 12 or 10)
        toggleCorner.Parent = ToggleButton

        local toggleStroke = Instance.new("UIStroke")
        toggleStroke.Color = Colors.Accent
        toggleStroke.Thickness = 2
        toggleStroke.Transparency = 0.2
        toggleStroke.Parent = ToggleButton

        local toggleDragging = false
        local toggleDragStart = nil
        local toggleStartPos = nil
        local toggleDragInput = nil
        local hasMoved = false

        local function updateToggle(input)
            if not toggleDragging or not toggleDragStart or not toggleStartPos then return end
            local delta = input.Position - toggleDragStart
            if delta.Magnitude > 5 then hasMoved = true end
            local newX = toggleStartPos.X.Offset + delta.X
            local newY = toggleStartPos.Y.Offset + delta.Y
            newX = math.clamp(newX, 0, viewportSize.X - BUTTON_SIZE)
            newY = math.clamp(newY, 0, viewportSize.Y - BUTTON_SIZE)
            ToggleButton.Position = UDim2.new(0, newX, 0, newY)
        end

        ToggleButton.InputBegan:Connect(function(input)
            if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
                toggleDragging = true
                hasMoved = false
                toggleDragStart = input.Position
                toggleStartPos = ToggleButton.Position
            end
        end)

        ToggleButton.InputChanged:Connect(function(input)
            if input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch then
                toggleDragInput = input
            end
        end)

        UserInputService.InputChanged:Connect(function(input)
            if input == toggleDragInput and toggleDragging then
                updateToggle(input)
            end
        end)

        UserInputService.InputEnded:Connect(function(input)
            if (input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch) and toggleDragging then
                local dragDistance = toggleDragStart and (input.Position - toggleDragStart).Magnitude or 0
                if dragDistance < 5 and not hasMoved then
                    ScreenGui.Enabled = not ScreenGui.Enabled
                end
                toggleDragging = false
                toggleDragStart = nil
                toggleStartPos = nil
                toggleDragInput = nil
                hasMoved = false
            end
        end)

        if not isMobile then
            ToggleButton.MouseEnter:Connect(function()
                TweenService:Create(ToggleButton, TweenInfo.new(0.2), {
                    BackgroundColor3 = Color3.fromRGB(45, 45, 50),
                    Size = UDim2.new(0, BUTTON_SIZE + 4, 0, BUTTON_SIZE + 4),
                }):Play()
            end)
            ToggleButton.MouseLeave:Connect(function()
                TweenService:Create(ToggleButton, TweenInfo.new(0.2), {
                    BackgroundColor3 = Colors.Secondary,
                    Size = UDim2.new(0, BUTTON_SIZE, 0, BUTTON_SIZE),
                }):Play()
            end)
        end
    end
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if not gameProcessed and input.KeyCode == Enum.KeyCode.LeftControl then
        ScreenGui.Enabled = not ScreenGui.Enabled
    end
end)
