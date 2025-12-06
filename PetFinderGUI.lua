repeat task.wait() until game:IsLoaded() and game.Players.LocalPlayer
task.wait(1)

local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local CoreGui = game:GetService("CoreGui")
local LocalPlayer = Players.LocalPlayer

pcall(function()
    HttpService.HttpEnabled = true
end)

local API_URL = "https://empathetic-transformation-production.up.railway.app/api/finds/recent"

-- Luji Hub Colors
local Colors = {
    Background = Color3.fromRGB(15, 15, 25),
    Secondary = Color3.fromRGB(35, 35, 40),
    Accent = Color3.fromRGB(0, 162, 255),
    AccentHover = Color3.fromRGB(50, 200, 255),
    Text = Color3.fromRGB(255, 255, 255),
    TextSecondary = Color3.fromRGB(200, 200, 200),
    Purple = Color3.fromRGB(180, 120, 255),
    PurpleGlow = Color3.fromRGB(100, 50, 200),
    TitleBar = Color3.fromRGB(25, 15, 45),
    Button = Color3.fromRGB(45, 45, 50),
    ButtonHover = Color3.fromRGB(55, 55, 60),
    Green = Color3.fromRGB(76, 175, 80),
}

-- Create GUI
local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name = "LujiHubAutoJoiner"
ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
ScreenGui.ResetOnSpawn = false
ScreenGui.Parent = CoreGui

local MainFrame = Instance.new("Frame")
MainFrame.Size = UDim2.new(0, 400, 0, 500)
MainFrame.Position = UDim2.new(0.5, -200, 0.5, -250)
MainFrame.BackgroundColor3 = Colors.Background
MainFrame.BackgroundTransparency = 0.1
MainFrame.BorderSizePixel = 0
MainFrame.Active = true
MainFrame.Draggable = true
MainFrame.Parent = ScreenGui

local UICorner = Instance.new("UICorner")
UICorner.CornerRadius = UDim.new(0, 15)
UICorner.Parent = MainFrame

local UIStroke = Instance.new("UIStroke")
UIStroke.Color = Colors.PurpleGlow
UIStroke.Thickness = 2
UIStroke.Transparency = 0.3
UIStroke.Parent = MainFrame

-- Title Bar
local TitleBar = Instance.new("Frame")
TitleBar.Size = UDim2.new(1, 0, 0, 35)
TitleBar.Position = UDim2.new(0, 0, 0, 0)
TitleBar.BackgroundColor3 = Colors.TitleBar
TitleBar.BackgroundTransparency = 0.1
TitleBar.BorderSizePixel = 0
TitleBar.Parent = MainFrame

local TitleBarCorner = Instance.new("UICorner")
TitleBarCorner.CornerRadius = UDim.new(0, 15)
TitleBarCorner.Parent = TitleBar

local Title = Instance.new("TextLabel")
Title.Size = UDim2.new(1, 0, 1, 0)
Title.BackgroundTransparency = 1
Title.Text = "LUJI HUB AUTO JOINER"
Title.Font = Enum.Font.GothamBold
Title.TextSize = 18
Title.TextColor3 = Colors.Purple
Title.TextStrokeTransparency = 0.7
Title.TextStrokeColor3 = Color3.fromRGB(0, 0, 0)
Title.Parent = TitleBar

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
ListLayout.Padding = UDim.new(0, 5)
ListLayout.SortOrder = Enum.SortOrder.LayoutOrder
ListLayout.Parent = ScrollFrame

local Padding = Instance.new("UIPadding")
Padding.PaddingTop = UDim.new(0, 5)
Padding.PaddingBottom = UDim.new(0, 5)
Padding.PaddingLeft = UDim.new(0, 5)
Padding.PaddingRight = UDim.new(0, 5)
Padding.Parent = ScrollFrame

