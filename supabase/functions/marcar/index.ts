// Gravitas Command Center — Edge Function `marcar`
//
// UNICA puerta de entrada del kiosko de asistencia. Corre con service_role.
// El kiosko NO tiene login: la autenticacion es el codigo de 4 digitos que
// identifica al trabajador + la foto, que es la prueba real de quien marco.
//
// Por eso esta funcion se despliega con verify_jwt = false y implementa su
// propia autenticacion y su propio limite de intentos.
//
// POST { codigo, foto_base64?, marcado_en? }
//   marcado_en: ISO opcional. Lo manda la cola offline del kiosko con el
//   momento REAL de la marca; sin el, se usa la hora del servidor.
//  -> 200 { ok: true, nombre, accion, hora, con_foto, repetida }
//  -> 400 { ok: false, error }   codigo mal formado
//  -> 401 { ok: false, error }   codigo invalido (mensaje generico a proposito)
//  -> 429 { ok: false, error }   demasiados intentos fallidos desde esta IP

import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/Guatemala";
const RETENCION_FOTOS_DIAS = 10;
const MAX_INTENTOS = 10;             // por IP
const VENTANA_INTENTOS_MIN = 10;
const MAX_FOTO_BYTES = 2 * 1024 * 1024;

// Periodo de gracia contra la doble marca accidental. Sin esto, un trabajador
// que toca la pantalla dos veces registra su ENTRADA y, segundos despues, una
// SALIDA — y la jornada queda corrupta sin que nadie se de cuenta.
const GRACIA_SEG = 90;

// Tope de antiguedad para una marca diferida por la cola offline. Mas alla de
// esto se rechaza: el endpoint es publico y no puede aceptar historia arbitraria.
const MAX_ATRASO_DIAS = 7;

// El CORS NO protege este endpoint: solo impide que un navegador en otro
// dominio lea la respuesta. Con curl se saltea por completo. Las defensas
// reales son el codigo de 4 digitos, el freno de intentos y la foto.
// Aun asi se restringe, para que nadie monte un kiosko falso en su propio
// dominio y marque desde el navegador de un tercero.
const ORIGENES_PERMITIDOS = [
  "https://gravitas-mantenimiento.alberto-175.workers.dev",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
];

// Cloudflare da una URL propia a cada version desplegada, bajo el subdominio de
// la cuenta. Se aceptan para poder probar un cambio antes de que llegue al
// kiosko de la planta.
const SUFIJO_VISTAS_PREVIAS = ".alberto-175.workers.dev";

function cabecerasCors(origen: string | null): Record<string, string> {
  const cabeceras: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const permitido = origen !== null && (
    ORIGENES_PERMITIDOS.includes(origen) ||
    (origen.startsWith("https://") && origen.endsWith(SUFIJO_VISTAS_PREVIAS))
  );
  if (permitido) cabeceras["Access-Control-Allow-Origin"] = origen;
  return cabeceras;
}

