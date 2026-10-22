import { UploadRule } from '../storage/storage.service';

/* Qué archivos se aceptan en cursos (tipo → Content-Type) y hasta qué tamaño. */

const MB = 1024 * 1024;

const OFFICE = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
};
const IMAGES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Portadas y foto del instructor (bucket público). */
export const IMAGE_RULE: UploadRule = { types: IMAGES, maxBytes: 5 * MB };

/** Recursos descargables de una lección (bucket privado): planillas, PDFs, presentaciones, etc. */
export const RESOURCE_RULE: UploadRule = { types: { ...OFFICE, ...IMAGES }, maxBytes: 200 * MB };

/** Entregas de tareas de los alumnos (bucket privado). */
export const SUBMISSION_RULE: UploadRule = { types: { ...OFFICE, ...IMAGES }, maxBytes: 25 * MB };
