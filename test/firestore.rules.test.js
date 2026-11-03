import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

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

test("authenticated users can only access their own workspace records", async () => {
  const owner = environment.authenticatedContext("secretary-a").firestore();
  const otherUser = environment.authenticatedContext("secretary-b").firestore();
  const ownStudent = doc(owner, "users/secretary-a/students/alice");
  const ownScheduleLock = doc(owner, "users/secretary-a/scheduleDays/2026-11-10");
  await assertSucceeds(setDoc(ownStudent, { name: "Ana" }));
  await assertSucceeds(getDoc(ownStudent));
  await assertSucceeds(setDoc(ownScheduleLock, { revision: 1 }));
  await assertFails(getDoc(doc(otherUser, "users/secretary-a/students/alice")));
  await assertFails(setDoc(doc(otherUser, "users/secretary-a/students/mallory"), { name: "Mallory" }));
  await assertFails(getDoc(doc(otherUser, "users/secretary-a/scheduleDays/2026-11-10")));
});

test("unauthenticated users and unsupported collections are denied", async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const owner = environment.authenticatedContext("secretary-a").firestore();
  await assertFails(getDoc(doc(anonymous, "users/secretary-a/students/alice")));
  await assertFails(setDoc(doc(owner, "users/secretary-a/private/secret"), { value: true }));
});
