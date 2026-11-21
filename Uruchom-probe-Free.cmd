@echo off
setlocal
set "BOOKSHELF_PILOT_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%BOOKSHELF_PILOT_NODE%" (
  echo Nie znaleziono lokalnego Node.js. Zglos ten komunikat.
  pause
  exit /b 1
)
"%BOOKSHELF_PILOT_NODE%" "%~dp0services\spine-service\pilot.mjs" --free-confirmed
set "BOOKSHELF_PILOT_RESULT=%ERRORLEVEL%"
if not "%BOOKSHELF_PILOT_RESULT%"=="0" pause
exit /b %BOOKSHELF_PILOT_RESULT%
