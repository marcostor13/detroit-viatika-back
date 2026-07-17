/**
 * Seed de DEMO — idempotente. Crea una empresa de ejemplo con:
 *  - Roles base (si faltan).
 *  - 1 cliente.
 *  - Centros de costo con approverLevels (N1/N2) ya configurados.
 *  - Usuarios: admin de empresa, aprobadores N1/N2, colaboradores con
 *    projectIds/primaryProjectId, tesorería y contabilidad.
 *
 * Reutiliza los Schemas reales (validación + defaults). Es idempotente: se
 * puede correr varias veces sin duplicar (upsert por email / código).
 *
 * Uso:
 *   npm run seed:demo                       # usa MONGO_URI del .env
 *   SEED_URI="mongodb+srv://..." SEED_ALLOW_REMOTE=yes npm run seed:demo
 *
 * SEGURIDAD: si la URI no es localhost, ABORTA a menos que
 * SEED_ALLOW_REMOTE=yes — evita escribir en producción por accidente.
 */
import 'dotenv/config'
import * as dns from 'dns'
import mongoose from 'mongoose'
import * as bcrypt from 'bcryptjs'

import { UserSchema } from './modules/user/schemas/user.schema'
import { ClientSchema } from './modules/client/entities/client.entity'
import { ProjectSchema } from './modules/project/entities/project.entity'
import { RoleSchema } from './modules/role/entities/role.entity'

