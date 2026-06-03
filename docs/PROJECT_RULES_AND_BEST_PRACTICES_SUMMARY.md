# Resumen de Reglas y Buenas Prácticas - BA Backend

**Documento de referencia rápida** - Consultar versión completa en `PROJECT_RULES_AND_BEST_PRACTICES.md`

---

## 🏗️ Arquitectura

- ✅ **Estructura modular**: Cada funcionalidad en su propio módulo bajo `src/modules/`
- ✅ **Estructura de módulo**: `dto/`, `entities/` o `schemas/`, `*.controller.ts`, `*.service.ts`, `*.module.ts`
- ✅ **Módulos independientes y autocontenidos**

---

## 📝 Principios SOLID

- ✅ **SRP**: Una responsabilidad por clase (servicios = lógica de negocio, controladores = HTTP)
- ✅ **DIP**: Inyección de dependencias en constructores, nunca `new Service()`
- ✅ **Separación**: Controladores delgados, lógica en servicios

---

## 🎯 Convenciones de Nomenclatura

### Archivos

- ✅ TypeScript: `camelCase.ts` (ej: `quote.service.ts`)
- ✅ DTOs: `kebab-case.dto.ts` (ej: `create-customer.dto.ts`)
- ✅ Schemas: `camelCase.schema.ts`

### Código

- ✅ Clases: `PascalCase` (ej: `QuoteService`)
- ✅ Variables/funciones: `camelCase` (ej: `createQuote`, `userId`)
- ✅ Constantes: `UPPER_SNAKE_CASE` (ej: `MAX_FILE_SIZE`)
- ✅ MongoDB: Colecciones plural `camelCase` (ej: `quotes`), campos `camelCase`

---

## 🔧 Módulos

- ✅ Cada módulo tiene su `*.module.ts`
- ✅ Registrar schemas en `MongooseModule.forFeature()`
- ✅ Exportar servicios usados por otros módulos
- ✅ `AppModule` importa todos los módulos

---

## 📋 DTOs y Validación

- ✅ Usar `class-validator` y `class-transformer`
- ✅ DTOs separados: `CreateXDto` y `UpdateXDto` (usar `PartialType`)
- ✅ `@Transform()` para normalizar datos
- ✅ `ValidationPipe` en controladores con `transform: true`, `whitelist: true`

---

## 🗄️ Mongoose y MongoDB

### Schemas

- ✅ Decoradores `@Schema()` y `@Prop()` de `@nestjs/mongoose`
- ✅ `MongooseSchema.Types.ObjectId` para referencias
- ✅ `timestamps: true` cuando se necesite
- ✅ Crear índices para performance

### Consultas

- ✅ Usar `.lean()` cuando no se necesiten métodos de Mongoose
- ✅ Siempre usar `.exec()` para obtener Promesas
- ✅ Usar `.sort()`, `.limit()`, `.select()` según necesidad
- ✅ Retornar objetos planos con `.toObject()` o `.lean()`

---

## 🔨 Servicios

- ✅ Decorar con `@Injectable()`
- ✅ Inyectar dependencias en constructor (`@InjectModel` para Mongoose)
- ✅ Métodos async retornan `Promise<T>` con tipos explícitos
- ✅ Toda la lógica de negocio en servicios, no en controladores
- ✅ Validar datos antes de operaciones de BD

---

## 🎮 Controladores

- ✅ Decorar con `@Controller('route')`
- ✅ Tipos de retorno explícitos en métodos async
- ✅ Usar `ValidationPipe` en `@Body()`
- ✅ Controladores delgados: solo delegar a servicios
- ✅ `@Param('id')`, `@Query('param')`, `@Body()` para parámetros

---

## ⚠️ Manejo de Errores

- ✅ Usar excepciones HTTP de NestJS (`BadRequestException`, `UnauthorizedException`, `NotFoundException`)
- ✅ Mensajes descriptivos, sin exponer detalles internos
- ✅ Validar ObjectIds antes de consultas: `Types.ObjectId.isValid(id)`

---

## 🔐 Seguridad

- ✅ Hashear contraseñas con `bcrypt.hash(password, 10)`
- ✅ Nunca retornar contraseñas en respuestas
- ✅ Proteger rutas con `@UseGuards(AuthGuard('jwt'))`
- ✅ Validar y sanitizar todos los inputs

---

## 📘 TypeScript

- ✅ Tipos explícitos en funciones públicas
- ✅ Evitar `any` cuando sea posible
- ✅ Interfaces para objetos complejos
- ✅ `as Promise<T>` cuando TypeScript tenga problemas de inferencia
- ✅ `@ts-ignore` solo cuando sea absolutamente necesario (documentar por qué)

---

## 🧪 Testing

- ✅ Archivos `.spec.ts` junto a los archivos
- ✅ Usar Jest y mocks para dependencias
- ✅ Probar servicios y controladores por separado

---

## 📚 Imports

- ✅ Orden: NestJS → Librerías externas → Módulos locales → Tipos
- ✅ Imports absolutos cuando sea posible (`baseUrl` en tsconfig)
- ✅ Agrupar imports relacionados

---

## 🎨 Formato

- ✅ 2 espacios para indentación
- ✅ Línea en blanco entre métodos
- ✅ Línea en blanco entre imports y código
- ✅ Formatear con Prettier antes de commit

---

## 🏢 Reglas Específicas del Proyecto

### Compañías

- ✅ Cotizaciones asociadas a compañía
- ✅ Filtrar datos por compañía
- ✅ Independencia de datos entre compañías

### Versiones

- ✅ Cada edición crea nueva versión
- ✅ Historial completo de versiones
- ✅ Versiones asociadas a misma compañía

### Roles

- ✅ Crear role "customer" automáticamente al registrar
- ✅ Roles con `userId` como ObjectId
- ✅ Validar existencia de roles

### Archivos

- ✅ Validar tipos y tamaños (10MB general, 25MB audio)
- ✅ Nombres únicos para archivos

---

## ✅ Checklist Pre-Commit

- [ ] Convenciones de nomenclatura
- [ ] DTOs con validación
- [ ] Tipos explícitos en servicios
- [ ] ValidationPipe en controladores
- [ ] Consultas eficientes (`.lean()` cuando corresponda)
- [ ] Errores manejados apropiadamente
- [ ] Sin `any` innecesario
- [ ] Imports organizados
- [ ] Código formateado (Prettier)
- [ ] Sin errores de linting

---

## 🚀 Comandos

```bash
npm run start:dev    # Desarrollo
npm run build        # Build
npm run lint         # Linting
npm run format       # Formateo
npm run test         # Tests
```

---

**Versión completa**: Ver `PROJECT_RULES_AND_BEST_PRACTICES.md`

**Última actualización**: 12 de Noviembre de 2025
