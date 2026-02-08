const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";

const state = {
  pdf: null,
  pageNumber: 1,
  totalPages: 0,
  scale: 1.4,
  selection: null,
  namesMap: {},
  tableData: [],
  selectedRowIndex: null,
  textItems: [],
  viewport: null,
};

const pdfInput = document.getElementById("pdf-input");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageIndicator = document.getElementById("page-indicator");
const canvas = document.getElementById("pdf-canvas");
const selectionRect = document.getElementById("selection-rect");
const extractBtn = document.getElementById("extract-table");
const resetBtn = document.getElementById("reset-selection");
const copyBtn = document.getElementById("copy-row");
const tableHead = document.querySelector("#data-table thead");
const tableBody = document.querySelector("#data-table tbody");
const nameList = document.getElementById("name-list");
const loadNamesBtn = document.getElementById("load-names");
const formattedOutput = document.getElementById("formatted-output");

const ctx = canvas.getContext("2d");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const updateControls = () => {
  prevPageBtn.disabled = state.pageNumber <= 1;
  nextPageBtn.disabled = state.pageNumber >= state.totalPages;
  extractBtn.disabled = !state.pdf;
  resetBtn.disabled = !state.selection;
  copyBtn.disabled = state.selectedRowIndex === null;
  pageIndicator.textContent = `Strona ${state.pageNumber} / ${state.totalPages}`;
};

const clearTable = () => {
  tableHead.innerHTML = "";
  tableBody.innerHTML = "";
  state.tableData = [];
  state.selectedRowIndex = null;
  formattedOutput.textContent = "—";
  updateControls();
};

const renderPage = async () => {
  if (!state.pdf) {
    return;
  }
  const page = await state.pdf.getPage(state.pageNumber);
  const viewport = page.getViewport({ scale: state.scale });
  state.viewport = viewport;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const renderContext = { canvasContext: ctx, viewport };
  await page.render(renderContext).promise;

  const textContent = await page.getTextContent();
  state.textItems = textContent.items.map((item) => {
    const [a, b, c, d, e, f] = item.transform;
    const [x1, y1] = viewport.convertToViewportPoint(e, f);
    const [x2, y2] = viewport.convertToViewportPoint(
      e + item.width,
      f + item.height
    );
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return {
      text: item.str,
      x,
      y,
      width,
      height,
    };
  });
};

const setSelectionRect = (start, end) => {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x);
  const height = Math.abs(start.y - end.y);
  selectionRect.style.display = "block";
  selectionRect.style.left = `${left}px`;
  selectionRect.style.top = `${top}px`;
  selectionRect.style.width = `${width}px`;
  selectionRect.style.height = `${height}px`;
};

const resetSelection = () => {
  state.selection = null;
  selectionRect.style.display = "none";
  updateControls();
};

const pointInSelection = (item, selection) => {
  return (
    item.x >= selection.x0 &&
    item.x + item.width <= selection.x1 &&
    item.y >= selection.y0 &&
    item.y <= selection.y1
  );
};

const groupRows = (items) => {
  const rows = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rowThreshold = 6;

  sorted.forEach((item) => {
    const existing = rows.find((row) => Math.abs(row.y - item.y) < rowThreshold);
    if (existing) {
      existing.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.items.sort((a, b) => a.x - b.x).map((item) => item.text.trim())
    );
};

const normalizeColumns = (rows) => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const padded = rows.map((row) => {
    const next = [...row];
    while (next.length < maxCols) {
      next.push("");
    }
    return next;
  });

  const nonEmptyIndexes = [];
  for (let i = 0; i < maxCols; i += 1) {
    const hasValue = padded.some((row) => row[i] && row[i].trim());
    if (hasValue) {
      nonEmptyIndexes.push(i);
    }
  }

  const trimmed = padded.map((row) => nonEmptyIndexes.map((index) => row[index]));
  const extended = trimmed.map((row) => {
    const result = [];
    row.forEach((value) => {
      result.push(value);
      result.push("");
    });
    return result;
  });

  return extended;
};

const replaceNumbersWithNames = (rows) => {
  if (!rows.length) {
    return rows;
  }
  return rows.map((row) => {
    const updated = [...row];
    const lastDataIndex = updated
      .map((value, index) => ({ value, index }))
      .filter((item) => item.value && item.value.trim())
      .slice(-1)[0]?.index;

    if (lastDataIndex === undefined) {
      return updated;
    }

    const numbers = updated[lastDataIndex]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const names = numbers
      .map((num) => Number(num))
      .filter((num) => !Number.isNaN(num))
      .map((num) => state.namesMap[num])
      .filter(Boolean);

    if (names.length) {
      const targetIndex = clamp(lastDataIndex - 1, 0, updated.length - 1);
      updated[targetIndex] = names.join(", ");
    }

    return updated;
  });
};

const renderTable = () => {
  clearTable();
  if (!state.tableData.length) {
    return;
  }
  const columnCount = state.tableData[0].length;
  const headRow = document.createElement("tr");
  for (let i = 0; i < columnCount; i += 1) {
    const th = document.createElement("th");
    th.textContent = `Kolumna ${i + 1}`;
    headRow.appendChild(th);
  }
  tableHead.appendChild(headRow);

  state.tableData.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => selectRow(index));
    row.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  });
};

