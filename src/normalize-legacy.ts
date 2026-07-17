/**
 * Normalización de datos legacy — idempotente y NO destructiva.
 *
 * Qué hace (rellena estructuras nuevas desde las legacy, sin borrar campos que
 * el backend todavía lee, como coordinatorId / Project.approverId):
 *
 *  USERS
 *   - Garantiza un objeto `permissions` completo (modules, canApproveL1/L2,
 *     categoryIds, projectIds) en todos los usuarios.
 *   - Si tiene projectIds pero no primaryProjectId → primaryProjectId = projectIds[0].
 *   - Back-fill approverIds = [coordinatorId] cuando falta approverIds.
 *   - Defaults sanos: documentType='L', isActive, emailNotificationsEnabled,
 *     mustChangePassword.
 *
 *  PROJECTS (centros de costo)
 *   - Back-fill approverLevels = [{level:2, userIds:[approverId]}] cuando hay
 *     approverId legacy y approverLevels está vacío.
 *
 *  ADVANCES (viáticos/anticipos)
 *   - Back-fill approverChain = [coordinatorId] (requiredLevels=1) cuando falta.
 *
 *  CLIENTS
 *   - Elimina el campo huérfano `tesoreriaEmails` (removido del modelo).
 *
 * Además REPORTA (no inventa) los gaps que requieren decisión humana:
 *   - Usuarios sin centros de costo asignados (permissions.projectIds vacío).
 *   - Centros de costo sin aprobadores (ni approverLevels ni approverId).
 *
 * Uso:
 *   npm run normalize:legacy                      # DRY-RUN (solo reporta)
 *   npm run normalize:legacy -- --apply           # aplica los cambios
 *   SEED_ALLOW_REMOTE=yes npm run normalize:legacy -- --apply
 *
 * SEGURIDAD:
 *   - Escribe SOLO si se pasa el flag explícito `--apply` (no depende de
 *     variables de entorno, que se pueden filtrar entre sesiones).
 *   - Si la URI no es localhost, aborta salvo SEED_ALLOW_REMOTE=yes.
 */
import 'dotenv/config'
import * as dns from 'dns'
import mongoose from 'mongoose'

import { UserSchema } from './modules/user/schemas/user.schema'
import { ProjectSchema } from './modules/project/entities/project.entity'
import { AdvanceSchema } from './modules/advance/entities/advance.entity'
import { ClientSchema } from './modules/client/entities/client.entity'

const APPLY = process.argv.includes('--apply')

