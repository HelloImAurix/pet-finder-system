repeat task.wait() until game:IsLoaded() and game.Players.LocalPlayer
task.wait(1)

local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local CoreGui = game:GetService("CoreGui")
local LocalPlayer = Players.LocalPlayer

pcall(function()
    HttpService.HttpEnabled = true
end)

local API_URL = "https://empathetic-transformation-production.up.railway.app/api/finds/recent"

-- Create GUI
local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name = "PetFinderGUI"
ScreenGui.ResetOnSpawn = false
ScreenGui.Parent = CoreGui

local MainFrame = Instance.new("Frame")
MainFrame.Size = UDim2.new(0, 400, 0, 500)
MainFrame.Position = UDim2.new(0.5, -200, 0.5, -250)
MainFrame.BackgroundColor3 = Color3.fromRGB(25, 25, 30)
MainFrame.BorderSizePixel = 0
MainFrame.Parent = ScreenGui

local UICorner = Instance.new("UICorner")
UICorner.CornerRadius = UDim.new(0, 10)
UICorner.Parent = MainFrame

-- Title
local TitleLabel = Instance.new("TextLabel")
TitleLabel.Size = UDim2.new(1, 0, 0, 40)
TitleLabel.Position = UDim2.new(0, 0, 0, 0)
TitleLabel.BackgroundColor3 = Color3.fromRGB(35, 35, 40)
TitleLabel.Text = "luji hub | Pet Finder"
TitleLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
TitleLabel.TextSize = 16
TitleLabel.Font = Enum.Font.GothamBold
TitleLabel.BorderSizePixel = 0
TitleLabel.Parent = MainFrame

local TitleCorner = Instance.new("UICorner")
TitleCorner.CornerRadius = UDim.new(0, 10)
TitleCorner.Parent = TitleLabel

-- Scroll Frame for finds
local ScrollFrame = Instance.new("ScrollingFrame")
ScrollFrame.Size = UDim2.new(1, -10, 1, -50)
ScrollFrame.Position = UDim2.new(0, 5, 0, 45)
ScrollFrame.BackgroundTransparency = 1
ScrollFrame.BorderSizePixel = 0
ScrollFrame.ScrollBarThickness = 4
ScrollFrame.Parent = MainFrame

local ListLayout = Instance.new("UIListLayout")
ListLayout.Padding = UDim.new(0, 5)
ListLayout.SortOrder = Enum.SortOrder.LayoutOrder
ListLayout.Parent = ScrollFrame

local Padding = Instance.new("UIPadding")
Padding.PaddingTop = UDim.new(0, 5)
Padding.PaddingBottom = UDim.new(0, 5)
Padding.Parent = ScrollFrame

-- Function to create a card for a find
local function createCard(find)
    local card = Instance.new("Frame")
    card.Size = UDim2.new(1, -10, 0, 80)
    card.BackgroundColor3 = Color3.fromRGB(35, 35, 40)
    card.BorderSizePixel = 0
    card.Parent = ScrollFrame
    
    local cardCorner = Instance.new("UICorner")
    cardCorner.CornerRadius = UDim.new(0, 8)
    cardCorner.Parent = card
    
    -- Pet name
    local nameLabel = Instance.new("TextLabel")
    nameLabel.Size = UDim2.new(1, -70, 0, 25)
    nameLabel.Position = UDim2.new(0, 10, 0, 5)
    nameLabel.BackgroundTransparency = 1
    nameLabel.Text = "📦 " .. (find.petName or "Unknown")
    nameLabel.TextColor3 = Color3.fromRGB(129, 199, 132)
    nameLabel.TextSize = 14
    nameLabel.Font = Enum.Font.GothamBold
    nameLabel.TextXAlignment = Enum.TextXAlignment.Left
    nameLabel.Parent = card
    
    -- Generation and MPS
    local genLabel = Instance.new("TextLabel")
    genLabel.Size = UDim2.new(1, -70, 0, 20)
    genLabel.Position = UDim2.new(0, 10, 0, 30)
    genLabel.BackgroundTransparency = 1
    genLabel.Text = "Gen: " .. (find.generation or "N/A") .. " | MPS: " .. (find.mps or 0)
    genLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
    genLabel.TextSize = 12
    genLabel.Font = Enum.Font.Gotham
    genLabel.TextXAlignment = Enum.TextXAlignment.Left
    genLabel.Parent = card
    
    -- Account and players
    local infoLabel = Instance.new("TextLabel")
    infoLabel.Size = UDim2.new(1, -70, 0, 18)
    infoLabel.Position = UDim2.new(0, 10, 0, 52)
    infoLabel.BackgroundTransparency = 1
    infoLabel.Text = "👤 " .. (find.accountName or "Unknown") .. " | 👥 " .. (find.playerCount or 0) .. "/" .. (find.maxPlayers or 6)
    infoLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
    infoLabel.TextSize = 11
    infoLabel.Font = Enum.Font.Gotham
    infoLabel.TextXAlignment = Enum.TextXAlignment.Left
    infoLabel.Parent = card
    
    -- Join button
    local joinButton = Instance.new("TextButton")
    joinButton.Size = UDim2.new(0, 60, 0, 30)
    joinButton.Position = UDim2.new(1, -70, 0.5, -15)
    joinButton.BackgroundColor3 = Color3.fromRGB(76, 175, 80)
    joinButton.Text = "JOIN"
    joinButton.TextColor3 = Color3.fromRGB(255, 255, 255)
    joinButton.TextSize = 12
    joinButton.Font = Enum.Font.GothamBold
    joinButton.BorderSizePixel = 0
    joinButton.Parent = card
    
    local joinCorner = Instance.new("UICorner")
    joinCorner.CornerRadius = UDim.new(0, 6)
    joinCorner.Parent = joinButton
    
    -- Join functionality
    joinButton.MouseButton1Click:Connect(function()
        if find.placeId and find.jobId then
            joinButton.Text = "JOINING..."
            joinButton.BackgroundColor3 = Color3.fromRGB(255, 165, 0)
            TeleportService:Teleport(tonumber(find.placeId), LocalPlayer, {find.jobId})
            task.wait(1.5)
            joinButton.Text = "JOIN"
            joinButton.BackgroundColor3 = Color3.fromRGB(76, 175, 80)
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
            
            TitleLabel.Text = "luji hub | Pet Finder - " .. #data.finds .. " Finds"
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
