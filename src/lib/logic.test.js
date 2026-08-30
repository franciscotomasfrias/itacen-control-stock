// Cobertura de tests fase Red para specs/001-reparto-enteros.
//
// Objetivo (ver specs/001-reparto-enteros/spec.md y tdd.md): el resultado
// final de cajas repartidas -- tanto plan[tipo] como reparto[operario][tipo]
// -- tiene que ser siempre un numero entero, y la suma de lo repartido entre
// operarios tiene que coincidir exactamente con plan[tipo]. No se modifica
// src/lib/logic.js: este archivo solo agrega cobertura.
//
// Todos los valores esperados de cada `expect` estan calculados a mano
// (aritmetica plana, documentada en los comentarios de cada bloque) --
// nunca invocando calcularPlanDelDia/simularMes para derivarlos.

import { describe, it, expect } from 'vitest';
import { calcularPlanDelDia, simularMes, BASE_OPERARIOS, TIPOS } from './logic.js';

// --- Configs de test elegidas a mano para que cajasPorOperarioPorDia() de
// un numero redondo, y asi poder calcular a mano el resto de la cadena. ---

// capacidadPorPersona = (horasJornada*60 - minutosDescansoPorDia) /
//   (minutosInstalacionPorCaja + (horasViajeIda+horasViajeVuelta)*60/cajasPorLote)
//                      = (8*60 - 0) / (48 + 0) = 480/48 = 10
const CONFIG_CAP_10 = {
  horasViajeIda: 0,
  horasViajeVuelta: 0,
  cajasPorLote: 50,
  minutosInstalacionPorCaja: 48,
  horasJornada: 8,
  minutosDescansoPorDia: 0,
};

// capacidadPorPersona = (8*60 - 0) / (240 + 0) = 480/240 = 2
// El resto de los campos (costos, probabilidades) vienen de logic.js via
// spread para no tener que reinventar toda la config -- no afectan estos
// escenarios porque el faltante esperado es 0 en todos los dias (0 * lo
// que sea = 0).
const CONFIG_SIMULAR_DETERMINISTA = {
  costoHoraTecnico: 6000,
  tiempoReflasheoMin: 18,
  probStockoutRequiereVuelo: 0.25,
  costoVueloPromedio: 180000,
  cajasPromedioPorViaje: 40,
  multiplicadorRiesgoExclusividad: 1.5,
  horasViajeIda: 0,
  horasViajeVuelta: 0,
  cajasPorLote: 50,
  minutosInstalacionPorCaja: 240,
  horasJornada: 8,
  minutosDescansoPorDia: 0,
  // Aleatoriedad desactivada para que el resultado sea 100% determinista.
  desvioRelativoDemanda: 0,
  probPedidoUrgente: 0,
  probReleaseDiaria: { moto: 0, auto: 0, camion: 0 },
  tamanioPedidoUrgente: { moto: [0, 0], auto: [0, 0], camion: [0, 0] },
};

const FECHA = new Date('2026-09-01T00:00:00');
const FECHA_KEY = '2026-09-01'; // formato Y-m-d de FECHA, escrito a mano

function sumaReparto(reparto, tipo) {
  return Object.values(reparto).reduce((s, r) => s + r[tipo], 0);
}

