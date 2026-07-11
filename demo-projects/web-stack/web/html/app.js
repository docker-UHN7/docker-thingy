const listEl = document.getElementById("task-list");
const formEl = document.getElementById("add-form");
const inputEl = document.getElementById("title-input");
const sourceEl = document.getElementById("source");

async function loadTasks() {
  const response = await fetch("/api/tasks");
  sourceEl.textContent = response.headers.get("X-Data-Source") ?? "unknown";
  const tasks = await response.json();
  renderTasks(tasks);
}

function renderTasks(tasks) {
  listEl.innerHTML = "";

  if (tasks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-note";
    empty.textContent = "No tasks yet - add one above.";
    listEl.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("li");
    row.className = `task-row ${task.done ? "done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => toggleTask(task.id, checkbox.checked));

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteTask(task.id));

    row.append(checkbox, title, deleteButton);
    listEl.appendChild(row);
  }
}

async function addTask(title) {
  await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  });
  await loadTasks();
}

async function toggleTask(id, done) {
  await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done })
  });
  await loadTasks();
}

async function deleteTask(id) {
  await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  await loadTasks();
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = inputEl.value.trim();
  if (!title) return;
  inputEl.value = "";
  void addTask(title);
});

void loadTasks();
