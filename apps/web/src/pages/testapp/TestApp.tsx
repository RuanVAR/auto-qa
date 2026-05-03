/**
 * TestApp — a local test target with rich UI elements so Playwright automated
 * tests have real selectors to interact with.
 *
 * Routes (all under /testapp):
 *   /testapp          → Home (links to other pages)
 *   /testapp/login    → Login form (labels, text input, password, submit)
 *   /testapp/register → Register form (name, email, password, country dropdown)
 *   /testapp/products → Product list with tab filter + add-to-cart
 *   /testapp/cart     → Cart page (remove items, checkout)
 *   /testapp/profile  → Profile settings (tabs within page)
 */

import { useState } from 'react';
import { Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';

// ─── Shared nav ───────────────────────────────────────────────────────────────

function Nav({ cart }: { cart: number }) {
  return (
    <nav
      id="main-nav"
      style={{
        background: '#1e293b',
        color: '#f1f5f9',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        borderBottom: '1px solid #334155',
        fontSize: 14,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 18, color: '#818cf8', marginRight: 8 }}>
        🛒 ShopDemo
      </span>
      <Link id="nav-home" to="/testapp" style={{ color: '#cbd5e1', textDecoration: 'none' }}>Home</Link>
      <Link id="nav-products" to="/testapp/products" style={{ color: '#cbd5e1', textDecoration: 'none' }}>Products</Link>
      <Link id="nav-cart" to="/testapp/cart" style={{ color: '#cbd5e1', textDecoration: 'none' }}>
        Cart {cart > 0 && <span id="cart-count" style={{ background: '#818cf8', borderRadius: 99, padding: '1px 7px', fontSize: 11, marginLeft: 4 }}>{cart}</span>}
      </Link>
      <Link id="nav-profile" to="/testapp/profile" style={{ color: '#cbd5e1', textDecoration: 'none' }}>Profile</Link>
      <div style={{ flex: 1 }} />
      <Link id="nav-login" to="/testapp/login" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
    </nav>
  );
}

// ─── Shared input styles ──────────────────────────────────────────────────────

const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #334155',
  borderRadius: 8,
  background: '#0f172a',
  color: '#f1f5f9',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#94a3b8',
  marginBottom: 6,
};

const btn = (variant: 'primary' | 'danger' | 'secondary' = 'primary'): React.CSSProperties => ({
  padding: '10px 20px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
  background: variant === 'primary' ? '#818cf8' : variant === 'danger' ? '#ef4444' : '#334155',
  color: '#fff',
});

// ─── Home ─────────────────────────────────────────────────────────────────────

