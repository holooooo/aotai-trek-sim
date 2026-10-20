-- Anonymous gameplay telemetry. Apply once via D1 migrations; no account/user text is stored.
PRAGMA foreign_keys = ON;

CREATE TABLE analytics_totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  players INTEGER NOT NULL DEFAULT 0,
  telemetry_events INTEGER NOT NULL DEFAULT 0,
  run_started INTEGER NOT NULL DEFAULT 0,
  run_resumed INTEGER NOT NULL DEFAULT 0,
  ended_runs INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  active_seconds REAL NOT NULL DEFAULT 0,
  active_runs INTEGER NOT NULL DEFAULT 0,
  unique_ending_unlocks INTEGER NOT NULL DEFAULT 0
);
INSERT INTO analytics_totals (id) VALUES (1);

CREATE TABLE analytics_visitors (
  visitor_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  endings_unlocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE analytics_runs (
  visitor_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  role TEXT,
  difficulty TEXT,
  started INTEGER NOT NULL DEFAULT 0,
  ended INTEGER NOT NULL DEFAULT 0,
  ending TEXT,
  cause TEXT,
  active_seconds REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (visitor_id, run_id)
);
CREATE TABLE analytics_visitor_endings (
  visitor_id TEXT NOT NULL,
  ending_key TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  PRIMARY KEY (visitor_id, ending_key)
);
CREATE TABLE analytics_endings (
  ending TEXT NOT NULL,
  cause TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ending, cause)
);
CREATE TABLE analytics_event_totals (
  event_id TEXT PRIMARY KEY,
  started INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE analytics_shop_totals (
  item_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  buys INTEGER NOT NULL DEFAULT 0,
  refunds INTEGER NOT NULL DEFAULT 0,
  bought_quantity INTEGER NOT NULL DEFAULT 0,
  refunded_quantity INTEGER NOT NULL DEFAULT 0,
  buy_cost REAL NOT NULL DEFAULT 0,
  refund_cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE telemetry_events (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  role TEXT,
  difficulty TEXT,
  event_id TEXT,
  item_id TEXT,
  item_category TEXT,
  quantity INTEGER,
  cost REAL,
  ending TEXT,
  cause TEXT,
  active_seconds REAL,
  death INTEGER,
  fresh INTEGER
);
CREATE INDEX telemetry_events_received_at ON telemetry_events (received_at);

CREATE TRIGGER analytics_visitor_added AFTER INSERT ON analytics_visitors BEGIN
  UPDATE analytics_totals SET players = players + 1 WHERE id = 1;
END;
CREATE TRIGGER analytics_ending_unlocked AFTER INSERT ON analytics_visitor_endings BEGIN
  UPDATE analytics_visitors SET endings_unlocked = endings_unlocked + 1 WHERE visitor_id = NEW.visitor_id;
  UPDATE analytics_totals SET unique_ending_unlocks = unique_ending_unlocks + 1 WHERE id = 1;
END;
CREATE TRIGGER analytics_run_started AFTER UPDATE OF started ON analytics_runs
WHEN OLD.started = 0 AND NEW.started = 1 BEGIN
  UPDATE analytics_totals SET run_started = run_started + 1 WHERE id = 1;
END;
CREATE TRIGGER analytics_run_activity AFTER UPDATE OF active_seconds ON analytics_runs
WHEN NEW.active_seconds > OLD.active_seconds BEGIN
  UPDATE analytics_totals SET
    active_seconds = active_seconds + NEW.active_seconds - OLD.active_seconds,
    active_runs = active_runs + CASE WHEN OLD.active_seconds = 0 THEN 1 ELSE 0 END
  WHERE id = 1;
END;
CREATE TRIGGER analytics_run_ended AFTER UPDATE OF ended ON analytics_runs
WHEN OLD.ended = 0 AND NEW.ended = 1 BEGIN
  UPDATE analytics_totals SET ended_runs = ended_runs + 1, deaths = deaths + CASE WHEN NEW.ending = 'dead' THEN 1 ELSE 0 END WHERE id = 1;
  INSERT INTO analytics_endings (ending, cause, total) VALUES (NEW.ending, COALESCE(NEW.cause, ''), 1)
    ON CONFLICT (ending, cause) DO UPDATE SET total = total + 1;
  INSERT OR IGNORE INTO analytics_visitor_endings (visitor_id, ending_key, first_at)
    VALUES (NEW.visitor_id, NEW.ending || CASE WHEN NEW.ending = 'dead' THEN ':' || COALESCE(NEW.cause, 'hypothermia') ELSE '' END, NEW.updated_at);
END;
CREATE TRIGGER telemetry_event_received AFTER INSERT ON telemetry_events BEGIN
  INSERT OR IGNORE INTO analytics_visitors (visitor_id, created_at) VALUES (NEW.visitor_id, NEW.received_at);
  INSERT OR IGNORE INTO analytics_runs (visitor_id, run_id, role, difficulty, updated_at) VALUES (NEW.visitor_id, NEW.run_id, NEW.role, NEW.difficulty, NEW.received_at);
  UPDATE analytics_runs SET
    role = COALESCE(role, NEW.role), difficulty = COALESCE(difficulty, NEW.difficulty),
    updated_at = MAX(updated_at, NEW.received_at), active_seconds = MAX(active_seconds, COALESCE(NEW.active_seconds, 0))
    WHERE visitor_id = NEW.visitor_id AND run_id = NEW.run_id;
  UPDATE analytics_totals SET telemetry_events = telemetry_events + 1,
    run_resumed = run_resumed + CASE WHEN NEW.type = 'run_resumed' THEN 1 ELSE 0 END WHERE id = 1;
  UPDATE analytics_runs SET started = 1 WHERE visitor_id = NEW.visitor_id AND run_id = NEW.run_id AND NEW.type = 'run_started';
  UPDATE analytics_runs SET ended = 1, ending = NEW.ending, cause = NEW.cause
    WHERE visitor_id = NEW.visitor_id AND run_id = NEW.run_id AND ended = 0 AND NEW.type = 'run_ended';
  INSERT INTO analytics_event_totals (event_id, started, completed)
    SELECT NEW.event_id, CASE WHEN NEW.type = 'event_started' THEN 1 ELSE 0 END, CASE WHEN NEW.type = 'event_completed' THEN 1 ELSE 0 END
    WHERE NEW.type IN ('event_started', 'event_completed')
    ON CONFLICT (event_id) DO UPDATE SET started = started + excluded.started, completed = completed + excluded.completed;
  INSERT INTO analytics_shop_totals (item_id, category, buys, refunds, bought_quantity, refunded_quantity, buy_cost, refund_cost)
    SELECT NEW.item_id, NEW.item_category,
      CASE WHEN NEW.type = 'shop_buy' THEN 1 ELSE 0 END, CASE WHEN NEW.type = 'shop_refund' THEN 1 ELSE 0 END,
      CASE WHEN NEW.type = 'shop_buy' THEN NEW.quantity ELSE 0 END, CASE WHEN NEW.type = 'shop_refund' THEN NEW.quantity ELSE 0 END,
      CASE WHEN NEW.type = 'shop_buy' THEN NEW.cost ELSE 0 END, CASE WHEN NEW.type = 'shop_refund' THEN NEW.cost ELSE 0 END
    WHERE NEW.type IN ('shop_buy', 'shop_refund')
    ON CONFLICT (item_id) DO UPDATE SET buys = buys + excluded.buys, refunds = refunds + excluded.refunds,
      bought_quantity = bought_quantity + excluded.bought_quantity, refunded_quantity = refunded_quantity + excluded.refunded_quantity,
      buy_cost = buy_cost + excluded.buy_cost, refund_cost = refund_cost + excluded.refund_cost;
END;

CREATE TABLE choice_questions (
  question_id TEXT PRIMARY KEY,
  option_ids TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE choice_votes (
  visitor_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, question_id)
);
CREATE INDEX choice_votes_received_at ON choice_votes (received_at);
CREATE TABLE choice_counts (
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, option_id)
);
CREATE TRIGGER choice_vote_received AFTER INSERT ON choice_votes BEGIN
  UPDATE choice_questions SET total = total + 1 WHERE question_id = NEW.question_id;
  INSERT INTO choice_counts (question_id, option_id, total) VALUES (NEW.question_id, NEW.option_id, 1)
    ON CONFLICT (question_id, option_id) DO UPDATE SET total = total + 1;
END;

-- These views are for the database owner; no HTTP endpoint exposes them.
CREATE VIEW analytics_overview AS SELECT *,
  CASE WHEN active_runs > 0 THEN active_seconds / active_runs ELSE NULL END AS avg_active_seconds_per_active_run,
  CASE WHEN players > 0 THEN 1.0 * unique_ending_unlocks / players ELSE NULL END AS avg_unlocked_endings_per_device
  FROM analytics_totals;
CREATE VIEW analytics_role_difficulty AS SELECT COALESCE(role, 'unknown') AS role, COALESCE(difficulty, 'unknown') AS difficulty,
  COUNT(*) AS observed_runs, SUM(started) AS fresh_runs, SUM(ended) AS ended_runs,
  SUM(CASE WHEN ending = 'dead' THEN 1 ELSE 0 END) AS deaths,
  AVG(CASE WHEN active_seconds > 0 THEN active_seconds ELSE NULL END) AS avg_active_seconds_per_active_run
  FROM analytics_runs GROUP BY role, difficulty;
CREATE VIEW analytics_shop_categories AS SELECT category, SUM(buys) AS buys, SUM(refunds) AS refunds,
  SUM(bought_quantity) AS bought_quantity, SUM(refunded_quantity) AS refunded_quantity,
  SUM(buy_cost) AS buy_cost, SUM(refund_cost) AS refund_cost
  FROM analytics_shop_totals GROUP BY category;
