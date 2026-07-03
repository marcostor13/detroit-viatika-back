import { Types } from 'mongoose'
import { BadRequestException } from '@nestjs/common'
import { ROLES } from '../auth/enums/roles.enum'
import {
  buildApproverChain,
  expectedApproverId,
  canActOnChain,
  advanceChain,
} from './approval-chain.util'

describe('approval-chain.util', () => {
  const a1 = new Types.ObjectId()
  const a2 = new Types.ObjectId()
  const a3 = new Types.ObjectId()

  describe('buildApproverChain', () => {
    it('returns the chain unchanged when non-empty', () => {
      expect(buildApproverChain([a1, a2])).toEqual([a1, a2])
    })

    it('throws BadRequestException when the chain is empty', () => {
      expect(() => buildApproverChain([])).toThrow(BadRequestException)
    })

    it('throws BadRequestException when approverIds is undefined', () => {
      expect(() => buildApproverChain(undefined)).toThrow(BadRequestException)
    })
  })

  describe('expectedApproverId', () => {
    it('returns the approver at the given level as a string', () => {
      expect(expectedApproverId([a1, a2, a3], 1)).toBe(a2.toString())
    })

    it('returns null when level is past the end of the chain', () => {
      expect(expectedApproverId([a1, a2], 2)).toBeNull()
    })
  })

  describe('canActOnChain', () => {
    it('allows the approver whose turn it is', () => {
      expect(
        canActOnChain({
          chain: [a1, a2],
          approvalLevel: 0,
          actorId: a1.toString(),
          actorRole: ROLES.COORDINADOR,
        })
      ).toBe(true)
    })

    it('rejects a user who is in the chain but not at the current turn', () => {
      expect(
        canActOnChain({
          chain: [a1, a2],
          approvalLevel: 0,
          actorId: a2.toString(),
          actorRole: ROLES.COORDINADOR,
        })
      ).toBe(false)
    })

    it('rejects a user not present in the chain at all', () => {
      expect(
        canActOnChain({
          chain: [a1, a2],
          approvalLevel: 0,
          actorId: a3.toString(),
          actorRole: ROLES.COORDINADOR,
        })
      ).toBe(false)
    })

    it('allows Superadministrador as break-glass regardless of chain position', () => {
      expect(
        canActOnChain({
          chain: [a1, a2],
          approvalLevel: 0,
          actorId: a3.toString(),
          actorRole: ROLES.SUPER_ADMIN,
        })
      ).toBe(true)
    })

    it('rejects Administrador who is not in the chain (no break-glass)', () => {
      expect(
        canActOnChain({
          chain: [a1, a2],
          approvalLevel: 0,
          actorId: a3.toString(),
          actorRole: ROLES.ADMIN,
        })
      ).toBe(false)
    })

    it('rejects Contabilidad — no longer an approver of the chain', () => {
      expect(
        canActOnChain({
          chain: [a1, a2],
          approvalLevel: 0,
          actorId: a3.toString(),
          actorRole: ROLES.CONTABILIDAD,
        })
      ).toBe(false)
    })

    it('returns false when approvalLevel is past the end of the chain', () => {
      expect(
        canActOnChain({
          chain: [a1],
          approvalLevel: 1,
          actorId: a1.toString(),
          actorRole: ROLES.COORDINADOR,
        })
      ).toBe(false)
    })
  })

  describe('advanceChain', () => {
    it('advances the level and marks incomplete when more approvers remain', () => {
      expect(advanceChain({ approvalLevel: 0, requiredLevels: 2 })).toEqual({
        approvalLevel: 1,
        isComplete: false,
      })
    })

    it('marks complete when the last approver in the chain acts', () => {
      expect(advanceChain({ approvalLevel: 1, requiredLevels: 2 })).toEqual({
        approvalLevel: 2,
        isComplete: true,
      })
    })

    it('marks complete immediately for a single-approver chain', () => {
      expect(advanceChain({ approvalLevel: 0, requiredLevels: 1 })).toEqual({
        approvalLevel: 1,
        isComplete: true,
      })
    })

    it('marks complete for a three-approver chain on the final approval', () => {
      expect(advanceChain({ approvalLevel: 2, requiredLevels: 3 })).toEqual({
        approvalLevel: 3,
        isComplete: true,
      })
    })
  })
})
