-- Account Rotator Script
-- Automatically switches between multiple accounts and runs bot script
-- Use this if you can only run one instance at a time

local HttpService = game:GetService("HttpService")
local TeleportService = game:GetService("TeleportService")
local Players = game:GetService("Players")

-- ===== CONFIGURATION =====
local ACCOUNTS = {
    -- Add your account cookies here
    -- Format: {cookie = "your_cookie_here", name = "Account1"},
    -- You'll need to get cookies from your browser (use a cookie manager extension)
}

local PLACE_ID = game.PlaceId  -- Current game
local TIME_PER_ACCOUNT = 600  -- 10 minutes per account (in seconds)
local BOT_SCRIPT_URL = ""  -- URL to your PetFinderBot.lua (optional, if hosted online)

-- ===== ACCOUNT ROTATION =====
local currentAccountIndex = 1
local accountStartTime = tick()

local function switchToNextAccount()
    if #ACCOUNTS == 0 then
        warn("[Rotator] No accounts configured!")
        return
    end
    
    currentAccountIndex = (currentAccountIndex % #ACCOUNTS) + 1
    local account = ACCOUNTS[currentAccountIndex]
    
    print("[Rotator] Switching to account:", account.name)
    
    -- Note: Actual account switching requires using HttpService with cookies
    -- This is a simplified version - you may need to use an executor's account switcher
    
    accountStartTime = tick()
end

local function loadBotScript()
    -- Load the bot script
    if BOT_SCRIPT_URL and BOT_SCRIPT_URL ~= "" then
        local success, script = pcall(function()
            return game:HttpGet(BOT_SCRIPT_URL)
        end)
        
        if success then
            loadstring(script)()
            print("[Rotator] Bot script loaded from URL")
        else
            warn("[Rotator] Failed to load bot script from URL")
        end
    else
        -- Load local script (if in same directory)
        print("[Rotator] Please load PetFinderBot.lua manually in your executor")
    end
end

-- Main rotation loop
task.spawn(function()
    while true do
        local elapsed = tick() - accountStartTime
        
        if elapsed >= TIME_PER_ACCOUNT then
            print("[Rotator] Time limit reached, switching account...")
            switchToNextAccount()
            task.wait(5)  -- Wait before switching
        end
        
        task.wait(10)  -- Check every 10 seconds
    end
end)

-- Load bot script on start
task.wait(2)
loadBotScript()

print("[Rotator] Account rotator started!")
print("[Rotator] Will switch accounts every", TIME_PER_ACCOUNT, "seconds")
