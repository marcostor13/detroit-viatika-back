# Sistema de Diseño y Guía UX/UI - Factoring Platform

Este documento define los estándares de diseño, principios de experiencia de usuario (UX) y guías de implementación técnica para la plataforma Factoring. Está basado en un enfoque **Mobile First**, utilizando **Angular 20** y **Tailwind CSS**.

---

## 1. Principios de Diseño

### 1.1 Filosofía Visual (Clean & Modern)
El diseño se inspira en la estética "Horizon/Venus", caracterizada por:
- **Espacio en blanco generoso:** Para reducir la carga cognitiva.
- **Jerarquía clara:** Uso de tipografía y color para guiar la atención.
- **Suavidad:** Bordes redondeados y sombras difusas (soft shadows) en lugar de bordes duros.
- **Accesibilidad:** Contraste adecuado y estados de foco visibles.

### 1.2 Principios UX
1.  **Feedback Inmediato:** Cada acción (clic, hover, foco) debe tener una respuesta visual perceptible.
2.  **Cursor Interactivo:** El cursor debe sentirse "vivo", cambiando de estado contextualmente (ver sección 5).
3.  **Consistencia:** Los elementos similares deben comportarse de manera idéntica en todas las pantallas.
4.  **Eficiencia:** Minimizar la cantidad de clics para tareas críticas.

---

## 2. Paleta de Colores

Se utilizará la siguiente paleta como base, extendida para cubrir todas las necesidades de la interfaz.

### 2.1 Colores Principales (Brand)
Definidos en `tailwind.config.js`.

| Token | Hex | Uso |
| :--- | :--- | :--- |
| `primary` | **#4318FF** | Botones principales, estados activos, links, gráficos clave. |
| `secondary` | **#1B2559** | Encabezados (H1-H6), texto principal, navegación oscura. |
| `tertiary` | **#A3AED0** | Texto secundario, iconos inactivos, borders sutiles. |
| `quaternary`| **#FFFFFF** | Fondo de tarjetas (Cards), fondo de inputs, texto sobre fondos oscuros. |

### 2.2 Colores de Soporte & Fondo
| Token | Hex | Uso |
| :--- | :--- | :--- |
| `background`| `#F4F7FE` | Fondo general de la aplicación (Light Mode) para contrastar con las tarjetas blancas. |
| `success` | `#05CD99` | Indicadores de estado positivo, gráficos de crecimiento. |
| `warning` | `#FFB547` | Alertas no críticas, estados pendientes. |
| `error` | `#EE5D50` | Mensajes de error, acciones destructivas, tendencias negativas. |

---

## 3. Tipografía

**Fuente Principal:** `DM Sans` (Recomendada) o `Plus Jakarta Sans`.
*Debe configurarse en `index.html` y `tailwind.config.js`.*

| Estilo | Peso | Tamaño (Mobile/Desktop) | Tailwind Class |
| :--- | :--- | :--- | :--- |
| **H1** | 700 (Bold) | 24px / 34px | `text-2xl md:text-4xl font-bold text-secondary` |
| **H2** | 700 (Bold) | 20px / 24px | `text-xl md:text-2xl font-bold text-secondary` |
| **Body** | 400 (Regular)| 14px / 16px | `text-sm md:text-base font-normal text-secondary` |
| **Label**| 500 (Medium) | 12px / 14px | `text-xs md:text-sm font-medium text-tertiary` |
| **Widget**| 700 (Bold) | 32px / 42px | `text-3xl md:text-[42px] font-bold text-secondary` |

---

## 4. Sistema de Layout y Grillas (Grid System)

### 4.1 Grid General
Utilizaremos el sistema de Grid de CSS nativo vía Tailwind.
- **Columnas:** 12 columnas.
- **Gap:** `gap-5` (20px) en desktop, `gap-3` (12px) en mobile.

```html
<!-- Ejemplo de Layout Dashboard -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
  <!-- Widgets aquí -->
</div>
```

### 4.2 Sidebar
- **Mobile:** Off-canvas (Drawer) oculto por defecto.
- **Desktop:** Fijo a la izquierda (width: `290px` aprox).
- **Estilo:** Fondo blanco (`bg-white`), esquinas derechas pueden ser rectas o redondeadas si flota.

