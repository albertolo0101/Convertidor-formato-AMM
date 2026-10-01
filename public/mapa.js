/**
 * Gravitas Mantenimiento — el mapa de la planta.
 *
 * Lo comparten tres pantallas: el registro de actividad y la planificacion del
 * kiosko, y la pestaña de actividad del panel de administracion. Antes vivia
 * suelto dentro de index.html; con tres lugares que lo dibujan, una sola
 * definicion es la unica forma de que no se desincronicen.
 *
 * **La copia que MANDA sigue siendo la de la Edge Function `registrar`.** Ahi
 * se decide que codigo es valido; aca solo se dibuja. Si cambia la planta hay
 * que cambiar las dos y redesplegar la funcion.
 *
 * El mapa tiene dos clases de pieza:
 *
 *   - **Paneles**: 192 sectores en cuatro cuadrantes, `C1-A1` … `C4-L2`.
 *   - **Areas**: las rondas antifuego perimetrales, los drenajes pluviales, la
 *     subestacion y la calle principal. No son paneles: **no se lavan**, solo
 *     se fumigan o se podan.
 */
(function () {

  /* ------------------------------------------------------------------ datos */

  // Los cuadrantes de paneles. Estos codigos NO se tocan: hay registros
  // historicos escritos con ellos.
  const CUADRANTES = [
    { id: 'C1', nombre: 'Cuadrante 1', columnas: 4, filas: 18,
      norte: '1N', sur: '1S', este: '1E', oeste: '1O' },
    { id: 'C2', nombre: 'Cuadrante 2', columnas: 4, filas: 18,
      norte: '2N', sur: '2S', este: '2E', oeste: '2O' },
    { id: 'C3', nombre: 'Cuadrante 3', columnas: 2, filas: 12,
      norte: '3N', sur: '3S', este: '3E' },
    // El norte del cuadrante 4 es la subestacion, que es una franja ancha de
    // toda la mitad derecha y no una ronda del bloque.
    { id: 'C4', nombre: 'Cuadrante 4', columnas: 2, filas: 12,
      sur: '4S', este: '4E' },
  ];

  const AREAS = [
    // Rondas antifuego: la franja que rodea cada cuadrante. Los cuadrantes 1 y
    // 2 tienen las cuatro; 3 y 4 no tienen oeste porque ahi va la calle.
    { id: '1N', etiqueta: '1N', nombre: 'Ronda antifuego 1N', tipo: 'ronda' },
    { id: '1S', etiqueta: '1S', nombre: 'Ronda antifuego 1S', tipo: 'ronda' },
    { id: '1E', etiqueta: '1E', nombre: 'Ronda antifuego 1E', tipo: 'ronda' },
    { id: '1O', etiqueta: '1O', nombre: 'Ronda antifuego 1O', tipo: 'ronda' },
    { id: '2N', etiqueta: '2N', nombre: 'Ronda antifuego 2N', tipo: 'ronda' },
    { id: '2S', etiqueta: '2S', nombre: 'Ronda antifuego 2S', tipo: 'ronda' },
    { id: '2O', etiqueta: '2O', nombre: 'Ronda antifuego 2O', tipo: 'ronda' },
    { id: '3N', etiqueta: '3N', nombre: 'Ronda antifuego 3N', tipo: 'ronda' },
    { id: '3S', etiqueta: '3S', nombre: 'Ronda antifuego 3S', tipo: 'ronda' },
    { id: '3E', etiqueta: '3E', nombre: 'Ronda antifuego 3E', tipo: 'ronda' },
    { id: '4S', etiqueta: '4S', nombre: 'Ronda antifuego 4S', tipo: 'ronda' },
    { id: '4E', etiqueta: '4E', nombre: 'Ronda antifuego 4E', tipo: 'ronda' },

    // Drenajes pluviales. El 2E es las dos cosas a la vez —ronda del cuadrante
    // 2 y drenaje—, por eso lleva los dos nombres.
    { id: 'DR1', etiqueta: 'DR1', nombre: 'Drenaje pluvial DR1', tipo: 'drenaje' },
    { id: 'DR2', etiqueta: 'DR2', nombre: 'Drenaje pluvial DR2', tipo: 'drenaje' },
    { id: '2E',  etiqueta: '2E · DR3',
      nombre: 'Ronda antifuego 2E · drenaje pluvial DR3', tipo: 'drenaje' },

    { id: '4N', etiqueta: '4N · Subestación y bodega',
      nombre: '4N · subestación y bodega', tipo: 'instalacion' },

    { id: 'CALLE', etiqueta: 'Calle principal',
      nombre: 'Calle principal', tipo: 'calle' },
  ];

  // Las areas no son paneles: no se lavan. Dejar elegir lavado sobre una ronda
  // antifuego seria aceptar un dato que no existe.
  const ACTIVIDADES_AREAS = ['fumigacion', 'poda'];

  // Como se apila la planta. Cada mitad es una columna; la calle principal va
  // en el medio y cruza de arriba abajo.
  const PLANTA = {
    izquierda: [{ cuadrante: 'C1' }, { franja: 'DR1' }, { cuadrante: 'C2' }],
    derecha:   [{ cuadrante: 'C3' }, { franja: 'DR2' }, { franja: '4N' },
                { cuadrante: 'C4' }],
  };

  const PORID = {};
  AREAS.forEach(function (a) { PORID[a.id] = a; });

  const SECTORES = [];
  CUADRANTES.forEach(function (q) {
    for (let f = 0; f < q.filas; f++) {
      const letra = String.fromCharCode(65 + f);
      for (let c = 1; c <= q.columnas; c++) SECTORES.push(q.id + '-' + letra + c);
    }
  });

  /* ------------------------------------------------------------------ estilo */

  const ESTILO = `
.mapa-planta{
  --mp-alto:14px; --mp-ancho:84px; --mp-lbl:22px; --mp-franja:20px;
  display:grid; grid-template-columns:auto auto auto; gap:14px;
  justify-content:center; align-items:stretch;
}
.mp-columna{display:grid; gap:12px; align-content:start;}
.mp-bloque{display:grid; gap:3px;
  grid-template-columns:var(--mp-franja) auto var(--mp-franja);
  grid-template-rows:auto auto auto;}
.mp-bloque.sin-oeste{grid-template-columns:0 auto var(--mp-franja);}
.mp-bloque-caja{display:grid; gap:5px;}
.mp-cuadrante-lbl{font-family:var(--mono);font-size:9px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--accent);text-align:center;}

.mp-rejilla{display:grid;gap:3px;}
.mp-celda{width:var(--mp-ancho);height:var(--mp-alto);
  background:var(--surface2);border:1px solid var(--border2);
  cursor:pointer;padding:0;transition:background .08s,border-color .08s;}
.mp-cab-col{width:var(--mp-ancho);height:17px;font-family:var(--mono);font-size:10px;
  color:var(--dim);background:transparent;border:none;cursor:pointer;padding:0;}
.mp-cab-fila{width:var(--mp-lbl);height:var(--mp-alto);font-family:var(--mono);
  font-size:10px;color:var(--dim);background:transparent;border:none;cursor:pointer;padding:0;}
.mp-esquina{width:var(--mp-lbl);height:17px;}

/* Rondas, drenajes, subestacion y calle. El borde punteado distingue de un
   vistazo lo que no es panel, sin gastar un color en eso. */
.mp-area{background:var(--surface2);border:1px solid var(--border2);
  color:var(--dim);font-family:var(--mono);font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;padding:0;cursor:pointer;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  transition:background .08s,border-color .08s,color .08s;}
.mp-area.drenaje,.mp-area.calle{border-style:dashed;}
.mp-area.calle{background:transparent;}
.mp-area.horizontal{height:var(--mp-franja);width:100%;}
.mp-area.vertical{width:var(--mp-franja);height:100%;writing-mode:vertical-rl;}
.mp-area.calle{width:26px;writing-mode:vertical-rl;}

.mapa-planta.interactivo .mp-celda:hover,
.mapa-planta.interactivo .mp-area:hover{border-color:var(--accent);color:var(--text);}
.mapa-planta.interactivo .mp-cab-col:hover,
.mapa-planta.interactivo .mp-cab-fila:hover{color:var(--accent);}
.mapa-planta:not(.interactivo) .mp-celda,
.mapa-planta:not(.interactivo) .mp-area,
.mapa-planta:not(.interactivo) .mp-cab-col,
.mapa-planta:not(.interactivo) .mp-cab-fila{cursor:default;}

.mp-celda.sel{background:var(--accent);border-color:var(--accent);}
.mp-area.sel{background:var(--accent);border-color:var(--accent);color:#04121a;font-weight:600;}

/* Lavado elegido: las areas no aplican y se apagan en vez de dejar que alguien
   las toque y reciba un error recien al enviar. */
.mp-area.no-aplica{opacity:.25;cursor:not-allowed;}
.mapa-planta.interactivo .mp-area.no-aplica:hover{border-color:var(--border2);color:var(--dim);}

.mp-leyenda{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  font-family:var(--mono);font-size:10px;color:var(--dim);letter-spacing:.04em;}
.mp-leyenda i{display:inline-block;width:16px;height:9px;margin-right:5px;
  vertical-align:middle;background:var(--surface2);border:1px solid var(--border2);}
.mp-leyenda i.punteado{border-style:dashed;}
`;

  function inyectarEstilos() {
    if (document.getElementById('mp-estilos')) return;
    const s = document.createElement('style');
    s.id = 'mp-estilos';
    s.textContent = ESTILO;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ dibujo */

  function el(tag, clase) {
    const d = document.createElement(tag);
    if (clase) d.className = clase;
    return d;
  }

  function dibujarArea(area, orientacion, op) {
    const b = el('button', 'mp-area ' + area.tipo + ' ' + orientacion);
    b.dataset.id = area.id;
    b.dataset.tipo = area.tipo;
    b.textContent = area.etiqueta;
    b.title = area.nombre;
    b.type = 'button';
    if (op.alTocar) b.addEventListener('click', function () { op.alTocar(area.id); });
    return b;
  }

  function dibujarRejilla(q, op) {
    const rejilla = el('div', 'mp-rejilla');
    rejilla.style.gridTemplateColumns = 'auto repeat(' + q.columnas + ', auto)';

    rejilla.appendChild(el('div', 'mp-esquina'));
    for (let c = 1; c <= q.columnas; c++) {
      const b = el('button', 'mp-cab-col');
      b.textContent = c;
      b.type = 'button';
      if (op.alTocarGrupo) {
        b.title = 'Columna ' + c + ' completa';
        b.addEventListener('click', function () { op.alTocarGrupo(q, null, c); });
      }
      rejilla.appendChild(b);
    }

    for (let f = 0; f < q.filas; f++) {
      const letra = String.fromCharCode(65 + f);

      const b = el('button', 'mp-cab-fila');
      b.textContent = letra;
      b.type = 'button';
      if (op.alTocarGrupo) {
        b.title = 'Fila ' + letra + ' completa';
        b.addEventListener('click', function () { op.alTocarGrupo(q, letra, null); });
      }
      rejilla.appendChild(b);

      for (let c = 1; c <= q.columnas; c++) {
        const id = q.id + '-' + letra + c;
        const celda = el('button', 'mp-celda');
        celda.dataset.id = id;
        celda.dataset.tipo = 'panel';
        celda.title = id;
        celda.type = 'button';
        if (op.alTocar) celda.addEventListener('click', function () { op.alTocar(id); });
        rejilla.appendChild(celda);
      }
    }
    return rejilla;
  }

  /** Un cuadrante con sus rondas alrededor, como una cuadricula de 3x3. */
  function dibujarBloque(q, op) {
    const caja = el('div', 'mp-bloque-caja');

    const lbl = el('div', 'mp-cuadrante-lbl');
    lbl.textContent = q.nombre;
    caja.appendChild(lbl);

    const bloque = el('div', 'mp-bloque' + (q.oeste ? '' : ' sin-oeste'));

    // Fila 1: esquina, norte, esquina
    bloque.appendChild(el('div'));
    bloque.appendChild(q.norte ? dibujarArea(PORID[q.norte], 'horizontal', op) : el('div'));
    bloque.appendChild(el('div'));

    // Fila 2: oeste, paneles, este
    bloque.appendChild(q.oeste ? dibujarArea(PORID[q.oeste], 'vertical', op) : el('div'));
    bloque.appendChild(dibujarRejilla(q, op));
    bloque.appendChild(q.este ? dibujarArea(PORID[q.este], 'vertical', op) : el('div'));

    // Fila 3: esquina, sur, esquina
    bloque.appendChild(el('div'));
    bloque.appendChild(q.sur ? dibujarArea(PORID[q.sur], 'horizontal', op) : el('div'));
    bloque.appendChild(el('div'));

    caja.appendChild(bloque);
    return caja;
  }

  function dibujarColumna(lista, op) {
    const col = el('div', 'mp-columna');
    lista.forEach(function (pieza) {
      if (pieza.cuadrante) {
        const q = CUADRANTES.find(function (x) { return x.id === pieza.cuadrante; });
        col.appendChild(dibujarBloque(q, op));
      } else {
        col.appendChild(dibujarArea(PORID[pieza.franja], 'horizontal', op));
      }
    });
    return col;
  }

  /**
   * Dibuja la planta entera dentro de `cont`.
   *
   * Opciones:
   *   alTocar(id)                  una celda o un area; si falta, solo lectura
   *   alTocarGrupo(cuadrante, letra, columna)   encabezados de fila y columna
   */
  function construir(cont, opciones) {
    const op = opciones || {};
    inyectarEstilos();
    cont.classList.add('mapa-planta');
    cont.classList.toggle('interactivo', !!op.alTocar);
    cont.innerHTML = '';
    cont.appendChild(dibujarColumna(PLANTA.izquierda, op));
    cont.appendChild(dibujarArea(PORID.CALLE, 'calle', op));
    cont.appendChild(dibujarColumna(PLANTA.derecha, op));
  }

  /* ---------------------------------------------------------------- utiles */

  /** Los ids de una fila o una columna completa de un cuadrante. */
  function idsDeGrupo(q, letra, columna) {
    const ids = [];
    for (let f = 0; f < q.filas; f++) {
      const l = String.fromCharCode(65 + f);
      if (letra && l !== letra) continue;
      for (let c = 1; c <= q.columnas; c++) {
        if (columna && c !== columna) continue;
        ids.push(q.id + '-' + l + c);
      }
    }
    return ids;
  }

  // Dos entradas y no tres: una ronda antifuego se dibuja igual que un panel,
  // asi que separarlas en la leyenda con la misma muestra no diria nada. Lo
  // que el borde distingue es lo que no se camina igual: drenajes y calle.
  const LEYENDA =
    '<span><i></i>Paneles y rondas antifuego</span>' +
    '<span><i class="punteado"></i>Drenajes, subestación y calle</span>' +
    '<span>Las áreas solo se fumigan o se podan</span>';

  window.MAPA = {
    CUADRANTES: CUADRANTES,
    AREAS: AREAS,
    ACTIVIDADES_AREAS: ACTIVIDADES_AREAS,
    TOTAL_SECTORES: SECTORES.length,
    TOTAL_AREAS: AREAS.length,
    LEYENDA: LEYENDA,
    construir: construir,
    idsDeGrupo: idsDeGrupo,
    esArea: function (id) { return Object.prototype.hasOwnProperty.call(PORID, id); },
    area: function (id) { return PORID[id] || null; },
    nombre: function (id) { return PORID[id] ? PORID[id].nombre : id; },
    /** true si la actividad se puede hacer sobre areas (fumigacion y poda). */
    permiteAreas: function (actividad) {
      return ACTIVIDADES_AREAS.indexOf(actividad) !== -1;
    },
  };
})();
