// Capa de datos. Reemplaza los window.storage.get/set del artifact original.
// El resto de la app (logic.js, los componentes) no sabe que esto es Supabase --
// solo le importan estas funciones: get/set de 4 "documentos" (config, plan,
// ausencias, buffer) + las cargas diarias de stock.

import { supabase } from '../supabaseClient';

async function getKV(key) {
  const { data, error } = await supabase.from('app_kv').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

async function setKV(key, value) {
  const { error } = await supabase.from('app_kv').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export const getConfig = () => getKV('config');
export const setConfig = (value) => setKV('config', value);

export const getPlan = () => getKV('plan_semanal');
export const setPlan = (value) => setKV('plan_semanal', value);

export const getAusencias = () => getKV('ausencias');
export const setAusencias = (value) => setKV('ausencias', value);

export const getBuffer = () => getKV('buffer_objetivo');
export const setBuffer = (value) => setKV('buffer_objetivo', value);

// Cargas: una fila por (fecha, persona) en vez de un blob gigante -- cada persona
// escribe su propia fila, asi que dos personas cargando el mismo dia en simultaneo
// no se pisan entre si (a diferencia del storage de Claude, que era un blob unico).
export async function getCargas() {
  const { data, error } = await supabase.from('cargas').select('fecha, persona, moto, auto, camion');
  if (error) throw error;
  const porFecha = {};
  (data || []).forEach((fila) => {
    if (!porFecha[fila.fecha]) porFecha[fila.fecha] = {};
    porFecha[fila.fecha][fila.persona] = { moto: fila.moto, auto: fila.auto, camion: fila.camion };
  });
  return porFecha;
}

export async function upsertCarga(fecha, persona, valores) {
  const { error } = await supabase.from('cargas').upsert(
    { fecha, persona, moto: valores.moto, auto: valores.auto, camion: valores.camion, updated_at: new Date().toISOString() },
    { onConflict: 'fecha,persona' }
  );
  if (error) throw error;
}

// Para el generador de historico de prueba: manda todas las filas en una sola
// llamada en vez de una por dia (mas rapido, y Supabase no tiene el limite de
// requests que tenia el storage de Claude, pero de todas formas es mejor asi).
export async function upsertCargasBulk(filas) {
  if (filas.length === 0) return;
  const { error } = await supabase.from('cargas').upsert(filas, { onConflict: 'fecha,persona' });
  if (error) throw error;
}
