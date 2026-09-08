/**
 * Two 7-frame 64x64 RGBA strips. Unpainted pixels stay alpha 0.
 * Frames: idle, windUp, feint, commit, clash, panic, win
 * A = visor bot (face right). B = turtle shell (face left).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'public', 'assets');
const FW = 64;
const FH = 64;
const FRAMES = 7;
const INK = [22, 32, 42];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcSrc = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcSrc));
  return Buffer.concat([len, crcSrc, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeLayer() {
  return Buffer.alloc(FW * FH * 4);
}

function setPx(layer, x, y, r, g, b, a = 255) {
  x = x | 0;
  y = y | 0;
  if (x < 0 || x >= FW || y < 0 || y >= FH || a <= 0) return;
  const i = (y * FW + x) * 4;
  layer[i] = r;
  layer[i + 1] = g;
  layer[i + 2] = b;
  layer[i + 3] = a;
}

function fillRect(layer, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPx(layer, x0 + x, y0 + y, r, g, b, a);
  }
}

function fillCircle(layer, cx, cy, rad, r, g, b, a = 255) {
  const rr = rad * rad;
  for (let y = -rad; y <= rad; y++) {
    for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y <= rr) setPx(layer, cx + x, cy + y, r, g, b, a);
    }
  }
}

function fillEllipse(layer, cx, cy, rx, ry, r, g, b, a = 255) {
  if (rx < 1 || ry < 1) return;
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if (x * x * ry2 + y * y * rx2 <= rx2 * ry2) setPx(layer, cx + x, cy + y, r, g, b, a);
    }
  }
}

function alphaAt(layer, x, y) {
  if (x < 0 || x >= FW || y < 0 || y >= FH) return 0;
  return layer[(y * FW + x) * 4 + 3];
}

/** 1px dark outline around opaque body pixels. Feint keeps faded outline. */
function withOutline(body) {
  const out = makeLayer();
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      if (alphaAt(body, x, y) > 16) continue;
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          n = Math.max(n, alphaAt(body, x + ox, y + oy));
        }
      }
      if (n > 16) setPx(out, x, y, INK[0], INK[1], INK[2], n);
    }
  }
  for (let i = 0; i < body.length; i += 4) {
    if (body[i + 3] > 0) {
      out[i] = body[i];
      out[i + 1] = body[i + 1];
      out[i + 2] = body[i + 2];
      out[i + 3] = body[i + 3];
    }
  }
  return out;
}

function blit(dest, layer, ox) {
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const i = (y * FW + x) * 4;
      const a = layer[i + 3];
      if (a <= 0) continue;
      const di = (y * FW * FRAMES + (ox + x)) * 4;
      dest[di] = layer[i];
      dest[di + 1] = layer[i + 1];
      dest[di + 2] = layer[i + 2];
      dest[di + 3] = a;
    }
  }
}

function poseShift(frame, facing) {
  // facing +1 = right (A), -1 = left (B). windUp rears away; commit lunges in.
  if (frame === 1) return { dx: -7 * facing, dy: 1 };
  if (frame === 2) return { dx: 3 * facing, dy: 0 };
  if (frame === 3) return { dx: 8 * facing, dy: 0 };
  if (frame === 4) return { dx: 6 * facing, dy: 0 };
  if (frame === 5) return { dx: -2 * facing, dy: 9 };
  if (frame === 6) return { dx: 0, dy: -3 };
  return { dx: 0, dy: 0 };
}

