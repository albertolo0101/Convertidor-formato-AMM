# Gravitas Command Center — contexto para Claude

Herramienta interna de **Gravitas, Planta Solar 5 MW (Guatemala)**. Repo:
`Convertidor-formato-AMM` (el nombre viene del módulo original; hoy el proyecto
es más amplio).

**Alcance:** esta suite es del **departamento de mantenimiento** de la planta.
La administración de la planta se maneja en otra suite aparte, fuera de este
repo. Por eso el proyecto desplegado se llama `gravitas-mantenimiento`: el
nombre es correcto, no lo "corrijas" a algo más genérico.

## Estado: migración de local → nube (agosto 2026)

El proyecto **era** un servidor Flask local (`servidor.py`) que guardaba CSVs en
`datos/` y sincronizaba a Google Sheets. **Eso se está eliminando.** No lo
reintroduzcas ni lo "arregles": si ves código de Flask, CSV local, `credentials.json`,
`token.json` o Google Sheets API, es legado pendiente de borrar.

### Arquitectura destino

```
Navegador (HTML estático)  →  Supabase Edge Function  →  Postgres + Storage
       │                            (service_role)
       └── admin.html → Supabase Auth (Google) → RLS
```

- **Hosting**: estático. Las páginas no necesitan servidor propio.
- **Datos**: Supabase Postgres.
- **Fotos**: Supabase Storage, bucket **privado** `fotos`.
- **Auth**: Supabase Auth con Google, **solo para administradores**.
  El kiosko de asistencia **no tiene login** — es deliberado.
- **Google** se usa *únicamente* como proveedor de identidad. Nada de Sheets,
  nada de Drive. Si hace falta exportar, se genera CSV/XLSX en el navegador.

## Regla de seguridad no negociable

La clave `anon` de Supabase viaja en el HTML: es pública por diseño.
Por lo tanto:

- **`anon` no puede leer ni escribir ninguna tabla.** RLS activa en todas, sin
  políticas para `anon`.
- La **única** puerta de entrada del kiosko es la Edge Function `marcar`, que
  corre con `service_role`. Recibe `{ codigo, foto_base64 }`, valida el código
  contra `trabajadores` (tabla que anon no puede leer), decide entrada/salida,
  sube la foto y escribe el registro.
- El código de 4 dígitos + la foto **son** la autenticación del trabajador.
  La foto es la prueba real; el código solo identifica.
- Nunca pongas `service_role` en un archivo del front ni en el repo.

## Esquema

```sql
trabajadores (id uuid pk, codigo text unique, nombre text, activo bool, creado_en timestamptz)
asistencia   (id uuid pk, trabajador_id uuid fk, accion text check(entrada|salida),
              marcado_en timestamptz, foto_path text null, foto_purgada bool)
admins       (email text pk, creado_en timestamptz)
```

RLS: `authenticated` puede SELECT solo si
`auth.jwt()->>'email' in (select email from admins)`.

## Retención

Dos políticas distintas, no las confundas:

- **Registros de asistencia: se conservan indefinidamente.** Son el dato de
  nómina y pesan kilobytes.
- **Fotos: se borran a los 10 días.** La purga corre dentro de la Edge Function
  `marcar` en cada marca (sin cron: nada que se rompa en silencio). Al purgar se
  pone `foto_path = null` y `foto_purgada = true`.

## Decisiones tomadas

| Decisión | Elección | Por qué |
|---|---|---|
| Entrada vs salida | **Se deduce** de la última marca del trabajador | Un toque menos. Se corrige desde el admin si marcan doble. La UI lo muestra en grande para que lo confirmen visualmente. |
| Framework front | **HTML/CSS/JS vanilla**, sin build | Ya existe y funciona; agregar Next.js no aporta nada aquí. |
| Zona horaria | Se guarda `timestamptz` (UTC), se muestra en `America/Guatemala` | |
| Fotos | JPEG 640×480, calidad 0.7, ≈60 KB | 2 trabajadores × 4 marcas × 10 días ≈ 5 MB |

## Riesgos conocidos y abiertos

1. **Dependencia de internet.** Antes la planta funcionaba offline. Si se cae la
   conexión no pueden marcar. Mitigación pendiente: cola en `localStorage` con
   reintento (fase posterior).
2. **Fuerza bruta del código de 4 dígitos** (10 000 combinaciones). Mitigación en
   la Edge Function: registro de intentos fallidos y bloqueo temporal por IP.
3. **La webcam exige HTTPS** (o `localhost`). Cualquier hosting que se elija debe
   servir por HTTPS.
4. Los proyectos Supabase gratis se pausan tras 7 días **sin actividad**. Con uso
   diario no ocurre.

## Módulos

