import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [email, role, workspaceId, profileId] = process.argv.slice(2);
const allowedRoles = new Set(["admin", "secretary", "teacher", "student"]);
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;

if (!email || !allowedRoles.has(role) || !projectId) {
  console.error("Uso: npm run set:role -- <email> <admin|secretary|teacher|student> [workspace-id] [profile-id]");
  console.error("Configure GOOGLE_CLOUD_PROJECT e credenciais ADC com permissão administrativa.");
  process.exitCode = 1;
} else {
  const app = initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);

  try {
    const user = await auth.getUserByEmail(email);
    const targetWorkspace = role === "admin" ? user.uid : workspaceId;
    if (!targetWorkspace) throw new Error("Informe o UID do espaço de trabalho para esta função.");
    if (role === "admin" && workspaceId) throw new Error("A função admin sempre administra o próprio espaço.");
    await auth.getUser(targetWorkspace);

    if (role === "teacher" || role === "student") {
      if (!profileId) throw new Error("Informe o ID do cadastro de professor ou aluno.");
      const collection = role === "teacher" ? "teachers" : "students";
      const record = await db.doc(`users/${targetWorkspace}/${collection}/${profileId}`).get();
      if (!record.exists) throw new Error(`O cadastro ${collection}/${profileId} não existe no espaço informado.`);
    } else if (profileId) {
      throw new Error("Somente perfis de professor e aluno aceitam um ID de cadastro.");
    }

    const existing = user.customClaims || {};
    const claims = { ...existing };
    for (const key of ["role", "workspaceId", "profileId"]) delete claims[key];
    Object.assign(claims, { role, workspaceId: targetWorkspace });
    if (profileId) claims.profileId = profileId;
    await auth.setCustomUserClaims(user.uid, claims);
    console.log(`Perfil ${role} atribuído a ${email} no espaço ${targetWorkspace}. Saia e entre novamente para carregar as permissões.`);
  } catch (error) {
    console.error(`Não foi possível atribuir o perfil: ${error.message}`);
    process.exitCode = 1;
  }
}
