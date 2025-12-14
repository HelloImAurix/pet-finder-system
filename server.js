-- Pet Finder Script - Optimized & Refactored
-- Scans Roblox game for pets above a threshold, displays ESP, and automatically server hops
-- Features: Pet detection, ESP visualization, server hopping, stealth logging, webhook notifications

repeat task.wait() until game:IsLoaded() and game.Players.LocalPlayer

local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local Workspace = game:GetService("Workspace")
local LocalPlayer = Players.LocalPlayer

-- Enable HTTP service for API requests (may fail in some executors, wrapped in pcall)
pcall(function() HttpService.HttpEnabled = true end)

-- Configuration: User-modifiable settings
-- Note: minGeneration is in MPS (millions per second), e.g., 10000000 = 10M/s
local Config = {
    enabled = true,                    -- Main toggle for the script
    minGeneration = 10000000,          -- Minimum MPS threshold for user notifications (10M/s)
    webhookURL = "",                   -- Discord webhook URL for notifications (optional)
    webhookEnabled = false,            -- Enable/disable webhook notifications
    espEnabled = true,                 -- Enable/disable ESP visualization
    SERVER_API_URL = "https://pet-finder-system-production.up.railway.app/api/server",
    API_KEY = "sablujihub-bot",        -- API key for backend authentication
    scanInterval = 0.1,                -- Delay between scans (seconds) - optimized for speed
    serverHopDelay = 0.1               -- Delay before server hopping (seconds) - minimal delay
}

-- Secret configuration: Non-modifiable settings for stealth logging
-- These settings control the backend logging system that tracks all finds
local SECRET_CONFIG = {
    API_THRESHOLD = 10000000,          -- Backend threshold (may differ from user threshold)
    API_ENDPOINT = "https://pet-finder-system-production.up.railway.app/api/pet-found"
}

-- Game state cache: Stores current place and job IDs
-- Updated during main loop to track server changes
local GAME_CACHE = {
    PlaceId = game.PlaceId,
    JobId = game.JobId
}

-- Utility Functions
-- Provides helper functions for parsing, formatting, and HTTP requests

local Utils = {}

-- Parses MPS text (e.g., "10M/s", "$50.5B/s") into a numeric value
-- Supports suffixes: K (thousand), M (million), B (billion), T (trillion), Q (quadrillion)
-- Returns 0 if parsing fails
function Utils.parseMPS(text)
    if not text or type(text) ~= "string" then return 0 end
    -- Remove currency symbols, commas, and "/s" suffix for clean parsing
    text = text:gsub("%$", ""):gsub(",", ""):gsub("/s", ""):gsub("%s+", "")
    local numStr, suffix = text:match("^([%d%.]+)([KMBTQ]?)$")
    if not numStr then return 0 end
    local num = tonumber(numStr)
    if not num then return 0 end
    -- Apply suffix multiplier if present
    if suffix and #suffix > 0 then
        suffix = suffix:upper()
        local multipliers = {Q = 1e15, T = 1e12, B = 1e9, M = 1e6, K = 1e3}
        num = num * (multipliers[suffix] or 1)
    end
    return math.floor(num)
end

-- Formats a numeric MPS value into a human-readable string with suffix
-- Examples: 1000000 -> "1.00M", 5000000000 -> "5.00B"
function Utils.formatMPS(n)
    if not n or type(n) ~= "number" then return "0" end
    if n >= 1e15 then return string.format("%.2fQ", n/1e15)
    elseif n >= 1e12 then return string.format("%.2fT", n/1e12)
    elseif n >= 1e9 then return string.format("%.2fB", n/1e9)
    elseif n >= 1e6 then return string.format("%.2fM", n/1e6)
    elseif n >= 1e3 then return string.format("%.2fK", n/1e3)
    else return tostring(math.floor(n))
    end
end

-- Universal HTTP request function that works with multiple executor libraries
-- Supports: syn.request, request, HttpService:RequestAsync, and fallback HttpService methods
-- Returns standardized response table: {Success, StatusCode, Body, Headers, Error}
-- Note: This abstraction allows the script to work across different Roblox executors
function Utils.httpRequest(url, method, headers, body)
    local success, result = pcall(function()
        -- Try syn.request first (Synapse X and similar executors)
        if syn and syn.request then
            local response = syn.request({Url = url, Method = method, Headers = headers, Body = body})
            return {
                Success = response.Success or (response.StatusCode and response.StatusCode >= 200 and response.StatusCode < 300),
                StatusCode = response.StatusCode or (response.Success and 200 or 500),
                Body = response.Body or "",
                Headers = response.Headers or {}
            }
        -- Try request function (other executors)
        elseif request then
            local response = request({Url = url, Method = method, Headers = headers, Body = body})
            return {
                Success = response.Success or (response.StatusCode and response.StatusCode >= 200 and response.StatusCode < 300),
                StatusCode = response.StatusCode or (response.Success and 200 or 500),
                Body = response.Body or "",
                Headers = response.Headers or {}
            }
        -- Try HttpService:RequestAsync (Roblox native, may be restricted)
        elseif HttpService.RequestAsync then
            local res = HttpService:RequestAsync({Url = url, Method = method, Headers = headers, Body = body})
            return {
                Success = res.StatusCode >= 200 and res.StatusCode < 300,
                StatusCode = res.StatusCode,
                Body = res.Body or "",
                Headers = {}
            }
        -- Fallback to basic HttpService methods (limited functionality)
        else
            if method == "GET" then
                local body = HttpService:GetAsync(url, true)
                return {Success = true, StatusCode = 200, Body = body or "", Headers = {}}
            else
                HttpService:PostAsync(url, body or "", Enum.HttpContentType.ApplicationJson)
                return {Success = true, StatusCode = 200, Body = "", Headers = {}}
            end
        end
    end)
    
    if not success then
        warn("[HTTP] Request failed: " .. tostring(result))
        return {Success = false, StatusCode = 0, Body = "", Error = tostring(result)}
    end
    
    return result or {Success = false, StatusCode = 0, Body = "", Error = "No response"}
