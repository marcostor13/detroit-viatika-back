# Viatika Backend — Documentación de API

> **Base URL**: `/api`
> **Autenticación**: JWT Bearer Token
> **Base de datos**: MongoDB
> **Roles disponibles**: `SUPER_ADMIN`, `ADMIN`

---

## Tabla de Contenidos

1. [Autenticación](#1-autenticación---apiauth)
2. [Clientes](#2-clientes---apiclient)
3. [Usuarios](#3-usuarios---apiuser)
4. [Roles](#4-roles---apirole)
5. [Proyectos](#5-proyectos---apiproject)
6. [Categorías](#6-categorías---apicategory)
7. [Gastos (Expenses)](#7-gastos-expenses---apiexpense)
8. [Facturas (Invoices)](#8-facturas-invoices---apiinvoices)
9. [Configuración SUNAT](#9-configuración-sunat---apisunat-config)
10. [Emails](#10-emails---apiemail)
11. [Archivos (Upload)](#11-archivos-upload---apiupload)
12. [Health Check](#12-health-check)
13. [Configuración Global](#13-configuración-global)

---

## 1. Autenticación — `/api/auth`

### POST `/api/auth/register`
Registra un nuevo usuario.

**Body:**
```json
{
  "name": "Juan Pérez",
  "email": "juan@empresa.com",
  "password": "secret123",
  "roleId": "64a1b2c3d4e5f6a7b8c9d0e1",
  "clientId": "64a1b2c3d4e5f6a7b8c9d0e2"
}
```

| Campo | Tipo | Requerido | Reglas |
|-------|------|-----------|--------|
| `name` | string | Sí | — |
| `email` | string | Sí | Formato email válido |
| `password` | string | Sí | Mínimo 6 caracteres |
| `roleId` | string | Sí | MongoDB ObjectId |
| `clientId` | string | No | MongoDB ObjectId |

**Respuesta:**
```json
{
  "_id": "64a1b2c3...",
  "name": "Juan Pérez",
  "email": "juan@empresa.com",
  "token": "eyJhbGci..."
}
```

---

### POST `/api/auth/login`
Inicia sesión con email y contraseña.

**Body:**
```json
{
  "email": "juan@empresa.com",
  "password": "secret123"
}
```

**Respuesta:**
```json
{
  "access_token": "eyJhbGci...",
  "user": {
    "_id": "64a1b2c3...",
    "name": "Juan Pérez",
    "email": "juan@empresa.com",
    "role": { "name": "ADMIN" }
  }
}
```

---

### GET `/api/auth/profile`
Obtiene el perfil del usuario autenticado.

**Auth**: `Bearer <token>` requerido

**Respuesta:**
```json
{
  "_id": "64a1b2c3...",
  "name": "Juan Pérez",
  "email": "juan@empresa.com",
  "role": { "_id": "...", "name": "ADMIN" },
  "client": { "_id": "...", "comercialName": "Mi Empresa" }
}
```

---

### GET `/api/auth/google`
Inicia el flujo OAuth con Google. Redirige a Google login.

---

### GET `/api/auth/google/callback`
Callback de Google OAuth. Devuelve token JWT.

**Query Params**: `code` (provisto por Google automáticamente)

---

## 2. Clientes — `/api/client`

> **Auth requerida**: JWT + RolesGuard

### POST `/api/client`
Crea un nuevo cliente/empresa.

**Roles**: `SUPER_ADMIN`

**Body:**
```json
{
  "comercialName": "Tech Corp",
  "businessName": "Tech Corporation S.A.C.",
  "businessId": "20123456789",
  "address": "Av. Javier Prado 1234, Lima",
  "phone": "+51 999 888 777",
  "email": "contacto@techcorp.com",
  "logo": "https://storage.example.com/logos/techcorp.png"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `comercialName` | string | Sí |
| `businessName` | string | Sí |
| `businessId` | string | Sí (RUC) |
| `address` | string | Sí |
| `phone` | string | Sí |
| `email` | string | Sí |
| `logo` | string | Sí (URL) |

**Respuesta (201):**
```json
{
  "_id": "64a1b2c3...",
  "comercialName": "Tech Corp",
  "businessName": "Tech Corporation S.A.C.",
  "businessId": "20123456789",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

---

### POST `/api/client/register-with-user`
Crea un cliente y su usuario administrador simultáneamente.

**Roles**: `SUPER_ADMIN`

**Body:**
```json
{
  "client": {
    "comercialName": "Tech Corp",
    "businessName": "Tech Corporation S.A.C.",
    "businessId": "20123456789",
    "address": "Av. Javier Prado 1234",
    "phone": "+51 999 888 777",
    "email": "contacto@techcorp.com",
    "logo": "https://storage.example.com/logo.png"
  },
  "adminUser": {
    "name": "Admin Principal",
    "email": "admin@techcorp.com"
  }
}
```

**Respuesta (201):**
```json
{
  "client": { "_id": "...", "comercialName": "Tech Corp" },
  "user": { "_id": "...", "name": "Admin Principal", "email": "admin@techcorp.com" }
}
```

---

### GET `/api/client`
Lista todos los clientes.

**Roles**: `SUPER_ADMIN`

**Respuesta:**
```json
[
  {
    "_id": "64a1b2c3...",
    "comercialName": "Tech Corp",
    "businessName": "Tech Corporation S.A.C.",
    "businessId": "20123456789"
  }
]
```

---

### GET `/api/client/:id`
Obtiene un cliente específico.

**Roles**: `SUPER_ADMIN`, `ADMIN`

**Path Params**: `id` — Client ID

---

### PATCH `/api/client/:id`
Actualiza información de un cliente.

**Roles**: `SUPER_ADMIN`, `ADMIN`

**Body** (todos los campos opcionales):
```json
{
  "comercialName": "Tech Corp Actualizado",
  "phone": "+51 111 222 333"
}
```

---

### DELETE `/api/client/:id`
Elimina un cliente.

**Roles**: `SUPER_ADMIN`

---

## 3. Usuarios — `/api/user`

> **Auth requerida**: JWT + RolesGuard

### POST `/api/user`
Crea un nuevo usuario.

**Roles**: `SUPER_ADMIN`, `ADMIN`

**Body:**
```json
{
  "name": "María González",
  "email": "maria@empresa.com",
  "password": "pass123",
  "roleId": "64a1b2c3d4e5f6a7b8c9d0e1",
  "clientId": "64a1b2c3d4e5f6a7b8c9d0e2",
  "isActive": true
}
```

| Campo | Tipo | Requerido | Reglas |
|-------|------|-----------|--------|
| `name` | string | Sí | — |
| `email` | string | Sí | Único, formato válido |
| `password` | string | Sí | Mínimo 6 caracteres |
| `roleId` | string | Sí | MongoDB ObjectId |
| `clientId` | string | Sí | MongoDB ObjectId |
| `isActive` | boolean | No | Default: `true` |

---

### GET `/api/user`
Lista todos los usuarios con información de cliente.

**Roles**: `SUPER_ADMIN`

---

### GET `/api/user/:clientId`
Lista todos los usuarios de un cliente.

**Roles**: `SUPER_ADMIN`, `ADMIN`

**Path Params**: `clientId` — MongoDB ObjectId

---

### GET `/api/user/:id/:clientId`
Obtiene un usuario específico.

**Roles**: `SUPER_ADMIN`, `ADMIN`

**Path Params**: `id`, `clientId`

---

### PATCH `/api/user/:id`
Actualiza información de un usuario.

**Roles**: `SUPER_ADMIN`, `ADMIN`

**Body** (todos los campos opcionales):
```json
{
  "name": "María González Actualizada",
  "email": "maria.nueva@empresa.com",
  "roleId": "64a1b2c3...",
  "isActive": false
}
```

---

### DELETE `/api/user/:id`
Elimina un usuario.

**Roles**: `SUPER_ADMIN`, `ADMIN`

---

## 4. Roles — `/api/role`

> **Auth requerida**: JWT + RolesGuard (`SUPER_ADMIN`)

### POST `/api/role`
Crea un nuevo rol.

**Body:** `{}` *(DTO actualmente vacío, expandible)*

---

### GET `/api/role`
Lista todos los roles (excluye SUPER_ADMIN).

**Respuesta:**
```json
[
  { "_id": "64a1b2c3...", "name": "ADMIN" }
]
```

---

### GET `/api/role/with-super-admin`
Lista todos los roles incluyendo SUPER_ADMIN.

---

### GET `/api/role/:id`
Obtiene un rol específico.

---

### PATCH `/api/role/:id`
Actualiza un rol.

---

### DELETE `/api/role/:id`
Elimina un rol.

---

## 5. Proyectos — `/api/project`

> **Auth requerida**: JWT + RolesGuard (`SUPER_ADMIN`, `ADMIN`)

### POST `/api/project`
Crea un nuevo proyecto.

**Body:**
```json
{
  "name": "Proyecto Transformación Digital",
  "clientId": "64a1b2c3d4e5f6a7b8c9d0e2"
}
```

---

### GET `/api/project/:clientId`
Lista todos los proyectos de un cliente.

---

### GET `/api/project/:id/:clientId`
Obtiene un proyecto específico.

---

### PATCH `/api/project/:id/:clientId`
Actualiza un proyecto.

**Body** (campos opcionales):
```json
{
  "name": "Proyecto Actualizado"
}
```

---

### DELETE `/api/project/:id/:clientId`
Elimina un proyecto.

---

## 6. Categorías — `/api/category`

> **Auth requerida**: JWT + RolesGuard (`SUPER_ADMIN`, `ADMIN`)

### POST `/api/category`
Crea una nueva categoría de gasto.

**Body:**
```json
{
  "name": "Viáticos",
  "key": "viaticos",
  "description": "Gastos de viaje y alimentación",
  "isActive": true,
  "clientId": "64a1b2c3d4e5f6a7b8c9d0e2"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `name` | string | Sí |
| `key` | string | No (identificador único) |
| `description` | string | No |
| `isActive` | boolean | No (default: `true`) |
| `clientId` | string | Sí |

---

### GET `/api/category/:clientId`
Lista todas las categorías de un cliente.

---

### GET `/api/category/:id/:clientId`
Obtiene una categoría específica.

---

### GET `/api/category/key/:key/:clientId`
Obtiene una categoría por su clave única.

**Ejemplo**: `GET /api/category/key/viaticos/64a1b2c3...`

---

### PATCH `/api/category/:id/:clientId`
Actualiza una categoría.

**Body** (campos opcionales):
```json
{
  "name": "Viáticos y Transporte",
  "isActive": false
}
```

---

### DELETE `/api/category/:id/:clientId`
Elimina una categoría.

---

## 7. Gastos (Expenses) — `/api/expense`

> **Auth requerida**: JWT + RolesGuard (`SUPER_ADMIN`, `ADMIN`)

### POST `/api/expense/analyze-image`
Analiza un gasto desde una URL de imagen usando IA.

**Body:**
```json
{
  "proyectId": "64a1b2c3...",
  "categoryId": "64a1b2c3...",
  "imageUrl": "https://storage.example.com/receipts/receipt001.jpg",
  "clientId": "64a1b2c3..."
}
```

**Respuesta:**
```json
{
  "_id": "64a1b2c3...",
  "total": 150.00,
  "data": "{\"ruc\":\"20123456789\",\"serie\":\"F001\",\"correlativo\":\"00001234\"}",
  "status": "sunat_valid",
  "imageUrl": "https://..."
}
```

---

### POST `/api/expense/analize-pdf`
Analiza un gasto desde un archivo PDF.

**Content-Type**: `multipart/form-data`

**Form Data:**
| Campo | Tipo | Requerido |
|-------|------|-----------|
| `file` | File (PDF) | Sí |
| `proyectId` | string | Sí |
| `categoryId` | string | Sí |
| `imageUrl` | string | Sí |
| `clientId` | string | No |

---

### POST `/api/expense`
Crea un registro de gasto manualmente.

**Body:**
```json
{
  "proyectId": "64a1b2c3d4e5f6a7b8c9d0e1",
  "categoryId": "64a1b2c3d4e5f6a7b8c9d0e2",
  "imageUrl": "https://storage.example.com/receipts/receipt001.jpg",
  "clientId": "64a1b2c3d4e5f6a7b8c9d0e3",
  "total": 250.50,
  "status": "pending",
  "userId": "64a1b2c3d4e5f6a7b8c9d0e4"
}
```

**Valores de `status`:**
- `pending` — Pendiente de revisión
- `approved` — Aprobado
- `rejected` — Rechazado
- `sunat_valid` — Validado en SUNAT (pertenece al cliente)
- `sunat_valid_not_ours` — Validado en SUNAT (no pertenece al cliente)
- `sunat_not_found` — No encontrado en SUNAT
- `sunat_error` — Error al consultar SUNAT

---

### GET `/api/expense/:clientId`
Lista todos los gastos de un cliente.

**Path Params**: `clientId`

**Query Params (opcionales):**
| Param | Tipo | Descripción |
|-------|------|-------------|
| `sortBy` | string | Campo de ordenamiento |
| `sortOrder` | `asc` \| `desc` | Dirección del ordenamiento |

---

### GET `/api/expense/invoice/:id`
Obtiene un gasto específico.

---

### GET `/api/expense/invoice/:id/sunat-validation`
Obtiene los detalles de validación SUNAT de un gasto.

**Respuesta:**
```json
{
  "rucEmisor": "20123456789",
  "serie": "F001",
  "correlativo": "00001234",
  "fechaEmision": "2024-01-15",
  "montoTotal": 250.50,
  "sunatStatus": "VALID",
  "validatedAt": "2024-01-15T10:30:00Z"
}
```

---

### GET `/api/expense/test-sunat-credentials/:clientId`
Verifica que las credenciales SUNAT del cliente estén funcionando.

---

### PATCH `/api/expense/invoice/:id`
Actualiza información de un gasto.

**Body** (todos los campos opcionales):
```json
{
  "proyectId": "64a1b2c3...",
  "categoryId": "64a1b2c3...",
  "total": 300.00,
  "description": "Almuerzo de trabajo",
  "fechaEmision": "2024-01-15",
  "status": "approved",
  "rejectionReason": null
}
```

---

### PATCH `/api/expense/invoice/:id/approve`
Aprueba un gasto.

**Body:**
```json
{
  "status": "approved",
  "userId": "64a1b2c3...",
  "reason": "Gasto válido y dentro del presupuesto"
}
```

---

### PATCH `/api/expense/invoice/:id/reject`
Rechaza un gasto.

**Body:**
```json
{
  "status": "rejected",
  "userId": "64a1b2c3...",
  "reason": "No corresponde a la categoría indicada"
}
```

---

### POST `/api/expense/invoice/:id/validate-sunat`
Valida un gasto contra la API de SUNAT.

**Body:**
```json
{
  "rucEmisor": "20123456789",
  "serie": "F001",
  "correlativo": "00001234",
  "fechaEmision": "2024-01-15",
  "montoTotal": 250.50,
  "clientId": "64a1b2c3...",
  "tipoComprobante": "01"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `rucEmisor` | string | Sí |
| `serie` | string | Sí |
| `correlativo` | string | Sí |
| `fechaEmision` | string | Sí (YYYY-MM-DD) |
| `montoTotal` | number | No |
| `clientId` | string | No |
| `tipoComprobante` | string | No |

**Respuesta:**
```json
{
  "success": true,
  "sunatStatus": "VALID",
  "data": { ... }
}
```

---

### DELETE `/api/expense/invoice/:id`
Elimina un gasto.

---

## 8. Facturas (Invoices) — `/api/invoices`

> **Auth requerida**: JWT + RolesGuard (`SUPER_ADMIN`, `ADMIN`)

### GET `/api/invoices/token-sunat`
Genera un token de autenticación para SUNAT.

**Respuesta:**
```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

---

### POST `/api/invoices/validate-from-image`
Valida una factura desde imagen o PDF subido.

**Content-Type**: `multipart/form-data`

| Campo | Tipo | Requerido | Límites |
|-------|------|-----------|---------|
| `invoiceImage` | File | Sí | Max 10MB; tipos: jpg, png, gif, pdf, xml |

**Respuesta:**
```json
{
  "valid": true,
  "invoiceData": {
    "ruc": "20123456789",
    "serie": "F001",
    "numero": "00001234",
    "fechaEmision": "2024-01-15",
    "total": 590.00
  }
}
```

---

### POST `/api/invoices`
Crea un nuevo registro de factura.

**Body:**
```json
{
  "clientId": "64a1b2c3...",
  "projectId": "64a1b2c3...",
  "invoiceNumber": "F001-00001234",
  "issueDate": "2024-01-15T00:00:00Z",
  "dueDate": "2024-02-15T00:00:00Z",
  "items": [
    {
      "description": "Servicio de consultoría",
      "quantity": 10,
      "unitPrice": 50.00,
      "subtotal": 500.00
    }
  ],
  "subtotal": 500.00,
  "taxRate": 18,
  "taxAmount": 90.00,
  "total": 590.00,
  "status": "PENDING",
  "notes": "Factura por servicios de enero"
}
```

| Campo | Tipo | Requerido | Reglas |
|-------|------|-----------|--------|
| `invoiceNumber` | string | Sí | — |
| `issueDate` | Date | Sí | — |
| `dueDate` | Date | Sí | — |
| `items` | array | Sí | Al menos 1 ítem |
| `items[].description` | string | Sí | — |
| `items[].quantity` | number | Sí | ≥ 0 |
| `items[].unitPrice` | number | Sí | ≥ 0 |
| `items[].subtotal` | number | Sí | ≥ 0 |
| `subtotal` | number | Sí | ≥ 0 |
| `taxRate` | number | Sí | ≥ 0 |
| `taxAmount` | number | Sí | ≥ 0 |
| `total` | number | Sí | ≥ 0 |
| `status` | enum | No | `PENDING`, `APPROVED`, `REJECTED` |
| `clientId` | string | No | MongoDB ObjectId |
| `projectId` | string | No | MongoDB ObjectId |
| `notes` | string | No | — |

**Respuesta (201):** Invoice creada.

---

### POST `/api/invoices/upload`
Sube factura y acta de aceptación simultáneamente.

**Content-Type**: `multipart/form-data`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `files` | File[] | Sí (máx. 2 archivos) |

---

### GET `/api/invoices`
Lista todas las facturas del cliente autenticado.

---

### GET `/api/invoices/:id`
Obtiene una factura específica.

---

### GET `/api/invoices/client/:client`
Lista facturas de un cliente específico.

**Path Params**: `client` — Client ID

---

### GET `/api/invoices/project/:project`
Lista facturas de un proyecto específico.

**Path Params**: `project` — Project ID

---

### GET `/api/invoices/:id/pdf`
Descarga la factura en formato PDF.

**Respuesta**: Archivo PDF (Content-Type: `application/pdf`)

---

### GET `/api/invoices/:id/acta-aceptacion/download`
Descarga el acta de aceptación de una factura.

**Respuesta**: Archivo PDF

---

### PATCH `/api/invoices/:id`
Actualiza información de una factura.

**Body** (todos los campos opcionales — misma estructura que POST)

---

### PATCH `/api/invoices/:id/status`
Actualiza el estado de una factura.

**Body:**
```json
{
  "status": "APPROVED",
  "reason": "Factura revisada y aprobada"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `status` | `PENDING` \| `APPROVED` \| `REJECTED` | Sí |
| `reason` | string | No |

---

### POST `/api/invoices/:id/acta-aceptacion`
Sube el acta de aceptación de una factura.

**Content-Type**: `multipart/form-data`

| Campo | Tipo | Límites |
|-------|------|---------|
| `actaAceptacion` | File (PDF) | Max 10MB |

---

### PUT `/api/invoices/:id/reject`
Rechaza una factura.

**Body:**
```json
{
  "rejectionReason": "Datos del proveedor no coinciden con SUNAT"
}
```

---

### PUT `/api/invoices/:id/payment-status`
Actualiza el estado de pago de una factura.

**Body:**
```json
{
  "status": "APPROVED"
}
```

```json
{
  "status": "REJECTED",
  "rejectionReason": "Fondos insuficientes"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `status` | `APPROVED` \| `REJECTED` | Sí |
| `rejectionReason` | string | Requerido si `status = REJECTED` |

---

### DELETE `/api/invoices/:id`
Elimina una factura.

**Respuesta**: HTTP 204 No Content

---

## 9. Configuración SUNAT — `/api/sunat-config`

> **Auth requerida**: JWT + RolesGuard (`SUPER_ADMIN`, `ADMIN`)

### POST `/api/sunat-config`
Crea la configuración de credenciales SUNAT para un cliente.

**Body:**
```json
{
  "clientId": "64a1b2c3d4e5f6a7b8c9d0e1",
  "clientIdSunat": "sunat_client_id_aqui",
  "clientSecret": "sunat_client_secret_aqui",
  "isActive": true
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `clientId` | string | Sí |
| `clientIdSunat` | string | Sí |
| `clientSecret` | string | Sí |
| `isActive` | boolean | No (default: `true`) |

---

### GET `/api/sunat-config/:clientId`
Obtiene la configuración SUNAT de un cliente.

---

### GET `/api/sunat-config/credentials/:clientId`
Obtiene las credenciales SUNAT activas de un cliente.

**Respuesta:**
```json
{
  "clientIdSunat": "sunat_client_id_aqui",
  "clientSecret": "sunat_client_secret_aqui",
  "isActive": true
}
```

---

### PATCH `/api/sunat-config/:id`
Actualiza la configuración SUNAT.

**Body** (todos opcionales):
```json
{
  "clientIdSunat": "nuevo_client_id",
  "clientSecret": "nuevo_secret",
  "isActive": true
}
```

---

### DELETE `/api/sunat-config/:id`
Elimina la configuración SUNAT.

---

## 10. Emails — `/api/email`

> **Auth**: Endpoints públicos (sin autenticación)

### POST `/api/email/send-code`
Envía un código de verificación al email indicado.

**Body:**
```json
{
  "email": "usuario@empresa.com"
}
```

**Respuesta:**
```json
{ "message": "Código enviado correctamente" }
```

---

### POST `/api/email/send-invoice-notification`
Envía notificación de nueva factura recibida.

**Body:**
```json
{
  "email": "contador@empresa.com",
  "providerName": "Proveedor SAC",
  "invoiceNumber": "F001-00001234",
  "date": "2024-01-15",
  "type": "FACTURA"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `email` | string | Sí |
| `providerName` | string | Sí |
| `invoiceNumber` | string | Sí |
| `date` | string | Sí |
| `type` | string | Sí |

---

### POST `/api/email/send-payment-scheduled`
Envía notificación de pago programado.

**Body:**
```json
{
  "email": "proveedor@empresa.com",
  "invoiceNumber": "F001-00001234",
  "paymentDate": "2024-02-15"
}
```

---

### POST `/api/email/send-accounting-decision`
Envía notificación de decisión contable (aprobación/rechazo).

**Body:**
```json
{
  "email": "proveedor@empresa.com",
  "providerName": "Proveedor SAC",
  "invoiceNumber": "F001-00001234",
  "date": "2024-01-15",
  "type": "FACTURA",
  "status": "APPROVED"
}
```

```json
{
  "email": "proveedor@empresa.com",
  "providerName": "Proveedor SAC",
  "invoiceNumber": "F001-00001234",
  "date": "2024-01-15",
  "type": "FACTURA",
  "status": "REJECTED",
  "rejectionReason": "Datos del comprobante no válidos"
}
```

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `email` | string | Sí |
| `providerName` | string | Sí |
| `invoiceNumber` | string | Sí |
| `date` | string | Sí |
| `type` | string | Sí |
| `status` | `APPROVED` \| `REJECTED` | Sí |
| `rejectionReason` | string | Solo si `status = REJECTED` |

---

## 11. Archivos (Upload) — `/api/upload`

> **Auth**: Endpoints públicos (sin autenticación)

### POST `/api/upload`
Sube un archivo (imagen, video o audio).

**Content-Type**: `multipart/form-data`

| Campo | Tipo | Límites |
|-------|------|---------|
| `file` | File | Max 10MB |

**Tipos aceptados:**
- **Imágenes**: jpg, jpeg, png, gif, webp, bmp, svg, tiff
- **Videos**: mp4, mov, avi, mkv, webm, mpeg, mpg, m4v, 3gp, flv, wmv, ts, ogv
- **Audio**: mp3, wav, aac, ogg, m4a, flac, wma, aiff, opus

**Respuesta:**
```json
{
  "url": "https://storage.example.com/uploads/archivo-uuid.jpg"
}
```

---

### DELETE `/api/upload/:key`
Elimina un archivo subido.

**Path Params**: `key` — Identificador del archivo

---

## 12. Health Check

### GET `/api`
Verifica que el servidor esté corriendo.

**Auth**: Ninguna

**Respuesta:**
```
Hello World!
```

---

## 13. Configuración Global

### CORS
```
Origin:  * (todos)
Methods: GET, POST, PATCH, DELETE, PUT
Headers: Content-Type, Authorization
```

### Autenticación

**Header requerido en endpoints protegidos:**
```
Authorization: Bearer eyJhbGci...
```

**Flujo de autenticación:**
1. `POST /api/auth/login` → obtener `access_token`
2. Incluir en cada request: `Authorization: Bearer <access_token>`

### Códigos de respuesta HTTP

| Código | Significado |
|--------|-------------|
| `200` | OK |
| `201` | Creado |
| `204` | Sin contenido (DELETE exitoso) |
| `400` | Bad Request — validación fallida |
| `401` | Unauthorized — token inválido o ausente |
| `403` | Forbidden — rol insuficiente |
| `404` | Not Found — recurso no encontrado |
| `409` | Conflict — recurso duplicado |
| `500` | Internal Server Error |

### Resumen de endpoints por módulo

| Módulo | Endpoints | Roles requeridos |
|--------|-----------|-----------------|
| Auth | 5 | Público / JWT |
| Clientes | 6 | SUPER_ADMIN / ADMIN |
| Usuarios | 6 | SUPER_ADMIN / ADMIN |
| Roles | 6 | SUPER_ADMIN |
| Proyectos | 5 | SUPER_ADMIN / ADMIN |
| Categorías | 6 | SUPER_ADMIN / ADMIN |
| Gastos | 12 | SUPER_ADMIN / ADMIN |
| Facturas | 16 | SUPER_ADMIN / ADMIN |
| SUNAT Config | 5 | SUPER_ADMIN / ADMIN |
| Emails | 4 | Público |
| Upload | 2 | Público |
| Health | 1 | Público |
| **Total** | **74** | — |
