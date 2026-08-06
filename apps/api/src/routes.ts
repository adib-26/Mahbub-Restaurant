import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { type PoolClient } from 'pg';
import { auth, hashPassword, hashToken, issueTokens, randomToken, verifyPassword } from './auth';
import { pool, tx } from './db';
import { sendLink } from './mailer';

export const router = Router();

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(8).max(72);
const genericEmailMessage = 'If an account exists, an email has been sent.';
const restaurantStatusSchema = z.enum(['OPEN', 'BUSY', 'CLOSED']);
const restaurantImageSchema = z
  .string()
  .max(1_500_000)
  .refine((value) => /^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/.test(value), 'Invalid image URL');
const businessHoursSchema = z.record(
  z.string(),
  z.object({ open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), closed: z.boolean().optional() }),
);
const restaurantProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
  phone: z.string().trim().min(5).max(30),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  logoUrl: restaurantImageSchema.nullable().optional(),
  bannerUrl: restaurantImageSchema.nullable().optional(),
  businessHours: businessHoursSchema,
  cuisineCategories: z.array(z.string().trim().min(2).max(40)).min(1).max(8),
  deliveryRadiusKm: z.number().min(1).max(50),
  minimumOrderCents: z.number().int().min(0).max(100_000),
  status: restaurantStatusSchema,
});
const menuCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  isAvailable: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
});
const selectionGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    minSelections: z.number().int().min(0).max(20).default(0),
    maxSelections: z.number().int().min(1).max(20).default(1),
    isRequired: z.boolean().default(false),
    options: z.array(z.object({ name: z.string().trim().min(1).max(80), priceCents: z.number().int().min(0).max(100_000), isAvailable: z.boolean().default(true) })).min(1).max(30),
  })
  .superRefine((value, context) => {
    if (value.maxSelections < value.minSelections) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Maximum selections must be at least the minimum selections' });
    if (value.isRequired && value.minSelections === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Required groups must require at least one selection' });
  });
const menuDiscountSchema = z
  .object({
    discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
    value: z.number().int().positive().max(100_000),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.discountType === 'PERCENTAGE' && value.value > 100) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Percentage discounts cannot exceed 100%' });
    if (value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Discount end must be after its start' });
  });
const menuItemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
  imageUrl: restaurantImageSchema.nullable().optional(),
  basePriceCents: z.number().int().min(0).max(1_000_000),
  preparationTimeMinutes: z.number().int().min(1).max(240),
  isAvailable: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
  variations: z.array(selectionGroupSchema).max(10).default([]),
  addOnGroups: z.array(selectionGroupSchema).max(10).default([]),
  discount: menuDiscountSchema.nullable().optional(),
});
type MenuItemInput = z.infer<typeof menuItemSchema>;
const checkoutSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
    variationOptionIds: z.array(z.string().uuid()).max(30).default([]),
    addOnIds: z.array(z.string().uuid()).max(30).default([]),
  })).min(1).max(30),
});
type CheckoutLine = z.infer<typeof checkoutSchema>['items'][number];
class OrderValidationError extends Error {}

async function ownedRestaurantId(userId: string) {
  return (await pool.query<{ id: string }>('SELECT id FROM restaurants WHERE owner_user_id=$1', [userId])).rows[0]?.id;
}

