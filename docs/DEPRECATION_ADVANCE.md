# Deprecación del módulo `Advance` (legado)

## Contexto

El sistema todavía no está en producción. A partir de la feature de aprobación por
centro de costo (roles Tesorería/Contabilidad, cadena de aprobadores por `Project`,
gate de Contabilidad, pago masivo BBVA), toda la lógica nueva se construyó
**exclusivamente sobre el flujo unificado `ExpenseReport` (`type='viatico'`)**
(`viatika-back/src/modules/expense-report/`). El módulo `advance/` (anticipos
legado, con su propia cadena de aprobadores basada en `User.approverIds`) queda
congelado: sigue funcionando tal cual para los registros que ya existan, pero
**no recibe ninguna de las funcionalidades nuevas** (aprobación por centro de
costo, gate de Contabilidad, pago exclusivo de Tesorería, pago masivo BBVA).

Este documento inventaria qué queda obsoleto para poder eliminarlo en una pasada
de limpieza posterior, una vez confirmado que no hay datos reales que conservar
en la colección `advances`.

---

## Colección Mongo obsoleta

- **`advances`** (modelo `Advance`, `viatika-back/src/modules/advance/entities/advance.entity.ts`).

No eliminar hasta confirmar que no hay anticipos históricos que el negocio
necesite conservar (aunque sea solo para consulta/auditoría).

---

## Bloqueante antes de borrar: tipos y utilidades compartidas

Estos dos archivos viven físicamente dentro de `advance/` pero los usa también
el flujo unificado. **Hay que moverlos a un lugar compartido antes de poder
borrar el módulo `advance/`**, o el flujo `viatico` deja de compilar.

1. **`viatika-back/src/modules/advance/entities/advance.entity.ts`** exporta
   interfaces reutilizadas por
   `viatika-back/src/modules/expense-report/entities/expense-report.entity.ts`:
   - `AdvanceLineItem`
   - `AdvancePayment`
   - `ApprovalEntry`
   - `CoordinatorNotificationLog`
   - `PaymentInfo`
   - `ReturnRecord`

   Mover a un archivo compartido (ej. `expense-report/entities/shared-approval.types.ts`
   o `common/entities/`) antes de eliminar el módulo.

2. **`viatika-back/src/modules/advance/approval-chain.util.ts`** — motor de
   cadena de aprobación genérico. Lo usa **tanto** `advance.service.ts` como
   `expense-report.service.ts` (incluida la función nueva `combineCostCenterChain`,
   agregada para la cadena por centro de costo). Mover fuera de `advance/`
   (ej. a `expense-report/` o a un módulo `common/`) antes de borrar.

---

## Backend obsoleto (una vez movido lo anterior)

- `viatika-back/src/modules/advance/advance.service.ts` (~2400 líneas: cadena
  por `approverIds`, registro de pago, devoluciones, liquidación — todo
  reemplazado por sus equivalentes en `expense-report.service.ts`).
- `viatika-back/src/modules/advance/advance.controller.ts` — endpoints a
  retirar y su reemplazo ya existente en `expense-report.controller.ts`:

  | Endpoint `advance` (legado) | Reemplazo unificado |
  |---|---|
  | `POST /advance` | `POST /expense-report/viatico` |
  | `GET /advance/client/:clientId` | `GET /expense-report/client/:clientId` |
  | `GET /advance/viaticos/list` | (bandeja unificada vía `findAllByClient`) |
  | `GET /advance/:id` | `GET /expense-report/:id` |
  | `PATCH /advance/:id/approve` | `PATCH /expense-report/:id/viatico/approve` |
  | `PATCH /advance/:id/reject` | `PATCH /expense-report/:id/viatico/reject` |
  | `PATCH /advance/:id/resubmit` | `PATCH /expense-report/:id/viatico/resubmit` |
  | `PATCH /advance/:id/register-payment` | `PATCH /expense-report/:id/viatico/register-payment` |
  | `PATCH /advance/:id/return*` | Sin equivalente directo — revisar si el flujo unificado ya cubre devoluciones de saldo antes de retirar |
  | `PATCH /advance/:id/cancel` | Revisar equivalente en `expense-report` |
  | `DELETE /advance/:id` | Revisar equivalente en `expense-report` |

  No existe todavía `PATCH /expense-report/:id/viatico/contabilidad-approve`
  en el módulo legado — es exclusivo del flujo unificado (gate de Contabilidad).

