import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoClient, MpPayment } from '../orders/mercadopago.client';
import { PaymentRouter } from '../orders/payment-router';
import { generateCode, withUniqueCode } from '../orders/order-code';
import { StorageService, UploadRequest, checkUpload } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { CourseMail } from '../mail/templates';
import { VideoService } from './video';
import { gradeQuiz, publicQuestion } from './quiz';
import { canCertify, flattenLessons, lockedLessons, neighbors, progressPct } from './progress';
import { SUBMISSION_RULE } from './uploads';
import { certificateName } from './validation';
import { certificatePdf } from './certificate-pdf';

/*
 * Cursos del lado público y del alumno (el admin está en courses-admin.service.ts).
 * Reglas de acceso:
 *  - El catálogo y la ficha muestran solo cursos publicados, y el temario sin contenido.
 *  - El contenido (texto, video firmado, recursos, preguntas) solo con inscripción activa, salvo las
 *    lecciones marcadas como vista previa.
 *  - Las respuestas correctas de las pruebas nunca salen del servidor.
 */

export const ENROLLMENT_CODE_RE = /^CU-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
export const CERT_CODE_RE = /^CERT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const NOT_FOUND = 'Curso no encontrado';

// Estados de pago de MP que cancelan una inscripción ya activa (devolución o contracargo)
const MP_REVERSED = ['refunded', 'charged_back'];

const LESSON_PUBLIC_SELECT = { id: true, kind: true, title: true, durationMin: true, isPreview: true, isOptional: true, position: true } as const;

type Customer = { id: number; name: string; email: string };