| Módulo | Archivo | Estado |
|---|---|---|
| Asistencia (kiosko) | `public/index.html` | **Listo.** Sirve en la raiz del sitio. |
| Panel admin | `public/admin.html` | Por crear (login Google + ultimos 10 dias + export CSV) |
| Convertidor AMM | `public/amm.html` | **100 % cliente, no toca backend.** Se despliega tal cual, no lo modifiques. |
| Mantenimiento | `web/mantenimiento.html` | Congelado. Se migra después de asistencia. |
| Launcher | `web/launcher.html` | Se rehará; hoy depende de Flask. |

## Convenciones

- Todo el texto de la interfaz y los nombres de campos van **en español**.
- Se conserva el diseño existente: fondo oscuro, IBM Plex Mono/Sans, acento
  cian `#00e5ff`. No lo reemplaces por otro sistema de diseño.
- El kiosko corre en la PC de la planta, a pantalla completa, operado con mouse
  o pantalla táctil: botones grandes, tipografía grande.

---

# Infraestructura desplegada (28 ago 2026)

## Supabase — proyecto `gravitas`

| | |
|---|---|
| Ref | `rshrbxqflzyqkmaywcwv` |
| URL | `https://rshrbxqflzyqkmaywcwv.supabase.co` |
| Región | `us-east-1` |
| Proyecto | `GRAVITAS` |
| Cuenta | **Cuenta de trabajo** (`alberto@energygravitas.com`) |
| Plan | Free, $0/mes |

**Clave publicable** (va en el HTML, es pública por diseño):
`sb_publishable_kCF5u53qP_6qhAn0wu0oNQ_qoov7lWA`

La `service_role` **no** se guarda en el repo. La Edge Function la recibe del
entorno (`SUPABASE_SERVICE_ROLE_KEY`), inyectada automáticamente por Supabase.

## Endpoint del kiosko

```
POST https://rshrbxqflzyqkmaywcwv.supabase.co/functions/v1/marcar
Content-Type: application/json
{ "codigo": "1234", "foto_base64": "data:image/jpeg;base64,..." | null }
```

Respuestas: `200 {ok,nombre,accion,hora,con_foto}` · `400` código mal formado ·
`401` código no reconocido · `429` demasiados intentos · `405` método.

Desplegada con **`verify_jwt = false`**: es intencional. El kiosko no tiene
login, así que la función implementa su propia autenticación (código de 4
dígitos) y su propio freno de intentos. No la vuelvas a activar.

Código fuente versionado en `supabase/functions/marcar/index.ts`. Al editarlo,
**redesplegá** — el archivo local no se sincroniza solo.

## Freno de fuerza bruta

10 intentos fallidos por IP en 10 minutos → `429`. **Una marca correcta borra el
contador de esa IP**: toda la planta sale por una sola IP y un trabajador que se
equivoque no puede dejar bloqueado al otro. Un atacante solo envía códigos
inválidos, así que para él el freno sigue vigente.

## Esquema `private`

`private.es_admin()` está fuera de `public` a propósito: en `public` quedaba
publicada como `/rest/v1/rpc/es_admin`. **No muevas funciones auxiliares a
`public`** — el linter de seguridad lo marca. Verificá con `get_advisors` después
de cada cambio de DDL.

## Verificado en producción

- anon recibe `permission denied` en las 4 tablas (SELECT e INSERT).
- Bucket `fotos` privado: anon obtiene 400/404 incluso con la ruta exacta.
- Entrada/salida alterna correctamente; se reinicia a `entrada` al día siguiente.
- Foto subida y asociada al registro.
- Freno: 401×8 → 429; una marca válida lo limpia.
- `get_advisors` (security): sin hallazgos.

## Estructura de publicacion

Cloudflare Pages publica **una carpeta**, no el repo. El directorio de salida es
`public/` y contiene unicamente lo que debe ser publico:

```
public/
├── index.html    kiosko de asistencia (raiz del sitio)
├── amm.html      convertidor AMM
├── logo.png
└── _headers      cabeceras de seguridad de Cloudflare Pages
```

**Nunca publiques la raiz del repo.** Ahi viven `config.json`, `datos/`,
`servidor.py` y `.venv/`. Estan en `.gitignore`, pero un despliegue por carga
directa de la carpeta equivocada los expondria igual.

`_headers` incluye `Permissions-Policy: camera=(self)`. Si lo tocas, no le quites
el permiso de camara o el kiosko deja de poder sacar fotos.

El repo de GitHub es **publico** (`albertolo0101/Convertidor-formato-AMM`). No
metas secretos en el codigo del front. La clave publicable de Supabase si va ahi:
es publica por diseno y no puede leer ni escribir nada.

## Doble marca accidental

`GRACIA_SEG = 90` en la Edge Function. Si un trabajador toca la pantalla dos
veces, la segunda llamada **no crea un registro nuevo**: devuelve el que ya
existe con `repetida: true`, y el kiosko muestra "YA HABIAS MARCADO". Sin esto,
un doble toque registraba ENTRADA y SALIDA con segundos de diferencia y
corrompia la jornada sin que nadie lo notara.

