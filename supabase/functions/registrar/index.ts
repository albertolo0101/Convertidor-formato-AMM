// Gravitas Mantenimiento — Edge Function `registrar`
//
// Puerta de escritura del kiosko para los modulos que NO son asistencia:
// solicitudes de insumos, registro de actividad y visitas.
//
// Una sola funcion para los tres porque comparten CORS, validacion y forma de
// respuesta; separarlas seria triplicar el mismo andamiaje.
//
// El kiosko guarda estos registros de forma ANONIMA por decision del usuario:
// no pide el codigo de 4 digitos. Por eso este endpoint no autentica a nadie —
// solo valida que lo que llega tenga sentido. Todo lo que se acepte aca lo
// puede enviar cualquiera en internet, asi que la validacion es la unica
// defensa: se rechaza lo malformado y se recorta lo excesivo.
//
// POST { tipo: "insumos" | "actividad" | "visita", ... }
//  -> 200 { ok: true, id }
//  -> 400 { ok: false, error }

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENES_PERMITIDOS = [
  "https://gravitas-mantenimiento.alberto-175.workers.dev",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
];
const SUFIJO_VISTAS_PREVIAS = ".alberto-175.workers.dev";

// Topes para que nadie llene la base desde afuera con un POST gigante
const MAX_ITEMS = 40;
const MAX_TEXTO = 500;
const MAX_NOTAS = 2000;
const MAX_SECTORES = 200;

const ACTIVIDADES = ["fumigacion", "poda", "lavado"];
const CATEGORIAS = ["inversores", "rondas_antifuego", "subestacion", "otros"];

// El mapa de la planta. Debe coincidir con el que dibuja el kiosko: aca es
// donde se decide que codigo de sector es valido, no en el navegador.
const CUADRANTES: Record<string, { columnas: number; filas: number }> = {
  C1: { columnas: 4, filas: 18 },   // superior izquierdo,  A–R
  C2: { columnas: 4, filas: 18 },   // inferior izquierdo,  A–R
  C3: { columnas: 2, filas: 12 },   // superior derecho,    A–L
  C4: { columnas: 2, filas: 12 },   // inferior derecho,    A–L
};

function sectoresValidos(): Set<string> {
  const validos = new Set<string>();
  for (const [cuadrante, { columnas, filas }] of Object.entries(CUADRANTES)) {
    for (let f = 0; f < filas; f++) {
      const letra = String.fromCharCode(65 + f);
      for (let c = 1; c <= columnas; c++) validos.add(`${cuadrante}-${letra}${c}`);
    }
  }
  return validos;
}

const SECTORES_VALIDOS = sectoresValidos();

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

function texto(v: unknown, max = MAX_TEXTO): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Peticion invalida" }, 400);
  }

  const tipo = texto(body.tipo, 20);

  // ---------------------------------------------------------------- insumos
  if (tipo === "insumos") {
    const crudos = Array.isArray(body.items) ? body.items : [];
    const items = crudos
      .slice(0, MAX_ITEMS)
      .map((it: Record<string, unknown>) => ({
        descripcion: texto(it?.descripcion),
        cantidad: texto(it?.cantidad, 60),
      }))
      .filter((it) => it.descripcion !== "");

    if (!items.length) {
      return json({ ok: false, error: "Agregá al menos un insumo" }, 400);
    }

    const { data, error } = await db
      .from("solicitudes_insumos")
      .insert({ items, notas: texto(body.notas, MAX_NOTAS) || null })
      .select("id")
      .single();

    if (error) return json({ ok: false, error: "No se pudo guardar la solicitud" }, 500);
    return json({ ok: true, id: data.id, cantidad: items.length });
  }

  // -------------------------------------------------------------- actividad
  if (tipo === "actividad") {
    const sectores = (Array.isArray(body.sectores) ? body.sectores : [])
      .slice(0, MAX_SECTORES)
      .map((s: unknown) => texto(s, 12))
      .filter((s: string) => SECTORES_VALIDOS.has(s));

    const categorias = (Array.isArray(body.categorias) ? body.categorias : [])
      .map((c: unknown) => texto(c, 30))
      .filter((c: string) => CATEGORIAS.includes(c));

    const notas = texto(body.notas, MAX_NOTAS);

    // Trabajo sobre paneles
    if (sectores.length) {
      const actividad = texto(body.actividad, 30);
      if (!ACTIVIDADES.includes(actividad)) {
        return json({ ok: false, error: "Elegí la actividad realizada" }, 400);
      }

      const { data, error } = await db
        .from("registros_actividad")
        .insert({
          tipo: "sectores",
          actividad,
          sectores,
          notas: notas || null,
          requiere_revision: false,
        })
        .select("id")
        .single();

      if (error) return json({ ok: false, error: "No se pudo guardar el reporte" }, 500);
      return json({ ok: true, id: data.id, sectores: sectores.length, bandera: false });
    }

    // Actividad especial: sin sectores. Exige categoria Y notas, y levanta la
    // bandera que solo el administrador puede bajar.
    if (!categorias.length) {
      return json({ ok: false, error: "Seleccioná sectores en el mapa o marcá una actividad" }, 400);
    }
    if (!notas) {
      return json({ ok: false, error: "Las notas son obligatorias en estas actividades" }, 400);
    }

    const { data, error } = await db
      .from("registros_actividad")
      .insert({
        tipo: "especial",
        categorias,
        notas,
        requiere_revision: true,
      })
      .select("id")
      .single();

    if (error) return json({ ok: false, error: "No se pudo guardar el reporte" }, 500);
    return json({ ok: true, id: data.id, bandera: true });
  }

  // ---------------------------------------------------------------- visitas
  if (tipo === "visita") {
    const nombre = texto(body.nombre, 120);
    if (!nombre) return json({ ok: false, error: "El nombre del visitante es obligatorio" }, 400);

    // El documento es el punto del registro de visitas: sin el, la bitacora no
    // sirve para saber quien estuvo en la planta.
    const identificacion = texto(body.identificacion, 60);
    if (!identificacion) {
      return json({ ok: false, error: "La identificacion del visitante es obligatoria" }, 400);
    }

    const { data, error } = await db
      .from("visitas")
      .insert({
        nombre,
        identificacion,
        empresa: texto(body.empresa, 120) || null,
        motivo: texto(body.motivo, MAX_NOTAS) || null,
      })
      .select("id")
      .single();

    if (error) return json({ ok: false, error: "No se pudo registrar la visita" }, 500);
    return json({ ok: true, id: data.id });
  }

  return json({ ok: false, error: "Tipo de registro desconocido" }, 400);
});