function drawBot(frame) {
  const body = makeLayer();
  const fx = makeLayer();
  const a = frame === 2 ? 145 : 255;
  const blue = [33, 150, 243];
  const dk = [16, 92, 178];
  const lt = [110, 190, 252];
  const visor = [8, 38, 78];
  const slit = [210, 242, 255];
  const { dx, dy } = poseShift(frame, 1);
  const cx = 30 + dx;
  const cy = 34 + dy;
  const aCol = (rgb) => [rgb[0], rgb[1], rgb[2], a];

  const legH = frame === 5 ? 7 : frame === 1 ? 15 : 13;
  fillRect(body, cx - 11, cy + 10, 7, legH, ...aCol(dk));
  fillRect(body, cx + 5 + (frame === 3 ? 3 : 0), cy + 11, 7, legH - (frame === 3 ? 2 : 0), ...aCol(dk));
  fillRect(body, cx - 12, cy + 10 + legH - 2, 9, 4, INK[0], INK[1], INK[2], a);
  fillRect(body, cx + 4, cy + 10 + legH - 2, 9, 4, INK[0], INK[1], INK[2], a);

  const tw = frame === 1 ? 22 : 18;
  fillRect(body, cx - 9, cy - 7, tw, 19, ...aCol(blue));
  fillRect(body, cx - 3, cy - 1, 11, 8, ...aCol(lt));
  fillRect(body, cx - 1, cy + 1, 7, 3, ...aCol(dk));

  if (frame === 1) {
    fillRect(body, cx - 20, cy - 8, 9, 6, ...aCol(blue));
    fillRect(body, cx - 24, cy - 3, 12, 5, ...aCol(dk));
    fillCircle(body, cx - 24, cy - 1, 4, ...aCol(dk));
    fillRect(body, cx + 10, cy - 4, 6, 5, ...aCol(blue));
  } else if (frame === 3 || frame === 4) {
    fillRect(body, cx - 16, cy - 1, 8, 5, ...aCol(blue));
    fillRect(body, cx + 8, cy - 7, 18, 6, ...aCol(blue));
    fillCircle(body, cx + 26, cy - 4, 5, ...aCol(dk));
    fillRect(body, cx + 24, cy - 6, 8, 4, ...aCol(lt));
  } else if (frame === 5) {
    fillRect(body, cx - 18, cy + 2, 11, 5, ...aCol(blue));
    fillRect(body, cx + 8, cy + 5, 10, 5, ...aCol(blue));
  } else if (frame === 6) {
    fillRect(body, cx - 17, cy - 24, 6, 18, ...aCol(blue));
    fillRect(body, cx + 11, cy - 24, 6, 18, ...aCol(blue));
    fillCircle(body, cx - 14, cy - 26, 4, ...aCol(lt));
    fillCircle(body, cx + 14, cy - 26, 4, ...aCol(lt));
  } else {
    fillRect(body, cx - 17, cy - 2, 8, 5, ...aCol(blue));
    fillRect(body, cx + 10, cy - 2, 10, 5, ...aCol(blue));
    fillCircle(body, cx + 20, cy, 3, ...aCol(dk));
  }

  const hx = cx + (frame === 3 || frame === 4 ? 5 : frame === 1 ? -4 : 0);
  const hy = cy - 16 + (frame === 5 ? 5 : 0);
  fillRect(body, hx - 8, hy - 8, 18, 16, ...aCol(blue));
  fillRect(body, hx - 6, hy - 3, 16, 7, ...aCol(visor));
  fillRect(body, hx + (frame === 5 ? -2 : 2), hy - 1, 12, 3, slit[0], slit[1], slit[2], a);
  if (frame === 5) {
    fillRect(body, hx + 6, hy, 12, 3, ...aCol(dk));
    fillRect(body, hx - 5, hy - 2, 3, 3, INK[0], INK[1], INK[2], a);
    fillRect(body, hx + 4, hy - 2, 3, 3, INK[0], INK[1], INK[2], a);
  } else if (frame === 1) {
    fillRect(body, hx - 1, hy - 16, 3, 10, ...aCol(dk));
    fillCircle(body, hx, hy - 18, 3, 255, 70, 70, a);
  } else {
    fillRect(body, hx + 6, hy - 16, 3, 10, ...aCol(dk));
    fillCircle(body, hx + 7, hy - 18, 3, frame === 6 ? 255 : lt[0], frame === 6 ? 210 : lt[1], frame === 6 ? 80 : lt[2], a);
  }

  if (frame === 2) {
    fillRect(fx, cx + 14, cy - 18, 14, 12, blue[0], blue[1], blue[2], 70);
    fillRect(fx, cx + 20, cy - 8, 18, 5, blue[0], blue[1], blue[2], 80);
    fillRect(fx, cx + 22, cy - 12, 12, 5, visor[0], visor[1], visor[2], 90);
  }
  if (frame === 4) {
    const bx = Math.min(58, cx + 32);
    const by = cy - 5;
    fillCircle(fx, bx, by, 10, 255, 255, 255, 240);
    fillRect(fx, bx - 12, by - 2, 24, 4, 255, 255, 255, 230);
    fillRect(fx, bx - 2, by - 12, 4, 24, 255, 255, 255, 230);
    fillCircle(fx, bx, by, 4, blue[0], blue[1], blue[2], 255);
  }
  return { body, fx };
}

