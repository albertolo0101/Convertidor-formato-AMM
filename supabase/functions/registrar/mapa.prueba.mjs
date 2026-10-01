// Pruebas del mapa del servidor. Sin dependencias y sin red:
//   node supabase/functions/registrar/mapa.prueba.mjs
//
// Node 22 le quita los tipos a mapa.ts al importarlo, asi que se prueba el
// mismo archivo que se despliega y no una copia que puede quedar desfasada.
//
// Lo que se cuida aca: que no se cuele un codigo inventado, que los 192
// sectores historicos sigan siendo validos despues de agregar las areas, y que
// el lavado no se pueda registrar sobre una ronda antifuego o un drenaje.

import {
  SECTORES_VALIDOS, AREAS, AREAS_VALIDAS, esArea,
  filtrarSeleccion, validarActividad,
} from './mapa.ts';

const SALTO = String.fromCharCode(10);
let fallos = 0;
function comparar(caso, obtenido, esperado) {
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if (a === b) { console.log('  ok    ' + caso); return; }
  fallos++;
  console.log('  FALLA ' + caso + '\n        esperado ' + b + '\n        obtenido ' + a);
}

console.log('\nel mapa de paneles no cambio');
{
  comparar('siguen siendo 192 sectores', SECTORES_VALIDOS.size, 192);
  comparar('las esquinas de los cuatro cuadrantes',
    ['C1-A1', 'C1-R4', 'C2-R4', 'C3-A1', 'C3-L2', 'C4-L2'].every(s => SECTORES_VALIDOS.has(s)),
    true);
  comparar('no existe una fila S en C1', SECTORES_VALIDOS.has('C1-S1'), false);
  comparar('no existe una columna 3 en C3', SECTORES_VALIDOS.has('C3-A3'), false);
}

console.log('\nareas');
{
  comparar('son 17', AREAS.length, 17);
  comparar('ningun codigo de area choca con uno de panel',
    AREAS.filter(a => SECTORES_VALIDOS.has(a)), []);
  comparar('las cuatro rondas del cuadrante 1',
    ['1N', '1S', '1E', '1O'].every(a => AREAS_VALIDAS.has(a)), true);
  comparar('el cuadrante 3 no tiene oeste', AREAS_VALIDAS.has('3O'), false);
  comparar('el cuadrante 4 no tiene norte propio: ahi va la subestacion',
    [AREAS_VALIDAS.has('4N'), AREAS_VALIDAS.has('4S')], [true, true]);
  comparar('los drenajes y la calle', ['DR1', 'DR2', '2E', 'CALLE'].every(esArea), true);
  comparar('un panel no es area', esArea('C1-A1'), false);
}

console.log('\nfiltrado de lo que llega por la red');
{
  comparar('acepta paneles y areas juntos',
    filtrarSeleccion(['C1-A1', 'DR1', 'CALLE'], 250).sort(), ['C1-A1', 'CALLE', 'DR1']);
  comparar('descarta lo inventado',
    filtrarSeleccion(['C9-Z9', 'DR9', '', 'lo que sea'], 250), []);
  comparar('descarta lo que no es texto',
    filtrarSeleccion([null, 7, {}, ['C1-A1']], 250), []);
  comparar('no deja repetidos',
    filtrarSeleccion(['C1-A1', 'C1-A1', 'DR1', 'DR1'], 250), ['C1-A1', 'DR1']);
  comparar('respeta el tope', filtrarSeleccion(['C1-A1', 'C1-A2', 'C1-A3'], 2).length, 2);
  comparar('un cuerpo que no es lista no rompe', filtrarSeleccion('C1-A1', 250), []);
  comparar('limpia los espacios', filtrarSeleccion(['  DR2  '], 250), ['DR2']);
}

console.log('\nque actividad se puede hacer sobre que');
{
  comparar('fumigar paneles', validarActividad(['C1-A1'], 'fumigacion'), null);
  comparar('lavar paneles', validarActividad(['C1-A1'], 'lavado'), null);
  comparar('fumigar una ronda', validarActividad(['1N'], 'fumigacion'), null);
  comparar('podar un drenaje', validarActividad(['DR1'], 'poda'), null);
  comparar('podar la calle', validarActividad(['CALLE'], 'poda'), null);

  comparar('lavar una ronda no se puede',
    validarActividad(['1N'], 'lavado') !== null, true);
  comparar('lavar la calle tampoco',
    validarActividad(['CALLE'], 'lavado') !== null, true);
  comparar('un lavado de paneles con un area colada se rechaza entero',
    validarActividad(['C1-A1', 'C1-A2', '2E'], 'lavado') !== null, true);
  comparar('una actividad inventada se rechaza',
    validarActividad(['C1-A1'], 'pintar') !== null, true);
  comparar('sin actividad se rechaza', validarActividad(['C1-A1'], '') !== null, true);
}

/* El mapa esta escrito dos veces: aca y en public/mapa.js, que es el que
 * dibuja el navegador. Es la desincronizacion mas facil de cometer y la mas
 * dificil de notar —el kiosko ofreceria un area que el servidor descarta en
 * silencio—, asi que se comparan las dos copias.
 *
 * public/mapa.js es un script de navegador: se evalua con un `window` de
 * mentira, que es todo lo que necesita para publicar su definicion. */
console.log(SALTO + 'las dos copias del mapa coinciden');
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const ruta = fileURLToPath(new URL('../../../public/mapa.js', import.meta.url));

  const ventana = {};
  new Function('window', 'document', readFileSync(ruta, 'utf8'))(ventana, undefined);
  const front = ventana.MAPA;

  const sectoresFront = [];
  front.CUADRANTES.forEach(function (q) {
    for (let f = 0; f < q.filas; f++) {
      const letra = String.fromCharCode(65 + f);
      for (let c = 1; c <= q.columnas; c++) sectoresFront.push(q.id + '-' + letra + c);
    }
  });

  comparar('los mismos sectores de paneles',
    sectoresFront.sort(), [...SECTORES_VALIDOS].sort());
  comparar('las mismas areas',
    front.AREAS.map(a => a.id).sort(), [...AREAS].sort());
  comparar('la misma regla de que actividades admiten areas',
    front.ACTIVIDADES_AREAS.slice().sort(), ['fumigacion', 'poda']);
  comparar('ningun area del front le falta al servidor',
    front.AREAS.filter(a => !AREAS_VALIDAS.has(a.id)), []);
}

console.log(fallos ? '\n' + fallos + ' FALLAS\n' : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
