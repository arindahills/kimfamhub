-- KlaFam module schema

CREATE TABLE IF NOT EXISTS klafam_members (
    id          SERIAL PRIMARY KEY,
    slug        VARCHAR(30) UNIQUE NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    family_id   INTEGER REFERENCES families(id),
    is_active   BOOLEAN DEFAULT TRUE,
    joined_date DATE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS klafam_cycles (
    id           SERIAL PRIMARY KEY,
    year         INTEGER NOT NULL,
    month        INTEGER NOT NULL,        -- 1-12
    month_label  VARCHAR(20) NOT NULL,    -- "Jan 2021"
    due_date     DATE,
    beneficiary_id INTEGER REFERENCES klafam_members(id),
    total_collected BIGINT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(year, month)
);

CREATE TABLE IF NOT EXISTS klafam_contributions (
    id          SERIAL PRIMARY KEY,
    cycle_id    INTEGER NOT NULL REFERENCES klafam_cycles(id) ON DELETE CASCADE,
    member_id   INTEGER NOT NULL REFERENCES klafam_members(id),
    amount      BIGINT NOT NULL DEFAULT 0,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',  -- paid, missed, offset, pending, na
    offset_reason TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cycle_id, member_id)
);

-- Seed members
INSERT INTO klafam_members (slug, display_name, family_id, is_active, joined_date) VALUES
    ('arindas',    'The Arindas',    1, TRUE,  '2021-01-01'),
    ('turamyes',   'The Turamyes',   4, TRUE,  '2021-01-01'),
    ('priscilla',  'Priscilla',      7, TRUE,  '2022-07-01'),
    ('alex',       'Alex',           7, TRUE,  '2022-07-01'),
    ('tuhimbises', 'The Tuhimbises', 7, FALSE, '2021-01-01'),  -- merged into priscilla+alex by mid-2022
    ('boaz',       'Mr Boaz',        NULL, FALSE, '2021-01-01')  -- historical only
ON CONFLICT (slug) DO NOTHING;
