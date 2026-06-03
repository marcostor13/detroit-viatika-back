/**
 * Script de creación masiva de usuarios — Tema Litoclean
 *
 * Uso:
 *   node scripts/crear-usuarios.mjs
 *
 * Variables de entorno requeridas (o editar las constantes CONFIG abajo):
 *   API_URL        — URL base del backend, sin barra final  (default: http://localhost:3016/api)
 *   ADMIN_EMAIL    — Email del Superadministrador para autenticarse
 *   ADMIN_PASSWORD — Contraseña del Superadministrador
 *   CLIENT_ID      — ObjectId MongoDB del cliente/empresa destino
 *
 * El script genera "usuarios_temporales.md" con las credenciales en la carpeta raíz del proyecto.
 */

import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Configuración ────────────────────────────────────────────────────────────
const CONFIG = {
  apiUrl:        process.env.API_URL        || 'http://localhost:3016/api',
  adminEmail:    process.env.ADMIN_EMAIL    || 'CAMBIAR@ADMIN.COM',
  adminPassword: process.env.ADMIN_PASSWORD || 'CAMBIAR_PASSWORD',
  clientId:      process.env.CLIENT_ID      || 'CAMBIAR_CLIENT_ID',
}

// ─── Datos de usuarios (fuente: formato crear usuarios.xlsx) ──────────────────
const USERS = [
  { name: 'MAMANI LEON, ALEX YURI',              email: 'amamani',    rolExcel: 'COLABORADOR',         dni: '71818670',  area: 'SUELOS CONTAMINADOS',  cargo: 'ASISTENTE DE INGENIERIA',                              phone: '989419305' },
  { name: 'SALAZAR PEREZ, CHRISTIAN',            email: 'csalazar',   rolExcel: 'COLABORADOR',         dni: '73118219',  area: 'SUELOS CONTAMINADOS',  cargo: 'ASISTENTE DE INGENIERIA',                              phone: '934506700' },
  { name: 'CONTRERAS CABALLERO, VICTOR DAVID',   email: 'vcontreras', rolExcel: 'COLABORADOR',         dni: '48165681',  area: 'SUELOS CONTAMINADOS',  cargo: 'ASISTENTE DE INGENIERIA',                              phone: '965349413' },
  { name: 'NIETO PALACIOS, DIEGO',               email: 'dnieto',     rolExcel: 'COLABORADOR',         dni: '46812341',  area: 'SUELOS CONTAMINADOS',  cargo: 'PROFESIONAL - BIOLOGIA',                               phone: '920770354' },
  { name: 'MORGA CASTELLANOS, ERICKA JUDITH',    email: 'emorga',     rolExcel: 'COLABORADOR',         dni: '42152194',  area: 'MEDIO AMBIENTE',       cargo: 'PROFESIONAL - INGENIERIA FORESTAL',                    phone: '999110994' },
  { name: 'CUELLAR QUISPE, FABRICIO ENRIQUE',    email: 'fcuellar',   rolExcel: 'COLABORADOR',         dni: '71705638',  area: 'MEDIO AMBIENTE',       cargo: 'ASISTENTE DE LOGISTICA',                               phone: '907019220' },
  { name: 'NUÑEZ ANGULO, MIGUEL ANGEL',          email: 'mnuñez',     rolExcel: 'COLABORADOR',         dni: '05392060',  area: 'ADMINISTRACION',       cargo: 'AUXILIAR ADMINSTRATIVO',                               phone: '920252925' },
  { name: 'SANTA CRUZ ZULOETA, JOSE ERNESTO',    email: 'jsanta',     rolExcel: 'COLABORADOR',         dni: '10625760',  area: 'MEDIO AMBIENTE',       cargo: 'COORDINADOR LOGISTICO',                                phone: '953655781' },
  { name: 'COBEÑAS GARCIA, JULIO CESAR',         email: 'jcobeñas',   rolExcel: 'COLABORADOR',         dni: '43415604',  area: 'MEDIO AMBIENTE',       cargo: 'PROFESIONAL - INGENIERIA AMBIENTAL',                   phone: '959887891' },
  { name: 'CONDOR ARCE, LUIS ALONZO',            email: 'lcondor',    rolExcel: 'COLABORADOR',         dni: '42772059',  area: 'SUELOS CONTAMINADOS',  cargo: 'PROFESIONAL - INGENIERIA QUIMICA',                     phone: '964264446' },
  { name: 'LEDESMA ARISTA, PERCY ANGEL',         email: 'pledesma',   rolExcel: 'COLABORADOR',         dni: '70026592',  area: 'SUELOS CONTAMINADOS',  cargo: 'PROFESIONAL - INGENIERIA GEOLOGICA',                   phone: '950487544' },
  { name: 'PARDO GONZALES, YESSENIA CONSUELO',   email: 'ypardo',     rolExcel: 'COLABORADOR',         dni: '72520843',  area: 'SUELOS CONTAMINADOS',  cargo: 'PROFESIONAL - INGENIERIA AMBIENTAL',                   phone: '986817086' },
  { name: 'CACERES TORRES, KEYTEL FRANCELL',     email: 'kcaceres',   rolExcel: 'COLABORADOR',         dni: '70196811',  area: 'SUELOS CONTAMINADOS',  cargo: 'PROFESIONAL - INGENIERIA AMBIENTAL',                   phone: '982099429' },
  { name: 'ALVA PASCAL, LINGO MAXIMO',           email: 'lalva',      rolExcel: 'COLABORADOR',         dni: '40304192',  area: 'SEGURIDAD',            cargo: 'PROFESIONAL - INGENIERIA QUIMICA',                     phone: '921669785' },
  { name: 'GUADALUPE BONIFACIO, MARTIN AUGUSTO', email: 'mguadalupe', rolExcel: 'COLABORADOR',         dni: '43352813',  area: 'MEDIO AMBIENTE',       cargo: 'PROFESIONAL - INGENIERIA AMBIENTAL Y RR.NN.',          phone: '966951461' },
  { name: 'SALAZAR DIAZ, RUDDY HARBIN',          email: 'rsalazar',   rolExcel: 'COORDINADOR',         dni: '46423131',  area: 'SUELOS CONTAMINADOS',  cargo: 'COORDINADOR DE REMEDIACION',                           phone: '980439490' },
  { name: 'BIEDULA NN, SERGIO DANIEL',           email: 'sbiedula',   rolExcel: 'GERENTE GENERAL',     dni: '001174788', area: 'COMERCIAL',            cargo: 'GERENTE GENERAL',                                      phone: '999228831' },
  { name: 'ALVARADO MOLINA, MADELEINE NIEVES',   email: 'malvarado',  rolExcel: 'COORDINADOR',         dni: '44194505',  area: 'SEGURIDAD',            cargo: 'COORDINADORA DE SEGURIDAD INDUSTRIAL',                 phone: '964003486' },
  { name: 'QUEQUE YAPU, ALEX SANDRO',            email: 'aqueque',    rolExcel: 'COORDINADOR',         dni: '46144548',  area: 'ADMINISTRACION',       cargo: 'ANALISTA DE RECURSOS HUMANOS',                         phone: '987526256' },
  { name: 'CARRASCO PERALTA, CHRISTIAN WILMER',  email: 'ccarrasco',  rolExcel: 'GERENTE COMERCIAL',   dni: '41404579',  area: 'COMERCIAL',            cargo: 'GERENTE DE DESARROLLO DE NEGOCIOS',                    phone: '985175464' },
  { name: 'LEIVA DIAZ, LESLIE CHRISTY',          email: 'lleiva',     rolExcel: 'GERENTE DE PROYECTOS',dni: '05385560',  area: 'SUELOS CONTAMINADOS',  cargo: 'GERENTE DE MEDIO AMBIENTE, SUELOS & REMEDIACION',      phone: '969183110' },
  { name: 'MUÑOZ GARCIA, FLOR DEL ROCIO',        email: 'fmuñoz',     rolExcel: 'COORDINADOR',         dni: '09442498',  area: 'ADMINISTRACION',       cargo: 'GERENTE DE RECURSOS HUMANOS',                          phone: '982280844' },
  { name: 'RAMOS PACHECO, GABRIELA MERCEDES',    email: 'gramos',     rolExcel: 'COORDINADOR',         dni: '47625959',  area: 'MEDIO AMBIENTE',       cargo: 'COORDINADORA DE MEDIO AMBIENTE',                       phone: '986687073' },
  { name: 'LEON BRACK, CARMEN CRISTINA',         email: 'cleon',      rolExcel: 'COORDINADOR',         dni: '45343472',  area: 'SUELOS CONTAMINADOS',  cargo: 'COORDINADORA DE SUELOS CONTAMINADOS',                  phone: '964302424' },
  { name: 'QUISPE SANDOVAL, LUIS ANGEL',         email: 'lquispe',    rolExcel: 'COORDINADOR',         dni: '42115977',  area: 'ADMINISTRACION',       cargo: 'COORDINADOR CONTABLE',                                 phone: '962779243' },
  { name: 'JAMANCA SHUAN, SUSAN CAROLINA',       email: 'sjamanca',   rolExcel: 'GERENTE DE FINANZAS', dni: '10198420',  area: 'ADMINISTRACION',       cargo: 'GERENTE DE ADMINISTRACION & FINANZAS',                 phone: '988104580' },
]