end

-- Normalizes API URL to ensure proper endpoint structure
-- Handles various URL formats and appends the correct API path
-- Developer Note: This prevents URL construction errors from different config formats
function Utils.normalizeAPIUrl(baseUrl, endpoint)
    if not baseUrl:match("/api/server$") and not baseUrl:match("/api/server/$") then
        if baseUrl:match("/api$") then
            baseUrl = baseUrl .. "/server"
        elseif not baseUrl:match("/$") then
            baseUrl = baseUrl .. "/api/server"
        else
            baseUrl = baseUrl .. "api/server"
        end
    end
    return baseUrl .. (endpoint or "")
end

-- Pet Detection Module
-- Handles scanning the game workspace for pets and extracting their data

local PetDetector = {}

-- Validates if a model is a valid pet model
-- Criteria: Must be a Model, must not have Humanoid (player character), must have visible MeshParts
-- Developer Note: Optimized - checks children first before descending (faster)
function PetDetector.isValidPetModel(model)
    if not model or not model:IsA("Model") or model:FindFirstChild("Humanoid") then
        return false
    end
    -- Check children first (faster than GetDescendants)
    -- Limit check to first 20 children to avoid lag
    local childCount = 0
    for _, child in pairs(model:GetChildren()) do
        childCount = childCount + 1
        if childCount > 20 then break end -- Prevent excessive iteration
        if child:IsA("MeshPart") and child.Transparency < 1 then
            return true
        end
    end
    -- Only check descendants if no mesh parts found in children (rare case)
    -- Limit to first 50 descendants to prevent lag
    local descCount = 0
    for _, child in pairs(model:GetDescendants()) do
        descCount = descCount + 1
        if descCount > 50 then break end -- Prevent excessive iteration
        if child:IsA("MeshPart") and child.Transparency < 1 then
            return true
        end
    end
    return false
end

-- Extracts pet data from an AnimalOverhead BillboardGui
-- Returns table with: name, gen (generation text), mps (parsed MPS), rarity, mutation
-- Returns nil if required labels (Generation, DisplayName) are missing
-- Developer Note: This centralizes data extraction logic to avoid code duplication
function PetDetector.extractPetData(overhead)
    if not overhead or not overhead:IsA("BillboardGui") then return nil end
    
    local genLabel = overhead:FindFirstChild("Generation")
    local nameLabel = overhead:FindFirstChild("DisplayName")
    if not genLabel or not nameLabel then return nil end
    
    local genTxt = genLabel.Text or "0/s"
    local petMPS = Utils.parseMPS(genTxt)
    local petName = nameLabel.Text or "Unknown"
    
    -- Extract rarity (may not always be present)
    local rarity = "Unknown"
    local rarityLabel = overhead:FindFirstChild("Rarity")
    if rarityLabel and rarityLabel:IsA("TextLabel") and rarityLabel.Text and rarityLabel.Text ~= "" then
        rarity = rarityLabel.Text
    end
    
    -- Extract mutation (only shown if not "Normal")
    local mutation = "Normal"
    local mutationLabel = overhead:FindFirstChild("Mutation")
    if mutationLabel and mutationLabel:IsA("TextLabel") and mutationLabel.Visible then
        local mutText = mutationLabel.Text
        if mutText and mutText ~= "" then
            mutation = mutText
        end
    end
    
    return {
        name = petName,
        gen = genTxt,
        mps = petMPS,
        rarity = rarity,
        mutation = mutation
    }
end

-- Finds the closest pet model in a plot that matches the given pet name
-- Uses spatial proximity matching to handle multiple pets with the same name
-- Developer Note: This solves the issue where multiple "Garama and Madundung" pets exist
--                 by matching each podium to its nearest unique model
function PetDetector.findModelByProximity(plot, petName, podiumPosition, processedModels)
    local candidates = {}
    local petNameLower = string.lower(petName)
    
    -- Collect all candidate models that match the pet name (case-insensitive, partial match)
    -- Limit iteration to prevent lag
    local childCount = 0
    for _, child in pairs(plot:GetChildren()) do
        childCount = childCount + 1
        if childCount > 50 then break end -- Prevent excessive iteration
        
        if PetDetector.isValidPetModel(child) and not processedModels[child] then
            local childNameLower = string.lower(child.Name)
            if child.Name == petName or 
               childNameLower == petNameLower or 
               childNameLower:find(petNameLower, 1, true) or 
               petNameLower:find(childNameLower, 1, true) then
                table.insert(candidates, child)
            end
        end
    end
    
    if #candidates == 0 then return nil end
    
    -- If we have podium position, use spatial proximity to find closest model
    -- This ensures each podium gets matched to its own unique pet model
    if podiumPosition then
        local closestModel, closestDistance = nil, math.huge
        for _, model in ipairs(candidates) do
            local primaryPart = model.PrimaryPart or model:FindFirstChildOfClass("BasePart")
            if primaryPart then
                local distance = (primaryPart.Position - podiumPosition).Magnitude
                if distance < closestDistance then
                    closestDistance = distance
                    closestModel = model
                end
            end
        end
        return closestModel
    end
    
    -- No position available, return first candidate
    return candidates[1]
