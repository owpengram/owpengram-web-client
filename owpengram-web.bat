@echo off
setlocal
set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\owpengram-web.mjs"

if not exist "%SCRIPT%" (
  echo [ERROR] Missing script: %SCRIPT%
  exit /b 1
)

node "%SCRIPT%" %*
set "ERR=%ERRORLEVEL%"
if %ERR% neq 0 pause
exit /b %ERR%