// ─── Mapeo rol Excel → nombre de rol en la plataforma ─────────────────────────
const ROL_MAP = {
  'COLABORADOR':          'Colaborador',
  'COORDINADOR':          'Coordinador',
  'GERENTE GENERAL':      'Coordinador',
  'GERENTE COMERCIAL':    'Coordinador',
  'GERENTE DE PROYECTOS': 'Coordinador',
  'GERENTE DE FINANZAS':  'Coordinador',
}

// ─── Helpers HTTP ──────────────────────────────────────────────────────────────
async function post(path, body, token) {
  const res = await fetch(`${CONFIG.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

async function get(path, token) {
  const res = await fetch(`${CONFIG.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

// ─── Validación de configuración ──────────────────────────────────────────────
function validateConfig() {
  const missing = []
  if (CONFIG.adminEmail    === 'CAMBIAR@ADMIN.COM')    missing.push('ADMIN_EMAIL')
  if (CONFIG.adminPassword === 'CAMBIAR_PASSWORD')     missing.push('ADMIN_PASSWORD')
  if (CONFIG.clientId      === 'CAMBIAR_CLIENT_ID')    missing.push('CLIENT_ID')
  if (missing.length > 0) {
    console.error('\n[ERROR] Faltan variables de configuración:')
    missing.forEach(v => console.error(`  - ${v} (variable de entorno o constante CONFIG en el script)`))
    console.error('\nEjemplo de uso:')
    console.error('  ADMIN_EMAIL=admin@empresa.com ADMIN_PASSWORD=pass123 CLIENT_ID=6abc... node scripts/crear-usuarios.mjs\n')
    process.exit(1)
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  validateConfig()

  // 1. Login
  console.log('\n[1/4] Autenticando como superadmin...')
  const loginRes = await post('/auth/login', {
    email: CONFIG.adminEmail,
    password: CONFIG.adminPassword,
  })
  if (!loginRes.data?.access_token) {
    console.error('[ERROR] Login fallido:', JSON.stringify(loginRes.data))
    process.exit(1)
  }
  const token = loginRes.data.access_token
  console.log('      OK — token obtenido')

  // 2. Obtener roles
  console.log('\n[2/4] Obteniendo roles del sistema...')
  const rolesRes = await get('/role', token)
  if (!Array.isArray(rolesRes.data)) {
    console.error('[ERROR] No se pudieron obtener roles:', JSON.stringify(rolesRes.data))
    process.exit(1)
  }
  const roleMap = {}
  rolesRes.data.forEach(r => { roleMap[r.name] = r._id })
  console.log('      Roles encontrados:', Object.keys(roleMap).join(', '))

  // Verificar que los roles requeridos existan
  const rolesRequeridos = ['Colaborador', 'Coordinador']
  for (const rn of rolesRequeridos) {
    if (!roleMap[rn]) {
      console.error(`[ERROR] Rol "${rn}" no encontrado en la base de datos.`)
      process.exit(1)
    }
  }

  // 3. Crear usuarios
  console.log(`\n[3/4] Creando ${USERS.length} usuarios...\n`)
  const results = []
  let ok = 0, failed = 0

  for (const u of USERS) {
    const rolSistema = ROL_MAP[u.rolExcel] || 'Colaborador'
    const roleId = roleMap[rolSistema]

    const payload = {
      name:       u.name,
      email:      u.email,
      roleId,
      clientId:   CONFIG.clientId,
      dni:        u.dni,
      area:       u.area,
      cargo:      u.cargo,
      phone:      u.phone,
      isActive:   true,
    }

    const res = await post('/user', payload, token)

    if (res.status === 201 || res.status === 200) {
      const tempPwd = res.data?.temporaryPassword || '(ver respuesta)'
      console.log(`  ✔  ${u.email.padEnd(14)} | ${rolSistema.padEnd(14)} | pwd: ${tempPwd}`)
      results.push({ ...u, rolSistema, temporaryPassword: tempPwd, status: 'OK' })
      ok++
    } else {
      const msg = res.data?.message || JSON.stringify(res.data)
      console.log(`  ✘  ${u.email.padEnd(14)} | ${res.status} | ${msg}`)
      results.push({ ...u, rolSistema, temporaryPassword: '—', status: `ERROR ${res.status}: ${msg}` })
      failed++
    }
  }

  console.log(`\n      Creados: ${ok}  |  Errores: ${failed}`)

  // 4. Generar MD
  console.log('\n[4/4] Generando usuarios_temporales.md...')
  const mdPath = resolve(__dirname, '../../usuarios_temporales.md')
  writeFileSync(mdPath, buildMd(results), 'utf8')
  console.log(`      Guardado en: ${mdPath}\n`)
}

function buildMd(results) {
  const fecha = new Date().toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })

  const colRows = results
    .filter(r => r.rolSistema === 'Colaborador')
    .map(r => mdRow(r))
    .join('\n')

  const coordRows = results
    .filter(r => r.rolSistema !== 'Colaborador')
    .map(r => mdRow(r))
    .join('\n')

  const errors = results.filter(r => r.status !== 'OK')

  return `# Usuarios creados — Tema Litoclean

Generado: ${fecha}

> **IMPORTANTE:** Entregar estas credenciales de forma segura a cada usuario.
> Los usuarios deben cambiar su contraseña al primer inicio de sesión.

---

## Colaboradores (${results.filter(r => r.rolSistema === 'Colaborador').length})

| Nombre | Email (login) | Contraseña temporal | DNI | Área | Cargo | Estado |
|--------|---------------|---------------------|-----|------|-------|--------|
${colRows}

---

## Coordinadores / Gerentes (${results.filter(r => r.rolSistema !== 'Colaborador').length})

| Nombre | Email (login) | Rol plataforma | Contraseña temporal | DNI | Área | Cargo | Rol original Excel | Estado |
|--------|---------------|----------------|---------------------|-----|------|-------|--------------------|--------|
${coordRows}

---

${errors.length > 0 ? `## Errores (${errors.length})\n\n${errors.map(e => `- **${e.name}** (\`${e.email}\`): ${e.status}`).join('\n')}\n\n---\n\n` : ''}
*Generado por \`scripts/crear-usuarios.mjs\`*
`
}

function mdRow(r) {
  if (r.rolSistema === 'Colaborador') {
    return `| ${r.name} | \`${r.email}\` | \`${r.temporaryPassword}\` | ${r.dni} | ${r.area} | ${r.cargo} | ${r.status} |`
  }
  return `| ${r.name} | \`${r.email}\` | ${r.rolSistema} | \`${r.temporaryPassword}\` | ${r.dni} | ${r.area} | ${r.cargo} | ${r.rolExcel} | ${r.status} |`
}

main().catch(err => {
  console.error('\n[ERROR FATAL]', err.message)
  process.exit(1)
})