describe('calcularPlanDelDia -- reparto siempre en enteros (FR-001, FR-002, FR-003)', () => {
  // Ruptura que detecta: si se reemplaza Math.round(porcion) por
  // Math.floor(porcion) en el calculo de `asignado`, plan.auto pasa de 17
  // a 16 (16.667 redondea a 17, pero ese valor no queda recortado por gap
  // ni por restante, asi que el cambio es observable). Tambien detecta
  // cualquier ruptura en la suma reparto === plan por tipo.
  it('redondea el gap fraccionario a enteros y el reparto entre operarios suma exactamente el plan (con comodin activo)', () => {
    // gaps: moto 50, auto 25, camion 15 -> totalGap 90 > capacidadBase(50)
    // -> comodin activo -> 6 presentes * 10 cajas/persona = capacidadHoy 60.
    // porcion moto = 60*50/90 = 33.333... -> round 33 (no clippeado)
    // porcion auto = 60*25/90 = 16.666... -> round 17 (no clippeado)
    // porcion camion = 60*15/90 = 10 exacto -> 10
    const resultado = calcularPlanDelDia({
      fecha: FECHA,
      cargasPorFecha: {},
      bufferObjetivo: { moto: 50, auto: 25, camion: 15 },
      config: CONFIG_CAP_10,
      ausenciasPorFecha: {},
    });

    expect(resultado.plan).toEqual({ moto: 33, auto: 17, camion: 10 });
    TIPOS.forEach((t) => {
      expect(Number.isInteger(resultado.plan[t])).toBe(true);
    });

    // FR-002 / FR-003: nada se pierde ni se inventa al repartir entre operarios.
    TIPOS.forEach((t) => {
      expect(sumaReparto(resultado.reparto, t)).toBe(resultado.plan[t]);
      Object.values(resultado.reparto).forEach((r) => {
        expect(Number.isInteger(r[t])).toBe(true);
        expect(r[t]).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // Ruptura que detecta: si Math.round(porcion) se reemplaza por
  // Math.floor(porcion), plan.moto y plan.auto pasan de 17 a 16 (no estan
  // recortados por `restante`, que en ese punto es 50 y 33
  // respectivamente). Tambien detecta si el Math.min(..., restante) se
  // rompe y la suma supera la capacidad disponible.
  it('cuando la capacidad no alcanza a cubrir el gap total, el plan sigue siendo entero y no supera la capacidad del dia', () => {
    // gaps: moto 100, auto 100, camion 100 -> totalGap 300, comodin
    // ausente -> 5 presentes * 10 = capacidadHoy 50.
    // porcion cada tipo = 50*100/300 = 16.666... -> round 17
    // moto: min(17,100,restante50)=17, restante 33
    // auto: min(17,100,restante33)=17, restante 16
    // camion: min(17,100,restante16)=16 (clippeado por restante)
    const resultado = calcularPlanDelDia({
      fecha: FECHA,
      cargasPorFecha: {},
      bufferObjetivo: { moto: 100, auto: 100, camion: 100 },
      config: CONFIG_CAP_10,
      ausenciasPorFecha: { [FECHA_KEY]: ['Miguel'] },
    });

    expect(resultado.plan).toEqual({ moto: 17, auto: 17, camion: 16 });
    const capacidadHoy = 50;
    const sumaPlan = TIPOS.reduce((s, t) => s + resultado.plan[t], 0);
    expect(sumaPlan).toBeLessThanOrEqual(capacidadHoy);
    TIPOS.forEach((t) => {
      expect(sumaReparto(resultado.reparto, t)).toBe(resultado.plan[t]);
    });
  });
});

describe('calcularPlanDelDia -- reparto exacto entre operarios, casos chicos verificables a mano (FR-002, FR-003)', () => {
  // Ruptura que detecta: cualquier desviacion del reparto round-robin
  // 1-a-1 (ej. un indice mal calculado, un operario saltado o duplicado)
  // cambia al menos uno de estos 5 valores exactos.
  it('con un gap divisible exacto entre los operarios presentes, cada uno recibe la misma cantidad entera', () => {
    // gap moto = 5, totalGap 5 <= capacidadBase(50) -> sin comodin.
    // presentes = 5 base, capacidadHoy 50.
    // porcion moto = 50*5/5 = 50 -> min(50, gap5, restante50) = 5.
    // reparto round-robin de 5 unidades entre 5 presentes -> 1 c/u.
    const resultado = calcularPlanDelDia({
      fecha: FECHA,
      cargasPorFecha: {},
      bufferObjetivo: { moto: 5, auto: 0, camion: 0 },
      config: CONFIG_CAP_10,
      ausenciasPorFecha: {},
    });

    expect(resultado.plan).toEqual({ moto: 5, auto: 0, camion: 0 });
    expect(resultado.reparto).toEqual({
      Alvaro: { moto: 1, auto: 0, camion: 0 },
      Juan: { moto: 1, auto: 0, camion: 0 },
      Ramiro: { moto: 1, auto: 0, camion: 0 },
      Pablo: { moto: 1, auto: 0, camion: 0 },
      Gustavo: { moto: 1, auto: 0, camion: 0 },
    });
  });

  // Ruptura que detecta: si el resto de la division se pierde (ej. reparto
  // proporcional con floor por operario sin repartir el resto), la suma
  // total deja de ser 7. Si el indice round-robin arranca mal, cambia
  // quien recibe la caja extra.
  it('con un gap que no es multiplo exacto de los operarios presentes, el resto se reparte 1 a 1 sin perder cajas', () => {
    // gap moto = 7, mismo escenario de capacidad que el test anterior.
    // porcion moto = 50*7/7 = 50 -> min(50,7,50) = 7.
    // round-robin de 7 unidades entre 5 presentes:
    // idx 0..6 -> Alvaro,Juan,Ramiro,Pablo,Gustavo,Alvaro,Juan
    // => Alvaro=2, Juan=2, Ramiro=1, Pablo=1, Gustavo=1 (suma 7)
    const resultado = calcularPlanDelDia({
      fecha: FECHA,
      cargasPorFecha: {},
      bufferObjetivo: { moto: 7, auto: 0, camion: 0 },
      config: CONFIG_CAP_10,
      ausenciasPorFecha: {},
    });

    expect(resultado.plan).toEqual({ moto: 7, auto: 0, camion: 0 });
    expect(resultado.reparto).toEqual({
      Alvaro: { moto: 2, auto: 0, camion: 0 },
      Juan: { moto: 2, auto: 0, camion: 0 },
      Ramiro: { moto: 1, auto: 0, camion: 0 },
      Pablo: { moto: 1, auto: 0, camion: 0 },
      Gustavo: { moto: 1, auto: 0, camion: 0 },
    });
    expect(sumaReparto(resultado.reparto, 'moto')).toBe(7);
  });
});

describe('calcularPlanDelDia -- casos borde del spec', () => {
  // Ruptura que detecta: si la guarda "presentes.length === 0" del loop de
  // reparto se rompe, o si el filtro de ausentes falla y el comodin se
  // agrega igual estando ausente, esto lanza una excepcion o deja de
  // cumplir plan={0,0,0} / reparto={}.
  it('sin ningun operario presente, el plan queda en cero y el reparto vacio, sin lanzar error', () => {
    const ausentes = [...BASE_OPERARIOS, 'Miguel'];
    const llamar = () =>
      calcularPlanDelDia({
        fecha: FECHA,
        cargasPorFecha: {},
        bufferObjetivo: { moto: 10, auto: 10, camion: 10 },
        config: CONFIG_CAP_10,
        ausenciasPorFecha: { [FECHA_KEY]: ausentes },
      });

    expect(llamar).not.toThrow();
    const resultado = llamar();
    expect(resultado.presentes).toEqual([]);
    expect(resultado.plan).toEqual({ moto: 0, auto: 0, camion: 0 });
    expect(resultado.reparto).toEqual({});
  });

  // Ruptura que detecta: si el chequeo "totalGap > 0" se rompe (por
  // ejemplo pasa a >= 0), se repartiria capacidad aunque no haga falta y
  // algun operario recibiria cajas de mas.
  it('con el buffer ya alcanzado (gap total 0), nadie recibe cajas', () => {
    const resultado = calcularPlanDelDia({
      fecha: FECHA,
      cargasPorFecha: {},
      bufferObjetivo: { moto: 0, auto: 0, camion: 0 },
      config: CONFIG_CAP_10,
      ausenciasPorFecha: {},
    });

    expect(resultado.plan).toEqual({ moto: 0, auto: 0, camion: 0 });
    expect(resultado.reparto).toEqual({
      Alvaro: { moto: 0, auto: 0, camion: 0 },
      Juan: { moto: 0, auto: 0, camion: 0 },
      Ramiro: { moto: 0, auto: 0, camion: 0 },
      Pablo: { moto: 0, auto: 0, camion: 0 },
      Gustavo: { moto: 0, auto: 0, camion: 0 },
    });
  });

  // Ruptura que detecta: si alguien "arregla" el redondeo hacia abajo para
  // no dejar capacidad ociosa (ej. forzando a que Alvaro reciba mas de 1),
  // plan.moto deja de ser 1 y el test falla -- protege el comportamiento
  // esperado descripto en el spec (no forzar el uso de toda la capacidad).
  it('con un gap chico comparado con la cantidad de operarios, no se fuerza el uso de toda la capacidad', () => {
    const resultado = calcularPlanDelDia({
      fecha: FECHA,
      cargasPorFecha: {},
      bufferObjetivo: { moto: 1, auto: 0, camion: 0 },
      config: CONFIG_CAP_10,
      ausenciasPorFecha: {},
    });

    expect(resultado.plan).toEqual({ moto: 1, auto: 0, camion: 0 });
    expect(resultado.reparto).toEqual({
      Alvaro: { moto: 1, auto: 0, camion: 0 },
      Juan: { moto: 0, auto: 0, camion: 0 },
      Ramiro: { moto: 0, auto: 0, camion: 0 },
      Pablo: { moto: 0, auto: 0, camion: 0 },
      Gustavo: { moto: 0, auto: 0, camion: 0 },
    });
    // No se afirma nada sobre las 49 cajas de capacidad que quedan sin
    // usar -- es comportamiento esperado segun el spec, no un bug.
  });
});

describe('simularMes -- usa la misma logica de reparto entero que calcularPlanDelDia (FR-004)', () => {
  // Ruptura que detecta: si Math.round(porcion) se reemplaza por
  // Math.floor(porcion) en el calculo interno de simularMes (mismo patron
  // que en calcularPlanDelDia), la reposicion de moto del dia 2 pasa de 8
  // a 7, el stock queda en 988 en vez de 989, la demanda de 989 no se
  // cubre completa, se genera 1 unidad de faltante y el costo total deja
  // de ser 0 (pasa a costoStockoutPorCaja(config) = 0.25 * (180000/40) *
  // 1.5 = 1687.5). Es exactamente el escenario de SC-002: una regresion
  // del redondeo final tiene que hacer fallar la suite.
  it('con un escenario deterministico de 2 dias, el costo total es exactamente 0 porque el reparto entero repone justo lo necesario', () => {
    // Dia 1: stock arranca en bufferObjetivo (1000/1000/0). Demanda
    // moto=19, auto=11 (sin desvio) deja stock en 981/989/0.
    // Dia 2: gaps = 19/11/0, totalGap=30, capacidadDiaria = 6*2 = 12.
    //   porcion moto = 12*19/30 = 7.6 -> round 8 -> stock.moto = 989
    //   porcion auto = 12*11/30 = 4.4 -> round 4 -> stock.auto = 993
    // La demanda del dia 2 (989 y 993) calza exacto con el stock repuesto
    // -> faltante 0 en ambos dias -> costoTotal 0.
    const bufferObjetivo = { moto: 1000, auto: 1000, camion: 0 };
    const planDiario = [
      { moto: 19, auto: 11, camion: 0 },
      { moto: 989, auto: 993, camion: 0 },
    ];

    const costoTotal = simularMes(bufferObjetivo, planDiario, CONFIG_SIMULAR_DETERMINISTA);

    expect(costoTotal).toBe(0);
  });
});
