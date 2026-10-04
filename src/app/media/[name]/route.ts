import { readFile } from "node:fs/promises";
import path from "node:path";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[0-9a-f-]{36}\.webp$/.test(name))
    return new Response(null, { status: 404 });
  try {
    return new Response(
      await readFile(
        /* turbopackIgnore: true */
        path.join(
          /* turbopackIgnore: true */ path.resolve(
            /* turbopackIgnore: true */ process.env.UPLOAD_DIR ||
              "data/uploads",
          ),
          name,
        ),
      ),
      {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return new Response(null, { status: 404 });
  }
}
