# Gravitas · Suite AMM

Herramienta para convertir la medición del contador al formato que requiere AMM para subir los datos a su portal de una planta de generación distribuida renovable (GDR).

Funciona 100% en el navegador — sin servidor, sin instalación, sin internet requerido (excepto para descargar ZIPs del portal AMM).

---

## Cómo usar

### Paso 1 — Cargar medición mensual

Arrastrá o seleccioná el archivo Excel exportado de Gravitas (`.xls` o `.xlsx`).
La herramienta acepta:
- Hoja **"Gravitas pri"** con datos cada 15 minutos (los agrega a horario automáticamente)
- Hoja **"Lectura convertida"** con datos horarios ya procesados

El mes se detecta automáticamente del archivo.

---

### Paso 2 — Precios POE del mes

Elegí una de tres opciones:

**A · Tengo los ZIPs del portal AMM**
Cargá los archivos `PD{AÑO}{MES}{DIA}.zip` diarios (todos los días del mes). La herramienta extrae los precios POE hora a hora de cada ZIP y genera el CSV consolidado.

**B · Ya tengo el CSV consolidado POE**
Cargá directamente el archivo `POE_AMM_DDMMAAAA_DDMMAAAA.csv` generado en un proceso anterior.

**C · Descargar ZIPs ahora**
Abre automáticamente los enlaces de descarga del mes detectado desde el portal AMM. Una vez descargados, cargalos con la opción A.

---

### Paso 3 — Revenue calculado

Una vez cargados medición y precios POE, se calcula automáticamente:
- Revenue total y promedio diario (USD)
- Precio POE promedio del mes (USD/MWh)
- Energía total generada (MWh)
- Tabla diaria y gráficas de generación y revenue

---

### Paso 4 — Descargar resultados

| Archivo | Descripción |
|---|---|
| **Formato Carga AMM** (`.xlsx`) | Canales 8549–8552 con datos horarios, listo para subir al portal AMM |
| **CSV POE Consolidado** | Precios hora × día del mes, guardalo para reutilizar en el Paso 2-B |
| **Informe PDF** | Reporte mensual con KPIs, gráficas y tabla diaria detallada |

Usá **"↺ Procesar otro mes"** para reiniciar sin recargar la página.

---

## Canales

| Canal | Medición |
|---|---|
| 8549 | kWh generados |
| 8550 | kWh consumidos |
| 8551 | kVAR generados |
| 8552 | kVAR consumidos |
