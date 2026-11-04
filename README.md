# ClassSchedule

Painel secretarial para administrar alunos, professores, planos e aulas. A autenticação e os dados compartilhados entre dispositivos usam Firebase Authentication e Cloud Firestore; a publicação está preparada para Firebase Hosting.

## Configuração do Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/) e cadastre um aplicativo Web.
2. Em **Authentication → Sign-in method**, habilite **E-mail/senha**.
3. Crie o banco **Cloud Firestore**. As regras do repositório restringem cada usuário autenticado ao próprio espaço de trabalho.
4. Copie `.env.example` para `.env.local` e preencha as seis variáveis com a configuração do aplicativo Web. A configuração web do Firebase identifica o projeto; as regras do Firestore e o Firebase Authentication protegem os dados.

## Desenvolvimento

```powershell
npm install
npm run dev
```

Abra o endereço local impresso pelo Vite. Crie uma conta no formulário e peça a um operador para atribuir o papel inicial antes de começar a usar. Os registros ficam em `users/{workspaceId}/students`, `users/{workspaceId}/teachers` e `users/{workspaceId}/classes`; alterações são sincronizadas em tempo real nas sessões autorizadas daquele espaço.

Se houver dados da versão anterior no `localStorage` e o espaço Firestore da primeira conta gestora estiver vazio, eles são migrados uma única vez nesse navegador para o espaço dessa conta. A aplicação também permite baixar um backup JSON. As claims de secretaria, professor e aluno vinculam as contas ao espaço de trabalho da conta administradora.

## Papéis e permissões

Os papéis são custom claims de Firebase Authentication: `admin`, `secretary`, `teacher` e `student`. Não há seletor de papel no formulário público — isso impediria que alguém se promovesse a administrador. O administrador inicial e os perfis vinculados são provisionados por um operador confiável, usando Firebase Admin SDK e credenciais ADC com acesso administrativo ao projeto.

1. Crie a conta da secretaria no app e obtenha o UID do Firebase Authentication.
2. Faça login administrativo na estação segura: `gcloud auth application-default login` e defina `GOOGLE_CLOUD_PROJECT` com o ID real do projeto.
3. Atribua o papel inicial: `npm run set:role -- secretaria@exemplo.com admin`.
4. Cadastre professores e alunos pela conta administrativa e vincule os logins: `npm run set:role -- professor@exemplo.com teacher <uid-da-secretaria> <id-do-professor>`; para alunos, use `student` e o ID do cadastro do aluno.
5. Para outra pessoa da secretaria, use `secretary` e o UID do espaço de trabalho.

O comando exige que a conta de destino, o espaço de trabalho e o cadastro vinculado existam. Requer permissão IAM apropriada para alterar custom claims e consultar Firestore; nunca use uma chave de service account no browser nem a versiona. Após atribuir claims, saia e entre novamente para atualizar o token.

Administradores e secretarias podem gerenciar todos os cadastros no próprio espaço. Professores só veem seu perfil e aulas atribuídas; alunos só veem seu cadastro e suas aulas. Os nomes de participantes nas aulas são snapshots, sem liberar o acesso ao cadastro completo de outros alunos ou professores. Papéis são autorizados pelas regras do Firestore, não só pela interface.

## Testes e build

```powershell
npm test
npm run build
```

Os testes das regras de segurança do Firestore usam o Emulator Suite:

```powershell
npm run test:rules
```

Este comando precisa do Java para iniciar o emulador.

## Publicação

Instale as dependências, configure `.env.local`, autentique a Firebase CLI e selecione o projeto:

```powershell
npx firebase-tools login
npx firebase-tools use --add
npm run deploy
```

O deploy compila o site, publica em Firebase Hosting e envia `firestore.rules`. O arquivo `.firebaserc` criado pela seleção do projeto e `.env.local` são locais e ignorados pelo Git. É necessário selecionar um projeto Firebase real com Authentication e Firestore habilitados; não coloque chaves de service account no navegador ou no repositório.
