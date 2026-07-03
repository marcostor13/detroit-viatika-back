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
