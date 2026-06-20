@echo off
setlocal
cd /d "%~dp0"

set SKIP_START=0
if /I "%~1"=="-SkipStart" (
  set SKIP_START=1
)

if "%SKIP_START%"=="0" (
  node "%~dp0scripts\smoke-infomat-services.mjs" --start
) else (
  node "%~dp0scripts\smoke-infomat-services.mjs"
)
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
