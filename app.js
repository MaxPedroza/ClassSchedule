import { deleteRecord as deleteCloudRecord, firebaseConfigured, loadWorkspace, saveRecord, signIn, signOutUser, signUp, subscribeWorkspace, watchAuth } from "./lib/firebase.js";
import { canManage, resolveAccess } from "./lib/authorization.js";
import { validateClass, validateStudentPlan } from "./lib/scheduling.js";

(() => {
  "use strict";

  const page = document.getElementById("page-content");
  const dialog = document.getElementById("record-dialog");
  const form = document.getElementById("record-form");
  const fields = document.getElementById("dialog-fields");
  const errorBox = document.getElementById("form-error");
  const sectionTitles = { inicio: "Visão geral", alunos: "Alunos", professores: "Professores", agenda: "Agenda" };
  let state = { students: [], teachers: [], classes: [] };
  let currentUser = null;
  let currentAccess = null;
  let unsubscribeWorkspace = null;
  let activePage = "inicio";
  let searchTerm = "";
  let formContext = null;

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function id() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function dateValue(value) {
    return value ? new Date(`${value}T00:00:00`) : null;
  }

  function todayKey() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }

  function dateLabel(value, options = { day: "2-digit", month: "short", year: "numeric" }) {
    const date = dateValue(value);
    return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("pt-BR", options).format(date) : "—";
  }

  function dayDifference(value) {
    const date = dateValue(value);
    if (!date) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((date - today) / 86400000);
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  }

  function byId(collection, recordId) {
    return collection.find((record) => record.id === recordId);
  }

  function isManager() {
    return canManage(currentAccess);
  }

  function roleName() {
    return ({ admin: "Administrador", secretary: "Secretaria", teacher: "Professor(a)", student: "Aluno(a)" })[currentAccess?.role] || "Conta";
  }

  function notify(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    if (isError) {
      toast.style.borderColor = "#f3d9dc";
      toast.style.color = "#b53c49";
    }
    document.getElementById("toast-region").append(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  function whatsappLink(phone, message) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return digits.length >= 10 ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : "";
  }

  function calendarLink(item, student, teacher) {
    const start = `${item.date.replaceAll("-", "")}T${item.start.replace(":", "")}00`;
    const end = `${item.date.replaceAll("-", "")}T${item.end.replace(":", "")}00`;
    const title = item.title || "Aula";
    const details = `Aluno: ${student?.name || "—"}\nProfessor(a): ${teacher?.name || "—"}${item.notes ? `\nObservações: ${item.notes}` : ""}`;
    const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${start}/${end}`, details });
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  function classDateTime(item) {
    return `${dateLabel(item.date, { day: "2-digit", month: "short" })} · ${item.start}–${item.end}`;
  }

  function upcomingClasses(limit = 6) {
    const today = todayKey();
    return [...state.classes].filter((item) => item.date >= today)
      .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`)).slice(0, limit);
  }

  function classRow(item) {
    const student = byId(state.students, item.studentId);
    const teacher = byId(state.teachers, item.teacherId);
    const studentName = student?.name || item.studentName || "Aluno(a)";
    const teacherName = teacher?.name || item.teacherName || "Professor(a)";
    const actions = isManager()
      ? `<button class="action-link" data-action="edit-class" data-id="${escapeHtml(item.id)}" aria-label="Editar aula">✎</button><button class="action-link button-danger" data-action="delete-class" data-id="${escapeHtml(item.id)}" aria-label="Excluir aula">×</button>`
      : "";
    return `<tr>
      <td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials(studentName))}</span><span><span class="person-name">${escapeHtml(studentName)}</span><span class="person-sub">${escapeHtml(item.title || "Aula")}</span></span></div></td>
      <td>${escapeHtml(teacherName)}</td>
      <td>${escapeHtml(classDateTime(item))}</td>
      <td><div class="action-row"><a class="action-link" href="${escapeHtml(calendarLink(item, { name: studentName }, { name: teacherName }))}" target="_blank" rel="noopener noreferrer" aria-label="Adicionar ao Google Calendar">＋</a>${actions}</div></td>
    </tr>`;
  }

  function emptyState(title, message, action = "") {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}${action}</div>`;
  }

  function renderDashboard() {
    const manager = isManager();
    const studentView = currentAccess?.role === "student";
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const classesThisMonth = state.classes.filter((item) => {
      const date = dateValue(item.date);
      return date && date >= monthStart && date < nextMonthStart;
    }).length;
    const expiring = (manager || studentView ? state.students : []).map((student) => ({ student, days: dayDifference(student.endDate) }))
      .filter(({ days }) => days !== null && days >= 0 && days <= 30)
      .sort((a, b) => a.days - b.days);
    const upcoming = upcomingClasses();

    page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">SEU DIA, MAIS ORGANIZADO</p><h1>${manager ? "Visão geral" : "Meu espaço"}</h1><p>${manager ? "Acompanhe alunos, equipe e aulas em um só lugar." : "Consulte seu perfil e os compromissos da sua agenda."}</p></div>${manager ? `<button class="button button-primary" data-action="new-class">＋ Agendar aula</button>` : ""}</div>
      <section class="stats-grid" aria-label="Resumo">
        <article class="stat-card"><div><span class="stat-label">${manager ? "Alunos cadastrados" : studentView ? "Meu cadastro" : "Alunos nas minhas aulas"}</span><strong class="stat-value">${state.students.length}</strong><span class="stat-note">${manager || studentView ? "com planos registrados" : "alunos vinculados"}</span></div><span class="stat-icon">♙</span></article>
        <article class="stat-card"><div><span class="stat-label">${manager ? "Professores" : studentView ? "Professores das minhas aulas" : "Meu cadastro"}</span><strong class="stat-value">${state.teachers.length}</strong><span class="stat-note">${manager ? "na sua equipe" : "perfis vinculados"}</span></div><span class="stat-icon green">♧</span></article>
        <article class="stat-card"><div><span class="stat-label">Aulas neste mês</span><strong class="stat-value">${classesThisMonth}</strong><span class="stat-note">na agenda</span></div><span class="stat-icon blue">▦</span></article>
        <article class="stat-card"><div><span class="stat-label">Planos a vencer</span><strong class="stat-value">${expiring.length}</strong><span class="stat-note">nos próximos 30 dias</span></div><span class="stat-icon orange">◷</span></article>
      </section>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-heading"><div><h2>${manager ? "Planos próximos do vencimento" : "Meu plano"}</h2><p>${manager ? "Alunos com expiração nos próximos 30 dias" : "Detalhes do seu cadastro e vencimento"}</p></div>${manager ? `<button class="text-link" data-page="alunos">Ver alunos →</button>` : ""}</div>
          ${expiring.length ? `<div class="table-wrap"><table><thead><tr><th>ALUNO</th><th>PLANO</th><th>VENCIMENTO</th>${manager ? "<th>CONTATO</th>" : ""}</tr></thead><tbody>${expiring.slice(0, 6).map(({ student, days }) => `<tr><td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials(student.name))}</span><span><span class="person-name">${escapeHtml(student.name)}</span><span class="person-sub">${escapeHtml(manager ? student.email || "Sem e-mail" : "Meu plano")}</span></span></div></td><td>${escapeHtml(student.plan || "—")}</td><td><span class="badge ${days <= 7 ? "warning" : "neutral"}">${days === 0 ? "Hoje" : `${days} dia${days === 1 ? "" : "s"}`}</span><div class="person-sub">${escapeHtml(dateLabel(student.endDate))}</div></td>${manager ? `<td>${whatsappLink(student.phone, `Olá, ${student.name}! Seu plano ${student.plan || ""} está próximo do vencimento.`) ? `<a class="action-link whatsapp" href="${escapeHtml(whatsappLink(student.phone, `Olá, ${student.name}! Seu plano ${student.plan || ""} está próximo do vencimento.`))}" target="_blank" rel="noopener noreferrer" aria-label="Conversar com ${escapeHtml(student.name)} pelo WhatsApp">WA</a>` : `<span class="person-sub">Sem telefone</span>`}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : emptyState(manager ? "Tudo em dia" : studentView ? "Sem vencimento próximo" : "Acesso de secretaria", manager ? "Nenhum plano vence nos próximos 30 dias." : studentView ? "Seu plano não vence nos próximos 30 dias." : "Acompanhe suas aulas no painel da agenda.", manager ? `<button class="button button-quiet button-small" data-action="new-student">Cadastrar aluno</button>` : "")}
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>${manager ? "Próximas aulas" : "Minha agenda"}</h2><p>Compromissos futuros</p></div><button class="text-link" data-page="agenda">Ver agenda →</button></div>
          ${upcoming.length ? `<div class="agenda-list">${upcoming.map((item) => { const student = byId(state.students, item.studentId); const teacher = byId(state.teachers, item.teacherId); const date = dateValue(item.date); return `<article class="agenda-item"><span class="agenda-date"><strong>${date ? date.getDate() : "—"}</strong><small>${escapeHtml(date ? new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "") : "—")}</small></span><span class="agenda-details"><strong>${escapeHtml(item.title || "Aula")} · ${escapeHtml(student?.name || item.studentName || "Aluno(a)")}</strong><span>${escapeHtml(item.start)} · ${escapeHtml(teacher?.name || item.teacherName || "Professor(a)")} · ${escapeHtml(dateLabel(item.date, { weekday: "short" }))}</span></span></article>`; }).join("")}</div>` : emptyState("Agenda livre", manager ? "Cadastre sua primeira aula para começar." : "Ainda não há aulas vinculadas ao seu perfil.", manager ? `<button class="button button-quiet button-small" data-action="new-class">Agendar aula</button>` : "")}
        </section>
      </div>`;
  }

  function renderStudents() {
    const students = state.students.filter((student) => `${student.name} ${student.email} ${student.plan}`.toLowerCase().includes(searchTerm));
    page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">CADASTROS</p><h1>Alunos</h1><p>Gerencie seus alunos, planos e datas de renovação.</p></div><button class="button button-primary" data-action="new-student">＋ Novo aluno</button></div>
      <section class="panel"><div class="panel-heading"><div><h2>${state.students.length} aluno${state.students.length === 1 ? "" : "s"}</h2><p>Vencimentos são calculados pela data final do plano.</p></div><input class="search-input" id="search-input" type="search" placeholder="Buscar aluno..." value="${escapeHtml(searchTerm)}" aria-label="Buscar aluno"></div>
      ${students.length ? `<div class="table-wrap"><table><thead><tr><th>ALUNO</th><th>PLANO</th><th>VIGÊNCIA</th><th>VENCIMENTO</th><th>CONTATO</th><th>AÇÕES</th></tr></thead><tbody>${students.map((student) => {
        const days = dayDifference(student.endDate);
        const expiring = days !== null && days >= 0 && days <= 30;
        const status = days === null ? `<span class="badge neutral">Sem data</span>` : days < 0 ? `<span class="badge neutral">Expirado</span>` : expiring ? `<span class="badge warning">${days === 0 ? "Hoje" : `${days} dias`}</span>` : `<span class="badge success">Em dia</span>`;
        const message = whatsappLink(student.phone, `Olá, ${student.name}! Como posso ajudar?`);
        return `<tr><td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials(student.name))}</span><span><span class="person-name">${escapeHtml(student.name)}</span><span class="person-sub">${escapeHtml(student.email || "Sem e-mail")}</span></span></div></td><td>${escapeHtml(student.plan || "—")}</td><td>${escapeHtml(dateLabel(student.startDate, { day: "2-digit", month: "short" }))} – ${escapeHtml(dateLabel(student.endDate, { day: "2-digit", month: "short", year: "2-digit" }))}</td><td>${status}<div class="person-sub">${escapeHtml(dateLabel(student.endDate))}</div></td><td>${message ? `<a class="action-link whatsapp" href="${escapeHtml(message)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : `<span class="person-sub">Sem telefone válido</span>`}</td><td><div class="action-row"><button class="action-link" data-action="edit-student" data-id="${escapeHtml(student.id)}" aria-label="Editar aluno">✎</button><button class="action-link button-danger" data-action="delete-student" data-id="${escapeHtml(student.id)}" aria-label="Excluir aluno">×</button></div></td></tr>`;
      }).join("")}</tbody></table></div>` : emptyState(searchTerm ? "Nenhum resultado" : "Nenhum aluno cadastrado", searchTerm ? "Tente buscar por outro nome ou plano." : "Cadastre alunos para acompanhar seus planos e renovações.", searchTerm ? "" : `<button class="button button-quiet button-small" data-action="new-student">Cadastrar primeiro aluno</button>`)}
      </section>`;
  }

  function renderTeachers() {
    const teachers = state.teachers.filter((teacher) => `${teacher.name} ${teacher.email} ${teacher.subjects}`.toLowerCase().includes(searchTerm));
    page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">CADASTROS</p><h1>Professores</h1><p>Organize sua equipe e facilite o contato.</p></div><button class="button button-primary" data-action="new-teacher">＋ Novo professor</button></div>
      <section class="panel"><div class="panel-heading"><div><h2>${state.teachers.length} professor${state.teachers.length === 1 ? "" : "es"}</h2><p>Profissionais da sua equipe.</p></div><input class="search-input" id="search-input" type="search" placeholder="Buscar professor..." value="${escapeHtml(searchTerm)}" aria-label="Buscar professor"></div>
      ${teachers.length ? `<div class="table-wrap"><table><thead><tr><th>PROFESSOR</th><th>ÁREAS</th><th>CONTATO</th><th>AULAS FUTURAS</th><th>AÇÕES</th></tr></thead><tbody>${teachers.map((teacher) => {
        const count = state.classes.filter((item) => item.teacherId === teacher.id && item.date >= todayKey()).length;
        const message = whatsappLink(teacher.phone, `Olá, ${teacher.name}!`);
        return `<tr><td><div class="person-cell"><span class="person-avatar green">${escapeHtml(initials(teacher.name))}</span><span><span class="person-name">${escapeHtml(teacher.name)}</span><span class="person-sub">${escapeHtml(teacher.email || "Sem e-mail")}</span></span></div></td><td>${escapeHtml(teacher.subjects || "—")}</td><td>${message ? `<a class="action-link whatsapp" href="${escapeHtml(message)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : `<span class="person-sub">Sem telefone</span>`}</td><td>${count}</td><td><div class="action-row"><button class="action-link" data-action="edit-teacher" data-id="${escapeHtml(teacher.id)}" aria-label="Editar professor">✎</button><button class="action-link button-danger" data-action="delete-teacher" data-id="${escapeHtml(teacher.id)}" aria-label="Excluir professor">×</button></div></td></tr>`;
      }).join("")}</tbody></table></div>` : emptyState(searchTerm ? "Nenhum resultado" : "Nenhum professor cadastrado", searchTerm ? "Tente outra busca." : "Cadastre os professores para montar sua agenda.", searchTerm ? "" : `<button class="button button-quiet button-small" data-action="new-teacher">Cadastrar professor</button>`)}
      </section>`;
  }

  function renderAgenda() {
    const upcoming = upcomingClasses(Number.MAX_SAFE_INTEGER);
    const today = todayKey();
    const thisMonth = state.classes.filter((item) => {
      const date = dateValue(item.date);
      const now = new Date();
      return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    const manager = isManager();
    page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">AULAS E COMPROMISSOS</p><h1>${manager ? "Agenda" : "Minha agenda"}</h1><p>${manager ? "Evite conflitos de horário entre alunos e professores." : "Aulas vinculadas ao seu perfil."}</p></div>${manager ? `<button class="button button-primary" data-action="new-class">＋ Agendar aula</button>` : ""}</div>
      <div class="agenda-summary"><span class="summary-chip"><strong>${upcoming.filter((item) => item.date === today).length}</strong> aula(s) hoje</span><span class="summary-chip"><strong>${upcoming.length}</strong> aula(s) futura(s)</span><span class="summary-chip"><strong>${thisMonth}</strong> neste mês</span></div>
      <section class="panel"><div class="panel-heading"><div><h2>Próximas aulas</h2><p>Inclui links para adicionar cada aula ao Google Calendar.</p></div></div>
      ${upcoming.length ? `<div class="table-wrap"><table><thead><tr><th>ALUNO</th><th>PROFESSOR</th><th>DATA E HORÁRIO</th><th>AÇÕES</th></tr></thead><tbody>${upcoming.map(classRow).join("")}</tbody></table></div>` : emptyState("Agenda livre", manager ? "Você ainda não tem aulas futuras cadastradas." : "Ainda não há aulas vinculadas ao seu perfil.", manager ? state.students.length && state.teachers.length ? `<button class="button button-quiet button-small" data-action="new-class">Agendar primeira aula</button>` : `<p class="form-hint">Cadastre ao menos um aluno e um professor antes de agendar.</p>` : "")}
      </section>
      ${state.classes.some((item) => item.date < today) ? `<section class="panel section-panel"><div class="panel-heading"><div><h2>Aulas anteriores</h2><p>Histórico de compromissos passados.</p></div></div><div class="table-wrap"><table><thead><tr><th>ALUNO</th><th>PROFESSOR</th><th>DATA E HORÁRIO</th><th>AÇÕES</th></tr></thead><tbody>${state.classes.filter((item) => item.date < today).sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`)).map(classRow).join("")}</tbody></table></div></section>` : ""}`;
  }

  function render() {
    const manager = isManager();
    if (!manager && ["alunos", "professores"].includes(activePage)) activePage = "inicio";
    document.querySelectorAll('.nav-link[data-role="manager"]').forEach((link) => { link.hidden = !manager; });
    document.getElementById("role-label").textContent = roleName();
    document.getElementById("workspace-label").textContent = `${currentAccess?.role === "admin" ? "Administrando seu espaço" : "Conta vinculada ao espaço"} · sincronizado`;
    document.getElementById("current-section").textContent = sectionTitles[activePage];
    document.querySelectorAll(".nav-link[data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === activePage));
    if (activePage === "alunos") renderStudents();
    else if (activePage === "professores") renderTeachers();
    else if (activePage === "agenda") renderAgenda();
    else renderDashboard();
  }

  function field(name, label, value = "", options = {}) {
    const idAttr = `field-${name}`;
    const required = options.required ? "required" : "";
    const hint = options.hint ? `<small class="form-hint">${escapeHtml(options.hint)}</small>` : "";
    if (options.select) {
      return `<label class="form-field ${options.full ? "full" : ""}" for="${idAttr}">${escapeHtml(label)}<select class="field" id="${idAttr}" name="${escapeHtml(name)}" ${required}><option value="">Selecione</option>${options.select.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>${hint}</label>`;
    }
    if (options.textarea) {
      return `<label class="form-field ${options.full ? "full" : ""}" for="${idAttr}">${escapeHtml(label)}<textarea class="field" id="${idAttr}" name="${escapeHtml(name)}" placeholder="${escapeHtml(options.placeholder || "")}">${escapeHtml(value)}</textarea>${hint}</label>`;
    }
    return `<label class="form-field ${options.full ? "full" : ""}" for="${idAttr}">${escapeHtml(label)}<input class="field" id="${idAttr}" name="${escapeHtml(name)}" type="${escapeHtml(options.type || "text")}" value="${escapeHtml(value)}" placeholder="${escapeHtml(options.placeholder || "")}" ${required} ${options.min ? `min="${escapeHtml(options.min)}"` : ""}>${hint}</label>`;
  }

  function openForm(kind, record = null) {
    if (!isManager()) {
      notify("Seu perfil pode consultar as aulas, mas não alterar os cadastros.", true);
      return;
    }
    formContext = { kind, recordId: record?.id || null };
    errorBox.textContent = "";
    const isStudent = kind === "student";
    const isTeacher = kind === "teacher";
    document.getElementById("dialog-eyebrow").textContent = isStudent ? "CADASTRO DE ALUNO" : isTeacher ? "CADASTRO DE PROFESSOR" : "AGENDA";
    document.getElementById("dialog-title").textContent = `${record ? "Editar" : "Novo"} ${isStudent ? "aluno" : isTeacher ? "professor" : "aula"}`;
    if (isStudent) {
      fields.innerHTML = field("name", "Nome completo", record?.name, { required: true, full: true, placeholder: "Ex.: Ana Silva" })
        + field("email", "E-mail", record?.email, { type: "email", placeholder: "ana@email.com" })
        + field("phone", "WhatsApp com DDD", record?.phone, { type: "tel", placeholder: "11999999999", hint: "Informe o código do país também para números internacionais." })
        + field("plan", "Plano", record?.plan, { placeholder: "Ex.: 2 aulas por semana" })
        + field("startDate", "Início do plano", record?.startDate, { type: "date", required: true })
        + field("endDate", "Vencimento do plano", record?.endDate, { type: "date", required: true });
    } else if (isTeacher) {
      fields.innerHTML = field("name", "Nome completo", record?.name, { required: true, full: true, placeholder: "Ex.: João Costa" })
        + field("email", "E-mail", record?.email, { type: "email", placeholder: "joao@email.com" })
        + field("phone", "WhatsApp com DDD", record?.phone, { type: "tel", placeholder: "11999999999" })
        + field("subjects", "Áreas / disciplinas", record?.subjects, { full: true, placeholder: "Ex.: Inglês, conversação" });
    } else {
      if (!state.students.length || !state.teachers.length) {
        notify("Cadastre ao menos um aluno e um professor antes de agendar.", true);
        return;
      }
      const today = todayKey();
      fields.innerHTML = field("title", "Título da aula", record?.title, { placeholder: "Ex.: Inglês · conversação" })
        + field("date", "Data", record?.date || today, { type: "date", required: true, min: record?.date && record.date < today ? undefined : today })
        + field("studentId", "Aluno", record?.studentId, { required: true, select: state.students.map((student) => ({ value: student.id, label: student.name })) })
        + field("teacherId", "Professor(a)", record?.teacherId, { required: true, select: state.teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })) })
        + field("start", "Início", record?.start || "09:00", { type: "time", required: true })
        + field("end", "Término", record?.end || "10:00", { type: "time", required: true })
        + field("notes", "Observações", record?.notes, { textarea: true, full: true, placeholder: "Detalhes úteis para a aula..." });
    }
    dialog.showModal();
    fields.querySelector("input, select, textarea")?.focus();
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!formContext) return;
    errorBox.textContent = "";
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const { kind, recordId } = formContext;
    if (!isManager()) {
      errorBox.textContent = "Seu perfil não tem permissão para alterar cadastros.";
      return;
    }
    const collection = kind === "student" ? "students" : kind === "teacher" ? "teachers" : "classes";
    if (kind === "student") {
      const planError = validateStudentPlan(values);
      if (planError) {
        errorBox.textContent = planError;
        return;
      }
    }
    if (kind === "class") {
      values.studentName = byId(state.students, values.studentId)?.name || "";
      values.teacherName = byId(state.teachers, values.teacherId)?.name || "";
      const result = validateClass(values, state.classes, recordId);
      if (result.error) {
        errorBox.textContent = result.error;
        return;
      }
    }
    const records = state[collection];
    const record = recordId
      ? { ...byId(records, recordId), ...values }
      : { id: id(), ...values };
    try {
      await saveRecord(currentAccess.workspaceId, collection, record, recordId);
      state = await loadWorkspace(currentUser.uid);
    } catch (error) {
      console.error("Não foi possível salvar o registro no Firebase.", error);
      errorBox.textContent = error.message || "Não foi possível salvar no Firebase. Tente novamente.";
      return;
    }
    dialog.close();
    formContext = null;
    searchTerm = "";
    render();
    notify(recordId ? "Alterações salvas." : "Cadastro realizado com sucesso.");
  }

  async function deleteRecord(kind, recordId) {
    const collection = kind === "student" ? "students" : kind === "teacher" ? "teachers" : "classes";
    const record = byId(state[collection], recordId);
    if (!record) return;
    const kindLabel = kind === "student" ? "aluno" : kind === "teacher" ? "professor" : "aula";
    const linked = kind === "student" ? state.classes.filter((item) => item.studentId === recordId)
      : kind === "teacher" ? state.classes.filter((item) => item.teacherId === recordId) : [];
    const question = linked.length
      ? `Excluir este ${kindLabel} também removerá ${linked.length} aula(s) vinculada(s). Continuar?`
      : `Excluir este ${kindLabel}?`;
    if (!window.confirm(question)) return;
    try {
      await deleteCloudRecord(currentAccess.workspaceId, collection, recordId);
      state = await loadWorkspace(currentUser.uid);
    } catch (error) {
      console.error("Não foi possível excluir o registro no Firebase.", error);
      notify(error.message || "Não foi possível excluir no Firebase. Tente novamente.", true);
      return;
    }
    render();
    notify(`${kindLabel[0].toUpperCase()}${kindLabel.slice(1)} excluído.`);
  }

  function exportData() {
    const file = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `classschedule-backup-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Backup dos dados exportado.");
  }

  document.addEventListener("click", (event) => {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      event.preventDefault();
      if (!isManager() && ["alunos", "professores"].includes(pageButton.dataset.page)) {
        notify("Essa área está disponível apenas para administração e secretaria.", true);
        return;
      }
      activePage = pageButton.dataset.page;
      searchTerm = "";
      render();
      document.getElementById("sidebar").classList.remove("open");
      document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const { action: actionName, id: recordId } = action.dataset;
    if (!isManager()) {
      notify("Seu perfil não tem permissão para alterar cadastros.", true);
      return;
    }
    if (actionName === "new-student") openForm("student");
    else if (actionName === "new-teacher") openForm("teacher");
    else if (actionName === "new-class") openForm("class");
    else if (actionName === "edit-student") openForm("student", byId(state.students, recordId));
    else if (actionName === "edit-teacher") openForm("teacher", byId(state.teachers, recordId));
    else if (actionName === "edit-class") openForm("class", byId(state.classes, recordId));
    else if (actionName === "delete-student") deleteRecord("student", recordId);
    else if (actionName === "delete-teacher") deleteRecord("teacher", recordId);
    else if (actionName === "delete-class") deleteRecord("class", recordId);
  });

  page.addEventListener("input", (event) => {
    if (event.target.id !== "search-input") return;
    const position = event.target.selectionStart;
    searchTerm = event.target.value.toLowerCase().trim();
    if (activePage === "alunos") renderStudents();
    if (activePage === "professores") renderTeachers();
    const input = document.getElementById("search-input");
    input.focus();
    input.setSelectionRange(position, position);
  });

  form.addEventListener("submit", saveForm);
  document.getElementById("dialog-close").addEventListener("click", () => dialog.close());
  document.getElementById("dialog-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("export-data").addEventListener("click", exportData);
  document.getElementById("menu-toggle").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    const open = sidebar.classList.toggle("open");
    document.getElementById("menu-toggle").setAttribute("aria-expanded", String(open));
  });

  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
  }).format(new Date());
  const authScreen = document.getElementById("auth-screen");
  const application = document.getElementById("application");
  const authForm = document.getElementById("auth-form");
  const authError = document.getElementById("auth-error");
  const authSubmit = document.getElementById("auth-submit");
  let createAccount = false;
  let authGeneration = 0;

  function authErrorMessage(error) {
    const messages = {
      "auth/email-already-in-use": "Este e-mail já possui uma conta. Entre com sua senha.",
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/invalid-email": "Informe um endereço de e-mail válido.",
      "auth/network-request-failed": "Falha de conexão. Verifique a internet e tente novamente.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
      "auth/weak-password": "Escolha uma senha com pelo menos 6 caracteres."
    };
    return messages[error.code] || error.message || "Não foi possível autenticar. Tente novamente.";
  }

  function setAuthMode(create) {
    createAccount = create;
    document.getElementById("auth-title").textContent = create ? "Crie sua conta" : "Entre na sua conta";
    authSubmit.textContent = create ? "Criar conta" : "Entrar";
    document.getElementById("auth-mode-toggle").textContent = create
      ? "Já tem uma conta? Entrar"
      : "Ainda não tem conta? Criar conta";
    document.getElementById("auth-password").autocomplete = create ? "new-password" : "current-password";
    authError.textContent = "";
  }

  async function handleAuth(user) {
    const generation = ++authGeneration;
    unsubscribeWorkspace?.();
    unsubscribeWorkspace = null;
    if (!user) {
      currentUser = null;
      currentAccess = null;
      state = { students: [], teachers: [], classes: [] };
      application.hidden = true;
      authScreen.hidden = false;
      return;
    }

    authError.textContent = "";
    authSubmit.disabled = true;
    try {
      const { claims } = await user.getIdTokenResult();
      const access = resolveAccess(user.uid, claims);
      const workspace = await loadWorkspace(user.uid, claims);
      if (generation !== authGeneration) return;
      currentUser = user;
      currentAccess = access;
      state = workspace;
      document.getElementById("user-email").textContent = user.email || "";
      application.hidden = false;
      authScreen.hidden = true;
      render();
      unsubscribeWorkspace = subscribeWorkspace(user.uid, claims, (updatedWorkspace) => {
        if (currentUser?.uid !== user.uid) return;
        state = updatedWorkspace;
        render();
      }, (error) => {
        console.error("Não foi possível sincronizar os dados do Firebase.", error);
        notify("A sincronização com o Firebase falhou. Verifique a conexão.", true);
      });
    } catch (error) {
      console.error("Não foi possível carregar os dados do Firebase.", error);
      if (generation !== authGeneration) return;
      currentUser = null;
      authScreen.hidden = false;
      authError.textContent = error.message || "Não foi possível carregar seus dados. Verifique as regras e a conexão Firebase.";
      try {
        await signOutUser();
      } catch (signOutError) {
        console.error("Não foi possível encerrar a sessão após falha ao carregar os dados.", signOutError);
        authError.textContent += " Também não foi possível encerrar a sessão; recarregue a página.";
      }
    } finally {
      authSubmit.disabled = !firebaseConfigured;
    }
  }

  document.getElementById("auth-mode-toggle").addEventListener("click", () => setAuthMode(!createAccount));
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!firebaseConfigured) return;
    authError.textContent = "";
    authSubmit.disabled = true;
    const values = Object.fromEntries(new FormData(authForm).entries());
    try {
      if (createAccount) await signUp(values.email, values.password);
      else await signIn(values.email, values.password);
    } catch (error) {
      console.error("Falha na autenticação Firebase.", error);
      authError.textContent = authErrorMessage(error);
      authSubmit.disabled = false;
    }
  });
  document.getElementById("sign-out").addEventListener("click", async () => {
    try {
      await signOutUser();
    } catch (error) {
      console.error("Não foi possível encerrar a sessão Firebase.", error);
      notify(error.message || "Não foi possível sair da conta.", true);
    }
  });

  if (!firebaseConfigured) {
    document.getElementById("auth-config-warning").hidden = false;
    authSubmit.disabled = true;
    document.getElementById("auth-mode-toggle").disabled = true;
    authError.textContent = "Configure as credenciais do Firebase para entrar ou criar uma conta.";
  } else {
    watchAuth((user) => {
      void handleAuth(user);
    });
  }
})();
