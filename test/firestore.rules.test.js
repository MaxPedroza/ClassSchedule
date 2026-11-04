import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-classschedule",
    firestore: {
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8")
    }
  });
});

after(async () => {
  await environment?.cleanup();
});

test("authenticated managers access only their own workspace", async () => {
  const owner = environment.authenticatedContext("secretary-a", {
    role: "secretary",
    workspaceId: "secretary-a"
  }).firestore();
  const otherUser = environment.authenticatedContext("secretary-b", {
    role: "admin",
    workspaceId: "secretary-b"
  }).firestore();
  const misconfiguredAdmin = environment.authenticatedContext("attacker", {
    role: "admin",
    workspaceId: "secretary-a"
  }).firestore();
  const ownStudent = doc(owner, "users/secretary-a/students/alice");
  await assertSucceeds(setDoc(ownStudent, { name: "Ana" }));
  await assertSucceeds(getDoc(ownStudent));
  await assertSucceeds(setDoc(doc(owner, "users/secretary-a/scheduleDays/2026-11-10"), { revision: 1 }));
  await assertFails(getDoc(doc(otherUser, "users/secretary-a/students/alice")));
  await assertFails(setDoc(doc(otherUser, "users/secretary-a/students/mallory"), { name: "Mallory" }));
  await assertFails(setDoc(doc(misconfiguredAdmin, "users/secretary-a/students/mallory"), { name: "Mallory" }));
  await assertFails(getDoc(doc(otherUser, "users/secretary-a/scheduleDays/2026-11-10")));
});

test("anonymous users and unsupported collections are denied", async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const manager = environment.authenticatedContext("secretary-a", {
    role: "admin",
    workspaceId: "secretary-a"
  }).firestore();
  await assertFails(getDoc(doc(anonymous, "users/secretary-a/students/alice")));
  await assertFails(setDoc(doc(manager, "users/secretary-a/private/secret"), { value: true }));
});

test("teachers can read only their own profile and assigned classes", async () => {
  const manager = environment.authenticatedContext("owner", {
    role: "admin",
    workspaceId: "owner"
  }).firestore();
  const teacher = environment.authenticatedContext("teacher-user", {
    role: "teacher",
    workspaceId: "owner",
    profileId: "teacher-a"
  }).firestore();
  await assertSucceeds(setDoc(doc(manager, "users/owner/teachers/teacher-a"), { name: "Bruno" }));
  await assertSucceeds(setDoc(doc(manager, "users/owner/teachers/teacher-b"), { name: "Caio" }));
  await assertSucceeds(setDoc(doc(manager, "users/owner/students/student-a"), { name: "Ana" }));
  await assertSucceeds(setDoc(doc(manager, "users/owner/classes/class-a"), {
    id: "class-a",
    date: "2026-11-10",
    start: "09:00",
    end: "10:00",
    teacherId: "teacher-a",
    studentId: "student-a"
  }));
  await assertSucceeds(setDoc(doc(manager, "users/owner/classes/class-b"), {
    id: "class-b",
    date: "2026-11-10",
    start: "09:00",
    end: "10:00",
    teacherId: "teacher-b",
    studentId: "student-a"
  }));

  await assertSucceeds(getDoc(doc(teacher, "users/owner/teachers/teacher-a")));
  await assertSucceeds(getDocs(query(
    collection(teacher, "users/owner/classes"),
    where("teacherId", "==", "teacher-a")
  )));
  await assertFails(getDocs(collection(teacher, "users/owner/classes")));
  await assertFails(getDoc(doc(teacher, "users/owner/teachers/teacher-b")));
  await assertFails(getDoc(doc(teacher, "users/owner/students/student-a")));
  await assertSucceeds(getDoc(doc(teacher, "users/owner/classes/class-a")));
  await assertFails(getDoc(doc(teacher, "users/owner/classes/class-b")));
  await assertFails(setDoc(doc(teacher, "users/owner/classes/unauthorized"), {
    id: "unauthorized",
    date: "2026-11-11",
    start: "09:00",
    end: "10:00",
    teacherId: "teacher-a",
    studentId: "student-a"
  }));
  await assertFails(getDoc(doc(teacher, "users/other/classes/class-a")));
});

test("students can read only their own profile and assigned classes", async () => {
  const manager = environment.authenticatedContext("owner", {
    role: "secretary",
    workspaceId: "owner"
  }).firestore();
  const student = environment.authenticatedContext("student-user", {
    role: "student",
    workspaceId: "owner",
    profileId: "student-a"
  }).firestore();
  await assertSucceeds(setDoc(doc(manager, "users/owner/students/student-a"), { name: "Ana" }));
  await assertSucceeds(setDoc(doc(manager, "users/owner/students/student-b"), { name: "Bia" }));
  await assertSucceeds(setDoc(doc(manager, "users/owner/classes/class-a"), {
    id: "class-a",
    date: "2026-11-10",
    start: "09:00",
    end: "10:00",
    teacherId: "teacher-a",
    studentId: "student-a"
  }));
  await assertSucceeds(setDoc(doc(manager, "users/owner/classes/class-b"), {
    id: "class-b",
    date: "2026-11-10",
    start: "09:00",
    end: "10:00",
    teacherId: "teacher-a",
    studentId: "student-b"
  }));

  await assertSucceeds(getDoc(doc(student, "users/owner/students/student-a")));
  await assertFails(getDoc(doc(student, "users/owner/students/student-b")));
  await assertSucceeds(getDoc(doc(student, "users/owner/classes/class-a")));
  await assertFails(getDoc(doc(student, "users/owner/classes/class-b")));
  await assertSucceeds(getDocs(query(
    collection(student, "users/owner/classes"),
    where("studentId", "==", "student-a")
  )));
  await assertFails(getDocs(collection(student, "users/owner/classes")));
  await assertFails(getDoc(doc(student, "users/owner/teachers/teacher-a")));
  await assertFails(getDoc(doc(student, "users/owner/scheduleDays/2026-11-10")));
});

test("all class writes require a valid class document", async () => {
  const manager = environment.authenticatedContext("owner", {
    role: "admin",
    workspaceId: "owner"
  }).firestore();
  await assertFails(setDoc(doc(manager, "users/owner/classes/bad-id"), {
    id: "different-id",
    date: "tomorrow",
    start: "99:90",
    end: "09:00",
    teacherId: 7,
    studentId: null
  }));
});
