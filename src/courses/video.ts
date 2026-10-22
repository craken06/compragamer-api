import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';

/*
 * Videos de los cursos.
 *  - Bunny Stream (pago por uso): la API crea el video y le da al admin una firma para subirlo
 *    directo desde el navegador (TUS); al alumno le da una URL de embed firmada que vence.
 *    Variables: BUNNY_LIBRARY_ID, BUNNY_API_KEY, BUNNY_TOKEN_KEY (Token Authentication del library),
 *    BUNNY_EMBED_HOST (opcional, por defecto iframe.mediadelivery.net).
 *  - YouTube: solo el id (vistas previas gratis o mientras no esté Bunny). Se ve con youtube-nocookie.
 */

export type VideoProvider = 'bunny' | 'youtube';

const BUNNY_API = 'https://video.bunnycdn.com';
export const BUNNY_TUS_ENDPOINT = `${BUNNY_API}/tusupload`;
const EMBED_TTL_S = 6 * 60 * 60; // el alumno puede dejar la pestaña abierta un rato largo
const UPLOAD_TTL_S = 24 * 60 * 60; // un video largo puede tardar horas en subir

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Acepta el id (11 caracteres) o cualquier link de YouTube y devuelve el id, o null. */
export function youtubeId(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isBunnyId = (s: unknown) => GUID_RE.test(String(s ?? ''));

/** Estados de Bunny: 0 creado, 1 subido, 2 procesando, 3 codificando, 4 listo, 5 error, 6 falló la subida. */
export const BUNNY_STATUS: Record<number, string> = {
  0: 'esperando_subida', 1: 'subido', 2: 'procesando', 3: 'codificando', 4: 'listo', 5: 'error', 6: 'error_subida',
};

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  get bunnyEnabled() {
    return !!(process.env.BUNNY_LIBRARY_ID && process.env.BUNNY_API_KEY);
  }

  private get library() {
    return String(process.env.BUNNY_LIBRARY_ID ?? '');
  }

  private async bunny<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.bunnyEnabled) throw new ServiceUnavailableException('Bunny Stream no está configurado (faltan BUNNY_LIBRARY_ID y BUNNY_API_KEY).');
    const res = await fetch(`${BUNNY_API}/library/${encodeURIComponent(this.library)}${path}`, {
      method,
      headers: { AccessKey: process.env.BUNNY_API_KEY!, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Bunny ${method} ${path} respondió ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException('Bunny Stream no respondió correctamente. Probá de nuevo en unos minutos.');
    }
    return (await res.json().catch(() => ({}))) as T;
  }

  /** Crea el video vacío en Bunny y devuelve lo que necesita el navegador para subirlo por TUS. */
  async createUpload(title: string, now = Date.now()) {
    const video = await this.bunny<{ guid: string }>('POST', '/videos', { title: String(title || 'Lección').slice(0, 200) });
    if (!isBunnyId(video.guid)) throw new ServiceUnavailableException('Bunny no devolvió el id del video.');
    return { videoId: video.guid, ...this.tusAuth(video.guid, now) };
  }

  /** Firma de subida TUS: sha256(library_id + api_key + expiration_time + video_id). */
  tusAuth(videoId: string, now = Date.now()) {
    const expires = Math.floor(now / 1000) + UPLOAD_TTL_S;
    const signature = sha256(`${this.library}${process.env.BUNNY_API_KEY ?? ''}${expires}${videoId}`);
    return { endpoint: BUNNY_TUS_ENDPOINT, libraryId: this.library, expires, signature };
  }

  async status(videoId: string) {
    const v = await this.bunny<{ status?: number; encodeProgress?: number; length?: number }>('GET', `/videos/${encodeURIComponent(videoId)}`);
    return { status: BUNNY_STATUS[v.status ?? -1] ?? 'desconocido', encodeProgress: Number(v.encodeProgress) || 0, lengthSec: Number(v.length) || 0 };
  }

  /** Borra el video de Bunny. Nunca lanza (si falla, queda huérfano en el library y se avisa en el log). */
  async remove(videoId: string | null | undefined) {
    if (!videoId || !isBunnyId(videoId) || !this.bunnyEnabled) return;
    try {
      await this.bunny('DELETE', `/videos/${encodeURIComponent(videoId)}`);
    } catch (err) {
      this.logger.warn(`No se pudo borrar el video ${videoId} de Bunny: ${(err as Error)?.message}`);
    }
  }

  /**
   * URL para el iframe del reproductor. Bunny con Token Authentication: token = sha256(token_key + video_id + expires).
   * Sin BUNNY_TOKEN_KEY la URL va sin firma (sirve mientras el library no tenga la protección activada).
   */
  embedUrl(provider: string | null | undefined, videoId: string | null | undefined, now = Date.now()): string | null {
    if (!provider || !videoId) return null;
    if (provider === 'youtube') {
      const id = youtubeId(videoId);
      return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1` : null;
    }
    if (provider !== 'bunny' || !isBunnyId(videoId) || !this.library) return null;
    const host = process.env.BUNNY_EMBED_HOST || 'iframe.mediadelivery.net';
    const base = `https://${host}/embed/${encodeURIComponent(this.library)}/${videoId}`;
    const key = process.env.BUNNY_TOKEN_KEY;
    if (!key) return `${base}?responsive=true`;
    const expires = Math.floor(now / 1000) + EMBED_TTL_S;
    return `${base}?token=${sha256(`${key}${videoId}${expires}`)}&expires=${expires}&responsive=true`;
  }

  /** Normaliza lo que manda el admin para el video de una lección. Lanza 400 si no es válido. */
  normalize(provider: unknown, id: unknown): { videoProvider: VideoProvider | null; videoId: string | null } {
    if (provider === null || provider === '' || provider === undefined) return { videoProvider: null, videoId: null };
    if (provider === 'youtube') {
      const yt = youtubeId(id);
      if (!yt) throw new BadRequestException('El link o id de YouTube no es válido.');
      return { videoProvider: 'youtube', videoId: yt };
    }
    if (provider === 'bunny') {
      if (!isBunnyId(id)) throw new BadRequestException('El id del video de Bunny no es válido.');
      return { videoProvider: 'bunny', videoId: String(id).toLowerCase() };
    }
    throw new BadRequestException('Proveedor de video inválido (bunny o youtube).');
  }
}
