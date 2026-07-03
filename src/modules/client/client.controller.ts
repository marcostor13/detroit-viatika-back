import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ClientService } from './client.service'
import { CreateClientDto } from './dto/create-client.dto'
import { UpdateClientDto } from './dto/update-client.dto'
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ClientOnboardingService } from './client-onboarding.service'
import { CreateClientWithUserDto } from './dto/create-client-with-user-sunat.dto'
import { UserService } from '../user/user.service'

@Controller('client')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientController {
  constructor(
    private readonly clientService: ClientService,
    private readonly clientOnboardingService: ClientOnboardingService,
    private readonly userService: UserService
  ) {}

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  create(@Body() createClientDto: CreateClientDto) {
    return this.clientService.create(createClientDto)
  }

  @Post('register-with-user')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async registerClientWithUser(@Body() payload: CreateClientWithUserDto) {
    return this.clientOnboardingService.registerClientWithUser(payload)
  }

  @Get()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  findAll() {
    return this.clientService.findAll()
  }

  @Get(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  findOne(@Param('id') id: string) {
    return this.clientService.findOne(id)
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  update(@Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.clientService.update(id, updateClientDto)
  }

  @Patch(':id/notification-settings')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  updateNotificationSettings(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationSettingsDto
  ) {
    return this.clientService.updateNotificationSettings(id, dto)
  }

  @Patch(':id/tesoreria-emails')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  updateTesoreriaEmails(
    @Param('id') id: string,
    @Body() body: { emails: string[] }
  ) {
    return this.clientService.updateTesoreriaEmails(id, body.emails ?? [])
  }

  @Delete(':id')
  @Roles(ROLES.SUPER_ADMIN)
  async remove(@Param('id') id: string) {
    await this.userService.deleteByClientId(id)
    return this.clientService.remove(id)
  }
}
