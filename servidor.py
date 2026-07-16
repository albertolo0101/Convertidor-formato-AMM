"""Gravitas Command Center - servidor local (Flask).

Sirve el suite (web/), guarda asistencia y mantenimiento en CSV local,
y sincroniza a Google Sheets bajo demanda. Corre 100% offline en el
dia a dia; solo necesita internet al sincronizar.
"""
import base64
import csv
import json
import os
import sys
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, redirect, request
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build as build_service

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DATOS_DIR = os.path.join(BASE_DIR, "datos")
FOTOS_DIR = os.path.join(DATOS_DIR, "fotos")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
ZONAS_PATH = os.path.join(BASE_DIR, "zonas.json")
CREDENTIALS_PATH = os.path.join(BASE_DIR, "credentials.json")
TOKEN_PATH = os.path.join(BASE_DIR, "token.json")
SYNC_STATE_PATH = os.path.join(DATOS_DIR, "sync_state.json")
ASISTENCIA_CSV = os.path.join(DATOS_DIR, "asistencia.csv")
MANTENIMIENTO_CSV = os.path.join(DATOS_DIR, "mantenimiento.csv")
SYNC_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

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


def guardar_sync_state(sync_state):
    with open(SYNC_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(sync_state, f, ensure_ascii=False, indent=2)


def obtener_credenciales_google():
    """Devuelve credenciales OAuth validas, refrescando o re-consintiendo si hace falta."""
    creds = None
    if os.path.exists(TOKEN_PATH):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_PATH, SYNC_SCOPES)
        except (ValueError, json.JSONDecodeError):
            creds = None

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(GoogleAuthRequest())
            with open(TOKEN_PATH, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
            return creds
        except Exception:
            creds = None  # token revocado/invalido: re-consentir abajo

    if not os.path.exists(CREDENTIALS_PATH):
        raise RuntimeError(
            "No existe credentials.json. Descargalo de Google Cloud Console "
            "(OAuth Client ID, tipo Desktop app) y coloca el archivo en la raiz del proyecto."
        )

    flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SYNC_SCOPES)
    creds = flow.run_local_server(port=0)
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        f.write(creds.to_json())
    return creds


def sheets_asegurar_encabezados(service, spreadsheet_id, hoja, headers):
    ultima_col = chr(ord("A") + len(headers) - 1)
    rango = f"{hoja}!A1:{ultima_col}1"
    resp = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=rango).execute()
    if not resp.get("values"):
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id, range=rango,
            valueInputOption="RAW", body={"values": [headers]},
        ).execute()


def sheets_append(service, spreadsheet_id, hoja, filas):
    service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id, range=f"{hoja}!A1",
        valueInputOption="RAW", insertDataOption="INSERT_ROWS",
        body={"values": filas},
    ).execute()


def agregar_fila_csv(ruta, headers, fila):
    # El archivo ya nace con BOM (utf-8-sig) al crearse; abrir en 'a' con
    # utf-8-sig insertaria un BOM nuevo en medio del archivo, asi que acá
    # se agrega en utf-8 puro.
    with open(ruta, "a", newline="", encoding="utf-8") as f:
        csv.DictWriter(f, fieldnames=headers).writerow(fila)


def buscar_empleado(empleado_id):
    for emp in CONFIG.get("empleados", []):
        if emp["id"] == empleado_id:
            return emp
    return None


def purgar_fotos_viejas():
    dias = CONFIG.get("retencion_fotos_dias", 14)
    limite = time.time() - dias * 86400
    if not os.path.isdir(FOTOS_DIR):
        return
    for nombre in os.listdir(FOTOS_DIR):
        ruta = os.path.join(FOTOS_DIR, nombre)
        try:
            if os.path.isfile(ruta) and os.path.getmtime(ruta) < limite:
                os.remove(ruta)
        except OSError:
            pass


app = Flask(__name__, static_folder=WEB_DIR, static_url_path="/web")
app.json.sort_keys = False  # preservar el orden de zonas.json (actividades: lavado_paneles primero)


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


