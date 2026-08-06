import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from './api';

type Address = {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string;
  country: string;
  is_default: boolean;
};

type Restaurant = {
  id: string; name: string; cuisine: string; city: string; isFavorite: boolean; logoUrl?: string | null; bannerUrl?: string | null;
  status?: 'OPEN' | 'BUSY' | 'CLOSED'; deliveryRadiusKm?: number; minimumOrderCents?: number;
};

type PublicMenuOption = { id: string; name: string; priceCents: number };
type PublicChoiceGroup = { id: string; name: string; minSelections: number; maxSelections: number; isRequired: boolean; options: PublicMenuOption[] };
type PublicMenuItem = {
  id: string; name: string; description?: string | null; imageUrl?: string | null; basePriceCents: number; currentPriceCents: number;
  preparationTimeMinutes: number; discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT' | null; discountValue?: number | null;
  variations: PublicChoiceGroup[]; addOnGroups: PublicChoiceGroup[];
};
type PublicMenuCategory = { id: string; name: string; description?: string | null; items: PublicMenuItem[] };
type RestaurantMenu = { restaurant: Restaurant; categories: PublicMenuCategory[] };
type CartLine = { key: string; item: PublicMenuItem; quantity: number; variationOptionIds: string[]; addOnIds: string[] };

type Order = {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  restaurantId: string | null;
  restaurantName: string | null;
  reviewed: boolean;
};

type PaymentMethod = {
  id: string;
  provider: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
};

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  restaurantName: string | null;
};

type LedgerEntry = { points: number; reason: string; orderId: string | null; createdAt: string };

const ringgit = new Intl.NumberFormat('ms-MY', { style: 'currency', currency: 'MYR' });

function formatMoney(cents: number) {
  return ringgit.format(cents / 100);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function PanelShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-black">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-cream p-5 text-slate-500">{children}</p>;
}

