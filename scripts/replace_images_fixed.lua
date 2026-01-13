-- DaVinci Resolve Lua Script - Replace Image Clips (FINAL DEBUG)
-- Run this in Workspace > Console > Lua

print("\n=== STARTING IMAGE REPLACEMENT (DEEP DEBUG) ===")

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
print("Loading images from Media Pool...")
local imagesDict = {}
GetImagesFromFolder(mediaPool:GetRootFolder(), imagesDict)

local count = 0
for _ in pairs(imagesDict) do count = count + 1 end
print("Found " .. math.floor(count/2) .. " images available.")

-- Find Matching Image
local function FindMatchingImage(clipName, imagesDict)
    local baseName = clipName
    if string.sub(baseName, -4) == "_img" then 
        baseName = string.sub(baseName, 1, -5) -- Remove _img
        if imagesDict[baseName] then return imagesDict[baseName] end
        if imagesDict[string.lower(baseName)] then return imagesDict[string.lower(baseName)] end
    end
    return nil
end

-- Process ALL video tracks
local videoTrackCount = timeline:GetTrackCount("video")
print("\nScanning " .. videoTrackCount .. " video tracks...")

local replaced = 0
local failed = 0

for i = 1, videoTrackCount do
    local trackName = timeline:GetTrackName("video", i)
    -- print("Track " .. i .. ": " .. trackName)
    
    local clips = timeline:GetItemListInTrack("video", i)
    
    for _, clip in ipairs(clips) do
        local name = clip:GetName()
        local img = FindMatchingImage(name, imagesDict)
        
        if img then
            -- FOUND A MATCH
            print("\n[MATCH] " .. name)
            
            -- Debug Durations
            local tlDuration = clip:GetDuration()
            local imgDuration = img.clip:GetClipProperty("Duration")
            print("    Timeline Duration: " .. tlDuration)
            print("    Image Duration:    " .. (imgDuration or "Unknown"))
            
            local mpi = clip:GetMediaPoolItem()
            if mpi then
                -- TRY 1: ReplaceClip (Standard)
                if mpi:ReplaceClip(img.path) then
                    print("    [SUCCESS] ReplaceClip(path)")
                    replaced = replaced + 1
                else
                    print("    [FAIL] ReplaceClip(path)")
                    
                    -- TRY 2: SetMediaPoolItem (Alternative)
                    -- Note: SetMediaPoolItem might fail if clip is not a TimelineItem
                    if clip.SetMediaPoolItem then
                        if clip:SetMediaPoolItem(img.clip) then
                             print("    [SUCCESS] SetMediaPoolItem(clip)")
                             replaced = replaced + 1
                        else
                             print("    [FAIL] SetMediaPoolItem(clip)")
                        end
                    else
                        print("    [FAIL] SetMediaPoolItem function not available")
                    end
                end
            else
                -- Try replacing even without MediaPoolItem if possible on TimelineItem? No.
                print("    [ERROR] No MediaPoolItem (Generator?)")
                failed = failed + 1
            end
        end
    end
end

print("\n=== Done: " .. replaced .. " replaced, " .. failed .. " failed. ===")
if replaced == 0 then
    print("\nTROUBLESHOOTING:")
    print("If Image Duration is shorter than Timeline Duration, Resolve won't replace it.")
    print("Solution: Change Import Settings in Resolve > User > Editing > Standard Still Duration to be longer.")
end
