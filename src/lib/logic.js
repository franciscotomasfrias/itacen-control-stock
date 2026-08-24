// Logica pura: constantes, simulacion Montecarlo, calculo de reparto diario.
// Extraida sin cambios del artifact original (itacen-app.jsx) -- no toca datos,
// no sabe nada de Supabase ni de window.storage.

export const PERSONAS = ['Almacén', 'Alvaro', 'Juan', 'Ramiro', 'Pablo', 'Gustavo', 'Miguel'];
export const OPERARIOS = PERSONAS.slice(1);
export const BASE_OPERARIOS = ['Alvaro', 'Juan', 'Ramiro', 'Pablo', 'Gustavo'];
export const COMODIN = 'Miguel';
export const TIPOS = ['moto', 'auto', 'camion'];
export const TIPO_LABEL = { moto: 'Moto', auto: 'Auto', camion: 'Camión' };

export const COLORES = {
  'Almacén': '#94A3B8', Alvaro: '#3B82F6', Juan: '#22C55E', Ramiro: '#A855F7',
  Pablo: '#EF4444', Gustavo: '#F97316', Miguel: '#14B8A6',
};

export const DEFAULT_CONFIG = {
  minutosInstalacionPorCaja: 17.5,
  horasViajeIda: 1,
  horasViajeVuelta: 1,
  minutosDescansoPorDia: 40,
  horasJornada: 8,
  cajasPorLote: 50,
  diasHabilesPorSemana: 5,
  desvioRelativoDemanda: 0.15,
  costoHoraTecnico: 6000,
  tiempoReflasheoMin: 18,
  probStockoutRequiereVuelo: 0.25,
  costoVueloPromedio: 180000,
  cajasPromedioPorViaje: 40,
  multiplicadorRiesgoExclusividad: 1.5,
  probPedidoUrgente: 0.05,
  probReleaseDiaria: { moto: 0.025, auto: 0.03, camion: 0.025 },
  tamanioPedidoUrgente: { moto: [20, 60], auto: [60, 150], camion: [50, 130] },
};

export const DEFAULT_PLAN_GERENCIA = {
  fechaInicio: formatFecha(new Date()),
  semanas: [
    { moto: 0, auto: 0, camion: 0 },
    { moto: 0, auto: 0, camion: 0 },
    { moto: 0, auto: 0, camion: 0 },
    { moto: 0, auto: 0, camion: 0 },
  ],
};

