#!/usr/bin/env node
// Segundo revisor de PRs -- agente de tool-calling genérico contra OpenRouter.
// Reemplaza a anthropics/claude-code-action: sigue las mismas reglas
// (.github/review-protocol.md), pero habla con cualquier modelo que
// soporte tool-calling estilo OpenAI a través de OpenRouter (hoy:
// openai/gpt-5.3-codex, configurable con la env var MODEL).
//
// Principio de seguridad: nunca se pasa texto generado por el modelo a un
// shell. Cada herramienta arma su comando como un array de argumentos fijo
// (execFile, nunca exec/shell:true) -- el modelo no puede inyectar flags.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink, stat, mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

// ---------- Config ----------

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(`Faltan env vars: ${missing.join(', ')}`);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

// GH_TOKEN no se lee acá directamente -- lo usa "gh" y "git" desde el
// entorno heredado por execFile. Se valida igual para fallar rápido si
// falta.
const { OPENROUTER_API_KEY, PR_NUMBER, REPO } = requireEnv([
  'OPENROUTER_API_KEY',
  'GH_TOKEN',
  'PR_NUMBER',
  'REPO',
]);
const MODEL = process.env.MODEL || 'openai/gpt-5.3-codex';
const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS || 40);
const SLACK_FILE = '/tmp/slack-notify.txt';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PROTOCOL_PATH = '.github/review-protocol.md';

// Resueltos una sola vez al arrancar main() -- nunca vienen del modelo.
let REPO_ROOT;
let BRANCH;

