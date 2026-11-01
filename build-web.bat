@echo off
setlocal
set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\owpengram-web.mjs"

if not exist "%SCRIPT%" (
  echo [ERROR] Missing script: %SCRIPT%
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  exit /b 1
)

rem build / embed given on the command line skips the menu
if /i "%~1"=="build" goto run
if /i "%~1"=="embed" goto run

echo.
echo   Build the web client:
echo     [1] build - production build into dist\
echo     [2] embed - build into ..\owpengram-server, served by it
echo.
choice /c 12 /n /m "  Choice [1/2]: "
if errorlevel 2 (
  set "MODE=embed"
) else (
  set "MODE=build"
)
node "%SCRIPT%" %MODE% %*
goto done

:run
node "%SCRIPT%" %*

:done
set "ERR=%ERRORLEVEL%"
if %ERR% neq 0 pause
exit /b %ERR%
