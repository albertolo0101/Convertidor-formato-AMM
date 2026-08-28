// Gravitas Mantenimiento — Edge Function `estado`
//
// Devuelve quien esta actualmente dentro de la planta, para que el kiosko lo
// muestre. Es la segunda —y ultima— puerta publica del kiosko.
//
// El kiosko no puede leer ninguna tabla: 'anon' esta bloqueado por diseño. Esta
// funcion corre con service_role y expone deliberadamente lo MINIMO: nombre y
// hora de entrada. Nunca devuelve codigos, ni ids, ni el historial. Si algun dia
// hace falta mas informacion aca, pensalo dos veces: lo que salga por este
// endpoint lo puede leer cualquiera en internet.
//
// GET  -> 200 { ok: true, dentro: [{ nombre, desde }] }

import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/Guatemala";

const ORIGENES_PERMITIDOS = [
  "https://gravitas-mantenimiento.alberto-175.workers.dev",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
];
const SUFIJO_VISTAS_PREVIAS = ".alberto-175.workers.dev";

function cabecerasCors(origen: string | null): Record<string, string> {
  const cabeceras: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
  const permitido = origen !== null && (
    ORIGENES_PERMITIDOS.includes(origen) ||
    (origen.startsWith("https://") && origen.endsWith(SUFIJO_VISTAS_PREVIAS))
  );
  if (permitido) cabeceras["Access-Control-Allow-Origin"] = origen;
  return cabeceras;
}

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

Deno.serve(async (req: Request) => {
  const cors = cabecerasCors(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: trabajadores } = await db
    .from("trabajadores")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");

  if (!trabajadores?.length) return json({ ok: true, dentro: [] });

  // Dos dias alcanzan para encontrar la ultima marca de cada uno sin traer
  // todo el historial.
  const desde = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data: marcas } = await db
    .from("asistencia")
    .select("trabajador_id, accion, marcado_en")
    .gte("marcado_en", desde)
    .order("marcado_en", { ascending: false });

  const ultimaPorTrabajador: Record<string, { accion: string; marcado_en: string }> = {};
  for (const m of marcas ?? []) {
    if (!(m.trabajador_id in ultimaPorTrabajador)) ultimaPorTrabajador[m.trabajador_id] = m;
  }

  const hoy = fechaGT(new Date());

  // Se considera "dentro" solo si la ultima marca es una entrada DE HOY. Una
  // entrada de ayer sin salida es un olvido, no alguien que sigue en la planta.
  const dentro = trabajadores
    .filter((t: { id: string }) => {
      const u = ultimaPorTrabajador[t.id];
      return u && u.accion === "entrada" && fechaGT(new Date(u.marcado_en)) === hoy;
    })
    .map((t: { id: string; nombre: string }) => ({
      nombre: t.nombre,
      desde: horaGT(new Date(ultimaPorTrabajador[t.id].marcado_en)),
    }));

  return json({ ok: true, dentro });
});
