# Notificaciones por correo — deshabilitadas temporalmente

Las notificaciones están desactivadas mediante la variable de entorno `EMAILS_ENABLED=false`.

## Cómo funciona

En `src/modules/email/email.service.ts` todos los envíos pasan por el método privado `send()`.
Cuando `EMAILS_ENABLED === 'false'`, el método registra un debug log y retorna sin enviar.

## Para volver a habilitar

### Opción A — Quitar la variable (recomendado en producción)

Eliminar `EMAILS_ENABLED` del entorno (o darle cualquier valor distinto de `'false'`).
Sin la variable, `send()` envía normalmente.

### Opción B — Setear explícitamente en `.env`

```env
EMAILS_ENABLED=true
```

### Opción C — Eliminar la restricción permanentemente

Si ya no se necesita el interruptor, remover el método `send()` en `email.service.ts` y revertir todas las llamadas de `this.send({` a `this.mailerService.sendMail({`.

## Estado actual de la variable en cada entorno

| Archivo | Variable | Estado |
|---------|----------|--------|
| `.env` (local) | `EMAILS_ENABLED` | debe estar en `false` para deshabilitar |
| Producción / Docker | variable de entorno del contenedor | debe estar en `false` para deshabilitar |

## Métodos afectados (todos en `email.service.ts`)

Todos los métodos `send*` del servicio pasan por el wrapper. El cambio cubre:

- `sendCodeConfirmation`
- `sendInvoiceNotification`
- `sendPaymentScheduledNotification`
- `sendAccountingDecisionNotification`
- `sendActaNotification`
- `sendInvoiceUploadedNotification`
- `sendActaUploadedNotification`
- `sendInvoiceUploadedExpenseNotification`
- `sendInvoiceApprovedNotification`
- `sendInvoiceRejectedNotification`
- `sendInvoiceDecisionNotification`
- `sendProviderWelcomeEmail`
- `sendRendicionFullyApprovedEmail`
- `sendRendicionSubmitted`
- `sendViaticoRechazoColaborador`
- `sendViaticoPendienteL2`
- `sendViaticoAprobacionContabilidad`
- `sendViaticoSolicitudToCoordinator`
- `sendViaticoCancelacion`
- `sendRendicionReembolsoContabilidad`
- `sendRendicionReembolsoPagado`
- `sendViaticoPagoRealizado`
- `sendRendicionCerrada`
- `sendRendicionDevolucionColaborador`
- `sendRendicionDevolucionCargada`
- `sendRendicionCancelada`
- `sendDevolucionPendiente`
- `sendDevolucionValidada`
- `sendDevolucionRechazada`
- `sendCajaChicaCreada`
- `sendCajaChicaFondeada`
