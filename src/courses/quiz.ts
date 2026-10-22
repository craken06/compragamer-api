import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';

/*
 * Pruebas: normalización de preguntas (admin) y corrección (alumno). Funciones puras.
 * Las respuestas correctas viven solo en el servidor: publicQuestion() las saca antes de mandar.
 */

export type QuestionKind = 'unica' | 'multiple' | 'vf';
export const QUESTION_KINDS: QuestionKind[] = ['unica', 'multiple', 'vf'];

export interface QuizOption { id: string; text: string; correct: boolean }
export interface QuestionData { kind: QuestionKind; prompt: string; options: QuizOption[]; explanation: string }
export interface GradableQuestion { id: number; kind: string; options: unknown }

const OPTION_ID_RE = /^[a-z0-9]{1,12}$/;
const newOptionId = () => randomBytes(4).toString('hex');

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** Valida y limpia una pregunta que manda el admin. Lanza 400 con el motivo. */
export function normalizeQuestion(input: any): QuestionData {
  const kind = input?.kind as QuestionKind;
  if (!QUESTION_KINDS.includes(kind)) throw new BadRequestException('Tipo de pregunta inválido (unica, multiple o vf).');
  const prompt = str(input?.prompt, 2000);
  if (!prompt) throw new BadRequestException('Falta el enunciado de la pregunta.');
  const explanation = str(input?.explanation, 2000);
  const raw = Array.isArray(input?.options) ? input.options : [];

  let options: QuizOption[];
  if (kind === 'vf') {
    // verdadero/falso: dos opciones fijas, el admin solo marca cuál es la correcta
    const trueIsCorrect = raw.find((o: any) => o?.id === 'v')?.correct === true || input?.answer === true;
    const falseIsCorrect = raw.find((o: any) => o?.id === 'f')?.correct === true || input?.answer === false;
    if (trueIsCorrect === falseIsCorrect) throw new BadRequestException('Marcá si la respuesta correcta es Verdadero o Falso.');
    options = [{ id: 'v', text: 'Verdadero', correct: trueIsCorrect }, { id: 'f', text: 'Falso', correct: falseIsCorrect }];
  } else {
    if (raw.length < 2 || raw.length > 10) throw new BadRequestException('La pregunta tiene que tener entre 2 y 10 opciones.');
    const seen = new Set<string>();
    options = raw.map((o: any) => {
      const text = str(o?.text, 500);
      if (!text) throw new BadRequestException('Hay una opción vacía.');
      let id = typeof o?.id === 'string' && OPTION_ID_RE.test(o.id) && !seen.has(o.id) ? o.id : newOptionId();
      while (seen.has(id)) id = newOptionId();
      seen.add(id);
      return { id, text, correct: o?.correct === true };
    });
    const correct = options.filter((o) => o.correct).length;
    if (kind === 'unica' && correct !== 1) throw new BadRequestException('Una pregunta de opción única tiene que tener exactamente una opción correcta.');
    if (kind === 'multiple' && correct < 1) throw new BadRequestException('Marcá al menos una opción correcta.');
  }
  return { kind, prompt, options, explanation };
}

const optionsOf = (q: GradableQuestion): QuizOption[] => (Array.isArray(q.options) ? (q.options as QuizOption[]) : []);

/** Pregunta como la ve el alumno: sin `correct` ni explicación. */
export function publicQuestion(q: GradableQuestion & { prompt: string }) {
  return { id: q.id, kind: q.kind, prompt: q.prompt, options: optionsOf(q).map((o) => ({ id: o.id, text: o.text })) };
}

/**
 * Corrige: única y VF = una sola opción y la correcta; múltiple = exactamente el conjunto de correctas.
 * `answers` = { [questionId]: [optionId, ...] }. Devuelve el porcentaje (redondeado) y las preguntas mal.
 */
export function gradeQuiz(questions: GradableQuestion[], answers: unknown) {
  if (!questions.length) throw new BadRequestException('La prueba todavía no tiene preguntas.');
  const given = answers && typeof answers === 'object' && !Array.isArray(answers) ? (answers as Record<string, unknown>) : {};
  const clean: Record<string, string[]> = {};
  const wrong: number[] = [];
  for (const q of questions) {
    const raw = given[String(q.id)];
    const picked = [...new Set((Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(String))].slice(0, 10);
    clean[String(q.id)] = picked;
    const correct = optionsOf(q).filter((o) => o.correct).map((o) => o.id).sort();
    const ok = q.kind === 'multiple'
      ? picked.length === correct.length && [...picked].sort().every((id, i) => id === correct[i])
      : picked.length === 1 && correct.length === 1 && picked[0] === correct[0];
    if (!ok) wrong.push(q.id);
  }
  const scorePct = Math.round(((questions.length - wrong.length) / questions.length) * 100);
  return { scorePct, wrong, answers: clean };
}