- `viatika-back/src/modules/advance/advance.module.ts`
- `viatika-back/src/modules/advance/dto/*` (`create-advance.dto.ts`,
  `resubmit-advance.dto.ts`, `approve-advance.dto.ts`, `pay-advance.dto.ts`, etc.)
  — ojo: `CreateAdvanceLineDto` (en `create-advance.dto.ts`) también lo
  reutilizan los DTOs de `expense-report` (`create-viatico-expense-report.dto.ts`,
  `resubmit-viatico.dto.ts`) — moverlo junto con lo demás compartido.

---

## Frontend a migrar/retirar

Todos estos componentes/servicios consumen los endpoints `advance` legado y
seguirán funcionando solo para ver/gestionar registros ya existentes en la
colección `advances`:

- `viatika/src/app/modules/mis-rendiciones/solicitud-viaticos-modal/` —
  modal para crear/reenviar un `Advance` desde el detalle de una rendición.
  Reemplazo: pantalla unificada `/mis-rendiciones/solicitud-viaticos/nueva`
  (`solicitud-viaticos.component.ts`).
- `viatika/src/app/modules/viaticos/viaticos-detail/` (ruta `/viaticos/:id`,
  guard `AuthViaticosGuard` en `viatika/src/app/guards/auth-viaticos.guard.ts`)
  — detalle de un `Advance` legado, con export PDF/Excel del desglose por
  categoría. Reemplazo: detalle del `ExpenseReport` tipo viatico (dentro de
  `mis-rendiciones`/`rendiciones-admin`/`viaticos.component.ts`).
- `viatika/src/app/modules/tesoreria/tesoreria-detalle/` — detalle de pago de
  un `Advance` legado. El flujo unificado gestiona el pago inline en
  `tesoreria.component.ts` (`openViaticoPaymentModal`), sin pantalla de detalle
  separada.
- `viatika/src/app/services/advance.service.ts` — servicio Angular que
  consume todos los endpoints `advance/*`. Antes de retirarlo, confirmar que
  ningún componente lo siga usando (grep `AdvanceService` al momento de
  ejecutar la limpieza).
- `viatika/src/app/interfaces/advance.interface.ts` — mantiene `IAdvanceLine`
  (usado solo para lectura histórica en `viaticos-detail`/`tesoreria-detalle`)
  y los payloads de creación (`ICreateAdvancePayload`, ya sin `lines`).

**Nota**: `tesoreria.component.ts` (pantalla principal de Tesorería) consume
**ambos** mundos hoy (`AdvanceService` + `ExpenseReportsService`) porque
todavía puede haber anticipos legado pendientes de pago. Al planear el retiro,
confirmar primero que la bandeja de pagos ya no tiene items `source==='advance'`
pendientes antes de quitar esa rama de código.

---

## Checklist de eliminación (orden recomendado)

1. Mover `AdvanceLineItem`/`AdvancePayment`/`ApprovalEntry`/`CoordinatorNotificationLog`/
   `PaymentInfo`/`ReturnRecord` y `approval-chain.util.ts` (incluida
   `combineCostCenterChain`) fuera de `advance/` a una ubicación compartida.
2. Actualizar los imports en `expense-report.entity.ts` y
   `expense-report.service.ts` para apuntar a la nueva ubicación.
3. Confirmar que no quedan solicitudes `Advance` en estado activo
   (`pending_l1`, `pending_l2`, `approved`, `partially_paid`) en la base real
   — si las hay, esperar a que se liquiden o migrarlas al modelo `ExpenseReport`
   antes de continuar.
4. Migrar/retirar los consumidores frontend listados arriba
   (`solicitud-viaticos-modal`, `viaticos-detail`, `tesoreria-detalle`,
   la rama `source==='advance'` de `tesoreria.component.ts`).
5. Retirar las rutas `advance/*` del `AdvanceController` y de
   `viatika/src/app/services/advance.service.ts`.
6. Borrar `viatika-back/src/modules/advance/` (ya sin nada compartido dentro).
7. Eliminar la colección `advances` de Mongo (paso final, solo tras confirmar
   que no hace falta conservar el histórico).
