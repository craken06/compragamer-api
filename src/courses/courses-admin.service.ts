import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateCode, withUniqueCode } from '../orders/order-code';
import { StorageService, UploadRequest, checkUpload } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { VideoService } from './video';
import { normalizeQuestion } from './quiz';
import { flattenLessons, progressPct } from './progress';
import { IMAGE_RULE, RESOURCE_RULE } from './uploads';
import { courseData, lessonData, moduleData, orderIds, resourceLinkData } from './validation';

/*
 * Administración de cursos (todo con AdminKeyGuard). Borrar un curso con alumnos no se permite:
 * se archiva. Al borrar lecciones o recursos se limpian sus videos (Bunny) y archivos (R2) sin
 * frenar la operación si alguno falla.
 */

const ORDERED = [{ position: 'asc' as const }, { id: 'asc' as const }];
const SUBMISSION_STATUSES = ['entregada', 'aprobada', 'a_rehacer'] as const;

const isUniqueError = (err: any) => err?.code === 'P2002';

@Injectable()
export class CoursesAdminService {
  constructor(
    private prisma: PrismaService,
    private video: VideoService,
    @Optional() private storage?: StorageService,
    @Optional() private mail?: MailService,
  ) {}

  /** Qué está configurado (para avisar en el admin qué falta). */
  status() {
    return { bunny: this.video.bunnyEnabled, bunnyTokenAuth: !!process.env.BUNNY_TOKEN_KEY, storage: !!this.storage?.enabled, publicStorage: !!this.storage?.publicEnabled };
  }

  // ------------------------------------------------------------ cursos

  async list() {
    const courses = await this.prisma.course.findMany({
      orderBy: ORDERED,
      include: { _count: { select: { enrollments: true } }, modules: { select: { _count: { select: { lessons: true } } } } },
    });
    return courses.map((c: any) => ({
      id: c.id, slug: c.slug, title: c.title, status: c.status, priceArs: Number(c.priceArs), position: c.position,
      enrollments: c._count?.enrollments ?? 0,
      lessons: (c.modules ?? []).reduce((s: number, m: any) => s + (m._count?.lessons ?? 0), 0),
      updatedAt: c.updatedAt,
    }));
  }

  /** Curso completo para el editor: módulos, lecciones, recursos y preguntas (con la correcta). */
  async get(id: number) {
    const c = await this.prisma.course.findUnique({
      where: { id },
      include: {
        modules: {
          orderBy: ORDERED,
          include: { lessons: { orderBy: ORDERED, include: { resources: { orderBy: ORDERED }, questions: { orderBy: ORDERED } } } },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!c) throw new NotFoundException('Curso no encontrado');
    return { ...c, durationHours: Number(c.durationHours), priceArs: Number(c.priceArs) };
  }

  private async withSlugCheck<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueError(err)) throw new BadRequestException('Ya hay un curso con esa dirección (slug): elegí otra.');
      throw err;
    }
  }

  async create(body: any) {
    const data = courseData(body, false);
    if (data.status === 'publicado') throw new BadRequestException('Creá el curso como borrador y publicalo cuando tenga lecciones.');
    const last = await this.prisma.course.findFirst({ orderBy: { position: 'desc' }, select: { position: true } });
    const course = await this.withSlugCheck(() => this.prisma.course.create({ data: { ...(data as any), position: (last?.position ?? -1) + 1 } }));
    return this.get(course.id);
  }

  async update(id: number, body: any) {
    const data = courseData(body, true);
    const current = await this.prisma.course.findUnique({ where: { id }, include: { modules: { select: { _count: { select: { lessons: true } } } } } });
    if (!current) throw new NotFoundException('Curso no encontrado');
    if (data.status === 'publicado' && current.status !== 'publicado') {
      const lessons = (current as any).modules.reduce((s: number, m: any) => s + (m._count?.lessons ?? 0), 0);
      if (!lessons) throw new BadRequestException('Para publicar el curso tiene que tener al menos una lección.');
    }
    await this.withSlugCheck(() => this.prisma.course.update({ where: { id }, data }));
    return this.get(id);
  }

