(() => {
  "use strict";

  const STORAGE_KEY = "classschedule.data.v1";
  const page = document.getElementById("page-content");
  const dialog = document.getElementById("record-dialog");
  const form = document.getElementById("record-form");
  const fields = document.getElementById("dialog-fields");
  const errorBox = document.getElementById("form-error");
  const sectionTitles = { inicio: "Visão geral", alunos: "Alunos", professores: "Professores", agenda: "Agenda" };
  let state = loadState();
  let activePage = "inicio";
  let searchTerm = "";
  let formContext = null;

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return { students: [], teachers: [], classes: [] };
      const data = JSON.parse(saved);
      if (!data || !Array.isArray(data.students) || !Array.isArray(data.teachers) || !Array.isArray(data.classes)) {
        throw new Error("Formato de dados inválido.");
      }
      return data;
    } catch (error) {
      console.error("Não foi possível carregar os dados locais.", error);
      return { students: [], teachers: [], classes: [] };
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error("Não foi possível salvar os dados locais.", error);
      notify("Não foi possível salvar. Verifique o espaço disponível no navegador.", true);
      return false;
    }
  }

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
    return `<tr>
      <td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials(student?.name))}</span><span><span class="person-name">${escapeHtml(student?.name || "Aluno removido")}</span><span class="person-sub">${escapeHtml(item.title || "Aula")}</span></span></div></td>
      <td>${escapeHtml(teacher?.name || "Professor removido")}</td>
      <td>${escapeHtml(classDateTime(item))}</td>
      <td><div class="action-row"><a class="action-link" href="${escapeHtml(calendarLink(item, student, teacher))}" target="_blank" rel="noopener noreferrer" aria-label="Adicionar ao Google Calendar">＋</a><button class="action-link" data-action="edit-class" data-id="${escapeHtml(item.id)}" aria-label="Editar aula">✎</button><button class="action-link button-danger" data-action="delete-class" data-id="${escapeHtml(item.id)}" aria-label="Excluir aula">×</button></div></td>
    </tr>`;
  }

  function emptyState(title, message, action = "") {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}${action}</div>`;
  }

  function renderDashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const classesThisMonth = state.classes.filter((item) => {
      const date = dateValue(item.date);
      return date && date >= monthStart && date < nextMonthStart;
    }).length;
    const expiring = state.students.map((student) => ({ student, days: dayDifference(student.endDate) }))
      .filter(({ days }) => days !== null && days >= 0 && days <= 30)
      .sort((a, b) => a.days - b.days);
    const upcoming = upcomingClasses();

    page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">SEU DIA, MAIS ORGANIZADO</p><h1>Visão geral</h1><p>Acompanhe alunos, equipe e aulas em um só lugar.</p></div><button class="button button-primary" data-action="new-class">＋ Agendar aula</button></div>
      <section class="stats-grid" aria-label="Resumo">
        <article class="stat-card"><div><span class="stat-label">Alunos cadastrados</span><strong class="stat-value">${state.students.length}</strong><span class="stat-note">com planos registrados</span></div><span class="stat-icon">♙</span></article>
        <article class="stat-card"><div><span class="stat-label">Professores</span><strong class="stat-value">${state.teachers.length}</strong><span class="stat-note">na sua equipe</span></div><span class="stat-icon green">♧</span></article>
        <article class="stat-card"><div><span class="stat-label">Aulas neste mês</span><strong class="stat-value">${classesThisMonth}</strong><span class="stat-note">na agenda</span></div><span class="stat-icon blue">▦</span></article>
        <article class="stat-card"><div><span class="stat-label">Planos a vencer</span><strong class="stat-value">${expiring.length}</strong><span class="stat-note">nos próximos 30 dias</span></div><span class="stat-icon orange">◷</span></article>
      </section>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-heading"><div><h2>Planos próximos do vencimento</h2><p>Alunos com expiração nos próximos 30 dias</p></div><button class="text-link" data-page="alunos">Ver alunos →</button></div>
          ${expiring.length ? `<div class="table-wrap"><table><thead><tr><th>ALUNO</th><th>PLANO</th><th>VENCIMENTO</th><th>CONTATO</th></tr></thead><tbody>${expiring.slice(0, 6).map(({ student, days }) => `<tr><td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials(student.name))}</span><span><span class="person-name">${escapeHtml(student.name)}</span><span class="person-sub">${escapeHtml(student.email || "Sem e-mail")}</span></span></div></td><td>${escapeHtml(student.plan || "—")}</td><td><span class="badge ${days <= 7 ? "warning" : "neutral"}">${days === 0 ? "Hoje" : `${days} dia${days === 1 ? "" : "s"}`}</span><div class="person-sub">${escapeHtml(dateLabel(student.endDate))}</div></td><td>${whatsappLink(student.phone, `Olá, ${student.name}! Seu plano ${student.plan || ""} está próximo do vencimento.`) ? `<a class="action-link whatsapp" href="${escapeHtml(whatsappLink(student.phone, `Olá, ${student.name}! Seu plano ${student.plan || ""} está próximo do vencimento.`))}" target="_blank" rel="noopener noreferrer" aria-label="Conversar com ${escapeHtml(student.name)} pelo WhatsApp">WA</a>` : `<span class="person-sub">Sem telefone</span>`}</td></tr>`).join("")}</tbody></table></div>` : emptyState("Tudo em dia", "Nenhum plano vence nos próximos 30 dias.", `<button class="button button-quiet button-small" data-action="new-student">Cadastrar aluno</button>`)}
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>Próximas aulas</h2><p>Compromissos futuros da agenda</p></div><button class="text-link" data-page="agenda">Ver agenda →</button></div>
          ${upcoming.length ? `<div class="agenda-list">${upcoming.map((item) => { const student = byId(state.students, item.studentId); const teacher = byId(state.teachers, item.teacherId); const date = dateValue(item.date); return `<article class="agenda-item"><span class="agenda-date"><strong>${date ? date.getDate() : "—"}</strong><small>${escapeHtml(date ? new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "") : "—")}</small></span><span class="agenda-details"><strong>${escapeHtml(item.title || "Aula")} · ${escapeHtml(student?.name || "Aluno")}</strong><span>${escapeHtml(item.start)} · ${escapeHtml(teacher?.name || "Professor")} · ${escapeHtml(dateLabel(item.date, { weekday: "short" }))}</span></span></article>`; }).join("")}</div>` : emptyState("Agenda livre", "Cadastre sua primeira aula para começar.", `<button class="button button-quiet button-small" data-action="new-class">Agendar aula</button>`)}
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
    page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">AULAS E COMPROMISSOS</p><h1>Agenda</h1><p>Evite conflitos de horário entre alunos e professores.</p></div><button class="button button-primary" data-action="new-class">＋ Agendar aula</button></div>
      <div class="agenda-summary"><span class="summary-chip"><strong>${upcoming.filter((item) => item.date === today).length}</strong> aula(s) hoje</span><span class="summary-chip"><strong>${upcoming.length}</strong> aula(s) futura(s)</span><span class="summary-chip"><strong>${thisMonth}</strong> neste mês</span></div>
      <section class="panel"><div class="panel-heading"><div><h2>Próximas aulas</h2><p>Inclui links para adicionar cada aula ao Google Calendar.</p></div></div>
      ${upcoming.length ? `<div class="table-wrap"><table><thead><tr><th>ALUNO</th><th>PROFESSOR</th><th>DATA E HORÁRIO</th><th>AÇÕES</th></tr></thead><tbody>${upcoming.map(classRow).join("")}</tbody></table></div>` : emptyState("Agenda livre", "Você ainda não tem aulas futuras cadastradas.", state.students.length && state.teachers.length ? `<button class="button button-quiet button-small" data-action="new-class">Agendar primeira aula</button>` : `<p class="form-hint">Cadastre ao menos um aluno e um professor antes de agendar.</p>`)}
      </section>
      ${state.classes.some((item) => item.date < today) ? `<section class="panel section-panel"><div class="panel-heading"><div><h2>Aulas anteriores</h2><p>Histórico de compromissos passados.</p></div></div><div class="table-wrap"><table><thead><tr><th>ALUNO</th><th>PROFESSOR</th><th>DATA E HORÁRIO</th><th>AÇÕES</th></tr></thead><tbody>${state.classes.filter((item) => item.date < today).sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`)).map(classRow).join("")}</tbody></table></div></section>` : ""}`;
  }

  function render() {
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

  function saveForm(event) {
    event.preventDefault();
    if (!formContext) return;
    errorBox.textContent = "";
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const { kind, recordId } = formContext;
    const collection = kind === "student" ? "students" : kind === "teacher" ? "teachers" : "classes";
    if (kind === "student" && values.endDate < values.startDate) {
      errorBox.textContent = "A data de vencimento precisa ser igual ou posterior ao início do plano.";
      return;
    }
    if (kind === "class") {
      if (values.start >= values.end) {
        errorBox.textContent = "O horário de término precisa ser posterior ao início.";
        return;
      }
      const conflict = state.classes.find((item) => {
        if (item.id === recordId || item.date !== values.date) return false;
        const overlaps = values.start < item.end && values.end > item.start;
        return overlaps && (item.teacherId === values.teacherId || item.studentId === values.studentId);
      });
      if (conflict) {
        const conflictingTeacher = conflict.teacherId === values.teacherId;
        errorBox.textContent = conflictingTeacher
          ? `Conflito: o(a) professor(a) já tem uma aula das ${conflict.start} às ${conflict.end} nessa data.`
          : `Conflito: o aluno já tem uma aula das ${conflict.start} às ${conflict.end} nessa data.`;
        return;
      }
    }
    const records = state[collection];
    if (recordId) {
      const index = records.findIndex((item) => item.id === recordId);
      if (index >= 0) records[index] = { ...records[index], ...values };
    } else {
      records.push({ id: id(), ...values });
    }
    if (!persist()) return;
    dialog.close();
    formContext = null;
    searchTerm = "";
    render();
    notify(recordId ? "Alterações salvas." : "Cadastro realizado com sucesso.");
  }

  function deleteRecord(kind, recordId) {
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
    if (kind === "student") state.classes = state.classes.filter((item) => item.studentId !== recordId);
    if (kind === "teacher") state.classes = state.classes.filter((item) => item.teacherId !== recordId);
    state[collection] = state[collection].filter((item) => item.id !== recordId);
    if (persist()) {
      render();
      notify(`${kindLabel[0].toUpperCase()}${kindLabel.slice(1)} excluído.`);
    }
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
  render();
})();