@Injectable()
export class CoursesService implements OnModuleInit {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    private prisma: PrismaService,
    private mp: MercadoPagoClient,
    private video: VideoService,
    @Optional() private storage?: StorageService,
    @Optional() private mail?: MailService,
    @Optional() private router?: PaymentRouter,
  ) {}

  onModuleInit() {
    this.router?.register('CU-', (payment) => this.handlePayment(payment));
  }

  // ------------------------------------------------------------ catálogo (público)

  /** GET /courses: publicados, en el orden del admin. */
  async catalog() {
    const courses = await this.prisma.course.findMany({
      where: { status: 'publicado' },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { modules: { include: { lessons: { select: { id: true, durationMin: true } } } } },
    });
    return courses.map((c) => {
      const lessons = c.modules.flatMap((m) => m.lessons);
      return {
        ...this.courseSummary(c),
        lessonCount: lessons.length,
        totalMin: lessons.reduce((s, l) => s + (l.durationMin || 0), 0),
      };
    });
  }

  private courseSummary(c: any) {
    return {
      id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle, coverUrl: c.coverUrl ?? null, level: c.level,
      durationHours: Number(c.durationHours), priceArs: Number(c.priceArs), updatedAt: c.updatedAt,
    };
  }

  /** Curso publicado con su temario ordenado (lecciones sin contenido). */
  private async publishedTree(slug: string) {
    const course = await this.prisma.course.findUnique({
      where: { slug: String(slug ?? '') },
      include: {
        modules: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: { lessons: { orderBy: [{ position: 'asc' }, { id: 'asc' }], select: LESSON_PUBLIC_SELECT } },
        },
      },
    });
    if (!course || course.status !== 'publicado') throw new NotFoundException(NOT_FOUND);
    return course;
  }

  /** GET /courses/:slug: ficha y temario. */
  async publicCourse(slug: string) {
    const c = await this.publishedTree(slug);
    const lessons = flattenLessons(c.modules);
    return {
      ...this.courseSummary(c),
      description: c.description, sequential: c.sequential,
      instructorName: c.instructorName, instructorBio: c.instructorBio, instructorPhotoUrl: c.instructorPhotoUrl ?? null,
      outcomes: Array.isArray(c.outcomes) ? c.outcomes : [], requirements: Array.isArray(c.requirements) ? c.requirements : [],
      lessonCount: lessons.length,
      totalMin: lessons.reduce((s, l) => s + (l.durationMin || 0), 0),
      quizCount: lessons.filter((l) => l.kind === 'prueba').length,
      assignmentCount: lessons.filter((l) => l.kind === 'tarea').length,
      modules: c.modules.map((m) => ({
        id: m.id, title: m.title, description: m.description,
        lessons: m.lessons.map((l) => ({ id: l.id, kind: l.kind, title: l.title, durationMin: l.durationMin, isPreview: l.isPreview, isOptional: l.isOptional })),
      })),
    };
  }

  /** GET /courses/:slug/lessons/:id/preview: solo lecciones de vista previa (texto y video). */
  async previewLesson(slug: string, lessonId: number) {
    const c = await this.publishedTree(slug);
    const meta = flattenLessons(c.modules).find((l) => l.id === lessonId);
    if (!meta || !meta.isPreview) throw new NotFoundException('Esta lección no tiene vista previa.');
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('Lección no encontrada');
    return {
      id: lesson.id, kind: lesson.kind, title: lesson.title, body: lesson.body, durationMin: lesson.durationMin,
      video: this.videoOf(lesson),
    };
  }

  private videoOf(l: { videoProvider: string | null; videoId: string | null }) {
    const embedUrl = this.video.embedUrl(l.videoProvider, l.videoId);
    return embedUrl ? { provider: l.videoProvider, embedUrl } : null;
  }

  // ------------------------------------------------------------ inscripción y pago

  /**
   * POST /courses/:slug/enroll. Gratis: queda activa. Pago: inscripción pendiente + link de Mercado Pago.
   * Si ya hay una pendiente con el mismo precio, se reusa su link; si cambió el precio, código nuevo
   * (MP guarda la preferencia por clave de idempotencia = código).
   */
  async enroll(customer: Customer, slug: string) {
    const course = await this.prisma.course.findUnique({ where: { slug: String(slug ?? '') } });
    if (!course || course.status !== 'publicado') throw new NotFoundException(NOT_FOUND);
    const price = Number(course.priceArs);
    const key = { courseId_customerId: { courseId: course.id, customerId: customer.id } };
    let e = await this.prisma.enrollment.findUnique({ where: key });
    if (e?.status === 'activa') return { code: e.code, status: e.status, paymentUrl: null };

    if (!(price > 0)) {
      const data = { status: 'activa' as const, source: 'gratis', priceArs: new Prisma.Decimal(0), paidAt: null };
      e = e
        ? await this.prisma.enrollment.update({ where: { id: e.id }, data })
        : await withUniqueCode((code) => this.prisma.enrollment.create({ data: { code, courseId: course.id, customerId: customer.id, ...data } }), () => generateCode('CU'));
      this.mail?.enrollmentConfirmed(this.mailOf(customer, course, e.code));
      return { code: e.code, status: e.status, paymentUrl: null };
    }

    if (!this.mp.enabled) throw new ServiceUnavailableException('La compra online de cursos no está disponible en este momento. Probá más tarde.');
    if (e?.status === 'pendiente_pago' && e.paymentUrl && Number(e.priceArs) === price) {
      return { code: e.code, status: e.status, paymentUrl: e.paymentUrl };
    }
    const data = { status: 'pendiente_pago' as const, source: 'compra', priceArs: new Prisma.Decimal(price), paymentUrl: null, mpPreferenceId: null };
    e = e
      ? await withUniqueCode((code) => this.prisma.enrollment.update({ where: { id: e!.id }, data: { ...data, code } }), () => generateCode('CU'))
      : await withUniqueCode((code) => this.prisma.enrollment.create({ data: { code, courseId: course.id, customerId: customer.id, ...data } }), () => generateCode('CU'));

    const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const apiPublic = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
    const pref = await this.mp.createPreference({
      externalReference: e.code,
      items: [{ id: `curso-${course.id}`, title: `Curso: ${course.title}`.slice(0, 200), quantity: 1, unit_price: price }],
      payerEmail: customer.email, payerName: customer.name,
      backUrl: `${frontend}/cursos/${course.slug}/aula/`,
      notificationUrl: apiPublic ? `${apiPublic}/payments/webhook` : undefined,
    });
    await this.prisma.enrollment.update({ where: { id: e.id }, data: { mpPreferenceId: pref.id, paymentUrl: pref.init_point } });
    return { code: e.code, status: e.status, paymentUrl: pref.init_point };
  }

  private mailOf(customer: { name: string; email: string }, course: { title: string; slug: string; priceArs?: any }, code?: string): CourseMail {
    return { customerName: customer.name, customerEmail: customer.email, courseTitle: course.title, slug: course.slug, code, priceArs: course.priceArs ?? null };
  }

  /** Pago de Mercado Pago de una inscripción (external_reference CU-…). Mismas reglas que los pedidos. */
  async handlePayment(payment: MpPayment) {
    const ref = String(payment.external_reference ?? '');
    const e = await this.prisma.enrollment.findUnique({ where: { code: ref }, include: { course: true, customer: true } });
    if (!e) return { ignored: 'inscripción inexistente' };
    const base = { mpPaymentId: String(payment.id), mpStatus: payment.status };

    if (payment.status === 'approved') {
      const paid = payment.transaction_amount == null ? NaN : Number(payment.transaction_amount);
      if (payment.currency_id !== 'ARS' || !Number.isFinite(paid) || paid + 0.01 < Number(e.priceArs)) {
        this.logger.error(`Pago ${payment.id} aprobado por ${payment.transaction_amount} ${payment.currency_id} no coincide con la inscripción ${ref} (${e.priceArs} ARS)`);
        await this.prisma.enrollment.update({ where: { id: e.id }, data: base });
        return { code: ref, status: e.status };
      }
      // condicional: dos notificaciones a la vez = un solo mail
      const { count } = await this.prisma.enrollment.updateMany({ where: { id: e.id, status: { not: 'activa' } }, data: { ...base, status: 'activa', paidAt: new Date() } });
      if (count === 1) this.mail?.enrollmentConfirmed(this.mailOf(e.customer, e.course, e.code));
      return { code: ref, status: 'activa' };
    }
    if (MP_REVERSED.includes(payment.status) && e.status === 'activa') {
      await this.prisma.enrollment.update({ where: { id: e.id }, data: { ...base, status: 'cancelada' } });
      return { code: ref, status: 'cancelada' };
    }
    await this.prisma.enrollment.update({ where: { id: e.id }, data: base });
    return { code: ref, status: e.status };
  }

  // ------------------------------------------------------------ aula (alumno)

  /** Curso (cualquier estado salvo borrador) + inscripción activa del alumno. 403 si no está inscripto. */
  private async access(customerId: number, slug: string) {
    const course = await this.prisma.course.findUnique({
      where: { slug: String(slug ?? '') },
      include: {
        modules: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: { lessons: { orderBy: [{ position: 'asc' }, { id: 'asc' }], select: LESSON_PUBLIC_SELECT } },
        },
      },
    });
    // archivado: quien ya está inscripto lo sigue viendo; borrador no lo ve nadie
    if (!course || course.status === 'borrador') throw new NotFoundException(NOT_FOUND);
    const enrollment = await this.prisma.enrollment.findUnique({ where: { courseId_customerId: { courseId: course.id, customerId } } });
    if (!enrollment || enrollment.status === 'cancelada') throw new ForbiddenException('No estás inscripto en este curso.');
    if (enrollment.status === 'pendiente_pago') throw new ForbiddenException('Tu inscripción está pendiente de pago.');
    const lessons = flattenLessons(course.modules);
    const done = await this.prisma.lessonProgress.findMany({ where: { enrollmentId: enrollment.id }, select: { lessonId: true } });
    const completed = new Set(done.map((p) => p.lessonId));
    return { course, enrollment, lessons, completed, locked: lockedLessons(lessons, completed, course.sequential) };
  }

  /** Lección del curso a la que el alumno puede entrar (no bloqueada). */
  private async openLesson(customerId: number, slug: string, lessonId: number) {
    const a = await this.access(customerId, slug);
    if (!a.lessons.some((l) => l.id === lessonId)) throw new NotFoundException('Lección no encontrada');
    if (a.locked.has(lessonId)) throw new ForbiddenException('Completá las lecciones anteriores para abrir esta.');
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('Lección no encontrada');
    return { ...a, lesson };
  }

  /** GET /me/courses: cursos del alumno (activos y pendientes de pago) con su avance. */
  async myCourses(customerId: number) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { customerId, status: { in: ['activa', 'pendiente_pago'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { include: { modules: { include: { lessons: { select: { id: true, isOptional: true } } } } } },
        progress: { select: { lessonId: true } },
        certificate: { select: { code: true, issuedAt: true, revokedAt: true } },
      },
    });
    return enrollments.filter((e) => e.course.status !== 'borrador').map((e) => {
      const lessons = flattenLessons(e.course.modules);
      const completed = new Set(e.progress.map((p) => p.lessonId));
      return {
        code: e.code, status: e.status, createdAt: e.createdAt,
        paymentUrl: e.status === 'pendiente_pago' ? e.paymentUrl ?? null : null,
        course: this.courseSummary(e.course),
        progressPct: progressPct(lessons, completed),
        certificate: e.certificate && !e.certificate.revokedAt ? { code: e.certificate.code, issuedAt: e.certificate.issuedAt } : null,
      };
    });
  }

  /** GET /me/courses/:slug: temario con el estado de cada lección. */
  async classroom(customer: Customer, slug: string) {
    const a = await this.access(customer.id, slug);
    const ids = a.lessons.map((l) => l.id);
    const [attempts, submissions, certificate] = await Promise.all([
      this.prisma.quizAttempt.findMany({ where: { enrollmentId: a.enrollment.id }, select: { lessonId: true, scorePct: true, passed: true } }),
      this.prisma.assignmentSubmission.findMany({ where: { enrollmentId: a.enrollment.id }, orderBy: { createdAt: 'desc' }, select: { lessonId: true, status: true } }),
      this.prisma.certificate.findUnique({ where: { enrollmentId: a.enrollment.id } }),
    ]);
    const best = new Map<number, { bestPct: number; passed: boolean }>();
    for (const t of attempts) {
      const b = best.get(t.lessonId);
      if (!b || t.scorePct > b.bestPct) best.set(t.lessonId, { bestPct: t.scorePct, passed: (b?.passed ?? false) || t.passed });
      else if (t.passed) b.passed = true;
    }
    const lastSubmission = new Map<number, string>();
    for (const s of submissions) if (!lastSubmission.has(s.lessonId)) lastSubmission.set(s.lessonId, s.status);
    const c = a.course;
    return {
      course: {
        id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle, coverUrl: c.coverUrl ?? null, status: c.status,
        sequential: c.sequential, durationHours: Number(c.durationHours), instructorName: c.instructorName,
      },
      enrollment: { code: a.enrollment.code, createdAt: a.enrollment.createdAt },
      progressPct: progressPct(a.lessons, a.completed),
      canCertify: canCertify(a.lessons, a.completed),
      certificate: certificate ? { code: certificate.code, issuedAt: certificate.issuedAt, name: certificate.nameOnCertificate, revoked: !!certificate.revokedAt } : null,
      suggestedName: customer.name,
      nextLessonId: ids.find((id) => !a.completed.has(id) && !a.locked.has(id)) ?? ids[0] ?? null,
      modules: c.modules.map((m) => ({
        id: m.id, title: m.title,
        lessons: m.lessons.map((l) => ({
          id: l.id, kind: l.kind, title: l.title, durationMin: l.durationMin, isOptional: l.isOptional,
          completed: a.completed.has(l.id), locked: a.locked.has(l.id),
          ...(l.kind === 'prueba' && best.has(l.id) ? { quiz: best.get(l.id) } : {}),
          ...(l.kind === 'tarea' && lastSubmission.has(l.id) ? { submission: lastSubmission.get(l.id) } : {}),
        })),
      })),
    };
  }

  /** GET /me/courses/:slug/lessons/:id: contenido completo de la lección. */
  async lesson(customerId: number, slug: string, lessonId: number) {
    const a = await this.openLesson(customerId, slug, lessonId);
    const l = a.lesson;
    const resources = await this.prisma.lessonResource.findMany({ where: { lessonId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const out: Record<string, any> = {
      id: l.id, kind: l.kind, title: l.title, body: l.body, durationMin: l.durationMin, isOptional: l.isOptional,
      completed: a.completed.has(l.id),
      video: this.videoOf(l),
      resources: resources.map((r) => ({
        id: r.id, kind: r.kind, title: r.title,
        ...(r.kind === 'link' ? { url: r.url } : { fileName: r.fileName, fileSize: r.fileSize }),
      })),
      ...neighbors(a.lessons, l.id),
    };
    if (l.kind === 'prueba') {
      const [questions, attempts] = await Promise.all([
        this.prisma.quizQuestion.findMany({ where: { lessonId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
        this.prisma.quizAttempt.findMany({ where: { enrollmentId: a.enrollment.id, lessonId }, orderBy: { createdAt: 'desc' } }),
      ]);
      out.quiz = {
        passPct: l.passPct, maxAttempts: l.maxAttempts ?? null,
        attemptsUsed: attempts.length,
        attemptsLeft: l.maxAttempts ? Math.max(0, l.maxAttempts - attempts.length) : null,
        passed: attempts.some((t) => t.passed),
        bestPct: attempts.reduce((m, t) => Math.max(m, t.scorePct), 0),
        questions: questions.map(publicQuestion),
      };
    }
    if (l.kind === 'tarea') {
      const subs = await this.prisma.assignmentSubmission.findMany({ where: { enrollmentId: a.enrollment.id, lessonId }, orderBy: { createdAt: 'desc' } });
      out.assignment = {
        instructions: l.instructions,
        submissions: subs.map((s) => ({
          id: s.id, text: s.text, fileName: s.fileName, fileSize: s.fileSize, status: s.status, feedback: s.feedback,
          createdAt: s.createdAt, reviewedAt: s.reviewedAt,
        })),
      };
    }
    return out;
  }

  private async markComplete(enrollmentId: number, lessonId: number) {
    await this.prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
      create: { enrollmentId, lessonId }, update: {},
    });
  }

  /** POST …/complete: solo video y lectura (la prueba se completa al aprobar y la tarea al corregirla). */
  async complete(customerId: number, slug: string, lessonId: number) {
    const a = await this.openLesson(customerId, slug, lessonId);
    if (a.lesson.kind !== 'video' && a.lesson.kind !== 'lectura') {
      throw new BadRequestException(a.lesson.kind === 'prueba' ? 'La prueba se completa al aprobarla.' : 'La tarea se completa cuando la aprobamos.');
    }
    await this.markComplete(a.enrollment.id, lessonId);
    a.completed.add(lessonId);
    return { completed: true, progressPct: progressPct(a.lessons, a.completed), canCertify: canCertify(a.lessons, a.completed) };
  }

  /** POST …/attempts { answers }: corrige en el servidor. */
  async attempt(customerId: number, slug: string, lessonId: number, answers: unknown) {
    const a = await this.openLesson(customerId, slug, lessonId);
    const l = a.lesson;
    if (l.kind !== 'prueba') throw new BadRequestException('Esta lección no es una prueba.');
    const used = await this.prisma.quizAttempt.count({ where: { enrollmentId: a.enrollment.id, lessonId } });
    if (l.maxAttempts && used >= l.maxAttempts) throw new BadRequestException('No te quedan intentos para esta prueba. Escribinos si necesitás otro.');
    const questions = await this.prisma.quizQuestion.findMany({ where: { lessonId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const graded = gradeQuiz(questions, answers);
    const passed = graded.scorePct >= l.passPct;
    await this.prisma.quizAttempt.create({
      data: { enrollmentId: a.enrollment.id, lessonId, answers: graded.answers as Prisma.InputJsonValue, scorePct: graded.scorePct, passed },
    });
    if (passed) {
      await this.markComplete(a.enrollment.id, lessonId);
      a.completed.add(lessonId);
    }
    return {
      scorePct: graded.scorePct, passed, passPct: l.passPct, wrong: graded.wrong,
      attemptsLeft: l.maxAttempts ? Math.max(0, l.maxAttempts - used - 1) : null,
      progressPct: progressPct(a.lessons, a.completed), canCertify: canCertify(a.lessons, a.completed),
    };
  }

  private async assignmentOpen(customerId: number, slug: string, lessonId: number) {
    const a = await this.openLesson(customerId, slug, lessonId);
    if (a.lesson.kind !== 'tarea') throw new BadRequestException('Esta lección no es una tarea.');
    const approved = await this.prisma.assignmentSubmission.count({ where: { enrollmentId: a.enrollment.id, lessonId, status: 'aprobada' } });
    if (approved) throw new BadRequestException('Esta tarea ya está aprobada.');
    return a;
  }

  /** POST …/submission/upload-url: URL firmada para subir el archivo de la entrega. */
  async submissionUploadUrl(customerId: number, slug: string, lessonId: number, file: UploadRequest) {
    const a = await this.assignmentOpen(customerId, slug, lessonId);
    if (!this.storage?.enabled) throw new ServiceUnavailableException('Todavía no se pueden subir archivos: pegá un link en el texto de la entrega.');
    const f = checkUpload(file, SUBMISSION_RULE);
    const signed = this.storage.signUpload('private', this.storage.newKey(`submissions/${a.enrollment.code}/${lessonId}`, f.ext), f);
    return { ...signed, fileName: f.filename, fileSize: f.size };
  }

  /** POST …/submission { text, key?, fileName?, fileSize? }. */
  async submit(customer: Customer, slug: string, lessonId: number, body: any) {
    const a = await this.assignmentOpen(customer.id, slug, lessonId);
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 20000) : '';
    let file: { fileKey: string; fileName: string; fileSize: number | null } | null = null;
    if (body?.key) {
      const key = String(body.key);
      const prefix = `submissions/${a.enrollment.code}/${lessonId}/`;
      if (!key.startsWith(prefix) || !/^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(key.slice(prefix.length))) throw new BadRequestException('Archivo inválido: subilo de nuevo.');
      const name = String(body.fileName ?? '').replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').trim().slice(-120) || `entrega.${key.split('.').pop()}`;
      const size = Number(body.fileSize);
      file = { fileKey: key, fileName: name, fileSize: Number.isInteger(size) && size > 0 ? size : null };
    }
    if (!text && !file) throw new BadRequestException('Escribí tu respuesta o adjuntá un archivo.');
    const s = await this.prisma.assignmentSubmission.create({
      data: { enrollmentId: a.enrollment.id, lessonId, text, ...(file ?? {}) },
    });
    this.mail?.submissionReceived(this.mailOf(customer, a.course, a.enrollment.code), a.lesson.title);
    return { id: s.id, status: s.status, createdAt: s.createdAt, fileName: s.fileName, text: s.text };
  }

  /** GET …/resources/:id: link firmado de descarga (o el link externo). */
  async resourceUrl(customerId: number, slug: string, resourceId: number) {
    const r = await this.prisma.lessonResource.findUnique({ where: { id: resourceId } });
    if (!r) throw new NotFoundException('Recurso no encontrado');
    await this.openLesson(customerId, slug, r.lessonId); // inscripción, curso y lección abierta
    if (r.kind === 'link') return { url: r.url };
    if (!r.fileKey) throw new NotFoundException('Recurso no encontrado');
    if (!this.storage?.enabled) throw new ServiceUnavailableException('Las descargas no están disponibles en este momento.');
    return { url: this.storage.signDownload(r.fileKey, r.fileName ?? undefined) };
  }

  // ------------------------------------------------------------ certificados

  /** POST /me/courses/:slug/certificate { name }: emite una sola vez, con todas las obligatorias completas. */
  async issueCertificate(customer: Customer, slug: string, rawName: unknown) {
    const a = await this.access(customer.id, slug);
    const existing = await this.prisma.certificate.findUnique({ where: { enrollmentId: a.enrollment.id } });
    if (existing) {
      if (existing.revokedAt) throw new BadRequestException('Tu certificado fue revocado. Escribinos si creés que es un error.');
      return { code: existing.code, issuedAt: existing.issuedAt, name: existing.nameOnCertificate };
    }
    if (!canCertify(a.lessons, a.completed)) throw new BadRequestException('Todavía te faltan lecciones para obtener el certificado.');
    const name = certificateName(rawName);
    const cert = await withUniqueCode((code) => this.prisma.certificate.create({
      data: {
        code, enrollmentId: a.enrollment.id, nameOnCertificate: name,
        courseTitle: a.course.title, durationHours: new Prisma.Decimal(Number(a.course.durationHours)),
      },
    }), () => generateCode('CERT'));
    await this.prisma.enrollment.update({ where: { id: a.enrollment.id }, data: { completedAt: new Date() } });
    this.mail?.certificateIssued(this.mailOf(customer, a.course, cert.code));
    return { code: cert.code, issuedAt: cert.issuedAt, name: cert.nameOnCertificate };
  }

  private certCode(raw: string) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!CERT_CODE_RE.test(code)) throw new NotFoundException('Certificado no encontrado');
    return code;
  }

  /** GET /certificates/:code: verificación pública. */
  async verifyCertificate(raw: string) {
    const code = this.certCode(raw);
    const c = await this.prisma.certificate.findUnique({ where: { code }, include: { enrollment: { include: { course: { select: { slug: true, status: true } } } } } });
    if (!c) throw new NotFoundException('Certificado no encontrado');
    return {
      code: c.code, valid: !c.revokedAt, name: c.nameOnCertificate, courseTitle: c.courseTitle,
      hours: Number(c.durationHours), issuedAt: c.issuedAt, revokedAt: c.revokedAt ?? null,
      courseSlug: c.enrollment?.course?.status === 'publicado' ? c.enrollment.course.slug : null,
    };
  }

  /** GET /certificates/:code/pdf. Un certificado revocado no se descarga. */
  async certificatePdf(raw: string) {
    const v = await this.verifyCertificate(raw);
    if (!v.valid) throw new NotFoundException('Este certificado fue revocado.');
    const site = (process.env.FRONTEND_URL || 'https://auryx.com.ar').replace(/\/+$/, '');
    const bytes = await certificatePdf({
      code: v.code, name: v.name, courseTitle: v.courseTitle, hours: v.hours, issuedAt: new Date(v.issuedAt),
      verifyUrl: `${site.replace(/^https?:\/\//, '')}/certificados/${v.code}/`,
    });
    return { code: v.code, bytes };
  }
}