export function formatFecha(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function formatFechaCorta(dStr) {
  const [, m, d] = dStr.split('-');
  return `${d}/${m}`;
}
export function esDiaHabil(date) {
  const d = date.getDay();
  return d !== 0 && d !== 6;
}
export function sumarDias(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
export function siguienteDiaHabil(desde) {
  let d = sumarDias(desde, 1);
  while (!esDiaHabil(d)) d = sumarDias(d, 1);
  return d;
}
export function contarDiasHabilesEntre(inicio, fin) {
  let count = 0;
  let cursor = new Date(inicio);
  while (cursor < fin) {
    if (esDiaHabil(cursor)) count++;
    cursor = sumarDias(cursor, 1);
  }
  return count;
}
export function cajasPorOperarioPorDia(config) {
  const viajeAmortizado = ((config.horasViajeIda + config.horasViajeVuelta) * 60) / config.cajasPorLote;
  const minutosEfectivos = config.minutosInstalacionPorCaja + viajeAmortizado;
  const minutosProductivos = config.horasJornada * 60 - config.minutosDescansoPorDia;
  return minutosProductivos / minutosEfectivos;
}
export function costoRetrabajoPorCaja(config) {
  return config.costoHoraTecnico * (config.tiempoReflasheoMin / 60);
}
export function costoStockoutPorCaja(config) {
  return (
    config.probStockoutRequiereVuelo *
    (config.costoVueloPromedio / config.cajasPromedioPorViaje) *
    config.multiplicadorRiesgoExclusividad
  );
}
export function gaussianRandom(mean, std) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function hexConAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
export function capitalizar(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function formatRangoSemana(fechaInicioStr, fechaFinStr) {
  const inicio = new Date(fechaInicioStr + 'T00:00:00');
  const fin = new Date(fechaFinStr + 'T00:00:00');
  const diaInicio = capitalizar(inicio.toLocaleDateString('es-AR', { weekday: 'long' }));
  const diaFin = capitalizar(fin.toLocaleDateString('es-AR', { weekday: 'long' }));
  const mesInicio = inicio.toLocaleDateString('es-AR', { month: 'long' });
  const mesFin = fin.toLocaleDateString('es-AR', { month: 'long' });
  if (mesInicio === mesFin) {
    return `${diaInicio} ${inicio.getDate()} al ${diaFin} ${fin.getDate()} de ${mesInicio}`;
  }
  return `${diaInicio} ${inicio.getDate()} de ${mesInicio} al ${diaFin} ${fin.getDate()} de ${mesFin}`;
}
export function formatRangoCorto(fechaInicioStr, fechaFinStr) {
  const inicio = new Date(fechaInicioStr + 'T00:00:00');
  const fin = new Date(fechaFinStr + 'T00:00:00');
  const mesInicio = capitalizar(inicio.toLocaleDateString('es-AR', { month: 'short' })).replace('.', '');
  const mesFin = capitalizar(fin.toLocaleDateString('es-AR', { month: 'short' })).replace('.', '');
  if (mesInicio === mesFin) return `${inicio.getDate()}-${fin.getDate()} ${mesInicio}`;
  return `${inicio.getDate()} ${mesInicio}-${fin.getDate()} ${mesFin}`;
}

export function generarFechasDelPlan(fechaInicioStr, nSemanas, diasHabilesPorSemana) {
  const semanas = [];
  let cursor = new Date(fechaInicioStr + 'T00:00:00');
  for (let s = 0; s < nSemanas; s++) {
    const dias = [];
    while (dias.length < diasHabilesPorSemana) {
      if (esDiaHabil(cursor)) dias.push(formatFecha(cursor));
      cursor = sumarDias(cursor, 1);
    }
    semanas.push(dias);
  }
  return semanas;
}

export function fechaInicioSemanaAnterior(fechaInicioStr, diasHabilesPorSemana) {
  let cursor = new Date(fechaInicioStr + 'T00:00:00');
  let contados = 0;
  while (contados < diasHabilesPorSemana) {
    cursor = sumarDias(cursor, -1);
    if (esDiaHabil(cursor)) contados++;
  }
  return formatFecha(cursor);
}

export function demandaDiariaSemana(semana, diasHabilesPorSemana) {
  return {
    moto: (semana.moto || 0) / diasHabilesPorSemana,
    auto: (semana.auto || 0) / diasHabilesPorSemana,
    camion: (semana.camion || 0) / diasHabilesPorSemana,
  };
}

export function ultimoValorConocido(persona, antesDe, cargasPorFecha, maxDiasAtras) {
  let cursor = sumarDias(antesDe, -1);
  for (let i = 0; i < maxDiasAtras; i++) {
    const key = formatFecha(cursor);
    if (cargasPorFecha[key] && cargasPorFecha[key][persona]) {
      return { fecha: key, valor: cargasPorFecha[key][persona] };
    }
    cursor = sumarDias(cursor, -1);
  }
  return null;
}

export function calcularPlanDelDia({ fecha, cargasPorFecha, bufferObjetivo, config, ausenciasPorFecha }) {
  // Cada persona (Almacen y cada operario) puede haber cargado su último dato
  // en un dia DISTINTO -- no forzamos a que todos coincidan en la misma fecha,
  // porque en la practica Almacen y los operarios cargan en momentos distintos.
  const baseAlmacen = ultimoValorConocido('Almacén', fecha, cargasPorFecha, 60);
  const stockAlmacen = baseAlmacen ? baseAlmacen.valor : { moto: 0, auto: 0, camion: 0 };

  const wip = { moto: 0, auto: 0, camion: 0 };
  let algunOperarioConDato = false;
  OPERARIOS.forEach((op) => {
    const base = ultimoValorConocido(op, fecha, cargasPorFecha, 60);
    if (base) {
      algunOperarioConDato = true;
      TIPOS.forEach((t) => { wip[t] += base.valor[t] || 0; });
    }
  });

  const stockEfectivo = {};
  TIPOS.forEach((t) => { stockEfectivo[t] = (stockAlmacen[t] || 0) + wip[t]; });

  const fechaKey = formatFecha(fecha);
  const ausentesHoy = ausenciasPorFecha[fechaKey] || [];
  const baseDisponibles = BASE_OPERARIOS.filter((op) => !ausentesHoy.includes(op));
  const capacidadPorPersona = cajasPorOperarioPorDia(config);
  const capacidadBase = baseDisponibles.length * capacidadPorPersona;

  const gaps = {};
  TIPOS.forEach((t) => { gaps[t] = Math.max(0, (bufferObjetivo[t] || 0) - stockEfectivo[t]); });
  const totalGap = TIPOS.reduce((s, t) => s + gaps[t], 0);

  const comodinDisponible = !ausentesHoy.includes(COMODIN);
  const necesitaComodin = totalGap > capacidadBase && comodinDisponible;
  const presentes = necesitaComodin ? [...baseDisponibles, COMODIN] : baseDisponibles;
  const capacidadHoy = presentes.length * capacidadPorPersona;

  const plan = { moto: 0, auto: 0, camion: 0 };
  if (totalGap > 0 && capacidadHoy > 0) {
    let restante = capacidadHoy;
    TIPOS.forEach((t) => {
      const porcion = capacidadHoy * (gaps[t] / totalGap);
      const asignado = Math.max(0, Math.floor(Math.min(Math.round(porcion), gaps[t], restante)));
      plan[t] = asignado; restante -= asignado;
    });
  }
  const reparto = {};
  presentes.forEach((op) => { reparto[op] = { moto: 0, auto: 0, camion: 0 }; });
  let idx = 0;
  TIPOS.forEach((t) => {
    for (let i = 0; i < plan[t]; i++) {
      if (presentes.length === 0) break;
      reparto[presentes[idx % presentes.length]][t] += 1;
      idx++;
    }
  });
  return {
    plan, reparto, presentes,
    comodinActivo: necesitaComodin,
    tieneBase: !!baseAlmacen || algunOperarioConDato,
  };
}

export function simularMes(bufferObjetivo, planDiario, config) {
  const stock = { ...bufferObjetivo };
  const capacidadDiaria = OPERARIOS.length * cajasPorOperarioPorDia(config);
  const cRetrabajo = costoRetrabajoPorCaja(config);
  const cStockout = costoStockoutPorCaja(config);
  let costoTotal = 0;

  for (const demandaMedia of planDiario) {
    const gaps = {};
    TIPOS.forEach((t) => { gaps[t] = Math.max(0, (bufferObjetivo[t] || 0) - stock[t]); });
    const totalGap = TIPOS.reduce((s, t) => s + gaps[t], 0);
    if (totalGap > 0) {
      let restante = capacidadDiaria;
      TIPOS.forEach((t) => {
        const porcion = capacidadDiaria * (gaps[t] / totalGap);
        const asignado = Math.max(0, Math.floor(Math.min(Math.round(porcion), gaps[t], restante)));
        stock[t] += asignado; restante -= asignado;
      });
    }
    TIPOS.forEach((t) => {
      const media = demandaMedia[t];
      let demanda = 0;
      if (media > 0) {
        const desvio = media * config.desvioRelativoDemanda;
        demanda = Math.max(0, Math.round(gaussianRandom(media, desvio)));
      }
      if (Math.random() < config.probPedidoUrgente) {
        const [lo, hi] = config.tamanioPedidoUrgente[t];
        demanda += Math.floor(lo + Math.random() * (hi - lo + 1));
      }
      const entregado = Math.min(demanda, stock[t]);
      const faltante = demanda - entregado;
      stock[t] -= entregado;
      costoTotal += faltante * cStockout;
      if (Math.random() < config.probReleaseDiaria[t]) {
        costoTotal += stock[t] * cRetrabajo;
        stock[t] = 0;
      }
    });
  }
  return costoTotal;
}

export function costoPromedio(bufferObjetivo, planDiario, config, nIter) {
  let total = 0;
  for (let i = 0; i < nIter; i++) total += simularMes(bufferObjetivo, planDiario, config);
  return total / nIter;
}

// N_ITERACIONES_RIGUROSAS: mismo nivel de rigurosidad que el script Python de referencia
// (buffer_optimo_montecarlo.py) para la evaluacion de cada candidato en la etapa final.
export const N_ITERACIONES_RIGUROSAS = 300;

export function candidatosAlrededorDe(centro, paso, radio) {
  const set = new Set();
  for (let v = Math.max(0, centro - radio); v <= centro + radio; v += paso) set.add(Math.round(v));
  set.add(Math.max(0, centro)); // aseguro que el propio centro este incluido
  return Array.from(set).sort((a, b) => a - b);
}

export function buscarMejorPorTipo(bufferActual, t, candidatos, planDiario, config, nIter) {
  let mejorValor = bufferActual[t];
  let mejorCosto = Infinity;
  candidatos.forEach((candidato) => {
    const prueba = { ...bufferActual, [t]: candidato };
    const c = costoPromedio(prueba, planDiario, config, nIter);
    if (c < mejorCosto) { mejorCosto = c; mejorValor = candidato; }
  });
  return mejorValor;
}

/*
 * Busqueda en 3 etapas, gruesa -> media -> fina, en vez de una grilla fija.
 * La grilla fija anterior (0,20,40,60,90,120,150,200) tenia un techo absoluto de 200:
 * si la demanda real necesitaba un buffer mas alto que eso (por ejemplo con una
 * semana de 1000 camiones), la busqueda NUNCA evaluaba el valor correcto, sin
 * importar cuantas iteraciones se usaran. Por eso ahora la grilla se genera a
 * partir de la propia demanda cargada, y se refina en pasos cada vez mas finos
 * (hasta step=1, o sea el entero exacto) alrededor del mejor candidato de la
 * etapa anterior.
 */
export function optimizarBuffers(planDiario, config) {
  const demandaProm = { moto: 0, auto: 0, camion: 0 };
  planDiario.forEach((d) => TIPOS.forEach((t) => { demandaProm[t] += d[t]; }));
  TIPOS.forEach((t) => { demandaProm[t] /= planDiario.length; });

  let bufferActual = {};
  TIPOS.forEach((t) => { bufferActual[t] = Math.round(demandaProm[t] * 3); });

  // Etapa 1: grilla gruesa proporcional a la demanda de cada tipo (cubre 0 a 6x
  // el punto de partida), 2 pasadas de coordinate descent.
  for (let pasada = 0; pasada < 2; pasada++) {
    TIPOS.forEach((t) => {
      const anchor = Math.max(bufferActual[t], 1);
      const factores = [0, 0.15, 0.35, 0.55, 0.75, 1, 1.5, 2, 3, 4.5, 6];
      const candidatos = Array.from(new Set(factores.map((f) => Math.round(anchor * f))));
      bufferActual[t] = buscarMejorPorTipo(bufferActual, t, candidatos, planDiario, config, N_ITERACIONES_RIGUROSAS);
    });
  }

  // Etapa 2: refinar con paso ~5% del valor encontrado, radio ~20%.
  for (let pasada = 0; pasada < 2; pasada++) {
    TIPOS.forEach((t) => {
      const paso = Math.max(1, Math.round(bufferActual[t] * 0.05));
      const radio = paso * 4;
      const candidatos = candidatosAlrededorDe(bufferActual[t], paso, radio);
      bufferActual[t] = buscarMejorPorTipo(bufferActual, t, candidatos, planDiario, config, N_ITERACIONES_RIGUROSAS);
    });
  }

  // Etapa 3: pulido final con paso 1 (el entero exacto), radio pequeño.
  TIPOS.forEach((t) => {
    const radio = Math.max(5, Math.round(bufferActual[t] * 0.02));
    const candidatos = candidatosAlrededorDe(bufferActual[t], 1, radio);
    bufferActual[t] = buscarMejorPorTipo(bufferActual, t, candidatos, planDiario, config, N_ITERACIONES_RIGUROSAS);
  });

  return bufferActual;
}

export function formatFechaLegible(date) {
  const txt = date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
export const DEFAULT_PLAN_OPERARIO = [
  { moto: 0, auto: 0, camion: 0 },
  { moto: 0, auto: 0, camion: 0 },
  { moto: 0, auto: 0, camion: 0 },
  { moto: 0, auto: 0, camion: 0 },
];

