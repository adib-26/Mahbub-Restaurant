CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('CUSTOMER','RESTAURANT','RIDER','ADMIN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_status AS ENUM ('PENDING','CONFIRMED','PREPARING','READY','PICKED_UP','DELIVERED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email CITEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, phone TEXT, role user_role NOT NULL DEFAULT 'CUSTOMER', email_verified_at TIMESTAMPTZ, loyalty_points INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_tokens (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('VERIFY_EMAIL','RESET_PASSWORD','REFRESH')), expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS auth_tokens_lookup_idx ON auth_tokens(token_hash, type);
CREATE TABLE IF NOT EXISTS addresses (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT NOT NULL, recipient_name TEXT NOT NULL, phone TEXT NOT NULL, line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL, state TEXT, postal_code TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'Malaysia', is_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS one_default_address ON addresses(user_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS favorites (user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, restaurant_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id, restaurant_id));
CREATE TABLE IF NOT EXISTS orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), status order_status NOT NULL DEFAULT 'PENDING', total_cents INT NOT NULL CHECK(total_cents >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS payment_methods (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_payment_method_id TEXT NOT NULL, brand TEXT, last4 CHAR(4), exp_month SMALLINT, exp_year SMALLINT, is_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(provider, provider_payment_method_id)); CREATE UNIQUE INDEX IF NOT EXISTS one_default_payment_method ON payment_methods(user_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS reviews (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), restaurant_id UUID NOT NULL, order_id UUID NOT NULL REFERENCES orders(id), rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id, order_id, restaurant_id));
CREATE TABLE IF NOT EXISTS loyalty_ledger (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, points INT NOT NULL, reason TEXT NOT NULL, order_id UUID REFERENCES orders(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS restaurants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, cuisine TEXT NOT NULL, city TEXT NOT NULL DEFAULT 'Kuala Lumpur', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
DO $$ BEGIN CREATE TYPE restaurant_status AS ENUM ('OPEN','BUSY','CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS business_hours JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS cuisine_categories TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS delivery_radius_km NUMERIC(5,2) NOT NULL DEFAULT 5;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS minimum_order_cents INT NOT NULL DEFAULT 0 CHECK(minimum_order_cents >= 0);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS status restaurant_status NOT NULL DEFAULT 'CLOSED';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS restaurants_owner_user_idx ON restaurants(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, name)
);
CREATE INDEX IF NOT EXISTS menu_categories_restaurant_sort_idx ON menu_categories(restaurant_id, display_order, created_at);
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  base_price_cents INT NOT NULL CHECK(base_price_cents >= 0),
  preparation_time_minutes SMALLINT NOT NULL CHECK(preparation_time_minutes BETWEEN 1 AND 240),
  is_available BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, category_id, name)
);
CREATE INDEX IF NOT EXISTS menu_items_restaurant_sort_idx ON menu_items(restaurant_id, category_id, display_order, created_at);
CREATE TABLE IF NOT EXISTS menu_item_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_selections SMALLINT NOT NULL DEFAULT 0 CHECK(min_selections >= 0),
  max_selections SMALLINT NOT NULL DEFAULT 1 CHECK(max_selections >= min_selections),
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_item_variation_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id UUID NOT NULL REFERENCES menu_item_variations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta_cents INT NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_item_add_on_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_selections SMALLINT NOT NULL DEFAULT 0 CHECK(min_selections >= 0),
  max_selections SMALLINT NOT NULL DEFAULT 1 CHECK(max_selections >= min_selections),
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_item_add_ons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  add_on_group_id UUID NOT NULL REFERENCES menu_item_add_on_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_cents INT NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
  is_available BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_item_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
  discount_type TEXT NOT NULL CHECK(discount_type IN ('PERCENTAGE','FIXED_AMOUNT')),
  value INT NOT NULL CHECK(value > 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit_price_cents INT NOT NULL CHECK(unit_price_cents >= 0),
  quantity SMALLINT NOT NULL CHECK(quantity BETWEEN 1 AND 50),
  selections JSONB NOT NULL DEFAULT '[]'::jsonb,
  line_total_cents INT NOT NULL CHECK(line_total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_restaurant_id_fkey') THEN ALTER TABLE orders ADD CONSTRAINT orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES restaurants(id); END IF; END $$;
INSERT INTO restaurants(id, name, cuisine, city) VALUES
  ('11111111-1111-4111-8111-111111111111','Mahbub Bistro','Malaysian','Kuala Lumpur'),
  ('22222222-2222-4222-8222-222222222222','Nasi Kandar Corner','Mamak','Penang'),
  ('33333333-3333-4333-8333-333333333333','Dragon Wok','Chinese','Kuala Lumpur'),
  ('44444444-4444-4444-8444-444444444444','Spice Route','Indian','Petaling Jaya'),
  ('55555555-5555-4555-8555-555555555555','Sakura Sushi House','Japanese','Kuala Lumpur'),
  ('66666666-6666-4666-8666-666666666666','Bella Napoli','Italian','Kuala Lumpur')
ON CONFLICT (id) DO NOTHING;
UPDATE restaurants SET status='OPEN', minimum_order_cents=1000, delivery_radius_km=8
WHERE owner_user_id IS NULL AND id IN (
  '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'
);
INSERT INTO menu_categories(id, restaurant_id, name, description, display_order) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','11111111-1111-4111-8111-111111111111','Mahbub favourites','Signature Malaysian comfort food',1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002','22222222-2222-4222-8222-222222222222','Nasi kandar plates','Freshly prepared rice plates',1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003','33333333-3333-4333-8333-333333333333','Wok classics','Made to order from the wok',1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004','44444444-4444-4444-8444-444444444444','Indian kitchen','Fragrant curries and tandoor dishes',1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000005','55555555-5555-4555-8555-555555555555','Sushi & rolls','Freshly rolled Japanese favourites',1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000006','66666666-6666-4666-8666-666666666666','Pizza & pasta','Classic Italian comfort food',1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO menu_items(id, restaurant_id, category_id, name, description, base_price_cents, preparation_time_minutes, display_order) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Chicken cheese burger','Chargrilled chicken, cheddar, lettuce and house sauce',1890,18,1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Nasi lemak ayam berempah','Coconut rice, spiced fried chicken, sambal and condiments',1690,16,2),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000002','Nasi kandar ayam bawang','Steamed rice with onion chicken curry and mixed gravies',1490,14,1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000004','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-000000000002','Beef rendang rice','Slow-braised rendang with rice and acar',1780,16,2),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000005','33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-000000000003','Black pepper beef noodles','Wok-tossed noodles, beef and black pepper sauce',1980,15,1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000006','33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-000000000003','Sweet & sour chicken rice','Crispy chicken with peppers, pineapple and rice',1750,14,2),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000007','44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','Butter chicken with naan','Tandoor chicken in a creamy tomato curry',2050,18,1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000008','44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','Vegetable biryani','Aromatic basmati rice, vegetables and raita',1550,17,2),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000009','55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-000000000005','Salmon avocado roll','Eight pieces with salmon, avocado and sesame',2280,14,1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000010','55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-000000000005','Chicken katsu don','Crispy chicken, egg and rice bowl',1890,16,2),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000011','66666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-000000000006','Margherita pizza','Tomato, mozzarella, basil and olive oil',2200,18,1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000012','66666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-000000000006','Spaghetti bolognese','Slow-cooked beef ragu and parmesan',1980,17,2)
ON CONFLICT (id) DO NOTHING;
INSERT INTO menu_item_variations(id, menu_item_id, name, min_selections, max_selections, is_required, display_order) VALUES
  ('cccccccc-cccc-4ccc-8ccc-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Choose your spice level',1,1,true,1),
  ('cccccccc-cccc-4ccc-8ccc-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-000000000003','Choose your rice',1,1,true,1),
  ('cccccccc-cccc-4ccc-8ccc-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-000000000009','Choose your wasabi',1,1,true,1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO menu_item_variation_options(id, variation_id, name, price_delta_cents, display_order) VALUES
  ('dddddddd-dddd-4ddd-8ddd-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001','Mild',0,1),
  ('dddddddd-dddd-4ddd-8ddd-000000000002','cccccccc-cccc-4ccc-8ccc-000000000001','Medium',0,2),
  ('dddddddd-dddd-4ddd-8ddd-000000000003','cccccccc-cccc-4ccc-8ccc-000000000001','Extra spicy',0,3),
  ('dddddddd-dddd-4ddd-8ddd-000000000004','cccccccc-cccc-4ccc-8ccc-000000000002','Steamed rice',0,1),
  ('dddddddd-dddd-4ddd-8ddd-000000000005','cccccccc-cccc-4ccc-8ccc-000000000002','Briyani rice',250,2),
  ('dddddddd-dddd-4ddd-8ddd-000000000006','cccccccc-cccc-4ccc-8ccc-000000000003','No wasabi',0,1),
  ('dddddddd-dddd-4ddd-8ddd-000000000007','cccccccc-cccc-4ccc-8ccc-000000000003','Regular wasabi',0,2)
ON CONFLICT (id) DO NOTHING;
INSERT INTO menu_item_add_on_groups(id, menu_item_id, name, min_selections, max_selections, display_order) VALUES
  ('eeeeeeee-eeee-4eee-8eee-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Make it a meal',0,1,1),
  ('eeeeeeee-eeee-4eee-8eee-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-000000000007','Extras',0,2,1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO menu_item_add_ons(id, add_on_group_id, name, price_cents, display_order) VALUES
  ('ffffffff-ffff-4fff-8fff-000000000001','eeeeeeee-eeee-4eee-8eee-000000000001','Fries and iced lemon tea',600,1),
  ('ffffffff-ffff-4fff-8fff-000000000002','eeeeeeee-eeee-4eee-8eee-000000000002','Garlic naan',450,1),
  ('ffffffff-ffff-4fff-8fff-000000000003','eeeeeeee-eeee-4eee-8eee-000000000002','Mango lassi',550,2)
ON CONFLICT (id) DO NOTHING;
INSERT INTO menu_item_discounts(menu_item_id, discount_type, value, is_active) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000009','PERCENTAGE',10,true)
ON CONFLICT (menu_item_id) DO NOTHING;
