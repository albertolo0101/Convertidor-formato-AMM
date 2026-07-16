# ⚡ Gravitas Command Center

Command center local para **Gravitas — Planta Solar 5 MW**, Guatemala. Corre como
un servidor Python en la PC de la planta (`http://localhost:8787`) — nada de
internet en el día a día; solo hace falta conexión al sincronizar con Drive.

## Módulos

| Módulo | Archivo | Descripción |
|--------|---------|-------------|
| Panel Principal | `web/launcher.html` | Lanzador del suite + estado de empleados + sync a Drive |
| Asistencia | `web/asistencia.html` | Marcar entrada/salida tocando el nombre; saca una foto de verificación |
| Mantenimiento | `web/mantenimiento.html` | Mapa de la planta para registrar zonas trabajadas por actividad |
| AMM: Medición → Ingresos | `web/index.html` | Convierte medición Gravitas a formato AMM + calcula ingresos POE |

Los datos de asistencia y mantenimiento se guardan localmente en `datos/*.csv`.
Cada tanto, desde el Panel Principal, se sincronizan a dos Google Sheets separados
en Drive (uno de asistencia, uno de mantenimiento). La sincronización es
idempotente: volver a sincronizar nunca duplica filas.

## Setup inicial

### 1. Python

Necesitás Python 3.10+ instalado en la PC de la planta.

### 2. Google Cloud (para la sincronización con Drive)

1. Andá a https://console.cloud.google.com, creá un proyecto y habilitá la
   **Google Sheets API**.
2. Credenciales → **Crear credenciales → ID de cliente de OAuth** → Tipo de
   aplicación: **Aplicación de escritorio (Desktop app)**.
3. Descargá el JSON de esas credenciales y guardalo como `credentials.json` en
   la raíz de esta carpeta (el nombre del archivo debe ser exactamente ese).
4. Creá dos Google Sheets en Drive: uno para Asistencia y otro para
   Mantenimiento. Compartí ambos con tu correo de trabajo como **Editor**.
5. Copiá el `spreadsheet_id` de cada uno (el texto entre `/d/` y `/edit` en la
   URL) y pegalo en `config.json` (ver paso siguiente).

### 3. Configurar el proyecto

1. Copiá `config.example.json` como `config.json`.
2. Editá `config.json`:
   - `empleados`: lista de los 2 empleados (`id` y `nombre`).
   - `sheets.asistencia.spreadsheet_id` y `sheets.mantenimiento.spreadsheet_id`:
     los IDs del paso anterior.
   - `puerto` y `retencion_fotos_dias` normalmente no hace falta tocarlos.
3. Corré `setup.bat` (Windows) o `./setup.sh` (mac/Linux) **una sola vez**. Esto
   crea un entorno virtual (`.venv`) e instala las dependencias.

`config.json`, `credentials.json`, `token.json` y la carpeta `datos/` nunca se
suben al repositorio (están en `.gitignore`) porque contienen datos privados o
credenciales.

## Uso diario

Corré `iniciar.bat` (Windows) o `./iniciar.sh` (mac/Linux). Esto levanta el
servidor y abre el navegador en `http://localhost:8787`.

### Acceso directo de escritorio (Windows)

Creá un acceso directo con este destino (ajustando la ruta a esta carpeta):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --app="http://localhost:8787"
```

### Sincronizar con Drive

Desde el Panel Principal, botón **"Sincronizar con Drive"**. La primera vez va a
pedir que inicies sesión con tu correo de trabajo (se abre el navegador para el
consentimiento de Google); después queda cacheada la sesión en `token.json` y
no lo vuelve a pedir hasta que expire o la revoques.

## Módulo Asistencia — nota de privacidad

Al marcar entrada o salida, la webcam saca una foto para verificar quién
marcó. **Las fotos se guardan solo en esta PC** (`datos/fotos/`), nunca se
suben a Drive ni a ningún lado, y se **borran automáticamente a los 14 días**.
Si no hay cámara disponible o se niega el permiso, la marca se registra igual
sin foto. Informá esto a los empleados antes de usar el módulo.

## Módulo Mantenimiento

El mapa (`zonas.json`) tiene 4 cuadrantes de paneles (C1–C4), las calles/zonas
de poda (divididas en 2 mitades por fila), los drenajes pluviales y las zonas
verdes. Cada actividad habilita solo los tipos de zona que le corresponden:

| Actividad | Zonas habilitadas |
|-----------|--------------------|
| Lavado de paneles | Paneles (azul) |
| Poda | Calles/poda (blanco) + Drenajes (celeste) |
| Fumigación | Calles/poda (blanco) + Drenajes (celeste) |
| Mantenimiento general | Verde |

## Uso del módulo AMM

### Paso 1 — Cargar medición mensual
Arrastrá o seleccioná el archivo Excel exportado de Gravitas (`.xls` o `.xlsx`).
Acepta hoja **"Gravitas pri"** (15 min) o **"Lectura convertida"** (horaria). El mes se detecta automáticamente.

### Paso 2 — Precios POE del mes
- **A · ZIPs del portal AMM** — cargá los `PD{AÑO}{MES}{DIA}.zip` diarios
- **B · CSV consolidado POE** — cargá el `POE_AMM_DDMMAAAA_DDMMAAAA.csv` de un proceso anterior
- **C · Descargar ZIPs** — abre los enlaces del mes desde el portal AMM

### Paso 3 — Ingresos calculados
Revenue total, promedio diario, precio POE promedio, tabla diaria y gráficas.

### Paso 4 — Descargar resultados
| Archivo | Descripción |
|---------|-------------|
| **Formato Carga AMM** (`.xlsx`) | Canales 8549–8552, listo para subir al portal |
| **CSV POE Consolidado** | Precios hora × día, reutilizable en Paso 2-B |
| **Informe PDF** | Reporte mensual con KPIs, gráficas y tabla diaria |

## Canales AMM

| Canal | Medición |
|-------|----------|
| 8549 | kWh generados |
| 8550 | kWh consumidos |
| 8551 | kVAR generados |
| 8552 | kVAR consumidos |

## Estructura de la carpeta

```
├── iniciar.bat / iniciar.sh   # arranque diario: servidor + navegador
├── setup.bat  / setup.sh      # una sola vez: venv + dependencias
├── servidor.py                # servidor local (Flask)
├── requirements.txt
├── config.example.json        # plantilla (versionada)
├── config.json                 # real, con datos propios (gitignored)
├── zonas.json                  # mapa de la planta
├── credentials.json             # OAuth Desktop client (gitignored)
├── token.json                   # sesión cacheada (gitignored)
├── datos/                       # asistencia.csv, mantenimiento.csv, fotos/ (gitignored)
├── web/                         # launcher, asistencia, mantenimiento, AMM
└── logo.png
```
