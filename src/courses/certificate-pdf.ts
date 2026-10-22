import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

/*
 * Certificado de finalización en PDF (A4 apaisado), con las fuentes estándar de PDF: no hay archivos
 * de fuentes que cargar. Helvetica cubre el español (WinAnsi); un carácter que no entra se pasa a su
 * letra sin tilde para que el PDF nunca falle por un nombre raro.
 */

export interface CertificateData {
  code: string;
  name: string;
  courseTitle: string;
  hours: number;
  issuedAt: Date;
  verifyUrl: string;
}

const NAVY = rgb(5 / 255, 8 / 255, 15 / 255);
const YELLOW = rgb(245 / 255, 179 / 255, 1 / 255);
const INK = rgb(18 / 255, 26 / 255, 46 / 255);
const DIM = rgb(90 / 255, 102 / 255, 129 / 255);

/** Texto que la fuente puede dibujar (reemplaza lo que no está en WinAnsi). */
function drawable(text: string, font: PDFFont): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return [...text].map((ch) => {
      try { font.encodeText(ch); return ch; } catch { return ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?'); }
    }).join('');
  }
}

/** Achica la letra hasta que el texto entre en `maxWidth`. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number, min = 12): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 1;
  return s;
}

const fecha = (d: Date) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
const horas = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} ${h === 1 ? 'hora' : 'horas'}`;

export async function certificatePdf(c: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificado ${c.code} — ${c.courseTitle}`);
  doc.setAuthor('AURYX');
  doc.setSubject('Certificado de finalización');
  doc.setCreationDate(c.issuedAt);
  const page = doc.addPage([842, 595]);
  const { width, height } = page.getSize();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const center = (raw: string, y: number, font: PDFFont, size: number, color = INK, maxWidth = width - 160) => {
    const text = drawable(raw, font);
    const s = fit(text, font, size, maxWidth);
    page.drawText(text, { x: (width - font.widthOfTextAtSize(text, s)) / 2, y, size: s, font, color });
  };

  // marco y franja de marca
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: NAVY, borderWidth: 2 });
  page.drawRectangle({ x: 24, y: height - 96, width: width - 48, height: 72, color: NAVY });
  page.drawRectangle({ x: 24, y: height - 102, width: width - 48, height: 6, color: YELLOW });
  page.drawText('AURYX', { x: 56, y: height - 72, size: 26, font: bold, color: rgb(1, 1, 1) });
  const academy = 'ACADEMIA';
  page.drawText(academy, { x: width - 56 - regular.widthOfTextAtSize(academy, 12), y: height - 66, size: 12, font: regular, color: YELLOW });

  center('CERTIFICADO DE FINALIZACIÓN', height - 170, bold, 26, NAVY);
  center('Se certifica que', height - 218, regular, 14, DIM);
  center(c.name, height - 270, bold, 36, INK);
  page.drawRectangle({ x: width / 2 - 160, y: height - 284, width: 320, height: 1.5, color: YELLOW });
  center('completó y aprobó el curso', height - 320, regular, 14, DIM);
  center(c.courseTitle, height - 360, bold, 22, NAVY);
  center(`${horas(c.hours)} de cursado · ${fecha(c.issuedAt)}`, height - 396, regular, 13, DIM);

  // pie: código y verificación
  page.drawText(drawable(`Código: ${c.code}`, bold), { x: 56, y: 70, size: 11, font: bold, color: INK });
  page.drawText(drawable(`Verificalo en ${c.verifyUrl}`, regular), { x: 56, y: 52, size: 10, font: regular, color: DIM });
  const firma = 'AURYX · Energía solar y almacenamiento';
  page.drawText(drawable(firma, regular), { x: width - 56 - regular.widthOfTextAtSize(drawable(firma, regular), 10), y: 52, size: 10, font: regular, color: DIM });

  return doc.save();
}
