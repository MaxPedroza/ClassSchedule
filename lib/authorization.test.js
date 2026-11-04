import test from "node:test";
import assert from "node:assert/strict";
import { canManage, decorateClassForPortal, resolveAccess, visibleClassQueryField } from "./authorization.js";

test("requires trusted role and workspace claims and prevents cross-workspace admins", () => {
  assert.throws(() => resolveAccess("admin-a", {}), /não foi configurado/);
  assert.throws(() => resolveAccess("admin-a", { role: "admin", workspaceId: "admin-b" }), /próprio espaço/);
  assert.throws(() => resolveAccess("teacher-a", { role: "teacher", workspaceId: "school-a" }), /não está vinculado/);
  assert.equal(resolveAccess("admin-a", { role: "admin", workspaceId: "admin-a" }).role, "admin");
});

test("only administrators and secretaries can manage workspace records", () => {
  assert.equal(canManage({ role: "admin" }), true);
  assert.equal(canManage({ role: "secretary" }), true);
  assert.equal(canManage({ role: "teacher" }), false);
  assert.equal(canManage({ role: "student" }), false);
});

test("teacher and student portals query only their own class assignments", () => {
  assert.equal(visibleClassQueryField({ role: "teacher" }), "teacherId");
  assert.equal(visibleClassQueryField({ role: "student" }), "studentId");
  assert.equal(visibleClassQueryField({ role: "secretary" }), null);
});

test("teacher and student class snapshots reveal names, not unrelated profiles", () => {
  const record = {
    id: "class-a",
    studentId: "student-a",
    teacherId: "teacher-a",
    studentName: "Ana",
    teacherName: "Bruno"
  };
  const teacher = decorateClassForPortal(record, { role: "teacher" }, {
    teachers: [{ id: "teacher-a", name: "Bruno", email: "private@example.test" }]
  });
  const student = decorateClassForPortal(record, { role: "student" }, {
    students: [{ id: "student-a", name: "Ana", email: "private@example.test" }]
  });
  assert.deepEqual({ studentName: teacher.studentName, teacherName: teacher.teacherName }, { studentName: "Ana", teacherName: "Bruno" });
  assert.deepEqual({ studentName: student.studentName, teacherName: student.teacherName }, { studentName: "Ana", teacherName: "Bruno" });
});
