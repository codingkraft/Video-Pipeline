#!/usr/bin/env python3
"""
DaVinci Resolve Image Replacement Script

This script replaces video clips on image tracks with actual image files.
It can find images from:
1. A specified directory
2. The current project's Media Pool (auto-detect mode)

Requirements:
- DaVinci Resolve must be running (Studio version for full API access)
- A project must be open with a timeline imported
- External scripting must be enabled in Resolve preferences (set to "Local")

Usage:
1. Import your FCPXML/OTIO timeline into Resolve
2. Run this script while Resolve is open:
   - Auto mode (finds images in Media Pool): python resolve_replace_images.py --auto
   - Directory mode: python resolve_replace_images.py "path/to/images"
"""

import sys
import os

# Image file extensions
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.gif', '.webp'}


def get_resolve():
    """Get the DaVinci Resolve object."""
    try:
        import DaVinciResolveScript as dvr_script
        return dvr_script.scriptapp("Resolve")
    except ImportError:
        resolve_script_dirs = [
            # Windows
            os.path.join(os.environ.get('PROGRAMDATA', ''), 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting', 'Modules'),
            # Mac
            '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules',
            # Linux
            '/opt/resolve/Developer/Scripting/Modules'
        ]
        
        for script_dir in resolve_script_dirs:
            if os.path.exists(script_dir) and script_dir not in sys.path:
                sys.path.append(script_dir)
        
        try:
            import DaVinciResolveScript as dvr_script
            return dvr_script.scriptapp("Resolve")
        except ImportError:
            print("ERROR: Could not import DaVinciResolveScript.")
            print("Make sure DaVinci Resolve is running and external scripting is enabled.")
            print("\nTo enable external scripting:")
            print("  1. Open DaVinci Resolve Preferences (Ctrl+,)")
            print("  2. Go to System > General")
            print("  3. Set 'External scripting using' to 'Local'")
            print("  4. Restart DaVinci Resolve")
            return None


def get_images_from_media_pool(media_pool, root_folder=None):
    """
    Get all image files from the Media Pool.
    Returns a dict mapping base filename (without extension) to full path.
    """
    images = {}
    
    if root_folder is None:
        root_folder = media_pool.GetRootFolder()
    
    # Get clips in this folder
    clips = root_folder.GetClipList()
    for clip in clips:
        file_path = clip.GetClipProperty("File Path")
        if file_path:
            ext = os.path.splitext(file_path)[1].lower()
            if ext in IMAGE_EXTENSIONS:
                base_name = os.path.splitext(os.path.basename(file_path))[0]
                images[base_name] = file_path
                images[base_name.lower()] = file_path  # Case-insensitive match
    
    # Recursively get from subfolders
    subfolders = root_folder.GetSubFolderList()
    for subfolder in subfolders:
        images.update(get_images_from_media_pool(media_pool, subfolder))
    
    return images


def find_image_in_media_pool(clip_name: str, images_dict: dict) -> str | None:
    """
    Find a matching image in the Media Pool for a clip.
    Matches by name similarity.
    """
    # Remove common suffixes
    base_name = clip_name
    for suffix in ['_img', '_image', '_thumb', '_thumbnail']:
        if base_name.endswith(suffix):
            base_name = base_name[:-len(suffix)]
            break
    
    # Try exact match
    if base_name in images_dict:
        return images_dict[base_name]
    
    # Try case-insensitive match
    if base_name.lower() in images_dict:
        return images_dict[base_name.lower()]
    
    # Try partial match (image name contains clip base name)
    for img_name, img_path in images_dict.items():
        if base_name.lower() in img_name.lower():
            return img_path
    
    return None


def find_image_in_directory(clip_name: str, images_dir: str) -> str | None:
    """
    Find the corresponding image file for a clip in a directory.
    """
    base_name = clip_name
    for suffix in ['_img', '_image', '_thumb', '_thumbnail']:
        if base_name.endswith(suffix):
            base_name = base_name[:-len(suffix)]
            break
    
    for ext in IMAGE_EXTENSIONS:
        image_path = os.path.join(images_dir, base_name + ext)
        if os.path.exists(image_path):
            return image_path
    
    return None


def replace_image_clips(images_source, use_media_pool: bool = False, track_names: list[str] = None):
    """
    Replace clips on image tracks with corresponding image files.
    
    Args:
        images_source: Directory path or None (if using media pool)
        use_media_pool: If True, find images from Media Pool
        track_names: List of track names to process (default: tracks containing "Image")
    """
    resolve = get_resolve()
    if not resolve:
        return False
    
    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject()
    
    if not project:
        print("ERROR: No project is currently open.")
        return False
    
    timeline = project.GetCurrentTimeline()
    if not timeline:
        print("ERROR: No timeline is currently open.")
        return False
    
    media_pool = project.GetMediaPool()
    
    print(f"Project: {project.GetName()}")
    print(f"Timeline: {timeline.GetName()}")
    
    # Build image lookup
    images_dict = {}
    if use_media_pool:
        print("Searching for images in Media Pool...")
        images_dict = get_images_from_media_pool(media_pool)
        print(f"Found {len(images_dict) // 2} image(s) in Media Pool")
    else:
        print(f"Images directory: {images_source}")
        if not os.path.isdir(images_source):
            print(f"ERROR: Directory does not exist: {images_source}")
            return False
    
    print()
    
    # Get video track count
    video_track_count = timeline.GetTrackCount("video")
    print(f"Video tracks: {video_track_count}")
    
    replaced_count = 0
    failed_count = 0
    
    # Process each video track
    for track_index in range(1, video_track_count + 1):
        track_name = timeline.GetTrackName("video", track_index)
        
        # Check if this is an image track
        is_image_track = False
        if track_names:
            is_image_track = track_name in track_names
        else:
            is_image_track = "image" in track_name.lower() or "img" in track_name.lower()
        
        if not is_image_track:
            print(f"Skipping track {track_index}: {track_name} (not an image track)")
            continue
        
        print(f"\nProcessing track {track_index}: {track_name}")
        
        clips = timeline.GetItemListInTrack("video", track_index)
        
        if not clips:
            print(f"  No clips found on track {track_index}")
            continue
        
        for clip in clips:
            clip_name = clip.GetName()
            
            # Find matching image
            if use_media_pool:
                image_path = find_image_in_media_pool(clip_name, images_dict)
            else:
                image_path = find_image_in_directory(clip_name, images_source)
            
            if not image_path:
                print(f"  [SKIP] {clip_name}: No matching image found")
                failed_count += 1
                continue
            
            # Get the MediaPoolItem for this clip
            media_pool_item = clip.GetMediaPoolItem()
            
            if not media_pool_item:
                print(f"  [ERROR] {clip_name}: Could not get MediaPoolItem")
                failed_count += 1
                continue
            
            # Replace the clip's media
            try:
                success = media_pool_item.ReplaceClip(image_path)
                if success:
                    print(f"  [OK] {clip_name} -> {os.path.basename(image_path)}")
                    replaced_count += 1
                else:
                    print(f"  [FAIL] {clip_name}: ReplaceClip returned False")
                    failed_count += 1
            except Exception as e:
                print(f"  [ERROR] {clip_name}: {str(e)}")
                failed_count += 1
    
    print()
    print(f"Replacement complete: {replaced_count} succeeded, {failed_count} failed")
    return replaced_count > 0


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Replace video clips with images in DaVinci Resolve",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Auto mode - find images in Media Pool
  python resolve_replace_images.py --auto
  
  # Specify images directory
  python resolve_replace_images.py "F:/path/to/images"
  
  # Process specific tracks only
  python resolve_replace_images.py --auto --tracks "Images 1" "Images 2"
"""
    )
    parser.add_argument(
        "images_dir",
        nargs="?",
        default=None,
        help="Directory containing image files (optional if using --auto)"
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Auto mode: find images in the project's Media Pool"
    )
    parser.add_argument(
        "--tracks",
        nargs="+",
        help="Specific track names to process (default: auto-detect image tracks)"
    )
    
    args = parser.parse_args()
    
    if not args.auto and not args.images_dir:
        parser.error("Either --auto or images_dir is required")
    
    if args.images_dir and not args.auto:
        if not os.path.isdir(args.images_dir):
            print(f"ERROR: Images directory does not exist: {args.images_dir}")
            sys.exit(1)
    
    success = replace_image_clips(
        images_source=args.images_dir,
        use_media_pool=args.auto,
        track_names=args.tracks
    )
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