function HomePage() {
  return (
    <div id="page-home" style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
      <h1 id="home-heading" style={{ color: '#f1f5f9', fontSize: 36, marginBottom: 12 }}>
        Welcome to ShopDemo
      </h1>
      <p id="home-subheading" style={{ color: '#94a3b8', fontSize: 16, marginBottom: 40 }}>
        A feature-rich test target for QA automation.
      </p>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link id="home-cta-login" to="/testapp/login">
          <button style={btn('primary')}>Sign in</button>
        </Link>
        <Link id="home-cta-register" to="/testapp/register">
          <button style={btn('secondary')}>Create account</button>
        </Link>
        <Link id="home-cta-products" to="/testapp/products">
          <button style={btn('secondary')}>Browse products</button>
        </Link>
      </div>

      <div style={{ marginTop: 60, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {[
          { id: 'feature-fast', icon: '⚡', title: 'Fast Delivery', desc: 'Next-day shipping on all orders' },
          { id: 'feature-secure', icon: '🔒', title: 'Secure', desc: 'PCI-compliant checkout' },
          { id: 'feature-returns', icon: '↩️', title: 'Easy Returns', desc: '30-day return policy' },
        ].map(f => (
          <div key={f.id} id={f.id} style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
            <div style={{ fontSize: 28 }}>{f.icon}</div>
            <div style={{ color: '#f1f5f9', fontWeight: 600, marginTop: 8 }}>{f.title}</div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email) { setError('Email is required'); return; }
    if (!password) { setError('Password is required'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (email === 'test@example.com' && password === 'password') {
      setSuccess(true);
      onLogin();
      setTimeout(() => navigate('/testapp/products'), 1000);
    } else {
      setError('Invalid credentials. Use test@example.com / password');
    }
  }

  return (
    <div id="page-login" style={{ maxWidth: 400, margin: '60px auto' }}>
      <h2 id="login-heading" style={{ color: '#f1f5f9', marginBottom: 8 }}>Sign in</h2>
      <p style={{ color: '#64748b', fontSize: 14, marginBottom: 32 }}>
        Use <code style={{ color: '#818cf8' }}>test@example.com</code> / <code style={{ color: '#818cf8' }}>password</code>
      </p>

      {success && (
        <div id="login-success" style={{ background: '#064e3b', color: '#6ee7b7', padding: '12px 16px', borderRadius: 8, marginBottom: 20, fontSize: 14 }}>
          ✓ Login successful — redirecting…
        </div>
      )}
      {error && (
        <div id="login-error" style={{ background: '#450a0a', color: '#fca5a5', padding: '12px 16px', borderRadius: 8, marginBottom: 20, fontSize: 14 }}>
          {error}
        </div>
      )}

      <form id="login-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label id="label-email" htmlFor="input-email" style={label}>Email address</label>
          <input
            id="input-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={input}
            autoComplete="email"
          />
        </div>
        <div>
          <label id="label-password" htmlFor="input-password" style={label}>Password</label>
          <input
            id="input-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={input}
            autoComplete="current-password"
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
            <input id="checkbox-remember" type="checkbox" /> Remember me
          </label>
          <Link id="link-forgot" to="/testapp/login" style={{ color: '#818cf8', fontSize: 13 }}>Forgot password?</Link>
        </div>
        <button id="btn-login" type="submit" style={btn('primary')}>Sign in</button>
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          No account? <Link id="link-register" to="/testapp/register" style={{ color: '#818cf8' }}>Create one</Link>
        </p>
      </form>
    </div>
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────

const COUNTRIES = ['South Africa', 'United States', 'United Kingdom', 'Australia', 'Germany', 'France', 'India'];

function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', country: '', newsletter: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name) e.name = 'Name is required';
    if (!form.email || !form.email.includes('@')) e.email = 'Valid email required';
    if (form.password.length < 8) e.password = 'Password must be 8+ characters';
    if (!form.country) e.country = 'Please select a country';
    return e;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitted(true);
    setTimeout(() => navigate('/testapp/login'), 1500);
  }

  function field(name: keyof typeof form) {
    return {
      value: name === 'newsletter' ? undefined : form[name] as string,
      checked: name === 'newsletter' ? form.newsletter : undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const val = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
        setForm(f => ({ ...f, [name]: val }));
        setErrors(er => ({ ...er, [name]: '' }));
      },
    };
  }

  return (
    <div id="page-register" style={{ maxWidth: 480, margin: '60px auto' }}>
      <h2 id="register-heading" style={{ color: '#f1f5f9', marginBottom: 32 }}>Create account</h2>

      {submitted && (
        <div id="register-success" style={{ background: '#064e3b', color: '#6ee7b7', padding: '12px 16px', borderRadius: 8, marginBottom: 20 }}>
          ✓ Account created — redirecting to sign in…
        </div>
      )}

      <form id="register-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label id="label-name" htmlFor="input-name" style={label}>Full name</label>
          <input id="input-name" type="text" placeholder="Jane Smith" style={input} {...field('name')} />
          {errors.name && <span id="error-name" style={{ color: '#f87171', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.name}</span>}
        </div>
        <div>
          <label id="label-reg-email" htmlFor="input-reg-email" style={label}>Email address</label>
          <input id="input-reg-email" type="email" placeholder="you@example.com" style={input} {...field('email')} />
          {errors.email && <span id="error-email" style={{ color: '#f87171', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.email}</span>}
        </div>
        <div>
          <label id="label-reg-password" htmlFor="input-reg-password" style={label}>Password <span style={{ color: '#64748b' }}>(8+ characters)</span></label>
          <input id="input-reg-password" type="password" placeholder="••••••••" style={input} {...field('password')} />
          {errors.password && <span id="error-password" style={{ color: '#f87171', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.password}</span>}
        </div>
        <div>
          <label id="label-country" htmlFor="select-country" style={label}>Country</label>
          <select id="select-country" style={{ ...input, cursor: 'pointer' }} {...field('country')}>
            <option value="">Select your country…</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {errors.country && <span id="error-country" style={{ color: '#f87171', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.country}</span>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
          <input id="checkbox-newsletter" type="checkbox" {...field('newsletter')} />
          Subscribe to newsletter
        </label>
        <button id="btn-register" type="submit" style={btn('primary')}>Create account</button>
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Already have an account? <Link id="link-login" to="/testapp/login" style={{ color: '#818cf8' }}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}

// ─── Products ─────────────────────────────────────────────────────────────────

const ALL_PRODUCTS = [
  { id: 'p1', name: 'Wireless Headphones', category: 'electronics', price: 79.99, badge: 'Best seller' },
  { id: 'p2', name: 'Running Shoes', category: 'clothing', price: 129.99, badge: '' },
  { id: 'p3', name: 'Coffee Maker', category: 'home', price: 49.99, badge: 'Sale' },
  { id: 'p4', name: 'Bluetooth Speaker', category: 'electronics', price: 59.99, badge: '' },
  { id: 'p5', name: 'Yoga Mat', category: 'clothing', price: 29.99, badge: '' },
  { id: 'p6', name: 'Air Purifier', category: 'home', price: 199.99, badge: 'New' },
];

const CATEGORIES = ['all', 'electronics', 'clothing', 'home'];

function ProductsPage({ onAddToCart }: { onAddToCart: (name: string) => void }) {
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [added, setAdded] = useState<string | null>(null);

  const filtered = ALL_PRODUCTS
    .filter(p => (activeTab === 'all' || p.category === activeTab))
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortBy === 'price' ? a.price - b.price : a.name.localeCompare(b.name));

  function handleAdd(p: typeof ALL_PRODUCTS[0]) {
    onAddToCart(p.name);
    setAdded(p.id);
    setTimeout(() => setAdded(null), 1500);
  }

  return (
    <div id="page-products" style={{ maxWidth: 900, margin: '40px auto' }}>
      <h2 id="products-heading" style={{ color: '#f1f5f9', marginBottom: 24 }}>Products</h2>

      {/* Search + Sort bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label id="label-search" htmlFor="input-search" style={label}>Search</label>
          <input
            id="input-search"
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={input}
          />
        </div>
        <div>
          <label id="label-sort" htmlFor="select-sort" style={label}>Sort by</label>
          <select id="select-sort" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...input, width: 160, cursor: 'pointer' }}>
            <option value="name">Name</option>
            <option value="price">Price</option>
          </select>
        </div>
      </div>

      {/* Category tabs */}
      <div id="category-tabs" role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid #334155' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            id={`tab-${cat}`}
            role="tab"
            aria-selected={activeTab === cat}
            onClick={() => setActiveTab(cat)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === cat ? 600 : 400,
              color: activeTab === cat ? '#818cf8' : '#64748b',
              borderBottom: activeTab === cat ? '2px solid #818cf8' : '2px solid transparent',
              textTransform: 'capitalize',
              transition: 'all 0.15s',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div id="product-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        {filtered.length === 0 && (
          <p id="no-products" style={{ color: '#64748b', gridColumn: '1/-1' }}>No products found.</p>
        )}
        {filtered.map(p => (
          <div
            key={p.id}
            id={`product-${p.id}`}
            style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155', position: 'relative' }}
          >
            {p.badge && (
              <span
                id={`badge-${p.id}`}
                style={{ position: 'absolute', top: 12, right: 12, background: '#818cf8', color: '#fff', borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}
              >
                {p.badge}
              </span>
            )}
            <div
              id={`product-icon-${p.id}`}
              style={{ width: 64, height: 64, borderRadius: 12, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 12 }}
            >
              {p.category === 'electronics' ? '🎧' : p.category === 'clothing' ? '👟' : '🏠'}
            </div>
            <div id={`product-name-${p.id}`} style={{ color: '#f1f5f9', fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
            <div id={`product-category-${p.id}`} style={{ color: '#64748b', fontSize: 12, textTransform: 'capitalize', marginBottom: 12 }}>{p.category}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span id={`product-price-${p.id}`} style={{ color: '#818cf8', fontWeight: 700, fontSize: 18 }}>${p.price}</span>
              <button
                id={`btn-add-${p.id}`}
                onClick={() => handleAdd(p)}
                style={{ ...btn(added === p.id ? 'secondary' : 'primary'), padding: '7px 14px', fontSize: 13 }}
              >
                {added === p.id ? '✓ Added' : 'Add to cart'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Cart ─────────────────────────────────────────────────────────────────────

function CartPage({ items, onRemove, onClear }: { items: string[]; onRemove: (i: number) => void; onClear: () => void }) {
  const [checkout, setCheckout] = useState(false);

  if (checkout) {
    return (
      <div id="page-checkout-success" style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <h2 id="checkout-heading" style={{ color: '#f1f5f9' }}>Order confirmed!</h2>
        <p style={{ color: '#94a3b8', marginBottom: 32 }}>Your order has been placed successfully.</p>
        <Link to="/testapp/products">
          <button id="btn-continue-shopping" style={btn('primary')}>Continue shopping</button>
        </Link>
      </div>
    );
  }

  return (
    <div id="page-cart" style={{ maxWidth: 600, margin: '40px auto' }}>
      <h2 id="cart-heading" style={{ color: '#f1f5f9', marginBottom: 24 }}>Your Cart</h2>

      {items.length === 0 ? (
        <div id="cart-empty" style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🛒</div>
          <p style={{ color: '#64748b' }}>Your cart is empty.</p>
          <Link to="/testapp/products">
            <button id="btn-shop-now" style={{ ...btn('primary'), marginTop: 16 }}>Shop now</button>
          </Link>
        </div>
      ) : (
        <>
          <div id="cart-items" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {items.map((item, i) => (
              <div key={i} id={`cart-item-${i}`} style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #334155' }}>
                <span id={`cart-item-name-${i}`} style={{ color: '#f1f5f9', fontSize: 14 }}>{item}</span>
                <button id={`btn-remove-${i}`} onClick={() => onRemove(i)} style={{ ...btn('danger'), padding: '5px 12px', fontSize: 12 }}>Remove</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button id="btn-checkout" onClick={() => { setCheckout(true); onClear(); }} style={btn('primary')}>
              Checkout ({items.length} item{items.length > 1 ? 's' : ''})
            </button>
            <button id="btn-clear-cart" onClick={onClear} style={btn('secondary')}>Clear cart</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Profile (tabs within page) ───────────────────────────────────────────────

const PROFILE_TABS = ['account', 'notifications', 'security'] as const;

function ProfilePage() {
  const [activeTab, setActiveTab] = useState<typeof PROFILE_TABS[number]>('account');
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div id="page-profile" style={{ maxWidth: 640, margin: '40px auto' }}>
      <h2 id="profile-heading" style={{ color: '#f1f5f9', marginBottom: 24 }}>Profile settings</h2>

      {/* Tab bar */}
      <div id="profile-tabs" role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #334155', marginBottom: 32 }}>
        {PROFILE_TABS.map(t => (
          <button
            key={t}
            id={`profile-tab-${t}`}
            role="tab"
            aria-selected={activeTab === t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === t ? 600 : 400,
              color: activeTab === t ? '#818cf8' : '#64748b',
              borderBottom: activeTab === t ? '2px solid #818cf8' : '2px solid transparent',
              textTransform: 'capitalize',
              transition: 'all 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {saved && (
        <div id="profile-saved" style={{ background: '#064e3b', color: '#6ee7b7', padding: '12px 16px', borderRadius: 8, marginBottom: 20, fontSize: 14 }}>
          ✓ Settings saved
        </div>
      )}

      {/* Account tab */}
      {activeTab === 'account' && (
        <form id="form-account" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label id="label-display-name" htmlFor="input-display-name" style={label}>Display name</label>
            <input id="input-display-name" type="text" defaultValue="QA Tester" style={input} />
          </div>
          <div>
            <label id="label-account-email" htmlFor="input-account-email" style={label}>Email address</label>
            <input id="input-account-email" type="email" defaultValue="test@example.com" style={input} />
          </div>
          <div>
            <label id="label-timezone" htmlFor="select-timezone" style={label}>Timezone</label>
            <select id="select-timezone" defaultValue="UTC+2" style={{ ...input, cursor: 'pointer' }}>
              <option>UTC-8 (Pacific)</option>
              <option>UTC-5 (Eastern)</option>
              <option>UTC+0 (GMT)</option>
              <option>UTC+1 (CET)</option>
              <option>UTC+2 (SAST)</option>
              <option>UTC+5:30 (IST)</option>
            </select>
          </div>
          <div>
            <label id="label-bio" htmlFor="input-bio" style={label}>Bio</label>
            <textarea
              id="input-bio"
              defaultValue="I write automated tests."
              rows={3}
              style={{ ...input, resize: 'vertical' as const }}
            />
          </div>
          <button id="btn-save-account" type="submit" style={{ ...btn('primary'), alignSelf: 'flex-start' }}>Save changes</button>
        </form>
      )}

      {/* Notifications tab */}
      {activeTab === 'notifications' && (
        <form id="form-notifications" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { id: 'notif-email', label: 'Email notifications', defaultChecked: true },
            { id: 'notif-sms', label: 'SMS notifications', defaultChecked: false },
            { id: 'notif-push', label: 'Push notifications', defaultChecked: true },
            { id: 'notif-marketing', label: 'Marketing emails', defaultChecked: false },
          ].map(n => (
            <label key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#cbd5e1', fontSize: 14 }}>
              <input id={n.id} type="checkbox" defaultChecked={n.defaultChecked} style={{ width: 16, height: 16 }} />
              {n.label}
            </label>
          ))}
          <button id="btn-save-notifications" type="submit" style={{ ...btn('primary'), alignSelf: 'flex-start', marginTop: 8 }}>Save preferences</button>
        </form>
      )}

      {/* Security tab */}
      {activeTab === 'security' && (
        <form id="form-security" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label id="label-current-password" htmlFor="input-current-password" style={label}>Current password</label>
            <input id="input-current-password" type="password" placeholder="••••••••" style={input} />
          </div>
          <div>
            <label id="label-new-password" htmlFor="input-new-password" style={label}>New password</label>
            <input id="input-new-password" type="password" placeholder="••••••••" style={input} />
          </div>
          <div>
            <label id="label-confirm-password" htmlFor="input-confirm-password" style={label}>Confirm new password</label>
            <input id="input-confirm-password" type="password" placeholder="••••••••" style={input} />
          </div>
          <div>
            <label id="label-2fa" htmlFor="select-2fa" style={label}>Two-factor authentication</label>
            <select id="select-2fa" style={{ ...input, cursor: 'pointer' }}>
              <option value="off">Disabled</option>
              <option value="sms">SMS</option>
              <option value="app">Authenticator app</option>
            </select>
          </div>
          <button id="btn-save-security" type="submit" style={{ ...btn('primary'), alignSelf: 'flex-start' }}>Update security settings</button>
        </form>
      )}
    </div>
  );
}

// ─── Root app ─────────────────────────────────────────────────────────────────

export function TestApp() {
  const [cartItems, setCartItems] = useState<string[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);

  function addToCart(name: string) {
    setCartItems(c => [...c, name]);
  }
  function removeFromCart(i: number) {
    setCartItems(c => c.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'system-ui, sans-serif' }}>
      <Nav cart={cartItems.length} />
      <div style={{ padding: '0 24px' }}>
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="login" element={<LoginPage onLogin={() => setLoggedIn(true)} />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="products" element={<ProductsPage onAddToCart={addToCart} />} />
          <Route path="cart" element={<CartPage items={cartItems} onRemove={removeFromCart} onClear={() => setCartItems([])} />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/testapp" replace />} />
        </Routes>
      </div>
    </div>
  );
}
