import { Test } from '@nestjs/testing'
import { PaymentBatchService } from './payment-batch.service'
import { AdvanceService } from '../advance.service'
import { ExpenseReportService } from '../../expense-report/expense-report.service'
import { ClientService } from '../../client/client.service'
import { toLatin1Buffer } from './bbva-format'

const CCI_BBVA = '00110057000267030775' // empieza 0011 → cuenta P
const CCI_OTRO = '00219110035563002151' // interbancaria → I

describe('PaymentBatchService', () => {
  let service: PaymentBatchService
  let advanceService: any
  let expenseReportService: any
  let clientService: any

  beforeEach(async () => {
    advanceService = {
      findBatchPayableAdvances: jest.fn().mockResolvedValue([]),
      registerPayment: jest.fn().mockResolvedValue({}),
    }
    expenseReportService = {
      findBatchPayableViaticos: jest.fn().mockResolvedValue([]),
      findPendingReimbursementsByClient: jest.fn().mockResolvedValue([]),
      registerViaticoPayment: jest.fn().mockResolvedValue({}),
      registerReimbursementPayment: jest.fn().mockResolvedValue({}),
    }
    clientService = {
      findOne: jest
        .fn()
        .mockResolvedValue({ comercialName: 'DETROIT', paymentAccount: '000110380350100056833' }),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentBatchService,
        { provide: AdvanceService, useValue: advanceService },
        { provide: ExpenseReportService, useValue: expenseReportService },
        { provide: ClientService, useValue: clientService },
      ],
    }).compile()
    service = moduleRef.get(PaymentBatchService)
  })

  describe('collectPendingPayments', () => {
    it('mezcla las 3 superficies y deriva tipo de cuenta I/P', async () => {
      advanceService.findBatchPayableAdvances.mockResolvedValue([
        {
          advanceId: 'a1',
          user: { name: 'RAUL CUBA', dni: '75162447', documentType: 'L', email: 'r@x.pe' },
          remaining: 304,
          cci: CCI_OTRO,
          bankName: 'BCP',
        },
      ])
      expenseReportService.findBatchPayableViaticos.mockResolvedValue([
        {
          reportId: 'v1',
          user: { name: 'ASTRID PENA', dni: '09831083', documentType: 'L', email: 'a@x.pe' },
          remaining: 249.8,
          cci: CCI_BBVA,
          bankName: 'BBVA',
        },
      ])
      expenseReportService.findPendingReimbursementsByClient.mockResolvedValue([
        {
          _id: 'r1',
          settlement: { difference: -171 },
          userId: {
            name: 'FIDEL TUESTA',
            dni: '06973600',
            documentType: 'L',
            email: 'f@x.pe',
            bankAccount: { cci: CCI_OTRO, bankName: 'BCP' },
          },
        },
      ])

      const { payable, excluded } = await service.collectPendingPayments('c1')
      expect(excluded).toHaveLength(0)
      expect(payable).toHaveLength(3)
      const advance = payable.find(p => p.kind === 'advance')!
      const viatico = payable.find(p => p.kind === 'viatico')!
      const reembolso = payable.find(p => p.kind === 'reembolso')!
      expect(advance.accountType).toBe('I')
      expect(viatico.accountType).toBe('P') // CCI empieza 0011
      expect(reembolso.amount).toBe(171)
      expect(reembolso.concepto).toBe('REEMBOLSO')
    })

    it('excluye beneficiarios sin DNI o con CCI inválido', async () => {
      advanceService.findBatchPayableAdvances.mockResolvedValue([
        { advanceId: 'a1', user: { name: 'SIN DNI', email: 'x@x.pe' }, remaining: 100, cci: CCI_OTRO },
        { advanceId: 'a2', user: { name: 'MAL CCI', dni: '123', email: 'y@x.pe' }, remaining: 50, cci: '123' },
      ])
      const { payable, excluded } = await service.collectPendingPayments('c1')
      expect(payable).toHaveLength(0)
      expect(excluded).toHaveLength(2)
      expect(excluded[0].reason).toMatch(/DNI/)
      expect(excluded[1].reason).toMatch(/CCI/)
    })
  })

  describe('generateTxt', () => {
    it('genera el archivo Latin-1 base64 con cabecera y detalle', async () => {
      advanceService.findBatchPayableAdvances.mockResolvedValue([
        {
          advanceId: 'a1',
          user: { name: 'RAUL CUBA CRUZ', dni: '75162447', documentType: 'L', email: 'NOTIFICACIONESDEPAGO@DETROIT.PE' },
          remaining: 304,
          cci: '00257011449545903106',
          bankName: 'IBK',
        },
      ])
      const res = await service.generateTxt('c1')
      expect(res.count).toBe(1)
      expect(res.totalSoles).toBe(304)
      const decoded = toLatin1Buffer(
        Buffer.from(res.fileBase64, 'base64').toString('latin1')
      ).toString('latin1')
      const lines = decoded.split('\r\n').filter(Boolean)
      expect(lines[0].startsWith('75')).toBe(true) // cabecera
      expect(lines[0].length).toBe(151)
      expect(lines[1].startsWith('002')).toBe(true) // detalle
      expect(lines[1].length).toBe(277)
    })

    it('falla si la empresa no tiene cuenta de cargo', async () => {
      clientService.findOne.mockResolvedValue({ comercialName: 'X', paymentAccount: '' })
      advanceService.findBatchPayableAdvances.mockResolvedValue([
        { advanceId: 'a1', user: { name: 'X', dni: '75162447', documentType: 'L', email: 'x@x.pe' }, remaining: 10, cci: CCI_OTRO },
      ])
      await expect(service.generateTxt('c1')).rejects.toThrow(/cuenta de cargo/)
    })

    it('falla si no hay pagos pagables', async () => {
      await expect(service.generateTxt('c1')).rejects.toThrow(/No hay pagos/)
    })
  })

  describe('reconcileFromPdf', () => {
    it('concilia por DNI+monto+nombre y marca pagado en la superficie correcta', async () => {
      advanceService.findBatchPayableAdvances.mockResolvedValue([
        {
          advanceId: 'a1',
          user: { name: 'RAUL CUBA CRUZ', dni: '75162447', documentType: 'L', email: 'r@x.pe' },
          remaining: 304,
          cci: CCI_OTRO,
        },
      ])
      const pdfText = [
        'No. Movimiento de Cargo 000025041 Fecha y Hora de Ejecución 02/06/2026 10:15',
        'RAUL CUBA CRUZ L - 75162447 304.00 ABONO ENVIADO',
      ].join('\n')
      jest.spyOn(service as any, 'extractPdfText').mockResolvedValue(pdfText)

      const res = await service.reconcileFromPdf('c1', Buffer.from('x'), {
        role: 'TESORERIA',
      })
      expect(res.operationNumber).toBe('000025041')
      expect(res.conciliados).toHaveLength(1)
      expect(res.conciliados[0].kind).toBe('advance')
      expect(advanceService.registerPayment).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ operationNumber: '000025041', method: 'transferencia_bancaria' }),
        'TESORERIA',
        undefined,
        { bypassReceipt: true }
      )
    })

    it('no marca pagado un abono rechazado y lista los no conciliados', async () => {
      advanceService.findBatchPayableAdvances.mockResolvedValue([
        {
          advanceId: 'a1',
          user: { name: 'RAUL CUBA CRUZ', dni: '75162447', documentType: 'L', email: 'r@x.pe' },
          remaining: 304,
          cci: CCI_OTRO,
        },
      ])
      const pdfText = [
        'RAUL CUBA CRUZ L - 75162447 304.00 ABONO RECHAZADO',
        'OTRO NOMBRE L - 99999999 500.00 ABONO ENVIADO',
      ].join('\n')
      jest.spyOn(service as any, 'extractPdfText').mockResolvedValue(pdfText)

      const res = await service.reconcileFromPdf('c1', Buffer.from('x'), { role: 'TESORERIA' })
      expect(res.conciliados).toHaveLength(0)
      expect(res.noAbonados).toHaveLength(1)
      expect(res.sinConciliar).toHaveLength(1) // el de 500 no tiene pendiente
      expect(advanceService.registerPayment).not.toHaveBeenCalled()
    })
  })

  describe('simulateReconcile', () => {
    it('marca como pagados todos los pendientes (simula el PDF de BBVA)', async () => {
      advanceService.findBatchPayableAdvances.mockResolvedValue([
        {
          advanceId: 'a1',
          user: { name: 'RAUL CUBA CRUZ', dni: '75162447', documentType: 'L', email: 'r@x.pe' },
          remaining: 304,
          cci: CCI_OTRO,
        },
      ])
      expenseReportService.findBatchPayableViaticos.mockResolvedValue([
        {
          reportId: 'v1',
          user: { name: 'ASTRID PENA', dni: '09831083', documentType: 'L', email: 'a@x.pe' },
          remaining: 249.8,
          cci: CCI_BBVA,
        },
      ])

      const res = await service.simulateReconcile('c1', { role: 'TESORERIA' })

      expect(res.conciliados).toHaveLength(2)
      expect(res.sinConciliar).toHaveLength(0)
      expect(res.noAbonados).toHaveLength(0)
      expect(res.operationNumber).toMatch(/^SIM\d+/)
      expect(advanceService.registerPayment).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ method: 'transferencia_bancaria', amount: 304 }),
        'TESORERIA',
        undefined,
        { bypassReceipt: true }
      )
      expect(expenseReportService.registerViaticoPayment).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ amount: 249.8 }),
        'TESORERIA',
        undefined,
        { bypassReceipt: true }
      )
    })

    it('falla si no hay pagos pendientes con datos completos', async () => {
      await expect(
        service.simulateReconcile('c1', { role: 'TESORERIA' })
      ).rejects.toThrow(/No hay pagos pendientes/)
    })
  })

  describe('confirmManual', () => {
    it('marca pagados los items indicados en su superficie', async () => {
      expenseReportService.findBatchPayableViaticos.mockResolvedValue([
        {
          reportId: 'v1',
          user: { name: 'ASTRID', dni: '09831083', documentType: 'L', email: 'a@x.pe' },
          remaining: 249.8,
          cci: CCI_BBVA,
        },
      ])
      const res = await service.confirmManual(
        'c1',
        [{ kind: 'viatico', id: 'v1' }],
        { operationNumber: 'OP1', paymentDate: '2026-06-02' },
        { role: 'TESORERIA' }
      )
      expect(res.pagados).toBe(1)
      expect(expenseReportService.registerViaticoPayment).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ operationNumber: 'OP1' }),
        'TESORERIA',
        undefined,
        { bypassReceipt: true }
      )
    })
  })
})
