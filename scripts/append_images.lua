-- DaVinci Resolve Lua Script - Create Parallel Image Track
-- This script creates a NEW video track with images synchronized to placeholder positions
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

-- Configuration
local GAP_CLIP_NAME = "Solid Color"  -- Optional: name of clip to use for gaps

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

-- Try to find gap clip (optional)
local gapClip = nil
local function FindClipByName(folder, name)
    local clips = folder:GetClipList()
    for _, clip in ipairs(clips) do
        if clip:GetName() == name then
            return clip
        end
    end
    local subfolders = folder:GetSubFolderList()
    for _, subfolder in ipairs(subfolders) do
        local found = FindClipByName(subfolder, name)
        if found then return found end
    end
    return nil
end

gapClip = FindClipByName(rootFolder, GAP_CLIP_NAME)
if gapClip then
    print("Found gap clip: " .. GAP_CLIP_NAME)
else
    print("WARNING: Gap clip '" .. GAP_CLIP_NAME .. "' not found. Will skip gaps (may lose sync).")
end

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

-- Process tracks to build append list
local videoTrackCount = timeline:GetTrackCount("video")
print("\nVideo tracks: " .. videoTrackCount)

local appendList = {}
local foundImages = 0
local skipped = 0

-- Find first image track
for i = 1, videoTrackCount do
    local trackName = timeline:GetTrackName("video", i)
    local isImageTrack = string.find(string.lower(trackName), "image") or string.find(string.lower(trackName), "img")
    
    if isImageTrack then
        print("\nProcessing Track " .. i .. ": " .. trackName)
        
        local clips = timeline:GetItemListInTrack("video", i)
        
        if clips and #clips > 0 then
            -- Sort clips by start time
            table.sort(clips, function(a, b) return a:GetStart() < b:GetStart() end)
            
            local currentFrame = clips[1]:GetStart()  -- Start at first clip's position
            
            for _, clip in ipairs(clips) do
                local clipStart = clip:GetStart()
                local clipEnd = clip:GetEnd()
                local clipDuration = clipEnd - clipStart
                local clipName = clip:GetName()
                
                -- Check if there's a gap before this clip
                if gapClip and clipStart > currentFrame then
                    local gapDuration = clipStart - currentFrame
                    print("  [GAP] Adding gap of " .. gapDuration .. " frames")
                    table.insert(appendList, {
                        mediaPoolItem = gapClip,
                        startFrame = 0,
                        endFrame = gapDuration - 1
                    })
                end
                
                -- Find matching image
                local img = FindMatchingImage(clipName, imagesDict)
                
                if img then
                    print("  [OK] " .. clipName .. " -> " .. string.match(img.path, "[^/\\]+$") .. " (" .. clipDuration .. " frames)")
                    table.insert(appendList, {
                        mediaPoolItem = img.clip,
                        startFrame = 0,
                        endFrame = clipDuration - 1
                    })
                    foundImages = foundImages + 1
                else
                    print("  [SKIP] " .. clipName .. ": No matching image")
                    -- Add gap for this clip to maintain sync
                    if gapClip then
                        table.insert(appendList, {
                            mediaPoolItem = gapClip,
                            startFrame = 0,
                            endFrame = clipDuration - 1
                        })
                    end
                    skipped = skipped + 1
                end
                
                currentFrame = clipEnd
            end
        else
            print("  No clips found on this track")
        end
        
        -- Only process first image track
        break
    end
end

-- Append all clips to timeline (creates a new track)
if #appendList > 0 then
    print("\n=== Creating new parallel track with " .. #appendList .. " clips ===")
    
    -- Get current track count
    local currentTrackCount = timeline:GetTrackCount("video")
    print("Current video tracks: " .. currentTrackCount)
    
    -- AppendToTimeline will create a new track at the bottom of the timeline
    local success = mediaPool:AppendToTimeline(appendList)
    
    if success then
        local newTrackCount = timeline:GetTrackCount("video")
        if newTrackCount > currentTrackCount then
            print("SUCCESS: Created new track " .. newTrackCount .. " with " .. foundImages .. " images (" .. skipped .. " skipped)")
            
            -- Optionally rename the new track
            local newTrackIndex = newTrackCount
            local newTrackName = "Images (Parallel)"
            timeline:SetTrackName("video", newTrackIndex, newTrackName)
            print("Renamed new track to: " .. newTrackName)
        else
            print("SUCCESS: Added " .. foundImages .. " images (" .. skipped .. " skipped)")
            print("Note: Clips may have been added to existing track")
        end
    else
        print("ERROR: AppendToTimeline failed")
    end
else
    print("\n=== No clips to append ===")
end

print("\n=== Done ===")
