# Mahbub Food Delivery — Customer & Restaurant Management

Customer and restaurant-owner foundation for a multi-vendor food-delivery platform, built as a TypeScript monorepo with an Express API and a React web client.

## Tech stack

- **API:** Node.js, Express, TypeScript, PostgreSQL (`pg`), Zod validation, JWT auth, bcrypt, Nodemailer
- **Web:** React 18, Vite, TypeScript, Tailwind CSS
- **Infrastructure:** Docker Compose, Mailpit (dev email capture), Nginx (production web image)

## Features

### Customer

- Registration and login with bcrypt password hashing
- JWT access tokens (15 minutes) and rotating refresh tokens (30 days)
- One-time email verification (including resend) and forgot/reset-password flows
- Multiple delivery addresses with a single default address
- Restaurant favorites / wishlist
- Restaurant browser with menu-first ordering, guided option selection, and a calculated cart
- Server-authoritative checkout: clients submit menu item and option IDs only; prices, discounts, selection rules, and minimum orders are recalculated on the API
- Order history with line items
- Payment-method references only — provider token, brand, and last four digits; never raw card data
- Reviews restricted to delivered orders
- Loyalty balance and ledger (1 point per RM 1 on delivered orders)
- Responsive React + Tailwind account shell

### Restaurant owner

- Role-based registration (`Customer` or `Restaurant owner`) and a protected restaurant workspace
- Restaurant profile management: logo and banner, address, phone, description, and cuisine categories
- Weekly business hours, delivery radius, minimum order, and Open / Busy / Closed controls
- Menu catalogue with categories, item pricing, image uploads, availability, and preparation times
- Configurable variation and add-on groups with choices, availability, selection limits, and price adjustments
- Item-level percentage or fixed-amount discounts with start/end scheduling

### Platform

- Seeded sample restaurants and menus for local demos
- PostgreSQL schema, Docker Compose stack, Mailpit for development email, and Docker images for API and web

## Project structure

```
.
├── apps/
│   ├── api/                # Express + TypeScript API
│   │   └── src/
│   │       ├── auth.ts     # JWT issuing/verification, password hashing
│   │       ├── db/         # Pool, migrations, schema + seed data
│   │       ├── mailer.ts   # Nodemailer / Mailpit integration
│   │       ├── routes.ts   # REST endpoints
│   │       └── server.ts   # App entrypoint
│   └── web/                # React + Vite + Tailwind client
│       └── src/
│           ├── main.tsx    # Auth, customer shell, restaurant workspace
│           ├── account.tsx # Customer account panels (addresses, orders, …)
│           └── api.ts      # Fetch helper with bearer token
├── docker-compose.yml
├── package.json             # npm workspaces root
└── .env.example
```

## Prerequisites

- Node.js 20+
- Docker Desktop (or a compatible Docker engine + Compose)

## Run locally (API/web on host, DB in Docker)

Recommended for day-to-day development. Run from the repository root:

```bash
cp .env.example .env
docker compose up -d db mailpit
npm install
npm run db:migrate
npm run dev
```

| Service | URL |
|---------|-----|
| Web | http://localhost:5173 |
| API | http://localhost:4000 |
| Mailpit | http://localhost:8025 |

API health check: `http://localhost:4000/health`.

Registration and password-reset emails are captured by Mailpit at http://localhost:8025 — they are not sent to a real inbox in development.

### Rerun after code or schema changes

```bash
docker compose up -d db mailpit
npm install                  # only if dependencies changed
npm run db:migrate           # always after schema.sql changes
npm run dev
```

## Run with Docker (full stack)

Use this when you want every service in containers:

```bash
cp .env.example .env
docker compose up -d --build
docker compose run --rm api npm run db:migrate:prod
```

Then open http://localhost:5173.

### Rerun after code or schema changes

```bash
docker compose up -d --build
docker compose run --rm api npm run db:migrate:prod
```

`--build` rebuilds the API and web images so containers pick up your latest source.

Stop the stack:

```bash
docker compose down
```

Wipe Postgres data as well (destructive):

```bash
docker compose down -v
```

## Environment variables

Copy `.env.example` to `.env` and adjust as needed:

