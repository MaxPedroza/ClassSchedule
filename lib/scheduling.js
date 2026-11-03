export function validateStudentPlan(values) {
  if (!values.startDate || !values.endDate) {
    return "Informe o início e o vencimento do plano.";
  }
  if (values.endDate < values.startDate) {
    return "A data de vencimento precisa ser igual ou posterior ao início do plano.";
  }
  return null;
}

export function findClassConflict(classes, candidate, recordId = null) {
  return classes.find((item) => {
    if (item.id === recordId || item.date !== candidate.date) return false;
    const overlaps = candidate.start < item.end && candidate.end > item.start;
    return overlaps && (item.teacherId === candidate.teacherId || item.studentId === candidate.studentId);
  }) || null;
}

export function validateClass(values, classes, recordId = null) {
  if (!values.date || !values.studentId || !values.teacherId || !values.start || !values.end) {
    return { error: "Preencha os campos obrigatórios da aula.", conflict: null };
  }
  if (values.start >= values.end) {
    return { error: "O horário de término precisa ser posterior ao início.", conflict: null };
  }
  const conflict = findClassConflict(classes, values, recordId);
  if (!conflict) return { error: null, conflict: null };
  const error = conflict.teacherId === values.teacherId
    ? `Conflito: o(a) professor(a) já tem uma aula das ${conflict.start} às ${conflict.end} nessa data.`
    : `Conflito: o aluno já tem uma aula das ${conflict.start} às ${conflict.end} nessa data.`;
  return { error, conflict };
}
