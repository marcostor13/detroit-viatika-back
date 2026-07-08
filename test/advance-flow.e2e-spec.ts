import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import * as bcrypt from 'bcryptjs'
import * as request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from '../src/app.module'
import { User, UserDocument } from '../src/modules/user/schemas/user.schema'

const SUPERADMIN_EMAIL = 'admin@viatika.com'
const SUPERADMIN_PASSWORD = '@Libido2010'

describe('Advance approval flow (e2e)', () => {
  let app: INestApplication<App>
  let superadminToken: string
  let clientId: string
  let colaboradorToken: string
  let advanceId: string

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('api')
    await app.init()

    const superadminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD })
      .expect(200)
    superadminToken = superadminLogin.body.access_token
    expect(superadminToken).toBeDefined()

    const clientRes = await request(app.getHttpServer())
      .post('/api/client')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        codigo: 'E2E01',
        comercialName: 'Cliente E2E',
        businessName: 'Cliente E2E SAC',
        businessId: '20123456789',
      })
      .expect(201)
    clientId = clientRes.body._id
    expect(clientId).toBeDefined()

    const rolesRes = await request(app.getHttpServer())
      .get('/api/role')
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200)
    const colaboradorRole = rolesRes.body.find(
      (r: { name: string }) => r.name === 'Colaborador'
    )
    expect(colaboradorRole).toBeDefined()

    // POST /auth/register no sirve para dejar al usuario con una contraseña
    // conocida: UserService.create() ignora la contraseña recibida y genera
    // una temporal aleatoria que auth.service.register() ni siquiera devuelve
    // en la respuesta. Se siembra el usuario directamente por el modelo.
    const userModel = moduleFixture.get<Model<UserDocument>>(
      getModelToken(User.name)
    )
    const hashedPassword = await bcrypt.hash('Password123', 10)
    await userModel.create({
      email: 'colaborador.e2e@viatika.com',
      name: 'Colaborador E2E',
      password: hashedPassword,
      clientId: new Types.ObjectId(clientId),
      roleId: new Types.ObjectId(colaboradorRole._id),
      isActive: true,
      // El colaborador necesita al menos un aprobador asignado para poder
      // solicitar un anticipo (approval-chain.util.ts::buildApproverChain).
      // El superadmin actúa como aprobador comodín en cualquier nivel.
      approverIds: [new Types.ObjectId(superadminLogin.body._id)],
    })

    const colaboradorLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'colaborador.e2e@viatika.com', password: 'Password123' })
      .expect(200)
    colaboradorToken = colaboradorLogin.body.access_token
    expect(colaboradorToken).toBeDefined()
  })

  afterAll(async () => {
    await app.close()
  })

  it('colaborador creates an advance under the L1 threshold', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/advance')
      .set('Authorization', `Bearer ${colaboradorToken}`)
      .send({ amount: 300, description: 'Viaje a Trujillo' })
      .expect(201)

    advanceId = res.body._id
    expect(advanceId).toBeDefined()
    expect(res.body.status).toBe('pending_l1')
    expect(res.body.amount).toBe(300)
  })

  it('colaborador can read their own advance', async () => {
    await request(app.getHttpServer())
      .get(`/api/advance/${advanceId}`)
      .set('Authorization', `Bearer ${colaboradorToken}`)
      .expect(200)
  })

  it('superadmin approves the advance (L1, threshold <= 500)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/advance/${advanceId}/approve`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ notes: 'Aprobado en e2e' })
      .expect(200)

    expect(res.body.status).toBe('approved')
  })

  it('superadmin registers the payment in cash', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/advance/${advanceId}/register-payment`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({ method: 'efectivo', transferDate: '2026-01-15' })
      .expect(200)

    expect(res.body.status).toBe('paid')
  })

  it('reflects the final paid state on read', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/advance/${advanceId}`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .expect(200)

    expect(res.body.status).toBe('paid')
  })
})
