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

Abra o endereço local impresso pelo Vite. Crie uma conta no formulário para iniciar uma sessão. Os registros ficam em `users/{uid}/students`, `users/{uid}/teachers` e `users/{uid}/classes`; alterações são sincronizadas em tempo real nas sessões autenticadas daquela conta.

Se houver dados da versão anterior no `localStorage` e o espaço Firestore da primeira conta estiver vazio, eles são migrados uma única vez nesse navegador. A aplicação também permite baixar um backup JSON. Cada conta tem seu próprio espaço de trabalho; compartilhamento entre contas/equipe requer uma futura função de organização e convites.

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
