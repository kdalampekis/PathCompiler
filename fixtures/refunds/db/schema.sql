CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  original_amount INTEGER NOT NULL CHECK (original_amount > 0),
  refunded_amount INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'EUR')),
  CHECK (refunded_amount <= original_amount)
);

CREATE TABLE refund_requests (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments (id),
  requester_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (payment_id, requester_id, amount)
);
