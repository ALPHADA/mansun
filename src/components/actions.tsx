"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Heart, CheckCircle, Camera, X } from "./icons";
export async function api(endpoint: string, body: unknown) {
  const res = await fetch("/api/v1/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "처리하지 못했습니다. 다시 시도해주세요.");
  return data;
}
export function Action({
  endpoint,
  payload = {},
  children,
  className = "button secondary",
  to,
  confirmMessage,
}: {
  endpoint: string;
  payload?: unknown;
  children: ReactNode;
  className?: string;
  to?: string;
  confirmMessage?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  return (
    <span className="action-wrap">
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirmMessage && !confirm(confirmMessage)) return;
          setBusy(true);
          setError("");
          try {
            await api(endpoint, payload);
            setDone(true);
            if (to) router.push(to);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          "처리 중…"
        ) : done ? (
          <>
            <CheckCircle size={18} />
            완료
          </>
        ) : (
          children
        )}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
export function Favorite({
  id,
  initial = false,
}: {
  id: string;
  initial?: boolean;
}) {
  const [saved, setSaved] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        className={"icon-button favorite " + (saved ? "saved" : "")}
        aria-label={saved ? "관심 상품 해제" : "관심 상품 저장"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setSaved((await api("favorites", { id })).saved);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Heart size={23} weight={saved ? "fill" : "regular"} />
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </>
  );
}
export function Visit() {
  useEffect(() => {
    api("activity", { kind: "visit" }).catch(() => {});
  }, []);
  return null;
}
export function Contact({
  href,
  target,
  children,
  className = "button",
}: {
  href: string;
  target: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        api("activity", { kind: "contact", target }).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}
export function Report({ id, kind }: { id: string; kind: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="report">
      <button className="text-button muted" onClick={() => setOpen(!open)}>
        {open ? "닫기" : "잘못된 정보 신고"}
      </button>
      {open && (
        <ActionForm
          endpoint="reports"
          submitLabel="신고 접수"
          success="신고가 접수되었습니다. 운영자가 확인하겠습니다."
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="kind" value={kind} />
          <label>
            신고 사유
            <textarea name="reason" required minLength={5} maxLength={1000} />
          </label>
        </ActionForm>
      )}
    </div>
  );
}
export function ActionForm({
  endpoint,
  children,
  submitLabel = "저장하기",
  redirect,
  success = "저장되었습니다.",
  mode = "plain",
  resetOnSuccess = false,
}: {
  endpoint: string;
  children: ReactNode;
  submitLabel?: string;
  redirect?: string;
  success?: string;
  mode?: "plain" | "listing" | "request" | "profile" | "official";
  resetOnSuccess?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  const router = useRouter();
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setDone(false);
        const form = e.currentTarget;
        const fd = new FormData(form);
        const body: Record<string, unknown> = Object.fromEntries(fd.entries());
        for (const key of [
          "priceMin",
          "priceMax",
          "quantity",
          "minimum",
          "budget",
          "digestHour",
        ])
          if (key in body) body[key] = Number(body[key]);
        if (mode === "listing") {
          body.weightKg = body.weightKg ? Number(body.weightKg) : null;
          body.photos = fd.getAll("photos");
          body.confirmed = fd.has("confirmed");
        }
        if (mode === "profile") {
          body.specialties = fd.getAll("specialties");
          body.interests = {
            regions: fd.getAll("regions"),
            species: fd.getAll("species"),
          };
          body.procurement = fd.has("procurement");
          body.notifications = fd.has("notifications");
        }
        if (mode === "official") body.verified = fd.has("verified");
        try {
          const result = await api(endpoint, body);
          if (resetOnSuccess) form.reset();
          setDone(true);
          if (redirect) router.push(redirect.replace(":id", result.id || ""));
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {done && !redirect && (
        <p className="notice success" role="status">
          {success}
        </p>
      )}
      <button type="submit" className="button" disabled={busy}>
        {busy ? "저장 중…" : submitLabel}
      </button>
    </form>
  );
}
export function Photos({ initial = [] }: { initial?: string[] }) {
  const [photos, setPhotos] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="photo-field">
      <span className="field-label">
        상품 사진{" "}
        <span className="muted">최대 5장 · JPG, PNG, WebP · 장당 10MB</span>
      </span>
      <div className="photo-grid">
        {photos.map((p) => (
          <div className="photo-preview" key={p}>
            <img src={p} alt="등록할 상품" />
            <input type="hidden" name="photos" value={p} />
            <button
              type="button"
              className="icon-button"
              aria-label="사진 삭제"
              onClick={() => setPhotos(photos.filter((x) => x !== p))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {photos.length < 5 && (
          <label className="photo-add">
            <Camera size={30} />
            <span>{busy ? "사진 처리 중…" : "사진 추가"}</span>
            <input
              aria-label="상품 사진 추가"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  const fd = new FormData();
                  fd.set("file", file);
                  const res = await fetch("/api/v1/upload", {
                    method: "POST",
                    body: fd,
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error);
                  setPhotos((p) => [...p, data.url]);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error} 다시 사진을 선택해 재시도할 수 있습니다.
        </p>
      )}
    </div>
  );
}
