// Gravitas Mantenimiento — Edge Function `planificacion`
//
// Devuelve el historial de los ultimos 15 dias de trabajo sobre los sectores,
// para que el kiosko pinte el mapa con un gradiente por antiguedad y los
// operarios y el coordinador puedan planificar los dias siguientes.
//
// Es la TERCERA puerta publica del kiosko. Como 'estado', corre con
// service_role porque 'anon' no puede leer ninguna tabla, y expone
// deliberadamente lo MINIMO que el mapa necesita:
//
//   - codigos de sector y la fecha en que se trabajo cada uno, por actividad
//   - por dia, que actividades hubo y cuantos sectores
//
// NO devuelve notas (son texto libre, puede haber cualquier cosa ahi), ni
// nombres, ni ids, ni banderas de revision. Si algun dia hace falta agregarle
// campos, pensalo dos veces: lo que salga de aca lo lee cualquiera en internet.
//
// Solo lee. No escribe nada.
//
// GET -> 200 {
//   ok: true,
//   hoy: "2026-09-24",
//   ventana: 15,
//   ultimo: { fumigacion: { "C1-A1": "2026-09-22" }, poda: {...}, lavado: {...} },
//   dias: [ { fecha, actividades: [{ actividad, sectores }], especiales: [cat] } ]
// }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { resumir, VENTANA_DIAS, type Registro } from "./resumen.ts";

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

  // Un dia de margen sobre la ventana: el corte se hace despues por fecha de
  // Guatemala, y un filtro en UTC justo de la ventana podria dejar afuera
  // trabajo de la madrugada del dia mas antiguo.
  const desde = new Date(Date.now() - (VENTANA_DIAS + 1) * 86400_000).toISOString();

  const { data: registros, error } = await db
    .from("registros_actividad")
    .select("creado_en, tipo, actividad, sectores, categorias")
    .gte("creado_en", desde)
    .order("creado_en", { ascending: false });

  if (error) return json({ ok: false, error: "No se pudo leer el historial" }, 500);

  return json({ ok: true, ...resumir((registros ?? []) as Registro[], new Date()) });
});
