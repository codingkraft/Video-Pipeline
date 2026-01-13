-- DaVinci Resolve Lua Script - Replace Image Clips
-- Run this in Workspace > Console > Lua

local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()

if not project then
    print("ERROR: No project open")
    return
end

local timeline = project:GetCurrentTimeline()
if not timeline then
    print("ERROR: No timeline open")
    return
end

local mediaPool = project:GetMediaPool()
print("Project: " .. project:GetName())
print("Timeline: " .. timeline:GetName())

-- Helper to recursively get all images from a folder
local function GetImagesFromFolder(folder, imagesDict)
    local clips = folder:GetClipList()
    for _, clip in ipairs(clips) do
        local filePath = clip:GetClipProperty("File Path")
        if filePath ~= nil and filePath ~= "" then
            -- Simple specific check for images based on extension
            local ext = string.lower(string.sub(filePath, -4))
            local ext5 = string.lower(string.sub(filePath, -5)) -- for .jpeg, .tiff
            
            if ext == ".jpg" or ext == ".png" or ext == ".tif" or ext == ".bpm" or ext5 == ".jpeg" or ext5 == ".tiff" or ext5 == ".webp" then
                -- Get filename without path and extension
                local filename = string.match(filePath, "[^/\\]+$")
                local basename = string.gsub(filename, "%..+$", "")
                
                -- Store mapping
                imagesDict[basename] = {path = filePath, clip = clip}
                imagesDict[string.lower(basename)] = {path = filePath, clip = clip}
            end
        end
    end
    
    -- Recursively check subfolders
    local subfolders = folder:GetSubFolderList()
    for _, subfolder in ipairs(subfolders) do
        GetImagesFromFolder(subfolder, imagesDict)
    end
end

-- Build image map
print("\nSearching for images in Media Pool...")
local imagesDict = {}
local rootFolder = mediaPool:GetRootFolder()
GetImagesFromFolder(rootFolder, imagesDict)

local count = 0
for _ in pairs(imagesDict) do count = count + 1 end
print("Found " .. math.floor(count/2) .. " image(s) (approx)")

-- Function to find match
local function FindMatchingImage(clipName, imagesDict)
    local baseName = clipName
    
    -- Remove common suffixes
    if string.sub(baseName, -4) == "_img" then baseName = string.sub(baseName, 1, -5) end
    if string.sub(baseName, -6) == "_image" then baseName = string.sub(baseName, 1, -7) end
    
    -- Try exact match
    if imagesDict[baseName] then return imagesDict[baseName] end
    
    -- Try case insensitive
    if imagesDict[string.lower(baseName)] then return imagesDict[string.lower(baseName)] end
    
    return nil
end

-- Process tracks
local videoTrackCount = timeline:GetTrackCount("video")
print("\nVideo tracks: " .. videoTrackCount)

local replaced = 0
local failed = 0

for i = 1, videoTrackCount do
    local trackName = timeline:GetTrackName("video", i)
    
    -- Check if image track (contains "image" or "img" case insensitive)
    local isImageTrack = string.find(string.lower(trackName), "image") or string.find(string.lower(trackName), "img")
    
    if isImageTrack then
        print("\nProcessing Track " .. i .. ": " .. trackName)
        
        local clips = timeline:GetItemListInTrack("video", i)
        
        for _, clip in ipairs(clips) do
            local name = clip:GetName()
            local img = FindMatchingImage(name, imagesDict)
            
            if img then
                local mpi = clip:GetMediaPoolItem()
                if mpi then
                    print("  [OK] " .. name .. " -> " .. string.match(img.path, "[^/\\]+$"))
                    -- ReplaceClip takes path in Lua too
                    if mpi:ReplaceClip(img.path) then
                        replaced = replaced + 1
                    else
                        print("    Failed to replace")
                        failed = failed + 1
                    end
                else
                    print("  [ERROR] " .. name .. ": No MediaPoolItem")
                    failed = failed + 1
                end
            else
                print("  [SKIP] " .. name .. ": No matching image")
                failed = failed + 1
            end
        end
    else
        print("Skip Track " .. i .. ": " .. trackName)
    end
end

print("\n=== Done: " .. replaced .. " replaced, " .. failed .. " failed ===")
