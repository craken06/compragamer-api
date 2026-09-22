# Compragamer API — Backend real (NestJS + Prisma)

Este es el backend "de verdad" de la plataforma (la tienda + configurador + calculadoras que se definieron en la arquitectura del proyecto). Se conecta a la **misma base de datos Postgres** que ya venís usando con la app de carga de productos (`compragamer-admin`) — no crea tablas nuevas, lee y escribe sobre `categories`, `products` y `product_images` que ya existen.

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

## Cómo sigue el proyecto desde acá

Con esta API corriendo, el frontend de la tienda/configurador (que todavía no construimos) le va a pegar a estos endpoints en vez de hablar directo con la base. Los próximos módulos naturales a agregar acá, siguiendo el documento de arquitectura, son:

- **`compatibility` module** → el motor de compatibilidad (lee `CompatibilityRule` y evalúa productos entre sí)
- **`calculators` module** → las 4 calculadoras públicas, como funciones puras expuestas por endpoint
- **`cart` / `orders` module** → carrito y resumen de pedido (sin pago real en v1)

La app `compragamer-admin` (Express simple) puede seguir usándose como herramienta rápida de carga mientras tanto, o migrarse para que hable con esta API en vez de conectarse directo a Postgres — lo que prefieras.

---

## Problemas comunes

| Problema | Causa probable |
|---|---|
| `Can't reach database server` al iniciar | Revisá `DATABASE_URL` en tu `.env`, y que Postgres esté corriendo |
| `The table "public.products" does not exist` | El schema no coincide con tu base real — corré `npx prisma db pull` |
| Error de TypeScript al compilar | Corré `npm install` de nuevo, puede faltar algún tipo (`@types/...`) |