  async remove(id: number) {
    const c = await this.prisma.course.findUnique({ where: { id }, include: { _count: { select: { enrollments: true } } } });
    if (!c) throw new NotFoundException('Curso no encontrado');
    if ((c as any)._count.enrollments > 0) throw new BadRequestException('El curso tiene alumnos: archivalo en vez de borrarlo.');
    const lessons = await this.prisma.lesson.findMany({ where: { module: { courseId: id } }, include: { resources: true } });
    await this.prisma.course.delete({ where: { id } });
    await this.cleanupLessons(lessons);
    return { deleted: true };
  }

  /** Borra en segundo plano los videos de Bunny y los archivos de R2 de lecciones ya borradas. */
  private async cleanupLessons(lessons: { videoProvider: string | null; videoId: string | null; resources?: { fileKey: string | null }[] }[]) {
    for (const l of lessons) {
      if (l.videoProvider === 'bunny') await this.video.remove(l.videoId);
      for (const r of l.resources ?? []) await this.storage?.remove('private', r.fileKey);
    }
  }

  async reorderCourses(ids: unknown) {
    const all = await this.prisma.course.findMany({ select: { id: true } });
    const order = orderIds(ids, all.map((c) => c.id), 'los cursos');
    await this.prisma.$transaction(order.map((id, position) => this.prisma.course.update({ where: { id }, data: { position } })));
    return this.list();
  }

  // ------------------------------------------------------------ módulos

  private async courseOfModule(moduleId: number) {
    const m = await this.prisma.courseModule.findUnique({ where: { id: moduleId } });
    if (!m) throw new NotFoundException('Módulo no encontrado');
    return m;
  }

