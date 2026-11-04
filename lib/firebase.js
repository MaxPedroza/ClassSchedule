import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { canManage, decorateClassForPortal, resolveAccess, visibleClassQueryField } from "./authorization.js";
import { findClassConflict } from "./scheduling.js";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const requiredConfig = ["apiKey", "authDomain", "projectId", "appId"];
export const firebaseConfigured = requiredConfig.every((key) => Boolean(config[key]));
const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";

let auth;
let db;
if (firebaseConfigured) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}

const COLLECTIONS = ["students", "teachers", "classes"];
const LEGACY_KEY = "classschedule.data.v1";
const MIGRATION_KEY = "classschedule.firebase-migration.v1";

function userCollection(userId, collectionName) {
  if (!COLLECTIONS.includes(collectionName)) throw new Error("Coleção de dados inválida.");
  return collection(db, "users", userId, collectionName);
}

async function readCollection(userId, collectionName) {
  const snapshot = await getDocs(userCollection(userId, collectionName));
  return snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
}

async function readWorkspace(userId) {
  const [students, teachers, classes] = await Promise.all(
    COLLECTIONS.map((collectionName) => readCollection(userId, collectionName))
  );
  return { students, teachers, classes };
}

async function migrateLegacyData(userId) {
  const migrationKey = `${MIGRATION_KEY}.${userId}`;
  if (localStorage.getItem(migrationKey)) return;
  const existing = await readWorkspace(userId);
  if (COLLECTIONS.some((key) => existing[key].length > 0)) {
    localStorage.setItem(migrationKey, "done");
    return;
  }

  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    localStorage.setItem(migrationKey, "done");
    return;
  }
  const legacy = JSON.parse(raw);
  if (!legacy || COLLECTIONS.some((key) => !Array.isArray(legacy[key]))) {
    throw new Error("Os dados locais antigos estão inválidos; exporte-os antes de continuar.");
  }

  const writes = COLLECTIONS.flatMap((collectionName) => legacy[collectionName].map((record) => {
    const recordId = typeof record.id === "string" && record.id ? record.id : crypto.randomUUID();
    return { ref: doc(userCollection(userId, collectionName), recordId), data: { ...record, id: recordId } };
  }));
  for (let offset = 0; offset < writes.length; offset += 450) {
    const batch = writeBatch(db);
    for (const write of writes.slice(offset, offset + 450)) batch.set(write.ref, write.data);
    await batch.commit();
  }
  localStorage.setItem(migrationKey, "done");
}

export function watchAuth(callback) {
  if (!firebaseConfigured) return () => {};
  return onAuthStateChanged(auth, callback);
}

export function signIn(email, password) {
  if (!firebaseConfigured) throw new Error("Firebase ainda não está configurado.");
  return signInWithEmailAndPassword(auth, email, password);
}

export function signUp(email, password) {
  if (!firebaseConfigured) throw new Error("Firebase ainda não está configurado.");
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  if (!firebaseConfigured) throw new Error("Firebase ainda não está configurado.");
  return signOut(auth);
}

async function readRoleWorkspace(userId, access) {
  const isTeacher = access.role === "teacher";
  const profileCollection = isTeacher ? "teachers" : "students";
  const filterField = visibleClassQueryField(access);
  const profileSnapshot = await getDoc(doc(userCollection(userId, profileCollection), access.profileId));
  if (!profileSnapshot.exists()) {
    throw new Error("Seu perfil não está vinculado a um cadastro ativo. Peça ao administrador para verificar seu acesso.");
  }

  const classesSnapshot = await getDocs(query(
    userCollection(userId, "classes"),
    where(filterField, "==", access.profileId)
  ));
  const relatedById = new Map();
  const classes = [];
  for (const snapshot of classesSnapshot.docs) {
    const item = { id: snapshot.id, ...snapshot.data() };
    const relatedId = isTeacher ? item.studentId : item.teacherId;
    if (relatedId && !relatedById.has(relatedId)) {
      const name = isTeacher ? item.studentName : item.teacherName;
      relatedById.set(relatedId, { id: relatedId, name: name || (isTeacher ? "Aluno(a)" : "Professor(a)") });
    }
    const workspace = isTeacher
      ? { students: [relatedById.get(relatedId)].filter(Boolean), teachers: [profileSnapshot.data()] }
      : { students: [profileSnapshot.data()], teachers: [relatedById.get(relatedId)].filter(Boolean) };
    classes.push(decorateClassForPortal(item, access, workspace));
  }
  return {
    students: isTeacher ? [...relatedById.values()] : [{ id: profileSnapshot.id, ...profileSnapshot.data() }],
    teachers: isTeacher ? [{ id: profileSnapshot.id, ...profileSnapshot.data() }] : [...relatedById.values()],
    classes
  };
}

export async function loadWorkspace(userId, claims) {
  const access = resolveAccess(userId, claims);
  if (canManage(access)) {
    await migrateLegacyData(access.workspaceId);
    return readWorkspace(access.workspaceId);
  }
  return readRoleWorkspace(access.workspaceId, access);
}

