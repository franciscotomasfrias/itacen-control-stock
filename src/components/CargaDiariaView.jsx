import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Save, Check, Radio } from 'lucide-react';
import {
  PERSONAS, OPERARIOS, BASE_OPERARIOS, COMODIN, TIPOS, TIPO_LABEL, COLORES,
  DEFAULT_CONFIG, DEFAULT_PLAN_OPERARIO,
  formatFecha, formatFechaLegible, esDiaHabil, sumarDias, hexConAlpha,
  calcularPlanDelDia,
} from '../lib/logic';
import { getConfig, getPlan, getBuffer, getAusencias, getCargas, upsertCarga } from '../lib/db';

export default function CargaDiariaView() {
  const [fecha, setFecha] = useState(new Date());
  const [persona, setPersona] = useState('Almacén');
  const [form, setForm] = useState({ moto: '', auto: '', camion: '' });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [planSemanal, setPlanSemanal] = useState(DEFAULT_PLAN_OPERARIO);
  const [fechaInicioPlan, setFechaInicioPlan] = useState(null);
  const [bufferObjetivo, setBufferObjetivo] = useState({ moto: 0, auto: 0, camion: 0 });
  const [ausenciasPorFecha, setAusenciasPorFecha] = useState({});
  const [cargasPorFecha, setCargasPorFecha] = useState({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [error, setError] = useState(null);
  const [calculandoEstimacion, setCalculandoEstimacion] = useState(false);

  const fechaKey = formatFecha(fecha);

  const cargarTodo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, p, b, a, cg] = await Promise.all([
        getConfig().catch(() => null),
        getPlan().catch(() => null),
        getBuffer().catch(() => null),
        getAusencias().catch(() => null),
        getCargas().catch(() => null),
      ]);
      if (c) setConfig(c);
      if (p) {
        setPlanSemanal(p.semanas || DEFAULT_PLAN_OPERARIO);
        setFechaInicioPlan(p.fechaInicio ? new Date(p.fechaInicio + 'T00:00:00') : null);
      }
      if (b) setBufferObjetivo(b);
      if (a) setAusenciasPorFecha(a);
      if (cg) setCargasPorFecha(cg);
    } catch (e) {
      setError('No se pudo conectar con la base de datos. Probá actualizar de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  useEffect(() => {
    const datosDelDia = cargasPorFecha[fechaKey];
    const propios = datosDelDia && datosDelDia[persona];
    setForm(
      propios
        ? { moto: String(propios.moto ?? ''), auto: String(propios.auto ?? ''), camion: String(propios.camion ?? '') }
        : { moto: '', auto: '', camion: '' }
    );
    setGuardadoOk(false);
  }, [fecha, persona, cargasPorFecha, fechaKey]);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const valores = {
        moto: Math.max(0, parseInt(form.moto, 10) || 0),
        auto: Math.max(0, parseInt(form.auto, 10) || 0),
        camion: Math.max(0, parseInt(form.camion, 10) || 0),
      };
      await upsertCarga(fechaKey, persona, valores);
      setCargasPorFecha((prev) => ({
        ...prev,
        [fechaKey]: { ...(prev[fechaKey] || {}), [persona]: valores },
      }));
      setGuardadoOk(true);
    } catch (e) {
      setError('No se pudo guardar. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const planDelDia = calcularPlanDelDia({
    fecha,
    cargasPorFecha,
    bufferObjetivo,
    config,
    ausenciasPorFecha,
  });

  const proximoDiaHabil = (() => {
    let d = sumarDias(new Date(), 1);
    while (!esDiaHabil(d)) d = sumarDias(d, 1);
    return d;
  })();
  const proximoDiaHabilKey = formatFecha(proximoDiaHabil);
  const planProximoDiaHabil = calcularPlanDelDia({
    fecha: proximoDiaHabil,
    cargasPorFecha,
    bufferObjetivo,
    config,
    ausenciasPorFecha,
  });
  const cargaProximoDiaHabil = cargasPorFecha[proximoDiaHabilKey] || {};

  const datosDelDia = cargasPorFecha[fechaKey] || {};
  const hoy = formatFecha(new Date());
  const esFuturo = fechaKey > hoy;
  const ausentesHoy = ausenciasPorFecha[fechaKey] || [];

  return (
    <div
      className="w-full min-h-screen"
      style={{ background: '#12151A', color: '#E7E5E0', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        .disp { font-family: 'Space Grotesk', sans-serif; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
      `}</style>

      <div className="max-w-md mx-auto px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: '#F2B705' }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#F2B705' }} />
          </span>
          <span className="text-xs tracking-widest uppercase mono" style={{ color: '#8B8F98' }}>Itacen · Flota YPF</span>
        </div>
        <h1 className="disp text-2xl sm:text-3xl font-bold mb-6" style={{ letterSpacing: '-0.01em' }}>
          Carga diaria de stock
        </h1>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5' }}>
            {error}
          </div>
        )}

        {/* Estimación automática del próximo día hábil, siempre visible */}
        <div
          className="rounded-xl p-4 mb-5"
          style={{ background: '#1B1F27', border: `1px solid ${hexConAlpha('#F2B705', 0.3)}` }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wider mono" style={{ color: '#F2B705' }}>
              Estimación · próximo día hábil
            </div>
            <button
              onClick={() => setFecha(proximoDiaHabil)}
              className="text-xs mono underline"
              style={{ color: '#8B8F98' }}
            >
              ver día
            </button>
          </div>
          <div className="text-sm mb-3" style={{ color: '#C9CDD6' }}>
            {formatFechaLegible(proximoDiaHabil)}
            {planProximoDiaHabil.comodinActivo && (
              <span className="text-xs mono ml-2" style={{ color: hexConAlpha(COLORES[COMODIN], 0.9) }}>· Miguel (comodín) va a hacer falta</span>
            )}
          </div>
          {!planProximoDiaHabil.tieneBase ? (
            <div className="text-xs" style={{ color: '#6B7280' }}>
              Todavía no hay suficiente historial cargado para estimar este día.
            </div>
          ) : (
            <div className="space-y-1.5">
              {planProximoDiaHabil.presentes.map((op) => {
                const real = cargaProximoDiaHabil[op];
                const est = planProximoDiaHabil.reparto[op];
                const valores = real || est;
                const color = COLORES[op];
                return (
                  <div key={op} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span style={{ color: real ? '#E7E5E0' : hexConAlpha(color, 0.75) }}>{op}</span>
                    </span>
                    <span className="flex gap-3 mono" style={{ color: real ? color : hexConAlpha(color, 0.55) }}>
                      {TIPOS.map((t) => (
                        <span key={t} title={TIPO_LABEL[t]} style={{ minWidth: 24, textAlign: 'right', display: 'inline-block' }}>
                          {valores[t]}
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
              {planProximoDiaHabil.presentes.length === 0 && (
                <div className="text-xs" style={{ color: '#6B7280' }}>Sin faltantes para ese día — no hace falta instalar nada.</div>
              )}
            </div>
          )}
          <button
            onClick={async () => { setCalculandoEstimacion(true); await cargarTodo(); setCalculandoEstimacion(false); }}
            disabled={calculandoEstimacion}
            className="mt-3 w-full py-2 rounded-lg text-xs font-medium mono flex items-center justify-center gap-2"
            style={{ background: hexConAlpha('#F2B705', 0.15), color: '#F2B705' }}
          >
            <RefreshCw size={13} className={calculandoEstimacion ? 'animate-spin' : ''} />
            {calculandoEstimacion ? 'Calculando…' : 'Calcular estimación'}
          </button>
        </div>

        {/* Navegador de fecha */}
        <div className="flex items-center justify-between rounded-xl px-3 py-2.5 mb-5" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
          <button onClick={() => setFecha((f) => sumarDias(f, -1))} className="p-1.5 rounded-lg active:opacity-60" aria-label="Día anterior">
            <ChevronLeft size={18} color="#C9CDD6" />
          </button>
          <div className="text-center">
            <div className="text-sm font-medium">{formatFechaLegible(fecha)}</div>
            <div className="text-xs mono" style={{ color: '#6B7280' }}>{fechaKey}{fechaKey === hoy ? ' · hoy' : ''}</div>
          </div>
          <button onClick={() => setFecha((f) => sumarDias(f, 1))} className="p-1.5 rounded-lg active:opacity-60" aria-label="Día siguiente">
            <ChevronRight size={18} color="#C9CDD6" />
          </button>
        </div>

        {/* Selector de persona */}
        <div className="mb-2 text-xs uppercase tracking-wider mono" style={{ color: '#6B7280' }}>Quién carga</div>
        <div className="flex flex-wrap gap-2 mb-5">
          {PERSONAS.map((p) => {
            const activo = p === persona;
            const ausente = ausentesHoy.includes(p);
            const esComodin = p === COMODIN;
            const comodinActivoHoy = esComodin && planDelDia.comodinActivo;
            return (
              <button
                key={p}
                onClick={() => setPersona(p)}
                className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
                style={{
                  background: activo ? COLORES[p] : hexConAlpha(COLORES[p], 0.12),
                  color: activo ? '#0F1116' : COLORES[p],
                  opacity: ausente ? 0.45 : 1,
                }}
              >
                {p}
                {esComodin ? (comodinActivoHoy ? ' · comodín (activo hoy)' : ' · comodín') : ''}
                {ausente ? ' · ausente' : ''}
              </button>
            );
          })}
        </div>

        {/* Formulario */}
        <div className="rounded-xl p-4 mb-6" style={{ background: '#1B1F27', border: `1px solid ${hexConAlpha(COLORES[persona], 0.35)}` }}>
          <div className="text-sm font-medium mb-3" style={{ color: COLORES[persona] }}>
            Stock de {persona} — {fechaKey}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {TIPOS.map((t) => (
              <div key={t}>
                <label className="block text-xs mb-1 mono" style={{ color: '#8B8F98' }}>{TIPO_LABEL[t]}</label>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form[t]}
                  onChange={(e) => setForm((f) => ({ ...f, [t]: e.target.value }))}
                  className="w-full rounded-lg px-2 py-2 text-lg mono text-center outline-none"
                  style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
          <button
            onClick={guardar}
            disabled={guardando}
            className="mt-4 w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50"
            style={{ background: guardadoOk ? '#22C55E' : '#F2B705', color: '#0F1116' }}
          >
            {guardadoOk ? <Check size={16} /> : <Save size={16} />}
            {guardando ? 'Guardando…' : guardadoOk ? 'Guardado' : 'Guardar carga'}
          </button>
        </div>

        {/* Resumen del día */}
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider mono" style={{ color: '#6B7280' }}>Resumen del día</div>
          <button onClick={cargarTodo} className="p-1.5 rounded-lg active:opacity-60" aria-label="Actualizar">
            <RefreshCw size={14} color="#6B7280" className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="space-y-2 mb-6">
          {PERSONAS.map((p) => {
            const real = datosDelDia[p];
            const esOperario = p !== 'Almacén';
            const estimado = esOperario && esFuturo ? planDelDia.reparto[p] : null;
            const usaEstimado = !real && estimado;
            const valores = real || estimado || { moto: 0, auto: 0, camion: 0 };
            const color = COLORES[p];

            if (!real && !estimado && (p === 'Almacén' || p === COMODIN)) return null;

            return (
              <div
                key={p}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: '#171B22' }}
              >
                <div className="flex items-center gap-2 min-w-[92px]">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-sm truncate" style={{ color: usaEstimado ? hexConAlpha(color, 0.7) : '#E7E5E0' }}>{p}</span>
                </div>
                <div className="flex gap-3 mono text-sm">
                  {TIPOS.map((t) => (
                    <span
                      key={t}
                      title={TIPO_LABEL[t]}
                      style={{ color: usaEstimado ? hexConAlpha(color, 0.55) : color, minWidth: 26, textAlign: 'right', display: 'inline-block' }}
                    >
                      {valores[t]}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {!planDelDia.tieneBase && (
            <div className="text-xs px-1" style={{ color: '#6B7280' }}>
              Todavía no hay suficiente historial para calcular una estimación de este día.
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs px-1" style={{ color: '#6B7280' }}>
          <Radio size={12} />
          <span>Números en color claro = estimación del modelo. Se vuelven color sólido cuando la persona carga el dato real.</span>
        </div>
      </div>
    </div>
  );
}


