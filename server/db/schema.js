// The shop's tables. Safe to run on every start: it only creates what's
// missing. They live in their own "shop" schema, which Supabase does not expose
// through its public REST API; row level security (with no policies) is a
// second lock on the same door. The server connects as the tables' owner, so
// neither affects it.
export const SCHEMA = `
create schema if not exists shop;

create table if not exists shop.products (
  id             text primary key,
  name           text not null,
  description    text not null default '',
  price          numeric(12, 2) not null check (price >= 0),
  original_price numeric(12, 2),
  category       text not null default 'Uncategorized',
  fabric         text not null default '',
  color          text not null default '',
  images         jsonb not null default '[]',
  featured       boolean not null default false,
  in_stock       boolean not null default true,
  stock          integer check (stock is null or stock >= 0),
  created_at     bigint not null
);
create index if not exists products_created_at on shop.products (created_at desc);

create table if not exists shop.orders (
  id               text primary key,
  order_no         text not null unique,
  attempt_id       text unique,
  customer         jsonb not null,
  items            jsonb not null,
  subtotal         numeric(12, 2) not null,
  shipping_fee     numeric(12, 2) not null,
  total            numeric(12, 2) not null,
  payment          text not null,
  payment_status   text not null,
  payment_id       text,
  status           text not null,
  is_test          boolean not null default false,
  payment_link     text,
  gateway_status   text,
  gateway_response jsonb,
  paid_at          bigint,
  created_at       bigint not null,
  updated_at       timestamptz not null default now()
);
create index if not exists orders_created_at on shop.orders (created_at desc);

-- Every step of every payment: session created, shopper returned, status
-- checked with HDFC, anything suspicious. Never deleted by the app.
create table if not exists shop.payment_events (
  id         bigserial primary key,
  order_no   text not null,
  kind       text not null,
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists payment_events_order on shop.payment_events (order_no, id);

-- The gateway's own id for this order (Razorpay's order_…), so its webhooks
-- and status replies can be matched back to ours.
alter table shop.orders add column if not exists gateway_ref text;
create index if not exists orders_gateway_ref on shop.orders (gateway_ref);

-- The colours a saree comes in: [{ name, hex, images }].
alter table shop.products add column if not exists colors jsonb not null default '[]';

-- Shop-wide settings the admin can change, one JSON value per key (e.g. the
-- category list). A missing key means "still the default".
create table if not exists shop.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table shop.products enable row level security;
alter table shop.orders enable row level security;
alter table shop.payment_events enable row level security;
alter table shop.settings enable row level security;
`;
