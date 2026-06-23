@echo off
setlocal
cd /d "%~dp0"

set SKIP_START=0
if /I "%~1"=="-SkipStart" (
  set SKIP_START=1
)

if "%SKIP_START%"=="0" (
  call "%~dp0start-infomat-services.cmd"
  if errorlevel 1 (
    set EXITCODE=%ERRORLEVEL%
    endlocal & exit /b %EXITCODE%
  )
)
node "%~dp0scripts\smoke-infomat-services.mjs"
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
