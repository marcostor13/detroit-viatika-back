import { BadRequestException, Injectable } from '@nestjs/common'
import { IUserResponse, UserService } from '../user/user.service'
import * as bcrypt from 'bcryptjs'
import { JwtService } from '@nestjs/jwt'
import { RegisterDto } from './dto/register.dto'
import { ClientService } from '../client/client.service'
import { ROLES } from './enums/roles.enum'

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private clientService: ClientService
  ) {}

  async register(registerDto: RegisterDto): Promise<any> {
    const { email, password, name, roleId, clientId } = registerDto
    const finalClientId = clientId && clientId !== '' ? clientId : null
    await this.userService.create({
      email,
      password,
      name,
      roleId,
      clientId: finalClientId as any,
    })
    return { message: 'Usuario creado correctamente' }
  }

  // Kept for LocalStrategy compatibility (used by other flows)
  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userService.findByEmail(email)
    if (user && (await bcrypt.compare(password, user.password as string))) {
      const { password: _, ...result } = user as any
      return result
    }
    return null
  }

  async login(email: string, password: string) {
    const allUsers = await this.userService.findAllByEmail(email)
    if (!allUsers.length)
      throw new BadRequestException('Credenciales inválidas')

    // Validate password against each user record (same email, different companies)
    const validUsers: IUserResponse[] = []
    for (const user of allUsers) {
      if (user.password && (await bcrypt.compare(password, user.password))) {
        validUsers.push(user)
      }
    }
    if (!validUsers.length)
      throw new BadRequestException('Credenciales inválidas')

    // Contabilidad: global role, issues hub token + returns all companies
    const contabilidadUser = validUsers.find(
      u => (u.role as any)?.name === ROLES.CONTABILIDAD
    )
    if (contabilidadUser) {
      if (contabilidadUser.isActive === false) return { isActive: false }
      const allClients = await this.clientService.findAll()
      const hubPayload = {
        email: contabilidadUser.email,
        userId: (contabilidadUser._id as any).toString(),
        roles: [(contabilidadUser.role as any)?.name],
        clientId: '',
        permissions: contabilidadUser.permissions || {
          modules: [],
          canApproveL1: false,
          canApproveL2: false,
          categoryIds: [],
        },
        mustChangePassword: !!contabilidadUser.mustChangePassword,
        isHubToken: true,
      }
      const hubToken = this.jwtService.sign(hubPayload)
      const { password: _, ...userData } = contabilidadUser as any
      return {
        requiresClientSelection: true,
        isContabilidad: true,
        access_token: hubToken,
        ...userData,
        mustChangePassword: !!contabilidadUser.mustChangePassword,
        companies: allClients.map((c: any) => ({
          clientId: c._id.toString(),
          name: c.comercialName || c.businessName,
          logo: c.logo || null,
        })),
      }
    }

    // Administrador: hub flow — can manage all companies
    const adminUser = validUsers.find(
      u => (u.role as any)?.name === ROLES.ADMIN
    )
    if (adminUser) {
      if (adminUser.isActive === false) return { isActive: false }
      const allClients = await this.clientService.findAll()
      const hubPayload = {
        email: adminUser.email,
        userId: (adminUser._id as any).toString(),
        roles: [ROLES.ADMIN],
        clientId: '',
        permissions: adminUser.permissions || {
          modules: [],
          canApproveL1: false,
          canApproveL2: false,
          categoryIds: [],
        },
        mustChangePassword: !!adminUser.mustChangePassword,
        isHubToken: true,
      }
      const hubToken = this.jwtService.sign(hubPayload)
      const { password: _, ...userData } = adminUser as any
      return {
        requiresClientSelection: true,
        isAdmin: true,
        access_token: hubToken,
        ...userData,
        mustChangePassword: !!adminUser.mustChangePassword,
        companies: allClients.map((c: any) => ({
          clientId: c._id.toString(),
          name: c.comercialName || c.businessName,
          logo: c.logo || null,
        })),
      }
    }

    // Filter inactive
    const activeUsers = validUsers.filter(u => u.isActive !== false)
    if (!activeUsers.length) return { isActive: false }

    // Single company user
    if (activeUsers.length === 1) {
      return this.issueToken(activeUsers[0])
    }

    // Multi-company: return hub for company selection (no JWT yet)
    return {
      requiresClientSelection: true,
      isContabilidad: false,
      email,
      companies: activeUsers
        .filter(u => u.client)
        .map(u => ({
          clientId: (u.client as any)?._id?.toString() || '',
          name:
            (u.client as any)?.comercialName ||
            (u.client as any)?.businessName ||
            'Empresa',
          logo: (u.client as any)?.logo || null,
        })),
    }
  }

  async selectClient(body: {
    hubToken?: string
    email?: string
    password?: string
    clientId: string
  }) {
    const { hubToken, email, password, clientId } = body

    if (hubToken) {
      // Contabilidad flow: validate hub token and issue scoped JWT
      let payload: any
      try {
        payload = this.jwtService.verify(hubToken)
      } catch {
        throw new BadRequestException('Token inválido o expirado')
      }
      if (!payload.isHubToken) throw new BadRequestException('Token inválido')
      const user = await this.userService.findOne(payload.userId)
      if (!user?._id) throw new BadRequestException('Usuario no encontrado')
      return this.issueToken(user, clientId)
    }

    // Regular multi-company: email + password + clientId
    if (!email || !password)
      throw new BadRequestException('Credenciales requeridas')
    const allUsers = await this.userService.findAllByEmail(email)
    const user = allUsers.find(
      u => (u.client as any)?._id?.toString() === clientId
    )
    if (!user)
      throw new BadRequestException('Usuario no encontrado para esta empresa')
    if (!user.password || !(await bcrypt.compare(password, user.password))) {
      throw new BadRequestException('Credenciales inválidas')
    }
    return this.issueToken(user)
  }

  async getHubCompanies() {
    const allClients = await this.clientService.findAll()
    return allClients.map((c: any) => ({
      clientId: c._id.toString(),
      name: c.comercialName || c.businessName,
      logo: c.logo || null,
    }))
  }

  private issueToken(user: IUserResponse, overrideClientId?: string) {
    const mustChangePassword = !!user.mustChangePassword
    const clientId =
      overrideClientId !== undefined
        ? overrideClientId
        : (user.client as any)?._id?.toString() || ''
    const payload = {
      email: user.email,
      userId: (user._id as any).toString(),
      roles: [(user.role as any)?.name],
      clientId,
      permissions: user.permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
        categoryIds: [],
      },
      mustChangePassword,
    }
    const { password: _, ...userData } = user as any
    return {
      access_token: this.jwtService.sign(payload),
      ...userData,
      mustChangePassword,
    }
  }
}