function redact(text) {
  return OPENROUTER_API_KEY ? text.split(OPENROUTER_API_KEY).join('[OPENROUTER_API_KEY]') : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Path safety ----------
//
// Dos capas, porque una sola no alcanza:
//  1. Chequeo léxico (path.resolve + path.relative) -- rápido, pero NO
//     sigue symlinks. Un symlink dentro del repo (ej. "safe-link" ->
//     ".github" o -> "/tmp") pasa este chequeo sin problema, porque
//     "safe-link/archivo.txt" resuelve léxicamente a
//     "<repo>/safe-link/archivo.txt", que sigue "dentro" del repo en el
//     papel.
//  2. Chequeo real (fs.realpath) -- sigue symlinks de verdad. Como
//     fs.writeFile/fs.readFile SÍ siguen symlinks en runtime, hay que
//     validar el destino real antes de tocar el archivo, no solo el path
//     tal como lo escribió el modelo. Hallazgo real de CodeRabbit en el
//     PR #5 sobre la primera versión de este chequeo (solo léxica).

function assertLexicallyContained(userPath) {
  if (typeof userPath !== 'string' || userPath.length === 0) {
    throw new Error('path invalido');
  }
  const resolved = path.resolve(REPO_ROOT, userPath);
  const rel = path.relative(REPO_ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path fuera del repo: ${userPath}`);
  }
  return resolved;
}

// Devuelve el path REAL (symlinks resueltos) de un path que ya pasó el
// chequeo léxico. Si el archivo todavía no existe (caso normal de
// write_file creando uno nuevo), resuelve el directorio padre en su lugar
// -- ese sí tiene que existir, ninguna tool acá hace mkdir -p.
async function resolveRealPath(lexicallyContainedPath) {
  try {
    return await realpath(lexicallyContainedPath);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    const parentReal = await realpath(path.dirname(lexicallyContainedPath));
    return path.join(parentReal, path.basename(lexicallyContainedPath));
  }
}

function assertRealPathWithin(realTarget, { forbidGithub } = {}) {
  const rel = path.relative(REPO_ROOT, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('el path resuelve (via symlink) fuera del repo');
  }
  if (forbidGithub && (rel === '.github' || rel.startsWith(`.github${path.sep}`))) {
    throw new Error(
      'el path resuelve (via symlink) dentro de .github/ -- son los archivos de gobernanza del propio sistema, ese cambio lo tiene que aplicar un humano'
    );
  }
}

// Usado por read_file (solo lectura -- necesita poder leer cualquier cosa
// del repo, incluido .github/, para poder razonar sobre el propio sistema).
async function resolveSafePath(userPath) {
  const lexical = assertLexicallyContained(userPath);
  const real = await resolveRealPath(lexical);
  assertRealPathWithin(real);
  return real;
}

// Usado por edit_file/write_file (escritura). Además de estar dentro del
// repo, .github/ queda completamente vedado: son los archivos de
// gobernanza del propio sistema (el workflow, review-protocol.md, y este
// mismo script). El modelo puede pushear fixes de bajo riesgo de forma
// autónoma (Paso 4 del protocolo) sin revisión humana previa -- si pudiera
// además reescribir sus propias reglas o su propio gate de forks, un PR
// del mismo repo (no un fork, así que pasa resolve-pr) con una instrucción
// inyectada en su texto podría intentar debilitar su propia seguridad y
// pushear ese cambio sin que nadie lo revise. Hallazgo real del segundo
// revisor en el PR #5 -- este límite es deliberado, no se debe relajar sin
// que Francisco lo decida explícitamente.
async function resolveWritablePath(userPath) {
  const lexical = assertLexicallyContained(userPath);
  const rel = path.relative(REPO_ROOT, lexical);
  if (rel === '.github' || rel.startsWith(`.github${path.sep}`)) {
    throw new Error(
      `no se puede escribir dentro de .github/ (${userPath}) -- son los archivos de gobernanza del propio sistema, ese cambio lo tiene que aplicar un humano`
    );
  }
  const real = await resolveRealPath(lexical);
  assertRealPathWithin(real, { forbidGithub: true });
  return real;
}

async function withTempFile(prefix, content, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, 'contenido.txt');
  await writeFile(file, content, 'utf8');
  try {
    return await fn(file);
  } finally {
    await unlink(file).catch(() => {});
  }
}

// ---------- Tool implementations ----------
// Cada una devuelve {ok:true, ...} o {ok:false, error/step, ...} -- nunca
// tira una excepción sin capturar hacia el loop principal (eso lo hace
// safeExecuteTool también, como defensa en profundidad).

async function toolReadPrMetadata() {
  let stdout;
  try {
    ({ stdout } = await execFileP(
      'gh',
      ['pr', 'view', PR_NUMBER, '--repo', REPO, '--json', 'title,body,comments,reviews'],
      { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 }
    ));
  } catch (err) {
    if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return {
        ok: false,
        error:
          'la respuesta de gh pr view superó el maxBuffer (10 MiB). El contexto no se leyó completo; hay que aumentar límite o cambiar estrategia de lectura.',
      };
    }
    throw err;
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { ok: false, error: 'no se pudo parsear la respuesta de gh pr view' };
  }
  return { ok: true, data };
}

async function toolReadPrDiff() {
  try {
    const { stdout } = await execFileP('gh', ['pr', 'diff', PR_NUMBER, '--repo', REPO], {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, diff: stdout };
  } catch (err) {
    if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return {
        ok: false,
        error:
          'el diff del PR superó el maxBuffer (10 MiB). El contexto no se leyó completo; hay que aumentar límite o cambiar estrategia de lectura.',
      };
    }
    throw err;
  }
}

async function toolReadFile({ path: userPath } = {}) {
  const filePath = await resolveSafePath(userPath);
  const s = await stat(filePath).catch(() => null);
  if (!s) return { ok: false, error: `no existe: ${userPath}` };
  if (!s.isFile()) return { ok: false, error: `no es un archivo: ${userPath}` };
  const MAX_SIZE = 500 * 1024;
  if (s.size > MAX_SIZE) {
    return {
      ok: false,
      error: `archivo demasiado grande (${s.size} bytes) -- usá git_inspect o read_pr_diff en vez de leerlo entero`,
    };
  }
  const content = await readFile(filePath, 'utf8');
  return { ok: true, content };
}

async function toolEditFile({ path: userPath, old_string, new_string, replace_all } = {}) {
  if (typeof old_string !== 'string' || typeof new_string !== 'string') {
    return { ok: false, error: 'old_string y new_string son obligatorios' };
  }
  if (old_string === new_string) {
    return { ok: false, error: 'old_string y new_string son iguales -- no hay nada que cambiar' };
  }
  const filePath = await resolveWritablePath(userPath);
  const s = await stat(filePath).catch(() => null);
  if (!s || !s.isFile()) return { ok: false, error: `no existe: ${userPath}` };
  const content = await readFile(filePath, 'utf8');
  const count = content.split(old_string).length - 1;
  if (count === 0) return { ok: false, error: 'old_string no aparece en el archivo' };
  if (count > 1 && !replace_all) {
    return {
      ok: false,
      error: `old_string aparece ${count} veces -- agregá más contexto para que sea única, o pasá replace_all:true`,
    };
  }
  const updated = replace_all ? content.split(old_string).join(new_string) : content.replace(old_string, new_string);
  await writeFile(filePath, updated, 'utf8');
  return { ok: true, path: userPath, replaced: replace_all ? count : 1 };
}

async function toolWriteFile({ path: userPath, content } = {}) {
  if (typeof content !== 'string') return { ok: false, error: 'content es obligatorio' };
  const filePath = await resolveWritablePath(userPath);
  await writeFile(filePath, content, 'utf8');
  return { ok: true, path: userPath };
}

async function toolRunBuild() {
  try {
    const { stdout, stderr } = await execFileP('npm', ['run', 'build'], {
      cwd: REPO_ROOT,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, exitCode: 0, stdout: stdout.slice(-20_000), stderr: stderr.slice(-20_000) };
  } catch (err) {
    return {
      ok: false,
      exitCode: err.code ?? null,
      stdout: (err.stdout ?? '').slice(-20_000),
      stderr: (err.stderr ?? '').slice(-20_000),
    };
  }
}

const GIT_INSPECT_COMMANDS = new Set(['status', 'diff', 'log']);

async function toolGitInspect({ command, staged, limit } = {}) {
  if (!GIT_INSPECT_COMMANDS.has(command)) {
    return { ok: false, error: `command invalido: ${command}` };
  }
  let argv;
  if (command === 'status') {
    argv = ['status', '--porcelain=v1', '-b'];
  } else if (command === 'diff') {
    argv = staged ? ['diff', '--staged'] : ['diff'];
  } else {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 30);
    argv = ['log', '-n', String(n), '--oneline'];
  }
  try {
    const { stdout } = await execFileP('git', argv, { cwd: REPO_ROOT, maxBuffer: 5 * 1024 * 1024 });
    return { ok: true, output: stdout.slice(0, 20_000) };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 2000) };
  }
}

async function toolGitCommitAndPush({ message } = {}) {
  if (typeof message !== 'string' || message.trim() === '') {
    return { ok: false, error: 'message es obligatorio' };
  }

  // Runner de GitHub Actions no garantiza identidad git preconfigurada.
  // La dejamos fija para que los commits automáticos no fallen por author vacío.
  await execFileP('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: REPO_ROOT });
  await execFileP('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], {
    cwd: REPO_ROOT,
  });

  await execFileP('git', ['add', '-A'], { cwd: REPO_ROOT });

  // git diff --staged --quiet: exit 0 = sin diferencias, exit 1 = hay
  // diferencias. execFile promisificado RECHAZA en exit != 0, así que hay
  // que interpretar el catch: code===1 es el caso normal "hay cambios".
  let hasChanges;
  try {
    await execFileP('git', ['diff', '--staged', '--quiet'], { cwd: REPO_ROOT });
    hasChanges = false;
  } catch (err) {
    if (err.code !== 1) {
      return { ok: false, step: 'diff-check', error: String(err.message || err).slice(0, 2000) };
    }
    hasChanges = true;
  }
  if (!hasChanges) {
    return { ok: false, error: 'nada para commitear' };
  }

  try {
    await withTempFile('commit-msg-', message, (file) =>
      execFileP('git', ['commit', '-F', file], { cwd: REPO_ROOT })
    );
  } catch (err) {
    return { ok: false, step: 'commit', error: String(err.message || err).slice(0, 2000) };
  }

  try {
    await execFileP('git', ['push', 'origin', BRANCH], { cwd: REPO_ROOT });
  } catch (err) {
    return { ok: false, step: 'push', error: String(err.message || err).slice(0, 2000) };
  }

  const { stdout: sha } = await execFileP('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT });
  return { ok: true, commit: sha.trim(), branch: BRANCH };
}

async function toolPostPrComment({ body } = {}) {
  if (typeof body !== 'string' || body.trim() === '') {
    return { ok: false, error: 'body es obligatorio' };
  }
  try {
    await withTempFile('pr-comment-', body, (file) =>
      execFileP('gh', ['pr', 'comment', PR_NUMBER, '--repo', REPO, '--body-file', file], { cwd: REPO_ROOT })
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 2000) };
  }
}

async function toolQueueSlackNotification({ text } = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'text es obligatorio' };
  }
  await writeFile(SLACK_FILE, text, 'utf8');
  return { ok: true };
}

const TOOL_IMPLS = {
  read_pr_metadata: toolReadPrMetadata,
  read_pr_diff: toolReadPrDiff,
  read_file: toolReadFile,
  edit_file: toolEditFile,
  write_file: toolWriteFile,
  run_build: toolRunBuild,
  git_inspect: toolGitInspect,
  git_commit_and_push: toolGitCommitAndPush,
  post_pr_comment: toolPostPrComment,
  queue_slack_notification: toolQueueSlackNotification,
};

// ---------- Tool schemas (function-calling estilo OpenAI) ----------

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_pr_metadata',
      description:
        'Lee metadata del PR que disparó esta ejecución (titulo, body, comentarios, reviews). No se puede especificar otro PR.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_pr_diff',
      description: 'Lee el diff completo del PR que disparó esta ejecución.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Lee un archivo del repo (path relativo a la raíz del repo).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Reemplaza old_string por new_string en un archivo existente (falla si old_string no aparece exactamente una vez, salvo replace_all:true). Preferí esta herramienta a write_file para archivos existentes. No podés editar nada dentro de .github/ (son los archivos de gobernanza de este mismo sistema) -- si encontrás algo real para arreglar ahí, es un punto para ESCALAR, no para aplicar vos.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          replace_all: { type: 'boolean' },
        },
        required: ['path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Crea o sobreescribe un archivo completo con el contenido dado. No podés escribir nada dentro de .github/ (son los archivos de gobernanza de este mismo sistema) -- si encontrás algo real para arreglar ahí, es un punto para ESCALAR, no para aplicar vos.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_build',
      description: 'Corre "npm run build" para validar que un cambio compila. Sin argumentos.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_inspect',
      description: 'Inspecciona el estado de git (status/diff/log) del branch actual. Solo lectura.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['status', 'diff', 'log'] },
          staged: { type: 'boolean', description: 'Solo aplica a command=diff' },
          limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Solo aplica a command=log' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit_and_push',
      description:
        'Hace commit de todos los cambios pendientes y los pushea al branch del PR (el branch ya está fijado, no se puede elegir otro).',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_pr_comment',
      description:
        'Postea un comentario nuevo en el PR que disparó esta ejecución. Es la única forma de dejar tu respuesta -- usala siempre que el protocolo pida comentar.',
      parameters: {
        type: 'object',
        properties: { body: { type: 'string' } },
        required: ['body'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queue_slack_notification',
      description:
        'Encola un mensaje para mandar a Slack (lo manda un paso separado que sí tiene el webhook -- vos nunca lo ves). Usala solo cuando el protocolo diga que corresponde notificar.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
];

async function safeExecuteTool(call) {
  const name = call.function?.name;
  const impl = TOOL_IMPLS[name];
  if (!impl) {
    return { ok: false, error: `herramienta desconocida: ${name}` };
  }
  let args;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { ok: false, error: 'argumentos con JSON invalido' };
  }
  const start = Date.now();
  try {
    const result = await impl(args);
    console.log(`[tool] ${name} ok=${result.ok} durationMs=${Date.now() - start}`);
    return result;
  } catch (err) {
    console.log(`[tool] ${name} ok=false durationMs=${Date.now() - start} (excepcion)`);
    return { ok: false, error: redact(String(err.message || err)).slice(0, 2000) };
  }
}

// ---------- OpenRouter ----------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED']);

function backoffMs(attempt) {
  return Math.min(1000 * 2 ** (attempt - 1), 16_000) + Math.random() * 250;
}

async function callOpenRouter(messages) {
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools: TOOL_SCHEMAS,
          tool_choice: 'auto',
          max_tokens: 8000,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        return await res.json();
      }
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const text = await res.text().catch(() => '');
      throw new Error(`OpenRouter HTTP ${res.status}: ${redact(text).slice(0, 500)}`);
    } catch (err) {
      const transient = err.name === 'AbortError' || RETRYABLE_CODES.has(err.code);
      if (transient && attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------- Loop principal ----------

function buildSystemPrompt(protocolText) {
  return [
    'Sos el segundo revisor automático de este repositorio. Te invocaron',
    'porque CodeRabbit dejó un comentario nuevo en un PR. Seguí al pie de la',
    'letra las reglas de abajo (el contenido de .github/review-protocol.md de',
    'este repo). Todas tus acciones (leer, comentar, editar, pushear) se hacen',
    'exclusivamente a través de las herramientas que tenés disponibles -- no',
    'existen otras vías.',
    '',
    '---',
    '',
    protocolText,
  ].join('\n');
}

function logUsage(iteration, usage, totals) {
  if (!usage) return;
  totals.prompt += usage.prompt_tokens ?? 0;
  totals.completion += usage.completion_tokens ?? 0;
  console.log(
    `[usage] iter=${iteration} model=${MODEL} prompt=${usage.prompt_tokens ?? 0} ` +
      `completion=${usage.completion_tokens ?? 0} total=${usage.total_tokens ?? 0} ` +
      `cum_prompt=${totals.prompt} cum_completion=${totals.completion}`
  );
}

async function bestEffortSlackCrashNotice(text) {
  try {
    await writeFile(SLACK_FILE, text, 'utf8');
  } catch {
    // best-effort -- si esto falla no hay más nada que hacer acá
  }
}

async function main() {
  REPO_ROOT = (await execFileP('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
  BRANCH = (await execFileP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT })).stdout.trim();

  const protocolText = await readFile(path.join(REPO_ROOT, PROTOCOL_PATH), 'utf8');

  const userMessage =
    process.env.MANUAL_RESYNC === 'true'
      ? `Te dispararon manualmente (no un comentario nuevo de CodeRabbit) para releer el estado actual del PR #${PR_NUMBER} del repositorio ${REPO} y notificar si corresponde -- por ejemplo, después de que se aplicó un fix humano fuera de tu loop (algo que vos u otra ronda había marcado ESCALADO). Releé el hilo completo con criterio propio y seguí el protocolo desde ahí; no asumas que hay un comentario nuevo puntual para reaccionar.`
      : `Se disparó esta ejecución por un comentario nuevo de CodeRabbit en el PR #${PR_NUMBER} del repositorio ${REPO}. Seguí el protocolo.`;

  const messages = [
    { role: 'system', content: buildSystemPrompt(protocolText) },
    { role: 'user', content: userMessage },
  ];

  const totals = { prompt: 0, completion: 0 };

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const resp = await callOpenRouter(messages);
    const choice = resp.choices?.[0];
    if (!choice) {
      throw new Error('respuesta de OpenRouter sin choices');
    }
    logUsage(iteration, resp.usage, totals);
    messages.push(choice.message);

    const toolCalls = choice.message?.tool_calls;
    if (choice.finish_reason === 'length') {
      console.error('[fatal] OpenRouter devolvió finish_reason="length" (respuesta truncada)');
      await bestEffortSlackCrashNotice(
        `⚠️ El segundo revisor automático (PR #${PR_NUMBER}) recibió una respuesta truncada del modelo (finish_reason=length). Revisar el log de Actions.`
      );
      return 1;
    }

    if (choice.finish_reason !== 'tool_calls' || !toolCalls?.length) {
      console.log(
        `[usage] TOTAL iterations=${iteration} prompt=${totals.prompt} completion=${totals.completion} total=${totals.prompt + totals.completion}`
      );
      return 0;
    }

    // Secuencial, no en paralelo: un edit_file puede depender del
    // resultado del tool_call anterior dentro del mismo turno.
    for (const call of toolCalls) {
      const result = await safeExecuteTool(call);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  console.error(`[fatal] MAX_ITERATIONS=${MAX_ITERATIONS} alcanzado sin terminar`);
  await bestEffortSlackCrashNotice(
    `⚠️ El segundo revisor automático (PR #${PR_NUMBER}) se quedó sin iteraciones (${MAX_ITERATIONS}). Revisar el log de Actions.`
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error('[fatal]', redact(String(err.stack || err)));
    await bestEffortSlackCrashNotice(
      `⚠️ El segundo revisor automático (PR #${PR_NUMBER}) crasheó. Ver log de Actions.`
    ).catch(() => {});
    process.exit(1);
  });
