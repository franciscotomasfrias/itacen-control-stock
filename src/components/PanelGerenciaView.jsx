import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings, RefreshCw, Save, Plus, Trash2, ChevronLeft, ChevronRight,
  BarChart3, CalendarX, ListChecks, Check, Loader2, Sparkles,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  PERSONAS, OPERARIOS, BASE_OPERARIOS, COMODIN, TIPOS, TIPO_LABEL, COLORES,
  DEFAULT_CONFIG, DEFAULT_PLAN_GERENCIA,
  formatFecha, esDiaHabil, sumarDias, hexConAlpha, capitalizar,
  formatRangoSemana, formatRangoCorto, generarFechasDelPlan, fechaInicioSemanaAnterior,
  demandaDiariaSemana, calcularPlanDelDia, optimizarBuffers, gaussianRandom,
  cajasPorOperarioPorDia,
} from '../lib/logic';

const TABS = [
  { id: 'resumen', label: 'Resumen', icon: ListChecks },
  { id: 'semanal', label: 'Estimaciones', icon: Sparkles },
  { id: 'ausencias', label: 'Ausencias', icon: CalendarX },
  { id: 'dashboards', label: 'Efectividad', icon: BarChart3 },
  { id: 'config', label: 'Configuración', icon: Settings },
];
import {
  getConfig, setConfig as setConfigDB,
  getPlan, setPlan as setPlanDB,
  getAusencias, setAusencias as setAusenciasDB,
  getBuffer, setBuffer as setBufferDB,
  getCargas, upsertCargasBulk,
} from '../lib/db';

