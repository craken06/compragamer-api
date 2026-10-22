/*
 * Cursos con base, Mercado Pago, Bunny y mails SIMULADOS (sin red ni Neon).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { gradeQuiz, normalizeQuestion, publicQuestion } from '../src/courses/quiz';
import { canCertify, flattenLessons, lockedLessons, neighbors, progressPct } from '../src/courses/progress';
import { certificateName, courseData, lessonData, orderIds } from '../src/courses/validation';
import { VideoService, youtubeId } from '../src/courses/video';
import { certificatePdf } from '../src/courses/certificate-pdf';
import { CoursesService } from '../src/courses/courses.service';
import { PaymentRouter } from '../src/orders/payment-router';
import { OrdersService } from '../src/orders/orders.service';

// ---------------------------------------------------------------- piezas puras

test('quiz: normaliza preguntas (única con una correcta, múltiple con al menos una, VF fija) y rechaza las inválidas', () => {
  const u = normalizeQuestion({ kind: 'unica', prompt: ' ¿Qué mide el Voc? ', options: [{ id: 'a', text: 'Tensión', correct: true }, { text: 'Corriente' }] });
  assert.equal(u.prompt, '¿Qué mide el Voc?');
  assert.equal(u.options[0].id, 'a');
  assert.match(u.options[1].id, /^[a-z0-9]{1,12}$/);
  assert.equal(u.options[1].correct, false);
  assert.throws(() => normalizeQuestion({ kind: 'unica', prompt: 'x', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }), /exactamente una/);
  assert.throws(() => normalizeQuestion({ kind: 'multiple', prompt: 'x', options: [{ text: 'a' }, { text: 'b' }] }), /al menos una/);
  assert.throws(() => normalizeQuestion({ kind: 'unica', prompt: 'x', options: [{ text: 'a', correct: true }] }), /entre 2 y 10/);
  assert.throws(() => normalizeQuestion({ kind: 'unica', prompt: '', options: [] }), /enunciado/);
  assert.throws(() => normalizeQuestion({ kind: 'otra', prompt: 'x' }), /Tipo de pregunta/);
  const vf = normalizeQuestion({ kind: 'vf', prompt: 'El MPPT sigue el punto de máxima potencia', answer: true });
  assert.deepEqual(vf.options, [{ id: 'v', text: 'Verdadero', correct: true }, { id: 'f', text: 'Falso', correct: false }]);
  assert.throws(() => normalizeQuestion({ kind: 'vf', prompt: 'x' }), /Verdadero o Falso/);
  // ids repetidos: el segundo se renumera
  const dup = normalizeQuestion({ kind: 'multiple', prompt: 'x', options: [{ id: 'a', text: '1', correct: true }, { id: 'a', text: '2' }] });
  assert.notEqual(dup.options[0].id, dup.options[1].id);
});

test('quiz: corrige única, múltiple (conjunto exacto) y VF; publicQuestion no manda las correctas', () => {
  const qs = [
    { id: 1, kind: 'unica', prompt: 'p1', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }] },
    { id: 2, kind: 'multiple', prompt: 'p2', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: true }, { id: 'c', text: 'C', correct: false }] },
    { id: 3, kind: 'vf', prompt: 'p3', options: [{ id: 'v', text: 'V', correct: false }, { id: 'f', text: 'F', correct: true }] },
  ];
  assert.deepEqual(gradeQuiz(qs, { 1: ['a'], 2: ['b', 'a'], 3: ['f'] }).scorePct, 100);
  const half = gradeQuiz(qs, { 1: ['a'], 2: ['a'], 3: 'v' });
  assert.equal(half.scorePct, 33);
  assert.deepEqual(half.wrong, [2, 3]);
  // marcar todas en una única no vale; respuestas basura no rompen
  assert.deepEqual(gradeQuiz(qs, { 1: ['a', 'b'], 2: ['a', 'b', 'c'] }).wrong, [1, 2, 3]);
  assert.equal(gradeQuiz(qs, 'basura').scorePct, 0);
  assert.equal(gradeQuiz(qs, { 2: ['a', 'a', 'b'] }).wrong.includes(2), false); // repetidas se ignoran
  assert.throws(() => gradeQuiz([], {}), /no tiene preguntas/);
  const pub = publicQuestion(qs[1]);
  assert.ok(!JSON.stringify(pub).includes('correct'));
  assert.deepEqual(pub.options.map((o) => o.id), ['a', 'b', 'c']);
});

test('progreso: bloqueo con orden obligatorio (las opcionales no frenan), porcentaje, certificado y vecinos', () => {
  const lessons = [{ id: 1, isOptional: false }, { id: 2, isOptional: true }, { id: 3, isOptional: false }, { id: 4, isOptional: false }];
  assert.deepEqual([...lockedLessons(lessons, new Set(), false)], []);
  assert.deepEqual([...lockedLessons(lessons, new Set(), true)], [2, 3, 4]);
  assert.deepEqual([...lockedLessons(lessons, new Set([1]), true)], [4]); // la 2 es opcional: la 3 se abre igual
  assert.deepEqual([...lockedLessons(lessons, new Set([1, 3]), true)], []);
  assert.equal(progressPct(lessons, new Set([1, 2])), 33);
  assert.equal(progressPct([], new Set()), 0);
  assert.equal(canCertify(lessons, new Set([1, 3])), false);
  assert.equal(canCertify(lessons, new Set([1, 3, 4])), true);
  assert.equal(canCertify([{ id: 9, isOptional: true }], new Set([9])), false); // sin obligatorias no hay certificado
  assert.deepEqual(neighbors(lessons, 1), { prevId: null, nextId: 2 });
  assert.deepEqual(neighbors(lessons, 4), { prevId: 3, nextId: null });
  assert.deepEqual(flattenLessons([{ lessons: [lessons[0]] }, { lessons: [lessons[1]] }]).map((l) => l.id), [1, 2]);
});

test('validación: curso, lección, orden y nombre del certificado', () => {
  const d = courseData({ title: ' On-grid básico ', slug: 'On-Grid-Basico', priceArs: '15000.555', durationHours: 4.25, outcomes: ['a', ' ', 'b'], hack: 1, id: 99 }, false);
  assert.equal(d.title, 'On-grid básico');
  assert.equal(d.slug, 'on-grid-basico');
  assert.equal(Number(d.priceArs), 15000.56);
  assert.equal(Number(d.durationHours), 4.3);
  assert.deepEqual(d.outcomes, ['a', 'b']);
  assert.ok(!('hack' in d) && !('id' in d));
  assert.throws(() => courseData({ title: 'x', slug: 'con espacios' }, false), /slug/);
  assert.throws(() => courseData({ title: 'x', slug: 'ok', coverUrl: 'javascript:alert(1)' }, false), /URL http/);
  assert.throws(() => courseData({ title: 'x', slug: 'ok', priceArs: -1 }, false), /precio/);
  assert.deepEqual(courseData({ subtitle: 'nuevo' }, true), { subtitle: 'nuevo' });
  assert.throws(() => lessonData({ title: 'x', kind: 'podcast' }, false), /Tipo de lección/);
  assert.equal(lessonData({ title: 'x' }, false).kind, 'video');
  assert.equal(lessonData({ maxAttempts: '' }, true).maxAttempts, null);
  assert.deepEqual(orderIds([3, 1, 2], [1, 2, 3], 'x'), [3, 1, 2]);
  assert.throws(() => orderIds([1, 1, 2], [1, 2, 3], 'los módulos'), /recargá/);
  assert.throws(() => orderIds([1, 2], [1, 2, 3], 'x'), /recargá/);
  assert.equal(certificateName('  María   José  Pérez-Núñez '), 'María José Pérez-Núñez');
  assert.equal(certificateName("D'Alessandro Ana"), "D'Alessandro Ana");
  assert.throws(() => certificateName('Ana <script>'), /certificado/);
  assert.throws(() => certificateName('A'), /certificado/);
});

test('video: id de YouTube desde links; embed de Bunny firmado; firma de subida TUS', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://evil.com/?v=dQw4w9WgXcQ'), null);
  const prev = { ...process.env };
  try {
    Object.assign(process.env, { BUNNY_LIBRARY_ID: '123', BUNNY_API_KEY: 'key', BUNNY_TOKEN_KEY: 'tok' });
    const v = new VideoService();
    const id = '11111111-2222-3333-4444-555555555555';
    const now = 1_700_000_000_000;
    const exp = 1_700_000_000 + 6 * 3600;
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    assert.equal(v.embedUrl('bunny', id, now), `https://iframe.mediadelivery.net/embed/123/${id}?token=${sha(`tok${id}${exp}`)}&expires=${exp}&responsive=true`);
    assert.equal(v.embedUrl('youtube', 'dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1');
    assert.equal(v.embedUrl('bunny', 'no-es-guid'), null);
    assert.equal(v.embedUrl(null, id), null);
    const tus = v.tusAuth(id, now);
    assert.equal(tus.signature, sha(`123key${1_700_000_000 + 86400}${id}`));
    assert.equal(tus.endpoint, 'https://video.bunnycdn.com/tusupload');
    assert.deepEqual(v.normalize('youtube', 'https://youtu.be/dQw4w9WgXcQ'), { videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ' });
    assert.deepEqual(v.normalize(null, 'x'), { videoProvider: null, videoId: null });
    assert.throws(() => v.normalize('vimeo', '1'), /Proveedor/);
    delete process.env.BUNNY_TOKEN_KEY;
    assert.ok(v.embedUrl('bunny', id)!.endsWith('?responsive=true'));
  } finally {
    for (const k of ['BUNNY_LIBRARY_ID', 'BUNNY_API_KEY', 'BUNNY_TOKEN_KEY']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
});

test('certificado PDF: se genera (también con un nombre fuera de WinAnsi)', async () => {
  const base = { code: 'CERT-ABC234', courseTitle: 'Instalaciones on-grid: del techo al medidor', hours: 4.5, issuedAt: new Date('2026-10-22T15:00:00Z'), verifyUrl: 'auryx.com.ar/certificados/CERT-ABC234/' };
  const pdf = await certificatePdf({ ...base, name: 'María Ñúñez' });
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
  const odd = await certificatePdf({ ...base, name: 'Łukasz Żółć 李' });
  assert.equal(Buffer.from(odd.slice(0, 5)).toString(), '%PDF-');
});

// ---------------------------------------------------------------- servicio con base simulada

function matches(o: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return o[k] !== cond.not;
      if ('in' in cond) return cond.in.includes(o[k]);
    }
    return o[k] === cond;
  });
}
const byPos = (a: any, b: any) => a.position - b.position || a.id - b.id;

function fakeDb() {
  const t: Record<string, any[]> = {
    courses: [], modules: [], lessons: [], resources: [], questions: [], enrollments: [], progress: [], attempts: [], submissions: [], certificates: [],
    customers: [{ id: 7, name: 'Ana Pérez', email: 'ana@example.com' }],
  };
  let seq = 100;
  const tree = (c: any) => c && ({
    ...c,
    modules: t.modules.filter((m) => m.courseId === c.id).sort(byPos).map((m) => ({ ...m, lessons: t.lessons.filter((l) => l.moduleId === m.id).sort(byPos) })),
  });
  const enrollmentKey = (w: any) => w.courseId_customerId
    ? t.enrollments.find((e) => e.courseId === w.courseId_customerId.courseId && e.customerId === w.courseId_customerId.customerId)
    : t.enrollments.find((e) => matches(e, w));
  const db: any = {
    t,
    course: {
      findUnique: async ({ where, include }: any) => { const c = t.courses.find((x) => matches(x, where)); return include?.modules ? tree(c) ?? null : c ?? null; },
      findMany: async ({ where }: any) => t.courses.filter((c) => matches(c, where)).sort(byPos).map(tree),
    },
    lesson: { findUnique: async ({ where }: any) => t.lessons.find((l) => l.id === where.id) ?? null },
    lessonResource: {
      findMany: async ({ where }: any) => t.resources.filter((r) => matches(r, where)).sort(byPos),
      findUnique: async ({ where }: any) => t.resources.find((r) => r.id === where.id) ?? null,
    },
    quizQuestion: { findMany: async ({ where }: any) => t.questions.filter((q) => matches(q, where)).sort(byPos) },
    enrollment: {
      findUnique: async ({ where, include }: any) => {
        const e = enrollmentKey(where);
        if (!e) return null;
        return include ? { ...e, course: t.courses.find((c) => c.id === e.courseId), customer: t.customers.find((c) => c.id === e.customerId) } : e;
      },
      create: async ({ data }: any) => { const e = { id: ++seq, createdAt: new Date(), paymentUrl: null, ...data }; t.enrollments.push(e); return e; },
      update: async ({ where, data }: any) => Object.assign(t.enrollments.find((e) => e.id === where.id), data),
      updateMany: async ({ where, data }: any) => { const r = t.enrollments.filter((e) => matches(e, where)); r.forEach((e) => Object.assign(e, data)); return { count: r.length }; },
      findMany: async ({ where }: any) => t.enrollments.filter((e) => matches(e, where)).map((e) => ({
        ...e, course: tree(t.courses.find((c) => c.id === e.courseId)),
        progress: t.progress.filter((p) => p.enrollmentId === e.id),
        certificate: t.certificates.find((c) => c.enrollmentId === e.id) ?? null,
      })),
    },
    lessonProgress: {
      findMany: async ({ where }: any) => t.progress.filter((p) => matches(p, where)),
      upsert: async ({ where: { enrollmentId_lessonId: k }, create }: any) => {
        const found = t.progress.find((p) => p.enrollmentId === k.enrollmentId && p.lessonId === k.lessonId);
        if (found) return found;
        t.progress.push({ ...create, completedAt: new Date() }); return create;
      },
    },
    quizAttempt: {
      findMany: async ({ where }: any) => t.attempts.filter((a) => matches(a, where)),
      count: async ({ where }: any) => t.attempts.filter((a) => matches(a, where)).length,
      create: async ({ data }: any) => { const a = { id: ++seq, createdAt: new Date(), ...data }; t.attempts.push(a); return a; },
    },
    assignmentSubmission: {
      findMany: async ({ where }: any) => t.submissions.filter((s) => matches(s, where)),
      count: async ({ where }: any) => t.submissions.filter((s) => matches(s, where)).length,
      create: async ({ data }: any) => { const s = { id: ++seq, createdAt: new Date(), status: 'entregada', feedback: '', fileName: null, fileSize: null, ...data }; t.submissions.push(s); return s; },
    },
    certificate: {
      findUnique: async ({ where, include }: any) => {
        const c = t.certificates.find((x) => matches(x, where));
        if (!c) return null;
        if (!include) return c;
        const e = t.enrollments.find((x) => x.id === c.enrollmentId);
        return { ...c, enrollment: { ...e, course: t.courses.find((x) => x.id === e.courseId) } };
      },
      create: async ({ data }: any) => { const c = { id: ++seq, issuedAt: new Date(), revokedAt: null, ...data }; t.certificates.push(c); return c; },
    },
  };
  return db;
}

/** Curso publicado: módulo 1 (video vista previa, lectura opcional, prueba) y módulo 2 (tarea). */
function seed(db: any, extra: any = {}) {
  const course = { id: 1, slug: 'on-grid', title: 'On-grid básico', subtitle: '', description: 'd', coverUrl: null, level: 'inicial', durationHours: '4.5', priceArs: '0', status: 'publicado', sequential: false, instructorName: 'Lucas', instructorBio: '', instructorPhotoUrl: null, outcomes: ['a'], requirements: [], position: 0, updatedAt: new Date(), ...extra };
  db.t.courses.push(course);
  db.t.modules.push({ id: 10, courseId: 1, title: 'M1', description: '', position: 0 }, { id: 11, courseId: 1, title: 'M2', description: '', position: 1 });
  const lesson = (id: number, moduleId: number, position: number, kind: string, o: any = {}) => ({
    id, moduleId, position, kind, title: `L${id}`, body: `texto ${id}`, videoProvider: null, videoId: null, durationMin: 5,
    isPreview: false, isOptional: false, passPct: 70, maxAttempts: null, instructions: '', ...o,
  });
  db.t.lessons.push(
    lesson(20, 10, 0, 'video', { isPreview: true, videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ' }),
    lesson(21, 10, 1, 'lectura', { isOptional: true }),
    lesson(22, 10, 2, 'prueba', { maxAttempts: 2 }),
    lesson(23, 11, 0, 'tarea', { instructions: 'Subí tu plano' }),
  );
  db.t.questions.push(
    { id: 30, lessonId: 22, kind: 'unica', prompt: '¿Voc?', options: [{ id: 'a', text: 'Tensión', correct: true }, { id: 'b', text: 'Corriente', correct: false }], explanation: '', position: 0 },
    { id: 31, lessonId: 22, kind: 'vf', prompt: 'MPPT', options: [{ id: 'v', text: 'Verdadero', correct: true }, { id: 'f', text: 'Falso', correct: false }], explanation: '', position: 1 },
  );
  db.t.resources.push({ id: 40, lessonId: 21, kind: 'link', title: 'Norma', url: 'https://example.com/norma', position: 0 });
  return course;
}

function fakeMp() {
  const calls: any[] = [];
  return { enabled: true, calls, createPreference: async (o: any) => { calls.push(o); return { id: 'pref-c', init_point: `https://mp.test/${o.externalReference}` }; } } as any;
}
function recMail() {
  const sent: any[] = [];
  const rec = (kind: string) => (...args: any[]) => sent.push({ kind, args });
  return { sent, enrollmentConfirmed: rec('inscripcion'), submissionReceived: rec('entrega'), certificateIssued: rec('certificado') } as any;
}
const ana = { id: 7, name: 'Ana Pérez', email: 'ana@example.com' };
const svcOf = (db: any, mp = fakeMp(), mail: any = recMail(), router?: PaymentRouter) =>
  new CoursesService(db, mp, new VideoService(), undefined, mail, router);

test('catálogo y ficha: solo publicados; el temario no trae contenido; vista previa solo en lecciones marcadas', async () => {
  const db = fakeDb();
  seed(db);
  db.t.courses.push({ id: 2, slug: 'borrador', title: 'B', status: 'borrador', position: 1, durationHours: '0', priceArs: '0' });
  const svc = svcOf(db);
  const cat = await svc.catalog();
  assert.deepEqual(cat.map((c) => c.slug), ['on-grid']);
  assert.equal(cat[0].lessonCount, 4);
  assert.equal(cat[0].totalMin, 20);
  await assert.rejects(svc.publicCourse('borrador'), /no encontrado/);
  const c = await svc.publicCourse('on-grid');
  assert.equal(c.quizCount, 1);
  assert.equal(c.assignmentCount, 1);
  const json = JSON.stringify(c);
  assert.ok(!json.includes('texto 20') && !json.includes('dQw4w9WgXcQ') && !json.includes('Subí tu plano'));
  const prev = await svc.previewLesson('on-grid', 20);
  assert.equal(prev.body, 'texto 20');
  assert.match(prev.video!.embedUrl, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  await assert.rejects(svc.previewLesson('on-grid', 21), /vista previa/);
});

test('inscripción: gratis queda activa (un mail); paga crea link de MP y lo reusa; precio nuevo = código nuevo', async () => {
  const db = fakeDb();
  seed(db);
  const mail = recMail();
  const free = await svcOf(db, fakeMp(), mail).enroll(ana, 'on-grid');
  assert.equal(free.status, 'activa');
  assert.match(free.code, /^CU-[23456789A-Z]{6}$/);
  assert.equal((await svcOf(db, fakeMp(), mail).enroll(ana, 'on-grid')).code, free.code); // ya inscripto: no duplica
  assert.equal(mail.sent.length, 1);

  const db2 = fakeDb();
  seed(db2, { priceArs: '20000' });
  const mp = fakeMp();
  const r = await svcOf(db2, mp).enroll(ana, 'on-grid');
  assert.equal(r.status, 'pendiente_pago');
  assert.equal(r.paymentUrl, `https://mp.test/${r.code}`);
  assert.equal(mp.calls[0].items[0].unit_price, 20000);
  assert.ok(mp.calls[0].backUrl.endsWith('/cursos/on-grid/aula/'));
  const again = await svcOf(db2, mp).enroll(ana, 'on-grid');
  assert.equal(again.code, r.code);
  assert.equal(mp.calls.length, 1);
  db2.t.courses[0].priceArs = '25000';
  const newer = await svcOf(db2, mp).enroll(ana, 'on-grid');
  assert.notEqual(newer.code, r.code);
  assert.equal(mp.calls[1].items[0].unit_price, 25000);
  assert.equal(db2.t.enrollments.length, 1);

  const off = fakeMp(); off.enabled = false;
  const db3 = fakeDb(); seed(db3, { priceArs: '1' });
  await assert.rejects(svcOf(db3, off).enroll(ana, 'on-grid'), /no está disponible/);
  await assert.rejects(svcOf(db3).enroll(ana, 'no-existe'), /no encontrado/);
});

test('webhook: CU- va a cursos por el PaymentRouter; monto correcto activa una sola vez; devolución cancela', async () => {
  const db = fakeDb();
  seed(db, { priceArs: '20000' });
  const router = new PaymentRouter();
  const mail = recMail();
  const svc = svcOf(db, fakeMp(), mail, router);
  svc.onModuleInit();
  const { code } = await svc.enroll(ana, 'on-grid');
  const pay = (p: any) => ({ id: 5, external_reference: code, currency_id: 'ARS', ...p });
  // el webhook de pedidos deriva al de cursos
  const ordersDb: any = { order: { findUnique: async () => { throw new Error('no debería buscar un pedido'); } } };
  const orders = new OrdersService(ordersDb, {} as any, { getPayment: async () => pay({ status: 'approved', transaction_amount: 100 }) } as any, {} as any, undefined, undefined, router);
  assert.equal(((await orders.handlePaymentNotification('5')) as any).status, 'pendiente_pago'); // monto menor: no activa
  assert.equal(db.t.enrollments[0].status, 'pendiente_pago');
  await Promise.all([svc.handlePayment(pay({ status: 'approved', transaction_amount: 20000 })), svc.handlePayment(pay({ status: 'approved', transaction_amount: 20000 }))]);
  assert.equal(db.t.enrollments[0].status, 'activa');
  assert.ok(db.t.enrollments[0].paidAt instanceof Date);
  assert.equal(mail.sent.filter((m: any) => m.kind === 'inscripcion').length, 1);
  await svc.handlePayment(pay({ status: 'refunded', transaction_amount: 20000 }));
  assert.equal(db.t.enrollments[0].status, 'cancelada');
  assert.deepEqual(await svc.handlePayment({ id: 1, status: 'approved', external_reference: 'CU-ZZZZZZ' } as any), { ignored: 'inscripción inexistente' });
});

test('aula: sin inscripción 403; contenido sin respuestas correctas; completar solo video/lectura; orden obligatorio', async () => {
  const db = fakeDb();
  seed(db, { sequential: true });
  const svc = svcOf(db);
  await assert.rejects(svc.classroom(ana, 'on-grid'), /No estás inscripto/);
  await assert.rejects(svc.lesson(7, 'on-grid', 20), /No estás inscripto/);
  await svc.enroll(ana, 'on-grid');

  let room = await svc.classroom(ana, 'on-grid');
  const states = room.modules.flatMap((m: any) => m.lessons.map((l: any) => [l.id, l.locked]));
  assert.deepEqual(states, [[20, false], [21, true], [22, true], [23, true]]);
  assert.equal(room.nextLessonId, 20);
  await assert.rejects(svc.lesson(7, 'on-grid', 22), /lecciones anteriores/);

  const l20 = await svc.lesson(7, 'on-grid', 20);
  assert.match(l20.video.embedUrl, /youtube-nocookie/);
  assert.deepEqual([l20.prevId, l20.nextId], [null, 21]);
  const done = await svc.complete(7, 'on-grid', 20);
  assert.equal(done.progressPct, 33); // 1 de 3 obligatorias (la 21 es opcional)

  room = await svc.classroom(ana, 'on-grid');
  assert.deepEqual(room.modules.flatMap((m: any) => m.lessons.filter((l: any) => l.locked).map((l: any) => l.id)), [23]); // la 22 se abre: la 21 es opcional
  const quiz = await svc.lesson(7, 'on-grid', 22);
  assert.ok(!JSON.stringify(quiz).includes('correct'));
  assert.equal(quiz.quiz.questions.length, 2);
  await assert.rejects(svc.complete(7, 'on-grid', 22), /al aprobarla/);
  const l21 = await svc.lesson(7, 'on-grid', 21);
  assert.deepEqual(l21.resources, [{ id: 40, kind: 'link', title: 'Norma', url: 'https://example.com/norma' }]);
  await assert.rejects(svc.lesson(7, 'on-grid', 999), /no encontrada/);
});

test('prueba: corrige en el servidor, respeta los intentos y aprobar completa la lección', async () => {
  const db = fakeDb();
  seed(db);
  const svc = svcOf(db);
  await svc.enroll(ana, 'on-grid');
  const bad = await svc.attempt(7, 'on-grid', 22, { 30: ['b'], 31: ['v'] });
  assert.deepEqual([bad.scorePct, bad.passed, bad.wrong, bad.attemptsLeft], [50, false, [30], 1]);
  assert.equal(db.t.progress.length, 0);
  const ok = await svc.attempt(7, 'on-grid', 22, { 30: ['a'], 31: ['v'] });
  assert.deepEqual([ok.scorePct, ok.passed, ok.attemptsLeft], [100, true, 0]);
  assert.deepEqual(db.t.progress.map((p: any) => p.lessonId), [22]);
  await assert.rejects(svc.attempt(7, 'on-grid', 22, {}), /No te quedan intentos/);
  await assert.rejects(svc.attempt(7, 'on-grid', 20, {}), /no es una prueba/);
  const room = await svc.classroom(ana, 'on-grid');
  assert.deepEqual(room.modules[0].lessons.find((l: any) => l.id === 22).quiz, { bestPct: 100, passed: true });
});

test('tarea: texto o archivo del propio alumno; aviso al admin; sin R2 la subida responde 503', async () => {
  const db = fakeDb();
  seed(db);
  const mail = recMail();
  const svc = svcOf(db, fakeMp(), mail);
  const { code } = await svc.enroll(ana, 'on-grid');
  await assert.rejects(svc.submit(ana, 'on-grid', 23, {}), /Escribí tu respuesta/);
  await assert.rejects(svc.submit(ana, 'on-grid', 23, { key: 'submissions/CU-OTRO22/23/11111111-1111-1111-1111-111111111111.pdf' }), /inválido/);
  await assert.rejects(svc.submissionUploadUrl(7, 'on-grid', 23, { filename: 'a.pdf', size: 10 }), /Todavía no se pueden subir/);
  const s = await svc.submit(ana, 'on-grid', 23, { text: 'Mi respuesta', key: `submissions/${code}/23/11111111-1111-1111-1111-111111111111.pdf`, fileName: 'plano<1>.pdf', fileSize: 1234 });
  assert.equal(s.status, 'entregada');
  assert.equal(s.fileName, 'plano_1_.pdf');
  assert.equal(mail.sent.filter((m: any) => m.kind === 'entrega').length, 1);
  db.t.submissions[0].status = 'aprobada';
  await assert.rejects(svc.submit(ana, 'on-grid', 23, { text: 'otra' }), /ya está aprobada/);
  await assert.rejects(svc.submit(ana, 'on-grid', 22, { text: 'x' }), /no es una tarea/);
});

test('certificado: solo con todo lo obligatorio completo, una vez, con el nombre validado; verificación pública', async () => {
  const db = fakeDb();
  seed(db);
  const mail = recMail();
  const svc = svcOf(db, fakeMp(), mail);
  const { code } = await svc.enroll(ana, 'on-grid');
  const eid = db.t.enrollments[0].id;
  await assert.rejects(svc.issueCertificate(ana, 'on-grid', 'Ana Pérez'), /te faltan lecciones/);
  for (const lessonId of [20, 22, 23]) db.t.progress.push({ enrollmentId: eid, lessonId });
  await assert.rejects(svc.issueCertificate(ana, 'on-grid', '<b>'), /nombre/);
  const cert = await svc.issueCertificate(ana, 'on-grid', ' Ana  Pérez ');
  assert.match(cert.code, /^CERT-[23456789A-Z]{6}$/);
  assert.equal(cert.name, 'Ana Pérez');
  assert.ok(db.t.enrollments[0].completedAt instanceof Date);
  assert.equal((await svc.issueCertificate(ana, 'on-grid', 'Otro Nombre')).code, cert.code); // no se emite dos veces
  assert.equal(mail.sent.filter((m: any) => m.kind === 'certificado').length, 1);
  assert.ok(code);

  const v = await svc.verifyCertificate(cert.code.toLowerCase());
  assert.deepEqual([v.valid, v.name, v.courseTitle, v.hours, v.courseSlug], [true, 'Ana Pérez', 'On-grid básico', 4.5, 'on-grid']);
  const pdf = await svc.certificatePdf(cert.code);
  assert.equal(Buffer.from(pdf.bytes.slice(0, 5)).toString(), '%PDF-');
  await assert.rejects(svc.verifyCertificate('CERT-XXXX'), /no encontrado/);
  db.t.certificates[0].revokedAt = new Date();
  assert.equal((await svc.verifyCertificate(cert.code)).valid, false);
  await assert.rejects(svc.certificatePdf(cert.code), /revocado/);
  await assert.rejects(svc.issueCertificate(ana, 'on-grid', 'Ana Pérez'), /revocado/);

  const mine = await svc.myCourses(7);
  assert.equal(mine[0].progressPct, 100);
  assert.equal(mine[0].certificate, null); // revocado: no se muestra
});
