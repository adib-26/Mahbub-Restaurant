# Mahbub Food Delivery — Customer Management

Customer-management foundation for a multi-vendor food-delivery platform, built as a TypeScript monorepo with an Express API and a React web client.

## Tech stack

- **API:** Node.js, Express, TypeScript, PostgreSQL (`pg`), Zod validation, JWT auth, bcrypt, Nodemailer
- **Web:** React 18, Vite, TypeScript, Tailwind CSS
- **Infrastructure:** Docker Compose, Mailpit (dev email capture), Nginx (production web image)

## Features

- Customer registration and login with bcrypt password hashing
- JWT access tokens (15 minutes) and rotating refresh tokens (30 days)
- One-time email verification, including resend, and forgot/reset-password flows
- Multiple delivery addresses with a single default address
- Restaurant favorites and wishlist
- Order history
- Payment-method references only — provider token, brand, and last four digits are stored; raw card data never touches this service
- Reviews restricted to delivered orders
- Loyalty balance and ledger
- Responsive React + Tailwind account shell
- PostgreSQL schema, Docker Compose stack, Mailpit for development email, and Docker images for both API and web

## Project structure

```
.
├── apps/
│   ├── api/                # Express + TypeScript API
│   │   └── src/
│   │       ├── auth.ts     # JWT issuing/verification, password hashing
│   │       ├── db/         # Pool, migrations, schema
│   │       ├── mailer.ts   # Nodemailer / Mailpit integration
│   │       ├── routes.ts   # REST endpoints
│   │       └── server.ts   # App entrypoint
│   └── web/                # React + Vite + Tailwind client
│       └── src/
├── docker-compose.yml
├── package.json             # npm workspaces root
└── .env.example
```

## Prerequisites

- Node.js 20+
- Docker Desktop (or a compatible Docker engine + Compose)

## Run locally

Run these commands from the repository root:

```bash
cp .env.example .env
docker compose up -d db mailpit
npm install
npm run db:migrate
npm run dev
```

This starts PostgreSQL and Mailpit in Docker while the API and web app run directly on the host.

| Service  | URL                          |
|----------|-------------------------------|
| Web      | http://localhost:5173         |
| API      | http://localhost:4000         |
| Mailpit  | http://localhost:8025         |

The API health check is available at `http://localhost:4000/health`.

Registration and password-reset emails aren't sent to a real inbox in development — they're captured by Mailpit instead. Open `http://localhost:8025` in your browser to view them; every email the API sends during local development will show up there.

## Run with Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose run --rm api npm run db:migrate:prod
```

Then open `http://localhost:5173`.

Stop the stack with:

```bash
docker compose down
```

Add `-v` only when you intentionally want to remove the PostgreSQL data volume:

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
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=no-reply@mahbub-food.local
```

## Database schema

The schema (`apps/api/src/db/schema.sql`) defines the following tables:

- `users`
- `auth_tokens` — verification, password-reset, and refresh tokens (hashed)
- `addresses`
- `favorites`
- `orders`
- `payment_methods`
- `reviews`
- `loyalty_ledger`

## API surface

**Auth** (public)

```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/resend-verification
POST /api/auth/verify-email
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/refresh
```

Email links use `/verify-email?token=…` and `/reset-password?token=…`. The web app includes the verification confirmation screen, a resend option for signed-in but unverified customers, a "Forgot password?" entry point, and a reset-password screen. The production web image is configured to serve these client-side routes when a customer opens a link directly from an email.

**Customer** (require a bearer access token)

```
GET    /api/me
GET    /api/addresses
POST   /api/addresses
DELETE /api/addresses/:id
GET    /api/favorites
POST   /api/favorites/:restaurantId
DELETE /api/favorites/:restaurantId
GET    /api/orders
GET    /api/payment-methods
POST   /api/payment-methods
DELETE /api/payment-methods/:id
POST   /api/reviews
GET    /api/loyalty
```

## Available scripts

Run from the repository root (npm workspaces):

| Command             | Description                                  |
|----------------------|-----------------------------------------------|
| `npm run dev`        | Run API and web concurrently in watch mode    |
| `npm run build`      | Build API and web for production              |
| `npm run test`       | Run the API test suite                        |
| `npm run db:migrate` | Apply database migrations                     |

## Production checklist

Before deploying:

- Set strong, unique values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- Use a managed PostgreSQL instance rather than the bundled container
- Configure a real SMTP provider in place of Mailpit
- Place the web and API behind HTTPS
- Connect payment methods through a provider such as Stripe or Adyen using tokenization, rather than accepting card numbers in this service

## License

GNU General Public License v3.0. See `LICENSE` for the full text.
