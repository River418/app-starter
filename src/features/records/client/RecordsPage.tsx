import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Plus, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Input,
  Textarea,
  Field,
  Modal,
} from "../../../client/components/ui";
import { api, json } from "../../../client/lib/api";
import { queryClient } from "../../../client/lib/query";
import {
  recordInput,
  type RecordInput,
  type RecordDto,
  type RecordPage,
  type FileDto,
} from "../shared/contracts";
import type { Identity } from "../../../shared/identity";

type Detail = RecordDto & { files: FileDto[] };
export function RecordsPage() {
  const identity = useOutletContext<Identity>();
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation();
  const [search, setSearch] = useState(params.get("q") || "");
  const page = Number(params.get("page")) || 1;
  const selected = params.get("selected");
  const q = params.get("q") || "";
  useEffect(() => setSearch(q), [q]);
  const list = useQuery({
    queryKey: ["records", identity.userId, q, page],
    queryFn: () =>
      api<RecordPage>(
        `/api/records?${new URLSearchParams({ q, page: String(page), pageSize: "10" })}`,
      ),
  });
  const detail = useQuery({
    queryKey: ["record", identity.userId, selected],
    queryFn: () => api<Detail>(`/api/records/${encodeURIComponent(selected!)}`),
    enabled: !!selected && selected !== "new",
  });
  const select = (id: string | null) =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      id ? next.set("selected", id) : next.delete("selected");
      return next;
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("workspace")}</span>
          <h1>{t("records")}</h1>
        </div>
        <Button onClick={() => select("new")}>
          <Plus size={17} />
          {t("newRecord")}
        </Button>
      </div>
      <div className="records-grid">
        <section className="panel records-list">
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setParams((old) => {
                const next = new URLSearchParams(old);
                search ? next.set("q", search) : next.delete("q");
                next.delete("page");
                return next;
              });
            }}
          >
            <Input
              aria-label={t("searchRecords")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button variant="secondary">{t("search")}</Button>
          </form>
          {list.isPending ? (
            <p role="status" className="muted">
              {t("loading")}
            </p>
          ) : list.error ? (
            <p role="alert">{list.error.message}</p>
          ) : (
            <>
              <div className="record-items">
                {list.data.items.map((record) => (
                  <button
                    key={record.id}
                    className={`record-item ${record.id === selected ? "selected" : ""}`}
                    onClick={() => select(record.id)}
                  >
                    <FileText size={18} />
                    <span>
                      <strong>{record.title}</strong>
                      <small>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(record.updatedAt)}
                      </small>
                    </span>
                  </button>
                ))}
                {!list.data.items.length && (
                  <p className="empty-list">{t("empty")}</p>
                )}
              </div>
              <div className="pagination">
                <Button
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() =>
                    setParams((old) => {
                      const next = new URLSearchParams(old);
                      next.set("page", String(page - 1));
                      return next;
                    })
                  }
                >
                  {t("previous")}
                </Button>
                <span>
                  {page} / {Math.max(1, Math.ceil(list.data.total / 10))}
                </span>
                <Button
                  variant="ghost"
                  disabled={page * 10 >= list.data.total}
                  onClick={() =>
                    setParams((old) => {
                      const next = new URLSearchParams(old);
                      next.set("page", String(page + 1));
                      return next;
                    })
                  }
                >
                  {t("next")}
                </Button>
              </div>
            </>
          )}
        </section>
        <section className="panel record-editor">
          {selected === "new" ? (
            <RecordEditor key="new" onSelect={select} />
          ) : selected ? (
            detail.isPending ? (
              <p role="status">{t("loading")}</p>
            ) : detail.error ? (
              <p role="alert">{detail.error.message}</p>
            ) : (
              <RecordEditor
                key={`${selected}:${detail.data.updatedAt}`}
                record={detail.data}
                onSelect={select}
              />
            )
          ) : (
            <div className="empty-detail">
              <FileText size={36} />
              <h2>{t("selectRecord")}</h2>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function RecordEditor({
  record,
  onSelect,
}: {
  record?: Detail;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RecordInput>({
    resolver: zodResolver(recordInput),
    defaultValues: record
      ? { title: record.title, content: record.content }
      : { title: "", content: "" },
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["records"] }),
      queryClient.invalidateQueries({ queryKey: ["record"] }),
    ]);
  };
  const saved = useMutation({
    mutationFn: (values: RecordInput) =>
      api<RecordDto>(record ? `/api/records/${record.id}` : "/api/records", {
        method: record ? "PATCH" : "POST",
        body: json(values),
      }),
    onSuccess: async (result) => {
      await invalidate();
      onSelect(result.id);
      toast.success(t("saved"));
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/records/${record!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirm(false);
      onSelect(null);
      await invalidate();
      toast.success(t("removed"));
    },
    onError: (error) => toast.error(error.message),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch(`/api/records/${record!.id}/files`, {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Upload failed");
      }
    },
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const removeFile = useMutation({
    mutationFn: (id: string) => api(`/api/files/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <div className="detail-heading">
        <h2>{record?.title || t("newRecord")}</h2>
        {record && (
          <Button
            variant="ghost"
            aria-label={t("delete")}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={17} />
          </Button>
        )}
      </div>
      <form
        className="stack"
        onSubmit={handleSubmit((values) => saved.mutate(values))}
      >
        <Field id="title" label={t("title")} error={errors.title?.message}>
          <Input
            id="title"
            {...register("title")}
            aria-invalid={!!errors.title}
          />
        </Field>
        <Field
          id="content"
          label={t("content")}
          error={errors.content?.message}
        >
          <Textarea
            id="content"
            rows={10}
            {...register("content")}
            aria-invalid={!!errors.content}
          />
        </Field>
        <Button className="self-start" disabled={saved.isPending} type="submit">
          {t("save")}
        </Button>
      </form>
      {record && (
        <section className="attachments">
          <h3>{t("attachments")}</h3>
          <Input
            type="file"
            aria-label={t("upload")}
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = "";
            }}
          />
          <ul>
            {record.files.map((file) => (
              <li key={file.id}>
                <a href={`/api/files/${file.id}`} download={file.name}>
                  {file.name}
                </a>
                <span className="muted">{Math.ceil(file.size / 1024)} KB</span>
                <Button
                  variant="ghost"
                  aria-label={`${t("delete")} ${file.name}`}
                  disabled={removeFile.isPending}
                  onClick={() => removeFile.mutate(file.id)}
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title={t("confirmDelete")}
        description={t("deleteDescription")}
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("delete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