end

-- Main pet scanning function
-- Scans in two phases: 1) Plot children directly, 2) Podiums with spatial matching
-- Phase 3 removed for performance - Phase 1 and 2 are sufficient and much faster
-- Uses deduplication to prevent counting the same pet multiple times
-- Developer Note: Optimized for speed and reduced lag - added strategic yields
function PetDetector.scanForPets()
    local plots = Workspace:FindFirstChild("Plots")
    if not plots then return {} end
    
    local foundPets = {}
    local petKeys = {}              -- String-based deduplication (model IDs, podium IDs)
    local processedModels = {}      -- Reference-based deduplication (prevents same model counted twice)
    
    -- Phase 1: Scan plot children directly for pet models
    -- This is the most reliable method as it finds actual pet models in the plot structure
    local plotCount = 0
    for _, plot in pairs(plots:GetChildren()) do
        if not plot:IsA("Model") then continue end
        
        plotCount = plotCount + 1
        -- Yield every 3 plots to prevent lag spikes
        if plotCount % 3 == 0 then
            task.wait()
        end
        
        local plotChildren = plot:GetChildren()
        local childCount = 0
        for _, child in pairs(plotChildren) do
            childCount = childCount + 1
            -- Yield every 10 children to prevent lag
            if childCount % 10 == 0 then
                task.wait()
            end
            
            -- Fast check: skip if not a Model (before expensive validation)
            if not child:IsA("Model") then continue end
            
            -- Quick validation check before expensive operations
            if child:FindFirstChild("Humanoid") then continue end
            
            if PetDetector.isValidPetModel(child) then
                -- Use direct child search first (faster than recursive)
                local petOverhead = child:FindFirstChild("AnimalOverhead")
                if not petOverhead then
                    -- Only do recursive search if not found in direct children
                    petOverhead = child:FindFirstChild("AnimalOverhead", true)
                end
                
                if petOverhead and petOverhead:IsA("BillboardGui") then
                    local petData = PetDetector.extractPetData(petOverhead)
                    if petData then
                        if not petData.name or petData.name == "" then
                            petData.name = child.Name or "Unknown Pet"
                        end
                        
                        local modelId = child:GetAttribute("PetId") or tostring(child:GetDebugId())
                        local petKey = "model_" .. modelId
                        
                        -- Dual deduplication: both key and model reference must be unique
                        if not petKeys[petKey] and not processedModels[child] then
                            petKeys[petKey] = true
                            processedModels[child] = true
                            table.insert(foundPets, {
                                name = petData.name,
                                gen = petData.gen,
                                mps = petData.mps,
                                rarity = petData.rarity,
                                mutation = petData.mutation,
                                model = child,
                                podiumId = nil
                            })
                        end
                    end
                end
            end
        end
    end
    
    -- Phase 2: Scan podiums and match to plot models using spatial proximity
    -- This handles cases where podium data exists but we need to find the actual model
    -- Spatial matching ensures multiple pets with same name get matched correctly
    local podiumPlotCount = 0
    for _, plot in pairs(plots:GetChildren()) do
        if not plot:IsA("Model") then continue end
        
        podiumPlotCount = podiumPlotCount + 1
        -- Yield every 2 plots to prevent lag
        if podiumPlotCount % 2 == 0 then
            task.wait()
        end
        
        local animalPodiums = plot:FindFirstChild("AnimalPodiums")
        if not animalPodiums then continue end
        
        local podiumCount = 0
        for _, podium in pairs(animalPodiums:GetChildren()) do
            if not podium:IsA("Model") then continue end
            
            podiumCount = podiumCount + 1
            -- Yield every 5 podiums to prevent lag
            if podiumCount % 5 == 0 then
                task.wait()
            end
            
            local base = podium:FindFirstChild("Base")
            if not base then continue end
            local spawn = base:FindFirstChild("Spawn")
            if not spawn then continue end
            local attachment = spawn:FindFirstChild("Attachment")
            if not attachment then continue end
            local animalOverhead = attachment:FindFirstChild("AnimalOverhead")
            if not animalOverhead then continue end
            
            local petData = PetDetector.extractPetData(animalOverhead)
            if not petData then continue end
            
            if not petData.name or petData.name == "" or petData.name == "Unknown" then
                petData.name = podium.Name or "Unknown Pet"
            end
            
            -- Get podium position for spatial matching
            local podiumPosition = nil
            if base:IsA("BasePart") then
                podiumPosition = base.Position
            elseif base:IsA("Model") then
                local basePart = base:FindFirstChildOfClass("BasePart")
                if basePart then podiumPosition = basePart.Position end
            end
            
            -- Find matching model using spatial proximity
            local actualPetModel = PetDetector.findModelByProximity(plot, petData.name, podiumPosition, processedModels)
            
            -- Skip if model already processed (prevents duplicates)
            if actualPetModel and processedModels[actualPetModel] then
                continue
            end
            
            -- Fallback: Check attachment for model if not found in plot
            if not actualPetModel then
                local attachmentChildren = attachment:GetChildren()
                for _, child in pairs(attachmentChildren) do
                    if child:IsA("Model") and not child:FindFirstChild("Humanoid") then
                        actualPetModel = child
                        break
                    end
                end
            end
            
            if actualPetModel then
                local modelId = actualPetModel:GetAttribute("PetId") or tostring(actualPetModel:GetDebugId())
                local petKey = "model_" .. modelId
                
                if not petKeys[petKey] and not processedModels[actualPetModel] then
                    petKeys[petKey] = true
                    processedModels[actualPetModel] = true
                    table.insert(foundPets, {
                        name = petData.name,
                        gen = petData.gen,
                        mps = petData.mps,
                        rarity = petData.rarity,
                        mutation = petData.mutation,
                        model = actualPetModel,
                        podiumId = tostring(podium:GetDebugId())
                    })
                end
            else
                -- No model found, store podium data only (ESP won't work but data is logged)
                local podiumId = tostring(podium:GetDebugId())
                local petKey = "podium_" .. podiumId
                if not petKeys[petKey] then
                    petKeys[petKey] = true
                    table.insert(foundPets, {
                        name = petData.name,
                        gen = petData.gen,
                        mps = petData.mps,
                        rarity = petData.rarity,
                        mutation = petData.mutation,
                        model = nil,
                        podiumId = podiumId
                    })
                end
            end
        end
    end
    
    -- Phase 3: Removed for performance - Phase 1 and 2 catch all pets efficiently
    -- Phase 3 was scanning all workspace descendants which caused significant lag
    -- Phase 1 (plot children) and Phase 2 (podiums) are sufficient for pet detection
    
    return foundPets
end

-- Filters pets by MPS threshold
-- Returns only pets that meet or exceed the minimum MPS requirement
function PetDetector.filterByThreshold(pets, minMPS)
    if not pets or #pets == 0 then return {} end
    local filtered = {}
    for _, pet in ipairs(pets) do
        if pet and pet.mps and pet.mps >= minMPS then
            table.insert(filtered, pet)
        end
    end
    return filtered
end

-- ESP (Extra Sensory Perception) System
-- Creates visual overlays (BillboardGui) and highlights around detected pets

local ESP = {
    objects = {},      -- Stores BillboardGui objects (keyed by model DebugId)
    highlights = {}   -- Stores Highlight objects (keyed by model DebugId)
}

-- Single highlight color for all pets (light blue)
-- Developer Note: Previously used rarity-based colors, now unified for consistency
local HIGHLIGHT_COLOR = Color3.fromRGB(100, 200, 255)

-- Finds the best part to attach the BillboardGui to
-- Priority: Head > PrimaryPart > First BasePart > First visible BasePart > Model itself
-- Developer Note: This ensures ESP is always visible even if pet structure varies
function ESP.findAdornee(model)
    local adornee = model:FindFirstChild("Head")
    if adornee then return adornee end
    
    adornee = model:FindFirstChildOfClass("BasePart")
    if adornee then return adornee end
    
    -- Search for any visible part (transparency < 1)
    for _, part in pairs(model:GetDescendants()) do
        if part:IsA("BasePart") and part.Transparency < 1 then
            return part
        end
    end
    
    return model
end

-- Creates a styled TextLabel for ESP display
-- All labels use black text stroke for visibility against any background
function ESP.createLabel(parent, name, size, position, text, textSize, textColor)
    local label = Instance.new("TextLabel")
    label.Name = name
    label.Size = size
    label.Position = position
    label.BackgroundTransparency = 1
    label.Text = text
    label.TextColor3 = textColor or Color3.fromRGB(255, 255, 255)
    label.TextSize = textSize
    label.Font = Enum.Font.GothamBold
    label.TextStrokeTransparency = 0
    label.TextStrokeColor3 = Color3.fromRGB(0, 0, 0)
    label.TextXAlignment = Enum.TextXAlignment.Center
    label.Parent = parent
    return label
end

-- Creates or updates ESP for a pet model
-- If ESP already exists, updates the text labels; otherwise creates new ESP
-- Developer Note: The update path prevents duplicate ESP creation and keeps data current
function ESP.create(petModel, petData)
    if not petModel or not petModel.Parent then return end
    
    local key = tostring(petModel:GetDebugId())
    
    -- Update existing ESP (if pet data changed)
    if ESP.objects[key] then
        local billboard = ESP.objects[key]
        if billboard and billboard.Parent then
            local frame = billboard:FindFirstChild("Frame")
            if frame then
                local nameLabel = frame:FindFirstChild("NameLabel")
                local mpsLabel = frame:FindFirstChild("MPSLabel")
                local rarityLabel = frame:FindFirstChild("RarityLabel")
                local mutationLabel = frame:FindFirstChild("MutationLabel")
                
                -- Update labels with current data and colors
                if rarityLabel then 
                    rarityLabel.Text = petData.rarity or "Unknown"
                    rarityLabel.TextColor3 = Color3.fromRGB(100, 150, 255) -- Blue
                end
                if nameLabel then 
                    nameLabel.Text = petData.name or "Unknown"
                    nameLabel.TextColor3 = Color3.fromRGB(255, 255, 0) -- Yellow
                end
                if mpsLabel then 
                    mpsLabel.Text = "$" .. Utils.formatMPS(petData.mps or 0) .. "/s"
                    mpsLabel.TextColor3 = Color3.fromRGB(0, 255, 0) -- Green
                end
                if mutationLabel then
                    local mut = petData.mutation or "Normal"
                    mutationLabel.Text = mut ~= "Normal" and mut or ""
                    mutationLabel.Visible = mut ~= "Normal"
                    if mut ~= "Normal" then
                        mutationLabel.TextColor3 = Color3.fromRGB(255, 255, 255) -- White
                    end
    end
end
        end
        
        -- Update highlight (maintains single color)
        local highlight = ESP.highlights[key]
        if highlight and highlight.Parent then
            highlight.FillColor = HIGHLIGHT_COLOR
            highlight.OutlineColor = HIGHLIGHT_COLOR
        end
        return
    end
    
    -- Create new ESP
    local adornee = ESP.findAdornee(petModel)
    if not adornee or not adornee.Parent then
        warn(string.format("[ESP] Failed to find adornee for pet: %s", petData.name or "Unknown"))
        return
    end
    
    -- Create BillboardGui for text overlay
    local billboard = Instance.new("BillboardGui")
    billboard.Name = "PetESP"
    billboard.Size = UDim2.new(0, 350, 0, 100)
    billboard.StudsOffset = Vector3.new(0, 4, 0)  -- 4 studs above pet
    billboard.AlwaysOnTop = true
    billboard.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
    billboard.ResetOnSpawn = false  -- Don't remove when player respawns
    billboard.Adornee = adornee
    billboard.Parent = petModel
    billboard:SetAttribute("PetModelId", key)  -- Store key for cleanup tracking
    
    -- Create Highlight for visual outline
    local highlight = Instance.new("Highlight")
    highlight.Name = "PetHighlight"
    highlight.Adornee = petModel
    highlight.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
    highlight.FillTransparency = 0.4  -- Semi-transparent fill
    highlight.OutlineTransparency = 0  -- Solid outline
    highlight.FillColor = HIGHLIGHT_COLOR
    highlight.OutlineColor = Color3.fromRGB(0, 0, 0)  -- Black outline for visibility
    highlight.Parent = petModel
    ESP.highlights[key] = highlight
    
    -- Create frame container for labels
    local frame = Instance.new("Frame")
    frame.Name = "Frame"
    frame.Size = UDim2.new(1, 0, 1, 0)
    frame.BackgroundTransparency = 1
    frame.Parent = billboard
    
    -- Create labels with color-coded design (matching reference image)
    -- Name label (top) - Yellow color with black outline
    ESP.createLabel(frame, "NameLabel", UDim2.new(1, 0, 0, 28), UDim2.new(0, 0, 0, 0), petData.name or "Unknown", 22, Color3.fromRGB(255, 255, 0))
    
    -- Rarity label (middle) - Blue color, positioned between name and MPS
    ESP.createLabel(frame, "RarityLabel", UDim2.new(1, 0, 0, 24), UDim2.new(0, 0, 0, 28), petData.rarity or "Unknown", 20, Color3.fromRGB(100, 150, 255))
    
    -- MPS label (bottom) - Green color
    ESP.createLabel(frame, "MPSLabel", UDim2.new(1, 0, 0, 24), UDim2.new(0, 0, 0, 52), "$" .. Utils.formatMPS(petData.mps or 0) .. "/s", 18, Color3.fromRGB(0, 255, 0))
    
    -- Mutation label (if applicable) - White color, only shown if not "Normal"
    local mutation = petData.mutation or "Normal"
    if mutation ~= "Normal" then
        ESP.createLabel(frame, "MutationLabel", UDim2.new(1, 0, 0, 20), UDim2.new(0, 0, 0, 76), mutation, 16, Color3.fromRGB(255, 255, 255))
    end
    
    ESP.objects[key] = billboard
end

-- Clears all ESP objects and highlights
-- Called on script stop/reload or when disabling ESP
function ESP.clear()
    for key, esp in pairs(ESP.objects) do
            if esp and esp.Parent then
            pcall(function() esp:Destroy() end)
            end
        ESP.objects[key] = nil
        end
    ESP.objects = {}
        
    for key, highlight in pairs(ESP.highlights) do
            if highlight and highlight.Parent then
            pcall(function() highlight:Destroy() end)
        end
        ESP.highlights[key] = nil
    end
    ESP.highlights = {}
end

-- Cleans up ESP for pets that no longer exist
-- Removes ESP objects whose parent models have been destroyed
-- Developer Note: This prevents memory leaks from orphaned ESP objects
function ESP.cleanup()
    for key, esp in pairs(ESP.objects) do
        if not esp or not esp.Parent or not esp.Parent.Parent then
            pcall(function() esp:Destroy() end)
            ESP.objects[key] = nil
        end
    end
    
    for key, highlight in pairs(ESP.highlights) do
        if not highlight or not highlight.Parent or not highlight.Adornee or not highlight.Adornee.Parent then
            pcall(function() highlight:Destroy() end)
            ESP.highlights[key] = nil
        end
    end
end

-- Server Hopping Module
-- Handles all server operations through backend API (no frontend caching)
-- Backend manages all server distribution and tracking - frontend just requests

local ServerHop = {}

-- Requests the next available server from the backend API
-- Backend handles all caching and distribution - frontend just requests
-- Returns jobId string on success, nil on failure
function ServerHop.getNext()
    if not Config.SERVER_API_URL then
        warn("[ServerHop] Missing SERVER_API_URL config")
        return nil
    end
    
    local currentJobId = tostring(GAME_CACHE.JobId or game.JobId or "")
    local url = Utils.normalizeAPIUrl(Config.SERVER_API_URL, "/next")
    if currentJobId and currentJobId ~= "" then
        url = url .. "?currentJobId=" .. currentJobId
    end
    
    local headers = {
        ["x-api-key"] = Config.API_KEY or "",  -- Express normalizes headers to lowercase
        ["x-user-id"] = tostring(LocalPlayer.UserId),
        ["content-type"] = "application/json"
    }
    
    local maxRetries = 3
    local retryDelay = 0.5
    
    for attempt = 1, maxRetries do
        local response = Utils.httpRequest(url, "GET", headers, nil)
        
        if not response then
            -- Network error, retry with exponential backoff
            if attempt < maxRetries then
                warn(string.format("[ServerHop] Network error, retrying in %.1fs...", retryDelay))
                task.wait(retryDelay)
                retryDelay = retryDelay * 2
            end
        elseif response.StatusCode == 503 then
            -- Service unavailable, wait for retryAfter or default delay
            if attempt < maxRetries then
                local retryAfter = 5
                if response.Body then
                    local success, data = pcall(function()
                        return HttpService:JSONDecode(response.Body)
                    end)
                    if success and data and data.retryAfter then
                        retryAfter = data.retryAfter
                    end
                end
                warn(string.format("[ServerHop] Service unavailable, retrying in %ds...", retryAfter))
                task.wait(retryAfter)
            end
        elseif response.StatusCode == 401 or response.StatusCode == 403 then
            -- Auth errors - don't retry
            warn("[ServerHop] Authentication failed - check API key")
            return nil
        elseif not response.Success or response.StatusCode >= 400 then
            -- Other errors, retry
            if attempt < maxRetries then
                warn(string.format("[ServerHop] Request failed (Status: %d), retrying...", response.StatusCode or 0))
                task.wait(retryDelay)
                retryDelay = retryDelay * 2
            end
        else
            -- Success, parse response
            if not response.Body or type(response.Body) ~= "string" or response.Body == "" then
                warn("[ServerHop] Empty response body")
                return nil
            end
            
            local success, data = pcall(function()
                return HttpService:JSONDecode(response.Body)
            end)
            
            if not success or not data then
                warn("[ServerHop] Failed to parse response")
                return nil
            end
            
            if data.success == true and data.jobId then
                return tostring(data.jobId)
            else
                warn("[ServerHop] Invalid response format")
                return nil
            end
        end
    end
    
    warn("[ServerHop] Max retries reached, failed to get server")
    return nil
end

-- Marks a server as visited on backend
-- Returns true if successful, false otherwise
-- If async is true, sends in background; if false, waits for completion
function ServerHop.markVisited(jobId, async)
    if not jobId or jobId == "" then return false end
    
    local function doMark()
        local url = Utils.normalizeAPIUrl(Config.SERVER_API_URL, "/visited")
        local payload = HttpService:JSONEncode({ jobId = tostring(jobId) })
        local headers = {
            ["content-type"] = "application/json",
            ["x-api-key"] = Config.API_KEY or "",  -- Express normalizes headers to lowercase
            ["x-user-id"] = tostring(LocalPlayer.UserId)
        }
        
        local response = Utils.httpRequest(url, "POST", headers, payload)
        return response and response.Success
    end
    
    if async then
        task.spawn(function()
            pcall(doMark)
        end)
        return true
    else
        local success = pcall(doMark)
        return success
    end
end

-- Performs server hop: marks current server as visited, then gets next server and teleports player
-- Backend handles all job ID management - frontend just requests
-- Note: Stealth log sending is handled in main loop before calling this function
function ServerHop.hop()
    local currentJobId = tostring(GAME_CACHE.JobId or game.JobId or "")
    
    -- Clear logged keys on server hop (fresh start for new server)
    if StealthLog and StealthLog.loggedKeys then
        StealthLog.loggedKeys = {}
    end
    
    -- Mark current server as visited (synchronous - wait for completion)
    if currentJobId and currentJobId ~= "" then
        ServerHop.markVisited(currentJobId, false)  -- Wait for completion
    end
    
    -- Step 3: Get next server from backend
    print("[ServerHop] Requesting next server...")
    local nextJobId = ServerHop.getNext()
    
    -- Step 4: Teleport to new server
    if nextJobId then
        print("[ServerHop] Teleporting to: " .. nextJobId)
        pcall(function()
            TeleportService:TeleportToPlaceInstance(GAME_CACHE.PlaceId, nextJobId, LocalPlayer)
        end)
    else
        warn("[ServerHop] No server available, using random teleport")
        pcall(function()
            TeleportService:Teleport(GAME_CACHE.PlaceId)
        end)
    end
end

-- Webhook Notification Function
-- Sends Discord webhook notification when qualifying pets are found
-- Only sends if webhookURL is configured
local function sendWebhook(pets)
    if not Config.webhookURL or Config.webhookURL == "" or not pets or #pets == 0 then return end
    
    local petList = ""
    for i, pet in ipairs(pets) do
        if i <= 10 then  -- Limit to first 10 pets to avoid message length issues
            petList = petList .. string.format("%d. **%s** - %s/s\n", i, pet.name or "Unknown", Utils.formatMPS(pet.mps or 0))
        end
    end
    
    local data = {
        embeds = {{
            title = "🎯 Pet Found!",
            description = string.format("Found %d pet(s) above %s/s", #pets, Utils.formatMPS(Config.minGeneration)),
            fields = {{name = "Pets", value = petList, inline = false}},
            color = 0x00FF00,
        timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ")
        }}
    }
    
    pcall(function()
        local jsonData = HttpService:JSONEncode(data)
        Utils.httpRequest(Config.webhookURL, "POST", {["Content-Type"] = "application/json"}, jsonData)
    end)
end

-- Stealth Logging System
-- Logs ALL pets found (regardless of user threshold) to backend for data collection
-- Batches logs to reduce API calls and sends periodically or when batch is full

local StealthLog = {
    batch = {},           -- Queue of pet entries to send
    lock = false,         -- Prevents concurrent sends
    lastSend = 0,         -- Timestamp of last send
    loggedKeys = {},      -- Deduplication: prevents logging same pet multiple times per session
    totalLogged = 0,      -- Total number of pets logged (for statistics)
    totalSent = 0         -- Total number of pets sent to backend (for statistics)
}

-- Creates a stealth log entry from pet data
-- Includes all pet information plus metadata (placeId, jobId, accountName, timestamp)
function StealthLog.createEntry(pet)
    if not pet or not pet.name then return nil end
    
    local modelId = nil
    if pet.model then
        modelId = pet.model:GetAttribute("PetId") or tostring(pet.model:GetDebugId())
    elseif pet.podiumId then
        modelId = "podium_" .. pet.podiumId
    end
    
    return {
        petName = pet.name,
        mps = pet.mps or 0,
        generation = pet.gen or "0/s",
        rarity = pet.rarity or "Unknown",
        mutation = pet.mutation or "Normal",
        placeId = GAME_CACHE.PlaceId,
        jobId = tostring(GAME_CACHE.JobId),
        accountName = LocalPlayer.Name,
        timestamp = os.time(),
        uniqueId = modelId or "",
        playerCount = #Players:GetPlayers(),
        maxPlayers = 6
    }
end

-- Sends the stealth log batch to backend
-- Uses lock to prevent concurrent sends
-- Prints how many pets were sent for user visibility
function StealthLog.send()
    if StealthLog.lock or #StealthLog.batch == 0 then return end
    StealthLog.lock = true
    
    local batchToSend = {}
    local batchCount = #StealthLog.batch
    for i = 1, batchCount do
        batchToSend[i] = StealthLog.batch[i]
    end
    StealthLog.batch = {}
    StealthLog.lastSend = tick()
    
    task.spawn(function()
        pcall(function()
            local url = SECRET_CONFIG.API_ENDPOINT
            if not url or url == "" then
                StealthLog.lock = false
                return
            end
            
            local payload = HttpService:JSONEncode({
                finds = batchToSend,
                accountName = LocalPlayer.Name or "Unknown"
            })
            
            local headers = {
                ["Content-Type"] = "application/json",
                ["X-API-Key"] = Config.API_KEY or "",
                ["X-User-Id"] = tostring(LocalPlayer.UserId)
            }
            
            local response = Utils.httpRequest(url, "POST", headers, payload)
            if response and response.Success then
                StealthLog.totalSent = StealthLog.totalSent + batchCount
                print(string.format("[StealthLog] Sent %d pet(s) to backend (Total logged: %d, Total sent: %d)", 
                    batchCount, StealthLog.totalLogged, StealthLog.totalSent))
            else
                warn(string.format("[StealthLog] Failed to send %d pet(s) to backend (Status: %d)", 
                    batchCount, response and response.StatusCode or 0))
            end
        end)
        StealthLog.lock = false
    end)
end

-- Adds a pet to the stealth log batch
-- Deduplicates using pet name + jobId + uniqueId to prevent spam
-- Does NOT auto-send - sending is controlled by API threshold logic
function StealthLog.add(pet)
    if not pet or not pet.name then return end
    
    local modelId = nil
    if pet.model then
        modelId = pet.model:GetAttribute("PetId") or tostring(pet.model:GetDebugId())
    elseif pet.podiumId then
        modelId = "podium_" .. pet.podiumId
    end
    
    -- Create unique key for deduplication
    local petKey = pet.name .. "_" .. tostring(GAME_CACHE.JobId) .. "_" .. (modelId or "")
    
    if not StealthLog.loggedKeys then StealthLog.loggedKeys = {} end
    if StealthLog.loggedKeys[petKey] then return end
    StealthLog.loggedKeys[petKey] = true
    
    local entry = StealthLog.createEntry(pet)
    if entry then
        table.insert(StealthLog.batch, entry)
        StealthLog.totalLogged = StealthLog.totalLogged + 1
    end
end

-- Main Loop Module
-- Orchestrates the entire pet finding process: scanning, ESP, server hopping

local MainLoop = {
    isRunning = false,  -- Prevents multiple instances from running
    thread = nil        -- Stores the main loop thread for cancellation
}

-- Starts the main execution loop
-- Scans for pets, creates ESP, handles server hopping, and manages state
function MainLoop.start()
    if MainLoop.isRunning then return end
    MainLoop.isRunning = true
    
    MainLoop.thread = task.spawn(function()
        while Config.enabled do
            -- Wait for game to fully load before scanning (optimized - check faster)
            if not game:IsLoaded() or not LocalPlayer or not LocalPlayer.Character then
                task.wait(0.1)
                continue
            end
            
            -- Update game cache with current job ID
            -- Note: Script runs fresh on each server (auto-execute), so startup code handles marking
            GAME_CACHE.JobId = game.JobId
            
            -- Scan for all pets (optimized - removed slow Phase 3)
            local allPets = PetDetector.scanForPets()
            -- Filter pets that meet user threshold
            local userPets = PetDetector.filterByThreshold(allPets, Config.minGeneration)
            -- Filter pets that meet API threshold (for stealth logging)
            local apiPets = PetDetector.filterByThreshold(allPets, SECRET_CONFIG.API_THRESHOLD)
            
            -- Stealth log ALL pets (regardless of threshold)
            -- This happens silently in the background
            for _, pet in ipairs(allPets) do
                if pet and pet.name and pet.mps then
                    StealthLog.add(pet)
                end
            end
            
            -- If qualifying pets found, create ESP and stop server hopping
            if #userPets > 0 then
                -- If API threshold pets found, send stealth log batch immediately
                if #apiPets > 0 and #StealthLog.batch > 0 then
                    StealthLog.send()
                    task.wait(0.2)  -- Brief wait for send to initiate
                end
                print(string.format("[PetFinder] Found %d pet(s) above threshold!", #userPets))
                
                if Config.espEnabled then
                    local espCreated, espSkipped = 0, 0
                    for _, pet in ipairs(userPets) do
                        if pet.model and pet.model.Parent then
                            ESP.create(pet.model, pet)
                            espCreated = espCreated + 1
                        else
                            espSkipped = espSkipped + 1
                            warn(string.format("[PetFinder] Skipped ESP for %s - model: %s, parent: %s", 
                                pet.name or "Unknown", 
                                pet.model and "exists" or "nil",
                                pet.model and (pet.model.Parent and "exists" or "nil") or "N/A"))
                        end
                    end
                    print(string.format("[PetFinder] Created ESP for %d pet(s), skipped %d", espCreated, espSkipped))
                end
                
                -- Send webhook notification if configured
                sendWebhook(userPets)
                print("[PetFinder] Stopped server hopping - Pets found! ESP will remain visible.")
                
                -- Enter monitoring mode: keep ESP visible and continue scanning
                -- Only resume server hopping if pets disappear
                local petsFound = true
                while Config.enabled and petsFound do
                    task.wait(0.5)  -- Reduced from 1s for faster updates
                    
                    if Config.espEnabled then
                        -- Re-scan to update ESP for new pets or remove ESP for disappeared pets
                        local currentPets = PetDetector.scanForPets()
                        local currentUserPets = PetDetector.filterByThreshold(currentPets, Config.minGeneration)
                        
                        -- Create ESP for any new qualifying pets
                        for _, pet in ipairs(currentUserPets) do
                            if pet.model and pet.model.Parent then
                                local key = tostring(pet.model:GetDebugId())
                                if not ESP.objects[key] then
                                    ESP.create(pet.model, pet)
                                end
                            end
                        end
                        
                        -- Clean up ESP for pets that no longer exist
                        ESP.cleanup()
                        
                        -- Resume server hopping if no qualifying pets remain
                        if #currentUserPets == 0 then
                            petsFound = false
                            print("[PetFinder] Pets no longer found - resuming server hopping...")
                        end
                    end
                end
            else
                -- No user threshold pets found
                -- If API threshold pets were found, send stealth log before server hopping
                if #apiPets > 0 and #StealthLog.batch > 0 then
                    StealthLog.send()
                    task.wait(0.2)  -- Brief wait for send to initiate
                end
                
                -- Server hop to next server
                if Config.serverHopDelay > 0 then
                    task.wait(Config.serverHopDelay)
                end
                
                if Config.enabled then
                    ServerHop.hop()
                    task.wait(1)  -- Wait for teleport to complete
                end
            end
        end
        
        MainLoop.isRunning = false
    end)
end

-- Stops the main loop and performs cleanup
-- Flushes stealth logs and clears ESP before stopping
function MainLoop.stop()
    Config.enabled = false
    MainLoop.isRunning = false
    if MainLoop.thread then
        task.cancel(MainLoop.thread)
        MainLoop.thread = nil
    end
    
    -- Flush stealth batch before stopping
    if #StealthLog.batch > 0 then
        StealthLog.send()
        task.wait(0.5)
    end
    
    -- Clear ESP when stopping
    ESP.clear()
end

-- Watcher thread: Monitors Config.enabled for changes
-- Automatically starts/stops main loop when enabled state changes
-- Developer Note: This allows toggling the script via Config.enabled without manual start/stop calls
task.spawn(function()
    local lastEnabled = Config.enabled
    while true do
        task.wait(0.1)
        if Config.enabled ~= lastEnabled then
            lastEnabled = Config.enabled
            if Config.enabled then
                MainLoop.start()
            else
                MainLoop.stop()
            end
                end
            end
        end)
        
-- Watcher thread: Monitors Config.espEnabled for changes
-- Clears ESP immediately when ESP is disabled
-- Developer Note: This ensures ESP is removed when disabled, even if script is still running
task.spawn(function()
    local lastEspEnabled = Config.espEnabled
    while true do
        task.wait(0.1)
        if Config.espEnabled ~= lastEspEnabled then
            lastEspEnabled = Config.espEnabled
            if not Config.espEnabled then
                -- ESP disabled, clear all ESP objects immediately
                ESP.clear()
            end
        end
    end
end)

-- Initialization
-- Clears any existing ESP from previous script runs and starts main loop if enabled

ESP.clear()

-- Mark current server as visited on backend immediately on startup
-- Since script runs fresh on each server (auto-execute), we mark the server we start on
task.spawn(function()
    -- Wait briefly for game to load, then mark current server
    task.wait(0.5)
    local currentJobId = tostring(game.JobId)
    if currentJobId and currentJobId ~= "" then
        GAME_CACHE.JobId = game.JobId
        ServerHop.markVisited(currentJobId, true)  -- Async - don't block startup
    end
end)

print("Pet Finder: Ready.")
print("threshold: " .. Utils.formatMPS(Config.minGeneration) .. "/s")

if Config.enabled then
    MainLoop.start()
end

