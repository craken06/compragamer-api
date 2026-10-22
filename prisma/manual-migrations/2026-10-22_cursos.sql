-- Cursos (Auryx Academia): tablas, enums, índices y claves foráneas (idempotente).
-- Coincide con prisma/schema.prisma (Course, CourseModule, Lesson, LessonResource, QuizQuestion, Enrollment,
-- LessonProgress, QuizAttempt, AssignmentSubmission, Certificate). Generado con prisma migrate diff y
-- adaptado para poder correrse más de una vez. Se aplica con: node scripts/migrate.js --apply
-- Solo crea tablas nuevas: no toca ninguna existente.

DO $$ BEGIN
  CREATE TYPE "course_status_enum" AS ENUM ('borrador', 'publicado', 'archivado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "course_level_enum" AS ENUM ('inicial', 'intermedio', 'avanzado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "lesson_kind_enum" AS ENUM ('video', 'lectura', 'prueba', 'tarea');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "enrollment_status_enum" AS ENUM ('pendiente_pago', 'activa', 'cancelada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "submission_status_enum" AS ENUM ('entregada', 'aprobada', 'a_rehacer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "courses" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "cover_url" TEXT,
    "level" "course_level_enum" NOT NULL DEFAULT 'inicial',
    "duration_hours" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "price_ars" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "course_status_enum" NOT NULL DEFAULT 'borrador',
    "sequential" BOOLEAN NOT NULL DEFAULT false,
    "instructor_name" TEXT NOT NULL DEFAULT '',
    "instructor_bio" TEXT NOT NULL DEFAULT '',
    "instructor_photo_url" TEXT,
    "outcomes" JSONB NOT NULL DEFAULT '[]',
    "requirements" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "course_modules" (
    "id" SERIAL NOT NULL,
    "course_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lessons" (
    "id" SERIAL NOT NULL,
    "module_id" INTEGER NOT NULL,
    "kind" "lesson_kind_enum" NOT NULL DEFAULT 'video',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "video_provider" TEXT,
    "video_id" TEXT,
    "duration_min" INTEGER NOT NULL DEFAULT 0,
    "is_preview" BOOLEAN NOT NULL DEFAULT false,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "pass_pct" INTEGER NOT NULL DEFAULT 70,
    "max_attempts" INTEGER,
    "instructions" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lesson_resources" (
    "id" SERIAL NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'archivo',
    "title" TEXT NOT NULL,
    "file_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "url" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lesson_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quiz_questions" (
    "id" SERIAL NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'unica',
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "explanation" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "enrollments" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "course_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "status" "enrollment_status_enum" NOT NULL DEFAULT 'pendiente_pago',
    "price_ars" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'compra',
    "mp_preference_id" TEXT,
    "mp_payment_id" TEXT,
    "mp_status" TEXT,
    "payment_url" TEXT,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lesson_progress" (
    "enrollment_id" INTEGER NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("enrollment_id","lesson_id")
);

CREATE TABLE IF NOT EXISTS "quiz_attempts" (
    "id" SERIAL NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "score_pct" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "assignment_submissions" (
    "id" SERIAL NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "file_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "status" "submission_status_enum" NOT NULL DEFAULT 'entregada',
    "feedback" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "certificates" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "name_on_certificate" TEXT NOT NULL,
    "course_title" TEXT NOT NULL,
    "duration_hours" DECIMAL(6,1) NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" TEXT,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "courses_slug_key" ON "courses"("slug");

CREATE INDEX IF NOT EXISTS "course_modules_course_id_idx" ON "course_modules"("course_id");

CREATE INDEX IF NOT EXISTS "lessons_module_id_idx" ON "lessons"("module_id");

CREATE INDEX IF NOT EXISTS "lesson_resources_lesson_id_idx" ON "lesson_resources"("lesson_id");

CREATE INDEX IF NOT EXISTS "quiz_questions_lesson_id_idx" ON "quiz_questions"("lesson_id");

CREATE UNIQUE INDEX IF NOT EXISTS "enrollments_code_key" ON "enrollments"("code");

CREATE INDEX IF NOT EXISTS "enrollments_customer_id_idx" ON "enrollments"("customer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "enrollments_course_id_customer_id_key" ON "enrollments"("course_id", "customer_id");

CREATE INDEX IF NOT EXISTS "quiz_attempts_enrollment_id_lesson_id_idx" ON "quiz_attempts"("enrollment_id", "lesson_id");

CREATE INDEX IF NOT EXISTS "assignment_submissions_enrollment_id_lesson_id_idx" ON "assignment_submissions"("enrollment_id", "lesson_id");

CREATE INDEX IF NOT EXISTS "assignment_submissions_status_idx" ON "assignment_submissions"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "certificates_code_key" ON "certificates"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "certificates_enrollment_id_key" ON "certificates"("enrollment_id");

DO $$ BEGIN
  ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lesson_resources" ADD CONSTRAINT "lesson_resources_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
