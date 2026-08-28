-- ============================================================================
-- Gravitas Mantenimiento — instalacion completa del backend de asistencia
--
-- Pegar ENTERO en el SQL Editor de Supabase y ejecutar una sola vez sobre un
-- proyecto nuevo y vacio.
--
-- Es idempotente: volver a correrlo no rompe nada ni duplica datos.
--
-- REGLA CENTRAL: la clave publicable viaja en el HTML, es publica por diseño.
-- Por eso 'anon' no puede leer ni escribir NINGUNA tabla. La unica puerta del
-- kiosko es la Edge Function 'marcar', que corre con service_role.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tablas
-- ----------------------------------------------------------------------------

create table if not exists public.trabajadores (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique check (codigo ~ '^[0-9]{4}$'),
  nombre    text not null,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.asistencia (
  id            uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.trabajadores(id) on delete restrict,
  accion        text not null check (accion in ('entrada','salida')),
  marcado_en    timestamptz not null default now(),
  -- ruta en el bucket privado 'fotos'; null si no hubo camara o si ya se purgo
  foto_path     text,
  foto_purgada  boolean not null default false,
  creado_en     timestamptz not null default now()
);

create index if not exists asistencia_marcado_en_idx
  on public.asistencia (marcado_en desc);
create index if not exists asistencia_trabajador_idx
  on public.asistencia (trabajador_id, marcado_en desc);

create table if not exists public.admins (
  email     text primary key,
  creado_en timestamptz not null default now()
);

-- Freno de fuerza bruta: un codigo de 4 digitos son solo 10 000 combinaciones
create table if not exists public.intentos_fallidos (
  id               bigserial primary key,
  ip               text,
  codigo_intentado text,
  intentado_en     timestamptz not null default now()
);

create index if not exists intentos_fallidos_ip_idx
  on public.intentos_fallidos (ip, intentado_en desc);


-- ----------------------------------------------------------------------------
-- 2. Comprobacion de administrador
--
-- Va en el esquema 'private', NO en 'public': en public quedaria publicada como
-- endpoint /rest/v1/rpc/es_admin y el linter de seguridad lo marca.
-- SECURITY DEFINER evita la recursion infinita en la politica de 'admins'.
-- ----------------------------------------------------------------------------

create schema if not exists private;

create or replace function private.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.trabajadores      enable row level security;
alter table public.asistencia        enable row level security;
alter table public.admins            enable row level security;
alter table public.intentos_fallidos enable row level security;

drop policy if exists "admins gestionan trabajadores" on public.trabajadores;
drop policy if exists "admins gestionan asistencia"   on public.asistencia;
drop policy if exists "admins leen admins"            on public.admins;
drop policy if exists "admins leen intentos"          on public.intentos_fallidos;

-- Sin politicas para 'anon' => anon no ve absolutamente nada
create policy "admins gestionan trabajadores" on public.trabajadores
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

create policy "admins gestionan asistencia" on public.asistencia
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

create policy "admins leen admins" on public.admins
  for select to authenticated using (private.es_admin());

create policy "admins leen intentos" on public.intentos_fallidos
  for select to authenticated using (private.es_admin());

-- Defensa en profundidad: ademas de la RLS, quitarle privilegios a anon
revoke all on public.trabajadores      from anon;
revoke all on public.asistencia        from anon;
revoke all on public.admins            from anon;
revoke all on public.intentos_fallidos from anon;

revoke all on schema private from anon, public;
grant usage on schema private to authenticated;
revoke all on function private.es_admin() from anon, public;
grant execute on function private.es_admin() to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Almacenamiento de fotos — bucket PRIVADO
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- Sin esta politica ni un administrador autenticado podria generar la URL
-- firmada para ver una foto. Es la unica lectura de imagenes que existe.
drop policy if exists "admins leen fotos" on storage.objects;
create policy "admins leen fotos" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and private.es_admin());


-- ----------------------------------------------------------------------------
-- 5. Datos iniciales
--
-- Los codigos son la credencial del trabajador. Se eligieron no obvios a
-- proposito: el endpoint es descubrible desde el HTML publicado, y un '1234'
-- se acierta antes de que el freno de intentos alcance a actuar.
-- ----------------------------------------------------------------------------

-- ESTE REPOSITORIO ES PUBLICO. No pongas aca los codigos reales ni los correos
-- reales: reemplazalos al ejecutar y no los vuelvas a guardar en el archivo.
-- Los codigos son la credencial del trabajador y el endpoint es descubrible
-- desde el HTML publicado.

insert into public.trabajadores (codigo, nombre) values
  ('0000', 'CAMBIAR - Trabajador Uno'),
  ('0001', 'CAMBIAR - Trabajador Dos')
on conflict (codigo) do update set nombre = excluded.nombre;

insert into public.admins (email) values
  ('cambiar@ejemplo.com')
on conflict (email) do nothing;




-- ============================================================================
-- MODULOS ADICIONALES — insumos, registro de actividad y visitas
--
-- Se agregan aparte del bloque de asistencia. Todo sigue la misma regla: 'anon'
-- no toca ninguna tabla; el kiosko escribe a traves de Edge Functions.
--
-- Las tres tablas llevan 'trabajador_id' NULLABLE. Hoy el kiosko guarda estos
-- registros de forma anonima (decision del usuario: un toque menos por
-- operacion). La columna existe para que agregar autoria mas adelante sea un
-- cambio de interfaz y no una migracion sobre datos en vivo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Solicitudes de insumos
-- ----------------------------------------------------------------------------

