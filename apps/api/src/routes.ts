import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { auth, hashPassword, hashToken, issueTokens, randomToken, verifyPassword } from './auth';
import { pool, tx } from './db';
import { sendLink } from './mailer';

export const router = Router();

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(8).max(72);
const genericEmailMessage = 'If an account exists, an email has been sent.';

type AuthTokenType = 'VERIFY_EMAIL' | 'RESET_PASSWORD' | 'REFRESH';
type OneTimeTokenType = Exclude<AuthTokenType, 'REFRESH'>;

async function createToken(userId: string, type: AuthTokenType, rawToken: string, hours: number) {
  await pool.query(
    "INSERT INTO auth_tokens(user_id, token_hash, type, expires_at) VALUES($1, $2, $3, now() + ($4 * interval '1 hour'))",
    [userId, hashToken(rawToken), type, hours],
  );
}

/** Only the most recently issued verification/reset link should work. */
async function createOneTimeToken(userId: string, type: OneTimeTokenType, rawToken: string, hours: number) {
  await tx(async (client) => {
    await client.query(
      'UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND type=$2 AND consumed_at IS NULL',
      [userId, type],
    );
    await client.query(
      "INSERT INTO auth_tokens(user_id, token_hash, type, expires_at) VALUES($1, $2, $3, now() + ($4 * interval '1 hour'))",
      [userId, hashToken(rawToken), type, hours],
    );
  });
}

function verificationPath(token: string) {
  return `/verify-email?token=${encodeURIComponent(token)}`;
}

