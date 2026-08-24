-- Correr esto una vez en Supabase: Dashboard > SQL Editor > New query > pegar y Run.

-- Config, plan semanal, ausencias y buffer objetivo: 4 "documentos" clave-valor,
-- igual que antes en window.storage.
create table if not exists app_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Stock cargado por dia y por persona. Una fila por (fecha, persona) en vez de
-- un blob unico -- asi dos personas cargando el mismo dia no se pisan entre si.
create table if not exists cargas (
  fecha date not null,
  persona text not null,
  moto integer not null default 0,
  auto integer not null default 0,
  camion integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (fecha, persona)
);

alter table app_kv enable row level security;
alter table cargas enable row level security;

-- Politica simple para un equipo chico y de confianza: cualquier usuario logueado
-- (con cuenta creada por vos en Authentication > Users) puede leer y escribir todo.
-- Si mas adelante queres restringir (por ejemplo, que un operario no pueda tocar
-- la configuracion), se puede refinar con un rol en una tabla "profiles".
create policy "usuarios logueados leen app_kv" on app_kv for select using (auth.role() = 'authenticated');
create policy "usuarios logueados escriben app_kv" on app_kv for insert with check (auth.role() = 'authenticated');
create policy "usuarios logueados actualizan app_kv" on app_kv for update using (auth.role() = 'authenticated');

create policy "usuarios logueados leen cargas" on cargas for select using (auth.role() = 'authenticated');
create policy "usuarios logueados escriben cargas" on cargas for insert with check (auth.role() = 'authenticated');
create policy "usuarios logueados actualizan cargas" on cargas for update using (auth.role() = 'authenticated');
