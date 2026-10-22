/*
 * Avance del alumno: funciones puras sobre el temario ya ordenado.
 *  - Una lección está completa si tiene fila en lesson_progress (video/lectura: el alumno la marca;
 *    prueba: al aprobarla; tarea: cuando el admin la aprueba).
 *  - Con orden obligatorio (`sequential`), una lección se abre cuando todas las obligatorias anteriores
 *    están completas (las opcionales no frenan).
 *  - El certificado sale con todas las obligatorias completas.
 */

export interface TreeLesson { id: number; isOptional: boolean }
export interface TreeModule<L extends TreeLesson = TreeLesson> { lessons: L[] }

export function flattenLessons<L extends TreeLesson>(modules: TreeModule<L>[]): L[] {
  return modules.flatMap((m) => m.lessons ?? []);
}

/** id → bloqueada. Sin orden obligatorio no se bloquea nada. */
export function lockedLessons(lessons: TreeLesson[], completed: Set<number>, sequential: boolean): Set<number> {
  const locked = new Set<number>();
  if (!sequential) return locked;
  let blocked = false;
  for (const l of lessons) {
    if (blocked) locked.add(l.id);
    if (!l.isOptional && !completed.has(l.id)) blocked = true;
  }
  return locked;
}

/** Porcentaje de obligatorias completas (0 a 100, entero). Sin obligatorias = 0. */
export function progressPct(lessons: TreeLesson[], completed: Set<number>): number {
  const required = lessons.filter((l) => !l.isOptional);
  if (!required.length) return 0;
  return Math.floor((required.filter((l) => completed.has(l.id)).length / required.length) * 100);
}

export function canCertify(lessons: TreeLesson[], completed: Set<number>): boolean {
  const required = lessons.filter((l) => !l.isOptional);
  return required.length > 0 && required.every((l) => completed.has(l.id));
}

/** Anterior y siguiente en el orden del temario (para los botones del aula). */
export function neighbors(lessons: TreeLesson[], id: number) {
  const i = lessons.findIndex((l) => l.id === id);
  return { prevId: i > 0 ? lessons[i - 1].id : null, nextId: i >= 0 && i < lessons.length - 1 ? lessons[i + 1].id : null };
}