const formatRowForCopy = (row) => {
  const values = [...row];
  const safe = (index, fallback = "") => values[index] ?? fallback;
  const formatValue = (value) => (value || "").replace(/\n/g, " ");

  const scene = `${safe(0)}${safe(1)}`.trim();
  const location = `${safe(4)}${safe(5)}`.replace(/\n/g, "/").toLowerCase();
  const description = `${safe(6)}${safe(7)}${safe(8)}${safe(9)}`
    .replace(/\n/g, " / ")
    .trim();
  const time = `${safe(2)}${safe(3)}`.replace(/:/g, "’").trim();
  const people = `${safe(10)}${safe(11)}`.trim();

  return [scene, location, description, time, people]
    .map((value) => formatValue(value))
    .join("\t");
};

const selectRow = (index) => {
  state.selectedRowIndex = index;
  const rows = tableBody.querySelectorAll("tr");
  rows.forEach((row, i) => {
    row.classList.toggle("selected", i === index);
  });
  const formatted = formatRowForCopy(state.tableData[index]);
  formattedOutput.textContent = formatted || "—";
  updateControls();
};

const copySelectedRow = async () => {
  if (state.selectedRowIndex === null) {
    return;
  }
  const formatted = formatRowForCopy(state.tableData[state.selectedRowIndex]);
  try {
    await navigator.clipboard.writeText(formatted);
    copyBtn.textContent = "Skopiowano!";
    setTimeout(() => {
      copyBtn.textContent = "Kopiuj zaznaczenie";
    }, 1500);
  } catch (error) {
    formattedOutput.textContent = formatted;
  }
};

const extractTable = () => {
  if (!state.selection) {
    return;
  }
  const selectedItems = state.textItems.filter((item) =>
    pointInSelection(item, state.selection)
  );

  const rows = groupRows(selectedItems);
  const normalized = normalizeColumns(rows);
  const replaced = replaceNumbersWithNames(normalized);
  state.tableData = replaced;
  renderTable();
};

const updateNamesMap = () => {
  state.namesMap = {};
  nameList
    .value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [number, ...rest] = line.split(".");
      const name = rest.join(".").trim();
      const key = Number(number.trim());
      if (!Number.isNaN(key) && name) {
        state.namesMap[key] = name;
      }
    });
  localStorage.setItem("clippertake.names", nameList.value.trim());
};

const loadNamesMapFromStorage = () => {
  const stored = localStorage.getItem("clippertake.names");
  if (stored) {
    nameList.value = stored;
    updateNamesMap();
  }
};

let dragStart = null;

const canvasPosition = (event) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

canvas.addEventListener("mousedown", (event) => {
  if (!state.pdf) {
    return;
  }
  dragStart = canvasPosition(event);
});

canvas.addEventListener("mousemove", (event) => {
  if (!dragStart) {
    return;
  }
  const current = canvasPosition(event);
  setSelectionRect(dragStart, current);
});

canvas.addEventListener("mouseup", (event) => {
  if (!dragStart) {
    return;
  }
  const end = canvasPosition(event);
  const x0 = Math.min(dragStart.x, end.x);
  const y0 = Math.min(dragStart.y, end.y);
  const x1 = Math.max(dragStart.x, end.x);
  const y1 = Math.max(dragStart.y, end.y);
  state.selection = { x0, y0, x1, y1 };
  dragStart = null;
  updateControls();
});

pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  const arrayBuffer = await file.arrayBuffer();
  state.pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  state.totalPages = state.pdf.numPages;
  state.pageNumber = 1;
  resetSelection();
  clearTable();
  await renderPage();
  updateControls();
});

prevPageBtn.addEventListener("click", async () => {
  if (state.pageNumber > 1) {
    state.pageNumber -= 1;
    resetSelection();
    clearTable();
    await renderPage();
    updateControls();
  }
});

nextPageBtn.addEventListener("click", async () => {
  if (state.pageNumber < state.totalPages) {
    state.pageNumber += 1;
    resetSelection();
    clearTable();
    await renderPage();
    updateControls();
  }
});

extractBtn.addEventListener("click", extractTable);
resetBtn.addEventListener("click", resetSelection);
copyBtn.addEventListener("click", copySelectedRow);
loadNamesBtn.addEventListener("click", updateNamesMap);

updateControls();
loadNamesMapFromStorage();