function drawTurtle(frame) {
  const body = makeLayer();
  const fx = makeLayer();
  const a = frame === 2 ? 145 : 255;
  const orn = [255, 152, 0];
  const dk = [198, 96, 0];
  const lt = [255, 190, 92];
  const shc = [214, 118, 8];
  const { dx, dy } = poseShift(frame, -1);
  const aCol = (rgb) => [rgb[0], rgb[1], rgb[2], a];

  if (frame === 5) {
    // Flipped on the shell: legs up, head lolling left.
    fillEllipse(body, 34, 50, 18, 11, ...aCol(shc));
    fillEllipse(body, 34, 46, 12, 7, ...aCol(lt));
    fillRect(body, 22, 28, 4, 14, ...aCol(orn));
    fillRect(body, 30, 22, 4, 16, ...aCol(orn));
    fillRect(body, 38, 22, 4, 16, ...aCol(orn));
    fillRect(body, 46, 30, 4, 12, ...aCol(orn));
    fillCircle(body, 16, 46, 7, ...aCol(orn));
    fillCircle(body, 13, 45, 2, INK[0], INK[1], INK[2], a);
    fillEllipse(body, 50, 52, 5, 3, ...aCol(dk));
    return { body, fx };
  }

  const cx = 34 + dx;
  const cy = 34 + dy;
  const retracted = frame === 1;
  const ram = frame === 3 || frame === 4;
  const sx = cx + (ram ? 8 : retracted ? 6 : 3);
  const sy = cy - (frame === 6 ? 5 : 0);
  const rx = retracted ? 19 : ram ? 14 : 16;
  const ry = retracted ? 20 : ram ? 15 : frame === 6 ? 16 : 17;

  fillEllipse(body, sx, sy, rx, ry, ...aCol(shc));
  fillEllipse(body, sx - 2, sy - 2, rx - 6, ry - 6, ...aCol(orn));
  fillEllipse(body, sx - 3, sy - 5, 5, 4, ...aCol(lt));
  fillRect(body, sx - 2, sy - 8, 3, ry + 3, ...aCol(dk));
  fillRect(body, sx - 9, sy - 1, rx, 3, ...aCol(dk));
  fillEllipse(body, sx + rx - 3, sy + 6, 5, 3, ...aCol(dk));

  if (retracted) {
    fillCircle(body, sx - 12, sy + 3, 5, ...aCol(orn));
    fillCircle(body, sx - 14, sy + 2, 2, INK[0], INK[1], INK[2], a);
  } else if (ram) {
    fillRect(body, sx - 22, sy - 4, 16, 8, ...aCol(orn));
    fillCircle(body, sx - 24, sy, 8, ...aCol(orn));
    fillEllipse(body, sx - 28, sy + 1, 6, 5, ...aCol(lt));
    fillCircle(body, sx - 28, sy - 1, 2, INK[0], INK[1], INK[2], a);
    fillRect(body, sx - 34, sy + 1, 7, 4, ...aCol(dk));
  } else {
    const hx = cx - 16;
    const hy = cy - 4 + (frame === 6 ? -8 : 0);
    fillCircle(body, hx, hy, 8, ...aCol(orn));
    fillEllipse(body, hx - 5, hy + 1, 6, 5, ...aCol(lt));
    fillCircle(body, hx - 4, hy - 1, 2, INK[0], INK[1], INK[2], a);
    fillRect(body, hx - 10, hy + 1, 5, 3, ...aCol(dk));
    if (frame === 6) {
      fillRect(body, hx - 2, hy - 18, 5, 14, ...aCol(orn));
      fillRect(body, sx + 4, hy - 16, 5, 14, ...aCol(orn));
      fillCircle(body, hx, hy - 20, 4, ...aCol(lt));
      fillCircle(body, sx + 6, hy - 18, 4, ...aCol(lt));
    } else {
      fillRect(body, hx + 4, hy + 6, 6, 4, ...aCol(orn));
    }
  }

  fillEllipse(body, cx - 8, cy + 16, 5, 4, ...aCol(dk));
  fillEllipse(body, cx + 2, cy + 17, 5, 4, ...aCol(dk));
  fillEllipse(body, cx - 1, cy + 18, 4, 3, ...aCol(dk));

  if (frame === 2) {
    fillCircle(fx, cx - 28, cy - 2, 8, orn[0], orn[1], orn[2], 75);
    fillRect(fx, cx - 32, cy - 4, 14, 5, orn[0], orn[1], orn[2], 80);
    fillRect(fx, cx - 34, cy - 1, 6, 3, dk[0], dk[1], dk[2], 90);
  }
  if (frame === 4) {
    const bx = Math.max(6, sx - 36);
    const by = sy;
    fillCircle(fx, bx, by, 10, 255, 255, 255, 240);
    fillRect(fx, bx - 12, by - 2, 24, 4, 255, 255, 255, 230);
    fillRect(fx, bx - 2, by - 12, 4, 24, 255, 255, 255, 230);
    fillCircle(fx, bx, by, 4, orn[0], orn[1], orn[2], 255);
  }
  return { body, fx };
}

function stampShadow(dest, ox) {
  const sh = makeLayer();
  fillEllipse(sh, 32, 58, 14, 5, 0, 0, 0, 40);
  blit(dest, sh, ox);
}

function buildSheet(kind) {
  const rgba = Buffer.alloc(FW * FRAMES * FH * 4);
  for (let f = 0; f < FRAMES; f++) {
    const { body, fx } = kind === 'a' ? drawBot(f) : drawTurtle(f);
    const ox = f * FW;
    stampShadow(rgba, ox);
    blit(rgba, withOutline(body), ox);
    blit(rgba, fx, ox);
  }
  return encodePng(FW * FRAMES, FH, rgba);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'fighter-a.png'), buildSheet('a'));
writeFileSync(join(OUT, 'fighter-b.png'), buildSheet('b'));
console.log('wrote fighter-a.png and fighter-b.png');
