export const ROLES = Object.freeze(["admin", "secretary", "teacher", "student"]);
export const MANAGER_ROLES = Object.freeze(["admin", "secretary"]);

export function resolveAccess(userId, claims) {
  const { role, workspaceId, profileId } = claims || {};
  if (!ROLES.includes(role) || typeof workspaceId !== "string" || !workspaceId) {
    throw new Error("Seu acesso ainda não foi configurado. Peça ao administrador para atribuir seu perfil.");
  }
  if (role === "admin" && workspaceId !== userId) {
    throw new Error("A conta administradora só pode gerenciar o próprio espaço de trabalho.");
  }
  if ((role === "teacher" || role === "student") && (typeof profileId !== "string" || !profileId)) {
    throw new Error("Seu perfil não está vinculado a um cadastro. Peça ao administrador para verificar seu acesso.");
  }
  return { role, workspaceId, profileId: typeof profileId === "string" ? profileId : null };
}

export function canManage(access) {
  return MANAGER_ROLES.includes(access?.role);
}

export function visibleClassQueryField(access) {
  if (access.role === "teacher") return "teacherId";
  if (access.role === "student") return "studentId";
  return null;
}

export function decorateClassForPortal(record, access, workspace) {
  if (access.role === "teacher") {
    return {
      ...record,
      teacherName: workspace.teachers[0]?.name || record.teacherName || "Professor(a)",
      studentName: record.studentName || "Aluno(a)"
    };
  }
  if (access.role === "student") {
    return {
      ...record,
      studentName: workspace.students[0]?.name || "Aluno(a)",
      teacherName: record.teacherName || "Professor(a)"
    };
  }
  return record;
}
