// El mapa de la planta, del lado del servidor.
//
// **Esta es la copia que MANDA.** El navegador dibuja el mapa desde
// `public/mapa.js`, pero que un codigo sea valido se decide aca: el endpoint es
// publico y cualquiera puede mandarle lo que quiera. Si cambia la planta hay
// que cambiar las dos copias y redesplegar la funcion.
//
// Vive aparte de index.ts —sin imports de Deno, sin red— para poder probarlo
// con Node: `node supabase/functions/registrar/mapa.prueba.mjs`.

export const ACTIVIDADES = ["fumigacion", "poda", "lavado"];

// Las areas no son paneles: no se lavan. Solo se fumigan o se podan.
export const ACTIVIDADES_AREAS = ["fumigacion", "poda"];

export const CATEGORIAS = ["inversores", "rondas_antifuego", "subestacion", "otros"];

// Los cuadrantes de paneles. Estos codigos no se tocan: hay registros
// historicos escritos con ellos.
const CUADRANTES: Record<string, { columnas: number; filas: number }> = {
  C1: { columnas: 4, filas: 18 },   // superior izquierdo,  A–R
  C2: { columnas: 4, filas: 18 },   // inferior izquierdo,  A–R
  C3: { columnas: 2, filas: 12 },   // superior derecho,    A–L
  C4: { columnas: 2, filas: 12 },   // inferior derecho,    A–L
};

// Todo lo que no es panel: rondas antifuego perimetrales, drenajes pluviales,
// la subestacion y la calle principal que cruza la planta.
export const AREAS = [
  "1N", "1S", "1E", "1O",          // rondas del cuadrante 1
  "2N", "2S", "2O",                // rondas del cuadrante 2
  "2E",                            // ronda 2E, que es tambien el drenaje DR3
  "3N", "3S", "3E",                // rondas del cuadrante 3
  "4S", "4E",                      // rondas del cuadrante 4
  "DR1", "DR2",                    // drenajes pluviales entre 1-2 y entre 3-4
  "4N",                            // subestacion y bodega
  "CALLE",                         // calle principal
];

function construirSectores(): Set<string> {
  const validos = new Set<string>();
  for (const [cuadrante, { columnas, filas }] of Object.entries(CUADRANTES)) {
    for (let f = 0; f < filas; f++) {
      const letra = String.fromCharCode(65 + f);
      for (let c = 1; c <= columnas; c++) validos.add(`${cuadrante}-${letra}${c}`);
    }
  }
  return validos;
}

export const SECTORES_VALIDOS = construirSectores();
export const AREAS_VALIDAS = new Set(AREAS);

export function esArea(id: string): boolean {
  return AREAS_VALIDAS.has(id);
}

/**
 * Deja solo los codigos que existen en el mapa, sin repetidos y respetando el
 * tope. Lo que no reconoce lo descarta en silencio: es un endpoint publico y no
 * tiene sentido explicarle a un desconocido que codigos existen.
 */
export function filtrarSeleccion(crudos: unknown, tope: number): string[] {
  if (!Array.isArray(crudos)) return [];
  const vistos = new Set<string>();
  for (const bruto of crudos.slice(0, tope)) {
    if (typeof bruto !== "string") continue;
    const id = bruto.trim().slice(0, 12);
    if (SECTORES_VALIDOS.has(id) || AREAS_VALIDAS.has(id)) vistos.add(id);
  }
  return [...vistos];
}

/**
 * Comprueba que la actividad se pueda hacer sobre lo seleccionado.
 * Devuelve el mensaje de error, o null si esta todo bien.
 */
export function validarActividad(seleccion: string[], actividad: string): string | null {
  if (!ACTIVIDADES.includes(actividad)) return "Elegí la actividad realizada";

  if (!ACTIVIDADES_AREAS.includes(actividad) && seleccion.some(esArea)) {
    return "Las rondas antifuego, los drenajes y la calle no se lavan: solo se fumigan o se podan";
  }
  return null;
}
