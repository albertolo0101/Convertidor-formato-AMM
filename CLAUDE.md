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
| Región | `us-west-2` |
| Proyecto | `GRAVITAS` |
| Cuenta | **Cuenta de trabajo** (`alberto@energygravitas.com`) |
| Organizacion | `yespfcmpitmqvospiaah` — `GRAVITAS` |
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

**Resuelto.** El conector se reautorizo apuntando a la organizacion `GRAVITAS`
y el acceso programatico esta operativo.

**Lo que se aprendio, y conviene no volver a tropezar:** el conector de Supabase
se vincula a **una sola organizacion a la vez**. Ese alcance queda grabado en el
token al autorizarlo; agregar la cuenta a otra organizacion despues **no** amplia
lo que el token ya puede ver. Si en el futuro aparece un proyecto que existe pero
el conector no lista, la causa mas probable es esa — no una falta de permisos.
Se arregla reautorizando el conector y eligiendo la organizacion correcta.

Vale la pena conservar la costumbre de **verificar desde afuera con `curl`**
contra los endpoints publicos (Edge Function, bloqueo de `anon` por tabla,
estado del bucket, proveedores de Auth). Prueba lo que ve el mundo real, no lo
que ve un administrador con credenciales privilegiadas.

Por eso existe `supabase/instalacion.sql`: reconstruye el backend entero en un
proyecto vacio de una sola pasada. Manteneelo al dia si el esquema cambia — es
la unica via de instalacion que no depende del conector.


---

# Kiosko: indicador de quien esta en planta

El kiosko muestra arriba quien esta actualmente dentro, con un punto verde.

**Esto invirtio una decision anterior.** Al principio el kiosko no mostraba
ningun nombre hasta ingresar un codigo, para no revelar quien trabaja en la
planta. Se cambio a pedido del usuario: ver de un vistazo quien esta adentro es
util operativamente, y el anonimato de los nombres no era lo que protegia el
registro — eso lo hacen el codigo de 4 digitos y la foto. **No lo "restaures"
pensando que es una regresion de seguridad.**

## Edge Function `estado`

Segunda —y ultima— puerta publica del kiosko. `anon` no puede leer tablas, asi
que el kiosko necesita esta funcion para saber quien esta dentro.

```
GET /functions/v1/estado  ->  { ok: true, dentro: [{ nombre, desde }] }
```

Expone **solo nombre y hora de entrada**. Nunca codigos, ids ni historial.
Cualquiera en internet puede leer lo que salga de aca: si vas a agregarle
campos, pensalo dos veces.

"Dentro" = su ultima marca es una `entrada` **de hoy**. Una entrada de ayer sin
salida es un olvido, no alguien que sigue en la planta.

El kiosko lo refresca cada 60 s y ademas justo despues de cada marca. Si falla
la peticion no borra lo que ya muestra: es preferible un dato de hace un minuto
que una caja vacia que parezca "no hay nadie".

# Panel admin: jornadas, no marcas sueltas

Una fila por trabajador y por dia:
`fecha · nombre · entrada · foto · salida · foto · horas totales`

Las horas son la **suma de los tramos** entrada→salida, no la resta entre la
primera entrada y la ultima salida. Asi quien sale a almorzar y vuelve no cobra
el almuerzo. La fila muestra la primera entrada y la ultima salida; si hubo mas
marcas, se indica con `+N marcas` para no ocultar nada.

Casos que la UI distingue a proposito:
- `falta` en rojo — no marco entrada, o no marco salida.
- `sin cerrar` — sigue adentro o se olvido de marcar la salida; las horas no cierran.
- `Sin foto` en rojo vs `Expirada` en gris — la primera merece revision, la
  segunda es la retencion de 10 dias funcionando.

El CSV exporta jornadas con las mismas columnas, mas `horas_decimal` para
calculos de nomina y una columna de observaciones.

**Limitacion conocida:** un turno que cruce la medianoche de Guatemala se parte
en dos filas incompletas. Hoy no aplica (turno diurno). Si algun dia hay turno
nocturno, hay que reescribir `armarJornadas`.

La logica de emparejado esta cubierta por pruebas: extraer `armarJornadas` y
`duracion` de `public/admin.html` y correrlas con Node. Casos verificados:
jornada normal, almuerzo, olvido de salida, salida huerfana y dias separados.

---

# Modulos: insumos, registro de actividad y visitas (28 ago 2026)

Tres modulos accesibles desde botones grandes en la pantalla principal del
kiosko, debajo del teclado. **Se guardan de forma ANONIMA**: no piden el codigo
de 4 digitos. Fue decision explicita del usuario — un toque menos por operacion.

Las tres tablas llevan `trabajador_id` **nullable** justamente por eso: si algun
dia se quiere atribuir autoria, es un cambio de interfaz y no una migracion
sobre datos en vivo.

