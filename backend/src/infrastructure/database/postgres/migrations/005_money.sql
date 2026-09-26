-- Expenses, subscriptions and budgets (ERD: Expense, Subscription, Budget).
--
-- All monetary columns are NUMERIC(14,2), never a floating-point type. Binary
-- floating point cannot represent 0.10 exactly, so sums drift and a spending
-- report stops reconciling. NUMERIC is exact decimal arithmetic. This is also
-- why the spec routes financial data to PostgreSQL: it is the part of the model
-- with a real correctness requirement, not merely a storage requirement.

CREATE TABLE expenses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    amount     NUMERIC(14,2) NOT NULL,
    currency   CHAR(3)       NOT NULL DEFAULT 'EGP',
    category   TEXT          NOT NULL,
    spent_on   DATE          NOT NULL DEFAULT CURRENT_DATE,
    note       TEXT,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT expenses_amount_positive  CHECK (amount > 0),
    CONSTRAINT expenses_category_not_blank CHECK (btrim(category) <> ''),
    CONSTRAINT expenses_category_length  CHECK (char_length(category) <= 60),
    CONSTRAINT expenses_currency_format  CHECK (currency ~ '^[A-Z]{3}$')
);

-- Weekly and monthly reports (FR-18) scan a user's expenses over a date range.
CREATE INDEX expenses_user_date_idx     ON expenses (user_id, spent_on DESC);
-- Budget progress (FR-17) groups a user's spending by category within a month.
CREATE INDEX expenses_user_category_idx ON expenses (user_id, category, spent_on DESC);


CREATE TABLE subscriptions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name          TEXT          NOT NULL,
    amount        NUMERIC(14,2) NOT NULL,
    currency      CHAR(3)       NOT NULL DEFAULT 'EGP',
    renewal_date  DATE          NOT NULL,
    billing_cycle TEXT          NOT NULL DEFAULT 'monthly',
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT subscriptions_amount_positive   CHECK (amount > 0),
    CONSTRAINT subscriptions_name_not_blank    CHECK (btrim(name) <> ''),
    CONSTRAINT subscriptions_cycle_valid       CHECK (billing_cycle IN ('monthly', 'yearly')),
    CONSTRAINT subscriptions_currency_format   CHECK (currency ~ '^[A-Z]{3}$')
);

-- The renewal-reminder job asks "which active subscriptions renew soon", across
-- all users, so this index leads with the date rather than the user.
CREATE INDEX subscriptions_renewal_idx ON subscriptions (renewal_date) WHERE is_active;
CREATE INDEX subscriptions_user_idx    ON subscriptions (user_id, renewal_date);


CREATE TABLE budgets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category      TEXT          NOT NULL,
    monthly_limit NUMERIC(14,2) NOT NULL,
    currency      CHAR(3)       NOT NULL DEFAULT 'EGP',
    -- The ERD stores the first day of the month as the scoping key.
    month         DATE          NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT budgets_limit_positive    CHECK (monthly_limit > 0),
    CONSTRAINT budgets_category_not_blank CHECK (btrim(category) <> ''),
    CONSTRAINT budgets_currency_format   CHECK (currency ~ '^[A-Z]{3}$'),
    -- Guarantees the scoping convention holds for every row, so queries can rely
    -- on equality against date_trunc('month', ...) instead of a range.
    CONSTRAINT budgets_month_is_first_day CHECK (EXTRACT(DAY FROM month) = 1)
);

-- One budget per category per month per user.
CREATE UNIQUE INDEX budgets_user_category_month_key
    ON budgets (user_id, lower(category), month);

CREATE TRIGGER expenses_set_updated_at
    BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER subscriptions_set_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER budgets_set_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