```
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://food_delivery:food_delivery@localhost:5432/food_delivery
JWT_ACCESS_SECRET=replace-with-a-long-random-secret
JWT_REFRESH_SECRET=replace-with-another-long-random-secret
APP_URL=http://localhost:5173
API_URL=http://localhost:4000
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=no-reply@mahbub-food.local
```

Notes:

- For **local `npm run dev`**, `SMTP_HOST=localhost` and `DATABASE_URL=…@localhost:5432…` are correct because Mailpit and Postgres are published on the host.
- For the **API container**, `docker-compose.yml` overrides `SMTP_HOST=mailpit` and `DATABASE_URL=…@db:5432…` so those services resolve on the Compose network.

## Database schema

Defined in `apps/api/src/db/schema.sql`:

| Area | Tables |
|------|--------|
| Auth / users | `users`, `auth_tokens` |
| Customer | `addresses`, `favorites`, `payment_methods`, `reviews`, `loyalty_ledger` |
| Restaurant | `restaurants` |
| Menu | `menu_categories`, `menu_items`, `menu_item_variations`, `menu_item_variation_options`, `menu_item_add_on_groups`, `menu_item_add_ons`, `menu_item_discounts` |
| Orders | `orders`, `order_items` |

Migrations are idempotent (`IF NOT EXISTS` / `ON CONFLICT`) and also seed sample restaurants, categories, items, variations, add-ons, and one active discount for demos.

## API surface

### Auth (public)

```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/resend-verification
POST /api/auth/verify-email
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/refresh
```

Email links use `/verify-email?token=…` and `/reset-password?token=…`. The web app serves those client-side routes (including from the production Nginx image) so links opened from email work.

Register with the **Restaurant owner** option to create a `RESTAURANT` role account; otherwise accounts default to `CUSTOMER`.

### Customer (bearer access token)

```
GET    /api/me
GET    /api/addresses
POST   /api/addresses
DELETE /api/addresses/:id
PATCH  /api/addresses/:id/default
GET    /api/favorites
POST   /api/favorites/:restaurantId
DELETE /api/favorites/:restaurantId
GET    /api/orders
POST   /api/orders
GET    /api/payment-methods
POST   /api/payment-methods
DELETE /api/payment-methods/:id
PATCH  /api/payment-methods/:id/default
GET    /api/reviews
POST   /api/reviews
GET    /api/loyalty
```

### Customer menu and checkout (bearer access token)

```
GET  /api/restaurants
GET  /api/restaurants/:id/menu
POST /api/orders
```

`POST /api/orders` accepts only menu item IDs, quantities, and selected variation/add-on IDs. It does **not** accept a customer-supplied total or unit price.

### Restaurant owner (bearer access token, `RESTAURANT` role)

```
GET    /api/owner/restaurant
POST   /api/owner/restaurant
PUT    /api/owner/restaurant
GET    /api/owner/menu
POST   /api/owner/menu/categories
PUT    /api/owner/menu/categories/:id
DELETE /api/owner/menu/categories/:id
POST   /api/owner/menu/items
PUT    /api/owner/menu/items/:id
DELETE /api/owner/menu/items/:id
```

The first `POST /api/owner/restaurant` creates the owner’s restaurant; later saves use `PUT`. The **Menu & pricing** workspace manages categories and items (including item-specific prices). Logo, banner, and item images are validated and stored as compact data URLs in this starter; for production on AWS, replace with presigned S3 / CloudFront uploads.

## Available scripts

Run from the repository root (npm workspaces):

| Command | Description |
|---------|-------------|
| `npm run dev` | Run API and web concurrently in watch mode |
| `npm run build` | Build API and web for production |
| `npm run test` | Run the API test suite |
| `npm run db:migrate` | Apply database migrations (local / host) |

Inside the API container use `npm run db:migrate:prod`.

## Production checklist

Before deploying:

- Set strong, unique values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- Use a managed PostgreSQL instance rather than the bundled container
- Configure a real SMTP provider in place of Mailpit
- Place the web and API behind HTTPS
- Connect payment methods through Stripe/Adyen tokenization rather than accepting card numbers in this service
- Replace data-URL image storage with object storage (for example S3)

## License

GNU General Public License v3.0. See `LICENSE` for the full text.