function assertSafeTarget(uri: string) {
  const isLocal = /(^|@|\/\/)(localhost|127\.0\.0\.1)(:|\/)/.test(uri)
  if (!isLocal && process.env.SEED_ALLOW_REMOTE !== 'yes') {
    const host = uri.replace(/\/\/[^@]*@/, '//***@')
    console.error(
      `\n[ABORT] La URI no es localhost:\n  ${host}\n` +
        `Para normalizar un destino remoto confirma con:\n` +
        `  SEED_ALLOW_REMOTE=yes SEED_URI="<uri>" [APPLY=yes] npm run normalize:legacy\n`
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

  // mongodb+srv:// hace una consulta DNS SRV. Si el DNS del router/ISP/VPN la
  // rechaza (querySrv ECONNREFUSED), forzamos un resolver público que sí la
  // soporta. Configurable con DNS_SERVERS="1.1.1.1,8.8.8.8".
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

  console.log(
    `--- Normalización legacy (${APPLY ? 'APPLY' : 'DRY-RUN'}) → ${uri.replace(/\/\/[^@]*@/, '//***@')} ---`
  )
  await mongoose.connect(uri)

  const UserModel = mongoose.model('User', UserSchema)
  const ProjectModel = mongoose.model('Project', ProjectSchema)
  const AdvanceModel = mongoose.model('Advance', AdvanceSchema)
  const ClientModel = mongoose.model('Client', ClientSchema)

  const report = {
    usersTotal: 0,
    usersNormalized: 0,
    usersMissingCostCenter: [] as string[],
    projectsTotal: 0,
    projectsApproverLevelsBackfilled: 0,
    projectsWithoutApprovers: [] as string[],
    advancesBackfilled: 0,
    clientsCleaned: 0,
  }

  // ── USERS ──────────────────────────────────────────────────────────────────
  const users = await UserModel.find({}).exec()
  report.usersTotal = users.length
  for (const u of users as any[]) {
    const set: Record<string, unknown> = {}

    const p = u.permissions ?? {}
    const normPerms = {
      modules: Array.isArray(p.modules) ? p.modules : [],
      canApproveL1: typeof p.canApproveL1 === 'boolean' ? p.canApproveL1 : false,
      canApproveL2: typeof p.canApproveL2 === 'boolean' ? p.canApproveL2 : false,
      categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds : [],
      projectIds: Array.isArray(p.projectIds) ? p.projectIds : [],
      primaryProjectId:
        p.primaryProjectId ??
        (Array.isArray(p.projectIds) && p.projectIds.length ? p.projectIds[0] : undefined),
    }
    const permsChanged = JSON.stringify(normPerms) !== JSON.stringify(rawPerms(p))
    if (permsChanged) set.permissions = normPerms

    if (u.coordinatorId && (!Array.isArray(u.approverIds) || u.approverIds.length === 0)) {
      set.approverIds = [u.coordinatorId]
    }
    if (u.documentType == null) set.documentType = 'L'
    if (typeof u.isActive !== 'boolean') set.isActive = true
    if (typeof u.emailNotificationsEnabled !== 'boolean') set.emailNotificationsEnabled = false
    if (typeof u.mustChangePassword !== 'boolean') set.mustChangePassword = false

    if (!normPerms.projectIds.length) report.usersMissingCostCenter.push(u.email)

    if (Object.keys(set).length) {
      report.usersNormalized++
      if (APPLY) await UserModel.updateOne({ _id: u._id }, { $set: set }).exec()
    }
  }

  // ── PROJECTS ────────────────────────────────────────────────────────────────
  const projects = await ProjectModel.find({}).exec()
  report.projectsTotal = projects.length
  for (const pr of projects as any[]) {
    const hasLevels = Array.isArray(pr.approverLevels) && pr.approverLevels.length > 0
    if (!hasLevels && pr.approverId) {
      report.projectsApproverLevelsBackfilled++
      if (APPLY) {
        await ProjectModel.updateOne(
          { _id: pr._id },
          { $set: { approverLevels: [{ level: 2, userIds: [pr.approverId] }] } }
        ).exec()
      }
    } else if (!hasLevels && !pr.approverId) {
      report.projectsWithoutApprovers.push(pr.code ?? String(pr._id))
    }
  }

  // ── ADVANCES ──────────────────────────────────────────────────────────────
  const advCandidates = await AdvanceModel.find({
    coordinatorId: { $exists: true, $ne: null },
    $or: [{ approverChain: { $exists: false } }, { approverChain: { $size: 0 } }],
  })
    .select('_id coordinatorId')
    .exec()
  report.advancesBackfilled = advCandidates.length
  if (APPLY) {
    for (const a of advCandidates as any[]) {
      await AdvanceModel.updateOne(
        { _id: a._id },
        { $set: { approverChain: [a.coordinatorId], requiredLevels: 1 } }
      ).exec()
    }
  }

  // ── CLIENTS (limpiar campo huérfano tesoreriaEmails, ya removido del modelo) ──
  const orphanCount = await ClientModel.collection.countDocuments({
    tesoreriaEmails: { $exists: true },
  })
  report.clientsCleaned = orphanCount
  if (APPLY && orphanCount > 0) {
    await ClientModel.collection.updateMany(
      { tesoreriaEmails: { $exists: true } },
      { $unset: { tesoreriaEmails: '' } }
    )
  }

  // ── REPORTE ─────────────────────────────────────────────────────────────────
  console.log('\n=== RESUMEN ===')
  console.log(`Usuarios: ${report.usersTotal} · normalizados: ${report.usersNormalized}`)
  console.log(
    `Centros de costo: ${report.projectsTotal} · approverLevels rellenados desde approverId: ${report.projectsApproverLevelsBackfilled}`
  )
  console.log(`Anticipos con approverChain rellenada desde coordinatorId: ${report.advancesBackfilled}`)
  console.log(`Clientes con tesoreriaEmails huérfano ${APPLY ? 'eliminado' : 'a eliminar'}: ${report.clientsCleaned}`)

  if (report.usersMissingCostCenter.length) {
    console.log(
      `\n[ACCIÓN MANUAL] ${report.usersMissingCostCenter.length} usuario(s) SIN centro de costo asignado ` +
        `(permissions.projectIds vacío). No se puede derivar automáticamente — asignarlos en ` +
        `/admin-users/:id/permisos:`
    )
    report.usersMissingCostCenter.forEach(e => console.log(`   - ${e}`))
  }
  if (report.projectsWithoutApprovers.length) {
    console.log(
      `\n[ACCIÓN MANUAL] ${report.projectsWithoutApprovers.length} centro(s) de costo SIN aprobadores ` +
        `(sin approverLevels ni approverId). Configurar N1/N2 en el formulario de centro de costo:`
    )
    report.projectsWithoutApprovers.forEach(c => console.log(`   - ${c}`))
  }

  if (!APPLY) {
    console.log('\n(DRY-RUN: no se escribió nada. Corre con APPLY=yes para aplicar.)')
  } else {
    console.log('\n--- Normalización aplicada ---')
  }

  await mongoose.disconnect()
}

/** Reconstruye el objeto permissions "tal cual" para comparar y no marcar cambios espurios. */
function rawPerms(p: any) {
  return {
    modules: Array.isArray(p.modules) ? p.modules : [],
    canApproveL1: typeof p.canApproveL1 === 'boolean' ? p.canApproveL1 : false,
    canApproveL2: typeof p.canApproveL2 === 'boolean' ? p.canApproveL2 : false,
    categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds : [],
    projectIds: Array.isArray(p.projectIds) ? p.projectIds : [],
    primaryProjectId: p.primaryProjectId ?? undefined,
  }
}

main().catch(async err => {
  console.error('Normalización falló:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
