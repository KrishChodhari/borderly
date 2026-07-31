import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------------------------------------------------------------
// Firebase setup
// ---------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const stampsCol = collection(db, "stamps");

let allStamps = []; // {id, person, type, country, date: "YYYY-MM-DD"}

onSnapshot(query(stampsCol, orderBy("date")), (snap) => {
  allStamps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  refreshPersonOptions();
  render();
}, (err) => {
  console.error("Firestore error:", err);
  showToast("Couldn't load data — check firebase-config.js");
});

// ---------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysISO(iso, n) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function fmtDMY(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function dmyToISO(dmy) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy.trim());
  if (!match) return null;
  const [, d, m, y] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getMonth() !== Number(m) - 1) return null; // invalid day rollover
  return `${y}-${m}-${d}`;
}

function daysBetweenInclusive(startISO, endISO) {
  const ms = isoToDate(endISO) - isoToDate(startISO);
  return Math.round(ms / 86400000) + 1;
}

function fyStart(d) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, 3, 1); // 1 April
}

function getRangeForPeriod(period, customStartISO, customEndISO) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isoToday = toISO(today);

  if (period === "fy") {
    const fy = fyStart(today);
    return {
      start: toISO(fy),
      end: isoToday,
      label: `Financial Year ${fy.getFullYear()}\u2013${fy.getFullYear() + 1} · 1 Apr \u2013 today`
    };
  }
  if (period === "fy-prev") {
    const fy = fyStart(today);
    const prevStart = new Date(fy.getFullYear() - 1, 3, 1);
    const prevEnd = new Date(fy.getFullYear(), 2, 31);
    return {
      start: toISO(prevStart),
      end: toISO(prevEnd),
      label: `Financial Year ${prevStart.getFullYear()}\u2013${prevStart.getFullYear() + 1}`
    };
  }
  if (period === "calendar") {
    return {
      start: `${today.getFullYear()}-01-01`,
      end: isoToday,
      label: `${today.getFullYear()} calendar year`
    };
  }
  if (period === "all") {
    return { start: "0001-01-01", end: isoToday, label: "All time" };
  }
  // custom
  if (customStartISO && customEndISO) {
    return {
      start: customStartISO,
      end: customEndISO,
      label: `${fmtDMY(customStartISO)} \u2013 ${fmtDMY(customEndISO)}`
    };
  }
  return { start: `${today.getFullYear()}-01-01`, end: isoToday, label: "Custom range" };
}

// ---------------------------------------------------------------
// Turn arrival/departure stamps into stays, then clip to a range
// ---------------------------------------------------------------
function computeStays(stamps) {
  const byPerson = {};
  stamps.forEach((s) => {
    (byPerson[s.person] = byPerson[s.person] || []).push(s);
  });

  const stays = [];

  Object.entries(byPerson).forEach(([person, list]) => {
    const sorted = [...list].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // same-day: arrivals before departures
      return a.type === b.type ? 0 : a.type === "arrival" ? -1 : 1;
    });

    let open = null; // { country, start }

    sorted.forEach((s) => {
      if (s.type === "arrival") {
        if (open) {
          // travelled onward without an explicit departure stamp
          stays.push({
            person, country: open.country,
            start: open.start, end: addDaysISO(s.date, -1), ongoing: false
          });
        }
        open = { country: s.country, start: s.date };
      } else {
        // departure
        if (open) {
          stays.push({
            person, country: open.country,
            start: open.start, end: s.date, ongoing: false
          });
          open = null;
        } else {
          // departure with no prior arrival on record — assume they
          // were already there; start is unknown, so it's clipped
          // to whatever range is being viewed.
          stays.push({
            person, country: s.country,
            start: null, end: s.date, ongoing: false
          });
        }
      }
    });

    if (open) {
      stays.push({
        person, country: open.country,
        start: open.start, end: null, ongoing: true
      });
    }
  });

  return stays;
}

