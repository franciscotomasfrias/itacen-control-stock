# Itacen · Control de stock flasheado

App interna para Almacén y los operarios (carga diaria de stock) y para gerencia
(estimaciones semanales, configuración, ausencias, efectividad, buffer objetivo).

## 1. Crear el proyecto en Supabase

1. Andá a [supabase.com](https://supabase.com), creá una cuenta y un proyecto nuevo (gratis).
2. En el dashboard del proyecto: **SQL Editor > New query**, pegá el contenido de
   `supabase/schema.sql` y apretá **Run**. Esto crea las tablas y los permisos.
3. **Project Settings > API**: copiá el "Project URL" y la "anon public key".

## 2. Crear los usuarios (Almacén + 6 operarios + vos)

1. **Authentication > Users > Add user** (uno por uno, o "Invite").
2. Creá un usuario por cada persona: Almacén, Alvaro, Juan, Ramiro, Pablo, Gustavo,
   Miguel, y uno para vos como gerente. Podés usar cualquier email (no hace falta
   que sea real si usás "Auto Confirm User" al crearlos) y una contraseña simple
   que después les pasás.
3. No hay roles distintos todavía — cualquier usuario logueado puede ver y tocar
   todo, incluida la Configuración. Si más adelante querés restringir eso, avisá.

## 3. Correr el proyecto en tu computadora

```bash
npm install
cp .env.example .env
# editar .env con la URL y la key que copiaste de Supabase
npm run dev
```

Abrí `http://localhost:5173`, entrá con uno de los usuarios que creaste, y probá
que cargar un dato y verlo reflejado funcione.

## 4. Subir a GitHub

```bash
git init
git add .
git commit -m "Primera version"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/itacen-control-stock.git
git push -u origin main
```

(Creá el repo vacío en GitHub antes del último paso, desde github.com/new)

## 5. Publicar en Vercel

1. Andá a [vercel.com](https://vercel.com), entrá con tu cuenta de GitHub.
2. **Add New > Project**, elegí el repo que acabás de subir.
3. En **Environment Variables**, agregá las mismas dos variables del `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. Vercel te da una URL (por ejemplo `itacen-control-stock.vercel.app`) —
   esa es la que le mandás a todo el equipo. Cada `git push` a `main` actualiza
   la URL sola, no hay que volver a hacer nada.

## Qué cambia respecto a la versión en Claude

- Ya no hace falta iniciar sesión en Claude — cada persona entra con su propio
  usuario de Supabase, directo desde tu dominio.
- El stock diario ahora es una fila por persona y día en la tabla `cargas`, en vez
  de un bloque de JSON gigante — más rápido y sin riesgo de que dos personas se
  pisen los datos entre sí.
- La lógica de negocio (simulación Montecarlo, cálculo de reparto diario) está en
  `src/lib/logic.js`, sin cambios respecto al artifact original — es JS puro, no
  depende de dónde vengan los datos.
