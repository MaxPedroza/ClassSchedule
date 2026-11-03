# ClassSchedule

Painel secretarial responsivo para organizar alunos, professores, planos e aulas.

## Executar

Abra `index.html` em um navegador moderno ou sirva a pasta por um servidor estático, por exemplo:

```powershell
python -m http.server 8000
```

Depois, acesse `http://localhost:8000`.

## Recursos

- Cadastro, edição, busca e exclusão de alunos e professores.
- Acompanhamento do período dos planos e aviso de vencimentos nos próximos 30 dias.
- Agenda de aulas com validação contra sobreposição para o mesmo aluno ou professor.
- Atalhos de contato pelo WhatsApp e links para adicionar aulas ao Google Calendar.
- Exportação de backup dos dados em JSON.
- Layout responsivo para desktop e dispositivos móveis.

## Armazenamento

Esta primeira versão não tem configuração ou integração Firebase. Os dados ficam no `localStorage` do navegador e não são sincronizados entre dispositivos nem compartilhados com outros usuários. Exporte backups regularmente; limpar os dados do navegador pode removê-los.