function resetPasswordPath(token: string) {
  return `/reset-password?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail(user: { id: string; email: string }) {
  const token = randomToken();
  await createOneTimeToken(user.id, 'VERIFY_EMAIL', token, 24);
  await sendLink(user.email, 'Verify your Mahbub email', verificationPath(token));
}

router.post('/auth/register', async (req, res, next) => {
  try {
    const body = z
      .object({
        email: emailSchema,
        password: passwordSchema,
        fullName: z.string().trim().min(2).max(100),
        phone: z.string().trim().max(30).optional(),
      })
      .parse(req.body);

    const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [body.email]);
    if (exists.rowCount) return res.status(409).json({ error: 'Email already registered' });

    const user = (
      await pool.query(
        `INSERT INTO users(email, password_hash, full_name, phone)
         VALUES($1, $2, $3, $4)
         RETURNING id, email, full_name AS "fullName", phone,
                   loyalty_points AS "loyaltyPoints", email_verified_at AS "emailVerifiedAt"`,
        [body.email, await hashPassword(body.password), body.fullName, body.phone || null],
      )
    ).rows[0];

    await sendVerificationEmail(user);
    return res.status(201).json({
      user,
      message: 'Registration successful. Check your email to verify your account.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema, password: passwordSchema }).parse(req.body);
    const user = (await pool.query('SELECT * FROM users WHERE email=$1', [body.email])).rows[0];

    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const tokens = issueTokens(user.id);
    await createToken(user.id, 'REFRESH', tokens.refreshToken, 24 * 30);
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        loyaltyPoints: user.loyalty_points,
        emailVerified: Boolean(user.email_verified_at),
        emailVerifiedAt: user.email_verified_at,
      },
      ...tokens,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/resend-verification', async (req, res, next) => {
  try {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const user = (
      await pool.query(
        'SELECT id, email FROM users WHERE email=$1 AND email_verified_at IS NULL',
        [email],
      )
    ).rows[0];

    if (user) await sendVerificationEmail(user);
    return res.json({ message: genericEmailMessage });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/verify-email', async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(20) }).parse(req.body);
    const outcome = await tx(async (client) => {
      const record = (
        await client.query<{
          user_id: string;
          consumed_at: Date | null;
          email_verified_at: Date | null;
          valid: boolean;
        }>(
          `SELECT auth_tokens.user_id, auth_tokens.consumed_at,
                  users.email_verified_at, auth_tokens.expires_at > now() AS "valid"
           FROM auth_tokens
           JOIN users ON users.id = auth_tokens.user_id
           WHERE auth_tokens.token_hash=$1 AND auth_tokens.type='VERIFY_EMAIL'
           FOR UPDATE`,
          [hashToken(token)],
        )
      ).rows[0];

      if (!record || !record.valid) return 'invalid' as const;

      // This makes a duplicate request from a browser retry harmless, without making an
      // unverified or superseded link valid.
      if (record.consumed_at) {
        return record.email_verified_at ? ('already-verified' as const) : ('invalid' as const);
      }

      await client.query(
        'UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()), updated_at=now() WHERE id=$1',
        [record.user_id],
      );
      await client.query(
        "UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND type='VERIFY_EMAIL' AND consumed_at IS NULL",
        [record.user_id],
      );
      return 'verified' as const;
    });

    if (outcome === 'invalid') {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }

    return res.json({
      message: outcome === 'already-verified' ? 'Email is already verified.' : 'Email verified successfully.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/forgot-password', async (req, res, next) => {
  try {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const user = (await pool.query('SELECT id, email FROM users WHERE email=$1', [email])).rows[0];

    if (user) {
      const token = randomToken();
      await createOneTimeToken(user.id, 'RESET_PASSWORD', token, 1);
      await sendLink(user.email, 'Reset your Mahbub password', resetPasswordPath(token));
    }

    return res.json({ message: genericEmailMessage });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/reset-password', async (req, res, next) => {
  try {
    const body = z.object({ token: z.string().min(20), password: passwordSchema }).parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const updated = await tx(async (client) => {
      const record = (
        await client.query<{ user_id: string }>(
          `SELECT user_id
           FROM auth_tokens
           WHERE token_hash=$1 AND type='RESET_PASSWORD' AND consumed_at IS NULL AND expires_at > now()
           FOR UPDATE`,
          [hashToken(body.token)],
        )
      ).rows[0];

      if (!record) return false;

      await client.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [
        passwordHash,
        record.user_id,
      ]);
      await client.query(
        "UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND type='RESET_PASSWORD' AND consumed_at IS NULL",
        [record.user_id],
      );
      // A reset should invalidate all stored refresh sessions for this account.
      await client.query(
        "UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND type='REFRESH' AND consumed_at IS NULL",
        [record.user_id],
      );
      return true;
    });

    if (!updated) return res.status(400).json({ error: 'Invalid or expired reset link' });
    return res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const payload = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    ) as jwt.JwtPayload;
    const valid = await pool.query(
      "SELECT id FROM auth_tokens WHERE user_id=$1 AND token_hash=$2 AND type='REFRESH' AND consumed_at IS NULL AND expires_at>now()",
      [payload.sub, hashToken(refreshToken)],
    );

    if (!valid.rowCount) return res.status(401).json({ error: 'Invalid refresh token' });

    await pool.query('UPDATE auth_tokens SET consumed_at=now() WHERE token_hash=$1', [
      hashToken(refreshToken),
    ]);
    const tokens = issueTokens(String(payload.sub));
    await createToken(String(payload.sub), 'REFRESH', tokens.refreshToken, 24 * 30);
    return res.json(tokens);
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.get('/me', auth, async (req, res, next) => {
  try {
    const user = (
      await pool.query(
        `SELECT id, email, full_name AS "fullName", phone,
                loyalty_points AS "loyaltyPoints", email_verified_at AS "emailVerifiedAt",
                email_verified_at IS NOT NULL AS "emailVerified", created_at AS "createdAt"
         FROM users WHERE id=$1`,
        [req.userId],
      )
    ).rows[0];
    return res.json({ user });
  } catch (error) {
    next(error);
  }
});

router.get('/addresses', auth, async (req, res, next) => {
  try {
    const addresses = await pool.query(
      'SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC',
      [req.userId],
    );
    return res.json({ addresses: addresses.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/addresses', auth, async (req, res, next) => {
  try {
    const body = z
      .object({
        label: z.string().min(1),
        recipientName: z.string().min(2),
        phone: z.string().min(5),
        line1: z.string().min(3),
        line2: z.string().optional(),
        city: z.string().min(2),
        state: z.string().optional(),
        postalCode: z.string().min(3),
        country: z.string().default('Malaysia'),
        isDefault: z.boolean().default(false),
      })
      .parse(req.body);
    const address = await tx(async (client) => {
      if (body.isDefault) {
        await client.query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.userId]);
      }
      return (
        await client.query(
          `INSERT INTO addresses(user_id, label, recipient_name, phone, line1, line2, city, state, postal_code, country, is_default)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [
            req.userId,
            body.label,
            body.recipientName,
            body.phone,
            body.line1,
            body.line2 || null,
            body.city,
            body.state || null,
            body.postalCode,
            body.country,
            body.isDefault,
          ],
        )
      ).rows[0];
    });
    return res.status(201).json({ address });
  } catch (error) {
    next(error);
  }
});

