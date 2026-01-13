#!/usr/bin/env python3
"""
Replace Image Clips - DaVinci Resolve Internal Script

This script runs from inside DaVinci Resolve:
  Workspace > Scripts > Replace Image Clips

It finds clips on "Image" tracks and replaces their media with 
matching image files from the Media Pool.

How to install:
1. Copy this file to:
   %AppData%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility
   (or: C:\Users\<YourName>\AppData\Roaming\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility)
2. Restart DaVinci Resolve
3. Go to Workspace > Scripts > Replace Image Clips
"""

# Image file extensions
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.gif', '.webp'}


def get_images_from_folder(folder, images_dict=None):
    """Recursively get all image files from a media pool folder."""
    if images_dict is None:
        images_dict = {}
    
    clips = folder.GetClipList()
    for clip in clips:
        file_path = clip.GetClipProperty("File Path")
        if file_path:
            import os
            ext = os.path.splitext(file_path)[1].lower()
            if ext in IMAGE_EXTENSIONS:
                base_name = os.path.splitext(os.path.basename(file_path))[0]
                images_dict[base_name] = {"path": file_path, "clip": clip}
                images_dict[base_name.lower()] = {"path": file_path, "clip": clip}
    
    # Recursively check subfolders
    subfolders = folder.GetSubFolderList()
    for subfolder in subfolders:
        get_images_from_folder(subfolder, images_dict)
    
    return images_dict


def find_matching_image(clip_name, images_dict):
    """Find a matching image for a clip by name."""
    base_name = clip_name
    
    # Remove common suffixes
    for suffix in ['_img', '_image', '_thumb', '_thumbnail']:
        if base_name.endswith(suffix):
            base_name = base_name[:-len(suffix)]
            break
    
    # Try exact match
    if base_name in images_dict:
        return images_dict[base_name]
    
    # Try case-insensitive
    if base_name.lower() in images_dict:
        return images_dict[base_name.lower()]
    
    # Try partial match
    for img_name, img_data in images_dict.items():
        if base_name.lower() in img_name.lower():
            return img_data
    
    return None


def main():
    import os
    
    # Get resolve instance (when running inside Resolve)
    resolve = bmd.scriptapp("Resolve")  # bmd is available when running inside Resolve
    
    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject()
    
    if not project:
        print("ERROR: No project open")
        return
    
    timeline = project.GetCurrentTimeline()
    if not timeline:
        print("ERROR: No timeline open")
        return
    
    media_pool = project.GetMediaPool()
    
    print(f"Project: {project.GetName()}")
    print(f"Timeline: {timeline.GetName()}")
    
    # Get all images from media pool
    print("\nSearching for images in Media Pool...")
    root_folder = media_pool.GetRootFolder()
    images_dict = get_images_from_folder(root_folder)
    print(f"Found {len(images_dict) // 2} image(s)")
    
    # Get video track count
    video_track_count = timeline.GetTrackCount("video")
    print(f"\nVideo tracks: {video_track_count}")
    
    replaced = 0
    failed = 0
    
    # Process each track
    for i in range(1, video_track_count + 1):
        track_name = timeline.GetTrackName("video", i)
        
        # Check if image track
        if "image" not in track_name.lower() and "img" not in track_name.lower():
            print(f"Skip: Track {i} - {track_name}")
            continue
        
        print(f"\nProcessing: Track {i} - {track_name}")
        
        clips = timeline.GetItemListInTrack("video", i)
        if not clips:
            print("  No clips")
            continue
        
        for clip in clips:
            name = clip.GetName()
            img = find_matching_image(name, images_dict)
            
            if not img:
                print(f"  [SKIP] {name}: No match")
                failed += 1
                continue
            
            # Get the MediaPoolItem
            mpi = clip.GetMediaPoolItem()
            if not mpi:
                print(f"  [ERROR] {name}: No MediaPoolItem")
                failed += 1
                continue
            
            # Replace with image
            try:
                if mpi.ReplaceClip(img["path"]):
                    print(f"  [OK] {name} -> {os.path.basename(img['path'])}")
                    replaced += 1
                else:
                    print(f"  [FAIL] {name}")
                    failed += 1
            except Exception as e:
                print(f"  [ERROR] {name}: {e}")
                failed += 1
    
    print(f"\n=== Done: {replaced} replaced, {failed} failed ===")


# Run when script is executed
main()
