@echo off
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 goto no_node

if not exist node_modules (
  echo Primero ejecuta: npm install
  pause
  exit /b 1
)

call npm start
exit /b %errorlevel%

:no_node
echo Node.js no encontrado. Instalalo desde https://nodejs.org/
pause
exit /b 1
