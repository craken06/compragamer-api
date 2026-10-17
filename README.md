# Compragamer API — Backend real (NestJS + Prisma)

Este es el backend "de verdad" de la plataforma (la tienda + configurador + calculadoras que se definieron en la arquitectura del proyecto). Trabaja sobre la base Postgres (Neon): `categories`, `products`, `product_images` y las tablas que crea `scripts/migrate.js` (`compatibility_rules`, `orders`, `order_items`, `contact_messages`). El panel `compragamer-admin` habla con esta API.

Corre en un **puerto distinto** (3001 por defecto) al de la app de carga (3000), así podés tener las dos corriendo al mismo tiempo sin conflicto mientras vas migrando.

---

## Requisitos

- Node.js 18+
- La base de datos Postgres ya creada, con las tablas del proyecto (`categories`, `products`, `product_images`) — la misma que usa `compragamer-admin`

---

## Instalación

1. **Instalar dependencias**
   ```bash
   npm install
   ```

2. **Configurar la conexión a la base**

   Copiá `.env.example` como `.env` y completá con tus datos reales:
   ```env
   DATABASE_URL="postgresql://auryx_admin:1234abcd@localhost:5432/auryx_db"
   PORT=3001
   ```
   Es el mismo host/usuario/contraseña/base que usás en el `.env` de `compragamer-admin`, solo que acá va todo junto en una sola URL de conexión (formato que usa Prisma).

3. **Generar el cliente de Prisma**
   ```bash
   npx prisma generate
   ```

4. **(Recomendado) Sincronizar el schema con tu base real**

   El archivo `prisma/schema.prisma` ya viene escrito a mano para que coincida con el schema SQL que armamos juntos. Si en algún momento la base real difiere (agregaste una columna, cambiaste un tipo, etc.), corré esto para que Prisma lea la estructura real y actualice el archivo automáticamente:
   ```bash
   npx prisma db pull
   npx prisma generate
   ```

5. **Levantar el servidor**
   ```bash
   npm start
   ```
   Deberías ver:
   ```
   🚀 API corriendo en http://localhost:3001
   ```

---

## Endpoints disponibles

### Categorías
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/categories` | Lista todas las categorías |
| GET | `/categories/:id` | Una categoría puntual (incluye su `spec_schema`) |

### Productos
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/products` | Lista todos los productos (con su categoría e imágenes) |
| GET | `/products?categoryId=2` | Filtra productos por categoría |
| GET | `/products/:id` | Un producto puntual |
| POST | `/products` | Crea un producto nuevo |
| PUT | `/products/:id` | Actualiza un producto existente |
| DELETE | `/products/:id` | Borra un producto puntual |
| DELETE | `/products/all` | Borra **todos** los productos (irreversible) |

Ejemplo de body para `POST /products`:
```json
{
  "categoryId": 1,
  "brand": "Canadian Solar",
  "name": "CS6R-550MS",
  "sku": "CS6R-550MS-01",
  "price": 185000,
  "currency": "ARS",
  "stockStatus": "disponible",
  "specs": {
    "potencia_wp": 550,
    "voc": 49.5,
    "isc": 13.9
  },
  "datasheetUrl": "https://ejemplo.com/datasheet.pdf"
}
```

---

### Compatibilidad, calculadoras, pedidos y contacto (públicos)
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/compatibility/rules` | Parámetros del motor (temperatura mínima de diseño, márgenes) y reglas activas |
| POST | `/compatibility/evaluate` | Veredicto ✓/⚠/✕ de varias opciones a la vez (inversores, baterías, cables/protecciones DC) |
| POST | `/calculators/consumption` \| `cost` \| `savings` \| `orientation` | Calculadoras con campo `warnings` |
| POST | `/orders` | Crea el pedido con precios del servidor y devuelve el link de pago de Mercado Pago |
| GET | `/orders/:publicId` | Estado del pedido (página de vuelta del pago) |
| POST | `/payments/webhook` | Notificaciones de Mercado Pago (consulta el pago a MP antes de marcarlo pagado) |
| POST | `/contact` | Formulario de contacto (y Botón de arrepentimiento) |

### Cuentas de clientes (requieren `GOOGLE_CLIENT_ID` y `JWT_SECRET`)
El cliente ingresa con Google; la sesión dura 30 días y viaja en `Authorization: Bearer <token>`.
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/customer-auth/google` | `{ credential }` (ID token de Google) -> `{ token, customer }` |
| GET/PATCH | `/me` | Datos de la cuenta (teléfono, dirección, facturación) |
| GET | `/me/orders`, `/orders/:code` | Pedidos del cliente |

