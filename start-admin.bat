@echo off
cd /d "%~dp0"
start "" http://localhost:4001
node admin.js
pause