/** Fecha YYYY-MM-DD en hora de Guatemala, no en UTC. */
function fechaGT(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function horaGT(d: Date): string {
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function decodificarFoto(dataUrl: string): Uint8Array | null {
  const b64 = dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
  try {
    const bin = atob(b64);
    if (bin.length > MAX_FOTO_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Borra de Storage las fotos de mas de RETENCION_FOTOS_DIAS y marca las filas.
 * Los REGISTROS de asistencia se conservan indefinidamente (dato de nomina);
 * solo se purgan las imagenes. Corre en cada marca: sin cron que se rompa en
 * silencio. Nunca hace fallar la marca del trabajador.
 */
async function purgarFotosViejas(db: ReturnType<typeof createClient>) {
  const limite = new Date(Date.now() - RETENCION_FOTOS_DIAS * 86400_000).toISOString();
  const { data: viejas } = await db
    .from("asistencia")
    .select("id, foto_path")
    .lt("marcado_en", limite)
    .eq("foto_purgada", false)
    .not("foto_path", "is", null)
    .limit(200);

  if (!viejas?.length) return;

  const paths = viejas.map((f: { foto_path: string }) => f.foto_path);
  await db.storage.from("fotos").remove(paths);
  await db
    .from("asistencia")
    .update({ foto_path: null, foto_purgada: true })
    .in("id", viejas.map((f: { id: string }) => f.id));
}

Deno.serve(async (req: Request) => {
  const cors = cabecerasCors(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Metodo no permitido" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconocida";

  let body: { codigo?: string; foto_base64?: string | null; marcado_en?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Peticion invalida" }, 400);
  }

  const codigo = String(body.codigo ?? "").trim();
  if (!/^[0-9]{4}$/.test(codigo)) {
    return json({ ok: false, error: "El codigo debe ser de 4 digitos" }, 400);
  }

  // Freno de fuerza bruta: 4 digitos son solo 10 000 combinaciones.
  const desde = new Date(Date.now() - VENTANA_INTENTOS_MIN * 60_000).toISOString();
  const { count: fallidos } = await db
    .from("intentos_fallidos")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("intentado_en", desde);

  if ((fallidos ?? 0) >= MAX_INTENTOS) {
    return json(
      { ok: false, error: "Demasiados intentos. Espera unos minutos o avisa al administrador." },
      429,
    );
  }

  const { data: trabajador } = await db
    .from("trabajadores")
    .select("id, nombre")
    .eq("codigo", codigo)
    .eq("activo", true)
    .maybeSingle();

  if (!trabajador) {
    await db.from("intentos_fallidos").insert({ ip, codigo_intentado: codigo });
    // Mensaje generico: no revelamos si el codigo existe pero esta inactivo.
    return json({ ok: false, error: "Codigo no reconocido" }, 401);
  }

  // El kiosko guarda las marcas en una cola cuando no hay internet y las manda
  // despues. En ese caso viaja el momento REAL de la marca, no el del envio:
  // registrar la hora del envio falsearia la jornada.
  const ahora = new Date();
  let momento = ahora;
  let diferida = false;

  if (typeof body.marcado_en === "string") {
    const propuesto = new Date(body.marcado_en);
    if (isNaN(propuesto.getTime())) {
      return json({ ok: false, error: "Fecha de marca invalida" }, 400);
    }
    // Margen hacia adelante por desfase de reloj del kiosko; hacia atras, un
    // tope para que nadie inyecte marcas antiguas por este endpoint publico.
    const adelanto = (propuesto.getTime() - ahora.getTime()) / 1000;
    const atraso = (ahora.getTime() - propuesto.getTime()) / 1000;
    if (adelanto > 300) {
      return json({ ok: false, error: "La marca viene con fecha futura" }, 400);
    }
    if (atraso > MAX_ATRASO_DIAS * 86400) {
      return json({ ok: false, error: "La marca es demasiado antigua" }, 400);
    }
    momento = propuesto;
    diferida = atraso > 120;
  }

  // Se compara contra la ultima marca ANTERIOR a este momento, no contra la
  // ultima en general: asi una marca diferida se resuelve bien aunque llegue
  // despues de otras mas nuevas.
  const { data: ultima } = await db
    .from("asistencia")
    .select("accion, marcado_en, foto_path")
    .eq("trabajador_id", trabajador.id)
    .lt("marcado_en", momento.toISOString())
    .order("marcado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Doble marca accidental: dentro del periodo de gracia no se crea un registro
  // nuevo, se devuelve el que ya existe para que el kiosko lo muestre otra vez.
  if (ultima) {
    const segundos = (momento.getTime() - new Date(ultima.marcado_en).getTime()) / 1000;
    if (segundos < GRACIA_SEG) {
      await db.from("intentos_fallidos").delete().eq("ip", ip);
      return json({
        ok: true,
        nombre: trabajador.nombre,
        accion: ultima.accion,
        hora: horaGT(new Date(ultima.marcado_en)),
        con_foto: ultima.foto_path !== null,
        repetida: true,
        diferida,
      });
    }
  }

  // Entrada o salida se deduce de la ultima marca. Si la ultima fue 'entrada'
  // pero de un dia anterior (se olvidaron de marcar salida), hoy vuelve a
  // contar como 'entrada' en vez de encadenar una salida sin sentido.
  const ultimaFueHoy = ultima ? fechaGT(new Date(ultima.marcado_en)) === fechaGT(momento) : false;
  const accion = ultima?.accion === "entrada" && ultimaFueHoy ? "salida" : "entrada";

  const registroId = crypto.randomUUID();
  let fotoPath: string | null = null;

  if (body.foto_base64) {
    const bytes = decodificarFoto(body.foto_base64);
    if (bytes) {
      const ruta = `${fechaGT(momento)}/${registroId}.jpg`;
      const { error } = await db.storage
        .from("fotos")
        .upload(ruta, bytes, { contentType: "image/jpeg", upsert: false });
      // Si la subida falla, la marca se registra igual sin foto: nunca
      // bloqueamos al trabajador por un problema de almacenamiento.
      if (!error) fotoPath = ruta;
    }
  }

  const { error: errorInsert } = await db.from("asistencia").insert({
    id: registroId,
    trabajador_id: trabajador.id,
    accion,
    marcado_en: momento.toISOString(),
    foto_path: fotoPath,
  });

  if (errorInsert) {
    if (fotoPath) await db.storage.from("fotos").remove([fotoPath]);
    return json({ ok: false, error: "No se pudo registrar la marca" }, 500);
  }

  // Toda la planta comparte una sola IP: si un trabajador se equivoca varias
  // veces no puede dejar bloqueado al otro. Una marca correcta limpia el
  // contador. Un atacante real solo envia codigos invalidos, asi que para el
  // freno sigue vigente.
  await db.from("intentos_fallidos").delete().eq("ip", ip);

  try {
    await purgarFotosViejas(db);
  } catch {
    // La purga nunca debe hacer fallar una marca ya guardada.
  }

  return json({
    ok: true,
    nombre: trabajador.nombre,
    accion,
    hora: horaGT(momento),
    con_foto: fotoPath !== null,
    repetida: false,
    diferida,
  });
});
