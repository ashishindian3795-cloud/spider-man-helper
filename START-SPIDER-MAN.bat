@echo off
setlocal
cd /d "%~dp0"                                                                   
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\typescript\bin\tsc" (
  echo Installing Spider-Man Companion dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

call npm run start
if errorlevel 1 (
  echo Spider-Man Companion could not start. Review the error above.
  pause
  exit /b 1
)
