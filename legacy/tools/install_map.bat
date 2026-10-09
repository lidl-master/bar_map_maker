@echo off
rem Drag a .sdz exported from BAR Map Maker onto this file to convert it to .sd7 and install it.
if "%~1"=="" (
  echo Drag a .sdz map file onto this script.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_map.ps1" "%~1"
pause
