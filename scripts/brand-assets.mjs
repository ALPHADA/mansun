import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
// Production vector interpretation of approved concept A / palette 07.
const hull =
  "M48 197 L270 154 L288 116 Q293 103 310 98 Q426 62 542 48 Q552 46 550 60 L542 111 Q421 119 342 166 Q426 138 536 137 Q520 266 428 322 Q386 335 345 321 Q438 284 473 213 Q439 190 398 205 Q346 219 283 256 Q202 302 119 242 L132 283 L105 312 Q72 282 48 197 Z";
const wave =
  "M78 320 Q142 356 211 320 Q257 294 302 316 Q350 339 402 351 Q463 365 514 324 Q493 386 418 403 Q363 416 298 377 Q248 347 211 360 Q143 394 103 363 Q86 350 78 320 Z";
const mark = (color = "#2459D3") =>
  `<path fill="${color}" d="${hull}"/><circle cx="427" cy="222" r="12" fill="${color}"/><path fill="#F28A3A" d="${wave}"/>`;
const svg = (inside, view = "0 0 600 450") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${inside}</svg>`;
await mkdir("public/brand", { recursive: true });
const logo = svg(mark());
const inverse = svg(mark("#ffffff"));
const icon = svg(
  `<rect width="512" height="512" rx="108" fill="#2459D3"/><g transform="translate(30 83) scale(.75)">${mark("#ffffff")}</g>`,
  "0 0 512 512",
);
await writeFile("public/brand/symbol.svg", logo);
await writeFile("public/brand/symbol-inverse.svg", inverse);
await writeFile("src/app/icon.svg", icon);
for (const size of [16, 32, 48, 128, 180, 192, 512])
  await sharp(Buffer.from(icon))
    .resize(size, size)
    .png()
    .toFile(`public/brand/icon-${size}.png`);
await sharp(Buffer.from(icon))
  .resize(180, 180)
  .png()
  .toFile("src/app/apple-icon.png");
const sizes = [16, 32, 48],
  pngs = await Promise.all(
    sizes.map((s) => sharp(Buffer.from(icon)).resize(s, s).png().toBuffer()),
  );
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
pngs.forEach((p, i) => {
  const n = 6 + i * 16;
  head[n] = sizes[i];
  head[n + 1] = sizes[i];
  head.writeUInt16LE(1, n + 4);
  head.writeUInt16LE(32, n + 6);
  head.writeUInt32LE(p.length, n + 8);
  head.writeUInt32LE(offset, n + 12);
  offset += p.length;
});
await writeFile("src/app/favicon.ico", Buffer.concat([head, ...pngs]));
console.log("Brand SVGs, app icons and multi-resolution favicon generated.");
