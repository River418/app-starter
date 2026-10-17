import { z } from "zod";
export const recordInput = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().max(100000),
});
export type RecordInput = z.infer<typeof recordInput>;
export interface RecordDto extends RecordInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}
export interface FileDto {
  id: string;
  name: string;
  size: number;
  contentType: string;
}
export interface RecordPage {
  items: RecordDto[];
  total: number;
  page: number;
  pageSize: number;
}
