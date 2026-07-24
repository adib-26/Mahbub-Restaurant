# Mahbub Food Delivery — Customer Management

Customer-management foundation for a multi-vendor food-delivery platform.

## Included

- Customer registration/login with bcrypt password hashing
- JWT access tokens (15 minutes) and rotating refresh tokens (30 days)
- One-time email verification and forgot/reset-password links
- Multiple delivery addresses with a single default address
- Restaurant favorites/wishlist
- Order history
- Payment-method references only (provider token, brand, last four digits; never raw card data)
- Reviews restricted to delivered orders
- Loyalty balance and ledger
- Responsive React + Tailwind account shell
- PostgreSQL schema, Docker Compose, Mailpit development email, and API/web Docker images

## Run locally

```bash
cp .env.example .env
docker compose up -d db mailpit
npm install
npm run db:migrate
npm run dev
```

API: `http://localhost:4000`, web: `http://localhost:5173`, Mailpit: `http://localhost:8025`.

## API surface

Auth: `POST /api/auth/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, `/refresh`.

Customer: `GET /api/me`, `/addresses`, `/orders`, `/favorites`, `/payment-methods`, `/loyalty`; address/favorite/payment mutations and `POST /api/reviews` are also protected by the bearer access token.

Before production, set strong secrets, use a managed PostgreSQL instance, configure a real SMTP provider, place the web/API behind HTTPS, and connect payment methods through Stripe/Adyen tokenization rather than accepting card numbers in this service.