@app.route("/api/asistencia", methods=["POST"])
def api_asistencia_post():
    body = request.get_json(silent=True) or {}
    empleado_id = body.get("empleado_id")
    accion = body.get("accion")
    foto_base64 = body.get("foto_base64")

    empleado = buscar_empleado(empleado_id)
    if not empleado:
        return jsonify({"ok": False, "error": "empleado_id invalido"}), 400
    if accion not in ("entrada", "salida"):
        return jsonify({"ok": False, "error": "accion invalida (entrada|salida)"}), 400

    registro_id = str(uuid.uuid4())
    now = ahora()

    foto_archivo = "sin_foto"
    if foto_base64:
        try:
            datos_b64 = foto_base64.split(",", 1)[1] if "," in foto_base64 else foto_base64
            foto_bytes = base64.b64decode(datos_b64)
            foto_archivo = f"{registro_id}.jpg"
            with open(os.path.join(FOTOS_DIR, foto_archivo), "wb") as f:
                f.write(foto_bytes)
        except (ValueError, base64.binascii.Error):
            foto_archivo = "sin_foto"

    fila = {
        "id": registro_id,
        "fecha": now.strftime("%Y-%m-%d"),
        "hora": now.strftime("%H:%M:%S"),
        "timestamp_iso": now.isoformat(),
        "empleado_id": empleado["id"],
        "empleado_nombre": empleado["nombre"],
        "accion": accion,
        "foto_archivo": foto_archivo,
    }
    agregar_fila_csv(ASISTENCIA_CSV, ASISTENCIA_HEADERS, fila)
    purgar_fotos_viejas()

    return jsonify({"ok": True, "id": registro_id})


@app.route("/api/asistencia/hoy")
def api_asistencia_hoy():
    hoy = ahora().strftime("%Y-%m-%d")
    filas = [f for f in leer_csv(ASISTENCIA_CSV) if f["fecha"] == hoy]
    return jsonify({"ok": True, "registros": filas})


ACTIVIDADES_VALIDAS = ("lavado_paneles", "poda", "fumigacion", "mantenimiento_general")
ESTADOS_VALIDOS = ("iniciado", "en_progreso", "completado")


@app.route("/api/mantenimiento", methods=["POST"])
def api_mantenimiento_post():
    body = request.get_json(silent=True) or {}
    empleado_id = body.get("empleado_id")
    actividad = body.get("actividad")
    zonas = body.get("zonas")
    estado = body.get("estado")
    notas = body.get("notas") or ""

    empleado = buscar_empleado(empleado_id)
    if not empleado:
        return jsonify({"ok": False, "error": "empleado_id invalido"}), 400
    if actividad not in ACTIVIDADES_VALIDAS:
        return jsonify({"ok": False, "error": f"actividad invalida ({'|'.join(ACTIVIDADES_VALIDAS)})"}), 400
    if estado not in ESTADOS_VALIDOS:
        return jsonify({"ok": False, "error": f"estado invalido ({'|'.join(ESTADOS_VALIDOS)})"}), 400
    if not isinstance(zonas, list) or len(zonas) == 0:
        return jsonify({"ok": False, "error": "zonas debe ser una lista con al menos 1 elemento"}), 400

    registro_id = str(uuid.uuid4())
    now = ahora()

    fila = {
        "id": registro_id,
        "fecha": now.strftime("%Y-%m-%d"),
        "hora": now.strftime("%H:%M:%S"),
        "timestamp_iso": now.isoformat(),
        "empleado_id": empleado["id"],
        "empleado_nombre": empleado["nombre"],
        "actividad": actividad,
        "zonas": ";".join(zonas),
        "cantidad_zonas": len(zonas),
        "estado": estado,
        "notas": notas,
    }
    agregar_fila_csv(MANTENIMIENTO_CSV, MANTENIMIENTO_HEADERS, fila)

    return jsonify({"ok": True, "id": registro_id})


