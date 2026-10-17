import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const members = sqliteTable("members", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["admin", "member"] }).notNull(),
  status: text("status", { enum: ["pending", "active", "disabled"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});
export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => members.userId),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("records_owner_updated").on(table.ownerId, table.updatedAt, table.id),
  ],
);
export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => members.userId),
    recordId: text("record_id").references(() => records.id, {
      onDelete: "set null",
    }),
    objectKey: text("object_key").notNull().unique(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    state: text("state", { enum: ["pending", "ready", "deleting"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    uploadComplete: integer("upload_complete").notNull().default(0),
    cleanupAt: integer("cleanup_at").notNull().default(0),
  },
  (table) => [
    index("files_record_owner").on(table.recordId, table.ownerId, table.state),
    index("files_cleanup").on(table.state, table.cleanupAt, table.createdAt),
  ],
);
