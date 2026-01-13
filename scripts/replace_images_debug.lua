-- DaVinci Resolve Lua Script - Replace Image Clips (DEBUG VERSION)
-- Run this in Workspace > Console > Lua

print("\n=== STARTING SCRIPT ===")

local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()

if not project then print("ERROR: No project open") return end
local timeline = project:GetCurrentTimeline()
if not timeline then print("ERROR: No timeline open") return end

local mediaPool = project:GetMediaPool()
print("Project: " .. project:GetName())
print("Timeline: " .. timeline:GetName())

-- Helper to recursively get all images from a folder
local function GetImagesFromFolder(folder, imagesDict)
    local clips = folder:GetClipList()
    for _, clip in ipairs(clips) do
        local filePath = clip:GetClipProperty("File Path")
        if filePath ~= nil and filePath ~= "" then
            local ext = string.lower(string.sub(filePath, -4))
            local ext5 = string.lower(string.sub(filePath, -5))
            if ext == ".jpg" or ext == ".png" or ext == ".tif" or ext5 == ".webp" then
                local filename = string.match(filePath, "[^/\\]+$")
                local basename = string.gsub(filename, "%..+$", "")
                
                print("  Found Image: " .. basename) -- DEBUG
                
                imagesDict[basename] = {path = filePath, clip = clip}
                imagesDict[string.lower(basename)] = {path = filePath, clip = clip}
            end
        end
    end
    local subfolders = folder:GetSubFolderList()
    for _, subfolder in ipairs(subfolders) do
        GetImagesFromFolder(subfolder, imagesDict)
    end
end

-- Build image map
print("\nSearching for images in Media Pool...")
local imagesDict = {}
GetImagesFromFolder(mediaPool:GetRootFolder(), imagesDict)

local count = 0
for _ in pairs(imagesDict) do count = count + 1 end
print("Total images found in pool: " .. math.floor(count/2))

if count == 0 then
    print("WARNING: No images found in Media Pool! Please import your images first.")
end

-- Find Matching Image
local function FindMatchingImage(clipName, imagesDict)
    local baseName = clipName
    
    -- Strip suffixes
    if string.sub(baseName, -4) == "_img" then baseName = string.sub(baseName, 1, -5) end
    
    -- DEBUG:
    -- print("Checking match for: " .. clipName .. " -> " .. baseName)
    
    if imagesDict[baseName] then return imagesDict[baseName] end
    if imagesDict[string.lower(baseName)] then return imagesDict[string.lower(baseName)] end
    return nil
end

-- Process tracks
local videoTrackCount = timeline:GetTrackCount("video")
print("\nScanning " .. videoTrackCount .. " video tracks...")

local replaced = 0
local failed = 0

for i = 1, videoTrackCount do
    local trackName = timeline:GetTrackName("video", i)
    print("Track " .. i .. ": " .. trackName)
    
    -- Check if image track
    local isImageTrack = string.find(string.lower(trackName), "image") or string.find(string.lower(trackName), "img")
    
    if isImageTrack then
        print("  -> MATCH: This is an image track. Scanning clips...")
        
        local clips = timeline:GetItemListInTrack("video", i)
        print("  -> Found " .. #clips .. " clips on this track.")
        
        for _, clip in ipairs(clips) do
            local name = clip:GetName()
            local img = FindMatchingImage(name, imagesDict)
            
            if img then
                local mpi = clip:GetMediaPoolItem()
                if mpi then
                    print("    MATCH FOUND for " .. name .. "! Replacing...")
                    if mpi:ReplaceClip(img.path) then
                        print("      [SUCCESS] Replaced with " .. string.match(img.path, "[^/\\]+$"))
                        replaced = replaced + 1
                    else
                        print("      [FAIL] ReplaceClip returned false")
                        failed = failed + 1
                    end
                else
                    print("    [ERROR] " .. name .. ": No MediaPoolItem (is it a generator?)")
                    failed = failed + 1
                end
            else
                print("    [SKIP] " .. name .. ": No matching image found in pool")
                failed = failed + 1
            end
        end
    else
        print("  -> Ignoring (not an 'image' track)")
    end
end

print("\n=== Done: " .. replaced .. " replaced, " .. failed .. " failed ===")