export function subscribeWorkspace(userId, claims, onData, onError) {
  const access = resolveAccess(userId, claims);
  const workspaceId = access.workspaceId;
  const workspace = { students: [], teachers: [], classes: [] };
  const relatedRecords = new Map();
  const ready = new Set();
  const register = (key, reference, transform = (record) => ({ id: record.id, ...record.data() })) =>
    onSnapshot(reference, (snapshot) => {
      workspace[key] = transform(snapshot);
      ready.add(key);
      if (ready.size === (canManage(access) ? COLLECTIONS.length : 2)) {
        onData({ ...workspace, classes: workspace.classes.map((record) => decorateClassForPortal(record, access, workspace)) });
      }
    }, onError);
  let unsubscribers;
  if (canManage(access)) {
    unsubscribers = COLLECTIONS.map((collectionName) =>
      register(collectionName, userCollection(workspaceId, collectionName))
    );
  } else {
    const isTeacher = access.role === "teacher";
    const profileCollection = isTeacher ? "teachers" : "students";
    const profileKey = profileCollection;
    const filterField = visibleClassQueryField(access);
    const relatedKey = isTeacher ? "students" : "teachers";
    const profileRef = doc(userCollection(workspaceId, profileCollection), access.profileId);
    const classQuery = query(userCollection(workspaceId, "classes"), where(filterField, "==", access.profileId));
    const profileUnsubscribe = register(profileKey, profileRef, (snapshot) => {
      if (!snapshot.exists()) {
        onError(new Error("Seu perfil não está vinculado a um cadastro ativo."));
        return [];
      }
      return [{ id: snapshot.id, ...snapshot.data() }];
    });
    const classesUnsubscribe = register("classes", classQuery, (snapshot) => {
      const classes = snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
      relatedRecords.clear();
      for (const item of classes) {
        const id = isTeacher ? item.studentId : item.teacherId;
        const name = isTeacher ? item.studentName : item.teacherName;
        if (id && !relatedRecords.has(id)) {
          relatedRecords.set(id, { id, name: name || (isTeacher ? "Aluno(a)" : "Professor(a)") });
        }
      }
      workspace[relatedKey] = [...relatedRecords.values()];
      return classes;
    });
    unsubscribers = [profileUnsubscribe, classesUnsubscribe];
  }
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function saveRecord(userId, collectionName, record, editingId = null) {
  const records = userCollection(userId, collectionName);
  const reference = doc(records, record.id);
  if (collectionName !== "classes") {
    await setDoc(reference, record);
    return;
  }

  const dayLock = doc(collection(db, "users", userId, "scheduleDays"), record.date);
  await runTransaction(db, async (transaction) => {
    const lockSnapshot = await transaction.get(dayLock);
    const matches = await getDocs(query(records, where("date", "==", record.date)));
    const existing = matches.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    const conflict = findClassConflict(existing, record, editingId);
    if (conflict) {
      const byTeacher = conflict.teacherId === record.teacherId;
      throw new Error(byTeacher
        ? `Conflito: o(a) professor(a) já tem uma aula das ${conflict.start} às ${conflict.end} nessa data.`
        : `Conflito: o aluno já tem uma aula das ${conflict.start} às ${conflict.end} nessa data.`);
    }
    transaction.set(dayLock, { revision: (lockSnapshot.data()?.revision || 0) + 1 });
    transaction.set(reference, record);
  });
}

export async function deleteRecord(userId, collectionName, recordId) {
  if (collectionName === "classes") {
    const reference = doc(userCollection(userId, collectionName), recordId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) return;
      const lockReference = doc(collection(db, "users", userId, "scheduleDays"), snapshot.data().date);
      const lockSnapshot = await transaction.get(lockReference);
      transaction.delete(reference);
      transaction.set(lockReference, { revision: (lockSnapshot.data()?.revision || 0) + 1 });
    });
    return;
  }

  const linkedClasses = await getDocs(query(
    userCollection(userId, "classes"),
    where(collectionName === "students" ? "studentId" : "teacherId", "==", recordId)
  ));
  const classesByDay = new Map();
  for (const snapshot of linkedClasses.docs) {
    const day = snapshot.data().date;
    if (!classesByDay.has(day)) classesByDay.set(day, []);
    classesByDay.get(day).push(snapshot.ref);
  }

  for (const [day, references] of classesByDay) {
    for (let offset = 0; offset < references.length; offset += 450) {
      const batch = writeBatch(db);
      for (const reference of references.slice(offset, offset + 450)) batch.delete(reference);
      const lockReference = doc(collection(db, "users", userId, "scheduleDays"), day);
      batch.set(lockReference, { revision: increment(1) }, { merge: true });
      await batch.commit();
    }
  }
  await deleteDoc(doc(userCollection(userId, collectionName), recordId));
}