### Administración (requieren `Authorization: Bearer <token>` o `x-admin-key`)
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/auth/login` | `{ user, password }` -> token de 12 h (usuario único: `ADMIN_USER` / `ADMIN_PASSWORD_HASH`) |
| GET | `/admin/products`, `/admin/products/incomplete` | Todos los productos (incl. ocultos) y los que tienen specs incompletos |
| POST/DELETE | `/products/:id/images[/:imageId]` | Imágenes por URL https (tabla `product_images`) |
| GET | `/admin/orders`, `/admin/contact` | Pedidos y mensajes |
| GET | `/admin/customers?q=` | Clientes (búsqueda por nombre, email o teléfono) con pedidos pagados y total |
| GET/PATCH | `/admin/customers/:id` | Ficha con sus pedidos; `PATCH { blocked }` bloquea o desbloquea la cuenta |
| GET/POST/PUT | `/admin/compatibility-rules[/:id]` | Reglas del motor como datos |

## Motor de compatibilidad

`src/compatibility/engine.ts` (funciones puras). Calcula métricas del arreglo y las compara con reglas guardadas
en `compatibility_rules` (`metric`, `op`, `ref`/`value`, `factor`, `requires`, `unless`): cambiar un criterio es
editar una fila desde el panel de administración, sin tocar código. Si la tabla no existe usa `DEFAULT_RULES`.

- ✕ **No compatible**: Voc en frío > tensión máx.; Isc > cortocircuito máx. por MPPT; potencia > máx. FV; batería fuera de rango.
- ⚠ **Revisar**: Voc a menos del 3 % del máximo; Imp > corriente de operación (recorte); Vmp en calor < mínimo MPPT;
  DC/AC > 1,3; descarga de baterías < potencia del inversor; faltan datos; cables/protecciones < 1,25 × Isc.
- Voc en frío = Voc × serie × (1 + coef_temp_voc/100 × (Tmín − 25)), Tmín por defecto −10 °C (el usuario la puede cambiar).
- Microinversores (`es_microinversor`): se evalúa un panel por equipo.

## Migraciones y scripts

Todos simulan por defecto y sólo escriben con `--apply`:

```bash
node scripts/migrate.js                          # tablas compatibility_rules, orders, order_items, contact_messages + reglas iniciales
node scripts/backfill-baterias-paneles-micro.js  # tensión/corriente de baterías, tecnología de paneles, Enphase IQ8MC
node scripts/backfill-inversores-y-categorias.js # (ya aplicado el 2026-10-15)
node scripts/hash-password.js "contraseña"       # valor de ADMIN_PASSWORD_HASH
npm test                                         # tests del motor, calculadoras, login y pedidos (sin base ni red)
```

## Mercado Pago

1. Crear la aplicación en https://www.mercadopago.com.ar/developers y copiar el *Access Token* (primero el de prueba).
2. Cargar `MP_ACCESS_TOKEN`, `FRONTEND_URL` y `API_PUBLIC_URL`.
3. En *Webhooks* de la aplicación: URL `<API_PUBLIC_URL>/payments/webhook`, evento **Pagos**; copiar la clave secreta en `MP_WEBHOOK_SECRET`.
4. Probar con las tarjetas de prueba de MP antes de pasar a las credenciales productivas.

---

## Problemas comunes

| Problema | Causa probable |
|---|---|
| `Can't reach database server` al iniciar | Revisá `DATABASE_URL` en tu `.env`, y que Postgres esté corriendo |
| `The table "public.products" does not exist` | El schema no coincide con tu base real — corré `npx prisma db pull` |
| Error de TypeScript al compilar | Corré `npm install` de nuevo, puede faltar algún tipo (`@types/...`) |