@app.route("/api/mantenimiento/hoy")
def api_mantenimiento_hoy():
    hoy = ahora().strftime("%Y-%m-%d")
    filas = [f for f in leer_csv(MANTENIMIENTO_CSV) if f["fecha"] == hoy]
    return jsonify({"ok": True, "registros": filas})


@app.route("/api/zonas")
def api_zonas():
    if not os.path.exists(ZONAS_PATH):
        return jsonify({"ok": False, "error": "No existe zonas.json"}), 500
    with open(ZONAS_PATH, encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.route("/api/sync", methods=["POST"])
def api_sync():
    try:
        creds = obtener_credenciales_google()
        service = build_service("sheets", "v4", credentials=creds)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    sync_state = leer_sync_state()
    subidas_asistencia = set(sync_state.get("asistencia_subidas", []))
    subidas_mantenimiento = set(sync_state.get("mantenimiento_subidas", []))
    errores = []
    asistencia_subidas = 0
    mantenimiento_subidas = 0

    cfg_asistencia = CONFIG.get("sheets", {}).get("asistencia", {})
    pendientes_asistencia = [
        f for f in leer_csv(ASISTENCIA_CSV) if f["id"] not in subidas_asistencia
    ]
    if pendientes_asistencia:
        try:
            headers = ["id", "fecha", "hora", "empleado_nombre", "accion"]
            sheets_asegurar_encabezados(
                service, cfg_asistencia["spreadsheet_id"], cfg_asistencia["hoja"], headers
            )
            filas = [[f["id"], f["fecha"], f["hora"], f["empleado_nombre"], f["accion"]]
                      for f in pendientes_asistencia]
            sheets_append(service, cfg_asistencia["spreadsheet_id"], cfg_asistencia["hoja"], filas)
            for f in pendientes_asistencia:
                subidas_asistencia.add(f["id"])
            asistencia_subidas = len(pendientes_asistencia)
        except Exception as e:
            errores.append(f"asistencia: {e}")

    cfg_mantenimiento = CONFIG.get("sheets", {}).get("mantenimiento", {})
    pendientes_mantenimiento = [
        f for f in leer_csv(MANTENIMIENTO_CSV) if f["id"] not in subidas_mantenimiento
    ]
    if pendientes_mantenimiento:
        try:
            headers = ["id", "fecha", "hora", "empleado_nombre", "actividad", "zona", "estado", "notas"]
            sheets_asegurar_encabezados(
                service, cfg_mantenimiento["spreadsheet_id"], cfg_mantenimiento["hoja"], headers
            )
            filas = []
            for f in pendientes_mantenimiento:
                zonas = [z for z in f["zonas"].split(";") if z]
                for zona in zonas:
                    filas.append([
                        f["id"], f["fecha"], f["hora"], f["empleado_nombre"],
                        f["actividad"], zona, f["estado"], f["notas"],
                    ])
            sheets_append(service, cfg_mantenimiento["spreadsheet_id"], cfg_mantenimiento["hoja"], filas)
            for f in pendientes_mantenimiento:
                subidas_mantenimiento.add(f["id"])
            mantenimiento_subidas = len(pendientes_mantenimiento)
        except Exception as e:
            errores.append(f"mantenimiento: {e}")

    if asistencia_subidas or mantenimiento_subidas:
        sync_state["asistencia_subidas"] = sorted(subidas_asistencia)
        sync_state["mantenimiento_subidas"] = sorted(subidas_mantenimiento)
        sync_state["ultima_sync"] = ahora().isoformat()
        guardar_sync_state(sync_state)

    return jsonify({
        "ok": len(errores) == 0,
        "asistencia_subidas": asistencia_subidas,
        "mantenimiento_subidas": mantenimiento_subidas,
        "errores": errores,
    })


@app.errorhandler(404)
def not_found(e):
    return jsonify({"ok": False, "error": "No encontrado"}), 404


@app.errorhandler(500)
def error_interno(e):
    return jsonify({"ok": False, "error": "Error interno del servidor"}), 500


if __name__ == "__main__":
    asegurar_datos()
    purgar_fotos_viejas()
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