## Edge Function `registrar`

Puerta de escritura de los tres modulos. Una sola funcion porque comparten CORS,
validacion y forma de respuesta. `verify_jwt = false`, igual que `marcar`.

```
POST /functions/v1/registrar
{ tipo: "insumos" | "actividad" | "visita", ... }
```

Este endpoint **no autentica a nadie**. Lo puede llamar cualquiera en internet,
asi que la validacion es la unica defensa: rechaza lo malformado y recorta lo
excesivo (40 insumos, 200 sectores, 2000 caracteres de notas). Si le agregas
campos, agregales tope.

## El mapa de la planta

192 sectores en **cuatro bloques separados** — asi es la planta, no es una
cuadricula continua:

| Cuadrante | Posicion | Columnas | Filas | Sectores |
|---|---|---|---|---|
| C1 | superior izquierdo | 1–4 | A–R (18) | 72 |
| C2 | inferior izquierdo | 1–4 | A–R (18) | 72 |
| C3 | superior derecho | 1–2 | A–L (12) | 24 |
| C4 | inferior derecho | 1–2 | A–L (12) | 24 |

Identificador: `C1-A1`, `C3-L2`.

**El mapa esta definido dos veces**: en `public/index.html` para dibujarlo y en
`supabase/functions/registrar/index.ts` para validarlo. La copia de la funcion
es la que manda — ahi se decide que codigo es valido, nunca en el navegador. Si
cambia la planta, hay que cambiar las dos y redesplegar la funcion.

Las celdas se dibujan como rectangulos **6:1**, la forma real de una fila de
paneles. Las medidas estan en variables CSS (`--celda-alto`, `--celda-ancho`)
para ajustarlas en un solo lugar; el ancho debe ser 6x el alto.

Tocar una letra selecciona la fila entera; tocar un numero, la columna entera.
Sin eso, marcar 72 celdas de a una seria inusable.

## Reglas del registro de actividad

- **Con sectores**: exige elegir fumigacion, poda o lavado. Notas opcionales.
- **Sin sectores**: se habilitan inversores / rondas antifuego / subestacion /
  otros. Exigen notas **obligatorias** y levantan `requiere_revision`.
- Son excluyentes, y la UI apaga el bloque que no corresponde en vez de dejar
  llenar los dos y fallar al enviar.
- Las restricciones estan tambien en la base (`sectores_completos`,
  `especial_completo`): si algun dia otro cliente escribe ahi, no puede colar un
  registro incompleto.

## Banderas

`requiere_revision` solo se levanta en actividades especiales. El administrador
la baja con un clic y se guarda `revisado_en` y `revisado_por`: una bandera que
desaparece sin dejar rastro no sirve como control. Lo mismo con el estado
`pendiente`/`atendida` de las solicitudes de insumos.

El panel muestra una chapa roja con la cantidad pendiente en cada pestaña,
contada al entrar — sin eso habria que abrir cada pestaña para descubrir que
quedo algo sin revisar.

## Visitas

Solo registro de llegada, sin marcar salida. Nombre e **identificacion**
(DPI, pasaporte o licencia) son obligatorios; empresa y motivo, opcionales.
La columna `identificacion` es nullable en la tabla para no romper
instalaciones previas: la obligatoriedad la impone la Edge Function.

---

# Entornos

| | Produccion | Pruebas |
|---|---|---|
| Proyecto Supabase | `rshrbxqflzyqkmaywcwv` | `uimftupnexooyxkegyqy` |
| Trabajadores | Winston `2934`, David `9563` | `1111`, `2222` (ficticios) |
| Rama | `main` | `pruebas` |

`public/backend.js` elige el backend **por el dominio** donde se sirve la
pagina, no por la rama ni por un valor a cambiar a mano:

```
gravitas-mantenimiento.alberto-175.workers.dev  ->  PRODUCCION
cualquier otro origen (previews, localhost)     ->  PRUEBAS
```

**No lo cambies a una configuracion por rama.** Si la rama de pruebas apuntara a
pruebas editando un valor, al mergear a `main` esa configuracion viajaria a
produccion y el kiosko de la planta escribiria en la base equivocada sin que
nadie lo note. Con deteccion por dominio el mismo archivo es correcto de los dos
lados. El caso por defecto es pruebas a proposito.

Cuando corre contra pruebas, la pagina muestra una cinta amarilla fija. Un
kiosko de pruebas identico al de produccion es peligroso.

## Orden para promover cambios

1. Esquema y Edge Functions **primero** en produccion (`instalacion.sql` es
   idempotente; las funciones se despliegan aparte).
2. Recien despues, merge de la rama a `main`.

Al reves, el kiosko mostraria botones que llaman a algo que todavia no existe.

## Probar en local