function clipStayToRange(stay, rangeStart, rangeEnd) {
  const start = stay.start && stay.start > rangeStart ? stay.start : rangeStart;
  const end = stay.end && stay.end < rangeEnd ? stay.end : rangeEnd;
  if (start > end) return 0;
  return daysBetweenInclusive(start, end);
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
const els = {
  personFilter: document.getElementById("personFilter"),
  periodFilter: document.getElementById("periodFilter"),
  customRange: document.getElementById("customRange"),
  rangeStart: document.getElementById("rangeStart"),
  rangeEnd: document.getElementById("rangeEnd"),
  rangeBanner: document.getElementById("rangeBanner"),
  emptyState: document.getElementById("emptyState"),
  personCards: document.getElementById("personCards"),
  matrixTable: document.getElementById("matrixTable"),
  ledgerBody: document.getElementById("ledgerBody"),
  addBtn: document.getElementById("addBtn"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  closeModal: document.getElementById("closeModal"),
  cancelModal: document.getElementById("cancelModal"),
  stampForm: document.getElementById("stampForm"),
  fPerson: document.getElementById("fPerson"),
  fType: document.getElementById("fType"),
  fCountry: document.getElementById("fCountry"),
  fDate: document.getElementById("fDate"),
  formError: document.getElementById("formError"),
  toast: document.getElementById("toast"),
  tabBtnDashboard: document.getElementById("tabBtnDashboard"),
  tabBtnLedger: document.getElementById("tabBtnLedger"),
  dashboardTab: document.getElementById("dashboardTab"),
  ledgerTab: document.getElementById("ledgerTab"),
};

function refreshPersonOptions() {
  const names = [...new Set(allStamps.map((s) => s.person))].sort();
  const current = els.personFilter.value;
  els.personFilter.innerHTML = '<option value="all">All travelers</option>' +
    names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  if (names.includes(current)) els.personFilter.value = current;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Normalizes country entry so "belgium" / "IVORY COAST" all save the
// same way, e.g. "Belgium", "Ivory Coast".
function titleCaseCountry(str) {
  return str.trim().toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------
// Render
// ---------------------------------------------------------------
function render() {
  const period = els.periodFilter.value;
  const personSel = els.personFilter.value;
  const range = getRangeForPeriod(period, els.rangeStart.value, els.rangeEnd.value);

  els.rangeBanner.textContent = `Showing ${range.label}`;

  const stamps = personSel === "all"
    ? allStamps
    : allStamps.filter((s) => s.person === personSel);

  els.emptyState.hidden = allStamps.length !== 0;

  const stays = computeStays(stamps);

  // totals[person][country] = days
  const totals = {};
  stays.forEach((stay) => {
    const days = clipStayToRange(stay, range.start, range.end);
    if (days <= 0) return;
    totals[stay.person] = totals[stay.person] || {};
    totals[stay.person][stay.country] = (totals[stay.person][stay.country] || 0) + days;
  });

  renderCards(totals);
  renderMatrix(totals);
  renderLedger(stamps, range);
}

function renderCards(totals) {
  const people = Object.keys(totals).sort();
  if (people.length === 0) {
    els.personCards.innerHTML = "";
    return;
  }
  els.personCards.innerHTML = people.map((person) => {
    const countryTotals = totals[person];
    const total = Object.values(countryTotals).reduce((a, b) => a + b, 0);
    const chips = Object.entries(countryTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([country, days]) => `<span class="chip">${escapeHtml(country)} · ${days}d</span>`)
      .join("");
    const initials = person.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    return `
      <article class="person-card">
        <div class="person-card-top">
          <span class="person-monogram">${escapeHtml(initials)}</span>
          <span class="person-card-name">${escapeHtml(person)}</span>
        </div>
        <div class="person-card-total">${total}</div>
        <div class="person-card-total-label">days in range</div>
        <div class="person-card-chips">${chips}</div>
      </article>
    `;
  }).join("");
}

function renderMatrix(totals) {
  const people = Object.keys(totals).sort();
  const countries = [...new Set(people.flatMap((p) => Object.keys(totals[p])))].sort();

  if (people.length === 0 || countries.length === 0) {
    els.matrixTable.innerHTML = "";
    document.getElementById("matrixSection").hidden = true;
    return;
  }
  document.getElementById("matrixSection").hidden = false;

  const headerCells = countries.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join("");
  const rows = people.map((person) => {
    const rowTotal = Object.values(totals[person]).reduce((a, b) => a + b, 0);
    const cells = countries.map((c) => `<td class="num">${totals[person][c] || "–"}</td>`).join("");
    return `<tr><td>${escapeHtml(person)}</td>${cells}<td class="num matrix-total">${rowTotal}</td></tr>`;
  }).join("");

  els.matrixTable.innerHTML = `
    <thead><tr><th>Traveler</th>${headerCells}<th class="num">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderLedger(stamps, range) {
  const inRange = stamps
    .filter((s) => s.date >= range.start && s.date <= range.end)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  document.getElementById("ledgerSection").hidden = inRange.length === 0;

  els.ledgerBody.innerHTML = inRange.map((s) => `
    <tr>
      <td>${escapeHtml(s.person)}</td>
      <td><span class="stamp-tag ${s.type}">${s.type}</span></td>
      <td>${escapeHtml(s.country)}</td>
      <td>${fmtDMY(s.date)}</td>
      <td><button class="row-delete" data-id="${s.id}" title="Delete stamp">Delete</button></td>
    </tr>
  `).join("");
}

// ---------------------------------------------------------------
// Events
// ---------------------------------------------------------------
els.personFilter.addEventListener("change", render);
els.periodFilter.addEventListener("change", () => {
  els.customRange.hidden = els.periodFilter.value !== "custom";
  render();
});
els.rangeStart.addEventListener("change", render);
els.rangeEnd.addEventListener("change", render);

function setActiveTab(tab) {
  const isDashboard = tab === "dashboard";
  els.dashboardTab.hidden = !isDashboard;
  els.ledgerTab.hidden = isDashboard;
  els.tabBtnDashboard.classList.toggle("active", isDashboard);
  els.tabBtnLedger.classList.toggle("active", !isDashboard);
  els.tabBtnDashboard.setAttribute("aria-selected", String(isDashboard));
  els.tabBtnLedger.setAttribute("aria-selected", String(!isDashboard));
}

els.tabBtnDashboard.addEventListener("click", () => setActiveTab("dashboard"));
els.tabBtnLedger.addEventListener("click", () => setActiveTab("ledger"));

els.ledgerBody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".row-delete");
  if (!btn) return;
  if (!confirm("Delete this stamp?")) return;
  try {
    await deleteDoc(doc(db, "stamps", btn.dataset.id));
    showToast("Stamp deleted");
  } catch (err) {
    console.error(err);
    showToast("Couldn't delete — try again");
  }
});

function openModal() {
  els.stampForm.reset();
  els.formError.hidden = true;
  els.modalBackdrop.hidden = false;
  els.fPerson.focus();
}
function closeModal() { els.modalBackdrop.hidden = true; }

els.addBtn.addEventListener("click", openModal);
els.closeModal.addEventListener("click", closeModal);
els.cancelModal.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", (e) => {
  if (e.target === els.modalBackdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.modalBackdrop.hidden) closeModal();
});

// Auto-format the date field as DD/MM/YYYY while typing, so mobile
// numeric keypads (which have no "/") still produce a valid date.
els.fDate.addEventListener("input", () => {
  const digits = els.fDate.value.replace(/\D/g, "").slice(0, 8);
  let out = digits;
  if (digits.length > 4) {
    out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  } else if (digits.length > 2) {
    out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  els.fDate.value = out;
});

els.stampForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const person = els.fPerson.value.trim();
  const type = els.fType.value;
  const country = titleCaseCountry(els.fCountry.value);
  const iso = dmyToISO(els.fDate.value);

  if (!person || !country || !iso) {
    els.formError.textContent = "Please fill in every field. Date must be DD/MM/YYYY.";
    els.formError.hidden = false;
    return;
  }

  const submitBtn = els.stampForm.querySelector(".btn-primary");
  submitBtn.disabled = true;
  try {
    await addDoc(stampsCol, {
      person, type, country, date: iso, createdAt: serverTimestamp()
    });
    closeModal();
    showToast(`Added ${type} stamp for ${person}`);
  } catch (err) {
    console.error(err);
    els.formError.textContent = "Couldn't save — check your connection and Firebase setup.";
    els.formError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

// initial paint before Firestore responds
render();
