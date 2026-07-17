/**
 * Arranque / bootstrap de una instalación nueva — idempotente.
 *
 * Deja el sistema listo para usar creando lo mínimo indispensable:
 *   1. Roles base.
 *   2. SuperAdmin de plataforma (gestiona empresas).
 *   3. Primera empresa (cliente).
 *   4. Primer Administrador de esa empresa.
 *
 * Es idempotente (upsert por email / código): se puede correr varias veces.
 * NO crea datos de ejemplo (para eso está `seed:demo`).
 *
 * Uso:
 *   npm run init
 *   SEED_ALLOW_REMOTE=yes npm run init                      # contra Atlas/remoto
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... COMPANY_CODE=... npm run init
 *
 * Contraseñas: se toman de variables de entorno si están; si no, usan un
 * default con `mustChangePassword=true` (obliga a cambiarla al primer login).
 *
 * SEGURIDAD:
 *   - Si la URI no es localhost, aborta salvo SEED_ALLOW_REMOTE=yes.
 *   - Fuerza un resolver DNS público para el SRV de Atlas (evita ECONNREFUSED).
 */
import 'dotenv/config'
import * as dns from 'dns'
import mongoose from 'mongoose'
import * as bcrypt from 'bcryptjs'

import { UserSchema } from './modules/user/schemas/user.schema'
import { ClientSchema } from './modules/client/entities/client.entity'
import { RoleSchema } from './modules/role/entities/role.entity'

// ─── CONFIG (edítalo o pásalo por variables de entorno) ──────────────────────
const CONFIG = {
  superAdmin: {
    email: process.env.SUPERADMIN_EMAIL || 'admin@viatika.com',
    name: 'Super Administrator',
    password: process.env.SUPERADMIN_PASSWORD || '@Libido2010',
  },
  company: {
    codigo: process.env.COMPANY_CODE || 'EMPRESA1',
    comercialName: process.env.COMPANY_NAME || 'Mi Empresa',
    businessName: process.env.COMPANY_LEGAL || 'Mi Empresa SAC',
    businessId: process.env.COMPANY_RUC || '20000000001', // RUC
  },
  companyAdmin: {
    email: process.env.ADMIN_EMAIL || 'admin@miempresa.com',
    name: process.env.ADMIN_NAME || 'Administrador',
    password: process.env.ADMIN_PASSWORD || 'Cambiar2026$',
  },
}

const ROLES_BASE = [
  'Superadministrador',
  'Administrador',
  'Colaborador',
  'Tesoreria',
  'Contabilidad',
  'Coordinador',
]

function assertSafeTarget(uri: string) {
  const isLocal = /(^|@|\/\/)(localhost|127\.0\.0\.1)(:|\/)/.test(uri)
  if (!isLocal && process.env.SEED_ALLOW_REMOTE !== 'yes') {
    console.error(
      `\n[ABORT] La URI no es localhost:\n  ${uri.replace(/\/\/[^@]*@/, '//***@')}\n` +
        `Para inicializar un destino remoto confirma con:\n` +
        `  SEED_ALLOW_REMOTE=yes npm run init\n`
    )
    process.exit(1)
  }
}

async function main() {
  const uri = process.env.SEED_URI || process.env.MONGO_URI
  if (!uri) {
    console.error('[ABORT] Falta MONGO_URI (o SEED_URI).')
    process.exit(1)
  }
  assertSafeTarget(uri)

  if (uri.includes('mongodb+srv')) {
    const servers = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    try {
      dns.setServers(servers)
    } catch {
      /* noop */
    }
  }

  console.log(`--- Init → ${uri.replace(/\/\/[^@]*@/, '//***@')} ---`)
  await mongoose.connect(uri)

  const RoleModel = mongoose.model('Role', RoleSchema)
  const ClientModel = mongoose.model('Client', ClientSchema)
  const UserModel = mongoose.model('User', UserSchema)

  // 1. Roles
  const roleId: Record<string, mongoose.Types.ObjectId> = {}
  for (const name of ROLES_BASE) {
    const r = await RoleModel.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, active: true } },
      { upsert: true, new: true }
    ).exec()
    roleId[name] = r!._id as mongoose.Types.ObjectId
  }
  console.log(`Roles listos (${ROLES_BASE.length}).`)

  // 2. SuperAdmin (plataforma — sin clientId)
  const superRid = roleId['Superadministrador']
  const superExisting = await UserModel.findOne({ email: CONFIG.superAdmin.email }).exec()
  if (!superExisting) {
    await UserModel.create({
      email: CONFIG.superAdmin.email,
      name: CONFIG.superAdmin.name,
      password: await bcrypt.hash(CONFIG.superAdmin.password, 10),
      roleId: superRid,
      clientId: null,
      isActive: true,
      mustChangePassword: false,
      permissions: { modules: [], canApproveL1: false, canApproveL2: false, categoryIds: [], projectIds: [] },
    })
    console.log(`SuperAdmin creado: ${CONFIG.superAdmin.email}`)
  } else {
    console.log(`SuperAdmin ya existe: ${CONFIG.superAdmin.email}`)
  }

  // 3. Primera empresa (cliente)
  const client = await ClientModel.findOneAndUpdate(
    { codigo: CONFIG.company.codigo },
    { $setOnInsert: { ...CONFIG.company } },
    { upsert: true, new: true }
  ).exec()
  const clientId = client!._id as mongoose.Types.ObjectId
  console.log(`Empresa: ${CONFIG.company.comercialName} (${CONFIG.company.codigo})`)

  // 4. Primer Administrador de la empresa
  const adminRid = roleId['Administrador']
  const adminExisting = await UserModel.findOne({ email: CONFIG.companyAdmin.email, clientId }).exec()
  if (!adminExisting) {
    await UserModel.create({
      email: CONFIG.companyAdmin.email,
      name: CONFIG.companyAdmin.name,
      password: await bcrypt.hash(CONFIG.companyAdmin.password, 10),
      roleId: adminRid,
      clientId,
      isActive: true,
      isCompanyAdmin: true,
      mustChangePassword: true,
      permissions: { modules: [], canApproveL1: false, canApproveL2: false, categoryIds: [], projectIds: [] },
    })
    console.log(`Administrador creado: ${CONFIG.companyAdmin.email} (mustChangePassword)`)
  } else {
    console.log(`Administrador ya existe: ${CONFIG.companyAdmin.email}`)
  }

  console.log('\n=== LISTO ===')
  console.log(`SuperAdmin:      ${CONFIG.superAdmin.email} / ${CONFIG.superAdmin.password}`)
  console.log(`Admin empresa:   ${CONFIG.companyAdmin.email} / ${CONFIG.companyAdmin.password}  (cámbiala al entrar)`)
  console.log('\nSiguiente paso: crea centros de costo (con N1/N2) y asigna a cada colaborador sus centros de costo.')

  await mongoose.disconnect()
}

main().catch(async err => {
  console.error('Init falló:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
