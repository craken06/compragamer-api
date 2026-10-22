import { createHash, createHmac } from 'crypto';

/*
 * URLs prefirmadas de S3 (AWS Signature V4, "query string auth"), sin SDK.
 * Las usa Cloudflare R2 (región "auto", servicio "s3"). Ver
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  host: string;
  /** Ruta sin codificar, con la barra inicial: "/bucket/carpeta/archivo.pdf". */
  path: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Segundos de validez (máx. 7 días). */
  expires: number;
  date?: Date;
  /** Encabezados que quedan firmados (además de host): el navegador tiene que mandar exactamente estos valores. */
  headers?: Record<string, string>;
  /** Parámetros extra de la URL (p. ej. response-content-disposition). */
  query?: Record<string, string>;
}

/** Codificación RFC 3986 que pide SigV4 (encodeURIComponent deja sin codificar !'()*). */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s, 'utf8').digest();

function amzDate(d: Date) {
  const iso = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp: iso, day: iso.slice(0, 8) };
}

export function presignUrl(input: PresignInput): string {
  const service = input.service ?? 's3';
  const { stamp, day } = amzDate(input.date ?? new Date());
  const scope = `${day}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = { host: input.host };
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = String(v).trim();
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(input.expires),
    'X-Amz-SignedHeaders': signedHeaders,
    ...(input.query ?? {}),
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`).join('&');
  const canonicalUri = input.path.split('/').map(rfc3986).join('/');

  const canonicalRequest = [input.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');

  return `https://${input.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
