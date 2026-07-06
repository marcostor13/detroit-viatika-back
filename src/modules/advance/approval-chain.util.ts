import { BadRequestException } from '@nestjs/common'
import { Types } from 'mongoose'
import { ROLES } from '../auth/enums/roles.enum'

/**
 * Motor de aprobación por cadena ordenada, compartido entre el módulo Advance
 * (anticipos legacy) y ExpenseReport tipo 'viatico'. Reemplaza el antiguo
 * esquema de niveles L1/L2 basado en el umbral ADVANCE_THRESHOLDS.
 */

export function buildApproverChain(
  approverIds: Types.ObjectId[] | undefined
): Types.ObjectId[] {
  const chain = approverIds ?? []
  if (chain.length === 0) {
    throw new BadRequestException(
      'El colaborador no tiene aprobadores (coordinadores) asignados. Un administrador debe asignarle al menos uno antes de poder solicitar.'
    )
  }
  return chain
}

export function expectedApproverId(
  chain: Types.ObjectId[],
  approvalLevel: number
): string | null {
  const next = chain[approvalLevel]
  return next ? next.toString() : null
}

export function canActOnChain(opts: {
  chain: Types.ObjectId[]
  approvalLevel: number
  actorId: string
  actorRole: string
}): boolean {
  if (opts.actorRole === ROLES.SUPER_ADMIN) return true
  const expected = expectedApproverId(opts.chain, opts.approvalLevel)
  return expected !== null && expected === opts.actorId
}

export function advanceChain(opts: {
  approvalLevel: number
  requiredLevels: number
}): { approvalLevel: number; isComplete: boolean } {
  const approvalLevel = opts.approvalLevel + 1
  return { approvalLevel, isComplete: approvalLevel >= opts.requiredLevels }
}

/**
 * Cadena de aprobadores por centro de costo (reemplaza la cadena por
 * `User.approverIds` en el flujo de viáticos unificado):
 * - Si el centro de costo elegido está entre los asignados al colaborador,
 *   la cadena tiene 1 nivel: el aprobador de ese centro de costo.
 * - Si NO está asignado, la cadena tiene 2 niveles: primero el aprobador del
 *   centro de costo PRINCIPAL del colaborador (el primero de su lista
 *   asignada), luego el aprobador del centro de costo elegido. Si ambos
 *   aprobadores son la misma persona, se colapsa a 1 nivel.
 */
export function combineCostCenterChain(opts: {
  /** IDs de centro de costo asignados al colaborador, ORDENADOS (el [0] es el principal). */
  assignedProjectIds: string[]
  selectedProjectId: string
  approverByProjectId: Map<string, Types.ObjectId | undefined>
}): Types.ObjectId[] {
  const { assignedProjectIds, selectedProjectId, approverByProjectId } = opts

  if (assignedProjectIds.length === 0) {
    throw new BadRequestException(
      'El colaborador no tiene centros de costo asignados. Un administrador debe asignarle al menos uno en sus permisos antes de solicitar viáticos.'
    )
  }

  const selectedApprover = approverByProjectId.get(selectedProjectId)
  if (!selectedApprover) {
    throw new BadRequestException(
      'El centro de costo seleccionado no tiene un aprobador configurado. Un administrador debe asignarlo antes de continuar.'
    )
  }

  if (assignedProjectIds.includes(selectedProjectId)) {
    return [selectedApprover]
  }

  const principalId = assignedProjectIds[0]
  const principalApprover = approverByProjectId.get(principalId)
  if (!principalApprover) {
    throw new BadRequestException(
      'Su centro de costo principal no tiene un aprobador configurado. Un administrador debe asignarlo antes de solicitar viáticos hacia otro centro de costo.'
    )
  }

  return principalApprover.equals(selectedApprover)
    ? [principalApprover]
    : [principalApprover, selectedApprover]
}
