CREATE TABLE records(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES members(user_id),title TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX records_owner_updated ON records(owner_id,updated_at DESC,id DESC);
CREATE TABLE files(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES members(user_id),record_id TEXT REFERENCES records(id) ON DELETE SET NULL,object_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','ready','deleting')),created_at INTEGER NOT NULL,upload_complete INTEGER NOT NULL DEFAULT 0,cleanup_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX files_record_owner ON files(record_id,owner_id,state);
CREATE INDEX files_cleanup ON files(state,cleanup_at,created_at);
INSERT INTO schema_version VALUES(2);