create table if not exists public.solicitudes_insumos (
  id            uuid primary key default gen_random_uuid(),
  creado_en     timestamptz not null default now(),
  trabajador_id uuid references public.trabajadores(id) on delete set null,
  -- [{ "descripcion": "guantes", "cantidad": "2 pares" }, ...]
  items         jsonb not null,
  notas         text,
  estado        text not null default 'pendiente'
                  check (estado in ('pendiente','atendida')),
  atendida_en   timestamptz,
  atendida_por  text,
  constraint items_no_vacio check (jsonb_array_length(items) > 0)
);

create index if not exists solicitudes_insumos_creado_idx
  on public.solicitudes_insumos (creado_en desc);
create index if not exists solicitudes_insumos_estado_idx
  on public.solicitudes_insumos (estado, creado_en desc);


-- ----------------------------------------------------------------------------
-- Registro de actividad
--
-- Dos formas excluyentes:
--   tipo='sectores' -> trabajo sobre paneles: actividad + sectores del mapa
--   tipo='especial' -> inversores / rondas antifuego / subestacion / otros
--
-- Las especiales EXIGEN notas y levantan una bandera que solo el administrador
-- puede bajar. Las restricciones lo garantizan en la base, no solo en la UI:
-- si algun dia otro cliente escribe aca, no puede colar un registro incompleto.
-- ----------------------------------------------------------------------------

create table if not exists public.registros_actividad (
  id            uuid primary key default gen_random_uuid(),
  creado_en     timestamptz not null default now(),
  trabajador_id uuid references public.trabajadores(id) on delete set null,

  tipo          text not null check (tipo in ('sectores','especial')),

  actividad     text check (actividad in ('fumigacion','poda','lavado')),
  sectores      text[],

  categorias    text[],

  notas         text,

  requiere_revision boolean not null default false,
  revisado_en   timestamptz,
  revisado_por  text,

  constraint sectores_completos check (
    tipo <> 'sectores'
    or (actividad is not null and coalesce(array_length(sectores, 1), 0) >= 1)
  ),

  -- Notas obligatorias en las especiales: son las que hay que revisar, y una
  -- bandera sin explicacion no sirve de nada.
  constraint especial_completo check (
    tipo <> 'especial'
    or (coalesce(array_length(categorias, 1), 0) >= 1
        and notas is not null and btrim(notas) <> '')
  ),

  constraint categorias_validas check (
    categorias is null
    or categorias <@ array['inversores','rondas_antifuego','subestacion','otros']
  )
);

create index if not exists registros_actividad_creado_idx
  on public.registros_actividad (creado_en desc);
-- Indice parcial: el panel consulta sobre todo las banderas sin revisar
create index if not exists registros_actividad_revision_idx
  on public.registros_actividad (creado_en desc) where requiere_revision;


-- ----------------------------------------------------------------------------
-- Visitas — solo registro de llegada, sin marcar salida
-- ----------------------------------------------------------------------------

create table if not exists public.visitas (
  id             uuid primary key default gen_random_uuid(),
  creado_en      timestamptz not null default now(),
  nombre         text not null check (btrim(nombre) <> ''),
  -- Documento de identidad. Nullable en la tabla para no romper instalaciones
  -- previas; la obligatoriedad la impone la Edge Function, que es la unica via
  -- de escritura.
  identificacion text,
  empresa        text,
  motivo         text
);

-- Para instalaciones que ya existian antes de que se pidiera el documento
alter table public.visitas add column if not exists identificacion text;

create index if not exists visitas_creado_idx
  on public.visitas (creado_en desc);


-- ----------------------------------------------------------------------------
-- RLS de los modulos nuevos — mismas reglas que asistencia
-- ----------------------------------------------------------------------------

alter table public.solicitudes_insumos  enable row level security;
alter table public.registros_actividad  enable row level security;
alter table public.visitas              enable row level security;

drop policy if exists "admins gestionan insumos"    on public.solicitudes_insumos;
drop policy if exists "admins gestionan actividad"  on public.registros_actividad;
drop policy if exists "admins gestionan visitas"    on public.visitas;

create policy "admins gestionan insumos" on public.solicitudes_insumos
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

create policy "admins gestionan actividad" on public.registros_actividad
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

create policy "admins gestionan visitas" on public.visitas
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

revoke all on public.solicitudes_insumos from anon;
revoke all on public.registros_actividad from anon;
revoke all on public.visitas             from anon;


-- ============================================================================
-- VERIFICACION FINAL
--
-- Sobre una instalacion limpia deberia devolver:
--   trabajadores 2 · admins 2 · bucket_publico false · politicas_rls 7
--   tablas_creadas 7
-- ============================================================================

select
  (select count(*) from public.trabajadores)                   as trabajadores,
  (select count(*) from public.admins)                         as admins,
  (select count(*) from public.asistencia)                     as marcas,
  (select public from storage.buckets where id = 'fotos')      as bucket_publico,
  (select count(*) from pg_policies where schemaname = 'public') as politicas_rls,
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('trabajadores','asistencia','admins','intentos_fallidos',
                          'solicitudes_insumos','registros_actividad','visitas'))
                                                               as tablas_creadas;
