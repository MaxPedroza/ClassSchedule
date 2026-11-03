import test from "node:test";
import assert from "node:assert/strict";
import { findClassConflict, validateClass, validateStudentPlan } from "./scheduling.js";

const existing = [
  { id: "first", date: "2026-11-10", start: "09:00", end: "10:00", studentId: "ana", teacherId: "bruno" }
];

test("accepts a plan that ends on or after its start date", () => {
  assert.equal(validateStudentPlan({ startDate: "2026-11-02", endDate: "2026-11-02" }), null);
  assert.equal(validateStudentPlan({ startDate: "2026-11-02", endDate: "2026-12-02" }), null);
});

test("rejects a plan that ends before it starts", () => {
  assert.match(validateStudentPlan({ startDate: "2026-11-03", endDate: "2026-11-02" }), /posterior ao início/);
});

test("detects overlapping classes for the same teacher or student", () => {
  const sharedTeacher = { date: "2026-11-10", start: "09:30", end: "10:30", studentId: "bia", teacherId: "bruno" };
  const sharedStudent = { ...sharedTeacher, studentId: "ana", teacherId: "carla" };
  assert.equal(findClassConflict(existing, sharedTeacher)?.id, "first");
  assert.equal(findClassConflict(existing, sharedStudent)?.id, "first");
});

test("allows adjacent classes, other dates, and editing the same class", () => {
  assert.equal(findClassConflict(existing, { date: "2026-11-10", start: "10:00", end: "11:00", studentId: "ana", teacherId: "bruno" }), null);
  assert.equal(findClassConflict(existing, { date: "2026-11-11", start: "09:00", end: "10:00", studentId: "ana", teacherId: "bruno" }), null);
  assert.equal(findClassConflict(existing, existing[0], "first"), null);
});

test("validates the class time range before checking conflicts", () => {
  assert.match(validateClass({ ...existing[0], start: "10:00" }, existing).error, /posterior ao início/);
  assert.equal(validateClass({ ...existing[0], start: "10:00", end: "11:00" }, existing).error, null);
});