async function writeMenuItemConfiguration(client: PoolClient, menuItemId: string, body: MenuItemInput) {
  for (const [variationIndex, variation] of body.variations.entries()) {
    const group = (
      await client.query<{ id: string }>(
        `INSERT INTO menu_item_variations(menu_item_id, name, min_selections, max_selections, is_required, display_order)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [menuItemId, variation.name, variation.minSelections, variation.maxSelections, variation.isRequired, variationIndex],
      )
    ).rows[0];
    for (const [optionIndex, option] of variation.options.entries()) {
      await client.query(
        `INSERT INTO menu_item_variation_options(variation_id, name, price_delta_cents, is_available, display_order)
         VALUES($1,$2,$3,$4,$5)`,
        [group.id, option.name, option.priceCents, option.isAvailable, optionIndex],
      );
    }
  }
  for (const [groupIndex, addOnGroup] of body.addOnGroups.entries()) {
    const group = (
      await client.query<{ id: string }>(
        `INSERT INTO menu_item_add_on_groups(menu_item_id, name, min_selections, max_selections, is_required, display_order)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [menuItemId, addOnGroup.name, addOnGroup.minSelections, addOnGroup.maxSelections, addOnGroup.isRequired, groupIndex],
      )
    ).rows[0];
    for (const [optionIndex, option] of addOnGroup.options.entries()) {
      await client.query(
        `INSERT INTO menu_item_add_ons(add_on_group_id, name, price_cents, is_available, display_order)
         VALUES($1,$2,$3,$4,$5)`,
        [group.id, option.name, option.priceCents, option.isAvailable, optionIndex],
      );
    }
  }
  if (body.discount) {
    await client.query(
      `INSERT INTO menu_item_discounts(menu_item_id, discount_type, value, starts_at, ends_at, is_active)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [menuItemId, body.discount.discountType, body.discount.value, body.discount.startsAt, body.discount.endsAt || null, body.discount.isActive],
    );
  }
}

function effectiveBasePrice(basePriceCents: number, discount: { discount_type: string | null; value: number | null; starts_at: Date | null; ends_at: Date | null; is_active: boolean | null }) {
  if (!discount.is_active || !discount.discount_type || !discount.value || !discount.starts_at || discount.starts_at > new Date() || (discount.ends_at && discount.ends_at <= new Date())) return basePriceCents;
  return discount.discount_type === 'PERCENTAGE'
    ? Math.max(0, Math.round(basePriceCents * (1 - discount.value / 100)))
    : Math.max(0, basePriceCents - discount.value);
}

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
        role: z.enum(['CUSTOMER', 'RESTAURANT']).default('CUSTOMER'),
      })
      .parse(req.body);

    const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [body.email]);
    if (exists.rowCount) return res.status(409).json({ error: 'Email already registered' });

    const user = (
      await pool.query(
        `INSERT INTO users(email, password_hash, full_name, phone, role)
         VALUES($1, $2, $3, $4, $5)
         RETURNING id, email, full_name AS "fullName", phone,
                   role, loyalty_points AS "loyaltyPoints", email_verified_at AS "emailVerifiedAt"`,
        [body.email, await hashPassword(body.password), body.fullName, body.phone || null, body.role],
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
        role: user.role,
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
                role, loyalty_points AS "loyaltyPoints", email_verified_at AS "emailVerifiedAt",
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

router.get('/owner/restaurant', auth, async (req, res, next) => {
  try {
    const restaurant = (
      await pool.query(
        `SELECT id, name, description, phone, address, city,
                logo_url AS "logoUrl", banner_url AS "bannerUrl", business_hours AS "businessHours",
                cuisine_categories AS "cuisineCategories", delivery_radius_km::float AS "deliveryRadiusKm",
                minimum_order_cents AS "minimumOrderCents", status, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM restaurants WHERE owner_user_id=$1`,
        [req.userId],
      )
    ).rows[0];
    return res.json({ restaurant: restaurant || null });
  } catch (error) {
    next(error);
  }
});

router.post('/owner/restaurant', auth, async (req, res, next) => {
  try {
    const body = restaurantProfileSchema.parse(req.body);
    const restaurant = await tx(async (client) => {
      const existing = await client.query('SELECT id FROM restaurants WHERE owner_user_id=$1', [req.userId]);
      if (existing.rowCount) return undefined;
      await client.query("UPDATE users SET role='RESTAURANT', updated_at=now() WHERE id=$1", [req.userId]);
      return (
        await client.query(
          `INSERT INTO restaurants(owner_user_id, name, description, phone, address, city, logo_url, banner_url, business_hours, cuisine_categories, cuisine, delivery_radius_km, minimum_order_cents, status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id, name, description, phone, address, city, logo_url AS "logoUrl", banner_url AS "bannerUrl",
                     business_hours AS "businessHours", cuisine_categories AS "cuisineCategories", delivery_radius_km::float AS "deliveryRadiusKm",
                     minimum_order_cents AS "minimumOrderCents", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [req.userId, body.name, body.description || null, body.phone, body.address, body.city, body.logoUrl || null, body.bannerUrl || null, JSON.stringify(body.businessHours), body.cuisineCategories, body.cuisineCategories[0], body.deliveryRadiusKm, body.minimumOrderCents, body.status],
        )
      ).rows[0];
    });
    if (!restaurant) return res.status(409).json({ error: 'You already manage a restaurant' });
    return res.status(201).json({ restaurant });
  } catch (error) {
    next(error);
  }
});

