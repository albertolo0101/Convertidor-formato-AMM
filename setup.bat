@echo off
cd /d "%~dp0"
python -m venv .venv
call .venv\Scripts\activate.bat
pip install -r requirements.txt
echo.
echo Listo. Ahora podes correr iniciar.bat para arrancar el servidor.
pause