-- Function to create a card for a find
local function createCard(find)
    local card = Instance.new("Frame")
    card.Size = UDim2.new(1, -10, 0, 85)
    card.BackgroundColor3 = Colors.Secondary
    card.BorderSizePixel = 0
    card.Parent = ScrollFrame
    
    local cardCorner = Instance.new("UICorner")
    cardCorner.CornerRadius = UDim.new(0, 8)
    cardCorner.Parent = card
    
    local cardStroke = Instance.new("UIStroke")
    cardStroke.Color = Colors.PurpleGlow
    cardStroke.Thickness = 1.5
    cardStroke.Transparency = 0.5
    cardStroke.Parent = card
    
    -- Pet name
    local nameLabel = Instance.new("TextLabel")
    nameLabel.Size = UDim2.new(1, -75, 0, 25)
    nameLabel.Position = UDim2.new(0, 10, 0, 5)
    nameLabel.BackgroundTransparency = 1
    nameLabel.Text = "📦 " .. (find.petName or "Unknown")
    nameLabel.TextColor3 = Colors.Accent
    nameLabel.TextSize = 14
    nameLabel.Font = Enum.Font.GothamBold
    nameLabel.TextXAlignment = Enum.TextXAlignment.Left
    nameLabel.Parent = card
    
    -- Generation and MPS
    local genLabel = Instance.new("TextLabel")
    genLabel.Size = UDim2.new(1, -75, 0, 20)
    genLabel.Position = UDim2.new(0, 10, 0, 30)
    genLabel.BackgroundTransparency = 1
    genLabel.Text = "Gen: " .. (find.generation or "N/A") .. " | MPS: " .. (find.mps or 0)
    genLabel.TextColor3 = Colors.TextSecondary
    genLabel.TextSize = 12
    genLabel.Font = Enum.Font.Gotham
    genLabel.TextXAlignment = Enum.TextXAlignment.Left
    genLabel.Parent = card
    
    -- Account and players
    local infoLabel = Instance.new("TextLabel")
    infoLabel.Size = UDim2.new(1, -75, 0, 18)
    infoLabel.Position = UDim2.new(0, 10, 0, 52)
    infoLabel.BackgroundTransparency = 1
    infoLabel.Text = "👤 " .. (find.accountName or "Unknown") .. " | 👥 " .. (find.playerCount or 0) .. "/" .. (find.maxPlayers or 6)
    infoLabel.TextColor3 = Colors.TextSecondary
    infoLabel.TextSize = 11
    infoLabel.Font = Enum.Font.Gotham
    infoLabel.TextXAlignment = Enum.TextXAlignment.Left
    infoLabel.Parent = card
    
    -- Join button
    local joinButton = Instance.new("TextButton")
    joinButton.Size = UDim2.new(0, 65, 0, 32)
    joinButton.Position = UDim2.new(1, -70, 0.5, -16)
    joinButton.BackgroundColor3 = Colors.Green
    joinButton.Text = "JOIN"
    joinButton.TextColor3 = Colors.Text
    joinButton.TextSize = 12
    joinButton.Font = Enum.Font.GothamBold
    joinButton.BorderSizePixel = 0
    joinButton.AutoButtonColor = false
    joinButton.Parent = card
    
    local joinCorner = Instance.new("UICorner")
    joinCorner.CornerRadius = UDim.new(0, 6)
    joinCorner.Parent = joinButton
    
    local joinStroke = Instance.new("UIStroke")
    joinStroke.Color = Colors.Accent
    joinStroke.Thickness = 1
    joinStroke.Transparency = 0.3
    joinStroke.Parent = joinButton
    
    -- Button hover effects
    joinButton.MouseEnter:Connect(function()
        TweenService:Create(joinButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Color3.fromRGB(102, 187, 106),
            Size = UDim2.new(0, 67, 0, 34)
        }):Play()
    end)
    
    joinButton.MouseLeave:Connect(function()
        TweenService:Create(joinButton, TweenInfo.new(0.2), {
            BackgroundColor3 = Colors.Green,
            Size = UDim2.new(0, 65, 0, 32)
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
            local contentSize = ListLayout.AbsoluteContentSize
            ScrollFrame.CanvasSize = UDim2.new(0, 0, 0, contentSize.Y + 10)
            
            Title.Text = "LUJI HUB AUTO JOINER - " .. #data.finds .. " FINDS"
        else
            Title.Text = "LUJI HUB AUTO JOINER - NO FINDS"
        end
    end
end

-- Fetch finds every second
task.spawn(function()
    while ScreenGui.Parent do
        fetchFinds()
        task.wait(1)
    end
end)

-- Initial fetch
task.wait(0.5)
fetchFinds()
