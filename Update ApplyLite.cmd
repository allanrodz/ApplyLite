@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Update-ApplyLite.ps1"
if errorlevel 1 pause
