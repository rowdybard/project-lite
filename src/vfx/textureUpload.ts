import { CanvasTexture, SRGBColorSpace, type Texture } from "three";

// Player PNG upload pipeline: validate type/size, auto-downscale anything over 1024px,
// scan the alpha channel — when the PNG has no transparency we approximate alpha from
// luminance (additive-style sprites) and the caller shows a fallback notice.

export type UploadResult = {
  texture: Texture;
  dataUrl: string;
  hasAlpha: boolean;
  width: number;
  height: number;
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 1024;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode that image file."));
    image.src = url;
  });
}

export async function uploadPng(file: File): Promise<UploadResult> {
  if (file.type !== "image/png") throw new Error("Only PNG files are supported.");
  if (file.size > MAX_FILE_BYTES) throw new Error("PNG is larger than 4 MB.");

  const objectUrl = URL.createObjectURL(file);
  let image: HTMLImageElement;
  try {
    image = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height).data;
  let hasAlpha = false;
  for (let i = 3; i < pixels.length; i += 16) {
    if (pixels[i] < 250) {
      hasAlpha = true;
      break;
    }
  }
  if (!hasAlpha) {
    // Luminance-as-alpha fallback so opaque sprites still work against dark backdrops.
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
      pixels[i + 3] = Math.round(Math.pow(luminance, 1.4) * 255);
    }
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, dataUrl: canvas.toDataURL("image/png"), hasAlpha, width, height };
}

export function pickPngFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