export default function PanelGerenciaView() {
  const [tab, setTab] = useState('resumen');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [plan, setPlan] = useState(DEFAULT_PLAN_GERENCIA);
  const [bufferObjetivo, setBufferObjetivo] = useState({ moto: 0, auto: 0, camion: 0 });
  const [ausenciasPorFecha, setAusenciasPorFecha] = useState({});
  const [cargasPorFecha, setCargasPorFecha] = useState({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [cargandoDashboards, setCargandoDashboards] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [fechaAusencia, setFechaAusencia] = useState(new Date());
  const [generando, setGenerando] = useState(false);
  const [progresoGeneracion, setProgresoGeneracion] = useState(0);

  const cargarBase = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p, b, a] = await Promise.all([
        getConfig().catch(() => null),
        getPlan().catch(() => null),
        getBuffer().catch(() => null),
        getAusencias().catch(() => null),
      ]);
      if (c) setConfig(c);
      if (p) setPlan(p);
      if (b) setBufferObjetivo(b);
      if (a) setAusenciasPorFecha(a);
    } catch (e) {
      setMensaje({ tipo: 'error', texto: 'No se pudo conectar con la base de datos.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarBase(); }, [cargarBase]);

  const mostrarMensaje = (tipo, texto) => {
    setMensaje({ tipo, texto });
    setTimeout(() => setMensaje(null), 2500);
  };

  const guardarConfig = async () => {
    setGuardando(true);
    try {
      await setConfigDB(config);
      mostrarMensaje('ok', 'Configuración guardada.');
    } catch (e) { mostrarMensaje('error', 'No se pudo guardar la configuración.'); }
    finally { setGuardando(false); }
  };

  const recalcularBuffers = () => {
    return new Promise((resolve) => {
      setRecalculando(true);
      setTimeout(async () => {
        try {
          const planDiario = [];
          plan.semanas.forEach((s) => {
            const d = demandaDiariaSemana(s, config.diasHabilesPorSemana);
            for (let i = 0; i < config.diasHabilesPorSemana; i++) planDiario.push(d);
          });
          const nuevoBuffer = optimizarBuffers(planDiario, config);
          setBufferObjetivo(nuevoBuffer);
          await setBufferDB(nuevoBuffer);
          mostrarMensaje('ok', 'Estimaciones guardadas y buffer recalculado.');
        } catch (e) {
          mostrarMensaje('error', 'Se guardó el plan, pero no se pudo recalcular el buffer.');
        } finally {
          setRecalculando(false);
          resolve();
        }
      }, 50);
    });
  };

  const guardarPlan = async () => {
    setGuardando(true);
    try {
      await setPlanDB(plan);
      await recalcularBuffers();
    } catch (e) { mostrarMensaje('error', 'No se pudo guardar el plan.'); }
    finally { setGuardando(false); }
  };

  const guardarAusencias = async (nuevo) => {
    setAusenciasPorFecha(nuevo);
    try { await setAusenciasDB(nuevo); }
    catch (e) { mostrarMensaje('error', 'No se pudo guardar la ausencia.'); }
  };

  const [semanasFechas, setSemanasFechas] = useState([]);
  const cargarDashboards = useCallback(async () => {
    setCargandoDashboards(true);
    try {
      const semanas = generarFechasDelPlan(plan.fechaInicio, plan.semanas.length, config.diasHabilesPorSemana);
      setSemanasFechas(semanas);
      const resultado = await getCargas().catch(() => null);
      setCargasPorFecha(resultado || {});
    } catch (e) {
      mostrarMensaje('error', 'No se pudieron cargar los datos de los dashboards.');
    } finally {
      setCargandoDashboards(false);
    }
  }, [plan, config]);

  const datosDashboard = useMemo(() => {
    if (semanasFechas.length === 0) return {};
    const porOperario = {};
    OPERARIOS.forEach((op) => { porOperario[op] = []; });

    semanasFechas.forEach((diasSemana, idx) => {
      const totales = {};
      OPERARIOS.forEach((op) => { totales[op] = { real: 0, estimado: 0 }; });
      diasSemana.forEach((fechaStr) => {
        const fechaObj = new Date(fechaStr + 'T00:00:00');
        const { reparto } = calcularPlanDelDia({
          fecha: fechaObj, cargasPorFecha, bufferObjetivo, config, ausenciasPorFecha,
        });
        const cargaDia = cargasPorFecha[fechaStr] || {};
        OPERARIOS.forEach((op) => {
          const est = reparto[op] ? TIPOS.reduce((s, t) => s + reparto[op][t], 0) : 0;
          const real = cargaDia[op] ? TIPOS.reduce((s, t) => s + (cargaDia[op][t] || 0), 0) : 0;
          totales[op].estimado += est;
          totales[op].real += real;
        });
      });
      const etiqueta = formatRangoCorto(diasSemana[0], diasSemana[diasSemana.length - 1]);
      OPERARIOS.forEach((op) => {
        porOperario[op].push({
          semana: etiqueta,
          rangoCompleto: formatRangoSemana(diasSemana[0], diasSemana[diasSemana.length - 1]),
          Real: totales[op].real,
          Estimado: totales[op].estimado,
          efectividad: totales[op].estimado > 0 ? Math.round((totales[op].real / totales[op].estimado) * 100) : null,
        });
      });
    });
    return porOperario;
  }, [semanasFechas, cargasPorFecha, bufferObjetivo, config, ausenciasPorFecha]);

  const fechaAusenciaKey = formatFecha(fechaAusencia);
  const ausentesDia = ausenciasPorFecha[fechaAusenciaKey] || [];

  const toggleAusente = (op) => {
    const actual = ausenciasPorFecha[fechaAusenciaKey] || [];
    const nuevo = actual.includes(op) ? actual.filter((x) => x !== op) : [...actual, op];
    guardarAusencias({ ...ausenciasPorFecha, [fechaAusenciaKey]: nuevo });
  };

  const capacidadOperario = cajasPorOperarioPorDia(config);

  const semanasFechasPlan = useMemo(
    () => generarFechasDelPlan(plan.fechaInicio, plan.semanas.length, config.diasHabilesPorSemana),
    [plan.fechaInicio, plan.semanas.length, config.diasHabilesPorSemana]
  );

  const capacidadSemanalEquipo = OPERARIOS.length * capacidadOperario * config.diasHabilesPorSemana;
  const semanasQueExcedenCapacidad = plan.semanas
    .map((s, i) => ({ i, total: s.moto + s.auto + s.camion }))
    .filter(({ total }) => total > capacidadSemanalEquipo * 1.5);

  const generarHistorico3Meses = async () => {
    setGenerando(true);
    setProgresoGeneracion(0);
    try {
      const hoy = new Date();
      const fin = sumarDias(hoy, -1);
      const inicio = sumarDias(hoy, -90);
      const dias = [];
      let cursor = new Date(inicio);
      while (cursor <= fin) {
        if (esDiaHabil(cursor)) dias.push(new Date(cursor));
        cursor = sumarDias(cursor, 1);
      }

      const diasPorSemana = config.diasHabilesPorSemana;
      const semanas = [];
      for (let i = 0; i < dias.length; i += diasPorSemana) {
        const factor = 0.8 + Math.random() * 0.4;
        semanas.push({
          moto: Math.round(8 * diasPorSemana * factor),
          auto: Math.round(20 * diasPorSemana * factor),
          camion: Math.round(17 * diasPorSemana * factor),
        });
      }
      const nuevoPlan = { fechaInicio: formatFecha(dias[0]), semanas };

      const nuevasAusencias = {};
      dias.forEach((d) => {
        const key = formatFecha(d);
        const ausentesDia = [];
        OPERARIOS.forEach((op) => {
          const probAusencia = op === COMODIN ? 0.04 : 0.035;
          if (Math.random() < probAusencia) ausentesDia.push(op);
        });
        if (ausentesDia.length > 0) nuevasAusencias[key] = ausentesDia;
      });

      const bufferBase = (bufferObjetivo.moto || bufferObjetivo.auto || bufferObjetivo.camion)
        ? bufferObjetivo
        : { moto: 40, auto: 150, camion: 100 };

      let stockAlmacen = { ...bufferBase };
      const wip = {};
      OPERARIOS.forEach((op) => { wip[op] = { moto: 0, auto: 0, camion: 0 }; });
      const capacidadPersona = cajasPorOperarioPorDia(config);
      const nuevasCargas = {};

      for (let i = 0; i < dias.length; i++) {
        const fecha = dias[i];
        const key = formatFecha(fecha);
        const ausentesHoy = nuevasAusencias[key] || [];
        const baseDisponibles = BASE_OPERARIOS.filter((op) => !ausentesHoy.includes(op));
        const capacidadBase = baseDisponibles.length * capacidadPersona;
        const stockEfectivo = {};
        TIPOS.forEach((t) => {
          stockEfectivo[t] = stockAlmacen[t] + OPERARIOS.reduce((s, op) => s + (wip[op][t] || 0), 0);
        });
        const gaps = {};
        TIPOS.forEach((t) => { gaps[t] = Math.max(0, (bufferBase[t] || 0) - stockEfectivo[t]); });
        const totalGap = TIPOS.reduce((s, t) => s + gaps[t], 0);
        const comodinDisp = !ausentesHoy.includes(COMODIN);
        const necesitaComodin = totalGap > capacidadBase && comodinDisp;
        const presentes = necesitaComodin ? [...baseDisponibles, COMODIN] : baseDisponibles;
        const capacidadHoy = presentes.length * capacidadPersona;

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
          for (let k = 0; k < plan[t]; k++) {
            if (presentes.length === 0) break;
            reparto[presentes[idx % presentes.length]][t] += 1;
            idx++;
          }
        });

        presentes.forEach((op) => {
          TIPOS.forEach((t) => {
            const ruido = 0.85 + Math.random() * 0.3;
            wip[op][t] += Math.max(0, Math.round(reparto[op][t] * ruido));
          });
        });

        OPERARIOS.forEach((op) => {
          if (Math.random() < 0.45) {
            TIPOS.forEach((t) => { stockAlmacen[t] += wip[op][t]; wip[op][t] = 0; });
          }
        });

        const semanaIdx = Math.min(Math.floor(i / diasPorSemana), semanas.length - 1);
        const demandaSemana = semanas[semanaIdx];
        TIPOS.forEach((t) => {
          const media = demandaSemana[t] / diasPorSemana;
          const desvio = media * config.desvioRelativoDemanda;
          let demanda = Math.max(0, Math.round(gaussianRandom(media, desvio)));
          if (Math.random() < config.probPedidoUrgente) {
            const [lo, hi] = config.tamanioPedidoUrgente[t];
            demanda += Math.floor(lo + Math.random() * (hi - lo + 1));
          }
          const entregado = Math.min(demanda, stockAlmacen[t]);
          stockAlmacen[t] -= entregado;
          if (Math.random() < config.probReleaseDiaria[t]) stockAlmacen[t] = 0;
        });

        const cargaDia = { 'Almacén': { ...stockAlmacen } };
        presentes.forEach((op) => { cargaDia[op] = { ...wip[op] }; });
        nuevasCargas[key] = cargaDia;
        if (i % 5 === 0) setProgresoGeneracion(Math.round(((i + 1) / dias.length) * 90));
      }
      setProgresoGeneracion(95);

      // con Postgres no hace falta traer y mergear el historico previo: cada fila
      // es independiente (fecha, persona), asi que un upsert masivo alcanza.
      const filasParaSubir = [];
      Object.entries(nuevasCargas).forEach(([fecha, porPersona]) => {
        Object.entries(porPersona).forEach(([persona, valores]) => {
          filasParaSubir.push({ fecha, persona, ...valores });
        });
      });

      await setConfigDB(config);
      await setPlanDB(nuevoPlan);
      await setAusenciasDB(nuevasAusencias);
      await setBufferDB(bufferBase);
      await upsertCargasBulk(filasParaSubir);
      setProgresoGeneracion(100);

      setPlan(nuevoPlan);
      setAusenciasPorFecha(nuevasAusencias);
      setBufferObjetivo(bufferBase);
      setCargasPorFecha((prev) => ({ ...prev, ...nuevasCargas }));
      mostrarMensaje('ok', `Histórico generado: ${dias.length} días hábiles, ${filasParaSubir.length} registros de stock.`);
    } catch (e) {
      mostrarMensaje('error', `No se pudo generar el histórico completo: ${e && e.message ? e.message : 'error desconocido'}`);
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="w-full min-h-screen" style={{ background: '#12151A', color: '#E7E5E0', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        .disp { font-family: 'Space Grotesk', sans-serif; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
      `}</style>

      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs tracking-widest uppercase mono" style={{ color: '#8B8F98' }}>Itacen · Panel de gerencia</span>
          <button onClick={cargarBase} className="p-1.5 rounded-lg active:opacity-60" aria-label="Actualizar">
            <RefreshCw size={14} color="#6B7280" className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <h1 className="disp text-2xl sm:text-3xl font-bold mb-5" style={{ letterSpacing: '-0.01em' }}>Control de stock flasheado</h1>

        {mensaje && (
          <div
            className="mb-4 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
            style={{ background: mensaje.tipo === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: mensaje.tipo === 'ok' ? '#86EFAC' : '#FCA5A5' }}
          >
            {mensaje.tipo === 'ok' && <Check size={14} />} {mensaje.texto}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap shrink-0"
              style={{ background: tab === id ? '#F2B705' : '#1B1F27', color: tab === id ? '#0F1116' : '#B7BAC2' }}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* RESUMEN */}
        {tab === 'resumen' && (
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <div className="text-xs uppercase tracking-wider mono mb-3" style={{ color: '#6B7280' }}>Buffer objetivo vigente</div>
              <div className="grid grid-cols-3 gap-3">
                {TIPOS.map((t) => (
                  <div key={t} className="text-center rounded-lg py-3" style={{ background: '#12151A' }}>
                    <div className="text-2xl font-bold mono">{bufferObjetivo[t] || 0}</div>
                    <div className="text-xs" style={{ color: '#6B7280' }}>{TIPO_LABEL[t]}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={recalcularBuffers}
                disabled={recalculando}
                className="mt-3 w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{ background: hexConAlpha('#F2B705', 0.15), color: '#F2B705' }}
              >
                {recalculando ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {recalculando ? 'Recalculando (simulación Montecarlo)…' : 'Recalcular con las estimaciones actuales'}
              </button>
            </div>

            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <div className="text-xs uppercase tracking-wider mono mb-2" style={{ color: '#6B7280' }}>Capacidad del modelo</div>
              <div className="text-sm" style={{ color: '#B7BAC2' }}>
                ~<span className="mono">{capacidadOperario.toFixed(1)}</span> cajas por operario por día
                (equipo completo de {OPERARIOS.length}: <span className="mono">{(capacidadOperario * OPERARIOS.length).toFixed(0)}</span> cajas/día)
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <div className="text-xs uppercase tracking-wider mono mb-3" style={{ color: '#6B7280' }}>Estimaciones semanales cargadas</div>
              <div className="space-y-1.5">
                {plan.semanas.map((s, i) => ({ s, i })).slice().reverse().map(({ s, i }) => {
                  const dias = semanasFechasPlan[i];
                  return (
                    <div key={i} className="flex items-center justify-between text-sm gap-2">
                      <span style={{ color: '#8B8F98' }}>{dias ? formatRangoSemana(dias[0], dias[dias.length - 1]) : `Semana ${i + 1}`}</span>
                      <span className="mono shrink-0">M {s.moto} · A {s.auto} · C {s.camion}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px dashed #2A2F3A' }}>
              <div className="text-xs uppercase tracking-wider mono mb-1" style={{ color: '#6B7280' }}>Datos de prueba</div>
              <div className="text-xs mb-3" style={{ color: '#8B8F98' }}>
                Genera 3 meses de historial y lo escribe en toda la app: parámetros, plan semanal,
                ausencias y las cargas diarias de Almacén y los 6 operarios (respetando al comodín
                Miguel). Al volver a la pestaña "Carga diaria" ya vas a ver ese historial ahí también.
                Sobrescribe el plan y las ausencias actuales.
              </div>
              <button
                onClick={generarHistorico3Meses}
                disabled={generando}
                className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{ background: hexConAlpha('#94A3B8', 0.15), color: '#B7BAC2' }}
              >
                {generando ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {generando ? `Generando… ${progresoGeneracion}%` : 'Generar histórico de 3 meses'}
              </button>
            </div>
          </div>
        )}

        {/* ESTIMACIONES SEMANALES */}
        {tab === 'semanal' && (
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <label className="block text-xs uppercase tracking-wider mono mb-1.5" style={{ color: '#6B7280' }}>
                Fecha de inicio del plan
              </label>
              <input
                type="date"
                value={plan.fechaInicio}
                onChange={(e) => setPlan((p) => ({ ...p, fechaInicio: e.target.value }))}
                className="rounded-lg px-3 py-2 text-sm mono outline-none"
                style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
              />
            </div>

            {semanasQueExcedenCapacidad.length > 0 && (
              <div
                className="rounded-xl p-4 text-sm"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#FCA5A5' }}
              >
                <div className="font-medium mb-1">⚠ Demanda por encima de la capacidad del equipo</div>
                <div className="text-xs" style={{ color: '#FCA5A5' }}>
                  El equipo completo (6 personas) puede instalar ~{Math.round(capacidadSemanalEquipo)} cajas por semana
                  entre los 3 tipos. {semanasQueExcedenCapacidad.length === 1 ? 'Una semana carga' : `${semanasQueExcedenCapacidad.length} semanas cargan`} más
                  de 1,5x eso. En ese caso el buffer óptimo no va a "resolver" el faltante — es un problema de capacidad
                  (necesitás más gente u horas), no de cuánto stock mantener. Revisá si el número cargado es correcto.
                </div>
              </div>
            )}

            <button
              onClick={guardarPlan}
              disabled={guardando || recalculando}
              className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
              style={{ background: '#F2B705', color: '#0F1116' }}
            >
              {recalculando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {recalculando ? 'Recalculando (simulación Montecarlo)…' : guardando ? 'Guardando…' : 'Guardar estimaciones'}
            </button>

            <button
              onClick={() => setPlan((p) => ({ ...p, semanas: [...p.semanas, { moto: 0, auto: 0, camion: 0 }] }))}
              className="w-full py-2 rounded-lg text-sm flex items-center justify-center gap-1.5"
              style={{ background: '#1B1F27', border: '1px dashed #2A2F3A', color: '#8B8F98' }}
            >
              <Plus size={14} /> Agregar semana siguiente
            </button>

            {plan.semanas.map((s, i) => ({ s, i })).slice().reverse().map(({ s, i }) => {
              const dias = semanasFechasPlan[i];
              return (
              <div key={i} className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium">{dias ? formatRangoSemana(dias[0], dias[dias.length - 1]) : `Semana ${i + 1}`}</div>
                  {plan.semanas.length > 1 && (
                    <button
                      onClick={() => setPlan((p) => ({ ...p, semanas: p.semanas.filter((_, idx) => idx !== i) }))}
                      className="p-1 rounded active:opacity-60"
                    >
                      <Trash2 size={14} color="#6B7280" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {TIPOS.map((t) => (
                    <div key={t}>
                      <label className="block text-xs mb-1 mono" style={{ color: '#8B8F98' }}>{TIPO_LABEL[t]}</label>
                      <input
                        type="number" min="0" inputMode="numeric"
                        value={s[t]}
                        onChange={(e) => {
                          const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                          setPlan((p) => ({
                            ...p,
                            semanas: p.semanas.map((sem, idx) => idx === i ? { ...sem, [t]: v } : sem),
                          }));
                        }}
                        className="w-full rounded-lg px-2 py-2 text-center mono outline-none"
                        style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              );
            })}

            <button
              onClick={() => setPlan((p) => ({
                ...p,
                fechaInicio: fechaInicioSemanaAnterior(p.fechaInicio, config.diasHabilesPorSemana),
                semanas: [{ moto: 0, auto: 0, camion: 0 }, ...p.semanas],
              }))}
              className="w-full py-2 rounded-lg text-sm flex items-center justify-center gap-1.5"
              style={{ background: '#1B1F27', border: '1px dashed #2A2F3A', color: '#8B8F98' }}
            >
              <Plus size={14} /> Agregar semana anterior
            </button>

            <button
              onClick={guardarPlan}
              disabled={guardando || recalculando}
              className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
              style={{ background: '#F2B705', color: '#0F1116' }}
            >
              {recalculando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {recalculando ? 'Recalculando (simulación Montecarlo)…' : guardando ? 'Guardando…' : 'Guardar estimaciones'}
            </button>
          </div>
        )}

        {/* AUSENCIAS */}
        {tab === 'ausencias' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <button onClick={() => setFechaAusencia((f) => sumarDias(f, -1))} className="p-1.5 rounded-lg active:opacity-60">
                <ChevronLeft size={18} color="#C9CDD6" />
              </button>
              <div className="text-sm mono">{fechaAusenciaKey}</div>
              <button onClick={() => setFechaAusencia((f) => sumarDias(f, 1))} className="p-1.5 rounded-lg active:opacity-60">
                <ChevronRight size={18} color="#C9CDD6" />
              </button>
            </div>

            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <div className="text-xs uppercase tracking-wider mono mb-3" style={{ color: '#6B7280' }}>Marcar ausentes ese día</div>
              <div className="flex flex-wrap gap-2">
                {OPERARIOS.map((op) => {
                  const ausente = ausentesDia.includes(op);
                  const esComodin = op === COMODIN;
                  return (
                    <button
                      key={op}
                      onClick={() => toggleAusente(op)}
                      className="px-3 py-1.5 rounded-full text-sm font-medium"
                      style={{
                        background: ausente ? hexConAlpha('#EF4444', 0.18) : hexConAlpha(COLORES[op], 0.12),
                        color: ausente ? '#F87171' : COLORES[op],
                        textDecoration: ausente ? 'line-through' : 'none',
                      }}
                    >
                      {op}{esComodin ? ' (comodín)' : ''}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs mt-3" style={{ color: '#6B7280' }}>
                {ausentesDia.length === 0 ? 'Nadie marcado como ausente este día.' : `${ausentesDia.length} ausente(s): ${ausentesDia.join(', ')}.`}
              </div>
            </div>
            <div className="text-xs px-1" style={{ color: '#6B7280' }}>
              Miguel es el comodín: solo se suma al equipo del día si lo que falta para llegar al buffer supera lo que dan los 5 operarios base disponibles, y él mismo no está ausente.
            </div>
          </div>
        )}

        {/* DASHBOARDS */}
        {tab === 'dashboards' && (
          <div className="space-y-4">
            <button
              onClick={cargarDashboards}
              disabled={cargandoDashboards}
              className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: hexConAlpha('#F2B705', 0.15), color: '#F2B705' }}
            >
              {cargandoDashboards ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
              {cargandoDashboards ? 'Calculando…' : 'Calcular efectividad (real vs. estimado)'}
            </button>

            {semanasFechas.length === 0 && (
              <div className="text-sm text-center py-6" style={{ color: '#6B7280' }}>
                Presioná el botón para traer los datos cargados y compararlos contra lo que el modelo le pidió a cada uno.
              </div>
            )}

            {OPERARIOS.map((op) => {
              const data = datosDashboard[op];
              if (!data) return null;
              return (
                <div key={op} className="rounded-xl p-4" style={{ background: '#1B1F27', border: `1px solid ${hexConAlpha(COLORES[op], 0.3)}` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORES[op] }} />
                    <span className="text-sm font-medium" style={{ color: COLORES[op] }}>{op}{op === COMODIN ? ' · comodín' : ''}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 14 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262B35" vertical={false} />
                      <XAxis
                        dataKey="semana"
                        tick={{ fill: '#8B8F98', fontSize: 9 }}
                        axisLine={{ stroke: '#262B35' }}
                        tickLine={false}
                        angle={-30}
                        textAnchor="end"
                        height={30}
                      />
                      <YAxis tick={{ fill: '#8B8F98', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#12151A', border: '1px solid #2A2F3A', borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.rangoCompleto || ''}
                      />
                      <Bar dataKey="Estimado" fill={hexConAlpha(COLORES[op], 0.35)} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Real" fill={COLORES[op]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {data.map((d, i) => (
                      <span key={i} className="text-xs mono" style={{ color: d.efectividad === null ? '#6B7280' : d.efectividad >= 90 ? '#86EFAC' : d.efectividad >= 70 ? '#FCD34D' : '#F87171' }}>
                        {d.rangoCompleto}: {d.efectividad === null ? '—' : `${d.efectividad}%`}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CONFIGURACION */}
        {tab === 'config' && (
          <div className="space-y-4">
            {[
              {
                titulo: 'Capacidad e instalación',
                campos: [
                  ['minutosInstalacionPorCaja', 'Min. instalación / caja'],
                  ['horasViajeIda', 'Horas viaje ida a depósito'],
                  ['horasViajeVuelta', 'Horas viaje vuelta'],
                  ['minutosDescansoPorDia', 'Min. descanso / día'],
                  ['horasJornada', 'Horas de jornada'],
                  ['cajasPorLote', 'Cajas por lote (carton)'],
                  ['diasHabilesPorSemana', 'Días hábiles / semana'],
                ],
              },
              {
                titulo: 'Costos',
                campos: [
                  ['costoHoraTecnico', 'Costo hora técnico (ARS)'],
                  ['tiempoReflasheoMin', 'Min. reflasheo / caja'],
                  ['costoVueloPromedio', 'Costo promedio de viaje (ARS)'],
                  ['cajasPromedioPorViaje', 'Cajas cubiertas por viaje'],
                  ['probStockoutRequiereVuelo', 'Prob. stockout requiere vuelo (0-1)'],
                  ['multiplicadorRiesgoExclusividad', 'Multiplicador riesgo exclusividad'],
                ],
              },
              {
                titulo: 'Riesgo y variabilidad',
                campos: [
                  ['probPedidoUrgente', 'Prob. pedido urgente / día (0-1)'],
                  ['desvioRelativoDemanda', 'Variabilidad diaria demanda (0-1)'],
                ],
              },
            ].map((grupo) => (
              <div key={grupo.titulo} className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
                <div className="text-xs uppercase tracking-wider mono mb-3" style={{ color: '#6B7280' }}>{grupo.titulo}</div>
                <div className="space-y-2.5">
                  {grupo.campos.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <label className="text-sm" style={{ color: '#B7BAC2' }}>{label}</label>
                      <input
                        type="number" step="any"
                        value={config[key]}
                        onChange={(e) => setConfig((c) => ({ ...c, [key]: parseFloat(e.target.value) || 0 }))}
                        className="w-24 rounded-lg px-2 py-1.5 text-sm mono text-right outline-none"
                        style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <div className="text-xs uppercase tracking-wider mono mb-3" style={{ color: '#6B7280' }}>Prob. de release de firmware / día (por tipo)</div>
              <div className="grid grid-cols-3 gap-3">
                {TIPOS.map((t) => (
                  <div key={t}>
                    <label className="block text-xs mb-1 mono" style={{ color: '#8B8F98' }}>{TIPO_LABEL[t]}</label>
                    <input
                      type="number" step="any"
                      value={config.probReleaseDiaria[t]}
                      onChange={(e) => setConfig((c) => ({ ...c, probReleaseDiaria: { ...c.probReleaseDiaria, [t]: parseFloat(e.target.value) || 0 } }))}
                      className="w-full rounded-lg px-2 py-1.5 text-sm mono text-center outline-none"
                      style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
              <div className="text-xs uppercase tracking-wider mono mb-3" style={{ color: '#6B7280' }}>Tamaño de pedido urgente (min–max, por tipo)</div>
              <div className="grid grid-cols-3 gap-3">
                {TIPOS.map((t) => (
                  <div key={t}>
                    <label className="block text-xs mb-1 mono" style={{ color: '#8B8F98' }}>{TIPO_LABEL[t]}</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={config.tamanioPedidoUrgente[t][0]}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10) || 0;
                          setConfig((c) => ({ ...c, tamanioPedidoUrgente: { ...c.tamanioPedidoUrgente, [t]: [v, c.tamanioPedidoUrgente[t][1]] } }));
                        }}
                        className="w-1/2 rounded-lg px-1 py-1.5 text-xs mono text-center outline-none"
                        style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
                      />
                      <input
                        type="number"
                        value={config.tamanioPedidoUrgente[t][1]}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10) || 0;
                          setConfig((c) => ({ ...c, tamanioPedidoUrgente: { ...c.tamanioPedidoUrgente, [t]: [c.tamanioPedidoUrgente[t][0], v] } }));
                        }}
                        className="w-1/2 rounded-lg px-1 py-1.5 text-xs mono text-center outline-none"
                        style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={guardarConfig}
              disabled={guardando}
              className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
              style={{ background: '#F2B705', color: '#0F1116' }}
            >
              <Save size={16} /> {guardando ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
