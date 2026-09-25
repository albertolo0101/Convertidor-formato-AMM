// Logica pura del resumen de planificacion.
//
// Vive aparte de index.ts —sin imports de Deno, sin red, sin base— para poder
// probarla con Node: `node supabase/functions/planificacion/resumen.prueba.mjs`.
// El emparejado de fechas es la parte que se puede equivocar en silencio, y un
// mapa mal pintado haria planificar sobre datos falsos.

export const TZ = "America/Guatemala";

// Quince dias CORRIDOS, fines de semana incluidos: la maleza no deja de crecer
// los dias que no se trabaja, asi que la antiguedad se cuenta en dias de
// calendario y no en dias laborales.
//
// Este numero manda: el kiosko lo lee de la respuesta y arma el gradiente y la
// columna de dias con el. No hace falta tocar el front para cambiarlo.
export const VENTANA_DIAS = 15;

export const ACTIVIDADES = ["fumigacion", "poda", "lavado"];

export type Registro = {
  creado_en: string;
  tipo: string;
  actividad?: string | null;
  sectores?: string[] | null;
  categorias?: string[] | null;
};

export type Resumen = {
  hoy: string;
  ventana: number;
  ultimo: Record<string, Record<string, string>>;
  dias: {
    fecha: string;
    actividades: { actividad: string; sectores: number }[];
    especiales: string[];
  }[];
};

/** Fecha de Guatemala de un instante, como 'YYYY-MM-DD'. */
export function fechaGT(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/**
 * Arma el resumen de la ventana a partir de los registros de actividad, que
 * deben venir ordenados del mas reciente al mas antiguo.
 *
 * Devuelve, por actividad, la ultima fecha en que se trabajo cada sector, y por
 * dia lo que se hizo. Nada mas: ni notas, ni autores, ni banderas.
 */
export function resumir(registros: Registro[], ahora: Date): Resumen {
  // Los dias de la ventana, del mas reciente al mas antiguo. Guatemala no tiene
  // horario de verano, asi que restar 24 h por dia es exacto.
  const dias: string[] = [];
  for (let i = 0; i < VENTANA_DIAS; i++) {
    dias.push(fechaGT(new Date(ahora.getTime() - i * 86400_000)));
  }

  const ultimo: Record<string, Record<string, string>> = {
    fumigacion: {}, poda: {}, lavado: {},
  };

  // Por dia: sectores unicos por actividad y union de las categorias
  // especiales. Se agrega para que dos reportes de la misma actividad el mismo
  // dia no se vean como dos lineas ni cuenten un sector dos veces.
  const porDia: Record<string, {
    sectores: Record<string, Set<string>>;
    especiales: Set<string>;
  }> = {};
  for (const f of dias) {
    porDia[f] = {
      sectores: { fumigacion: new Set(), poda: new Set(), lavado: new Set() },
      especiales: new Set(),
    };
  }

  for (const r of registros) {
    const fecha = fechaGT(new Date(r.creado_en));
    const dia = porDia[fecha];
    if (!dia) continue; // fuera de la ventana: entro por el dia de margen

    if (r.tipo === "sectores" && r.actividad && ACTIVIDADES.includes(r.actividad)) {
      for (const s of r.sectores ?? []) {
        dia.sectores[r.actividad].add(s);
        // Los registros llegan del mas reciente al mas antiguo: la primera vez
        // que aparece un sector es la ultima vez que se le hizo esa actividad.
        if (!(s in ultimo[r.actividad])) ultimo[r.actividad][s] = fecha;
      }
    } else if (r.tipo === "especial") {
      for (const c of r.categorias ?? []) dia.especiales.add(c);
    }
  }

  return {
    hoy: dias[0],
    ventana: VENTANA_DIAS,
    ultimo,
    dias: dias.map((fecha) => ({
      fecha,
      actividades: ACTIVIDADES
        .filter((a) => porDia[fecha].sectores[a].size > 0)
        .map((a) => ({ actividad: a, sectores: porDia[fecha].sectores[a].size })),
      especiales: [...porDia[fecha].especiales],
    })),
  };
}
