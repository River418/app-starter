CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
INSERT INTO schema_version VALUES(1);
CREATE TABLE members(user_id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,role TEXT NOT NULL CHECK(role IN('admin','member')),status TEXT NOT NULL CHECK(status IN('pending','active','disabled')),created_at INTEGER NOT NULL);
CREATE TABLE bootstrap(id INTEGER PRIMARY KEY CHECK(id=1),token_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN('ready','claimed','complete')),user_id TEXT,email TEXT,operation_id TEXT);
CREATE TABLE auth_operations(operation_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,target TEXT NOT NULL,kind TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE auth_actions(id TEXT PRIMARY KEY,operation_id TEXT UNIQUE,user_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('invite','recovery')),state TEXT NOT NULL DEFAULT 'issued' CHECK(state IN('issued','verified','complete','revoked')),expires_at INTEGER NOT NULL);
CREATE INDEX auth_actions_user ON auth_actions(user_id,kind,state);
CREATE TABLE audit_log(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL,target_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
