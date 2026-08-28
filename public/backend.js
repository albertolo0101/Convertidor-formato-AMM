/**
 * Gravitas Mantenimiento — a que backend le habla esta pagina.
 *
 * El entorno se decide por el DOMINIO desde el que se sirve la pagina, no por
 * la rama de git ni por un valor que haya que cambiar a mano.
 *
 * Esto es deliberado. Si la rama de pruebas apuntara a pruebas editando un
 * valor en este archivo, al hacer merge a main te llevarias la configuracion de
 * pruebas a produccion — y el kiosko de la planta empezaria a escribir en la
 * base equivocada sin que nadie lo note. Con deteccion por dominio el mismo
 * archivo es correcto de los dos lados, y no hay nada que recordar cambiar.
 *
 *   gravitas-mantenimiento.alberto-175.workers.dev  ->  PRODUCCION
 *   cualquier otro origen (previews, localhost)     ->  PRUEBAS
 *
 * El caso por defecto es pruebas a proposito: si algun dia se sirve desde un
 * dominio nuevo, el error seguro es escribir en la base de pruebas, no en la
 * de nomina.
 */
(function () {
  const DOMINIO_PRODUCCION = 'gravitas-mantenimiento.alberto-175.workers.dev';

  const ENTORNOS = {
    produccion: {
      nombre: 'produccion',
      url: 'https://rshrbxqflzyqkmaywcwv.supabase.co',
      clave: 'sb_publishable_kCF5u53qP_6qhAn0wu0oNQ_qoov7lWA',
    },
    pruebas: {
      nombre: 'pruebas',
      url: 'https://uimftupnexooyxkegyqy.supabase.co',
      clave: 'sb_publishable_sGxbz8r2klnxkqB_ksP51Q_q2zS44J9',
    },
  };

  const entorno = location.hostname === DOMINIO_PRODUCCION
    ? ENTORNOS.produccion
    : ENTORNOS.pruebas;

  window.BACKEND = {
    entorno: entorno.nombre,
    esPruebas: entorno.nombre === 'pruebas',
    url: entorno.url,
    clave: entorno.clave,
    funcion: function (nombre) { return entorno.url + '/functions/v1/' + nombre; },
  };

  // Aviso imposible de pasar por alto. Un kiosko de pruebas identico al de
  // produccion es peligroso: alguien podria marcar asistencia real ahi y
  // perderla, o dar por bueno un dato que nunca llego a la nomina.
  if (window.BACKEND.esPruebas) {
    document.addEventListener('DOMContentLoaded', function () {
      const cinta = document.createElement('div');
      cinta.textContent = 'ENTORNO DE PRUEBAS — los datos de acá no son reales';
      cinta.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
        'background:#ffd166', 'color:#1a1200', 'text-align:center',
        'font-family:IBM Plex Mono,monospace', 'font-size:11px',
        'letter-spacing:.14em', 'text-transform:uppercase',
        'padding:5px', 'font-weight:700', 'pointer-events:none',
      ].join(';');
      document.body.appendChild(cinta);
      document.body.style.paddingTop = '24px';
    });
  }
})();
