# ⚡ Gravitas Suite

Suite de herramientas operativas para **Gravitas — Planta Solar 5 MW**, Guatemala.
Corre 100% como archivos locales. Abrí `launcher.html` desde el escritorio.

## Módulos

| Archivo | Módulo | Descripción |
|---------|--------|-------------|
| `launcher.html` | Panel Principal | Lanzador del suite + stats rápidos de inventario |
| `index.html` | AMM: Medición → Ingresos | Convierte medición Gravitas a formato AMM + calcula ingresos POE |
| `insumos-planta.html` | Inventario Planta | Herramientas y consumibles de la planta (GVT-XXXX) |
| `insumos-hincadora.html` | Inventario Hincadora | Herramientas y consumibles de la hincadora (HIN-XXXX) |

## Setup inicial (inventario)

### 1. Google Cloud Console
1. Ir a https://console.cloud.google.com
2. Crear proyecto → Habilitar **Google Sheets API**
3. Credenciales → Crear **API key** → Restringir a Sheets API
4. Credenciales → Crear **OAuth 2.0 Client ID** → Tipo: Web application → Authorized JavaScript origins: agregar `null` (para archivos locales)

### 2. Google Sheets
1. Abrir el Sheet `Planta_Registro_de_Insumos` en Drive
2. Asegurarse de que tenga 10 columnas (A–J): `Item ID, Nombre, categoría, Precio, Stock, Unidades, Status, Fecha entrega, Fecha de baja, Vida util (dias)`
3. Repetir para `Hincadora_Registro_de_Insumos` — agregar columnas I y J si no existen
4. Compartir ambos sheets con tu Gmail personal como **Editor**

### 3. Configurar los archivos
En `insumos-planta.html` y `insumos-hincadora.html`, encontrá el bloque CONFIG al inicio del `<script>` y pegá:
- `SHEET_ID` — el ID del Sheet (parte del URL entre `/d/` y `/edit`)
- `API_KEY` — la API key de Google Cloud
- `CLIENT_ID` — el OAuth 2.0 Client ID (termina en `.apps.googleusercontent.com`)

En `launcher.html`, pegá los mismos valores en el bloque `SUITE_CONFIG` para habilitar las stats rápidas.

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

## Shortcut de escritorio (Windows)

```
Target: "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="file:///C:/ruta/gravitas-suite/launcher.html"
```
Reemplazá la ruta con la ubicación real de la carpeta.

## Sin servidor · sin instalación · portable
Copiá la carpeta completa a otro equipo y abrí `launcher.html`. Solo hay que volver a pegar las credenciales en el CONFIG si no están guardadas.
