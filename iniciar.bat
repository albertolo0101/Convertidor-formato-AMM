@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
start "Gravitas Servidor" cmd /k python servidor.py
timeout /t 2 /nobreak >nul
start "" http://localhost:8787
