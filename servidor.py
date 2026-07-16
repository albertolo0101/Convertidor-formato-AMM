"""Gravitas Command Center - servidor local (Flask).

Sirve el suite (web/), guarda asistencia y mantenimiento en CSV local,
y sincroniza a Google Sheets bajo demanda. Corre 100% offline en el
dia a dia; solo necesita internet al sincronizar.
"""
import csv
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, redirect

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DATOS_DIR = os.path.join(BASE_DIR, "datos")
FOTOS_DIR = os.path.join(DATOS_DIR, "fotos")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
ZONAS_PATH = os.path.join(BASE_DIR, "zonas.json")
SYNC_STATE_PATH = os.path.join(DATOS_DIR, "sync_state.json")
ASISTENCIA_CSV = os.path.join(DATOS_DIR, "asistencia.csv")
MANTENIMIENTO_CSV = os.path.join(DATOS_DIR, "mantenimiento.csv")

ASISTENCIA_HEADERS = [
    "id", "fecha", "hora", "timestamp_iso", "empleado_id",
    "empleado_nombre", "accion", "foto_archivo",
]
MANTENIMIENTO_HEADERS = [
    "id", "fecha", "hora", "timestamp_iso", "empleado_id", "empleado_nombre",
    "actividad", "zonas", "cantidad_zonas", "estado", "notas",
]


def cargar_config():
    if not os.path.exists(CONFIG_PATH):
        print(f"ERROR: no existe {CONFIG_PATH}.")
        print("Copia config.example.json como config.json y completa tus datos.")
        sys.exit(1)
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


CONFIG = cargar_config()
TZ = ZoneInfo(CONFIG.get("zona_horaria", "America/Guatemala"))


def ahora():
    return datetime.now(TZ)


def asegurar_datos():
    os.makedirs(DATOS_DIR, exist_ok=True)
    os.makedirs(FOTOS_DIR, exist_ok=True)
    _asegurar_csv(ASISTENCIA_CSV, ASISTENCIA_HEADERS)
    _asegurar_csv(MANTENIMIENTO_CSV, MANTENIMIENTO_HEADERS)


def _asegurar_csv(ruta, headers):
    if os.path.exists(ruta):
        return
    with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
        csv.writer(f).writerow(headers)


def leer_csv(ruta):
    if not os.path.exists(ruta):
        return []
    with open(ruta, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def leer_sync_state():
    if not os.path.exists(SYNC_STATE_PATH):
        return {"asistencia_subidas": [], "mantenimiento_subidas": [], "ultima_sync": None}
    with open(SYNC_STATE_PATH, encoding="utf-8") as f:
        return json.load(f)


app = Flask(__name__, static_folder=WEB_DIR, static_url_path="/web")


@app.route("/")
def index():
    return redirect("/web/launcher.html")


@app.route("/api/estado")
def api_estado():
    filas_asistencia = leer_csv(ASISTENCIA_CSV)
    filas_mantenimiento = leer_csv(MANTENIMIENTO_CSV)
    sync_state = leer_sync_state()

    ultimo_evento = {}
    for fila in filas_asistencia:
        ultimo_evento[fila["empleado_id"]] = fila["accion"]

    empleados = []
    for emp in CONFIG.get("empleados", []):
        accion = ultimo_evento.get(emp["id"])
        estado = "Adentro" if accion == "entrada" else "Afuera"
        empleados.append({"id": emp["id"], "nombre": emp["nombre"], "estado": estado})

    subidas_asistencia = set(sync_state.get("asistencia_subidas", []))
    subidas_mantenimiento = set(sync_state.get("mantenimiento_subidas", []))
    pendientes_asistencia = sum(1 for f in filas_asistencia if f["id"] not in subidas_asistencia)
    pendientes_mantenimiento = sum(1 for f in filas_mantenimiento if f["id"] not in subidas_mantenimiento)

    return jsonify({
        "ok": True,
        "empleados": empleados,
        "pendientes_sync": {
            "asistencia": pendientes_asistencia,
            "mantenimiento": pendientes_mantenimiento,
        },
        "ultima_sync": sync_state.get("ultima_sync"),
    })


@app.route("/api/zonas")
def api_zonas():
    if not os.path.exists(ZONAS_PATH):
        return jsonify({"ok": False, "error": "No existe zonas.json"}), 500
    with open(ZONAS_PATH, encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.errorhandler(404)
def not_found(e):
    return jsonify({"ok": False, "error": "No encontrado"}), 404


@app.errorhandler(500)
def error_interno(e):
    return jsonify({"ok": False, "error": "Error interno del servidor"}), 500


if __name__ == "__main__":
    asegurar_datos()
    puerto = CONFIG.get("puerto", 8787)
    print(f"Gravitas Command Center corriendo en http://localhost:{puerto}")
    try:
        app.run(host="127.0.0.1", port=puerto, debug=False)
    except OSError as e:
        if "Address already in use" in str(e) or "WinError 10048" in str(e) or getattr(e, "errno", None) == 98:
            print(f"ERROR: el puerto {puerto} ya esta en uso.")
            print("Cerra el otro proceso que lo esta usando, o cambia 'puerto' en config.json.")
            sys.exit(1)
        raise
