import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ClientService } from './client.service'
import { UserService } from '../user/user.service'
import { EmailService } from '../email/email.service'
import { RoleService } from '../role/role.service'
import { CreateClientWithUserDto } from './dto/create-client-with-user-sunat.dto'
import { ROLES } from '../auth/enums/roles.enum'

@Injectable()
export class ClientOnboardingService {
  private readonly logger = new Logger(ClientOnboardingService.name)

  constructor(
    private readonly clientService: ClientService,
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly roleService: RoleService
  ) {}

  private splitName(fullName: string): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(' ')
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: '' }
    }
    const [firstName, ...rest] = parts
    return { firstName, lastName: rest.join(' ') }
  }

  async registerClientWithUser(payload: CreateClientWithUserDto) {
    const { client, adminUser } = payload

    this.logger.debug(
      `Iniciando registro de nuevo cliente con usuario: ${client.comercialName}`
    )
    this.logger.debug(
      `[DIAG] client payload recibido: email="${(client as any).email}" phone="${(client as any).phone}" address="${(client as any).address}"`
    )

    let createdClient: any
    let user: any

    // Buscar el rol ADMIN automáticamente
    const adminRole = await this.roleService.getByName(ROLES.ADMIN)
    if (!adminRole) {
      throw new NotFoundException(
        `No se encontró el rol ${ROLES.ADMIN} en el sistema`
      )
    }

    // 1. Crear cliente
    createdClient = await this.clientService.create(client)
    this.logger.debug(
      `[DIAG] cliente creado: email="${createdClient?.email}" phone="${createdClient?.phone}" address="${createdClient?.address}"`
    )

    // 2. Crear usuario administrador — userService.create() genera y hashea su propio password
    try {
      user = await this.userService.create({
        name: adminUser.name,
        email: adminUser.email,
        roleId: adminRole._id.toString(),
        clientId: createdClient._id.toString(),
        isActive: true,
        isCompanyAdmin: true,
        permissions: {
          modules: [
            'colaboradores',
            'rendiciones',
            'mis-rendiciones',
            'nueva-rendicion',
            'viaticos',
            'consolidated-invoices',
            'tesoreria',
            'configuracion',
            'audit-log',
          ],
          canApproveL1: true,
          canApproveL2: true,
        },
      })
    } catch (error) {
      // Rollback manual: eliminar el cliente recién creado
      await this.clientService
        .remove(createdClient._id.toString())
        .catch(() => {})
      this.logger.error(
        'Error creando usuario admin, cliente revertido:',
        error
      )
      throw error
    }

    // user.temporaryPassword es el password real que quedó hasheado en la BD
    const temporaryPassword: string = user.temporaryPassword

    // 3. Enviar correo de bienvenida con credenciales temporales (fuera de la transacción)
    try {
      const { firstName, lastName } = this.splitName(adminUser.name)
      await this.emailService.sendProviderWelcomeEmail(adminUser.email, {
        clientId: createdClient._id.toString(),
        firstName,
        lastName,
        password: temporaryPassword,
        loginUrl: this.emailService.buildAppUrl('/login'),
      })
    } catch (error) {
      this.logger.error(
        `Error al enviar correo de bienvenida al usuario administrador ${adminUser.email}:`,
        error
      )
      // No lanzamos el error para no afectar el flujo principal de creación
    }

    return {
      message: 'Cliente registrado correctamente con usuario',
      client: createdClient.toObject(),
      adminUser: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        temporaryPassword,
      },
    }
  }
}