function InlineError({ message }: { message: string }) {
  return message ? <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p> : null;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-500" aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(rating)}
      <span className="text-slate-300">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

/* ---------------------------------- Addresses ---------------------------------- */

const emptyAddressForm = {
  label: '',
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  isDefault: false,
};

export function AddressesPanel() {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyAddressForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ addresses: Address[] }>('/addresses')
      .then((response) => setAddresses(response.addresses))
      .catch((requestError) => setError(errorMessage(requestError)));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { address } = await api<{ address: Address }>('/addresses', {
        method: 'POST',
        body: JSON.stringify({ ...form, line2: form.line2 || undefined, state: form.state || undefined }),
      });
      setAddresses((current) => {
        const rest = (current || []).map((item) =>
          address.is_default ? { ...item, is_default: false } : item,
        );
        return [address, ...rest].sort((a, b) => Number(b.is_default) - Number(a.is_default));
      });
      setForm(emptyAddressForm);
      setShowForm(false);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api(`/addresses/${id}`, { method: 'DELETE' });
      setAddresses((current) => (current || []).filter((item) => item.id !== id));
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  async function makeDefault(id: string) {
    setError('');
    try {
      await api(`/addresses/${id}/default`, { method: 'PATCH' });
      setAddresses((current) =>
        (current || [])
          .map((item) => ({ ...item, is_default: item.id === id }))
          .sort((a, b) => Number(b.is_default) - Number(a.is_default)),
      );
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  return (
    <PanelShell title="Delivery addresses" subtitle="Save multiple addresses and pick one as your default.">
      <InlineError message={error} />
      {!addresses ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          {addresses.length === 0 && !showForm && (
            <EmptyState>No addresses yet. Add your first delivery address below.</EmptyState>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {addresses.map((address) => (
              <div key={address.id} className="rounded-2xl border border-sage p-5">
                <div className="flex items-center justify-between">
                  <p className="font-bold">{address.label}</p>
                  {address.is_default && (
                    <span className="rounded-full bg-sage px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand">
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {address.recipient_name} · {address.phone}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                </p>
                <p className="text-sm text-slate-600">
                  {address.postal_code} {address.city}
                  {address.state ? `, ${address.state}` : ''}, {address.country}
                </p>
                <div className="mt-4 flex gap-4">
                  {!address.is_default && (
                    <button
                      type="button"
                      className="text-sm font-bold text-brand hover:underline"
                      onClick={() => makeDefault(address.id)}
                    >
                      Set as default
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-sm font-bold text-red-600 hover:underline"
                    onClick={() => remove(address.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          {showForm ? (
            <form onSubmit={submit} className="mt-6 rounded-2xl bg-cream p-5">
              <p className="mb-4 font-bold">New address</p>
              <div className="grid gap-x-4 md:grid-cols-2">
                <input
                  className="field"
                  placeholder="Label (Home, Office…)"
                  required
                  value={form.label}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="Recipient name"
                  required
                  minLength={2}
                  value={form.recipientName}
                  onChange={(event) => setForm({ ...form, recipientName: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="Phone"
                  required
                  minLength={5}
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="Address line 1"
                  required
                  minLength={3}
                  value={form.line1}
                  onChange={(event) => setForm({ ...form, line1: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="Address line 2 (optional)"
                  value={form.line2}
                  onChange={(event) => setForm({ ...form, line2: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="City"
                  required
                  minLength={2}
                  value={form.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="State (optional)"
                  value={form.state}
                  onChange={(event) => setForm({ ...form, state: event.target.value })}
                />
                <input
                  className="field"
                  placeholder="Postal code"
                  required
                  minLength={3}
                  value={form.postalCode}
                  onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
                />
              </div>
              <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
                />
                Use as my default address
              </label>
              <div className="flex gap-3">
                <button
                  className="rounded-xl bg-brand px-5 py-2.5 font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save address'}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-sage px-5 py-2.5 font-bold transition hover:bg-sage"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="mt-6 rounded-xl bg-brand px-5 py-2.5 font-bold text-white transition hover:bg-emerald-800"
              onClick={() => setShowForm(true)}
            >
              Add address
            </button>
          )}
        </>
      )}
    </PanelShell>
  );
}

/* ---------------------------------- Favorites ---------------------------------- */

export function FavoritesPanel() {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ restaurants: Restaurant[] }>('/restaurants')
      .then((response) => setRestaurants(response.restaurants))
      .catch((requestError) => setError(errorMessage(requestError)));
  }, []);

  async function toggle(restaurant: Restaurant) {
    setError('');
    try {
      await api(`/favorites/${restaurant.id}`, { method: restaurant.isFavorite ? 'DELETE' : 'POST' });
      setRestaurants((current) =>
        (current || []).map((item) =>
          item.id === restaurant.id ? { ...item, isFavorite: !item.isFavorite } : item,
        ),
      );
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  const favorites = (restaurants || []).filter((item) => item.isFavorite);

  return (
    <PanelShell title="Favorites" subtitle="Tap the heart to keep restaurants on your wishlist.">
      <InlineError message={error} />
      {!restaurants ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm font-semibold text-slate-500">
            {favorites.length === 0
              ? 'You have no favorites yet.'
              : `${favorites.length} favorite${favorites.length > 1 ? 's' : ''} saved.`}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {restaurants.map((restaurant) => (
              <div
                key={restaurant.id}
                className={`flex items-center justify-between rounded-2xl border p-5 ${
                  restaurant.isFavorite ? 'border-brand bg-cream' : 'border-sage'
                }`}
              >
                <div>
                  <p className="font-bold">{restaurant.name}</p>
                  <p className="text-sm text-slate-500">
                    {restaurant.cuisine} · {restaurant.city}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={restaurant.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  className={`text-2xl transition ${restaurant.isFavorite ? 'text-red-500' : 'text-slate-300 hover:text-red-400'}`}
                  onClick={() => toggle(restaurant)}
                >
                  {restaurant.isFavorite ? '♥' : '♡'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </PanelShell>
  );
}

/* ----------------------------- Restaurant menus ----------------------------- */

function allItemOptions(item: PublicMenuItem) {
  return [...item.variations, ...item.addOnGroups].flatMap((group) => group.options);
}

function cartLineUnitPrice(line: CartLine) {
  const selected = new Set([...line.variationOptionIds, ...line.addOnIds]);
  return line.item.currentPriceCents + allItemOptions(line.item).filter((option) => selected.has(option.id)).reduce((sum, option) => sum + option.priceCents, 0);
}

export function RestaurantMenuPanel() {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [customizing, setCustomizing] = useState<PublicMenuItem | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    api<{ restaurants: Restaurant[] }>('/restaurants')
      .then((response) => setRestaurants(response.restaurants))
      .catch((requestError) => setError(errorMessage(requestError)));
  }, []);

  async function openRestaurant(restaurant: Restaurant) {
    if (cart.length && menu?.restaurant.id !== restaurant.id && !window.confirm('Your cart belongs to another restaurant. Clear it and view this menu?')) return;
    if (menu?.restaurant.id !== restaurant.id) setCart([]);
    setError(''); setNotice(''); setMenuLoading(true);
    try {
      const response = await api<RestaurantMenu>(`/restaurants/${restaurant.id}/menu`);
      setMenu(response);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setMenuLoading(false); }
  }

  function addLine(line: Omit<CartLine, 'key'>) {
    const key = `${line.item.id}:${[...line.variationOptionIds].sort().join(',')}:${[...line.addOnIds].sort().join(',')}`;
    setCart((current) => {
      const match = current.find((entry) => entry.key === key);
      return match ? current.map((entry) => entry.key === key ? { ...entry, quantity: entry.quantity + line.quantity } : entry) : [...current, { ...line, key }];
    });
    setCustomizing(null);
    setNotice(`${line.item.name} added to your cart.`);
  }

  async function checkout() {
    if (!menu || cart.length === 0) return;
    setError(''); setNotice(''); setPlacing(true);
    try {
      const { order } = await api<{ order: Order }>('/orders', {
        method: 'POST',
        body: JSON.stringify({ items: cart.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity, variationOptionIds: line.variationOptionIds, addOnIds: line.addOnIds })) }),
      });
      setCart([]);
      setNotice(`Order placed at ${menu.restaurant.name}. Order ${order.id.slice(0, 8).toUpperCase()} is pending confirmation.`);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setPlacing(false); }
  }

  const cartTotal = cart.reduce((sum, line) => sum + cartLineUnitPrice(line) * line.quantity, 0);
  return <PanelShell title={menu ? menu.restaurant.name : 'Browse restaurants'} subtitle={menu ? 'Choose items from the menu. Prices are calculated from the restaurant’s live catalogue.' : 'Choose a restaurant, browse its live menu, and add dishes to your cart.'}>
    <InlineError message={error} />
    {notice && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p>}
    {!menu ? (!restaurants ? <p className="text-slate-500">Loading restaurants…</p> : <div className="grid gap-4 md:grid-cols-2">{restaurants.map((restaurant) => <button key={restaurant.id} type="button" className="group overflow-hidden rounded-2xl border border-sage text-left transition hover:border-brand hover:shadow-sm" onClick={() => void openRestaurant(restaurant)}><div className="h-24 bg-gradient-to-br from-brand to-emerald-700">{restaurant.bannerUrl && <img src={restaurant.bannerUrl} alt="" className="h-full w-full object-cover" />}</div><div className="relative p-5"><div className="absolute -top-8 grid h-14 w-14 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-sage font-black text-brand">{restaurant.logoUrl ? <img src={restaurant.logoUrl} alt="" className="h-full w-full object-cover" /> : restaurant.name.slice(0, 1)}</div><div className="ml-16"><p className="font-black group-hover:text-brand">{restaurant.name}</p><p className="mt-1 text-sm text-slate-500">{restaurant.cuisine} · {restaurant.city}</p></div><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><span className={`rounded-full px-2.5 py-1 ${restaurant.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : restaurant.status === 'BUSY' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{restaurant.status === 'OPEN' ? 'Open' : restaurant.status === 'BUSY' ? 'Busy' : 'Closed'}</span>{restaurant.minimumOrderCents !== undefined && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Min. {formatMoney(restaurant.minimumOrderCents)}</span>}</div></div></button>)}</div>) : <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><button type="button" className="text-sm font-bold text-brand hover:underline" onClick={() => { setMenu(null); setCart([]); setNotice(''); }}>← All restaurants</button><span className={`rounded-full px-3 py-1 text-xs font-bold ${menu.restaurant.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : menu.restaurant.status === 'BUSY' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{menu.restaurant.status === 'OPEN' ? 'Open for orders' : menu.restaurant.status === 'BUSY' ? 'Busy — longer wait' : 'Closed'}</span></div>
      {menuLoading ? <p className="py-10 text-center text-slate-500">Loading menu…</p> : <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"><div className="space-y-7">{menu.categories.length === 0 ? <EmptyState>This restaurant has not published menu items yet.</EmptyState> : menu.categories.map((category) => <section key={category.id}><div className="mb-3"><h3 className="text-xl font-black">{category.name}</h3>{category.description && <p className="text-sm text-slate-500">{category.description}</p>}</div><div className="grid gap-3 sm:grid-cols-2">{category.items.map((item) => <button key={item.id} type="button" className="flex gap-3 rounded-2xl border border-sage p-3 text-left transition hover:border-brand hover:shadow-sm" onClick={() => setCustomizing(item)}><div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-sage font-black text-brand">{item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : item.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><p className="font-bold">{item.name}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.description || 'Made fresh to order.'}</p><div className="mt-2 flex items-center gap-2"><span className="font-black text-brand">{formatMoney(item.currentPriceCents)}</span>{item.currentPriceCents < item.basePriceCents && <span className="text-xs text-slate-400 line-through">{formatMoney(item.basePriceCents)}</span>}</div><p className="mt-1 text-xs font-semibold text-slate-400">{item.preparationTimeMinutes} min</p></div></button>)}</div></section>)}</div><CustomerCart cart={cart} restaurant={menu.restaurant} totalCents={cartTotal} placing={placing} onUpdate={(key, quantity) => setCart((current) => quantity === 0 ? current.filter((line) => line.key !== key) : current.map((line) => line.key === key ? { ...line, quantity } : line))} onCheckout={() => void checkout()} /></div>}
    </div>}
    {customizing && <MenuItemCustomizer item={customizing} onClose={() => setCustomizing(null)} onAdd={addLine} />}
  </PanelShell>;
}

function CustomerCart({ cart, restaurant, totalCents, placing, onUpdate, onCheckout }: { cart: CartLine[]; restaurant: Restaurant; totalCents: number; placing: boolean; onUpdate: (key: string, quantity: number) => void; onCheckout: () => void }) {
  const canOrder = restaurant.status === 'OPEN' || restaurant.status === 'BUSY';
  const meetsMinimum = totalCents >= (restaurant.minimumOrderCents || 0);
  return <aside className="h-fit rounded-2xl bg-ink p-5 text-white lg:sticky lg:top-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-emerald-200">Your order</p><h3 className="mt-1 text-xl font-black">Cart</h3>{cart.length === 0 ? <p className="mt-5 text-sm text-slate-300">Add items from the menu to begin your order.</p> : <div className="mt-5 space-y-4">{cart.map((line) => <div key={line.key} className="border-b border-white/10 pb-4"><div className="flex gap-3"><div className="min-w-0 flex-1"><p className="font-bold">{line.item.name}</p><p className="mt-1 text-xs text-slate-300">{[...line.variationOptionIds, ...line.addOnIds].map((id) => allItemOptions(line.item).find((option) => option.id === id)?.name).filter(Boolean).join(', ') || 'Standard'}</p></div><p className="font-bold">{formatMoney(cartLineUnitPrice(line) * line.quantity)}</p></div><div className="mt-3 flex items-center gap-3"><button type="button" className="grid h-7 w-7 place-items-center rounded-full bg-white/10 font-bold hover:bg-white/20" onClick={() => onUpdate(line.key, line.quantity - 1)}>−</button><span className="w-4 text-center text-sm font-bold">{line.quantity}</span><button type="button" className="grid h-7 w-7 place-items-center rounded-full bg-white/10 font-bold hover:bg-white/20" onClick={() => onUpdate(line.key, line.quantity + 1)}>+</button></div></div>)}<div className="flex items-center justify-between pt-1 text-lg font-black"><span>Total</span><span>{formatMoney(totalCents)}</span></div><p className="text-xs text-slate-300">Calculated from the live menu. The server confirms all prices at checkout.</p>{!meetsMinimum && <p className="rounded-lg bg-amber-300/15 p-3 text-xs font-semibold text-amber-100">Add {formatMoney((restaurant.minimumOrderCents || 0) - totalCents)} to reach the minimum order.</p>}<button type="button" className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-bold text-ink transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canOrder || !meetsMinimum || placing} onClick={onCheckout}>{placing ? 'Placing order…' : !canOrder ? 'Restaurant is closed' : 'Place order'}</button></div>}</aside>;
}

function MenuItemCustomizer({ item, onClose, onAdd }: { item: PublicMenuItem; onClose: () => void; onAdd: (line: Omit<CartLine, 'key'>) => void }) {
  const [variationOptionIds, setVariationOptionIds] = useState<string[]>([]);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  const toggle = (id: string, selected: string[], setSelected: (ids: string[]) => void) => setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const selectedPrice = [...variationOptionIds, ...addOnIds].map((id) => allItemOptions(item).find((option) => option.id === id)?.priceCents || 0).reduce((sum, value) => sum + value, item.currentPriceCents);
  function add() {
    const invalid = [...item.variations.map((group) => ({ group, ids: variationOptionIds })), ...item.addOnGroups.map((group) => ({ group, ids: addOnIds }))].find(({ group, ids }) => { const count = group.options.filter((option) => ids.includes(option.id)).length; return count < group.minSelections || count > group.maxSelections; });
    if (invalid) { setError(`Please select between ${invalid.group.minSelections} and ${invalid.group.maxSelections} option(s) for ${invalid.group.name}.`); return; }
    onAdd({ item, variationOptionIds, addOnIds, quantity });
  }
  return <div className="fixed inset-0 z-50 flex items-end bg-ink/40 sm:items-center sm:justify-center sm:p-5"><div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand">Customize your item</p><h2 className="mt-1 text-2xl font-black">{item.name}</h2><p className="mt-1 text-sm text-slate-500">Starting at {formatMoney(item.currentPriceCents)}</p></div><button type="button" className="text-2xl text-slate-500" onClick={onClose}>×</button></div><div className="mt-6 space-y-6">{item.variations.map((group) => <CustomerChoiceGroup key={group.id} group={group} selected={variationOptionIds} onToggle={(id) => toggle(id, variationOptionIds, setVariationOptionIds)} />)}{item.addOnGroups.map((group) => <CustomerChoiceGroup key={group.id} group={group} selected={addOnIds} onToggle={(id) => toggle(id, addOnIds, setAddOnIds)} />)}</div>{error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-5"><div className="flex items-center gap-3"><button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 font-bold" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><span className="font-bold">{quantity}</span><button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 font-bold" onClick={() => setQuantity(quantity + 1)}>+</button></div><button type="button" className="rounded-xl bg-brand px-5 py-3 font-bold text-white hover:bg-emerald-800" onClick={add}>Add · {formatMoney(selectedPrice * quantity)}</button></div></div></div>;
}

function CustomerChoiceGroup({ group, selected, onToggle }: { group: PublicChoiceGroup; selected: string[]; onToggle: (id: string) => void }) {
  return <section><div className="flex justify-between gap-3"><h3 className="font-black">{group.name}</h3><span className="text-xs font-bold text-slate-400">{group.minSelections > 0 ? `Required · choose ${group.minSelections}${group.maxSelections !== group.minSelections ? `–${group.maxSelections}` : ''}` : `Choose up to ${group.maxSelections}`}</span></div><div className="mt-2 space-y-2">{group.options.map((option) => <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-brand"><input type="checkbox" checked={selected.includes(option.id)} onChange={() => onToggle(option.id)} /><span className="flex-1 text-sm font-semibold">{option.name}</span><span className="text-sm font-bold text-brand">{option.priceCents ? `+${formatMoney(option.priceCents)}` : 'Included'}</span></label>)}</div></section>;
}

/* ----------------------------------- Orders ------------------------------------ */

const statusStyles: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  PREPARING: 'bg-sky-100 text-sky-800',
  READY: 'bg-indigo-100 text-indigo-800',
  PICKED_UP: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export function OrdersPanel() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<string | null>(null);

  useEffect(() => {
    api<{ orders: Order[] }>('/orders')
      .then((response) => setOrders(response.orders))
      .catch((requestError) => setError(errorMessage(requestError)));
  }, []);

  return (
    <PanelShell title="Order history" subtitle="Every order you place appears here, newest first.">
      <InlineError message={error} />
      {!orders ? (
        <p className="text-slate-500">Loading…</p>
      ) : orders.length === 0 ? (
        <EmptyState>No orders yet. Browse restaurants to order from a live menu.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-sage p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold">{order.restaurantName || 'Restaurant'}</p>
                  <p className="text-sm text-slate-500">{formatDate(order.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                      statusStyles[order.status] || 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {order.status.replace('_', ' ')}
                  </span>
                  <span className="font-black">{formatMoney(order.totalCents)}</span>
                </div>
              </div>
              {order.status === 'DELIVERED' && !order.reviewed && (
                <div className="mt-4">
                  {reviewing === order.id ? (
                    <ReviewForm
                      orderId={order.id}
                      onDone={() => {
                        setReviewing(null);
                        setOrders((current) =>
                          (current || []).map((item) =>
                            item.id === order.id ? { ...item, reviewed: true } : item,
                          ),
                        );
                      }}
                      onCancel={() => setReviewing(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-sm font-bold text-brand hover:underline"
                      onClick={() => setReviewing(order.id)}
                    >
                      Leave a review
                    </button>
                  )}
                </div>
              )}
              {order.reviewed && <p className="mt-3 text-sm font-semibold text-emerald-700">Reviewed ✓</p>}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function ReviewForm({ orderId, onDone, onCancel }: { orderId: string; onDone: () => void; onCancel: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api('/reviews', {
        method: 'POST',
        body: JSON.stringify({ orderId, rating, comment: comment || undefined }),
      });
      onDone();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-cream p-4">
      <InlineError message={error} />
      <div className="mb-3 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`${value} star${value > 1 ? 's' : ''}`}
            className={`text-2xl transition ${value <= rating ? 'text-amber-500' : 'text-slate-300 hover:text-amber-300'}`}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="field"
        rows={2}
        maxLength={1000}
        placeholder="How was the food? (optional)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="flex gap-3">
        <button
          className="rounded-xl bg-brand px-5 py-2 font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60"
          disabled={saving}
        >
          {saving ? 'Submitting…' : 'Submit review'}
        </button>
        <button
          type="button"
          className="rounded-xl border border-sage px-5 py-2 font-bold transition hover:bg-sage"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------- Payment methods ------------------------------- */

const emptyPaymentForm = {
  provider: 'stripe',
  providerPaymentMethodId: '',
  brand: 'Visa',
  last4: '',
  expMonth: '',
  expYear: '',
  isDefault: false,
};

export function PaymentsPanel() {
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyPaymentForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ paymentMethods: PaymentMethod[] }>('/payment-methods')
      .then((response) => setMethods(response.paymentMethods))
      .catch((requestError) => setError(errorMessage(requestError)));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { paymentMethod } = await api<{ paymentMethod: PaymentMethod }>('/payment-methods', {
        method: 'POST',
        body: JSON.stringify({
          provider: form.provider,
          providerPaymentMethodId: form.providerPaymentMethodId,
          brand: form.brand || undefined,
          last4: form.last4 || undefined,
          expMonth: form.expMonth ? Number(form.expMonth) : undefined,
          expYear: form.expYear ? Number(form.expYear) : undefined,
          isDefault: form.isDefault,
        }),
      });
      setMethods((current) => {
        const rest = (current || []).map((item) =>
          paymentMethod.isDefault ? { ...item, isDefault: false } : item,
        );
        return [paymentMethod, ...rest].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      });
      setForm(emptyPaymentForm);
      setShowForm(false);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api(`/payment-methods/${id}`, { method: 'DELETE' });
      setMethods((current) => (current || []).filter((item) => item.id !== id));
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  async function makeDefault(id: string) {
    setError('');
    try {
      await api(`/payment-methods/${id}/default`, { method: 'PATCH' });
      setMethods((current) =>
        (current || [])
          .map((item) => ({ ...item, isDefault: item.id === id }))
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
      );
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  return (
    <PanelShell
      title="Payment methods"
      subtitle="Only tokenized card references are stored — never full card numbers."
    >
      <InlineError message={error} />
      {!methods ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          {methods.length === 0 && !showForm && (
            <EmptyState>No saved payment methods. Add a card reference below.</EmptyState>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {methods.map((method) => (
              <div key={method.id} className="rounded-2xl border border-sage p-5">
                <div className="flex items-center justify-between">
                  <p className="font-bold">
                    {method.brand || method.provider} {method.last4 ? `•••• ${method.last4}` : ''}
                  </p>
                  {method.isDefault && (
                    <span className="rounded-full bg-sage px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand">
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {method.provider}
                  {method.expMonth && method.expYear
                    ? ` · expires ${String(method.expMonth).padStart(2, '0')}/${method.expYear}`
                    : ''}
                </p>
                <div className="mt-4 flex gap-4">
                  {!method.isDefault && (
                    <button
                      type="button"
                      className="text-sm font-bold text-brand hover:underline"
                      onClick={() => makeDefault(method.id)}
                    >
                      Set as default
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-sm font-bold text-red-600 hover:underline"
                    onClick={() => remove(method.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          {showForm ? (
            <form onSubmit={submit} className="mt-6 rounded-2xl bg-cream p-5">
              <p className="mb-4 font-bold">New payment method</p>
              <div className="grid gap-x-4 md:grid-cols-2">
                <select
                  className="field"
                  value={form.provider}
                  onChange={(event) => setForm({ ...form, provider: event.target.value })}
                >
                  <option value="stripe">Stripe</option>
                  <option value="adyen">Adyen</option>
                </select>
                <input
                  className="field"
                  placeholder="Provider token (e.g. pm_123…)"
                  required
                  minLength={8}
                  value={form.providerPaymentMethodId}
                  onChange={(event) => setForm({ ...form, providerPaymentMethodId: event.target.value })}
                />
                <select
                  className="field"
                  value={form.brand}
                  onChange={(event) => setForm({ ...form, brand: event.target.value })}
                >
                  <option>Visa</option>
                  <option>Mastercard</option>
                  <option>Amex</option>
                </select>
                <input
                  className="field"
                  placeholder="Last 4 digits"
                  pattern="\d{4}"
                  maxLength={4}
                  value={form.last4}
                  onChange={(event) => setForm({ ...form, last4: event.target.value })}
                />
                <input
                  className="field"
                  type="number"
                  placeholder="Expiry month (1–12)"
                  min={1}
                  max={12}
                  value={form.expMonth}
                  onChange={(event) => setForm({ ...form, expMonth: event.target.value })}
                />
                <input
                  className="field"
                  type="number"
                  placeholder="Expiry year"
                  min={2024}
                  max={2100}
                  value={form.expYear}
                  onChange={(event) => setForm({ ...form, expYear: event.target.value })}
                />
              </div>
              <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
                />
                Use as my default payment method
              </label>
              <div className="flex gap-3">
                <button
                  className="rounded-xl bg-brand px-5 py-2.5 font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save payment method'}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-sage px-5 py-2.5 font-bold transition hover:bg-sage"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="mt-6 rounded-xl bg-brand px-5 py-2.5 font-bold text-white transition hover:bg-emerald-800"
              onClick={() => setShowForm(true)}
            >
              Add payment method
            </button>
          )}
        </>
      )}
    </PanelShell>
  );
}

/* ----------------------------------- Reviews ----------------------------------- */

export function ReviewsPanel() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ reviews: Review[] }>('/reviews')
      .then((response) => setReviews(response.reviews))
      .catch((requestError) => setError(errorMessage(requestError)));
  }, []);

  return (
    <PanelShell title="Reviews & ratings" subtitle="Reviews you have left on delivered orders.">
      <InlineError message={error} />
      {!reviews ? (
        <p className="text-slate-500">Loading…</p>
      ) : reviews.length === 0 ? (
        <EmptyState>No reviews yet. Open a delivered order in Order history to leave one.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-2xl border border-sage p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{review.restaurantName || 'Restaurant'}</p>
                <Stars rating={review.rating} />
              </div>
              {review.comment && <p className="mt-2 text-slate-600">{review.comment}</p>}
              <p className="mt-2 text-sm text-slate-400">{formatDate(review.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

/* ----------------------------------- Loyalty ----------------------------------- */

export function LoyaltyPanel() {
  const [data, setData] = useState<{ points: number; ledger: LedgerEntry[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ points: number; ledger: LedgerEntry[] }>('/loyalty')
      .then(setData)
      .catch((requestError) => setError(errorMessage(requestError)));
  }, []);

  return (
    <PanelShell title="Loyalty points" subtitle="Earn 1 point for every RM 1 spent on orders.">
      <InlineError message={error} />
      {!data ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mb-6 rounded-2xl bg-brand p-6 text-white">
            <p className="text-sm uppercase tracking-widest text-emerald-100">Available balance</p>
            <p className="mt-2 text-5xl font-black">{data.points}</p>
            <p className="mt-1 text-sm text-emerald-100">points</p>
          </div>
          {data.ledger.length === 0 ? (
            <EmptyState>No loyalty activity yet. Points appear here when you order.</EmptyState>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sage text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-2">Date</th>
                  <th className="py-2">Reason</th>
                  <th className="py-2 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((entry, index) => (
                  <tr key={index} className="border-b border-slate-100">
                    <td className="py-3 text-slate-500">{formatDate(entry.createdAt)}</td>
                    <td className="py-3">{entry.reason}</td>
                    <td
                      className={`py-3 text-right font-bold ${entry.points >= 0 ? 'text-emerald-700' : 'text-red-600'}`}
                    >
                      {entry.points >= 0 ? `+${entry.points}` : entry.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </PanelShell>
  );
}
