#!/bin/bash
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
echo
echo "Listo. Ahora podes correr ./iniciar.sh para arrancar el servidor."