router.delete('/addresses/:id', auth, async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid address id' });
    await pool.query('DELETE FROM addresses WHERE id=$1 AND user_id=$2', [id.data, req.userId]);
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.patch('/addresses/:id/default', auth, async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid address id' });
    const address = await tx(async (client) => {
      const owned = await client.query('SELECT 1 FROM addresses WHERE id=$1 AND user_id=$2', [
        id.data,
        req.userId,
      ]);
      if (!owned.rowCount) return undefined;
      await client.query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.userId]);
      return (
        await client.query('UPDATE addresses SET is_default=true WHERE id=$1 RETURNING *', [id.data])
      ).rows[0];
    });
    if (!address) return res.status(404).json({ error: 'Address not found' });
    return res.json({ address });
  } catch (error) {
    next(error);
  }
});

router.get('/restaurants', auth, async (req, res, next) => {
  try {
    const restaurants = await pool.query(
      `SELECT r.id, r.name, r.cuisine, r.city, (f.user_id IS NOT NULL) AS "isFavorite"
       FROM restaurants r
       LEFT JOIN favorites f ON f.restaurant_id = r.id AND f.user_id = $1
       ORDER BY r.name`,
      [req.userId],
    );
    return res.json({ restaurants: restaurants.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/favorites', auth, async (req, res, next) => {
  try {
    const favorites = await pool.query(
      `SELECT f.restaurant_id AS "restaurantId", r.name, r.cuisine, r.city, f.created_at AS "createdAt"
       FROM favorites f
       LEFT JOIN restaurants r ON r.id = f.restaurant_id
       WHERE f.user_id=$1 ORDER BY f.created_at DESC`,
      [req.userId],
    );
    return res.json({ favorites: favorites.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/favorites/:restaurantId', auth, async (req, res, next) => {
  try {
    const restaurantId = z.string().uuid().safeParse(req.params.restaurantId);
    if (!restaurantId.success) return res.status(400).json({ error: 'Invalid restaurant id' });
    await pool.query('INSERT INTO favorites(user_id, restaurant_id) VALUES($1, $2) ON CONFLICT DO NOTHING', [
      req.userId,
      restaurantId.data,
    ]);
    return res.status(201).json({ favorite: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/favorites/:restaurantId', auth, async (req, res, next) => {
  try {
    const restaurantId = z.string().uuid().safeParse(req.params.restaurantId);
    if (!restaurantId.success) return res.status(400).json({ error: 'Invalid restaurant id' });
    await pool.query('DELETE FROM favorites WHERE user_id=$1 AND restaurant_id=$2', [
      req.userId,
      restaurantId.data,
    ]);
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/orders', auth, async (req, res, next) => {
  try {
    const orders = await pool.query(
      `SELECT o.id, o.status, o.total_cents AS "totalCents", o.created_at AS "createdAt",
              o.restaurant_id AS "restaurantId", r.name AS "restaurantName",
              EXISTS(SELECT 1 FROM reviews v WHERE v.order_id = o.id AND v.user_id = o.user_id) AS "reviewed"
       FROM orders o
       LEFT JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.user_id=$1 ORDER BY o.created_at DESC`,
      [req.userId],
    );
    return res.json({ orders: orders.rows });
  } catch (error) {
    next(error);
  }
});

// Demo checkout: creates a delivered order and awards loyalty points (1 point per RM1)
// until the real ordering pipeline exists.
router.post('/orders', auth, async (req, res, next) => {
  try {
    const body = z
      .object({
        restaurantId: z.string().uuid(),
        totalCents: z.number().int().min(100).max(1_000_000),
      })
      .parse(req.body);
    const restaurant = await pool.query('SELECT id FROM restaurants WHERE id=$1', [body.restaurantId]);
    if (!restaurant.rowCount) return res.status(404).json({ error: 'Restaurant not found' });

    const order = await tx(async (client) => {
      const created = (
        await client.query(
          `INSERT INTO orders(user_id, restaurant_id, status, total_cents)
           VALUES($1, $2, 'DELIVERED', $3)
           RETURNING id, status, total_cents AS "totalCents", restaurant_id AS "restaurantId", created_at AS "createdAt"`,
          [req.userId, body.restaurantId, body.totalCents],
        )
      ).rows[0];
      const points = Math.floor(body.totalCents / 100);
      if (points > 0) {
        await client.query(
          'INSERT INTO loyalty_ledger(user_id, points, reason, order_id) VALUES($1, $2, $3, $4)',
          [req.userId, points, 'Order reward', created.id],
        );
        await client.query('UPDATE users SET loyalty_points = loyalty_points + $1, updated_at=now() WHERE id=$2', [
          points,
          req.userId,
        ]);
      }
      return created;
    });
    return res.status(201).json({ order });
  } catch (error) {
    next(error);
  }
});

router.get('/payment-methods', auth, async (req, res, next) => {
  try {
    const paymentMethods = await pool.query(
      'SELECT id, provider, brand, last4, exp_month AS "expMonth", exp_year AS "expYear", is_default AS "isDefault" FROM payment_methods WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC',
      [req.userId],
    );
    return res.json({ paymentMethods: paymentMethods.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/payment-methods', auth, async (req, res, next) => {
  try {
    const body = z
      .object({
        provider: z.string().min(2),
        providerPaymentMethodId: z.string().min(8),
        brand: z.string().max(30).optional(),
        last4: z.string().regex(/^\d{4}$/).optional(),
        expMonth: z.number().int().min(1).max(12).optional(),
        expYear: z.number().int().min(2024).max(2100).optional(),
        isDefault: z.boolean().default(false),
      })
      .parse(req.body);
    const paymentMethod = await tx(async (client) => {
      if (body.isDefault) {
        await client.query('UPDATE payment_methods SET is_default=false WHERE user_id=$1', [req.userId]);
      }
      return (
        await client.query(
          `INSERT INTO payment_methods(user_id, provider, provider_payment_method_id, brand, last4, exp_month, exp_year, is_default)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, provider, brand, last4, exp_month AS "expMonth", exp_year AS "expYear", is_default AS "isDefault"`,
          [
            req.userId,
            body.provider,
            body.providerPaymentMethodId,
            body.brand || null,
            body.last4 || null,
            body.expMonth || null,
            body.expYear || null,
            body.isDefault,
          ],
        )
      ).rows[0];
    });
    return res.status(201).json({ paymentMethod });
  } catch (error) {
    next(error);
  }
});

router.delete('/payment-methods/:id', auth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM payment_methods WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.patch('/payment-methods/:id/default', auth, async (req, res, next) => {
  try {
    const paymentMethod = await tx(async (client) => {
      await client.query('UPDATE payment_methods SET is_default=false WHERE user_id=$1', [req.userId]);
      return (
        await client.query(
          `UPDATE payment_methods SET is_default=true WHERE id=$1 AND user_id=$2
           RETURNING id, provider, brand, last4, exp_month AS "expMonth", exp_year AS "expYear", is_default AS "isDefault"`,
          [req.params.id, req.userId],
        )
      ).rows[0];
    });
    if (!paymentMethod) return res.status(404).json({ error: 'Payment method not found' });
    return res.json({ paymentMethod });
  } catch (error) {
    next(error);
  }
});

router.get('/reviews', auth, async (req, res, next) => {
  try {
    const reviews = await pool.query(
      `SELECT v.id, v.rating, v.comment, v.created_at AS "createdAt",
              v.restaurant_id AS "restaurantId", r.name AS "restaurantName", v.order_id AS "orderId"
       FROM reviews v
       LEFT JOIN restaurants r ON r.id = v.restaurant_id
       WHERE v.user_id=$1 ORDER BY v.created_at DESC`,
      [req.userId],
    );
    return res.json({ reviews: reviews.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/reviews', auth, async (req, res, next) => {
  try {
    const body = z
      .object({
        orderId: z.string().uuid(),
        restaurantId: z.string().uuid().optional(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
      })
      .parse(req.body);
    const eligible = await pool.query(
      "SELECT restaurant_id FROM orders WHERE id=$1 AND user_id=$2 AND status='DELIVERED'",
      [body.orderId, req.userId],
    );
    if (!eligible.rowCount) return res.status(403).json({ error: 'Only delivered orders can be reviewed' });

    const restaurantId = eligible.rows[0].restaurant_id || body.restaurantId;
    if (!restaurantId) return res.status(400).json({ error: 'This order has no restaurant to review' });

    const review = (
      await pool.query(
        'INSERT INTO reviews(user_id, restaurant_id, order_id, rating, comment) VALUES($1, $2, $3, $4, $5) RETURNING *',
        [req.userId, restaurantId, body.orderId, body.rating, body.comment || null],
      )
    ).rows[0];
    return res.status(201).json({ review });
  } catch (error) {
    next(error);
  }
});

router.get('/loyalty', auth, async (req, res, next) => {
  try {
    const user = (await pool.query('SELECT loyalty_points AS points FROM users WHERE id=$1', [req.userId]))
      .rows[0];
    const ledger = (
      await pool.query(
        'SELECT points, reason, order_id AS "orderId", created_at AS "createdAt" FROM loyalty_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
        [req.userId],
      )
    ).rows;
    return res.json({ points: user.points, ledger });
  } catch (error) {
    next(error);
  }
});
