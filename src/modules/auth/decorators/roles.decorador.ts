import { SetMetadata } from '@nestjs/common'
import { ROLES } from '../enums/roles.enum'

export const Roles = (...roles: ROLES[]) => SetMetadata('roles', roles)
