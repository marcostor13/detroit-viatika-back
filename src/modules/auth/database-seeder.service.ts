import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { RoleService } from '../role/role.service'
import { UserService } from '../user/user.service'
import { User, UserDocument } from '../user/schemas/user.schema'
import { ROLES } from './enums/roles.enum'
import * as bcrypt from 'bcryptjs'

@Injectable()
export class DatabaseSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSeederService.name)

  constructor(
    private readonly roleService: RoleService,
    private readonly userService: UserService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onApplicationBootstrap() {
    await this.migrateEmailIndex()
    await this.seedRoles()
    await this.seedSuperAdmin()
  }

  /** Drop the old global email_1 unique index if it still exists, so the new compound index takes over. */
  private async migrateEmailIndex() {
    try {
      const indexes = await this.userModel.collection.indexes()
      const oldIndex = indexes.find((idx: any) => idx.name === 'email_1')
      if (oldIndex) {
        await this.userModel.collection.dropIndex('email_1')
        this.logger.log('Dropped legacy email_1 unique index from users collection')
      }
    } catch (err: any) {
      this.logger.warn(`Index migration skipped: ${err?.message}`)
    }
  }

  private async seedRoles() {
    const rolesToCreate = Object.values(ROLES)
    this.logger.log('Checking and seeding roles...')

    for (const roleName of rolesToCreate) {
      const existingRole = await this.roleService.getByName(roleName)
      if (!existingRole) {
        // Determine the old name to look for migration
        let oldName = ''
        if (roleName === ROLES.SUPER_ADMIN) oldName = 'Super'
        else if (roleName === ROLES.COLABORADOR) oldName = 'User'

        const roleWithOldName = oldName
          ? await this.roleService.getByName(oldName)
          : null

        if (roleWithOldName) {
          this.logger.log(
            `Renaming existing role '${oldName}' to '${roleName}'`
          )
          await this.roleService.update(
            (roleWithOldName as any)._id.toString(),
            { name: roleName }
          )
        } else {
          this.logger.log(`Creating new role: '${roleName}'`)
          await this.roleService.create({ name: roleName })
        }
      } else {
        this.logger.log(`Role '${roleName}' already exists.`)
      }
    }
  }

  /** Reassign users still pointing to the legacy 'Coordinador' role to 'Administrador'. */
  private async migrateAdminRole() {
    const legacyRole = await this.roleService.getByName('Coordinador')
    if (!legacyRole) return

    const newRole = await this.roleService.getByName(ROLES.ADMIN)
    if (!newRole) return

    // Both docs may be the same if seedRoles already renamed it
    if ((legacyRole as any)._id.toString() === (newRole as any)._id.toString()) return

    const legacyId = (legacyRole as any)._id
    const newId = (newRole as any)._id

    const updated = await this.userModel.updateMany(
      { roleId: legacyId },
      { $set: { roleId: newId } },
    )
    if (updated.modifiedCount > 0) {
      this.logger.log(
        `Migrated ${updated.modifiedCount} user(s) from 'Coordinador' to '${ROLES.ADMIN}'`,
      )
    }
  }

  private async seedSuperAdmin() {
    const superAdminRole = await this.roleService.getByName(ROLES.SUPER_ADMIN)
    if (!superAdminRole) {
      this.logger.error(
        'SuperAdmin role not found. Skipping SuperAdmin seeding.'
      )
      return
    }

    const users = await this.userService.findAllWithClient()
    const hasSuperAdmin = users.some(u => u.role.name === ROLES.SUPER_ADMIN)

    if (!hasSuperAdmin) {
      this.logger.log('Seeding default SuperAdmin...')
      const hashedPassword = await bcrypt.hash('@Libido2010', 10)
      await this.userModel.create({
        email: 'admin@viatika.com',
        name: 'Super Administrator',
        password: hashedPassword,
        roleId: (superAdminRole as any)._id,
        clientId: null,
        isActive: true,
        mustChangePassword: false,
        permissions: { modules: [], canApproveL1: false, canApproveL2: false },
      })
      this.logger.log('Default SuperAdmin seeded: admin@viatika.com / @Libido2010')
    }
  }
}
