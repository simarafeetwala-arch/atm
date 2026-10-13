@echo off
title Apex Digital Bank & ATM System
color 0b

echo ===================================================
echo     APEX DIGITAL BANK - ATM OPERATIONS PORTAL
echo         Connected to Live Supabase DB
echo ===================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Starting local HTTP server on port 5173...
    start "" "http://localhost:5173"
    python -m http.server 5173
) else (
    where py >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        echo [INFO] Starting local HTTP server using py launcher...
        start "" "http://localhost:5173"
        py -m http.server 5173
    ) else (
        echo [INFO] Opening index.html directly in your default browser...
        start "" "index.html"
    )
)
pause
