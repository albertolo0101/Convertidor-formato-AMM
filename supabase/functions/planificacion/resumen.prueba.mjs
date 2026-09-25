// Pruebas de la logica de planificacion. Sin dependencias y sin red:
//   node supabase/functions/planificacion/resumen.prueba.mjs
//
// Node 22 le quita los tipos a resumen.ts al importarlo, asi que se prueba el
// mismo archivo que se despliega y no una copia que puede quedar desfasada.

import { resumir, fechaGT, VENTANA_DIAS } from './resumen.ts';

let fallos = 0;
function comparar(caso, obtenido, esperado) {
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if (a === b) { console.log('  ok    ' + caso); return; }
  fallos++;
  console.log('  FALLA ' + caso + '\n        esperado ' + b + '\n        obtenido ' + a);
}

// Mediodia de Guatemala: lejos de los bordes del dia en cualquier zona.
const AHORA = new Date('2026-09-24T18:00:00Z');

function hace(dias, hora) {
  const d = new Date(AHORA.getTime() - dias * 86400000);
  return d.toISOString().slice(0, 11) + (hora || '18:00:00') + 'Z';
}

function sectores(dias, actividad, secs) {
  return { creado_en: hace(dias), tipo: 'sectores', actividad: actividad, sectores: secs, categorias: null };
}
function especial(dias, cats) {
  return { creado_en: hace(dias), tipo: 'especial', actividad: null, sectores: null, categorias: cats };
}

console.log('\nventana de dias');
{
  const r = resumir([], AHORA);
  comparar('hoy es la fecha de Guatemala', r.hoy, '2026-09-24');
  comparar('devuelve ' + VENTANA_DIAS + ' dias', r.dias.length, VENTANA_DIAS);
  comparar('del mas reciente al mas antiguo',
    [r.dias[0].fecha, r.dias[VENTANA_DIAS - 1].fecha], ['2026-09-24', '2026-09-10']);
  comparar('los fines de semana cuentan como dias',
    ['2026-09-19', '2026-09-20', '2026-09-12', '2026-09-13'].every(function (f) {
      return r.dias.some(function (d) { return d.fecha === f; });
    }), true);
  comparar('sin registros no hay nada pintado', r.ultimo,
    { fumigacion: {}, poda: {}, lavado: {} });
}

console.log('\nultima vez de cada sector');
{
  const r = resumir([
    sectores(1, 'fumigacion', ['C1-A1', 'C1-A2']),
    sectores(5, 'fumigacion', ['C1-A1', 'C1-A3']),
  ], AHORA);
  comparar('gana la fecha mas reciente de cada sector', r.ultimo.fumigacion,
    { 'C1-A1': '2026-09-23', 'C1-A2': '2026-09-23', 'C1-A3': '2026-09-19' });
}

console.log('\nactividades independientes');
{
  const r = resumir([
    sectores(0, 'poda', ['C3-A1']),
    sectores(3, 'fumigacion', ['C3-A1']),
    sectores(8, 'lavado', ['C3-A1']),
  ], AHORA);
  comparar('un mismo sector lleva una fecha por actividad',
    [r.ultimo.poda['C3-A1'], r.ultimo.fumigacion['C3-A1'], r.ultimo.lavado['C3-A1']],
    ['2026-09-24', '2026-09-21', '2026-09-16']);
}

console.log('\nagregado por dia');
{
  const r = resumir([
    sectores(2, 'fumigacion', ['C1-A1', 'C1-A2']),
    sectores(2, 'fumigacion', ['C1-A2', 'C1-A3']),
    sectores(2, 'poda', ['C2-B1']),
    especial(2, ['rondas_antifuego', 'otros']),
    especial(2, ['rondas_antifuego']),
  ], AHORA);
  const dia = r.dias.find(function (d) { return d.fecha === '2026-09-22'; });
  comparar('dos reportes de la misma actividad: una linea, sectores unicos',
    dia.actividades,
    [{ actividad: 'fumigacion', sectores: 3 }, { actividad: 'poda', sectores: 1 }]);
  comparar('las categorias especiales se unen sin repetir',
    dia.especiales.sort(), ['otros', 'rondas_antifuego']);
}

console.log('\nbordes de la ventana');
{
  const r = resumir([
    sectores(VENTANA_DIAS - 1, 'lavado', ['C4-A1']),
    sectores(VENTANA_DIAS, 'lavado', ['C4-A2']),
    sectores(40, 'lavado', ['C4-B1']),
  ], AHORA);
  comparar('el ultimo dia de la ventana entra', r.ultimo.lavado['C4-A1'], '2026-09-10');
  comparar('el dia siguiente ya quedo afuera', 'C4-A2' in r.ultimo.lavado, false);
  comparar('lo mas viejo se ignora', 'C4-B1' in r.ultimo.lavado, false);
}

console.log('\nzona horaria');
{
  // 03:00 UTC del 24 son las 21:00 del 23 en Guatemala: el trabajo es del 23.
  const r = resumir([
    { creado_en: '2026-09-24T03:00:00Z', tipo: 'sectores', actividad: 'poda', sectores: ['C1-R4'] },
  ], AHORA);
  comparar('la fecha es la de Guatemala, no la de UTC', r.ultimo.poda['C1-R4'], '2026-09-23');
  comparar('fechaGT convierte bien', fechaGT(new Date('2026-09-24T05:59:00Z')), '2026-09-23');
}

console.log('\nregistros raros');
{
  const r = resumir([
    { creado_en: hace(1), tipo: 'sectores', actividad: 'inventada', sectores: ['C1-A1'] },
    { creado_en: hace(1), tipo: 'sectores', actividad: 'poda', sectores: null },
    { creado_en: hace(1), tipo: 'especial', categorias: null },
  ], AHORA);
  comparar('una actividad desconocida no pinta nada', r.ultimo,
    { fumigacion: {}, poda: {}, lavado: {} });
  comparar('los nulos no rompen', r.dias[1],
    { fecha: '2026-09-23', actividades: [], especiales: [] });
}

console.log(fallos ? '\n' + fallos + ' FALLAS\n' : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
