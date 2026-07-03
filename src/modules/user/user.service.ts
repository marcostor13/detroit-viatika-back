import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, UserDocument } from './schemas/user.schema'
import { Model, Types } from 'mongoose'
import { UpdateUserDto } from './dto/update-user.dto'
import { ClientDocument } from '../client/entities/client.entity'
import { RoleService } from '../role/role.service'
import { RoleDocument } from '../role/entities/role.entity'
import * as bcrypt from 'bcryptjs'
import { CreateUserDto } from './dto/create-user.dto'

export interface IUser {
  email: string
  name: string
  password: string
  roleId: Types.ObjectId
  clientId?: Types.ObjectId
  isActive?: boolean
}

export interface IUserPermissions {
  modules: string[]
  canApproveL1: boolean
  canApproveL2: boolean
}

export interface IUserResponse {
  _id: Types.ObjectId
  email: string
  name: string
  role: RoleDocument
  client: ClientDocument
  password?: string
  isActive: boolean
  permissions: IUserPermissions
  dni?: string
  employeeCode?: string
  area?: string
  cargo?: string
  address?: string
  phone?: string
  coordinatorId?:
    | Types.ObjectId
    | { _id: Types.ObjectId; name?: string; email?: string }
  mustChangePassword?: boolean
  signature?: string
  bankAccount?: {
    bankName: string
    accountNumber: string
    cci: string
    accountType: string
  }
  profilePic?: string
  emailNotificationsEnabled?: boolean
}

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly roleService: RoleService
  ) {}

  async findAllWithClient(): Promise<IUserResponse[]> {
    const users = await this.userModel
      .find()
      .populate('roleId')
      .populate('clientId')
      .exec()
    return users.map(user => ({
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.roleId as unknown as RoleDocument,
      client: user.clientId as unknown as ClientDocument,
      isActive: user.isActive,
      permissions: (user as any).permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
      },
      dni: (user as any).dni,
      employeeCode: (user as any).employeeCode,
      area: (user as any).area,
      cargo: (user as any).cargo,
      address: (user as any).address,
      phone: (user as any).phone,
    }))
  }

  async findAllByEmail(email: string): Promise<IUserResponse[]> {
    const users = await this.userModel
      .find({ email })
      .populate('roleId')
      .populate('clientId')
      .exec()
    return users.map(user => ({
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.roleId as unknown as RoleDocument,
      client: user.clientId as unknown as ClientDocument,
      password: user.password,
      isActive: user.isActive,
      permissions: (user as any).permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
      },
      dni: (user as any).dni,
      employeeCode: (user as any).employeeCode,
      area: (user as any).area,
      cargo: (user as any).cargo,
      address: (user as any).address,
      phone: (user as any).phone,
      mustChangePassword: !!(user as any).mustChangePassword,
      signature: (user as any).signature,
    }))
  }

  async findByEmail(email: string): Promise<IUserResponse | null> {
    const user = await this.userModel
      .findOne({ email })
      .populate('roleId')
      .populate('clientId')
      .exec()
    if (!user) {
      return null
    }
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.roleId as unknown as RoleDocument,
      client: user.clientId as unknown as ClientDocument,
      password: user.password,
      isActive: user.isActive,
      permissions: (user as any).permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
      },
      dni: (user as any).dni,
      employeeCode: (user as any).employeeCode,
      area: (user as any).area,
      cargo: (user as any).cargo,
      address: (user as any).address,
      phone: (user as any).phone,
      mustChangePassword: !!(user as any).mustChangePassword,
      signature: (user as any).signature,
    }
  }

  async findOne(id: string): Promise<IUserResponse> {
    const user = await this.userModel
      .findById(id)
      .populate('roleId')
      .populate('clientId')
      .populate('coordinatorId', 'name email')
      .exec()
    if (!user) {
      return {} as IUserResponse
    }
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.roleId as unknown as RoleDocument,
      client: user.clientId as unknown as ClientDocument,
      isActive: user.isActive,
      permissions: (user as any).permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
      },
      dni: (user as any).dni,
      employeeCode: (user as any).employeeCode,
      area: (user as any).area,
      cargo: (user as any).cargo,
      address: (user as any).address,
      phone: (user as any).phone,
      coordinatorId: (user as any).coordinatorId,
      bankAccount: (user as any).bankAccount,
      signature: (user as any).signature,
      mustChangePassword: !!(user as any).mustChangePassword,
      profilePic: (user as any).profilePic,
      emailNotificationsEnabled: !!(user as any).emailNotificationsEnabled,
    }
  }

  async create(
    userData: CreateUserDto
  ): Promise<IUserResponse & { temporaryPassword: string }> {
    const clientId = userData.clientId
      ? new Types.ObjectId(userData.clientId)
      : null
    const roleId = new Types.ObjectId(userData.roleId)

    const issetUser = await this.userModel.findOne({
      email: userData.email,
      clientId: clientId || null,
    })
    if (issetUser) {
      throw new BadRequestException(
        'El correo ya se encuentra registrado en esta empresa'
      )
    }
    const temporaryPassword =
      Math.random().toString(36).slice(-8) +
      Math.random().toString(36).slice(-4).toUpperCase()
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10)
    const {
      coordinatorId: coordRaw,
      permissions,
      ...rest
    } = userData as CreateUserDto & {
      coordinatorId?: string
      permissions?: IUserPermissions
    }
    const savedUser = await this.userModel.create({
      ...rest,
      roleId,
      clientId,
      password: hashedPassword,
      mustChangePassword: true,
      coordinatorId: coordRaw ? new Types.ObjectId(coordRaw) : undefined,
      ...(permissions ? { permissions } : {}),
    })
    const populatedUser = await this.userModel
      .findById(savedUser._id)
      .populate('roleId')
      .populate('clientId')
      .exec()
    if (!populatedUser) {
      return {} as IUserResponse & { temporaryPassword: string }
    }
    return {
      _id: populatedUser._id,
      email: populatedUser.email,
      name: populatedUser.name,
      role: populatedUser.roleId as unknown as RoleDocument,
      client: populatedUser.clientId as unknown as ClientDocument,
      isActive: populatedUser.isActive,
      permissions: (populatedUser as any).permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
      },
      dni: (populatedUser as any).dni,
      employeeCode: (populatedUser as any).employeeCode,
      area: (populatedUser as any).area,
      cargo: (populatedUser as any).cargo,
      address: (populatedUser as any).address,
      phone: (populatedUser as any).phone,
      temporaryPassword,
    }
  }

  async findUserIdsByCoordinator(
    coordinatorId: string,
    clientId: string
  ): Promise<Types.ObjectId[]> {
    const users = await this.userModel
      .find({
        coordinatorId: new Types.ObjectId(coordinatorId),
        clientId: new Types.ObjectId(clientId),
      })
      .select('_id')
      .exec()
    return users.map(u => u._id)
  }

  async findAll(clientId: Types.ObjectId) {
    const users = await this.userModel
      .find({ clientId })
      .populate('roleId')
      .populate('clientId')
      .exec()
    return users.map(user => ({
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.roleId,
      client: user.clientId,
      isActive: user.isActive,
      isCompanyAdmin: (user as any).isCompanyAdmin ?? false,
    }))
  }

  /** Lista mínima de trabajadores activos del cliente, para selectores. */
  async findColaboradoresBasic(clientId: Types.ObjectId | string) {
    // clientId llega como string desde el token JWT pero se almacena como ObjectId:
    // se convierte explícitamente (igual que findAll vía ParseObjectIdPipe).
    const idStr = clientId.toString()
    if (!Types.ObjectId.isValid(idStr)) return []
    const cid = new Types.ObjectId(idStr)
    const users = await this.userModel
      .find({ clientId: cid, isActive: { $ne: false } })
      .select('_id name email dni')
      .sort({ name: 1 })
      .lean()
      .exec()
    return users.map((u: any) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      dni: u.dni,
    }))
  }

  async findAllPaginated(
    clientId: Types.ObjectId,
    opts: {
      page?: number
      limit?: number
      search?: string
      status?: string
      roleName?: string
    } = {}
  ) {
    const page = opts.page ?? 1
    const limit = opts.limit ?? 20
    const skip = (page - 1) * limit
    const filter: any = { clientId }

    if (opts.search) {
      const re = new RegExp(opts.search, 'i')
      filter.$or = [{ name: re }, { email: re }]
    }
    if (opts.status) {
      filter.isActive = opts.status === 'active'
    }
    if (opts.roleName) {
      const role = await this.roleService.getByName(opts.roleName)
      filter.roleId = role ? (role as any)._id : null
    }

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .populate('roleId')
        .populate('clientId')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter),
    ])
    const pages = Math.ceil(total / limit)
    const data = users.map(user => ({
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.roleId as unknown as RoleDocument,
      client: user.clientId as unknown as ClientDocument,
      isActive: user.isActive,
      permissions: (user as any).permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
      },
    }))
    return { data, total, page, pages, limit }
  }

  update(id: string, updateUserDto: UpdateUserDto) {
    const updateData: any = { ...updateUserDto }

    if (updateData.roleId) {
      updateData.roleId = new Types.ObjectId(updateData.roleId)
    }

    if (updateData.clientId) {
      updateData.clientId = new Types.ObjectId(updateData.clientId)
    }

    if (
      'coordinatorId' in updateUserDto &&
      updateUserDto.coordinatorId !== undefined
    ) {
      updateData.coordinatorId = updateUserDto.coordinatorId
        ? new Types.ObjectId(updateUserDto.coordinatorId)
        : null
    }

    return this.userModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate('roleId')
      .populate('clientId')
      .exec()
  }

  delete(id: string) {
    return this.userModel.findByIdAndDelete(id).exec()
  }

  /** Firma y coordinador para validar solicitudes transaccionales (viáticos). */
  async findTransactionalProfile(
    userId: string
  ): Promise<{ signature?: string; coordinatorId?: Types.ObjectId } | null> {
    const u = await this.userModel
      .findById(userId)
      .select('signature coordinatorId')
      .exec()
    if (!u) return null
    return {
      signature: u.signature,
      coordinatorId: u.coordinatorId,
    }
  }

  async findEmailNameClient(
    userId: string
  ): Promise<{ email: string; name: string; clientId: Types.ObjectId } | null> {
    const u = await this.userModel
      .findById(userId)
      .select('email name clientId')
      .exec()
    if (!u) return null
    return {
      email: u.email,
      name: u.name,
      clientId: u.clientId,
    }
  }

  /** Datos para plantillas de correo viáticos (Fase 3 — nombre, documento, área, cargo). */
  async findCollaboratorViaticoNotifyProfile(userId: string): Promise<{
    name: string
    dni?: string
    employeeCode?: string
    area?: string
    cargo?: string
  } | null> {
    const u = await this.userModel
      .findById(userId)
      .select('name dni employeeCode area cargo')
      .exec()
    if (!u) return null
    return {
      name: u.name,
      dni: u.dni,
      employeeCode: u.employeeCode,
      area: u.area,
      cargo: u.cargo,
    }
  }

  /**
   * Destinatarios notificación solicitud aprobada → contabilidad/tesorería (Fase 3).
   * Administradores del cliente + módulos `tesoreria` o `contabilidad`.
   */
  async findViaticoAccountingNotifyRecipients(
    clientId: string
  ): Promise<{ email: string; name: string }[]> {
    const contabilidadRole = await this.roleService.getByName('Contabilidad')
    if (!contabilidadRole) return []

    // Solo rol Contabilidad. Administrador NO es Contabilidad: tiene su propio
    // canal de notificaciones (findAdminsByClient). Los módulos de UI tampoco
    // cuentan: habilitan pantallas pero no implican ser destinatario contable.
    const scopedUsers = await this.userModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isActive: true,
        emailNotificationsEnabled: true,
        roleId: (contabilidadRole as any)._id,
      })
      .select('email name')
      .exec()

    // Global Contabilidad users (clientId = null) — always notified
    const contabilidadUsers = contabilidadRole
      ? await this.userModel
          .find({
            clientId: null,
            roleId: (contabilidadRole as any)._id,
            isActive: true,
            emailNotificationsEnabled: true,
          })
          .select('email name')
          .exec()
      : []

    const seen = new Set<string>()
    const out: { email: string; name: string }[] = []
    for (const u of [...scopedUsers, ...contabilidadUsers]) {
      const em = u.email?.trim().toLowerCase()
      if (!em || seen.has(em)) continue
      seen.add(em)
      out.push({ email: u.email, name: u.name })
    }
    return out
  }

  /**
   * Solo usuarios con rol Contabilidad. No incluye administradores ni
   * a quienes tengan los módulos tesoreria/contabilidad por permiso de UI.
   */
  async findContabilidadRecipients(
    clientId: string
  ): Promise<{ email: string; name: string }[]> {
    const contabilidadRole = await this.roleService.getByName('Contabilidad')
    if (!contabilidadRole) return []

    const scopedUsers = await this.userModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isActive: true,
        emailNotificationsEnabled: true,
        roleId: (contabilidadRole as any)._id,
      })
      .select('email name')
      .exec()

    const globalContabilidad = contabilidadRole
      ? await this.userModel
          .find({
            clientId: null,
            roleId: (contabilidadRole as any)._id,
            isActive: true,
            emailNotificationsEnabled: true,
          })
          .select('email name')
          .exec()
      : []

    const seen = new Set<string>()
    const out: { email: string; name: string }[] = []
    for (const u of [...scopedUsers, ...globalContabilidad]) {
      const em = u.email?.trim().toLowerCase()
      if (!em || seen.has(em)) continue
      seen.add(em)
      out.push({ email: u.email, name: u.name })
    }
    return out
  }

  /**
   * Usuarios con rol Contabilidad (sin filtrar por emailNotificationsEnabled,
   * porque hay flujos que separan notificación in-app del correo).
   * NO incluye usuarios cuyo único vínculo con contabilidad sean permisos de módulo.
   */
  async findContabilidadUsersForNotif(clientId: string): Promise<
    {
      _id: string
      email: string
      name: string
      emailNotificationsEnabled: boolean
    }[]
  > {
    const contabilidadRole = await this.roleService.getByName('Contabilidad')
    if (!contabilidadRole) return []

    const scopedUsers = await this.userModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isActive: true,
        roleId: (contabilidadRole as any)._id,
      })
      .select('_id email name emailNotificationsEnabled')
      .exec()

    const globalContabilidad = contabilidadRole
      ? await this.userModel
          .find({
            clientId: null,
            roleId: (contabilidadRole as any)._id,
            isActive: true,
          })
          .select('_id email name emailNotificationsEnabled')
          .exec()
      : []

    const seen = new Set<string>()
    const out: {
      _id: string
      email: string
      name: string
      emailNotificationsEnabled: boolean
    }[] = []
    for (const u of [...scopedUsers, ...globalContabilidad]) {
      const em = u.email?.trim().toLowerCase()
      if (!em || seen.has(em)) continue
      seen.add(em)
      out.push({
        _id: String((u as any)._id),
        email: u.email,
        name: u.name,
        emailNotificationsEnabled: !!(u as any).emailNotificationsEnabled,
      })
    }
    return out
  }

  /**
   * Destinatarios para "Aprobación final requerida" (pending_l2).
   * Incluye: rol Contabilidad o usuarios con `permissions.canApproveL2 = true`.
   * `canApproveL2` es una asignación explícita de aprobador, no un permiso de UI.
   * NO incluye a quienes solo tengan los módulos tesoreria/contabilidad por permiso de pantalla.
   */
  async findL2ApprovalNotifyRecipients(
    clientId: string
  ): Promise<{ email: string; name: string }[]> {
    const contabilidadRole = await this.roleService.getByName('Contabilidad')

    const scopedUsers = await this.userModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isActive: true,
        emailNotificationsEnabled: true,
        $or: [
          ...(contabilidadRole
            ? [{ roleId: (contabilidadRole as any)._id }]
            : []),
          { 'permissions.canApproveL2': true },
        ],
      })
      .select('email name')
      .exec()

    const globalContabilidad = contabilidadRole
      ? await this.userModel
          .find({
            clientId: null,
            roleId: (contabilidadRole as any)._id,
            isActive: true,
            emailNotificationsEnabled: true,
          })
          .select('email name')
          .exec()
      : []

    const seen = new Set<string>()
    const out: { email: string; name: string }[] = []
    for (const u of [...scopedUsers, ...globalContabilidad]) {
      const em = u.email?.trim().toLowerCase()
      if (!em || seen.has(em)) continue
      seen.add(em)
      out.push({ email: u.email, name: u.name })
    }
    return out
  }

  async findAccountingRecipientsWithIds(
    clientId: string
  ): Promise<{ _id: string; email: string; name: string }[]> {
    const contabilidadRole = await this.roleService.getByName('Contabilidad')
    if (!contabilidadRole) return []

    // Solo rol Contabilidad. Administrador NO recibe estos correos: tiene su
    // propio canal vía findAdminsByClient cuando aplica.
    const scopedUsers = await this.userModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isActive: true,
        emailNotificationsEnabled: true,
        roleId: (contabilidadRole as any)._id,
      })
      .select('_id email name')
      .exec()

    const contabilidadUsers = contabilidadRole
      ? await this.userModel
          .find({
            clientId: null,
            roleId: (contabilidadRole as any)._id,
            isActive: true,
            emailNotificationsEnabled: true,
          })
          .select('_id email name')
          .exec()
      : []

    const seen = new Set<string>()
    const out: { _id: string; email: string; name: string }[] = []
    for (const u of [...scopedUsers, ...contabilidadUsers]) {
      const em = u.email?.trim().toLowerCase()
      if (!em || seen.has(em)) continue
      seen.add(em)
      out.push({ _id: String((u as any)._id), email: u.email, name: u.name })
    }
    return out
  }

  async changeOwnPassword(userId: string, newPassword: string): Promise<void> {
    const hashed = await bcrypt.hash(newPassword, 10)
    await this.userModel
      .findByIdAndUpdate(userId, {
        password: hashed,
        mustChangePassword: false,
      })
      .exec()
  }

  async resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    const user = await this.userModel.findById(id).exec()
    if (!user) throw new NotFoundException('Usuario no encontrado')
    const temporaryPassword =
      Math.random().toString(36).slice(-8) +
      Math.random().toString(36).slice(-4).toUpperCase()
    const hashed = await bcrypt.hash(temporaryPassword, 10)
    await this.userModel
      .findByIdAndUpdate(id, { password: hashed, mustChangePassword: true })
      .exec()
    return { temporaryPassword }
  }

  /** Normaliza un encabezado: minúsculas, sin tildes, sin espacios extra. */
  private normalizeHeader(h: string): string {
    return String(h)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  }

  /** Alias de encabezados (ES/EN) a los campos canónicos del importador. */
  private static readonly BULK_HEADER_ALIASES: Record<string, string> = {
    name: 'name',
    nombre: 'name',
    nombres: 'name',
    'nombre completo': 'name',
    email: 'email',
    correo: 'email',
    'correo electronico': 'email',
    'e-mail': 'email',
    mail: 'email',
    dni: 'dni',
    documento: 'dni',
    'nro documento': 'dni',
    'numero de documento': 'dni',
    employeecode: 'employeeCode',
    codigo: 'employeeCode',
    'codigo empleado': 'employeeCode',
    'codigo de empleado': 'employeeCode',
    'codigo colaborador': 'employeeCode',
    area: 'area',
    cargo: 'cargo',
    puesto: 'cargo',
    phone: 'phone',
    telefono: 'phone',
    celular: 'phone',
    movil: 'phone',
    address: 'address',
    direccion: 'address',
    domicilio: 'address',
    role: 'role',
    rol: 'role',
    perfil: 'role',
    coordinatoremail: 'coordinatorEmail',
    'email coordinador': 'coordinatorEmail',
    emailcoordinador: 'coordinatorEmail',
    'correo coordinador': 'coordinatorEmail',
    coordinador: 'coordinatorEmail',
    bankname: 'bankName',
    banco: 'bankName',
    'nombre banco': 'bankName',
    accountnumber: 'accountNumber',
    'numero cuenta': 'accountNumber',
    'numero de cuenta': 'accountNumber',
    cuenta: 'accountNumber',
    'nro cuenta': 'accountNumber',
    cci: 'cci',
    'codigo cci': 'cci',
    accounttype: 'accountType',
    'tipo cuenta': 'accountType',
    'tipo de cuenta': 'accountType',
    tipocuenta: 'accountType',
  }

  private mapBulkRow(raw: Record<string, any>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw)) {
      const field = UserService.BULK_HEADER_ALIASES[this.normalizeHeader(key)]
      if (field && value !== undefined && value !== null) {
        out[field] = String(value).trim()
      }
    }
    return out
  }

  /** Permisos por defecto según el rol (espejo de la creación manual en el front). */
  private defaultPermissionsForRole(roleName: string): IUserPermissions & {
    categoryIds: string[]
  } {
    const ALL_NON_COLAB = [
      'nueva-rendicion',
      'rendiciones',
      'viaticos',
      'consolidated-invoices',
      'tesoreria',
      'configuracion',
      'audit-log',
    ]
    switch (roleName) {
      case 'Coordinador':
        return {
          modules: ['rendiciones', 'viaticos', 'tesoreria'],
          canApproveL1: true,
          canApproveL2: false,
          categoryIds: [],
        }
      case 'Contabilidad':
        return {
          modules: ALL_NON_COLAB,
          canApproveL1: true,
          canApproveL2: true,
          categoryIds: [],
        }
      case 'Administrador':
        return {
          modules: ALL_NON_COLAB,
          canApproveL1: false,
          canApproveL2: false,
          categoryIds: [],
        }
      case 'Colaborador':
      default:
        return {
          modules: ['mis-rendiciones', 'nueva-rendicion', 'viaticos'],
          canApproveL1: false,
          canApproveL2: false,
          categoryIds: [],
        }
    }
  }

  async bulkImportUsers(
    rawRows: Array<Record<string, any>>,
    clientId: string
  ): Promise<{
    created: number
    skipped: string[]
    errors: string[]
    credentials: { name: string; email: string; temporaryPassword: string }[]
  }> {
    let created = 0
    const skipped: string[] = []
    const errors: string[] = []
    const credentials: {
      name: string
      email: string
      temporaryPassword: string
    }[] = []

    if (!clientId) {
      return {
        created,
        skipped,
        errors: ['No se pudo determinar la empresa destino'],
        credentials,
      }
    }
    const clientObjectId = new Types.ObjectId(clientId)

    const allowedRoles = [
      'Colaborador',
      'Coordinador',
      'Contabilidad',
      'Administrador',
    ]
    const roleCache = new Map<string, Types.ObjectId | null>()
    const resolveRole = async (
      name: string
    ): Promise<Types.ObjectId | null> => {
      const match = allowedRoles.find(
        r => r.toLowerCase() === name.toLowerCase()
      )
      const roleName = match || 'Colaborador'
      if (roleCache.has(roleName)) return roleCache.get(roleName)!
      const role = await this.roleService.getByName(roleName)
      const id = role ? ((role as any)._id as Types.ObjectId) : null
      roleCache.set(roleName, id)
      return id
    }

    const coordinatorCache = new Map<string, Types.ObjectId | null>()
    const resolveCoordinator = async (
      email: string
    ): Promise<Types.ObjectId | null> => {
      const key = email.toLowerCase()
      if (coordinatorCache.has(key)) return coordinatorCache.get(key)!
      const u = await this.userModel
        .findOne({ email: key, clientId: clientObjectId })
        .select('_id')
        .exec()
      const id = u ? u._id : null
      coordinatorCache.set(key, id)
      return id
    }

    let rowNumber = 1
    for (const raw of rawRows) {
      rowNumber++
      const row = this.mapBulkRow(raw)
      const email = (row.email || '').toLowerCase()
      try {
        if (!email) {
          errors.push(`Fila ${rowNumber}: sin email`)
          continue
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors.push(`Fila ${rowNumber} (${email}): email inválido`)
          continue
        }
        const exists = await this.userModel
          .findOne({ email, clientId: clientObjectId })
          .exec()
        if (exists) {
          skipped.push(email)
          continue
        }

        const roleName =
          allowedRoles.find(
            r => r.toLowerCase() === (row.role || '').toLowerCase()
          ) || 'Colaborador'
        const roleId = await resolveRole(roleName)
        if (!roleId) {
          errors.push(
            `Fila ${rowNumber} (${email}): rol "${roleName}" no existe`
          )
          continue
        }

        let coordinatorId: Types.ObjectId | undefined
        if (row.coordinatorEmail) {
          const coordId = await resolveCoordinator(row.coordinatorEmail)
          if (!coordId) {
            errors.push(
              `Fila ${rowNumber} (${email}): coordinador "${row.coordinatorEmail}" no encontrado en la empresa`
            )
            continue
          }
          coordinatorId = coordId
        }

        const accountType =
          row.accountType?.toLowerCase() === 'corriente'
            ? 'corriente'
            : row.accountType?.toLowerCase() === 'ahorros'
              ? 'ahorros'
              : undefined
        const bankAccount =
          row.bankName || row.accountNumber || row.cci
            ? {
                bankName: row.bankName || '',
                accountNumber: row.accountNumber || '',
                cci: row.cci || '',
                accountType: accountType || 'ahorros',
              }
            : undefined

        const temporaryPassword =
          Math.random().toString(36).slice(-8) +
          Math.random().toString(36).slice(-4).toUpperCase()
        const hashed = await bcrypt.hash(temporaryPassword, 10)

        const name = row.name || email
        await this.userModel.create({
          name,
          email,
          password: hashed,
          roleId,
          clientId: clientObjectId,
          mustChangePassword: true,
          permissions: this.defaultPermissionsForRole(roleName),
          ...(coordinatorId ? { coordinatorId } : {}),
          ...(row.dni ? { dni: row.dni } : {}),
          ...(row.employeeCode ? { employeeCode: row.employeeCode } : {}),
          ...(row.area ? { area: row.area } : {}),
          ...(row.cargo ? { cargo: row.cargo } : {}),
          ...(row.address ? { address: row.address } : {}),
          ...(row.phone ? { phone: row.phone } : {}),
          ...(bankAccount ? { bankAccount } : {}),
        })
        credentials.push({ name, email, temporaryPassword })
        created++
      } catch (e: any) {
        errors.push(
          `Fila ${rowNumber} (${email || 'sin email'}): ${e?.message || 'error desconocido'}`
        )
      }
    }
    return { created, skipped, errors, credentials }
  }

  async findAdminsByClient(clientId: string): Promise<UserDocument[]> {
    const roles = await this.roleService.getAdminRoles()
    const roleIds = roles.map(r => (r as any)._id)
    const superAdminRole = roles.find(r => r.name === 'Superadministrador')

    return this.userModel
      .find({
        $or: [
          { clientId: new Types.ObjectId(clientId) },
          { roleId: superAdminRole?._id, clientId: { $exists: false } },
          { roleId: superAdminRole?._id, clientId: null },
        ],
        roleId: { $in: roleIds },
        isActive: true,
      })
      .exec()
  }

  async deleteByClientId(clientId: string): Promise<void> {
    await this.userModel
      .deleteMany({ clientId: new Types.ObjectId(clientId) })
      .exec()
  }

  /** Retorna true solo si el usuario tiene notificaciones por correo habilitadas. */
  async isEmailEnabled(userId: string): Promise<boolean> {
    const u = await this.userModel
      .findById(userId)
      .select('emailNotificationsEnabled')
      .exec()
    return !!(u as any)?.emailNotificationsEnabled
  }

  async setEmailNotifications(userId: string, enabled: boolean): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, { emailNotificationsEnabled: enabled })
      .exec()
  }

  /** Retorna el coordinatorId del usuario, o null si no tiene coordinador asignado. */
  async findUserCoordinatorId(userId: string): Promise<Types.ObjectId | null> {
    const u = await this.userModel
      .findById(userId)
      .select('coordinatorId')
      .lean<{ coordinatorId?: Types.ObjectId }>()
      .exec()
    return u?.coordinatorId ?? null
  }

  /**
   * Usuarios de Administrador + Contabilidad de un cliente que tienen email habilitado.
   * Usados para enviar recordatorios semanales de rendiciones pendientes de contabilidad.
   */
  /**
   * Administradores + Contabilidad activos de un cliente.
   * Incluye `emailNotificationsEnabled` para que el caller decida si enviar correo.
   * El in-app se envía siempre; el correo solo si el flag está activo.
   */
  async findRendicionApprovalUsers(
    clientId: string
  ): Promise<{ _id: string; email: string; name: string; emailNotificationsEnabled: boolean }[]> {
    const [contabilidadRole, adminRoles] = await Promise.all([
      this.roleService.getByName('Contabilidad'),
      this.roleService.getAdminRoles(),
    ])

    const roleIds = [
      ...adminRoles.map(r => (r as any)._id),
      ...(contabilidadRole ? [(contabilidadRole as any)._id] : []),
    ]

    const users = await this.userModel
      .find({
        clientId: new Types.ObjectId(clientId),
        roleId: { $in: roleIds },
        isActive: true,
      })
      .select('_id email name emailNotificationsEnabled')
      .lean<{ _id: Types.ObjectId; email: string; name: string; emailNotificationsEnabled?: boolean }[]>()
      .exec()

    return users.map(u => ({
      _id: u._id.toString(),
      email: u.email,
      name: u.name,
      emailNotificationsEnabled: !!u.emailNotificationsEnabled,
    }))
  }
}