// ─── CONFIG (edítalo a gusto) ────────────────────────────────────────────────
const CONFIG = {
  defaultPassword: 'Demo2026$',
  client: {
    codigo: 'DEMO',
    comercialName: 'Empresa Demo',
    businessName: 'Empresa Demo SAC',
    businessId: '20123456789', // RUC
  },
  costCenters: [
    { code: 'CC-001', name: 'Centro de Costo Principal' },
    { code: 'CC-002', name: 'Centro de Costo Secundario' },
  ],
  /**
   * role: nombre exacto del rol.
   * approverOf: { [ccCode]: nivel } — vuelve al usuario aprobador N-nivel de ese centro de costo.
   * projects / primary: centros de costo asignados al colaborador (por code).
   */
  users: [
    { email: 'admin.demo@viatika.com', name: 'Admin Empresa', role: 'Administrador' },
    {
      email: 'aprobador1@viatika.com',
      name: 'Aprobador N1',
      role: 'Colaborador',
      approverOf: { 'CC-001': 1, 'CC-002': 1 } as Record<string, number>,
    },
    {
      email: 'aprobador2@viatika.com',
      name: 'Aprobador N2',
      role: 'Colaborador',
      approverOf: { 'CC-001': 2, 'CC-002': 2 } as Record<string, number>,
    },
    {
      email: 'colaborador1@viatika.com',
      name: 'Colaborador Uno',
      role: 'Colaborador',
      projects: ['CC-001', 'CC-002'],
      primary: 'CC-001',
    },
    {
      email: 'colaborador2@viatika.com',
      name: 'Colaborador Dos',
      role: 'Colaborador',
      projects: ['CC-001'],
      primary: 'CC-001',
    },
    { email: 'tesoreria.demo@viatika.com', name: 'Tesorería Demo', role: 'Tesoreria' },
    { email: 'contabilidad.demo@viatika.com', name: 'Contabilidad Demo', role: 'Contabilidad' },
  ] as Array<{
    email: string
    name: string
    role: string
    approverOf?: Record<string, number>
    projects?: string[]
    primary?: string
  }>,
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
    const host = uri.replace(/\/\/[^@]*@/, '//***@')
    console.error(
      `\n[ABORT] La URI no es localhost:\n  ${host}\n` +
        `Para sembrar en un destino remoto (Atlas/producción) confirma con:\n` +
        `  SEED_ALLOW_REMOTE=yes SEED_URI="<uri>" npm run seed:demo\n`
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

  // Ver normalize-legacy.ts: forzar resolver DNS público para el SRV de Atlas.
  if (uri.includes('mongodb+srv')) {
    const servers = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    try {
      dns.setServers(servers)
      console.log(`DNS SRV forzado a: ${servers.join(', ')}`)
    } catch (e) {
      console.warn('No se pudo fijar el resolver DNS:', (e as Error).message)
    }
  }

  const shown = uri.replace(/\/\/[^@]*@/, '//***@')
  console.log(`--- Seed DEMO → ${shown} ---`)
  await mongoose.connect(uri)

  const RoleModel = mongoose.model('Role', RoleSchema)
  const ClientModel = mongoose.model('Client', ClientSchema)
  const UserModel = mongoose.model('User', UserSchema)
  const ProjectModel = mongoose.model('Project', ProjectSchema)

  // 1. Roles base
  const roleId: Record<string, mongoose.Types.ObjectId> = {}
  for (const name of ROLES_BASE) {
    const r = await RoleModel.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, active: true } },
      { upsert: true, new: true }
    ).exec()
    roleId[name] = r!._id as mongoose.Types.ObjectId
  }
  console.log(`Roles listos: ${ROLES_BASE.join(', ')}`)

  // 2. Cliente
  const client = await ClientModel.findOneAndUpdate(
    { codigo: CONFIG.client.codigo },
    { $setOnInsert: { ...CONFIG.client } },
    { upsert: true, new: true }
  ).exec()
  const clientId = client!._id as mongoose.Types.ObjectId
  console.log(`Cliente: ${CONFIG.client.comercialName} (${CONFIG.client.codigo})`)

  // 3. Usuarios (primero, para poder referenciarlos en los approverLevels)
  const hashed = await bcrypt.hash(CONFIG.defaultPassword, 10)
  const userIdByEmail: Record<string, mongoose.Types.ObjectId> = {}
  for (const u of CONFIG.users) {
    const rid = roleId[u.role]
    if (!rid) throw new Error(`Rol desconocido para ${u.email}: ${u.role}`)
    const doc = await UserModel.findOneAndUpdate(
      { email: u.email, clientId },
      {
        $set: { name: u.name, roleId: rid, isActive: true },
        $setOnInsert: {
          email: u.email,
          clientId,
          password: hashed,
          mustChangePassword: true,
          permissions: {
            modules: [],
            canApproveL1: false,
            canApproveL2: false,
            categoryIds: [],
            projectIds: [],
          },
        },
      },
      { upsert: true, new: true }
    ).exec()
    userIdByEmail[u.email] = doc!._id as mongoose.Types.ObjectId
  }
  console.log(`Usuarios: ${CONFIG.users.length} (password: ${CONFIG.defaultPassword})`)

  // 4. Centros de costo con approverLevels (N1/N2) resueltos por email
  const projectIdByCode: Record<string, mongoose.Types.ObjectId> = {}
  for (const cc of CONFIG.costCenters) {
    const byLevel = new Map<number, mongoose.Types.ObjectId[]>()
    for (const u of CONFIG.users) {
      const lvl = u.approverOf?.[cc.code]
      if (lvl) {
        const arr = byLevel.get(lvl) ?? []
        arr.push(userIdByEmail[u.email])
        byLevel.set(lvl, arr)
      }
    }
    const approverLevels = [...byLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, userIds]) => ({ level, userIds }))

    const proj = await ProjectModel.findOneAndUpdate(
      { code: cc.code, clientId },
      {
        $set: {
          name: cc.name,
          isActive: true,
          approverLevels,
          clientName: CONFIG.client.comercialName,
        },
        $setOnInsert: { code: cc.code, clientId },
      },
      { upsert: true, new: true }
    ).exec()
    projectIdByCode[cc.code] = proj!._id as mongoose.Types.ObjectId
    console.log(
      `Centro de costo ${cc.code}: niveles ${approverLevels.map(l => `N${l.level}(${l.userIds.length})`).join(', ') || '(sin aprobadores)'}`
    )
  }

  // 5. Asignar centros de costo (projectIds/primaryProjectId) a los colaboradores
  for (const u of CONFIG.users) {
    if (!u.projects?.length) continue
    const projectIds = u.projects.map(code => projectIdByCode[code]?.toString()).filter(Boolean)
    const primaryProjectId = u.primary ? projectIdByCode[u.primary]?.toString() : projectIds[0]
    await UserModel.updateOne(
      { _id: userIdByEmail[u.email] },
      { $set: { 'permissions.projectIds': projectIds, 'permissions.primaryProjectId': primaryProjectId } }
    ).exec()
    console.log(`  ${u.email} → CC [${u.projects.join(', ')}] (principal: ${u.primary ?? u.projects[0]})`)
  }

  console.log('--- Seed DEMO completado ---')
  await mongoose.disconnect()
}

main().catch(async err => {
  console.error('Seed DEMO falló:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
