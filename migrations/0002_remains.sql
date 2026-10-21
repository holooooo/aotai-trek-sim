-- Anonymous, short-lived markers in simulated world coordinates only.
CREATE TABLE remains (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 96 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  world TEXT NOT NULL CHECK (world = 'aotai-winter-v1'),
  path TEXT NOT NULL CHECK (path IN ('main', 'hetaoping', 'qingfengxia', 'dudumen', 'diaoyutai')),
  x REAL NOT NULL CHECK (x BETWEEN -100000 AND 100000),
  z REAL NOT NULL CHECK (z BETWEEN -100000 AND 100000),
  cell_x INTEGER NOT NULL,
  cell_z INTEGER NOT NULL,
  role TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  cause TEXT NOT NULL,
  game_minute REAL NOT NULL CHECK (game_minute BETWEEN 0 AND 1000000),
  core REAL NOT NULL CHECK (core BETWEEN 0 AND 45),
  health REAL NOT NULL CHECK (health BETWEEN 0 AND 100),
  food REAL NOT NULL CHECK (food BETWEEN 0 AND 100),
  water REAL NOT NULL CHECK (water BETWEEN 0 AND 100),
  stress REAL NOT NULL CHECK (stress BETWEEN 0 AND 100),
  altitude REAL NOT NULL CHECK (altitude BETWEEN -1000 AND 10000),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at = created_at + 2592000000)
);
-- IN lists on both cell axes let SQLite apply the final expiry range through this index.
CREATE INDEX remains_nearby ON remains (world, path, cell_x, cell_z, expires_at);
CREATE INDEX remains_expiry ON remains (expires_at);