```
python -m http.server 8090 --bind 127.0.0.1 --directory <repo>/public
# http://localhost:8090/index.html  -> apunta a PRUEBAS, con cinta amarilla
```

El puerto **8090** esta en la lista de origenes permitidos de las tres Edge
Functions. Si usas otro puerto, el CORS lo bloquea.

---

# Planificacion (24 sep 2026)

Cuarto boton del kiosko. **Solo muestra, no escribe nada.** Es el mismo mapa de
la planta, de solo lectura, pintado con un gradiente por antiguedad:

- Cada actividad recorre **dos colores**, del tono fuerte al claro:

  | Actividad | Recien trabajado | Borde de la ventana |
  |---|---|---|
  | Fumigacion | rojo fuerte `230,25,60` | rosado claro `255,196,214` |
  | Poda | verde oscuro `16,122,61` | verde claro `160,245,180` |
  | Lavado | azul oscuro `24,70,190` | celeste claro `160,230,255` |

- Se elige una actividad a la vez. Un mismo sector puede estar fumigado ayer y
  lavado hace ocho dias; mezclarlo todo en un color no diria nada.
- La ventana es de **15 dias corridos**. **Los fines de semana cuentan**: la
  maleza no deja de crecer los dias que no se trabaja.
- **La primera version usaba un solo color con transparencia y no servia:** sobre
  el fondo oscuro, bajarle opacidad a un color lo apaga sin cambiarle el tono, y
  un dia no se distinguia del siguiente. Recorrer dos colores mueve tono, brillo
  y saturacion a la vez, que es lo que el ojo si distingue. No vuelvas al
  gradiente por opacidad.
- La mezcla se hace en **luz lineal** (gama 2.2), no sobre los valores de sRGB.
  Mezclar sRGB directo amontona los pasos en el extremo oscuro y deja el resto
  indistinguible; con la correccion, los quince escalones se separan parejo.
- El extremo claro es mas **visible** que el fuerte sobre el fondo oscuro. Es
  asi a pedido del usuario y no es un error: lo que esta por vencerse salta a la
  vista, que es lo que se busca al planificar.
- La leyenda dibuja **un escalon por dia**, no cuatro muestras: se puede comparar
  una celda contra la rampa y sacar la antiguedad sin pasar el mouse.

Al lado, una columna angosta con los ultimos 15 dias y lo que se hizo cada uno.
Existe sobre todo por los dias en que el mapa **no** cambia —rondas antifuego,
inversores, subestacion—: sin esa columna pareceria que no se hizo nada.

## Edge Function `planificacion`

Tercera puerta publica del kiosko, `verify_jwt = false` como las otras.

```
GET /functions/v1/planificacion -> {
  ok, hoy, ventana,          // ventana = 15 dias
  ultimo: { fumigacion: { "C1-A1": "2026-09-22" }, poda: {...}, lavado: {...} },
  dias:   [ { fecha, actividades: [{ actividad, sectores }], especiales: [cat] } ]
}
```

**Solo lee.** Expone codigos de sector, fechas y cuentas. **No expone las
notas** —son texto libre, puede haber cualquier cosa ahi—, ni autores, ni ids,
ni las banderas de revision. Lo que salga de aca lo lee cualquiera en internet.

La logica esta en `resumen.ts`, aparte de `index.ts`, para poder probarla con
Node sin Deno ni red:

```
node supabase/functions/planificacion/resumen.prueba.mjs
```

`VENTANA_DIAS` esta en `resumen.ts` y **manda**: el kiosko la lee de la
respuesta y arma con ella el gradiente y la columna. Para cambiar cuantos dias
se miran, se toca ahi y se redespliega — el front no se toca.

Cubre: ventana de dias, ultima fecha por sector, actividades independientes
sobre el mismo sector, agregado de dos reportes del mismo dia, los bordes de la
ventana (dia 9 entra, dia 10 no), la zona horaria (03:00 UTC es el dia anterior
en Guatemala) y registros con nulos o actividades desconocidas.

**Son dos archivos al desplegar.** Si redesplegas solo `index.ts`, la funcion
queda sin `resumen.ts` y deja de responder.

## Detalles del kiosko

- El mapa se dibuja con `construirMapa(contenedor, alTocar)`. Sin `alTocar`
  queda de solo lectura: es el del modulo de planificacion.
- Por eso `refrescarMapa()` consulta `#mapa .celda` y no `.celda` a secas —
  si no, seleccionar sectores pintaria tambien el mapa de planificacion.
- No uses la clase `especial` para nada nuevo: ya tiene caja y padding del
  bloque de actividades especiales. En la columna de dias es `plan-especial`.
- Si falla la peticion **no se borra lo que ya se mostraba**, igual que el
  indicador de quien esta en planta. Un mapa de hace un rato sirve para
  planificar; uno vacio no dice nada.