### 4.3 Widgets (Tarjetas)
El componente fundamental de la UI.
- **Border Radius:** `rounded-[20px]` (3xl en Tailwind config extendida).
- **Shadow:** Sombra suave y difusa.
- **Padding:** `p-4` o `p-6`.

```scss
// Clase de utilidad recomendada (apply en styles.scss)
.card-3d {
  @apply bg-white rounded-[20px] shadow-[0_20px_25px_-5px_rgba(112,144,176,0.12)];
}
```

---

## 5. Componentes UI (Look & Feel)

### 5.1 Botones
- **Primary:** `bg-primary text-white hover:bg-opacity-90 rounded-[10px] px-8 py-3 transition-all`.
- **Secondary:** `bg-transparent border border-tertiary text-secondary hover:bg-gray-50 rounded-[10px]`.
- **Ghost/Icon:** `text-tertiary hover:text-primary transition-colors`.

### 5.2 Inputs
- Fondo: `#F4F7FE` (Light gray) o transparente con borde.
- Border: `border-transparent` focus `border-primary`.
- Radius: `rounded-[16px]`.

### 5.3 Charts (Gráficos)
- **Líneas:** Curvas (`curve: 'smooth'`), stroke width 3px-4px.
- **Colores:** Usar gradientes de opacidad del `primary` para el relleno de áreas.
- **Tooltips:** Fondo oscuro (`secondary`), texto blanco, redondeado.

---

## 6. Experiencia de Usuario (UX) - Cursor y Animaciones

### 6.1 Cursor Personalizado (Requerimiento Crítico)
Se implementará un cursor customizado que reemplace o complemente al nativo.

**Comportamientos:**
1.  **Default:** Círculo pequeño o punto (Primary Color).
2.  **Pointer (Hover en links/botones):** El círculo se expande y reduce opacidad, o se transforma en un anillo magnético alrededor del elemento.
3.  **Text (Hover en inputs):** Se transforma en una barra vertical "I".

**Implementación Técnica:**
- Usar un componente `GlobalCursorComponent` inyectado en `AppComponent`.
- Escuchar eventos `mousemove` globales (vía `Renderer2` o RxJS `fromEvent` optimizado fuera de Zone.js).
- Usar CSS `transform: translate3d()` para performance (GPU).
- **NO** usar JS para animar cada pixel si es posible; usar CSS transitions para el "follow" suave.

### 6.2 Micro-interacciones
- **Hover en Cards:** `hover:-translate-y-1 hover:shadow-lg transition-transform duration-300`.
- **Click:** Efecto "Ripple" (onda) sutil en botones.

---

## 7. Guía de Implementación Técnica (Angular 20)

### 7.1 Reglas de Arquitectura
1.  **Standalone Components:** Todos los componentes deben ser `standalone: true`.
2.  **Signals:** Usar `signal()`, `computed()`, y `effect()` para el estado local y global.
    ```typescript
    // Ejemplo
    export class WidgetComponent {
      title = input.required<string>(); // Signal input
      value = input.required<number>();
      
      displayValue = computed(() => `$${this.value().toFixed(2)}`);
    }
    ```
3.  **Inyección de Dependencias:** Usar `inject()` en lugar de constructores.
    ```typescript
    private _authService = inject(AuthService);
    ```
4.  **Control Flow:** Usar sintaxis `@if`, `@for`.
    ```html
    @for (item of items(); track item.id) {
      <app-card [data]="item" />
    }
    ```

### 7.2 Estructura de Directorios Recomendada
```
src/app/
├── core/               # Singleton services, interceptors, guards
├── design-system/      # Biblioteca de componentes UI puros (Dumb components)
│   ├── buttons/
│   ├── cards/
│   ├── inputs/
│   └── cursor/         # Lógica del cursor custom
├── features/           # Módulos funcionales (Smart components)
│   ├── dashboard/
│   └── auth/
├── layouts/            # Estructuras de página (Sidebar, Header)
└── shared/             # Pipes, directivas, utilidades
```

### 7.3 Configuración Tailwind (tailwind.config.js)
```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '#4318FF',
        secondary: '#1B2559',
        tertiary: '#A3AED0',
        brand: {
           100: '#F4F7FE', // Background
           // ...
        }
      },
      borderRadius: {
        'xl': '20px',
        '2xl': '30px'
      },
      boxShadow: {
        'soft': '0 20px 25px -5px rgba(112, 144, 176, 0.12)',
      }
    }
  }
}
```

