repeat task.wait() until game:IsLoaded() and game.Players.LocalPlayer
task.wait(1)

local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local Workspace = game:GetService("Workspace")
local LocalPlayer = Players.LocalPlayer

pcall(function()
    HttpService.HttpEnabled = true
end)

local API_URL = "https://empathetic-transformation-production.up.railway.app/api/pet-found"
-- No API key needed - bots can send freely
local SCAN_INTERVAL = 0.5
local SCANS_BEFORE_HOP = 10
local HOP_DELAY = 1
local BATCH_SEND_INTERVAL = 5 -- Send batch every 5 seconds
local MAX_BATCH_SIZE = 20 -- Max pets per batch

local MIN_GENERATION = 1

local visitedServers = {}
local currentJobId = game.JobId
visitedServers[currentJobId] = true
local loggedPets = {}
local petBatch = {} -- Queue for batching finds

local function parseMPS(text)
    if not text or type(text) ~= "string" then return 0 end
    text = text:gsub("%s+", ""):gsub("/s", ""):gsub("%$", ""):upper()
    local num = tonumber(text:match("[%d%.]+")) or 0
    if text:find("Q") then num = num * 1e15
    elseif text:find("T") then num = num * 1e12
    elseif text:find("B") then num = num * 1e9
    elseif text:find("M") then num = num * 1e6
    elseif text:find("K") then num = num * 1e3
    end
    return num
end

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

local function getPetMPSFromPodium(petModel)
    if not petModel or not petModel:IsA("Model") then return 0 end
    
    local petPos = petModel:GetPivot().Position
    local plots = Workspace:FindFirstChild("Plots")
    if not plots then return 0 end
    
    local closestPodium = nil
    local closestDist = math.huge
    
    for _, plot in pairs(plots:GetChildren()) do
        local animalPodiums = plot:FindFirstChild("AnimalPodiums")
        if animalPodiums then
            for _, podium in pairs(animalPodiums:GetChildren()) do
                local base = podium:FindFirstChild("Base")
                if base then
                    local podiumPos = base:GetPivot().Position
                    local dist = (petPos - podiumPos).Magnitude
                    if dist < closestDist and dist <= 50 then
                        closestDist = dist
                        closestPodium = podium
                    end
                end
            end
        end
    end
    
    if not closestPodium then return 0 end
    
    local base = closestPodium:FindFirstChild("Base")
    local spawn = base and base:FindFirstChild("Spawn")
    local attachment = spawn and spawn:FindFirstChild("Attachment")
    local animalOverhead = attachment and attachment:FindFirstChild("AnimalOverhead")
    local generation = animalOverhead and animalOverhead:FindFirstChild("Generation")
    
    if generation then
        return parseMPS(generation.Text)
    end
    
    return 0
end

local function scanForPets()
    local plots = Workspace:FindFirstChild("Plots")
    if not plots then 
        return {} 
    end
    
    local foundPets = {}
    local petKeys = {}
    
    for _, plot in pairs(plots:GetChildren()) do
        local animalPodiums = plot:FindFirstChild("AnimalPodiums")
        if animalPodiums then
            for _, podium in pairs(animalPodiums:GetChildren()) do
                local base = podium:FindFirstChild("Base")
                local spawn = base and base:FindFirstChild("Spawn")
                if spawn then
                    local attachment = spawn:FindFirstChild("Attachment")
                    if attachment then
                        local animalOverhead = attachment:FindFirstChild("AnimalOverhead")
                        if animalOverhead then
                            local generation = animalOverhead:FindFirstChild("Generation")
                            local displayName = animalOverhead:FindFirstChild("DisplayName")
                            local genTxt = generation and generation.Text or "0/s"
                            local podiumMPS = parseMPS(genTxt)
                            local petName = displayName and displayName.Text or "Unknown"
                            
                            local hasPetModel = false
                            for _, child in pairs(attachment:GetChildren()) do
                                if child:IsA("Model") and not child:FindFirstChild("Humanoid") then
                                    hasPetModel = true
                                    break
                                end
                            end
                            
                            if not hasPetModel then
                                if podiumMPS >= MIN_GENERATION then
                                    local petKey = petName .. "_" .. game.JobId .. "_podium"
                                    if not petKeys[petKey] then
                                        petKeys[petKey] = true
                                        table.insert(foundPets, {
                                            name = petName,
                                            gen = genTxt,
                                            mps = podiumMPS,
                                            rarity = "Unknown",
                                            key = petKey,
                                            model = nil
                                        })
                                    end
                                end
                            else
                                for _, child in pairs(attachment:GetChildren()) do
                                    if child:IsA("Model") and not child:FindFirstChild("Humanoid") then
                                        local petMPS = podiumMPS
                                        local petGenTxt = genTxt
                                        local finalPetName = petName
                                        
                                        local petOverhead = child:FindFirstChild("AnimalOverhead", true)
                                        if petOverhead then
                                            local petGeneration = petOverhead:FindFirstChild("Generation")
                                            local petDisplayName = petOverhead:FindFirstChild("DisplayName")
                                            if petGeneration and petGeneration.Text then
                                                petGenTxt = petGeneration.Text
                                                petMPS = parseMPS(petGenTxt)
                                            end
                                            if petDisplayName and petDisplayName.Text then
                                                finalPetName = petDisplayName.Text
                                            end
                                        end
                                        
                                        if petMPS >= MIN_GENERATION then
                                            local petKey = finalPetName .. "_" .. game.JobId
                                            if not petKeys[petKey] then
                                                petKeys[petKey] = true
                                                table.insert(foundPets, {
                                                    name = finalPetName,
                                                    gen = petGenTxt,
                                                    mps = petMPS,
                                                    rarity = "Unknown",
                                                    key = petKey,
                                                    model = child
                                                })
                                            end
                                        end
                                    end
                                end
                            end
                        end
                    end
                end
            end
        end
    end
    
    return foundPets