  async createModule(courseId: number, body: any) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Curso no encontrado');
    const count = await this.prisma.courseModule.count({ where: { courseId } });
    await this.prisma.courseModule.create({ data: { ...(moduleData(body, false) as any), courseId, position: count } });
    return this.get(courseId);
  }

  async updateModule(moduleId: number, body: any) {
    const m = await this.courseOfModule(moduleId);
    await this.prisma.courseModule.update({ where: { id: moduleId }, data: moduleData(body, true) });
    return this.get(m.courseId);
  }

  async removeModule(moduleId: number) {
    const m = await this.courseOfModule(moduleId);
    const lessons = await this.prisma.lesson.findMany({ where: { moduleId }, include: { resources: true } });
    await this.prisma.courseModule.delete({ where: { id: moduleId } });
    await this.cleanupLessons(lessons);
    return this.get(m.courseId);
  }

  async reorderModules(courseId: number, ids: unknown) {
    const mods = await this.prisma.courseModule.findMany({ where: { courseId }, select: { id: true } });
    const order = orderIds(ids, mods.map((m) => m.id), 'los módulos');
    await this.prisma.$transaction(order.map((id, position) => this.prisma.courseModule.update({ where: { id }, data: { position } })));
    return this.get(courseId);
  }

  // ------------------------------------------------------------ lecciones

  private async lessonWithCourse(lessonId: number) {
    const l = await this.prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: true } });
    if (!l) throw new NotFoundException('Lección no encontrada');
    return l;
  }

  /** Video: solo si viene `videoProvider` en el body (null lo saca). */
  private videoData(body: any) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'videoProvider')) return {};
    return this.video.normalize(body.videoProvider, body.videoId);
  }

  async createLesson(moduleId: number, body: any) {
    const m = await this.courseOfModule(moduleId);
    const count = await this.prisma.lesson.count({ where: { moduleId } });
    await this.prisma.lesson.create({ data: { ...(lessonData(body, false) as any), ...this.videoData(body), moduleId, position: count } });
    return this.get(m.courseId);
  }

  async updateLesson(lessonId: number, body: any) {
    const l = await this.lessonWithCourse(lessonId);
    const data: Record<string, any> = { ...lessonData(body, true), ...this.videoData(body) };
    // mover a otro módulo del mismo curso (queda al final)
    if (body?.moduleId !== undefined && Number(body.moduleId) !== l.moduleId) {
      const target = await this.courseOfModule(Number(body.moduleId));
      if (target.courseId !== l.module.courseId) throw new BadRequestException('Solo se puede mover a un módulo del mismo curso.');
      data.moduleId = target.id;
      data.position = await this.prisma.lesson.count({ where: { moduleId: target.id } });
    }
    await this.prisma.lesson.update({ where: { id: lessonId }, data });
    // si se reemplazó o sacó un video de Bunny, se borra el viejo
    if (l.videoProvider === 'bunny' && 'videoProvider' in data && data.videoId !== l.videoId) await this.video.remove(l.videoId);
    return this.get(l.module.courseId);
  }

  async removeLesson(lessonId: number) {
    const l = await this.lessonWithCourse(lessonId);
    const resources = await this.prisma.lessonResource.findMany({ where: { lessonId } });
    await this.prisma.lesson.delete({ where: { id: lessonId } });
    await this.cleanupLessons([{ ...l, resources }]);
    return this.get(l.module.courseId);
  }

  async reorderLessons(moduleId: number, ids: unknown) {
    const m = await this.courseOfModule(moduleId);
    const lessons = await this.prisma.lesson.findMany({ where: { moduleId }, select: { id: true } });
    const order = orderIds(ids, lessons.map((l) => l.id), 'las lecciones');
    await this.prisma.$transaction(order.map((id, position) => this.prisma.lesson.update({ where: { id }, data: { position } })));
    return this.get(m.courseId);
  }

  // ------------------------------------------------------------ video (Bunny)

  /** POST /admin/lessons/:id/video: crea el video en Bunny y devuelve la firma para subirlo por TUS. */
  async startVideoUpload(lessonId: number) {
    const l = await this.lessonWithCourse(lessonId);
    const upload = await this.video.createUpload(l.title);
    await this.prisma.lesson.update({ where: { id: lessonId }, data: { videoProvider: 'bunny', videoId: upload.videoId } });
    if (l.videoProvider === 'bunny' && l.videoId && l.videoId !== upload.videoId) await this.video.remove(l.videoId);
    return upload;
  }

  /** GET /admin/lessons/:id/video: estado de la codificación; al quedar listo carga la duración si falta. */
  async videoStatus(lessonId: number) {
    const l = await this.lessonWithCourse(lessonId);
    if (l.videoProvider !== 'bunny' || !l.videoId) return { status: l.videoProvider === 'youtube' ? 'youtube' : 'sin_video' };
    const s = await this.video.status(l.videoId);
    if (s.status === 'listo' && !l.durationMin && s.lengthSec > 0) {
      await this.prisma.lesson.update({ where: { id: lessonId }, data: { durationMin: Math.max(1, Math.round(s.lengthSec / 60)) } });
    }
    return { ...s, embedUrl: this.video.embedUrl('bunny', l.videoId) };
  }

  // ------------------------------------------------------------ recursos

  async addResource(lessonId: number, body: any) {
    const l = await this.lessonWithCourse(lessonId);
    const position = await this.prisma.lessonResource.count({ where: { lessonId } });
    let data: Record<string, any>;
    if (body?.kind === 'link') {
      data = resourceLinkData(body);
    } else {
      const title = String(body?.title ?? '').trim().slice(0, 160);
      const key = String(body?.key ?? '');
      const prefix = `courses/${l.module.courseId}/resources/`;
      if (!key.startsWith(prefix) || !/^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(key.slice(prefix.length))) throw new BadRequestException('Archivo inválido: subilo de nuevo.');
      const fileName = String(body?.fileName ?? '').replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').trim().slice(-120);
      const size = Number(body?.fileSize);
      data = { kind: 'archivo', title: title || fileName || 'Archivo', fileKey: key, fileName: fileName || null, fileSize: Number.isInteger(size) && size > 0 ? size : null };
    }
    await this.prisma.lessonResource.create({ data: { ...(data as any), lessonId, position } });
    return this.get(l.module.courseId);
  }

  private async resourceWithCourse(id: number) {
    const r = await this.prisma.lessonResource.findUnique({ where: { id }, include: { lesson: { include: { module: true } } } });
    if (!r) throw new NotFoundException('Recurso no encontrado');
    return r;
  }

  async updateResource(id: number, body: any) {
    const r = await this.resourceWithCourse(id);
    const data: Record<string, any> = {};
    if (body?.title !== undefined) {
      const t = String(body.title).trim().slice(0, 160);
      if (!t) throw new BadRequestException('Falta el nombre del recurso.');
      data.title = t;
    }
    if (r.kind === 'link' && body?.url !== undefined) data.url = resourceLinkData({ title: data.title ?? r.title, url: body.url }).url;
    await this.prisma.lessonResource.update({ where: { id }, data });
    return this.get(r.lesson.module.courseId);
  }

  async removeResource(id: number) {
    const r = await this.resourceWithCourse(id);
    await this.prisma.lessonResource.delete({ where: { id } });
    await this.storage?.remove('private', r.fileKey);
    return this.get(r.lesson.module.courseId);
  }

  async reorderResources(lessonId: number, ids: unknown) {
    const l = await this.lessonWithCourse(lessonId);
    const all = await this.prisma.lessonResource.findMany({ where: { lessonId }, select: { id: true } });
    const order = orderIds(ids, all.map((r) => r.id), 'los recursos');
    await this.prisma.$transaction(order.map((id, position) => this.prisma.lessonResource.update({ where: { id }, data: { position } })));
    return this.get(l.module.courseId);
  }

  /** GET /admin/resources/:id/download: para revisar el archivo desde el admin. */
  async resourceDownload(id: number) {
    const r = await this.resourceWithCourse(id);
    if (r.kind === 'link') return { url: r.url };
    if (!r.fileKey || !this.storage?.enabled) throw new ServiceUnavailableException('Falta configurar R2 para descargar archivos.');
    return { url: this.storage.signDownload(r.fileKey, r.fileName ?? undefined) };
  }

  // ------------------------------------------------------------ preguntas

  async addQuestion(lessonId: number, body: any) {
    const l = await this.lessonWithCourse(lessonId);
    if (l.kind !== 'prueba') throw new BadRequestException('Las preguntas van en lecciones de tipo prueba.');
    const position = await this.prisma.quizQuestion.count({ where: { lessonId } });
    const q = normalizeQuestion(body);
    await this.prisma.quizQuestion.create({ data: { ...q, options: q.options as unknown as Prisma.InputJsonValue, lessonId, position } });
    return this.get(l.module.courseId);
  }

  private async questionWithCourse(id: number) {
    const q = await this.prisma.quizQuestion.findUnique({ where: { id }, include: { lesson: { include: { module: true } } } });
    if (!q) throw new NotFoundException('Pregunta no encontrada');
    return q;
  }

  async updateQuestion(id: number, body: any) {
    const q = await this.questionWithCourse(id);
    const data = normalizeQuestion(body);
    await this.prisma.quizQuestion.update({ where: { id }, data: { ...data, options: data.options as unknown as Prisma.InputJsonValue } });
    return this.get(q.lesson.module.courseId);
  }

  async removeQuestion(id: number) {
    const q = await this.questionWithCourse(id);
    await this.prisma.quizQuestion.delete({ where: { id } });
    return this.get(q.lesson.module.courseId);
  }

  async reorderQuestions(lessonId: number, ids: unknown) {
    const l = await this.lessonWithCourse(lessonId);
    const all = await this.prisma.quizQuestion.findMany({ where: { lessonId }, select: { id: true } });
    const order = orderIds(ids, all.map((q) => q.id), 'las preguntas');
    await this.prisma.$transaction(order.map((id, position) => this.prisma.quizQuestion.update({ where: { id }, data: { position } })));
    return this.get(l.module.courseId);
  }

  // ------------------------------------------------------------ subidas (portadas y recursos)

  /** POST /admin/uploads { purpose: cover | instructor | resource, courseId, filename, size, contentType }. */
  async signUpload(body: UploadRequest & { purpose?: string; courseId?: unknown }) {
    if (!this.storage?.enabled) throw new ServiceUnavailableException('Falta configurar R2 (variables R2_*) para subir archivos.');
    const courseId = Number(body?.courseId);
    if (!Number.isInteger(courseId) || courseId <= 0 || !(await this.prisma.course.findUnique({ where: { id: courseId } }))) {
      throw new BadRequestException('Curso inválido.');
    }
    if (body?.purpose === 'cover' || body?.purpose === 'instructor') {
      if (!this.storage.publicEnabled) throw new ServiceUnavailableException('Falta configurar el bucket público de R2 (R2_PUBLIC_BUCKET y R2_PUBLIC_URL).');
      const f = checkUpload(body, IMAGE_RULE);
      return this.storage.signUpload('public', this.storage.newKey(`courses/${courseId}/${body.purpose}`, f.ext), f);
    }
    if (body?.purpose === 'resource') {
      const f = checkUpload(body, RESOURCE_RULE);
      return { ...this.storage.signUpload('private', this.storage.newKey(`courses/${courseId}/resources`, f.ext), f), fileName: f.filename, fileSize: f.size };
    }
    throw new BadRequestException('Tipo de subida inválido.');
  }

  // ------------------------------------------------------------ alumnos

  async enrollments(courseId: number) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, include: { modules: { include: { lessons: { select: { id: true, isOptional: true } } } } } });
    if (!course) throw new NotFoundException('Curso no encontrado');
    const lessons = flattenLessons(course.modules);
    const rows = await this.prisma.enrollment.findMany({
      where: { courseId }, orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        progress: { select: { lessonId: true } },
        certificate: { select: { code: true, revokedAt: true } },
      },
    });
    return rows.map((e) => ({
      id: e.id, code: e.code, status: e.status, source: e.source, priceArs: Number(e.priceArs), createdAt: e.createdAt, paidAt: e.paidAt,
      customer: e.customer, progressPct: progressPct(lessons, new Set(e.progress.map((p) => p.lessonId))),
      certificate: e.certificate ? { code: e.certificate.code, revoked: !!e.certificate.revokedAt } : null,
    }));
  }

  /** Inscripción a mano (regalo, pago por fuera): el cliente tiene que haber ingresado una vez al sitio. */
  async enrollManual(courseId: number, rawEmail: unknown) {
    const email = String(rawEmail ?? '').trim().toLowerCase();
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Curso no encontrado');
    const customer = email ? await this.prisma.customer.findUnique({ where: { email } }) : null;
    if (!customer) throw new NotFoundException('No hay un cliente con ese email: tiene que ingresar una vez al sitio con Google.');
    const key = { courseId_customerId: { courseId, customerId: customer.id } };
    const existing = await this.prisma.enrollment.findUnique({ where: key });
    if (existing?.status === 'activa') throw new BadRequestException('Ya está inscripto en este curso.');
    const data = { status: 'activa' as const, source: 'manual', paymentUrl: null };
    const e = existing
      ? await this.prisma.enrollment.update({ where: { id: existing.id }, data })
      : await withUniqueCode((code) => this.prisma.enrollment.create({ data: { ...data, code, courseId, customerId: customer.id, priceArs: new Prisma.Decimal(0) } }), () => generateCode('CU'));
    this.mail?.enrollmentConfirmed({ customerName: customer.name, customerEmail: customer.email, courseTitle: course.title, slug: course.slug, code: e.code }, false);
    return this.enrollments(courseId);
  }

  async setEnrollmentStatus(id: number, status: unknown) {
    if (status !== 'activa' && status !== 'cancelada') throw new BadRequestException('Estado inválido (activa o cancelada).');
    const e = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Inscripción no encontrada');
    await this.prisma.enrollment.update({ where: { id }, data: { status } });
    return this.enrollments(e.courseId);
  }

  // ------------------------------------------------------------ entregas

  async submissions(status?: string) {
    const where = status && (SUBMISSION_STATUSES as readonly string[]).includes(status) ? { status: status as any } : {};
    const rows = await this.prisma.assignmentSubmission.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: {
        lesson: { select: { id: true, title: true, instructions: true } },
        enrollment: { include: { customer: { select: { id: true, name: true, email: true } }, course: { select: { id: true, title: true, slug: true } } } },
      },
    });
    return rows.map((s) => ({
      id: s.id, status: s.status, text: s.text, fileName: s.fileName, fileSize: s.fileSize, hasFile: !!s.fileKey,
      feedback: s.feedback, createdAt: s.createdAt, reviewedAt: s.reviewedAt,
      lesson: s.lesson, customer: s.enrollment.customer, course: s.enrollment.course,
    }));
  }

  async submissionDownload(id: number) {
    const s = await this.prisma.assignmentSubmission.findUnique({ where: { id } });
    if (!s || !s.fileKey) throw new NotFoundException('La entrega no tiene archivo.');
    if (!this.storage?.enabled) throw new ServiceUnavailableException('Falta configurar R2 para descargar archivos.');
    return { url: this.storage.signDownload(s.fileKey, s.fileName ?? undefined) };
  }

  /** PATCH /admin/submissions/:id { status: aprobada | a_rehacer, feedback }. Aprobada completa la lección. */
  async review(id: number, body: any) {
    const status = body?.status;
    if (status !== 'aprobada' && status !== 'a_rehacer') throw new BadRequestException('Elegí aprobada o a rehacer.');
    const feedback = typeof body?.feedback === 'string' ? body.feedback.trim().slice(0, 5000) : '';
    if (status === 'a_rehacer' && !feedback) throw new BadRequestException('Escribí un comentario para que el alumno sepa qué corregir.');
    const s = await this.prisma.assignmentSubmission.findUnique({
      where: { id }, include: { lesson: true, enrollment: { include: { customer: true, course: true } } },
    });
    if (!s) throw new NotFoundException('Entrega no encontrada');
    const previous = s.status;
    await this.prisma.assignmentSubmission.update({ where: { id }, data: { status, feedback, reviewedAt: new Date() } });
    if (status === 'aprobada') {
      await this.prisma.lessonProgress.upsert({
        where: { enrollmentId_lessonId: { enrollmentId: s.enrollmentId, lessonId: s.lessonId } },
        create: { enrollmentId: s.enrollmentId, lessonId: s.lessonId }, update: {},
      });
    } else if (previous === 'aprobada') {
      // se corrigió un "aprobada" por error: la lección deja de estar completa (salvo que haya otra entrega aprobada)
      const other = await this.prisma.assignmentSubmission.count({ where: { enrollmentId: s.enrollmentId, lessonId: s.lessonId, status: 'aprobada', id: { not: id } } });
      if (!other) await this.prisma.lessonProgress.deleteMany({ where: { enrollmentId: s.enrollmentId, lessonId: s.lessonId } });
    }
    if (previous !== status || feedback !== s.feedback) {
      const e = s.enrollment;
      this.mail?.submissionReviewed({ customerName: e.customer.name, customerEmail: e.customer.email, courseTitle: e.course.title, slug: e.course.slug }, s.lesson.title, status === 'aprobada', feedback);
    }
    return { id, status, feedback };
  }

  // ------------------------------------------------------------ certificados

  async certificates(q?: string) {
    const search = typeof q === 'string' ? q.trim().slice(0, 40) : '';
    const rows = await this.prisma.certificate.findMany({
      where: search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { nameOnCertificate: { contains: search, mode: 'insensitive' } }] } : {},
      orderBy: { issuedAt: 'desc' }, take: 200,
      include: { enrollment: { include: { customer: { select: { id: true, email: true } } } } },
    });
    return rows.map((c) => ({
      id: c.id, code: c.code, name: c.nameOnCertificate, courseTitle: c.courseTitle, hours: Number(c.durationHours),
      issuedAt: c.issuedAt, revokedAt: c.revokedAt, revokeReason: c.revokeReason, email: c.enrollment.customer.email,
    }));
  }

  async revokeCertificate(id: number, reason: unknown, revoke = true) {
    const c = await this.prisma.certificate.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Certificado no encontrado');
    const why = String(reason ?? '').trim().slice(0, 300);
    if (revoke && !why) throw new BadRequestException('Escribí el motivo de la revocación.');
    await this.prisma.certificate.update({ where: { id }, data: revoke ? { revokedAt: new Date(), revokeReason: why } : { revokedAt: null, revokeReason: null } });
    return this.certificates();
  }
}
