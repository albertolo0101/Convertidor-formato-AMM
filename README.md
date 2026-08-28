# Gravitas · Mantenimiento

Herramienta interna del **departamento de mantenimiento** de Gravitas, Planta
Solar 5 MW, Guatemala.

Corre en la nube. Los trabajadores la usan desde la computadora de la planta sin
iniciar sesión; el administrador entra con Google desde cualquier lado.

```
Kiosko   https://gravitas-mantenimiento.alberto-175.workers.dev
Panel    https://gravitas-mantenimiento.alberto-175.workers.dev/admin
AMM      https://gravitas-mantenimiento.alberto-175.workers.dev/amm
```

---

## Qué hace

### Asistencia

El trabajador ingresa su código de 4 dígitos, la cámara hace una cuenta
regresiva de 3 y saca una foto. El sistema deduce si es entrada o salida según
su última marca y lo muestra en grande.

- **La foto es la verificación real.** El código identifica; la foto prueba.
- Si no hay cámara o se niega el permiso, **la marca se registra igual** y lo
  dice en pantalla. Nunca se le bloquea el turno a alguien por un problema
  técnico.
- Un doble toque accidental **no** genera una salida a los cinco segundos de la
  entrada: dentro de 90 segundos se devuelve la marca que ya existía.
- Si alguien olvida marcar salida, la primera marca del día siguiente vuelve a
  contar como entrada.
- Arriba se ve **quién está en planta**, con un punto verde.

### Solicitud de insumos

Lista de insumos con cantidad y notas. El administrador las ve y las marca como
atendidas.

### Registro de actividad

Mapa de la planta con **192 sectores** en cuatro bloques:

| Cuadrante | Posición | Columnas | Filas |
|---|---|---|---|
| C1 | superior izquierdo | 1–4 | A–R (18) |
| C2 | inferior izquierdo | 1–4 | A–R (18) |
| C3 | superior derecho | 1–2 | A–L (12) |
| C4 | inferior derecho | 1–2 | A–L (12) |

Se seleccionan los sectores trabajados y se elige **fumigación, poda o lavado**.
Tocar una letra selecciona la fila entera; tocar un número, la columna.

Si no se selecciona ningún sector, se habilitan las otras actividades
—**inversores, rondas antifuego, subestación, otros**—, que exigen notas
obligatorias y **levantan una bandera** que solo el administrador puede bajar.

### Visitas

Registro de llegada: nombre e identificación obligatorios, empresa y motivo
opcionales.

### Convertidor AMM

Convierte la medición mensual de Gravitas al formato de carga del AMM y calcula
ingresos POE. Funciona **enteramente en el navegador**: no envía nada a ningún
servidor.

---

## Sin internet

La planta puede quedarse sin conexión. Cuando pasa, **las marcas y los reportes
no se pierden**: quedan guardados en el navegador y se envían solos cuando
vuelve la señal. Un aviso amarillo indica cuántos hay pendientes.

Se guarda el **momento real** de la marca, no el del reenvío, así que la jornada
queda correcta aunque el envío ocurra horas después.

---

## Privacidad de las fotos

- Se guardan en un depósito **privado**: nadie puede verlas sin ser
  administrador autenticado, ni siquiera conociendo la dirección exacta.
- **Se borran automáticamente a los 10 días.**
- Los **registros** de asistencia se conservan indefinidamente: son el dato de
  nómina y pesan kilobytes. Solo se purgan las imágenes.

Informá esto a los trabajadores antes de usar el módulo.

---

## Cómo está armado

```
Navegador (HTML estático)  →  Edge Functions  →  Postgres + Storage
       │                       (service_role)
       └── /admin → Google → RLS por correo
```

| Pieza | Servicio |
|---|---|
| Páginas | Cloudflare Workers (estático) |
| Datos | Supabase Postgres |
| Fotos | Supabase Storage, depósito privado |
| Identidad | Supabase Auth con Google, **solo administradores** |

No hay servidor propio que mantener. Google se usa **únicamente** como
proveedor de identidad: nada de Sheets ni de Drive.

### El modelo de seguridad

La clave publicable viaja en el HTML —es pública por diseño—, así que:

- **Ninguna tabla es accesible con esa clave.** Ni lectura ni escritura.
- La única forma de escribir es a través de las Edge Functions, que corren con
  credenciales de servidor y validan todo: el código contra la tabla de
  trabajadores, los sectores contra el mapa real, los topes de tamaño.
- El administrador ve los datos porque su sesión de Google se compara contra una
  lista de correos autorizados **dentro de la base**, no en el navegador.

Hay un freno de intentos por IP contra la adivinación de códigos. Una marca
correcta lo limpia, para que un trabajador que se equivoca no deje bloqueado al
otro —la planta comparte una sola IP.

---

## Estructura

```
public/              lo único que se publica
├── index.html       kiosko
├── admin.html       panel de administrador
├── amm.html         convertidor AMM
├── backend.js       elige el backend según el dominio
├── logo.png
└── _headers         cabeceras de seguridad

supabase/
├── instalacion.sql  reconstruye el backend entero en un proyecto vacío
└── functions/
    ├── marcar/      asistencia
    ├── estado/      quién está en planta
    └── registrar/   insumos, actividad y visitas

wrangler.jsonc       configuración del despliegue
CLAUDE.md            contexto técnico y decisiones de diseño
```

**Nunca publiques la raíz del repositorio**, solo `public/`. Fuera de esa
carpeta hay archivos que no deben quedar expuestos.

---

## Desarrollo

### Entornos

Hay dos proyectos de Supabase: producción y pruebas. **La página elige a cuál
hablarle según el dominio desde el que se sirve**, no según la rama:

```
gravitas-mantenimiento.alberto-175.workers.dev  →  producción
cualquier otro origen (vistas previas, localhost) →  pruebas
```

Es deliberado. Si la rama de pruebas apuntara a pruebas cambiando un valor en un
archivo, al hacer merge esa configuración viajaría a producción y el kiosko
escribiría en la base equivocada sin que nadie lo note. Con detección por
dominio, el mismo archivo es correcto de los dos lados.

Cuando la página corre contra pruebas muestra una **cinta amarilla** fija.

### Probar en local

```bash
python -m http.server 8090 --bind 127.0.0.1 --directory public
# http://localhost:8090/index.html
```

Apunta a la base de pruebas. El puerto **8090** está en la lista de orígenes
permitidos de las Edge Functions; con otro puerto, el CORS lo bloquea.

`localhost` cuenta como contexto seguro, así que la cámara funciona sin desplegar.

### Desplegar

Cada `push` a `main` redespliega el sitio. **El orden importa:**

1. Esquema y Edge Functions primero, en producción.
2. Recién después, la interfaz.

Al revés, el kiosko mostraría botones que llaman a algo que todavía no existe.

`supabase/instalacion.sql` es idempotente: se puede pegar entero en el editor
SQL de Supabase para instalar desde cero o para agregar lo que falte.

> Los códigos de los trabajadores y los correos de administrador **no están en
> este repositorio**: es público. `instalacion.sql` trae valores de ejemplo que
> hay que reemplazar al ejecutarlo.

---

## Limitaciones conocidas

- **Un turno que cruce la medianoche** se parte en dos jornadas incompletas en
  el panel. Hoy no aplica porque el turno es diurno.
- El mapa de la planta está definido **en dos lugares**: en el kiosko para
  dibujarlo y en la Edge Function para validarlo. Manda el de la función. Si
  cambia la planta, hay que cambiar los dos.
- Las marcas encoladas sin conexión se descartan pasados **7 días**.
