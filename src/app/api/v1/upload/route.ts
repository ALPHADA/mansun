import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AppError, assertOrigin, requireUser } from "@/server/auth";
import { db } from "@/server/db";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const user = await requireUser();
    if (user.role !== "broker" || user.approval !== "approved")
      throw new AppError("승인된 중매인만 사진을 올릴 수 있습니다.", 403);
    if (Number(request.headers.get("content-length") || 0) > 12 * 1024 * 1024)
      throw new AppError("사진은 10MB 이하로 올려주세요.", 413);
    const form = await request.formData(),
      file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 10 * 1024 * 1024 ||
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ].includes(file.type)
    )
      throw new AppError("10MB 이하의 JPG, PNG, WebP 사진을 선택해주세요.");
    const [count] =
      await db()`SELECT count(*)::int AS n FROM assets WHERE owner_id=${user.id} AND created_at>now()-interval '1 day'`;
    if (count.n >= 100)
      throw new AppError("하루 사진 업로드 한도를 초과했습니다.", 429);
    const buffer = await sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40000000,
    })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const name = randomUUID() + ".webp";
    const dir = path.resolve(
      /* turbopackIgnore: true */ process.env.UPLOAD_DIR || "data/uploads",
    );
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(/* turbopackIgnore: true */ dir, name), buffer, {
      mode: 0o600,
    });
    await db()`INSERT INTO assets(id,owner_id) VALUES(${name},${user.id})`;
    return Response.json({ url: "/media/" + name });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : "사진을 처리하지 못했습니다. JPG 또는 PNG로 다시 올려주세요.",
      },
      { status: e instanceof AppError ? e.status : 400 },
    );
  }
}
