import { Injectable } from '@nestjs/common'
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Role } from './entities/role.entity'

@Injectable()
export class RoleService {
  constructor(@InjectModel(Role.name) private roleModel: Model<Role>) {}

  create(createRoleDto: CreateRoleDto) {
    return this.roleModel.create(createRoleDto)
  }

  getByName(name: string) {
    return this.roleModel.findOne({ name }).exec()
  }

  getWithSuperAdmin() {
    return this.roleModel
      .find({
        $or: [
          { name: 'Administrador' },
          { name: 'Coordinador' },
          { name: 'Colaborador' },
          { name: 'Contabilidad' },
        ],
      })
      .exec()
  }

  getAdminRoles() {
    return this.roleModel
      .find({
        $or: [{ name: 'Administrador' }, { name: 'Superadministrador' }],
      })
      .exec()
  }

  findAll() {
    return this.roleModel.find().exec()
  }

  findOne(id: string) {
    return this.roleModel.findById(id).exec()
  }

  findByUserId(userId: string) {
    return this.roleModel.findOne({ userId }).exec()
  }

  update(id: string, updateRoleDto: UpdateRoleDto) {
    return this.roleModel.findByIdAndUpdate(id, updateRoleDto).exec()
  }

  remove(id: string) {
    return this.roleModel.findByIdAndDelete(id).exec()
  }
}