router.put('/owner/restaurant', auth, async (req, res, next) => {
  try {
    const body = restaurantProfileSchema.parse(req.body);
    const restaurant = (
      await pool.query(
        `UPDATE restaurants
         SET name=$2, description=$3, phone=$4, address=$5, city=$6, logo_url=$7, banner_url=$8,
             business_hours=$9, cuisine_categories=$10, cuisine=$11, delivery_radius_km=$12,
             minimum_order_cents=$13, status=$14, updated_at=now()
         WHERE owner_user_id=$1
         RETURNING id, name, description, phone, address, city, logo_url AS "logoUrl", banner_url AS "bannerUrl",
                   business_hours AS "businessHours", cuisine_categories AS "cuisineCategories", delivery_radius_km::float AS "deliveryRadiusKm",
                   minimum_order_cents AS "minimumOrderCents", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [req.userId, body.name, body.description || null, body.phone, body.address, body.city, body.logoUrl || null, body.bannerUrl || null, JSON.stringify(body.businessHours), body.cuisineCategories, body.cuisineCategories[0], body.deliveryRadiusKm, body.minimumOrderCents, body.status],
      )
    ).rows[0];
    if (!restaurant) return res.status(404).json({ error: 'Restaurant profile not found' });
    return res.json({ restaurant });
  } catch (error) {
    next(error);
  }
});

router.get('/owner/menu', auth, async (req, res, next) => {
  try {
    const restaurantId = await ownedRestaurantId(req.userId!);
    if (!restaurantId) return res.status(404).json({ error: 'Create your restaurant profile before managing a menu' });
    const [categoryResult, itemResult, variationResult, variationOptionResult, addOnGroupResult, addOnResult, discountResult] = await Promise.all([
      pool.query(`SELECT id, name, description, display_order AS "displayOrder", is_available AS "isAvailable" FROM menu_categories WHERE restaurant_id=$1 ORDER BY display_order, created_at`, [restaurantId]),
      pool.query(`SELECT id, category_id AS "categoryId", name, description, image_url AS "imageUrl", base_price_cents AS "basePriceCents", preparation_time_minutes AS "preparationTimeMinutes", is_available AS "isAvailable", display_order AS "displayOrder" FROM menu_items WHERE restaurant_id=$1 ORDER BY display_order, created_at`, [restaurantId]),
      pool.query(`SELECT v.id, v.menu_item_id AS "menuItemId", v.name, v.min_selections AS "minSelections", v.max_selections AS "maxSelections", v.is_required AS "isRequired", v.display_order AS "displayOrder" FROM menu_item_variations v JOIN menu_items i ON i.id=v.menu_item_id WHERE i.restaurant_id=$1 ORDER BY v.display_order`, [restaurantId]),
      pool.query(`SELECT o.id, o.variation_id AS "variationId", o.name, o.price_delta_cents AS "priceCents", o.is_available AS "isAvailable", o.display_order AS "displayOrder" FROM menu_item_variation_options o JOIN menu_item_variations v ON v.id=o.variation_id JOIN menu_items i ON i.id=v.menu_item_id WHERE i.restaurant_id=$1 ORDER BY o.display_order`, [restaurantId]),
      pool.query(`SELECT g.id, g.menu_item_id AS "menuItemId", g.name, g.min_selections AS "minSelections", g.max_selections AS "maxSelections", g.is_required AS "isRequired", g.display_order AS "displayOrder" FROM menu_item_add_on_groups g JOIN menu_items i ON i.id=g.menu_item_id WHERE i.restaurant_id=$1 ORDER BY g.display_order`, [restaurantId]),
      pool.query(`SELECT a.id, a.add_on_group_id AS "addOnGroupId", a.name, a.price_cents AS "priceCents", a.is_available AS "isAvailable", a.display_order AS "displayOrder" FROM menu_item_add_ons a JOIN menu_item_add_on_groups g ON g.id=a.add_on_group_id JOIN menu_items i ON i.id=g.menu_item_id WHERE i.restaurant_id=$1 ORDER BY a.display_order`, [restaurantId]),
      pool.query(`SELECT d.menu_item_id AS "menuItemId", d.discount_type AS "discountType", d.value, d.starts_at AS "startsAt", d.ends_at AS "endsAt", d.is_active AS "isActive" FROM menu_item_discounts d JOIN menu_items i ON i.id=d.menu_item_id WHERE i.restaurant_id=$1`, [restaurantId]),
    ]);
    const items = itemResult.rows.map((item) => ({
      ...item,
      variations: variationResult.rows.filter((variation) => variation.menuItemId === item.id).map((variation) => ({
        ...variation,
        options: variationOptionResult.rows.filter((option) => option.variationId === variation.id),
      })),
      addOnGroups: addOnGroupResult.rows.filter((group) => group.menuItemId === item.id).map((group) => ({
        ...group,
        options: addOnResult.rows.filter((option) => option.addOnGroupId === group.id),
      })),
      discount: discountResult.rows.find((discount) => discount.menuItemId === item.id) || null,
    }));
    return res.json({ categories: categoryResult.rows.map((category) => ({ ...category, items: items.filter((item) => item.categoryId === category.id) })) });
  } catch (error) {
    next(error);
  }
});

router.post('/owner/menu/categories', auth, async (req, res, next) => {
  try {
    const body = menuCategorySchema.parse(req.body);
    const restaurantId = await ownedRestaurantId(req.userId!);
    if (!restaurantId) return res.status(404).json({ error: 'Restaurant profile not found' });
    const category = (
      await pool.query(
        `INSERT INTO menu_categories(restaurant_id, name, description, is_available, display_order)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id, name, description, display_order AS "displayOrder", is_available AS "isAvailable"`,
        [restaurantId, body.name, body.description || null, body.isAvailable, body.displayOrder],
      )
    ).rows[0];
    return res.status(201).json({ category });
  } catch (error) {
    next(error);
  }
});

router.put('/owner/menu/categories/:id', auth, async (req, res, next) => {
  try {
    const body = menuCategorySchema.parse(req.body);
    const restaurantId = await ownedRestaurantId(req.userId!);
    if (!restaurantId) return res.status(404).json({ error: 'Restaurant profile not found' });
    const category = (
      await pool.query(
        `UPDATE menu_categories SET name=$3, description=$4, is_available=$5, display_order=$6, updated_at=now()
         WHERE id=$1 AND restaurant_id=$2
         RETURNING id, name, description, display_order AS "displayOrder", is_available AS "isAvailable"`,
        [req.params.id, restaurantId, body.name, body.description || null, body.isAvailable, body.displayOrder],
      )
    ).rows[0];
    if (!category) return res.status(404).json({ error: 'Menu category not found' });
    return res.json({ category });
  } catch (error) {
    next(error);
  }
});

router.delete('/owner/menu/categories/:id', auth, async (req, res, next) => {
  try {
    const restaurantId = await ownedRestaurantId(req.userId!);
    if (!restaurantId) return res.status(404).json({ error: 'Restaurant profile not found' });
    const category = (await pool.query('SELECT id FROM menu_categories WHERE id=$1 AND restaurant_id=$2', [req.params.id, restaurantId])).rows[0];
    if (!category) return res.status(404).json({ error: 'Menu category not found' });
    const itemCount = await pool.query('SELECT 1 FROM menu_items WHERE category_id=$1 LIMIT 1', [req.params.id]);
    if (itemCount.rowCount) return res.status(409).json({ error: 'Move or delete the category’s menu items first' });
    await pool.query('DELETE FROM menu_categories WHERE id=$1 AND restaurant_id=$2', [req.params.id, restaurantId]);
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/owner/menu/items', auth, async (req, res, next) => {
  try {
    const body = menuItemSchema.parse(req.body);
    const restaurantId = await ownedRestaurantId(req.userId!);
    if (!restaurantId) return res.status(404).json({ error: 'Restaurant profile not found' });
    const item = await tx(async (client) => {
      const category = await client.query('SELECT id FROM menu_categories WHERE id=$1 AND restaurant_id=$2', [body.categoryId, restaurantId]);
      if (!category.rowCount) return undefined;
      const created = (
        await client.query<{ id: string }>(
          `INSERT INTO menu_items(restaurant_id, category_id, name, description, image_url, base_price_cents, preparation_time_minutes, is_available, display_order)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [restaurantId, body.categoryId, body.name, body.description || null, body.imageUrl || null, body.basePriceCents, body.preparationTimeMinutes, body.isAvailable, body.displayOrder],
        )
      ).rows[0];
      await writeMenuItemConfiguration(client, created.id, body);
      return created;
    });
    if (!item) return res.status(400).json({ error: 'Choose a category from your restaurant menu' });
    return res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

router.put('/owner/menu/items/:id', auth, async (req, res, next) => {
  try {
    const body = menuItemSchema.parse(req.body);
    const restaurantId = await ownedRestaurantId(req.userId!);
    if (!restaurantId) return res.status(404).json({ error: 'Restaurant profile not found' });
    const item = await tx(async (client) => {
      const category = await client.query('SELECT id FROM menu_categories WHERE id=$1 AND restaurant_id=$2', [body.categoryId, restaurantId]);
      if (!category.rowCount) return undefined;
      const updated = (
        await client.query<{ id: string }>(
          `UPDATE menu_items SET category_id=$3, name=$4, description=$5, image_url=$6, base_price_cents=$7,
             preparation_time_minutes=$8, is_available=$9, display_order=$10, updated_at=now()
           WHERE id=$1 AND restaurant_id=$2 RETURNING id`,
          [req.params.id, restaurantId, body.categoryId, body.name, body.description || null, body.imageUrl || null, body.basePriceCents, body.preparationTimeMinutes, body.isAvailable, body.displayOrder],
        )
      ).rows[0];
      if (!updated) return undefined;
      await client.query('DELETE FROM menu_item_variations WHERE menu_item_id=$1', [updated.id]);
      await client.query('DELETE FROM menu_item_add_on_groups WHERE menu_item_id=$1', [updated.id]);
      await client.query('DELETE FROM menu_item_discounts WHERE menu_item_id=$1', [updated.id]);
      await writeMenuItemConfiguration(client, updated.id, body);
      return updated;
    });
    if (!item) return res.status(404).json({ error: 'Menu item or category not found' });
    return res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.delete('/owner/menu/items/:id', auth, async (req, res, next) => {
  try {
    const restaurantId = await ownedRestaurantId(req.userId!);
    if (!restaurantId) return res.status(404).json({ error: 'Restaurant profile not found' });
    const deleted = await pool.query('DELETE FROM menu_items WHERE id=$1 AND restaurant_id=$2 RETURNING id', [req.params.id, restaurantId]);
    if (!deleted.rowCount) return res.status(404).json({ error: 'Menu item not found' });
    return res.status(204).end();
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
      `SELECT r.id, r.name, r.cuisine, r.city, r.logo_url AS "logoUrl", r.banner_url AS "bannerUrl",
              r.status, r.delivery_radius_km::float AS "deliveryRadiusKm", r.minimum_order_cents AS "minimumOrderCents",
              (f.user_id IS NOT NULL) AS "isFavorite"
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

router.get('/restaurants/:id/menu', auth, async (req, res, next) => {
  try {
    const restaurant = (
      await pool.query(
        `SELECT id, name, description, cuisine, city, logo_url AS "logoUrl", banner_url AS "bannerUrl", status,
                delivery_radius_km::float AS "deliveryRadiusKm", minimum_order_cents AS "minimumOrderCents"
         FROM restaurants WHERE id=$1`,
        [req.params.id],
      )
    ).rows[0];
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const [categoryResult, itemResult, variationResult, variationOptionResult, addOnGroupResult, addOnResult] = await Promise.all([
      pool.query(`SELECT id, name, description, display_order AS "displayOrder" FROM menu_categories WHERE restaurant_id=$1 AND is_available=true ORDER BY display_order, created_at`, [restaurant.id]),
      pool.query(`SELECT i.id, i.category_id AS "categoryId", i.name, i.description, i.image_url AS "imageUrl", i.base_price_cents AS "basePriceCents", i.preparation_time_minutes AS "preparationTimeMinutes",
          CASE WHEN d.is_active AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now()) THEN
            CASE WHEN d.discount_type='PERCENTAGE' THEN GREATEST(0, ROUND(i.base_price_cents * (1 - d.value / 100.0))::int) ELSE GREATEST(0, i.base_price_cents - d.value) END
          ELSE i.base_price_cents END AS "currentPriceCents",
          CASE WHEN d.is_active AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now()) THEN d.discount_type ELSE NULL END AS "discountType",
          CASE WHEN d.is_active AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now()) THEN d.value ELSE NULL END AS "discountValue"
         FROM menu_items i JOIN menu_categories c ON c.id=i.category_id
         LEFT JOIN menu_item_discounts d ON d.menu_item_id=i.id
         WHERE i.restaurant_id=$1 AND i.is_available=true AND c.is_available=true ORDER BY i.display_order, i.created_at`, [restaurant.id]),
      pool.query(`SELECT v.id, v.menu_item_id AS "menuItemId", v.name, v.min_selections AS "minSelections", v.max_selections AS "maxSelections", v.is_required AS "isRequired", v.display_order AS "displayOrder" FROM menu_item_variations v JOIN menu_items i ON i.id=v.menu_item_id WHERE i.restaurant_id=$1 AND i.is_available=true ORDER BY v.display_order`, [restaurant.id]),
      pool.query(`SELECT o.id, o.variation_id AS "variationId", o.name, o.price_delta_cents AS "priceCents", o.display_order AS "displayOrder" FROM menu_item_variation_options o JOIN menu_item_variations v ON v.id=o.variation_id JOIN menu_items i ON i.id=v.menu_item_id WHERE i.restaurant_id=$1 AND i.is_available=true AND o.is_available=true ORDER BY o.display_order`, [restaurant.id]),
      pool.query(`SELECT g.id, g.menu_item_id AS "menuItemId", g.name, g.min_selections AS "minSelections", g.max_selections AS "maxSelections", g.is_required AS "isRequired", g.display_order AS "displayOrder" FROM menu_item_add_on_groups g JOIN menu_items i ON i.id=g.menu_item_id WHERE i.restaurant_id=$1 AND i.is_available=true ORDER BY g.display_order`, [restaurant.id]),
      pool.query(`SELECT a.id, a.add_on_group_id AS "addOnGroupId", a.name, a.price_cents AS "priceCents", a.display_order AS "displayOrder" FROM menu_item_add_ons a JOIN menu_item_add_on_groups g ON g.id=a.add_on_group_id JOIN menu_items i ON i.id=g.menu_item_id WHERE i.restaurant_id=$1 AND i.is_available=true AND a.is_available=true ORDER BY a.display_order`, [restaurant.id]),
    ]);
    const items = itemResult.rows.map((item) => ({
      ...item,
      variations: variationResult.rows.filter((variation) => variation.menuItemId === item.id).map((variation) => ({ ...variation, options: variationOptionResult.rows.filter((option) => option.variationId === variation.id) })),
      addOnGroups: addOnGroupResult.rows.filter((group) => group.menuItemId === item.id).map((group) => ({ ...group, options: addOnResult.rows.filter((option) => option.addOnGroupId === group.id) })),
    }));
    return res.json({ restaurant, categories: categoryResult.rows.map((category) => ({ ...category, items: items.filter((item) => item.categoryId === category.id) })) });
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

router.post('/orders', auth, async (req, res, next) => {
  try {
    const body = checkoutSchema.parse(req.body);
    const order = await tx(async (client) => {
      const calculatedLines: Array<{ menuItemId: string; itemName: string; unitPriceCents: number; quantity: number; selections: unknown[]; lineTotalCents: number }> = [];
      let restaurantId: string | undefined;
      let minimumOrderCents = 0;

      for (const line of body.items) {
        const menuItem = (
          await client.query(
            `SELECT i.id, i.name, i.base_price_cents, i.is_available, c.is_available AS category_available,
                    r.id AS restaurant_id, r.status AS restaurant_status, r.minimum_order_cents,
                    d.discount_type, d.value, d.starts_at, d.ends_at, d.is_active
             FROM menu_items i
             JOIN menu_categories c ON c.id=i.category_id
             JOIN restaurants r ON r.id=i.restaurant_id
             LEFT JOIN menu_item_discounts d ON d.menu_item_id=i.id
             WHERE i.id=$1 FOR SHARE OF i`,
            [line.menuItemId],
          )
        ).rows[0];
        if (!menuItem || !menuItem.is_available || !menuItem.category_available) throw new OrderValidationError('One of the selected menu items is no longer available');
        if (!['OPEN', 'BUSY'].includes(menuItem.restaurant_status)) throw new OrderValidationError('This restaurant is not accepting orders right now');
        if (restaurantId && restaurantId !== menuItem.restaurant_id) throw new OrderValidationError('An order can only contain items from one restaurant');
        restaurantId = menuItem.restaurant_id;
        minimumOrderCents = Number(menuItem.minimum_order_cents);

        const [variationGroups, variationOptions, addOnGroups, addOns] = await Promise.all([
          client.query(`SELECT id, name, min_selections, max_selections FROM menu_item_variations WHERE menu_item_id=$1`, [menuItem.id]),
          client.query(`SELECT o.id, o.variation_id, o.name, o.price_delta_cents, o.is_available FROM menu_item_variation_options o JOIN menu_item_variations v ON v.id=o.variation_id WHERE v.menu_item_id=$1`, [menuItem.id]),
          client.query(`SELECT id, name, min_selections, max_selections FROM menu_item_add_on_groups WHERE menu_item_id=$1`, [menuItem.id]),
          client.query(`SELECT a.id, a.add_on_group_id, a.name, a.price_cents, a.is_available FROM menu_item_add_ons a JOIN menu_item_add_on_groups g ON g.id=a.add_on_group_id WHERE g.menu_item_id=$1`, [menuItem.id]),
        ]);
        if (new Set(line.variationOptionIds).size !== line.variationOptionIds.length || new Set(line.addOnIds).size !== line.addOnIds.length) throw new OrderValidationError('A menu option can only be selected once');

        const selectedVariations = line.variationOptionIds.map((id) => variationOptions.rows.find((option) => option.id === id));
        const selectedAddOns = line.addOnIds.map((id) => addOns.rows.find((option) => option.id === id));
        if (selectedVariations.some((option) => !option || !option.is_available) || selectedAddOns.some((option) => !option || !option.is_available)) throw new OrderValidationError('One of your selected options is no longer available');
        for (const group of variationGroups.rows) {
          const count = selectedVariations.filter((option) => option?.variation_id === group.id).length;
          if (count < group.min_selections || count > group.max_selections) throw new OrderValidationError(`Select between ${group.min_selections} and ${group.max_selections} option(s) for ${group.name}`);
        }
        for (const group of addOnGroups.rows) {
          const count = selectedAddOns.filter((option) => option?.add_on_group_id === group.id).length;
          if (count < group.min_selections || count > group.max_selections) throw new OrderValidationError(`Select between ${group.min_selections} and ${group.max_selections} option(s) for ${group.name}`);
        }

        const basePriceCents = effectiveBasePrice(Number(menuItem.base_price_cents), menuItem);
        const selections = [
          ...selectedVariations.map((option) => ({ type: 'variation', name: option!.name, priceCents: Number(option!.price_delta_cents) })),
          ...selectedAddOns.map((option) => ({ type: 'add_on', name: option!.name, priceCents: Number(option!.price_cents) })),
        ];
        const unitPriceCents = basePriceCents + selections.reduce((sum, selection) => sum + selection.priceCents, 0);
        calculatedLines.push({ menuItemId: menuItem.id, itemName: menuItem.name, unitPriceCents, quantity: line.quantity, selections, lineTotalCents: unitPriceCents * line.quantity });
      }

      const totalCents = calculatedLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
      if (!restaurantId) throw new OrderValidationError('Add at least one menu item to your order');
      if (totalCents < minimumOrderCents) throw new OrderValidationError(`Minimum order is RM ${(minimumOrderCents / 100).toFixed(2)}`);
      const created = (
        await client.query(
          `INSERT INTO orders(user_id, restaurant_id, status, total_cents)
           VALUES($1, $2, 'PENDING', $3)
           RETURNING id, status, total_cents AS "totalCents", restaurant_id AS "restaurantId", created_at AS "createdAt"`,
          [req.userId, restaurantId, totalCents],
        )
      ).rows[0];
      for (const line of calculatedLines) {
        await client.query(
          `INSERT INTO order_items(order_id, menu_item_id, item_name, unit_price_cents, quantity, selections, line_total_cents)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [created.id, line.menuItemId, line.itemName, line.unitPriceCents, line.quantity, JSON.stringify(line.selections), line.lineTotalCents],
        );
      }
      return created;
    });
    return res.status(201).json({ order });
  } catch (error) {
    if (error instanceof OrderValidationError) return res.status(400).json({ error: error.message });
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
