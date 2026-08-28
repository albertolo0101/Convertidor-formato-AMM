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

insert into public.trabajadores (codigo, nombre) values
  ('2934', 'Winston Pinto'),
  ('9563', 'David Vargas')
on conflict (codigo) do update set nombre = excluded.nombre;

insert into public.admins (email) values
  ('alberto@energygravitas.com'),
  ('albertolopez2199@gmail.com')
on conflict (email) do nothing;


-- ----------------------------------------------------------------------------
-- 6. Verificacion — deberia devolver: 2 trabajadores, 2 admins, bucket privado
-- ----------------------------------------------------------------------------

select
  (select count(*) from public.trabajadores)                        as trabajadores,
  (select count(*) from public.admins)                              as admins,
  (select count(*) from public.asistencia)                          as marcas,
  (select public from storage.buckets where id = 'fotos')           as bucket_publico,
  (select count(*) from pg_policies
     where schemaname = 'public'
       and tablename in ('trabajadores','asistencia','admins','intentos_fallidos'))
                                                                    as politicas_rls;