## Probar en local

La camara exige contexto seguro, pero `localhost` cuenta como tal — no hace
falta desplegar para probar:

```
python -m http.server 8090 --bind 127.0.0.1 --directory <raiz del repo>
# luego abrir http://localhost:8090/public/index.html
```

Ojo: las marcas de prueba caen en la base de produccion. Limpialas despues.

# Despliegue — Cloudflare

| | |
|---|---|
| URL de produccion | `https://gravitas-mantenimiento.alberto-175.workers.dev` |
| Proyecto | `gravitas-mantenimiento` |
| Rama de produccion | `main` |
| Carpeta publicada | `public/` |
| Configuracion | `wrangler.jsonc` (versionada) |

**Cada push a `main` redespliega.** No hay paso manual.

Se desplego como **Worker con assets estaticos**, no como Pages: es el camino
por defecto de Cloudflare hoy. `_headers` funciona igual (verificado: las cuatro
cabeceras llegan, incluida `permissions-policy: camera=(self)`).

Cloudflare sirve las paginas sin extension: `/amm.html` redirige a `/amm`.

## Verificado en produccion

- `/`, `/amm`, `/logo.png` -> 200.
- `servidor.py`, `config.json`, `config.example.json`, `requirements.txt`,
  `zonas.json`, `README.md`, `CLAUDE.md`, `datos/asistencia.csv` y el codigo de
  la Edge Function -> **404**. Nada privado esta expuesto.
- Las cuatro cabeceras de `_headers` se aplican.

## Molestia conocida del build

Cloudflare detecta `requirements.txt` y corre `pip install` (Flask + librerias
de Google, 30 paquetes) en cada despliegue de un sitio que es puro HTML.
Desaparece solo cuando la Fase 5 borre Flask.

## CORS de la Edge Function

Restringido a la URL de produccion, a `localhost:8090` y a cualquier
`*.alberto-175.workers.dev` (las vistas previas de cada version).

**El CORS no protege el endpoint.** Solo impide que un navegador en otro dominio
lea la respuesta; con `curl` se saltea por completo. Las defensas reales son el
codigo de 4 digitos, el freno de intentos y la foto. Si cambia el dominio, hay
que actualizar `ORIGENES_PERMITIDOS` **y redesplegar la funcion**.

## Pendientes

- [x] Trabajadores cargados: `2934` Winston Pinto, `9563` David Vargas.
      Codigos no obvios a proposito: el endpoint es descubrible desde el HTML
      publicado, y un `1234` se acierta antes de que el freno actue.
      Base limpia: 0 marcas, 0 fotos, 0 intentos.
- [x] Admins cargados: `alberto@energygravitas.com` y `albertolopez2199@gmail.com`.
- [ ] Habilitar el proveedor Google en Supabase Auth.
- [x] CORS restringido al dominio de produccion.
- [x] Desplegado en Cloudflare y verificado.
- [ ] **Fase 4:** panel de administrador (`public/admin.html`).
- [ ] **Fase 5:** borrar Flask, Sheets, CSV y las paginas legadas de `web/`.
- [ ] Acceso directo en modo kiosko en la PC de la planta.
- [ ] Cola offline en `localStorage`: hoy, sin internet, no se puede marcar.


---

# Historia: el proyecto se recreo (28 ago 2026)

El primer proyecto de Supabase (`hfudsedbkmbptxidyzyy`) se creo bajo la cuenta
**personal**, porque era la unica organizacion que alcanzaba el conector MCP.
Al intentar habilitar Google Auth desde el navegador —con sesion de la cuenta de
**trabajo**— el panel respondia "no tenes acceso": en Supabase son dos cuentas
distintas.

Se resolvio recreando el proyecto bajo la cuenta de trabajo
(`rshrbxqflzyqkmaywcwv`) y borrando el original. No se perdio ningun dato: la
base estaba en cero, recien limpiada de las pruebas.

**Consecuencia vigente:** el conector MCP de Supabase esta autenticado contra la
cuenta personal y **no alcanza este proyecto**. En la practica:

- No se pueden aplicar migraciones, desplegar la Edge Function ni consultar la
  base desde las herramientas. Todo eso lo hace el usuario desde el panel.
- Lo que si se puede hacer desde afuera es **verificar**: la Edge Function, el
  bloqueo de `anon` sobre cada tabla, el estado del bucket y los proveedores de
  Auth se comprueban con `curl` contra los endpoints publicos. Usá eso para
  confirmar cualquier cambio en vez de darlo por hecho.
- Para recuperar el acceso programatico habria que reconectar el conector de
  Supabase con la cuenta de trabajo, o invitar a la cuenta personal a la
  organizacion nueva.

Por eso existe `supabase/instalacion.sql`: reconstruye el backend entero en un
proyecto vacio de una sola pasada. Manteneelo al dia si el esquema cambia — es
la unica via de instalacion que no depende del conector.