end

local function addToBatch(petData)
    local playerCount = #Players:GetPlayers()
    local maxPlayers = 6
    
    local data = {
        petName = petData.name,
        generation = petData.gen,
        mps = petData.mps,
        rarity = petData.rarity,
        placeId = game.PlaceId,
        jobId = game.JobId,
        playerCount = playerCount,
        maxPlayers = maxPlayers,
        accountName = LocalPlayer.Name,
        timestamp = os.time()
    }
    
    table.insert(petBatch, data)
    print("[Bot] Added to batch:", petData.name, formatMPS(petData.mps) .. "/s", "| Batch size:", #petBatch)
end

local function sendBatchToAPI()
    if #petBatch == 0 then
        return
    end
    
    local batchToSend = {}
    for i = 1, math.min(#petBatch, MAX_BATCH_SIZE) do
        table.insert(batchToSend, petBatch[i])
    end
    
    -- Remove sent items from batch
    for i = 1, #batchToSend do
        table.remove(petBatch, 1)
    end
    
    local payload = {
        finds = batchToSend,
        accountName = LocalPlayer.Name,
        timestamp = os.time()
    }
    
    local success, err = pcall(function()
        local jsonData = HttpService:JSONEncode(payload)
        
        if syn and syn.request then
            local response = syn.request({
                Url = API_URL,
                Method = "POST",
                Headers = {
                    ["Content-Type"] = "application/json"
                },
                Body = jsonData
            })
            return response and (response.StatusCode == 200 or response.StatusCode == 201)
        elseif request then
            local response = request({
                Url = API_URL,
                Method = "POST",
                Headers = {
                    ["Content-Type"] = "application/json"
                },
                Body = jsonData
            })
            return response and (response.StatusCode == 200 or response.StatusCode == 201)
        elseif HttpService.RequestAsync then
            local response = HttpService:RequestAsync({
                Url = API_URL,
                Method = "POST",
                Headers = {
                    ["Content-Type"] = "application/json"
                },
                Body = jsonData
            })
            return response and (response.StatusCode == 200 or response.StatusCode == 201)
        else
            HttpService:PostAsync(API_URL, jsonData, Enum.HttpContentType.ApplicationJson)
            return true
        end
    end)
    
    if success then
        print("[Bot] Successfully sent batch of", #batchToSend, "pets to API")
    else
        warn("[Bot] Failed to send batch to API:", tostring(err))
        -- Re-add failed batch items
        for i = #batchToSend, 1, -1 do
            table.insert(petBatch, 1, batchToSend[i])
        end
    end
end

local function getServers()
    local servers = {}
    local url = string.format("https://games.roblox.com/v1/games/%d/servers/Public?sortOrder=Asc&limit=100", game.PlaceId)
    
    local success, response = pcall(function()
        if syn and syn.request then
            local res = syn.request({Url = url, Method = "GET"})
            return res.Body
        elseif request then
            local res = request({Url = url, Method = "GET"})
            return res.Body
        else
            return HttpService:GetAsync(url, true)
        end
    end)
    
    if success and response then
        local success2, data = pcall(function()
            return HttpService:JSONDecode(response)
        end)
        
        if success2 and data and data.data then
            for _, server in ipairs(data.data) do
                local serverId = tostring(server.id)
                if server.id ~= currentJobId 
                    and not visitedServers[serverId] 
                    and (server.playing or 0) > 0 then
                    table.insert(servers, server)
                end
            end
        end
    end
    
    return servers
end

local function serverHop()
    local servers = getServers()
    
    if #servers == 0 then
        visitedServers = {}
        servers = getServers()
        
        if #servers == 0 then
            pcall(function()
                TeleportService:Teleport(game.PlaceId)
            end)
            return
        end
    end
    
    if #servers > 0 then
        local targetServer = servers[math.random(1, #servers)]
        local serverId = tostring(targetServer.id)
        visitedServers[serverId] = true
        currentJobId = serverId
        
        pcall(function()
            TeleportService:TeleportToPlaceInstance(game.PlaceId, targetServer.id, LocalPlayer)
        end)
    end
end

-- Batch sender (sends every BATCH_SEND_INTERVAL seconds)
task.spawn(function()
    while true do
        task.wait(BATCH_SEND_INTERVAL)
        if #petBatch > 0 then
            sendBatchToAPI()
        end
    end
end)

-- Main scanning loop
task.spawn(function()
    while true do
        repeat task.wait(0.5) until game:IsLoaded() and game.Players.LocalPlayer
        task.wait(0.3)
        
        local scanCount = 0
        while scanCount < SCANS_BEFORE_HOP do
            task.wait(SCAN_INTERVAL)
            
            local foundPets = scanForPets()
            
            for _, pet in ipairs(foundPets) do
                if not loggedPets[pet.key] then
                    loggedPets[pet.key] = pet
                    print("[Bot] Pet found:", pet.name, formatMPS(pet.mps) .. "/s")
                    addToBatch(pet)
                end
            end
            
            scanCount = scanCount + 1
        end
        
        -- Send any remaining batch before server hop
        if #petBatch > 0 then
            sendBatchToAPI()
        end
        
        loggedPets = {}
        task.wait(HOP_DELAY)
        serverHop()
        task.wait(1.5)
    end
end)
