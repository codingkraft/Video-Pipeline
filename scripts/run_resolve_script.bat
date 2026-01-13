@echo off
REM DaVinci Resolve Python Script Runner
REM This batch file sets up the environment and runs the Resolve script

echo Setting up DaVinci Resolve scripting environment...

REM Set Resolve scripting paths
set RESOLVE_SCRIPT_API=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting
set RESOLVE_SCRIPT_LIB=C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll
set PYTHONPATH=%PYTHONPATH%;%RESOLVE_SCRIPT_API%\Modules

echo RESOLVE_SCRIPT_API: %RESOLVE_SCRIPT_API%
echo RESOLVE_SCRIPT_LIB: %RESOLVE_SCRIPT_LIB%
echo.

REM Check if Resolve is running
tasklist /FI "IMAGENAME eq Resolve.exe" 2>NUL | find /I /N "Resolve.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo DaVinci Resolve is running. Good!
) else (
    echo WARNING: DaVinci Resolve does not appear to be running.
    echo Please start DaVinci Resolve first, then run this script again.
    pause
    exit /b 1
)

echo.
echo Running the image replacement script...
echo.

REM Run the script
python "%~dp0resolve_replace_images.py" --auto

echo.
echo Done!
pause
